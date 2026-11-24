import type { Component, HStack, OverlayHandle, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PeerQuestion } from "./attention.ts";

import { quotaLines, type Quota } from "./codex-quota.ts";
import type { GitSummary } from "./git-summary.ts";
import type { TaskRow } from "../activity-events.ts";
export interface ViewState { open: boolean; tasks: TaskRow[]; launched?: number; questions: PeerQuestion[]; git?: GitSummary; quota?: Quota; capabilitiesExpanded?: boolean }
export interface ViewActions { toggle(): void; question(q: PeerQuestion): void; canOpen(q: PeerQuestion): boolean; capabilities?(): string[] }
export interface Drawing { HStack: typeof HStack; truncateToWidth(s: string, width: number): string; wrap?: (s: string, width: number) => string[]; matchesKey?: typeof import("@earendil-works/pi-tui").matchesKey }
type Host = TUI & { mode?: string; layoutRoot?: Component; setLayoutRoot?(c: Component): void; getFocusedComponent?(): Component | null };
type Line = { text: string; key?: string; action?: () => void; role?: "accent" | "warning" | "muted" };
export const WIDE = 112, RAIL = 34;
const labels = { queued: "En cola", running: "En curso", cancelling: "Cancelando", completed: "Terminada", failed: "Fallida", cancelled: "Cancelada" };
// Treat all task labels and session names as untrusted display text, not terminal controls.
export const plain = (s: string) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
const name = (q: PeerQuestion) => plain(q.name) || q.id.slice(0, 8);

