import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { TaskQueue, DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, concurrencyLimit, validateAssignment, type Assignment } from "../tasks.ts";
import { CHILD_MARKER, CHILD_SCOPE, READY_ENTRY, BLOCKED_ENTRY, RESULT_BYTES, boundedText, childArguments, makeScope, pathInScope, resolveLaunch, runChild, type RunOptions, type RunResult } from "../runner.ts";
import { registerSubagents, formatResult } from "../index.ts";
import faroMethod from "../../method/index.ts";

const fixture = fileURLToPath(new URL("./fixtures/pi-child.mjs", import.meta.url));
const assignment: Assignment = { label: "Contract evidence", objective: "Find the contract", references: [fixture], context: "Known facts", constraints: ["Read only"], done_when: "Return evidence and limitations" };
const success: RunResult = { status: "completed", output: "Outcome: answered\nAnswer: yes\nEvidence: source.ts:1\nLimitations: not executed", diagnostics: "", trace: ["read source.ts"], truncated: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function options(scenario = "success", overrides: Partial<RunOptions> = {}): RunOptions {
  return { assignment, cwd: process.cwd(), model: "fixture/model", thinking: "off", scope: makeScope([fixture], process.cwd(), ["read"]), launch: { command: process.execPath, prefix: [fixture, scenario], resourceArgs: [] }, trusted: false, signal: new AbortController().signal, timeoutMs: 5000, killGraceMs: 50, ...overrides };
}
function harness() {
  const hooks = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const flags = new Map<string, any>();
  const commands = new Map<string, any>();
  const entries: any[] = [];
  const branch: any[] = [];
  const notifications: string[] = [];
  const widgets: any[] = [];
  const available = ["read", "grep", "find", "ls", "bash", "write", "edit"].map((name) => ({ name, sourceInfo: { source: "builtin", path: `builtin:${name}` } }));
  let active = ["read", "grep", "find", "ls", "bash", "write", "edit"];
  const pi: any = {
    on(name: string, fn: Function) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerFlag(name: string, definition: any) { flags.set(name, definition.default); },
    getFlag(name: string) { return flags.get(name); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    getAllTools() { return available; },
    getActiveTools() { return active; },
    setActiveTools(names: string[]) { active = names; },
    appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
  };
  const controller = new AbortController();
  const ctx: any = {
    cwd: process.cwd(), model: { provider: "fixture", id: "model" }, thinkingLevel: "medium", mode: "tui", hasUI: true,
    sessionManager: { getSessionId: () => "parent", getBranch: () => branch },
    isProjectTrusted: () => false,
    signal: controller.signal,
    abort: async () => { controller.abort(); },
    ui: { setWidget: (...args: any[]) => widgets.push(args), notify: (text: string) => notifications.push(text) },
  };
  const emit = async (name: string, event: any = {}, context = ctx) => {
    let output: any;
    for (const fn of hooks.get(name) ?? []) {
      const result = await fn(output ? { ...event, ...output } : event, context);
      if (result !== undefined) output = result;
    }
    if (output?.entries) branch.push(...output.entries);
    return output;
  };
  return { pi, ctx, hooks, tools, flags, commands, entries, branch, widgets, notifications, available, emit, controller };
}
const fakeLaunch = () => ({ command: "unused", prefix: [], resourceArgs: [] });

test("FARO delegation instructions reach the parent tool and bounded helper role", async () => {
  const h = harness();
  faroMethod(h.pi);
  registerSubagents(h.pi, { env: {} });
  const base = "Existing host permissions and instructions.";
  const method = readFileSync(new URL("../../method/assets/method.md", import.meta.url), "utf8").trim();
  const event = { systemPrompt: base };
  const injected = await h.emit("before_agent_start", event);
  assert.equal(injected.systemPrompt, `${base}\n\n${method}`);
  assert.equal(event.systemPrompt, base);
  assert.match(injected.systemPrompt, /without waiting for the user to request subagents/);
  assert.match(injected.systemPrompt, /When `stela_delegate` is available/);

  const delegate = h.tools.get("stela_delegate");
  assert.equal(delegate.exposure, "model-only");
  const guidelines = delegate.promptGuidelines.join("\n");
  assert.match(guidelines, /Follow FARO's proportional delegation policy/);
  assert.match(injected.systemPrompt, /Resolve small, understood work directly/);
  assert.match(injected.systemPrompt, /one coherent objective/);
  assert.match(injected.systemPrompt, /not into a child per file or a fixed workflow/);
  assert.match(guidelines, /Select timeout_seconds before launch/);
  assert.match(guidelines, /never expands access or the helper's capabilities/);

  const args = childArguments(options());
  const helperIndex = args.lastIndexOf("--append-system-prompt");
  assert.ok(helperIndex >= 0);
  assert.equal(args[helperIndex + 1], fileURLToPath(new URL("../assets/helper.md", import.meta.url)));
  const helper = readFileSync(args[helperIndex + 1], "utf8");
  assert.match(helper, /Apply FARO proportionately within this child role/);
  assert.match(helper, /The parent decides when to delegate; you do not orchestrate or delegate again/);
  assert.match(helper, /never expands the user's authorization or your read-only limits/);
  assert.match(helper, /return a partial or blocked result instead of attempting it/);
});

test("assignment validation keeps the bounded contract and rejects authority/configuration injection", () => {
  assert.deepEqual(validateAssignment(assignment), { ...assignment, timeout_seconds: DEFAULT_TIMEOUT_SECONDS });
  for (const input of [null, [], {}, { ...assignment, objective: " " }, { ...assignment, references: [] }, { ...assignment, references: [3] }, { ...assignment, context: "x".repeat(8193) }, { ...assignment, label: "bad\nlabel" }, { ...assignment, model: "other" }, { ...assignment, cwd: "/" }, { ...assignment, tools: ["bash"] }]) assert.throws(() => validateAssignment(input));
  assert.equal(validateAssignment({ ...assignment, context: undefined, constraints: undefined }).context, "");
});

test("execution budget defaults to 120 seconds and rejects values outside 120–300 before admission", async () => {
  assert.equal(validateAssignment(assignment).timeout_seconds, 120);
  for (const seconds of [120, 180, MAX_TIMEOUT_SECONDS]) {
    assert.equal(validateAssignment({ ...assignment, timeout_seconds: seconds }).timeout_seconds, seconds);
  }
  const h = harness(); let launched = 0;
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: async () => { launched++; return success; } });
  await h.emit("session_start");
  const tool = h.tools.get("stela_delegate");
  assert.deepEqual(tool.parameters.properties.timeout_seconds, {
    type: "integer", minimum: 120, maximum: 300, default: 120,
    description: tool.parameters.properties.timeout_seconds.description,
  });
  for (const value of [null, "300", true, 0, 119, 301, 120.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => validateAssignment({ ...assignment, timeout_seconds: value }), /timeout_seconds/);
    await assert.rejects(tool.execute("call", { ...assignment, timeout_seconds: value }, undefined, undefined, h.ctx), /timeout_seconds/);
  }
  assert.equal(launched, 0);
  await h.emit("session_shutdown");
});

test("admission propagates budgets and an active duplicate cannot extend or restart its original work", async () => {
  const h = harness(); const job = deferred<RunResult>(); const captured: RunOptions[] = [];
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: (opts) => { captured.push(opts); return job.promise; } });
  await h.emit("session_start");
  const tool = h.tools.get("stela_delegate");
  const first = await tool.execute("first", assignment, undefined, undefined, h.ctx);
  const duplicate = await tool.execute("duplicate", { ...assignment, timeout_seconds: 300 }, undefined, undefined, h.ctx);
  assert.equal(duplicate.details.taskId, first.details.taskId);
  assert.equal(duplicate.details.duplicate, true);
  assert.equal(duplicate.details.timeoutSeconds, 120);
  assert.match(duplicate.content[0].text, /Execution budget: 120 seconds/);
  const extended = await tool.execute("extended", { ...assignment, objective: "Independent audit", timeout_seconds: 300 }, undefined, undefined, h.ctx);
  assert.equal(extended.details.timeoutSeconds, 300);
  assert.match(extended.content[0].text, /Execution budget: 300 seconds/);
  await tick(); // Admission returns before the new execution microtask runs.
  assert.deepEqual(captured.map((opts) => opts.assignment.timeout_seconds), [120, 300]);
  assert.deepEqual(captured[1].scope.tools, ["read", "grep", "find", "ls"]);
  await h.commands.get("stela-tasks").handler(extended.details.taskId, h.ctx);
  assert.match(h.notifications[0], /Execution budget: 300 seconds/);
  job.resolve(success);
  await h.emit("agent_before_settle", { entries: [], outcome: "completed" });
  assert.equal(captured.length, 2);
  await h.emit("session_shutdown");
});

test("concurrency defaults to five, accepts one through five and rejects other limits", async () => {
  for (let i = 1; i <= 5; i++) assert.equal(concurrencyLimit(String(i)), i);
  for (const value of ["0", "6", "2.5", "05", "", undefined, 5]) assert.throws(() => concurrencyLimit(value));
  const jobs = Array.from({ length: 6 }, () => deferred<RunResult>());
  let launched = 0;
  let active = 0;
  let peak = 0;
  const queue = new TaskQueue();
  const records = jobs.map((job, i) => queue.enqueue({ ...assignment, objective: `Question ${i}` }, "same-session", async () => { launched++; active++; peak = Math.max(peak, active); const result = await job.promise; active--; return result; }));
  await tick();
  assert.equal(launched, 5);
  assert.equal(queue.get(records[5].task.id)?.state, "queued");
  jobs[0].resolve(success);
  await tick();
  assert.equal(launched, 6);
  assert.equal(peak, 5);
  jobs.forEach((job) => job.resolve(success));
  await queue.waitForIdle();
  assert.equal(queue.pendingResults().length, 6);
});

test("duplicate active assignments reuse their ID, while scopes remain separate", async () => {
  const job = deferred<RunResult>();
  const queue = new TaskQueue(1);
  const first = queue.enqueue(assignment, "session/model", () => job.promise);
  const second = queue.enqueue({ ...assignment, label: "Different label" }, "session/model", () => { throw new Error("duplicate executed"); });
  assert.equal(first.task.id, second.task.id);
  assert.equal(second.duplicate, true);
  const another = queue.enqueue(assignment, "different scope", async () => success);
  assert.notEqual(first.task.id, another.task.id);
  job.resolve(success);
  await queue.waitForIdle();
  const completed = queue.pendingResults();
  queue.markDelivered(completed.map((task) => task.id));
  assert.equal(queue.pendingResults().length, 0);
});

test("queued cancellation never launches; running cancellation holds its slot until cleanup", async () => {
  const job = deferred<RunResult>();
  const queue = new TaskQueue(1);
  let launched = 0;
  const first = queue.enqueue(assignment, "one", () => { launched++; return job.promise; });
  const second = queue.enqueue(assignment, "two", async () => { launched++; return success; });
  await tick();
  assert.equal(queue.cancel(second.task.id), true);
  assert.equal(queue.get(second.task.id)?.state, "cancelled");
  assert.equal(queue.cancel(first.task.id), true);
  assert.equal(queue.get(first.task.id)?.state, "cancelling");
  assert.equal(queue.hasWork(), true);
  job.resolve(success);
  await queue.waitForIdle();
  assert.equal(launched, 1);
  assert.equal(queue.get(first.task.id)?.state, "cancelled");
});

test("queue closure cancels remaining work, rejects admission and absorbs runner failure", async () => {
  const queue = new TaskQueue(1);
  queue.enqueue(assignment, "one", async () => { throw new Error("spawn failure"); });
  await queue.waitForIdle();
  assert.match(queue.pendingResults()[0].result!.error!, /spawn failure/);
  await queue.cancelAll(true);
  assert.throws(() => queue.enqueue(assignment, "two", async () => success), /closed/);
});

test("the queue bounds outstanding work and retains defensive snapshots", async () => {
  const queue = new TaskQueue(1);
  for (let i = 0; i < 8; i++) queue.enqueue(assignment, String(i), async () => success);
  assert.throws(() => queue.enqueue(assignment, "overflow", async () => success), /Eight/);
  const tasks = queue.list();
  tasks[0].assignment.label = "external mutation";
  assert.equal(queue.list()[0].assignment.label, assignment.label);
  await queue.cancelAll(true);
});

test("scope checks canonical paths and reject traversal, missing files and symlink escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "stela-scope-test-"));
  try {
    const allowed = join(dir, "allowed"); mkdirSync(allowed);
    writeFileSync(join(allowed, "source.txt"), "evidence");
    writeFileSync(join(dir, "outside.txt"), "outside");
    const outside = join(dir, "outside"); mkdirSync(outside);
    writeFileSync(join(outside, "source.txt"), "outside");
    // Directory junctions exercise canonical-path escapes on Windows without
    // requiring administrator privileges or Developer Mode for file symlinks.
    symlinkSync(outside, join(allowed, "escape"), process.platform === "win32" ? "junction" : "dir");
    const scope = makeScope([allowed], dir, ["read"]);
    assert.equal(pathInScope("allowed/source.txt", dir, scope), true);
    assert.equal(pathInScope("allowed/../outside.txt", dir, scope), false);
    assert.equal(pathInScope("allowed/escape/source.txt", dir, scope), false);
    assert.equal(pathInScope("missing", dir, scope), false);
    assert.throws(() => makeScope([allowed], dir, ["bash"]));
    assert.throws(() => makeScope([allowed], dir, []));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("child launch retains parent resource flags, constrains runtime, and sends no task in argv", () => {
  const configured = options("success");
  configured.launch.resourceArgs = ["--extension", "/parent/permission.ts", "--system-prompt", "/parent/policy.md"];
  const args = childArguments(configured);
  assert.deepEqual(args.slice(2, 6), configured.launch.resourceArgs);
  for (const flag of ["--no-session", "--offline", "--tools", "--no-mcp", "--no-approve"]) assert.ok(args.includes(flag));
  assert.ok(!args.includes("--no-extensions"));
  assert.ok(!args.includes(assignment.objective));
  assert.throws(() => resolveLaunch(["node", "/unknown/bridge.js"], process.execPath), /native packaged/);
});

test("JSON runner collects final text blocks, evidence trace and settlement", async () => {
  const result = await runChild(options());
  assert.equal(result.status, "completed");
  assert.match(result.output, /Answer: bounded evidence\.\nLimitations:/);
  assert.doesNotMatch(result.output, /intermediate/);
  assert.deepEqual(result.trace, ["read /fixture/source.ts"]);
});

test("JSON runner preserves chunked UTF-8 and Unicode line separators", async () => {
  const result = await runChild(options("unicode"));
  assert.equal(result.status, "completed");
  assert.equal(result.output, "ñ🙂\u2028evidence");
});

test("JSON runner bounds model output and reports truncation", async () => {
  const result = await runChild(options("large"));
  assert.equal(result.status, "completed");
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= RESULT_BYTES);
  assert.match(result.output, /Truncated/);
  assert.doesNotMatch(boundedText("\u001b[31mred\u001b[0m\u0007", 100), /\u001b|\u0007/);
});

test("JSON runner schedules the actual default or extended deadline and supplies the same budget to the child", async (t) => {
  const timer = t.mock.method(globalThis, "setTimeout");
  for (const timeout_seconds of [undefined, MAX_TIMEOUT_SECONDS]) {
    const start = timer.mock.callCount();
    const result = await runChild(options("echo", { assignment: { ...assignment, timeout_seconds }, timeoutMs: undefined }));
    const seconds = timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
    assert.equal(result.status, "completed");
    assert.match(result.output, new RegExp(`Execution budget: ${seconds} seconds`));
    assert.ok(timer.mock.calls.slice(start).some((call) => call.arguments[1] === seconds * 1000), "the timer must use the assigned budget, not the fixture's 5-second seam");
  }
});

test("JSON runner rejects invalid or budget-expanding internal timeouts without spawning", async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 120_001]) {
    const result = await runChild(options("echo", { timeoutMs }));
    assert.equal(result.status, "failed");
    assert.match(result.error!, /Invalid execution timeout/);
    assert.equal(result.output, "");
    assert.deepEqual(result.trace, []);
  }
  const result = await runChild(options("echo", { assignment: { ...assignment, timeout_seconds: 301 } }));
  assert.equal(result.status, "failed");
  assert.match(result.error!, /timeout_seconds/);
});

