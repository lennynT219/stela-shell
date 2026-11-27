import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HELPER_WAIT_EVENT, TASKS_EVENT, type HelperWaitSignal, type TaskSignal } from "../activity-events.ts";
import { SPIN_STEPS, WORK_STEPS } from "./mascot-gesture-art.ts";

export type Pose = number | string;
type Steps = readonly (readonly [Pose, number])[];
const FLOAT: Steps = [
  [2,200], [1,260], [0,520], [1,260], [2,200], [3,260], [4,520], [3,260],
  [2,200], [1,260], [0,520], [1,260], [2,200], [3,260], [4,180], [5,140], [4,200], [3,260],
];
const SLEEP: Steps = [["sleep", 1450], ["breathe", 1050]];
const WAKE: Steps = [["opening", 100], ["lift", 160], [2, 70]];
// Same quiet float family, but with open eyes towards the task notice and only two HD pixels of travel each way.
const watch = (side: "left" | "right"): Steps => [
  [`float-watch-${side}-mid`, 720], [`float-watch-${side}-up`, 1180],
  [`float-watch-${side}-mid`, 720], [`float-watch-${side}-down`, 1180],
];
const WATCH = { left: watch("left"), right: watch("right") };
const ATTENTION: Steps = [["lean", 130], ["look", 260], ["lean", 140]];
type Frame = { pose: Pose; next?: number };

// Absolute frame boundaries: an unrelated redraw doesn't advance a gesture, and coming
// back from a hidden screen never replays a celebration that has already ended.
function sequence(steps: Steps, start: number, now: number, loop = false): Frame | undefined {
  const duration = steps.reduce((ms, [, hold]) => ms + hold, 0);
  if (loop) start += Math.floor((now - start) / duration) * duration;
  for (const [pose, hold] of steps) {
    start += hold;
    if (now < start) return { pose, next: start };
  }
}

export interface RunAppearance { working: boolean; waiting: boolean; helperWait?: { span: symbol; since: number }; readyAt?: number }

/** The editor observes draft presence, not its contents. No events, keystrokes or frames are persisted. */
export function mascotMotion(clock = () => performance.now()) {
  let draft = false, working = false, waiting = false, wakeAt: number | undefined;
  let ambientAt = clock(), noticeAt = ambientAt, workAt: number | undefined;
  return {
    draft(present: boolean, fromInput: boolean) {
      if (draft === present) return;
      draft = present; ambientAt = clock();
      wakeAt = draft && fromInput && !working && !waiting ? ambientAt : undefined;
    },
    frame(run: RunAppearance, peerNeedsAnswer: boolean, tasksOnRight = false): Frame {
      const now = clock(), attention = run.waiting || peerNeedsAnswer;
      if (run.working !== working) { working = run.working; ambientAt = now; if (working) wakeAt = undefined; }
      if (attention !== waiting) { waiting = attention; noticeAt = ambientAt = now; wakeAt = undefined; }
      if (!working || waiting || run.helperWait) workAt = undefined;
      if (waiting) return sequence(ATTENTION, noticeAt, now) ?? { pose: "alert" };
      if (working && run.helperWait) return sequence(WATCH[tasksOnRight ? "right" : "left"], run.helperWait.since, now, true)!;
      const ready = run.readyAt === undefined ? undefined : sequence(SPIN_STEPS, run.readyAt, now);
      if (ready) return ready;
      // The work rhythm belongs to the visible run, not to keystrokes, individual tools or model turns.
      if (working) return sequence(WORK_STEPS, workAt ??= now, now, true)!;
      const waking = wakeAt === undefined ? undefined : sequence(WAKE, wakeAt, now);
      return waking ?? sequence(draft ? FLOAT : SLEEP, ambientAt, now, true)!;
    },
  };
}

/** A run may contain many agent loops, turns and nested tools. Observe its technical
 * outcome only; never infer intent/success from generated prose, history or a receipt. */
