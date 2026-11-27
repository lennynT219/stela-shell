import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HELPER_WAIT_EVENT } from "../../activity-events.ts";
import { GESTURE_ART } from "../mascot-gesture-art.ts";
import { FLOAT_FRAMES, FLOAT_BANDS } from "../mascot-icon.ts";
import { mascotMotion, registerMascotRuns } from "../mascot-motion.ts";

function host() {
  let now = 0;
  const hooks = new Map<string, Function>(), on = (key: string, fn: Function) => hooks.set(key, fn);
  const manager = { getSessionId: () => "chat" }, ctx = { mode: "tui", sessionManager: manager };
  const state = registerMascotRuns({ on, events: { on } } as any, () => {}, () => now);
  const motion = mascotMotion(() => now);
  return { manager, motion, emit: (key: string, data = {}) => hooks.get(key)?.(data, ctx),
    frame: (t: number, question = false) => { now = t; return motion.frame(state, question); } };
}

test("working rocks through center in both directions, never spins; turns, redraws and draft edits don't restart it", () => {
  const h = host(); h.emit("agent_start");
  const observed = []; let t = 0;
  while (t < 2400) {
    const f = h.frame(t); observed.push(f.pose);
    assert.ok(f.next !== undefined && f.next > t && f.next <= 2400);
    assert.deepEqual(h.frame(f.next - 1), f);
    if (f.pose === "work8") {
      h.motion.draft(true, true); h.emit("tool_execution_end", { toolName: "read", isError: false });
      h.emit("turn_start"); h.emit("agent_start");
      assert.deepEqual(h.frame(f.next-1), f); h.motion.draft(false, true);
    }
    t = f.next;
  }
  assert.equal(t, 2400);
  assert.deepEqual(observed, [2,"work3","work6","work8","work6","work3",2,"work-3","work-6","work-8","work-6","work-3"]);
  assert.equal(h.frame(t).pose, 2); assert.equal(h.frame(24_000 + 600).pose, "work8", "missed frames don't replay");
});

test("active work needs no tool; a question or a real helper wait takes precedence, then work resumes from center", () => {
  const h = host(); assert.equal(h.frame(0).pose,"sleep"); h.motion.draft(true,true);
  assert.equal(h.frame(10).pose,"opening"); h.emit("agent_start"); assert.equal(h.frame(20).pose,2);
  assert.equal(h.frame(620).pose,"work8");
  const span = { manager:h.manager, id:"chat", span:Symbol() };
  h.emit(HELPER_WAIT_EVENT,{...span,waiting:true}); assert.equal(h.frame(625).pose,"float-watch-left-mid");
  assert.equal(h.frame(630,true).pose,"lean"); assert.deepEqual(h.frame(1300,true),{pose:"alert"});
  assert.match(String(h.frame(1350).pose),/^float-watch/); h.emit(HELPER_WAIT_EVENT,{...span,waiting:false});
  assert.equal(h.frame(1360).pose,2); assert.equal(h.frame(1960).pose,"work8");
  h.emit("turn_end",{outcome:"completed",message:{role:"assistant",stopReason:"stop"},toolResults:[]});
  h.emit("agent_settled",{aborted:false}); assert.equal(typeof h.frame(1961).pose,"number","plain chat returns to the draft without celebrating");
  h.motion.draft(false,true); assert.equal(h.frame(1962).pose,"sleep");
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi paints both working extremes in fullscreen and regular mode, without moving the draft or footer", {
  skip: !cli || process.platform !== "linux", timeout: 45_000,
}, async () => {
  const poses: Record<string,string> = {};
  const add = (tag: string, png: string, strips: readonly string[]) => {
    for (const payload of [png, strips.join("\n")]) poses[createHash("sha256").update(payload).digest("hex")] = tag;
  };
  for (const [tag, [png,...strips]] of Object.entries(GESTURE_ART)) add(tag, png, strips);
  FLOAT_FRAMES.forEach((png,i) => add(`float${i}`, png, FLOAT_BANDS[i]));
  const { stdout } = await promisify(execFile)("python3", ["-B",fileURLToPath(new URL("./fixtures/mascot-work.py", import.meta.url)),process.execPath,cli!], {
    env:{...process.env, SS_TEST_WORK_POSES:JSON.stringify(poses)}, timeout:40_000, maxBuffer:512*1024,
  });
  assert.match(stdout,/Working crown verified in both layouts/);
});
