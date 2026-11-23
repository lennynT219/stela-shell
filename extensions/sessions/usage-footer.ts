import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
  requestedSpeed: (ctx: ExtensionContext) => string | undefined = () => undefined) {
  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((_tui, theme) => {
      let key: string | undefined, prefix = "";
      return { invalidate() { key = undefined; }, render(width) {
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
        return [theme.fg("dim", truncate(line, width))];
      } };
    });
  });
}