test("JSON runner retains bounded read ranges but not source contents or unrelated arguments", async () => {
  const result = await runChild(options("ranges"));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.trace.slice(0, 4), [
    "read /fixture/source.ts offset=1 limit=200",
    "read /fixture/source.ts offset=201 limit=80",
    "read /fixture/source.ts",
    "read /fixture/source.ts",
  ]);
  assert.match(result.trace[4], /offset=42 limit=7$/);
  assert.ok(result.trace.every((entry) => Buffer.byteLength(entry) <= 256));
  assert.doesNotMatch(result.trace.join("\n"), /DO_NOT_RETAIN_CONTENT/);
});

for (const scenario of ["partial-empty-final", "partial-spaces-final", "partial-thinking-final", "partial-restarted"]) {
  test(`JSON runner retains partial text without false completion for ${scenario}`, async () => {
    const result = await runChild(options(scenario));
    assert.equal(result.status, "failed");
    assert.match(result.error!, /nonempty final answer/);
    if (scenario === "partial-restarted") assert.match(result.output, /Answer: bounded evidence/);
    else assert.equal(result.output, "Partial evidence B: ñ🙂");
    assert.doesNotMatch(result.output, /Older public text A|PRIVATE_/);
    const formatted = formatResult({ id: "partial", assignment, state: "failed", delivered: false, sourcesMayHaveChanged: false, result });
    assert.match(formatted, /Partial evidence only/);
  });
}

