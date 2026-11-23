import type { Component, HStack, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PeerQuestion } from "./attention.ts";

import type { TaskRow } from "../activity-events.ts";
export interface ViewState { open: boolean; tasks: TaskRow[]; questions: PeerQuestion[] }
export interface ViewActions { toggle(): void; question(q: PeerQuestion): void; canOpen(q: PeerQuestion): boolean }
export interface Drawing { HStack: typeof HStack; truncateToWidth(s: string, width: number): string }
type Host = TUI & { mode?: string; layoutRoot?: Component; setLayoutRoot?(c: Component): void };
type Line = { text: string; key?: string; action?: () => void; role?: "accent" | "warning" | "muted" };
export const WIDE = 112, RAIL = 34;
const labels = { queued: "En cola", running: "En curso", cancelling: "Cancelando" };
// Treat all task labels and session names as untrusted display text, not terminal controls.
export const plain = (s: string) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
const name = (q: PeerQuestion) => plain(q.name) || q.id.slice(0, 8);

/** Owns only its widget and an optional split. Never replaces the editor, changes focus or reads its draft. */
export function activityView(tui: Host, theme: Theme, draw: Drawing, state: ViewState, actions: ViewActions) {
  let previous: Component | undefined, split: Component | undefined, page = 0, live = true;
  function summary(width: number): Line[] {
    const q = state.questions[0];
    if (q) {
      const direct = actions.canOpen(q), hint = direct ? "[Ver pregunta · Alt+J]" : "Responde en origen";
      const source = name(q), room = width - "Sesión  necesita tu respuesta · ".length - hint.length;
      const compact = direct ? "[Ver pregunta]" : "Ver en origen";
      const text = room >= 6 ? `Sesión ${draw.truncateToWidth(source, room)} necesita tu respuesta · ${hint}` :
        `${draw.truncateToWidth(source, Math.max(1, width - compact.length - 3))} · ${compact}`;
      return [{ text, key: `${q.id}:${q.token}`, role: "warning", action: direct ? () => actions.question(q) : undefined }];
    }
    const n = state.tasks.length;
    return n && !state.open ? [{ text: `${n} ${n === 1 ? "tarea en curso" : "tareas en curso"} · [Ver actividad · Alt+A]`, key: "toggle", action: actions.toggle }] : [];
  }
  function panel(): Line[] {
    const entries: Line[] = [
      ...state.questions.map(q => ({ text: `${actions.canOpen(q) ? "[Ver pregunta]" : "Ver en origen"} · ${name(q)}`, role: "warning" as const, key: `${q.id}:${q.token}`,
        action: actions.canOpen(q) ? () => actions.question(q) : undefined })),
      ...state.tasks.map(t => ({ text: `${labels[t.state]} · ${plain(t.label)}` })),
    ];
    const size = Math.max(1, Math.min(7, Math.floor(tui.terminal.rows / 3) - 2));
    const pages = Math.max(1, Math.ceil(entries.length / size)); page = Math.min(page, pages - 1);
    return [{ text: "Actividad · [Cerrar · Alt+A]", key: "toggle", action: actions.toggle, role: "accent" },
      ...(entries.length ? entries.slice(page * size, (page + 1) * size) : [{ text: "Sin tareas activas", role: "muted" as const }]),
      ...(pages > 1 ? [{ text: `[Más · ${page + 1}/${pages}]`, key: `more:${page}`, action: () => { page = (page + 1) % pages; tui.requestRender(); } }] : [])];
  }
  function surface(rows: (width: number) => Line[], rail: boolean): Component {
    let painted: Line[] = [], pressed: string | undefined;
    return {
      render(width) {
        painted = rows(width);
        return painted.map(l => draw.truncateToWidth(`${rail ? theme.fg("border", "│ ") : ""}${theme.fg(l.role ?? "accent", l.text)}`, width));
      },
      invalidate() {},
      handleMouse(e: TuiMouseEvent) {
        const line = painted[e.y];
        if (e.button !== "left") return undefined;
        if (e.type === "press") pressed = line?.key;
        if (!line?.action || !["click", "press", "release"].includes(e.type)) return undefined;
        if (e.type === "click") {
          const same = pressed !== undefined && pressed === line.key; pressed = undefined;
          if (same) line.action(); // a redraw can replace this row between mouse-down and mouse-up
        }
        return { handled: true }; // do not move focus away from the editor
      },
    };
  }
  const rail = surface(panel, true);
  function undock() {
    if (split && tui.layoutRoot === split && previous) tui.setLayoutRoot?.(previous);
    previous = split = undefined;
  }
  const isDocked = () => !!split && tui.layoutRoot === split && tui.terminal.columns >= WIDE;
  const widget = surface(width => state.open && !isDocked() ? panel() : summary(width), false);
  return {
    widget, refresh() {
      if (!state.open) { undock(); page = 0; }
      else if (!split && tui.mode === "fullscreen" && typeof tui.setLayoutRoot === "function" && typeof tui.layoutRoot?.render === "function") {
        // Pi 1.6 exposes the native fullscreen root at runtime, but not in the extension interface.
        // If unavailable, keep the in-place list. Never patch a host method or cover transcript columns.
        previous = tui.layoutRoot;
        const dock: Component = new draw.HStack([{ component: previous, basis: 0, grow: 1, minSize: 1 },
          { component: rail, basis: RAIL, minSize: RAIL, shrink: 0, visible: ({ width }) => live && state.open && tui.layoutRoot === dock && width >= WIDE }], { gap: 1 });
        split = dock; tui.setLayoutRoot(dock);
      }
      tui.requestRender();
    },
    dispose() { live = false; undock(); },
  };
}