export function registerMascotRuns(pi: ExtensionAPI, redraw: () => void, clock = () => performance.now()): RunAppearance {
  const state: RunAppearance = { working: false, waiting: false };
  let run: { manager: ExtensionContext["sessionManager"]; id: string; used: boolean; failed: boolean; final: boolean;
    helpers: Set<string>; wrappers: Set<string> } | undefined;
  const current = (ctx: ExtensionContext) => run && run.manager === ctx.sessionManager && run.id === ctx.sessionManager.getSessionId() ? run : undefined;
  const reset = () => { run = undefined; state.working = state.waiting = false; state.readyAt = undefined; state.helperWait = undefined; };
  pi.on("session_start", reset); pi.on("session_shutdown", reset); pi.on("session_tree", () => { reset(); redraw(); });
  pi.on("agent_start", (_e, ctx) => {
    if (ctx.mode !== "tui" || current(ctx)) return; // A retry or automatic continuation isn't a new job.
    reset(); run = { manager: ctx.sessionManager, id: ctx.sessionManager.getSessionId(), used: false, failed: false, final: false, helpers: new Set(), wrappers: new Set() };
    state.working = true; redraw();
  });
  pi.on("turn_start", (_e, ctx) => {
    const r = current(ctx); if (!r) return;
    r.final = false;
    if (state.helperWait) { state.helperWait = undefined; redraw(); }
  });
  pi.events.on(HELPER_WAIT_EVENT, (data: unknown) => {
    const e = data as HelperWaitSignal;
    if (!run || e?.manager !== run.manager || e.id !== run.id || typeof e.span !== "symbol") return;
    if (e.waiting === true && e.span !== state.helperWait?.span) state.helperWait = { span: e.span, since: clock() };
    else if (e.waiting === false && e.span === state.helperWait?.span) state.helperWait = undefined;
    else return; // An old await cannot withdraw a new one, even in the same session.
    redraw();
  });
  pi.on("tool_execution_end", (e, ctx) => {
    const r = current(ctx); if (!r) return;
    if (e.parentToolCallId) r.wrappers.add(e.parentToolCallId);
    const wrapper = r.wrappers.delete(e.toolCallId);
    if (e.isError || e.result?.isError) { r.failed = true; return; }
    if (e.toolName === "ss_tasks_delegate") {
      const d = e.result?.details;
      if (typeof d?.taskId !== "string" || d.state === "failed" || d.state === "cancelled") r.failed = true;
      else if (d.state === "completed") r.used = true;
      else r.helpers.add(d.taskId); // Admission is not the helper's result.
    } else if (e.toolName === "ss_tasks_cancel") {
      if (e.result?.details?.requested) r.failed = true;
    } else if (!wrapper && e.toolName !== "ss_sessions_send") r.used = true; // A delivery ACK isn't a result from the peer.
  });
  pi.events.on(TASKS_EVENT, (data: unknown) => {
    const e = data as TaskSignal;
    if (!run?.helpers.size || e?.manager !== run.manager || e.id !== run.id || !Array.isArray(e.tasks)) return;
    for (const task of e.tasks) if (task && run.helpers.has(task.id)) {
      if (task.state === "completed") { run.helpers.delete(task.id); run.used = true; }
      else if (task.state === "failed" || task.state === "cancelled") run.failed = true;
    }
  });
  pi.on("turn_end", (e, ctx) => {
    const r = current(ctx); if (!r) return;
    if (e.toolResults.some(result => result.isError)) r.failed = true;
    r.final = e.outcome === "completed" && e.message.role === "assistant" && e.message.stopReason === "stop" && !e.toolResults.length;
  });
  pi.on("ui_prompt_start", (e, ctx) => {
    if (current(ctx) && e.kind !== "custom") { state.waiting = true; redraw(); }
  });
  pi.on("ui_prompt_end", (_e, ctx) => { if (current(ctx) && state.waiting) { state.waiting = false; redraw(); } });
  pi.on("agent_settled", (e, ctx) => {
    const r = current(ctx); if (!r) return;
    reset(); // Consume once, before publishing or drawing anything.
    if (!e.aborted && r.used && !r.failed && !r.helpers.size && r.final) state.readyAt = clock();
    redraw();
  });
  return state;
}