test("JSON runner replaces a retained partial with a genuine final answer", async () => {
  const result = await runChild(options("partial-valid-final"));
  assert.equal(result.status, "completed");
  assert.match(result.output, /Answer: bounded evidence/);
  assert.doesNotMatch(result.output, /Partial evidence B|PRIVATE_/);
  assert.doesNotMatch(formatResult({ id: "final", assignment, state: "completed", delivered: false, sourcesMayHaveChanged: false, result }), /Partial evidence only/);
});

for (const scenario of ["stream-hang", "stream-thinking-hang", "stream-large-hang"]) {
  test(`JSON runner preserves only bounded public streaming text on ${scenario}`, async () => {
    const result = await runChild(options(scenario, { timeoutMs: 1500 }));
    assert.equal(result.status, "failed");
    assert.match(result.error!, /1\.5-second execution deadline/);
    assert.ok(Buffer.byteLength(result.output) <= RESULT_BYTES);
    assert.doesNotMatch(result.output, /PRIVATE_|Stream A/);
    if (scenario === "stream-thinking-hang") assert.equal(result.output, "Earlier public evidence");
    else assert.match(result.output, /^Stream corrected ñ🙂\nSecond block/);
    assert.equal(result.truncated, scenario === "stream-large-hang");
  });
}

