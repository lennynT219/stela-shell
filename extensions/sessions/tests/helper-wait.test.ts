import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HELPER_WAIT_EVENT, TASKS_EVENT, type HelperWaitSignal } from "../../activity-events.ts";
import { registerSubagents } from "../../subagents/index.ts";
import type { RunResult } from "../../subagents/runner.ts";
import { mascotMotion, registerMascotRuns } from "../mascot-motion.ts";
import { GESTURE_ART } from "../mascot-gesture-art.ts";
import { FLOAT_FRAMES, FLOAT_BANDS } from "../mascot-icon.ts";

test("helper gaze belongs only to the live wait; attention wins and a stale wait cannot clear the new one", () => {
  const hooks = new Map<string, Function>(), on = (name: string, h: Function) => hooks.set(name, h);
  let now = 0;
  const manager = { getSessionId: () => "A" }, ctx = { sessionManager: manager, mode: "tui" };
  const state = registerMascotRuns({ on, events: { on } } as any, () => {}, () => now);
  const motion = mascotMotion(() => now);
  const emit = (name: string, data: any = {}) => hooks.get(name)?.(data, ctx);
  const span = Symbol(), notify = (waiting: boolean, token = span, other = {}) => emit(HELPER_WAIT_EVENT, { manager, id: "A", span: token, waiting, ...other });
  const frame = (t: number, right = false, question = false) => { now = t; return motion.frame(state, question, right); };
  notify(true); assert.equal(frame(0).pose, "sleep");
  emit("agent_start"); emit(TASKS_EVENT, { manager, id: "A", tasks: [{ id: "helper", state: "running" }] });
  notify(true, span, { manager: {} }); notify(true, span, { id: "B" });
  assert.equal(typeof frame(100).pose, "number", "a parallel helper or a foreign wait isn't this wait");
  notify(true); assert.deepEqual(frame(100), { pose: "float-watch-left-mid", next: 820 });
  notify(true); assert.deepEqual(frame(820, true), { pose: "float-watch-right-up", next: 2000 });
  assert.equal(frame(2000, false, true).pose, "lean"); assert.deepEqual(frame(2710, false, true), { pose: "alert" });
  assert.equal(frame(2720).pose, "float-watch-left-down", "return to the same wait when the question closes");
  const second = Symbol(); notify(true, second); notify(false);
  assert.equal(frame(2721).pose, "float-watch-left-mid");
  notify(false, second, { id: "B" }); assert.equal(state.helperWait?.span, second);
  notify(false, second); assert.equal(typeof frame(2722).pose, "number");
  for (const [boundary, awake] of [["turn_start", true], ["session_tree", false], ["agent_settled", false], ["session_shutdown", false]] as const) {
    emit("agent_start"); notify(true); emit(boundary, { aborted: true });
    assert.equal(state.helperWait, undefined, boundary); assert.equal(state.working, awake);
  }
});

test("the owned queue bounds the display span even on abort or navigation; optional UI can't affect delivery", async () => {
  for (const end of ["completed", "aborted", "navigation"] as const) {
    const marks: HelperWaitSignal[] = [], hooks = new Map<string, Function>();
    const ctl = new AbortController(), manager = { getSessionId: () => "one", getBranch: () => [] };
    const ctx = { mode: "tui", hasUI: true, sessionManager: manager, model: {provider:"test",id:"fixture"},
      signal: ctl.signal, cwd: process.cwd(), isProjectTrusted: () => false, ui: { setWidget() {} } };
    let delegate!: Function, finish!: () => void, running!: () => void;
    const started = new Promise<void>(resolve => { running = resolve; });
    const pi = { registerTool: (t: any) => { if (t.name === "ss_tasks_delegate") delegate = t.execute; },
      on: (name: string, fn: Function) => hooks.set(name,fn), registerFlag() {}, getFlag() { return "1"; },
      registerCommand() {}, appendEntry() {}, getActiveTools: () => ["read"],
      getAllTools: () => [{name:"read",sourceInfo:{source:"builtin",path:"builtin:read"}}], events: { on() {}, emit(name:string, data:any) {
        if (name === TASKS_EVENT) data.claim();
        if (name === HELPER_WAIT_EVENT) { marks.push(data); throw new Error("fixture renderer unavailable"); }
      } },
    };
    registerSubagents(pi as any, { env:{}, launch:() => ({command:"unused",prefix:[],resourceArgs:[]}), run:({ signal }) => new Promise<RunResult>(resolve => {
      finish = () => resolve({status:signal.aborted ? "cancelled" : "completed",output:"fixture evidence",error:"",diagnostics:"",trace:[],truncated:false});
      signal.addEventListener("abort", finish, {once:true}); running();
    }) });
    const emit = (name:string, event = {}) => hooks.get(name)!(event,ctx);
    await emit("session_start"); await delegate("fixture", {label:"evidence",objective:"read",references:[import.meta.filename],done_when:"done"}, undefined, undefined, ctx);
    await started; assert.equal(marks.length,0, "neither admission nor an executing helper is itself a parent wait");
    const wait = emit("agent_before_settle", {entries:[],outcome:"completed"});
    assert.deepEqual(marks.map(m => m.waiting), [true]);
    if (end === "aborted") ctl.abort();
    if (end === "navigation") { const switchBranch = emit("session_tree"); assert.equal(marks.at(-1)?.waiting,false); await switchBranch; }
    if (end !== "completed") assert.equal(marks.at(-1)?.waiting,false,"withdraw immediately on observed abort or invalidation");
    finish(); const result = await wait;
    assert.deepEqual(marks.map(m => m.waiting), [true,false]); assert.equal(marks[0].span,marks[1].span);
    assert.equal(marks[0].manager,manager); assert.deepEqual(Object.keys(marks[0]).sort(),["id","manager","span","waiting"]);
    if (end === "completed") { assert.equal(result.entries.length,1); assert.equal(result.continue,true); }
    else assert.equal(result,undefined);
    await emit("agent_before_settle", {entries:[],outcome:"completed"}); assert.equal(marks.length,2,"no wait for an idle queue");
    await emit("session_shutdown");
  }
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi: helper in parallel vs actual wait, gaze follows the Panel and yields to a real question", {
  skip: !cli || process.platform !== "linux", timeout: 55_000,
}, async () => {
  // Compare PNG payloads from Pi's screen, never filenames, synthetic render calls, or guessed Kitty image IDs.
  const tags: Record<string, string> = {};
  function tag(name: string, whole: string, bands: readonly string[]) {
    for (const payload of [whole, bands.join("\n")]) tags[createHash("sha256").update(payload).digest("hex")] = name;
  }
  FLOAT_FRAMES.forEach((png, i) => tag("normal", png, FLOAT_BANDS[i]));
  for (const [name, [png, ...bands]] of Object.entries(GESTURE_ART)) tag(name, png, bands);
  const { stdout } = await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/helper-wait.py", import.meta.url)), process.execPath, cli!], {
    env: { ...process.env, SS_TEST_POSE_TAGS: JSON.stringify(tags) }, timeout: 50_000, maxBuffer: 512 * 1024,
  });
  assert.match(stdout, /Verified helper wait in both layouts/);
});
