import type { CustomEditor, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

type Action = "tui.input.submit" | "app.message.followUp";
type Host = TUI & { getFocusedComponent?(): Component | null };

function label(key: string) {
  return key.split("+").map(part => /^(enter|return)$/i.test(part) ? "Intro" : part.charAt(0).toUpperCase() + part.slice(1)).join("+");
}

/** A read-only prompt hint. Pi owns the editor, input dispatch and both queue displays. */
export function registerTurnHint(pi: ExtensionAPI, Editor: typeof CustomEditor, keys: (action: Action) => readonly string[],
  fit: (line: string, width: number) => string) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("ss-turn-hint", (tui: Host, theme) => ({
      invalidate() {},
      render(width) {
        if (ctx.isIdle()) return [];
        const editor = tui.getFocusedComponent?.();
        if (!(editor instanceof Editor) || editor.disableSubmit || editor.isShowingAutocomplete()) return [];
        // Don't expand pasted attachments or retain the draft. Commands and shell input have different submit semantics.
        const draft = editor.getText().trimStart();
        if (!draft || /^[!/]/u.test(draft)) return [];
        const hints: string[] = [];
        for (const [action, word] of [["tui.input.submit", "ahora"], ["app.message.followUp", "después"]] as const) {
          const first = keys(action)[0];
          if (first) hints.push(theme.fg("muted", label(first)) + theme.fg("dim", `: ${word}`));
        }
        return hints.length ? [fit(hints.join(theme.fg("dim", " · ")), width)] : [];
      },
    }));
  });
}