for (const scenario of ["stream-empty-final", "stream-valid-final"]) {
  test(`JSON runner uses authoritative message_end, not streaming text, for completion on ${scenario}`, async () => {
    const result = await runChild(options(scenario));
    assert.doesNotMatch(result.output, /PRIVATE_|Stream A/);
    if (scenario === "stream-empty-final") {
      assert.equal(result.status, "failed");
      assert.equal(result.output, "Stream corrected ñ🙂\nSecond block");
    } else {
      assert.equal(result.status, "completed");
      assert.match(result.output, /^Answer: bounded evidence/);
      assert.doesNotMatch(result.output, /Stream corrected/);
    }
  });
}

test("JSON runner keeps an 8 KiB bounded Unicode partial and actual deadline diagnostic on timeout", async () => {
  const result = await runChild(options("partial-large-hang", { timeoutMs: 1500 }));
  assert.equal(result.status, "failed");
  assert.match(result.error!, /1\.5-second execution deadline; no retry was started/);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= RESULT_BYTES);
  assert.match(result.output, /^ñ🙂 evidence/);
  assert.match(result.output, /Truncated/);
  assert.doesNotMatch(result.output, /PRIVATE_/);
});

for (const action of ["timeout", "cancel"]) {
  test(`extension delivers partial ${action} evidence once without relaunch or false success`, async () => {
    const h = harness(); let launches = 0;
    registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: (opts) => {
      launches++;
      return runChild({ ...opts, launch: { command: process.execPath, prefix: [fixture, action === "timeout" ? "partial-ignore-term" : "stream-hang"], resourceArgs: [] }, timeoutMs: action === "timeout" ? 1500 : 5000, killGraceMs: 50 });
    } });
    await h.emit("session_start");
    const receipt = await h.tools.get("stela_delegate").execute("partial", assignment, undefined, undefined, h.ctx);
    if (action === "cancel") {
      await delay(800);
      await h.tools.get("stela_cancel").execute("cancel", { task_id: receipt.details.taskId }, undefined, undefined, h.ctx);
    }
    const boundary = await h.emit("agent_before_settle", { entries: [], outcome: "completed" });
    assert.equal(boundary.entries.length, 1);
    const expected = action === "timeout" ? "failed" : "cancelled";
    assert.equal(boundary.entries[0].details.state, expected);
    assert.match(boundary.entries[0].content, /Partial evidence only/);
    assert.match(boundary.entries[0].content, action === "timeout" ? /Partial evidence B: ñ🙂/ : /Stream corrected ñ🙂/);
    assert.doesNotMatch(boundary.entries[0].content, /PRIVATE_/);
    assert.equal(boundary.entries[0].details.result, undefined);
    await h.commands.get("stela-tasks").handler(receipt.details.taskId, h.ctx);
    assert.match(h.notifications[0], /Partial evidence only/);
    if (action === "timeout") assert.match(h.notifications[0], /read \/fixture\/source\.ts offset=1 limit=200/);
    assert.equal(await h.emit("turn_end", { entries: [], outcome: "completed" }), undefined);
    assert.equal(launches, 1);
    await h.emit("session_shutdown");
  });
}

