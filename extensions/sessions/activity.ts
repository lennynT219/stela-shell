import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { activeState, REQUEST_TASKS, TASKS_EVENT, type TaskSignal } from "../activity-events.ts";
import { readCodexQuota } from "./codex-quota.ts";
import { watchGit } from "./git-summary.ts";
import { activityView, type Drawing, type ViewState } from "./activity-view.ts";
import { herdrRoute, watchQuestions, type AttentionTransport, type PeerQuestion } from "./attention.ts";
import type { SessionTransport } from "./protocol.ts";

const exec = promisify(execFile);
const widgetKey = "ss-activity";

/** Pi 1.6 TuiBase exposes its current focus; the smaller extension TUI interface does not require it.
 * No text/keystrokes are inspected. An unknown host or generic custom view is never a question. */
function focusedDialog(tui: TUI | undefined, isNativeDialog: (c: Component) => boolean): Component | null {
  const component = (tui as (TUI & { getFocusedComponent?(): Component | null }) | undefined)?.getFocusedComponent?.();
  return component && isNativeDialog(component) ? component : null;
}

/** Check the exact foreground process and its *current* blocked status before handing the keyboard to Herdr. */
export function matchesTarget(q: PeerQuestion, data: unknown): boolean {
  const t = data as { address?: string; state?: string; foreground?: { pid: number }; status?: { state: string; app?: string; kind?: string } } | null;
  return !!q.route && !!t && t.address === q.route.address && t.state === "live" && t.foreground?.pid === q.route.pid &&
    t.status?.app === "pi" && t.status.state === "blocked" && (t.status.kind === "permission" || t.status.kind === "question");
}
function coreEnvironment() {
  const searchPath = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute);
  if (!searchPath.length || !process.env.HC_TERMINAL_SOCKET) throw new Error("No local Herdr route");
  return { ...process.env, HC_SOCKET: process.env.HC_TERMINAL_SOCKET, PATH: searchPath.join(delimiter) };
}
async function checkTerminal(q: PeerQuestion, signal: AbortSignal): Promise<boolean> {
  const { stdout } = await exec("hc", ["get", q.route!.address, "--json"], { signal, env: coreEnvironment(), timeout: 1500, maxBuffer: 256 * 1024, windowsHide: true });
  return matchesTarget(q, JSON.parse(stdout)); // metadata only, never `hc read` or the user's keystrokes
}
async function attach(tui: TUI, address: string, signal: AbortSignal) {
  signal.throwIfAborted();
  tui.stop();
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("hc", ["attach", "--history", "0", address], { stdio: "inherit", env: coreEnvironment(), signal, shell: false });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Herdr attach ended")));
    });
  } finally { if (!signal.aborted) { tui.start(); tui.requestRender(true); } }
}
export function registerActivity(pi: ExtensionAPI, drawing: Drawing, isNativeDialog: (c: Component) => boolean, dependencies = { route: herdrRoute, check: checkTerminal, attach }, readQuota = readCodexQuota) {
  let owner: ExtensionContext | undefined, session = "", host: TUI | undefined;
  let view: ReturnType<typeof activityView> | undefined, watching: ReturnType<typeof watchQuestions> | undefined;
  let lifetime = new AbortController(), jumping = false;
  const state: ViewState = { open: false, tasks: [], questions: [] };
  const owns = (ctx: ExtensionContext) => ctx.mode === "tui" && owner?.sessionManager === ctx.sessionManager && session === ctx.sessionManager.getSessionId();
  let stopGit: (() => void) | undefined;
  const clearGit = () => { stopGit?.(); stopGit = undefined; state.git = undefined; };
  let quotaRequest: AbortController | undefined;
  const clearQuota = () => { quotaRequest?.abort(); quotaRequest = undefined; state.quota = undefined; };
  const loadQuota = () => {
    const request = quotaRequest = new AbortController();
    state.quota = {state:"loading"};
    void readQuota(request.signal).then(q => {
      if (request !== quotaRequest) return;
      state.quota = q; host?.requestRender();
    });
  };
  const toggle = (keyboard = false) => {
    if (!view || !owner) return;
    clearGit(); clearQuota(); state.open = !state.open;
    if (state.open) loadQuota();
    view.refresh();
    if (state.open && keyboard && state.tasks.length) view.focusList();
    if (state.open) stopGit = watchGit(owner.cwd, row => { state.git = row; host?.requestRender(); });
  };
  let displayRoute: ReturnType<typeof herdrRoute> = null;
  const canOpen = (q: PeerQuestion, r = displayRoute) => !!r && !!q.route && q.route.core === r.core && q.route.address !== r.address;
  const question = async (q?: PeerQuestion) => {
    const source = watching, ui = owner?.ui, tui = host, signal = lifetime.signal;
    if (!q || !source || !tui || !ui || jumping || signal.aborted) return;
    const same = () => !signal.aborted && source === watching && state.questions.some(p => p.id === q.id && p.token === q.token);
    if (!canOpen(q, dependencies.route())) { ui.notify("Consulta la pregunta en la terminal de origen; no hay una ruta local compatible.", "info"); return; }
    jumping = true;
    try {
      if (!same() || !await dependencies.check(q, signal) || !await source.current(q) || !same() || !canOpen(q, dependencies.route())) throw new Error("No current route");
      await dependencies.attach(tui, q.route!.address, signal);
    } catch { if (!signal.aborted) ui.notify("No se pudo verificar o abrir la terminal de esa pregunta. No se envió ninguna respuesta.", "warning"); }
    finally { if (lifetime.signal === signal) jumping = false; }
  };
  const stopPeers = () => { const old = watching; watching = undefined; old?.close(); };
  const stop = () => {
    lifetime.abort(); stopPeers(); clearGit(); clearQuota(); view?.dispose();
    owner?.ui.setWidget(widgetKey, undefined); owner = undefined; host = view = undefined;
    state.open = false; state.tasks = []; state.launched = 0; state.questions = []; jumping = false; session = "";
  };
  const start = (_event: unknown, ctx: ExtensionContext) => {
    stop(); if (ctx.mode !== "tui") return;
    owner = ctx; session = ctx.sessionManager.getSessionId(); lifetime = new AbortController(); displayRoute = dependencies.route();
    ctx.ui.setWidget(widgetKey, (tui, theme) => {
      view?.dispose(); host = tui; view = activityView(tui, theme, drawing, state, { toggle, question, canOpen });
      if (state.open) view.refresh();
      const widget = view.widget;
      return { ...widget, render(width) { watching?.sync(); return widget.render(width); } };
    });
    pi.events.emit(REQUEST_TASKS, undefined);
  };
  pi.events.on(TASKS_EVENT, (data: unknown) => {
    const e = data as TaskSignal;
    if (!e || !owner || e.manager !== owner.sessionManager || e.id !== session || !Array.isArray(e.tasks) || typeof e.claim !== "function") return;
    if (!Number.isSafeInteger(e.launched) || e.launched < 0) return;
    const rows = e.tasks.filter(t => t && typeof t.id === "string" && typeof t.label === "string" && typeof t.objective === "string" &&
      (t.lastAction === undefined || typeof t.lastAction === "string") && (activeState(t.state) || ["completed","failed","cancelled"].includes(t.state)));
    state.launched = e.launched;
    state.tasks = rows.filter(t => activeState(t.state)).slice(0, 8);
    view?.updateDetail(rows);
    e.claim(); view?.refresh();
  });
  pi.on("session_start", start); pi.on("session_tree", start); pi.on("session_shutdown", stop);
  pi.registerCommand("ss-activity", { description: "Abrir o cerrar el Panel de Git, actividad y preguntas.", handler: async (_args, ctx) => { if (owns(ctx)) toggle(); } });
  pi.registerShortcut("alt+a", { description: "Abrir/cerrar actividad", handler: async ctx => { if (owns(ctx)) toggle(true); } });
  pi.registerShortcut("alt+j", { description: "Ver la pregunta pendiente en la sesión de origen", handler: async ctx => { if (owns(ctx)) await question(state.questions[0]); } });
  return {
    toggle,
    active: (ctx: ExtensionContext) => owns(ctx) && !!view,
    bind(ctx: ExtensionContext, transport: SessionTransport) {
      stopPeers(); if (!owns(ctx) || !transport.questionFor) return;
      watching = watchQuestions(transport as AttentionTransport, qs => { state.questions = qs; view?.refresh(); },
        dependencies.route, () => focusedDialog(host, isNativeDialog));
    },
    unbind: stopPeers,
  };
}
