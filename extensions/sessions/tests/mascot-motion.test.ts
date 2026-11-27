import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { TASKS_EVENT } from "../../activity-events.ts";
import { GESTURE_ART, SPIN_STEPS } from "../mascot-gesture-art.ts";
import { mascotMotion, registerMascotRuns } from "../mascot-motion.ts";

function host() {
  let now = 0;
  const handlers = new Map<string, Function>();
  const on = (name: string, callback: Function) => handlers.set(name, callback);
  const manager = { getSessionId: () => "chat" }, ctx = { mode: "tui", sessionManager: manager };
  const state = registerMascotRuns({ on, events: { on } } as any, () => {}, () => now);
  const motion = mascotMotion(() => now);
  const emit = (name: string, value: any = {}) => handlers.get(name)?.(value, ctx);
  const turn = (stopReason = "stop", results: any[] = []) => emit("turn_end", {
    outcome: stopReason === "error" ? "error" : "completed", message: { role: "assistant", stopReason }, toolResults: results,
  });
  const tool = (name: string, error = false, extra: any = {}) => emit("tool_execution_end", { toolName: name, toolCallId: name, isError: error, ...extra });
  return { manager, state, motion, emit, turn, tool, frame: (t: number, notice = false) => { now = t; return motion.frame(state, notice); } };
}

test("sleep, first draft input, quiet working float, one attention lean then a still attentive pose", () => {
  const h = host(), pose = (t: number, notice = false) => h.frame(t, notice).pose;
  assert.equal(pose(0), "sleep"); assert.equal(pose(1500), "breathe");
  h.motion.draft(false, true); assert.equal(pose(1501), "breathe", "a key without draft input does not wake Stela");
  h.motion.draft(true, true); assert.equal(pose(1501), "opening");
  h.motion.draft(true, true); assert.equal(pose(1620), "lift"); assert.equal(typeof pose(1880), "number");
  h.motion.draft(false, true); assert.equal(pose(1900), "sleep");
  h.motion.draft(true, false); assert.equal(typeof pose(1901), "number", "restoring a draft is not a first key");
  h.emit("agent_start"); h.motion.draft(false, false); assert.equal(typeof pose(2100), "number");
  assert.equal(pose(2200, true), "lean"); assert.equal(pose(2390, true), "look");
  assert.deepEqual(h.frame(3000, true), { pose: "alert" }); assert.deepEqual(h.frame(10_000, true), { pose: "alert" });
  h.emit("ui_prompt_start", { kind: "confirm" }); assert.deepEqual(h.frame(11_000), { pose: "alert" });
  h.emit("ui_prompt_end"); assert.equal(typeof pose(11_001), "number"); h.emit("agent_settled", { aborted: true });
  assert.equal(pose(11_002), "sleep");
});

test("one 800 ms spin at successful settlement, not at a tool, a final-looking turn, a retry or a repeated settled event", () => {
  const h = host(); h.emit("agent_start"); h.tool("read"); h.turn("toolUse", [{ isError: false }]); h.turn();
  h.emit("agent_end"); assert.equal(typeof h.frame(1000).pose, "number"); h.emit("agent_before_settle");
  h.emit("agent_start"); h.emit("turn_start"); h.turn("error"); h.emit("agent_start"); h.emit("turn_start"); h.turn();
  h.frame(2200); h.emit("agent_settled", { aborted: false }); assert.equal(h.state.readyAt, 2200);
  assert.equal(h.frame(2200).pose, "spin-4"); assert.equal(h.frame(2250).pose, "spin-9");
  h.emit("agent_settled", { aborted: false }); assert.equal(h.state.readyAt, 2200);
  const observed = []; let t = 2200;
  while (t < 3000) { const f = h.frame(t); observed.push(f.pose); assert.ok(f.next! > t); t = f.next!; }
  assert.equal(t, 3000); assert.deepEqual(observed, SPIN_STEPS.map(([p]) => p));
  assert.equal(h.frame(3000).pose, "sleep"); assert.equal(h.frame(30_000).pose, "sleep");
  const angles = observed.slice(0, -1).map(p => Number(String(p).slice(4)));
  assert.ok(angles[1] < angles[0] && angles[0] < 0 && angles.slice(1).every((v,i,a) => i === 0 || v > a[i-1]));
  assert.ok(angles.at(-1)! > 350 && angles.at(-1)! < 360); assert.equal(observed.at(-1), 2, "the last pose is the original, upright PNG");
  for (const items of Object.values(GESTURE_ART)) {
    assert.deepEqual(items.map(s => { const b = Buffer.from(s, "base64"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }), [[144,144], ...Array(4).fill([144,36])]);
  }
});

test("no spin on conversation, blocked/failed tools, truncation, abort, partial helpers or delivery receipts", () => {
  for (const scenario of ["chat", "nested failure", "adjusted error", "length", "error", "abort", "only ACK", "pending helper", "failed helper", "cancelled helper", "wrong chat", "tree", "shutdown"]) {
    const h = host(); h.emit("agent_start"); h.emit("turn_start");
    if (scenario.includes("helper") || scenario === "wrong chat") {
      h.tool("ss_tasks_delegate", false, { result: { details: { taskId: "a", state: "queued" } } });
      h.emit(TASKS_EVENT, { manager: h.manager, id: scenario === "wrong chat" ? "other" : "chat", tasks: [{ id: "a", state: scenario.split(" ")[0] === "pending" ? "running" : scenario === "wrong chat" ? "completed" : scenario.split(" ")[0] }] });
    } else if (scenario === "only ACK" || scenario === "nested failure") {
      h.tool(scenario === "only ACK" ? "ss_sessions_send" : "read", scenario === "nested failure", { parentToolCallId: "codemode" }); h.tool("codemode");
    } else if (scenario !== "chat") h.tool("read");
    if (scenario === "adjusted error") h.turn("toolUse", [{ isError: true }]);
    h.turn(["error","length"].includes(scenario) ? scenario : "stop");
    if (scenario === "tree" || scenario === "shutdown") h.emit("session_" + scenario);
    h.emit("agent_settled", { aborted: scenario === "abort" }); assert.equal(h.state.readyAt, undefined, scenario);
  }
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("offline Pi renders first-key wake, a peer question and one spin after the full tool run, not on failure or abort", {
  skip: !cli || process.platform !== "linux", timeout: 55_000,
}, async () => {
  const { stdout } = await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/mascot-motion.py", import.meta.url)), process.execPath, cli!], { timeout: 50_000, maxBuffer: 512 * 1024 });
  assert.match(stdout, /Verified live mascot gestures/);
});