for (const scenario of ["malformed", "oversized-frame", "unterminated", "missing-settle", "empty", "error", "length", "no-guard", "unexpected-tool", "blocked", "nonzero", "signal"]) {
  test(`JSON runner does not report success for ${scenario}`, async () => {
    const result = await runChild(options(scenario));
    assert.equal(result.status, "failed");
    assert.ok(result.error);
    if (scenario === "nonzero") assert.match(result.diagnostics, /fixture startup error/);
  });
}

test("JSON runner does not orphan a descendant after its leader exits", { skip: process.platform !== "linux" }, async () => {
  const result = await runChild(options("descendant"));
  assert.equal(result.status, "completed");
  const pid = Number(result.output.match(/DESCENDANT_PID=(\d+)/)?.[1]);
  assert.ok(pid > 0);
  const stillExecuting = () => {
    try { return !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z "); } catch { return false; }
  };
  try {
    // Kernel reaping is asynchronous; a zombie is terminated, not executing work.
    for (let i = 0; i < 20 && stillExecuting(); i++) await delay(10);
    assert.equal(stillExecuting(), false);
  } finally {
    if (stillExecuting()) process.kill(pid, "SIGKILL");
  }
});

test("JSON runner handles spawn errors and pre-launch cancellation", async () => {
  const result = await runChild(options("success", { launch: { command: "/does/not/exist/pi", prefix: [], resourceArgs: [] } }));
  assert.equal(result.status, "failed");
  assert.match(result.error!, /Could not/);
  const controller = new AbortController(); controller.abort();
  assert.equal((await runChild(options("success", { signal: controller.signal }))).status, "cancelled");
});

test("JSON runner enforces deadline and escalates cancellation when SIGTERM is ignored", async () => {
  const timed = await runChild(options("hang", { timeoutMs: 300 }));
  assert.equal(timed.status, "failed");
  assert.match(timed.error!, /deadline/);
  const controller = new AbortController();
  const pending = runChild(options("ignore-term", { signal: controller.signal }));
  await delay(300); controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.status, "cancelled");
});