/** The narrow sheet borrows focus from the editor; Pi restores it when its own overlay handle closes. */
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
  let selected: string | undefined, detail: TaskRow | undefined, detailPage = 0, capabilitiesFocused = false;
  const toggleCapabilities = () => {
    if (!state.open || detail || !actions.capabilities) return;
    state.capabilitiesExpanded = !state.capabilitiesExpanded;
    capabilitiesFocused = true;
    tui.requestRender();
  };
  let borrowed: Component | null = null, timer: ReturnType<typeof setTimeout> | undefined, frame = 0;
  const release = () => {
    if (borrowed && [rail,widget].includes(tui.getFocusedComponent?.() as Component)) tui.setFocus(borrowed);
    borrowed = null;
  };
  const focusList = () => {
    const from = tui.getFocusedComponent?.();
    if (wantSheet() || !from || typeof (from as {getExpandedText?:unknown}).getExpandedText !== "function") return;
    borrowed = from; tui.setFocus(isDocked() ? rail : widget);
    if (!detail && state.tasks.length) page = Math.floor((state.questions.length + Math.max(0,state.tasks.findIndex(t => t.id===selected))) / pageSize());
    tui.requestRender();
  };
  const inspect = (id: string) => {
    const row = state.tasks.find(t => t.id === id); if (!row) return;
    selected = id; detail = row; detailPage = 0; focusList(); tui.requestRender();
  };
  const back = () => { detail = undefined; detailPage = 0; tui.requestRender(); };
  const pageSize = () => Math.max(1, Math.min(7, Math.floor(tui.terminal.rows / 3) - 2));
  const paged = (lines: Line[], size: number, index: number, change: (n:number) => void): Line[] => {
    const pages = Math.max(1,Math.ceil(lines.length / size)), at = Math.min(index,pages-1);
    return [...lines.slice(at*size,(at+1)*size), ...(pages > 1 ? [{ text:`[Más · ${at+1}/${pages}]`, key:`more:${at}`, action:() => { change((at+1)%pages); tui.requestRender(); } }] : [])];
  };
  function panel(width: number, sheetMode = false): Line[] {
    const title: Line = {text: sheetMode ? "Panel · [Cerrar]" : "Panel · [Cerrar · Alt+A]", key:"toggle", action:actions.toggle, role:"accent"};
    if (detail) {
      const wrap = (s:string) => (draw.wrap?.(s, Math.max(1,width)) ?? [s]).map(text => ({text}));
      const objective = detail.objective.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu," ").replace(/\s+/gu," ").trim();
      const lines = [...wrap(plain(detail.label)), {text:labels[detail.state]}, ...wrap(`Última acción: ${detail.lastAction ? plain(detail.lastAction) : "Sin acción observada"}`), ...wrap(`Objetivo: ${objective}`)];
      const size = Math.max(1, Math.min(tui.terminal.rows-3, isDocked() || sheetMode ? 80 : 8));
      return [title, {text:"← Volver a Subagentes", key:"back", action:back}, ...paged(lines,size,detailPage,n => detailPage=n)];
    }
    const g = state.git;
    let gitRow: Line[] = [];
    if (g) {
      const up = `↑${g.ahead ?? "—"}`, down = `↓${g.behind ?? "—"}`, add = `+${g.added ?? "?"}`, del = `−${g.removed ?? "?"}`;
      const room = Math.max(1, width - (up.length + down.length + add.length + del.length + 6));
      const branch = draw.truncateToWidth(plain(g.branch),room);
      const cyan = theme.appearance === "light" ? {r:0,g:112,b:124} : {r:93,g:210,b:224};
      gitRow = [{ text: `${theme.fg("accent",branch)}  ${theme.style(up,{fg:{kind:"rgb",...cyan}})} ${theme.fg("warning",down)}  ${theme.fg("toolDiffAdded",add)} ${theme.fg("toolDiffRemoved",del)}` }];
    }
    const entries: Line[] = [
      ...state.questions.map(q => ({ text: `${actions.canOpen(q) ? "[Ver pregunta]" : "Ver en origen"} · ${name(q)}`, role: "warning" as const, key: `${q.id}:${q.token}`,
        action: actions.canOpen(q) ? () => actions.question(q) : undefined })),
    ];
    const focus = tui.getFocusedComponent?.(), browsing = focus === sheet || focus === rail || focus === widget;
    if (!state.tasks.some(t => t.id===selected)) selected = state.tasks[0]?.id;
    const onCapabilities = !!actions.capabilities && (capabilitiesFocused || !state.tasks.length);
    const n = state.launched ?? 0;
    const header = {text:`Subagentes · ${n} ${n === 1 ? "lanzado" : "lanzados"}`};
    const taskLines = state.tasks.map(t => {
      const sign = t.state === "running" ? "⠋⠙⠹⠸"[frame%4] : t.state === "queued" ? "◷" : "■ Cancelando";
      return {text:`${browsing && !onCapabilities && selected===t.id ? "› " : ""}${sign} ${plain(t.label)}`, key:t.id, action:() => inspect(t.id)};
    });
    if (state.tasks.some(t=>t.state==="running") && !timer && live && state.open) {
      timer = setTimeout(() => { timer=undefined; if (state.open && live) { frame++; tui.requestRender(); } }, 360); timer.unref();
    }
    const size = pageSize(), combined = [...entries,...taskLines];
    page = Math.min(page,Math.max(0,Math.ceil(combined.length/size)-1));
    const visible = paged(combined,size,page,n => { page=n; selected=state.tasks[Math.max(0,n*size-entries.length)]?.id; });
    const questionCount = Math.min(size,Math.max(0,entries.length-page*size));
    const rows: Line[] = [title, ...gitRow, ...visible.slice(0,questionCount), header, ...visible.slice(questionCount),
      ...(!n && !taskLines.length ? [{text:"Sin tareas activas",role:"muted" as const}] : []),
      ...(state.quota ? quotaLines(state.quota).map(text=>({text})) : [])];
    if (actions.capabilities) {
      const expanded = !!state.capabilitiesExpanded, heading = rows.length;
      rows.push({ text: `${browsing && onCapabilities ? "› " : ""}${expanded ? "▾" : "▸"} Capacidades`, key: "capabilities", action: toggleCapabilities });
      if (expanded) rows.push(...actions.capabilities().map(text => ({ text, role: "muted" as const })));
      // In a very short fullscreen surface, keep the focused section (and the close control) in view.
      const height = tui.terminal.rows;
      if (browsing && onCapabilities && (sheetMode || isDocked()) && height > 1 && rows.length > height) {
        const start = Math.min(heading, rows.length - height + 1);
        return [title, ...rows.slice(start, start + height - 1)];
      }
    }
    return rows;
  }
  function surface(rows: (width: number) => Line[], rail: boolean): Component {
    let painted: Line[] = [], pressed: string | undefined;
    return {
      render(width) {
        painted = rows(rail ? Math.max(0,width-2) : width);
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
        return { handled: true }; // only intentional inspection borrows the editor's focus
      },
    };
  }
  const keyInput = (data:string) => {
    const key = (s: Parameters<NonNullable<Drawing["matchesKey"]>>[1]) => draw.matchesKey?.(data,s);
    if (key("alt+a")) actions.toggle();
    else if (key("alt+c")) toggleCapabilities();
    else if (key("escape") || (detail && key("left"))) { if (detail) back(); else actions.toggle(); }
    else if (key("alt+j") && state.questions[0]) actions.question(state.questions[0]);
    else if (!detail && (key("up") || key("down"))) {
      const count = state.tasks.length;
      const onCapabilities = !!actions.capabilities && (capabilitiesFocused || count === 0);
      const i = onCapabilities ? count : Math.max(0, state.tasks.findIndex(t => t.id === selected));
      const next = Math.max(0, Math.min(actions.capabilities ? count : count - 1, i + (key("down") ? 1 : -1)));
      capabilitiesFocused = !!actions.capabilities && next === count;
      if (!capabilitiesFocused) { selected = state.tasks[next]?.id; page = Math.floor((state.questions.length + next) / pageSize()); }
      tui.requestRender();
    } else if (!detail && key("enter")) {
      if (actions.capabilities && (capabilitiesFocused || !state.tasks.length)) toggleCapabilities();
      else if (selected) inspect(selected);
    } else if (key("pageDown") || key("right")) panel(isDocked()?RAIL-2:tui.terminal.columns,!isDocked()).find(l=>l.key?.startsWith("more:"))?.action?.();
  };
  const rail = surface(panel, true);
  rail.handleInput = keyInput;
  function undock() {
    if (split && tui.layoutRoot === split && previous) tui.setLayoutRoot?.(previous);
    previous = split = undefined;
  }
  const isDocked = () => !!split && tui.layoutRoot === split && tui.terminal.columns >= WIDE;
  const flat = surface(w => panel(w,true),false);
  let overlay: OverlayHandle | undefined, previousFocus: Component | null = null, scheduled = false;
  const sheet: Component = { ...flat,
    render(width) {
      const rows = Math.max(1,tui.terminal.rows), lines = flat.render(width).slice(0,rows);
      while (lines.length < rows) lines.push("");
      return lines;
    },
    handleInput: keyInput,
  };
  const closeSheet = () => { overlay?.hide(); overlay = undefined; previousFocus = null; };
  const wantSheet = () => live && state.open && !isDocked() && (tui.terminal.columns < WIDE || tui.mode === "fullscreen");
  const syncSheet = () => {
    if (!wantSheet()) { closeSheet(); return; }
    release();
    const focus = tui.getFocusedComponent?.();
    if (overlay && focus !== sheet && focus !== previousFocus) closeSheet();
    if (!overlay && focus && typeof (focus as {getExpandedText?:unknown}).getExpandedText === "function") {
      previousFocus = focus;
      overlay = tui.showOverlay(sheet,{anchor:"top-left", width:"100%",maxHeight:"100%",margin:0,
        visible: () => wantSheet() && (tui.getFocusedComponent?.() === previousFocus || tui.getFocusedComponent?.() === sheet)});
    }
  };
  const widget = surface(width => {
    if (state.open && !scheduled && (wantSheet() !== !!overlay || (overlay && tui.getFocusedComponent?.() !== sheet))) {
      scheduled = true; queueMicrotask(() => { scheduled = false; syncSheet(); });
    }
    return state.open && !isDocked() && !wantSheet() ? panel(width) : summary(width);
  }, false);
  widget.handleInput = keyInput;
  return {
    focusList,
    toggleCapabilitiesFromEditor() {
      const from = tui.getFocusedComponent?.();
      if (typeof (from as {getExpandedText?: unknown} | null)?.getExpandedText === "function") toggleCapabilities();
    },
    updateDetail(rows:TaskRow[]) { if (detail) detail = rows.find(t=>t.id===detail!.id) ?? detail; },
    widget, refresh() {
      if (!state.open) { release(); undock(); page = 0; detail=undefined; selected=undefined; capabilitiesFocused = false; clearTimeout(timer); timer=undefined; }
      else if (!split && tui.mode === "fullscreen" && typeof tui.setLayoutRoot === "function" && typeof tui.layoutRoot?.render === "function") {
        // Pi 1.6 exposes the native fullscreen root at runtime, but not in the extension interface.
        // If unavailable, keep the in-place list. Never patch a host method or cover transcript columns.
        previous = tui.layoutRoot;
        const dock: Component = new draw.HStack([{ component: previous, basis: 0, grow: 1, minSize: 1 },
          { component: rail, basis: RAIL, minSize: RAIL, shrink: 0, visible: ({ width }) => live && state.open && tui.layoutRoot === dock && width >= WIDE }], { gap: 1 });
        split = dock; tui.setLayoutRoot(dock);
      }
      syncSheet(); tui.requestRender();
    },
    dispose() { live = false; clearTimeout(timer); closeSheet(); release(); undock(); },
  };
}
