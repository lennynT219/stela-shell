import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

type FocusHost = TUI & { getFocusedComponent?(): Component | null };
export interface EditorCaption {
  attach(editor: Component, wantsCaption: () => boolean): void;
  line(editor: Component, width: number): string | undefined;
}

type Entry = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>[number];

/** Same session scope and usage-bearing entry kinds as Pi's native footer, not just the active branch. */
export function recordedUSD(entries: readonly Entry[]): number | undefined {
  let sum = 0;
  for (const e of entries) {
    const usage = e.type === "usage" || e.type === "compaction" || e.type === "branch_summary" ? e.usage :
      e.type === "message" && (e.message.role === "assistant" || e.message.role === "toolResult") ? e.message.usage : undefined;
    if (!usage) continue;
    const dollars = usage.cost?.total;
    if (!Number.isFinite(dollars) || dollars < 0) return undefined;
    sum += dollars;
  }
  return Number.isFinite(sum) ? sum : undefined;
}

export function registerUsageFooter(pi: ExtensionAPI, truncate: (s:string,w:number) => string,
  requestedSpeed: (ctx: ExtensionContext) => string | undefined = () => undefined): EditorCaption {
  // The editor and native footer are different Pi components. Let one owner draw the line,
  // never bleed graphics into a sibling. Both ask the same focus predicate, in any render order.
  const editors = new WeakMap<Component, () => boolean>();
  let mounted: { host: FocusHost; footer: Component; format(width: number): string } | undefined;
  const owner = (host: FocusHost, footer: Component) => {
    const focus = host.getFocusedComponent?.();
    if (!focus || !editors.get(focus)?.()) return undefined;
    // Pi 1.6 mounts editor / belowEditor widgets / footer in both modes. Do not
    // reorder widgets, draw in dialogs, or assume adjacency in a different layout.
    const [input, widgets, end] = host.children.slice(-3).map(c => (c as { children?: Component[] }).children);
    return input?.length === 1 && input[0] === focus && widgets?.length === 0 &&
      end?.length === 1 && end[0] === footer ? focus : undefined;
  };
  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((host, theme) => {
      let key: string | undefined, prefix = "";
      const format = (width: number) => {
        const sm = ctx.sessionManager, model = ctx.model;
        const next = JSON.stringify([sm.getSessionId(), sm.getLeafId(), model?.provider, model?.id, model?.contextWindow]);
        if (key !== next) {
          const pct = ctx.getContextUsage()?.percent, cost = recordedUSD(sm.getEntries());
          prefix = `Ctx ${typeof pct === "number" && Number.isFinite(pct) && pct >= 0 ? `${Math.round(pct)}%` : "—"} · ${cost === undefined ? "—" : `US$${cost.toFixed(2)}`} · `;
          key = next;
        }
        const id = model?.id.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu," ").trim() || "—";
        // Read the effective level on every render: changing it doesn't require a new message.
        const speed = requestedSpeed(ctx);
        const suffix = (model?.reasoning ? ` · ${ctx.thinkingLevel ?? "—"}` : "") + (speed ? ` · ${speed}` : "");
        const room = width - prefix.length - suffix.length;
        const line = room > 0 ? prefix + truncate(id, room) + suffix : prefix + id + suffix;
        return theme.fg("dim", truncate(line, width));
      };
      const footer: Component & { dispose(): void } = {
        invalidate() { key = undefined; },
        render(width) { return owner(host, footer) ? [] : [format(width)]; },
        dispose() { if (mounted?.footer === footer) mounted = undefined; },
      };
      mounted = { host, format, footer };
      return footer;
    });
  });
  return {
    attach(editor, wantsCaption) { editors.set(editor, wantsCaption); },
    line(editor, width) { return mounted && owner(mounted.host, mounted.footer) === editor ? mounted.format(width) : undefined; },
  };
}