test("extension returns immediately, allows five children and emits each result only once", async () => {
  const h = harness();
  const jobs = Array.from({ length: 6 }, () => deferred<RunResult>());
  let launched = 0;
  const captured: RunOptions[] = [];
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: (opts) => { captured.push(opts); return jobs[launched++].promise; } });
  assert.equal(h.flags.get("stela-subagent-concurrency"), "5");
  await h.emit("session_start");
  const receipts = [];
  for (let i = 0; i < 6; i++) receipts.push(await h.tools.get("stela_delegate").execute("call", { ...assignment, objective: `Question ${i}` }, undefined, undefined, h.ctx));
  assert.equal(launched, 5);
  assert.equal(receipts[5].details.state, "queued");
  const rows = h.widgets.at(-1)[1] as string[];
  assert.equal(rows.filter((row) => row.endsWith("running")).length, 5);
  assert.equal(rows.filter((row) => row.endsWith("queued")).length, 1);
  assert.equal(captured[0].model, "fixture/model");
  assert.equal(captured[0].thinking, "medium");
  assert.deepEqual(captured[0].scope.tools, ["read", "grep", "find", "ls"]);
  jobs[0].resolve(success); await tick();
  const boundary = await h.emit("turn_end", { entries: [], outcome: "completed" });
  assert.equal(boundary.entries.length, 1);
  assert.equal(boundary.continue, true);
  assert.match(boundary.entries[0].content, /Evidence: source.ts:1/);
  assert.equal(boundary.entries[0].details.result, undefined);
  assert.equal(await h.emit("turn_end", { entries: [], outcome: "completed" }), undefined);
  jobs.forEach((job) => job.resolve(success)); await tick();
  const rest = await h.emit("agent_before_settle", { entries: [], outcome: "completed" });
  assert.equal(rest.entries.length, 5);
  assert.equal(await h.emit("agent_before_settle", { entries: [], outcome: "completed" }), undefined);
  await h.emit("session_shutdown");
});

test("settlement waits on completion events, not provider polling", async () => {
  const h = harness(); const job = deferred<RunResult>();
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: () => job.promise });
  await h.emit("session_start");
  await h.tools.get("stela_delegate").execute("call", assignment, undefined, undefined, h.ctx);
  let returned = false;
  const boundary = h.emit("agent_before_settle", { entries: [], outcome: "completed" }).then((result) => { returned = true; return result; });
  await tick(); assert.equal(returned, false);
  job.resolve(success);
  assert.equal((await boundary).entries.length, 1);
  await h.emit("session_shutdown");
});

test("mutation warnings and human-only details do not duplicate model context", async () => {
  const h = harness(); const job = deferred<RunResult>();
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: () => job.promise });
  await h.emit("session_start");
  const receipt = await h.tools.get("stela_delegate").execute("call", assignment, undefined, undefined, h.ctx);
  await h.emit("tool_execution_end", { toolName: "edit", isError: false });
  job.resolve(success); await tick();
  const boundary = await h.emit("turn_end", { entries: [], outcome: "completed" });
  assert.match(boundary.entries[0].content, /potentially mutating/);
  await h.commands.get("stela-tasks").handler(receipt.details.taskId, h.ctx);
  assert.match(h.notifications[0], /read source.ts/);
  assert.equal(await h.emit("turn_end", { entries: [], outcome: "completed" }), undefined);
  await h.emit("session_shutdown");
});

for (const event of ["session_shutdown", "session_tree", "agent_settled"]) {
  test(`${event} cancels owned children and never wakes or delivers into a new session`, async () => {
    const h = harness(); let aborted = false;
    registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: (opts) => new Promise((resolve) => opts.signal.addEventListener("abort", () => { aborted = true; resolve({ ...success, status: "cancelled" }); }, { once: true })) });
    await h.emit("session_start");
    await h.tools.get("stela_delegate").execute("call", assignment, undefined, undefined, h.ctx);
    await tick();
    await h.emit(event, { aborted: true });
    assert.equal(aborted, true);
    const foreign = { ...h.ctx, sessionManager: { getSessionId: () => "different" } };
    assert.equal(await h.emit("turn_end", { entries: [], outcome: "completed" }, foreign), undefined);
    if (event === "session_tree") assert.equal(await h.emit("turn_end", { entries: [], outcome: "completed" }), undefined);
    await h.emit("session_shutdown");
  });
}

test("cancel tool rejects foreign IDs, cancels only its task and does not admit inactive readers", async () => {
  const h = harness(); const jobs: Array<{ opts: RunOptions; resolve: (result: RunResult) => void }> = [];
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: (opts) => new Promise((resolve) => { jobs.push({ opts, resolve }); opts.signal.addEventListener("abort", () => resolve({ ...success, status: "cancelled" })); }) });
  await h.emit("session_start"); h.pi.setActiveTools(["read"]);
  const receipt = await h.tools.get("stela_delegate").execute("call", assignment, undefined, undefined, h.ctx);
  await tick();
  assert.deepEqual(jobs[0].opts.scope.tools, ["read"]);
  await assert.rejects(h.tools.get("stela_cancel").execute("cancel", { task_id: "foreign" }, undefined, undefined, h.ctx), /Unknown/);
  const cancelled = await h.tools.get("stela_cancel").execute("cancel", { task_id: receipt.details.taskId }, undefined, undefined, h.ctx);
  assert.equal(cancelled.details.requested, true);
  h.pi.setActiveTools(["bash"]);
  await assert.rejects(h.tools.get("stela_delegate").execute("call", assignment, undefined, undefined, h.ctx), /No supported/);
  await h.emit("session_shutdown");
});

test("child guard registers no delegator, enables only proven readers and blocks writes and escapes", async () => {
  const h = harness(); const scope = makeScope([fixture], h.ctx.cwd, ["read"]);
  registerSubagents(h.pi, { env: { [CHILD_MARKER]: "1", [CHILD_SCOPE]: JSON.stringify(scope) } });
  assert.equal(h.tools.size, 0);
  await h.emit("session_start");
  assert.deepEqual(h.pi.getActiveTools(), ["read"]);
  await h.emit("before_agent_start");
  assert.equal(h.entries[0].customType, READY_ENTRY);
  assert.equal(await h.emit("tool_call", { toolName: "read", input: { path: fixture } }), undefined);
  for (const event of [{ toolName: "write", input: { path: fixture } }, { toolName: "bash", input: { command: "true" } }, { toolName: "read", input: { path: "/etc/passwd" } }, { toolName: "stela_delegate", input: {} }]) {
    assert.equal((await h.emit("tool_call", event)).block, true);
  }
  assert.ok(h.entries.some((entry) => entry.customType === BLOCKED_ENTRY));
  assert.equal((await h.emit("user_bash")).result.cancelled, true);
});

test("child guard refuses overridden readers and enforces finite tool and turn budgets", async () => {
  const h = harness();
  registerSubagents(h.pi, { env: { [CHILD_MARKER]: "1", [CHILD_SCOPE]: JSON.stringify(makeScope([fixture], h.ctx.cwd, ["read"])) } });
  for (let i = 0; i < 32; i++) assert.equal(await h.emit("tool_call", { toolName: "read", input: { path: fixture } }), undefined);
  assert.equal((await h.emit("tool_call", { toolName: "read", input: { path: fixture } })).block, true);
  for (let i = 0; i < 13; i++) await h.emit("turn_start");
  assert.equal(h.controller.signal.aborted, true);
  h.available[0].sourceInfo.source = "extension";
  await assert.rejects(h.emit("before_agent_start"), /overridden/);
  assert.deepEqual(h.pi.getActiveTools(), []);
});

test("uncommitted boundary proposals remain eligible for delivery", async () => {
  const h = harness();
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: async () => success });
  await h.emit("session_start");
  await h.tools.get("stela_delegate").execute("call", assignment, undefined, undefined, h.ctx);
  await tick();
  const proposed = await h.hooks.get("turn_end")![0]({ entries: [], outcome: "completed" }, h.ctx);
  assert.equal(proposed.entries.length, 1);
  // Simulate a later extension rejecting the proposal: no branch entry was committed.
  await h.emit("context");
  const delivered = await h.emit("turn_end", { entries: [], outcome: "completed" });
  assert.equal(delivered.entries.length, 1);
  await h.emit("context");
  assert.equal(await h.emit("turn_end", { entries: [], outcome: "completed" }), undefined);
  await h.emit("session_shutdown");
});

test("parent interruption aborts a waiting settlement without a forced continuation", async () => {
  const h = harness();
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: (opts) => new Promise((resolve) => opts.signal.addEventListener("abort", () => resolve({ ...success, status: "cancelled" }))) });
  await h.emit("session_start");
  await h.tools.get("stela_delegate").execute("call", assignment, h.controller.signal, undefined, h.ctx);
  await tick();
  const boundary = h.emit("agent_before_settle", { entries: [], outcome: "completed" });
  h.controller.abort();
  assert.equal(await boundary, undefined);
  await h.emit("agent_settled", { aborted: true });
  await h.emit("session_shutdown");
});

test("queued work rechecks reader availability before launching", async () => {
  const h = harness(); const first = deferred<RunResult>(); let launches = 0;
  registerSubagents(h.pi, { env: {}, launch: fakeLaunch, run: () => { launches++; return first.promise; } });
  h.flags.set("stela-subagent-concurrency", "1");
  await h.emit("session_start");
  await h.tools.get("stela_delegate").execute("one", assignment, undefined, undefined, h.ctx);
  await h.tools.get("stela_delegate").execute("two", { ...assignment, objective: "Another question" }, undefined, undefined, h.ctx);
  await tick(); h.pi.setActiveTools([]); first.resolve(success); await tick();
  const result = await h.emit("agent_before_settle", { entries: [], outcome: "completed" });
  assert.equal(launches, 1);
  assert.ok(result.entries.some((entry: any) => entry.content.includes("availability changed")));
  await h.emit("session_shutdown");
});

test("invalid child scope fails closed and reports no fabricated success", () => {
  const h = harness();
  assert.throws(() => registerSubagents(h.pi, { env: { [CHILD_MARKER]: "1", [CHILD_SCOPE]: "{}" } }), /Invalid/);
  assert.match(formatResult({ id: "task", assignment, state: "failed", delivered: false, sourcesMayHaveChanged: false, result: { ...success, status: "failed", output: "", error: "No evidence" } }), /No assistant answer/);
});
