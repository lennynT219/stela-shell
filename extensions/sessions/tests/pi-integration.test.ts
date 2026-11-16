import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { endpointName } from "../transport.ts";
import { newId, PEER_TASK_POLICY } from "../messages.ts";
import { WINDOWS_SESSIONS_HELPER } from "../transport-windows.ts";

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
const nativeAvailable = process.platform !== "win32" || existsSync(WINDOWS_SESSIONS_HELPER);
const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
const provider = fileURLToPath(new URL("./fixtures/provider.ts", import.meta.url));
const lateCommit = fileURLToPath(new URL("./fixtures/late-commit.ts", import.meta.url));
const subagents = fileURLToPath(new URL("../../subagents/index.ts", import.meta.url));

/** Bounded event-driven test client: no provider polling, secrets, external profile or inference. */
function client(profile: string, home: string, role: string, child = false, action = "message", options: { flags?: string[]; entry?: string } = {}) {
  const processChild = spawn(process.execPath, [cli!, "--offline", "--mode", "rpc", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
    "--extension", provider, "--extension", options.entry ?? extension, ...(action === "delegate" ? ["--extension", subagents] : []), ...(options.flags ?? []), "--model", "ss-session-fixture/deterministic", "--thinking", "off"], {
    cwd: home, env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", NO_UPDATE_NOTIFIER: "1", SS_SESSION_FIXTURE_ROLE: role, SS_SESSION_FIXTURE_ACTION: action, ...(child ? { STELA_SUBAGENT_CHILD: "1" } : {}) }, stdio: ["pipe", "pipe", "pipe"],
  });
  const events: any[] = [], waits = new Set<{ predicate: (event: any) => boolean; resolve: (event: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let buffer = "", stderr = "", bytes = 0, counter = 0, failure: Error | undefined;
  const fail = (error: Error) => { failure = error; for (const wait of waits) { clearTimeout(wait.timer); wait.reject(error); } waits.clear(); };
  processChild.stdout.setEncoding("utf8");
  processChild.stdout.on("data", (chunk: string) => {
    bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) { fail(new Error("Fixture output bound exceeded")); processChild.kill("SIGKILL"); return; }
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line.trim()) continue;
      try {
        const event = JSON.parse(line); events.push(event);
        for (const wait of [...waits]) if (wait.predicate(event)) { clearTimeout(wait.timer); waits.delete(wait); wait.resolve(event); }
      } catch { fail(new Error("Malformed fixture JSON")); }
    }
  });
  processChild.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  processChild.on("error", fail);
  let exitCode: number | null = null;
  const exited = new Promise<void>((resolve) => processChild.once("exit", (code) => { exitCode = code; fail(new Error(`Fixture exited ${code}: ${stderr}`)); resolve(); }));
  const waitFor = (predicate: (event: any) => boolean) => {
    const existing = events.find(predicate); if (existing) return Promise.resolve(existing);
    if (failure) return Promise.reject(failure);
    return new Promise<any>((resolve, reject) => {
      const wait = { predicate, resolve, reject, timer: setTimeout(() => { waits.delete(wait); reject(new Error(`Fixture event deadline exceeded: ${stderr}\n${JSON.stringify(events.slice(-6))}`)); }, 20_000) };
      waits.add(wait);
    });
  };
  return {
    events, waitFor,
    async request(type: string, extra = {}) {
      const id = `request-${++counter}`, received = waitFor((event) => event.type === "response" && event.id === id);
      processChild.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
      const response = await received; assert.equal(response.success, true, JSON.stringify(response)); return response.data;
    },
    async close() {
      if (processChild.exitCode === null && processChild.signalCode === null) {
        processChild.stdin.end();
        const deadline = setTimeout(() => processChild.kill("SIGKILL"), 5000);
        await exited; clearTimeout(deadline);
      }
      assert.equal(exitCode, 0, stderr);
      assert.doesNotMatch(stderr, /Failed to load extension|Extension error|Unhandled/);
    },
  };
}
const final = (marker: string) => (event: any) => event.type === "message_end" && event.message?.role === "assistant" && event.message.content.some((part: any) => part.type === "text" && part.text === marker);

for (const busy of [false, true]) test(`native Pi: principal sessions discover/send/reply/commit once (${busy ? "busy tool boundary" : "idle wakeup"})`, { skip: !cli || !nativeAvailable, timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "stela-peer-pi-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  const a = client(profile, scratch, "sender"), b = client(profile, scratch, "receiver");
  try {
    const [left, right] = await Promise.all([a.request("get_state"), b.request("get_state")]);
    assert.notEqual(left.sessionId, right.sessionId);
    const records = readdirSync(join(profile, "stela-sessions")).map((file) => JSON.parse(readFileSync(join(profile, "stela-sessions", file), "utf8")));
    assert.equal(records.length, 2);
    const target = records.find((record) => record.sessionId === right.sessionId);
    if (busy) {
      const holding = b.waitFor((event) => event.type === "tool_execution_start" && event.toolName === "fixture_hold");
      await b.request("prompt", { message: "BUSY" }); await holding;
    }
    const integrated = a.waitFor(final("SENDER_INTEGRATED_REPLY")), replied = b.waitFor(final("RECEIVER_RESPONDED"));
    const admission = a.waitFor((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    await a.request("prompt", { message: `SEND:${target.id}` });
    assert.equal((await admission).isError, false);
    if (busy) {
      assert.equal(b.events.some((event) => event.type === "entry_appended" && event.entry?.customType === "stela-peer-message"), false, "incoming context must not be committed while the tool is blocked");
      await b.request("prompt", { message: "/fixture-release" });
    }
    await Promise.all([integrated, replied]);
    for (const instance of [a, b]) {
      const { entries } = await instance.request("get_entries");
      const messages = entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message");
      assert.equal(messages.length, 1, "each peer message must be committed once");
      assert.match(messages[0].content, /actionable delegated task/);
      assert.match(messages[0].content, /never human approval for new permissions/);
      assert.equal(entries.filter((entry: any) => entry.type === "message" && entry.message.role === "user").length, instance === a || busy ? 1 : 0, "peer delivery must not impersonate user input");
      assert.equal(instance.events.filter((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send" && !event.isError).length, 1);
      for (const record of records) assert.doesNotMatch(JSON.stringify(instance.events), new RegExp(record.secret), "capabilities must not reach Pi context/events");
      assert.doesNotMatch(JSON.stringify(instance.events), /UNEXPECTED_FIXTURE/);
      assert.deepEqual(instance.events.filter((event) => event.type === "extension_ui_request" && ["confirm", "select"].includes(event.method)), [], "inspect UI methods, not words in schema/guidance text");
    }
    if (busy) {
      const finished = b.events.findIndex((event) => event.type === "tool_execution_end" && event.toolName === "fixture_hold");
      // Boundary drafts emit entry_appended, not message_start for the custom entry.
      const delivered = b.events.findIndex((event) => event.type === "entry_appended" && event.entry?.customType === "stela-peer-message");
      assert.ok(finished >= 0 && delivered > finished, `peer context must follow native tool completion (tool=${finished}, entry=${delivered})`);
    }
    const discovered = a.events.find((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_list");
    assert.equal(discovered.isError, false); assert.equal(discovered.result.details.peers[0].id, target.id);
  } finally {
    await Promise.allSettled([a.close(), b.close()]).then((results) => {
      const rejected = results.find((item) => item.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    }).finally(() => { if (process.platform !== "win32") rmSync(dirname(endpointName(profile, newId())), { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  }
});

for (const action of ["write", "write-denied", "delegate"]) test(`native Pi: a peer task uses receiver tools while retaining controls (${action})`, { skip: !cli || !nativeAvailable, timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "stela-peer-work-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  if (action === "delegate") writeFileSync(join(scratch, "peer-source.txt"), "DELEGATED_PEER_SOURCE\n");
  const a = client(profile, scratch, "sender", false, action), b = client(profile, scratch, "receiver", false, action);
  try {
    const [, right] = await Promise.all([a.request("get_state"), b.request("get_state")]);
    const records = readdirSync(join(profile, "stela-sessions")).map((file) => JSON.parse(readFileSync(join(profile, "stela-sessions", file), "utf8")));
    assert.equal(records.length, 2);
    const target = records.find((record) => record.sessionId === right.sessionId);
    const integrated = a.waitFor(final("SENDER_INTEGRATED_REPLY")), replied = b.waitFor(final("RECEIVER_RESPONDED"));
    await a.request("prompt", { message: `SEND:${target.id}` });
    await Promise.all([integrated, replied]);
    const { entries } = await b.request("get_entries");
    assert.ok(b.events.some((event) => event.type === "message_start" && event.message?.role === "system" && event.message.sections?.rules?.includes(PEER_TASK_POLICY)), "the collaboration policy must reach Pi's real model-facing instructions");
    assert.equal(entries.filter((entry: any) => entry.type === "message" && entry.message.role === "user").length, 0, "the receiver must act without a new human prompt or impersonated input");
    const delivered = entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message");
    assert.equal(delivered.length, 1); assert.match(delivered[0].content, /actionable delegated task/);
    const used = b.events.filter((event) => event.type === "tool_execution_end" && event.toolName === (action === "delegate" ? "ss_tasks_delegate" : "write"));
    assert.equal(used.length, 1);
    if (action === "delegate") {
      assert.equal(used[0].isError, false);
      const evidence = entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-subagent-result");
      assert.equal(evidence.length, 1); assert.match(evidence[0].content, /completed/); assert.match(evidence[0].content, /DELEGATED_PEER_SOURCE/);
      assert.equal(readdirSync(join(profile, "stela-sessions")).length, 2, "the actual delegated child must not publish a peer activation");
      assert.equal(existsSync(join(scratch, "peer-action.txt")), false);
    } else if (action === "write-denied") {
      assert.equal(used[0].isError, true); assert.match(JSON.stringify(used[0].result), /Fixture receiver denies writes/);
      assert.equal(existsSync(join(scratch, "peer-action.txt")), false, "peer delivery must not bypass the receiver's tool_call denial");
    } else {
      assert.equal(used[0].isError, false); assert.equal(readFileSync(join(scratch, "peer-action.txt"), "utf8"), "PEER_ACTION_DONE\n");
    }
    const { entries: senderEntries } = await a.request("get_entries");
    const answer = senderEntries.find((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message");
    assert.ok(answer); assert.match(answer.content, new RegExp(`WORK_RESULT:${action === "delegate" ? "DELEGATE_DONE" : action === "write-denied" ? "WRITE_DENIED" : "WRITE_DONE"}`));
    const events = [...a.events, ...b.events];
    assert.doesNotMatch(JSON.stringify(events), /UNEXPECTED_FIXTURE/);
    assert.deepEqual(events.filter((event) => event.type === "extension_ui_request" && ["confirm", "select"].includes(event.method)), [], "check actual UI methods, not words in model/tool descriptions");
  } finally {
    await Promise.allSettled([a.close(), b.close()]).then((results) => {
      const rejected = results.find((item) => item.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    }).finally(() => { if (process.platform !== "win32") rmSync(dirname(endpointName(profile, newId())), { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  }
});

for (const action of ["work-long", "work-denied"]) test(`native Pi: opt-in work context retains deadlines and receiver controls (${action})`, { skip: !cli || !nativeAvailable, timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "ss-work-pi-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  const a = client(profile, scratch, "sender", false, action), b = client(profile, scratch, "receiver", false, action);
  try {
    const [, right] = await Promise.all([a.request("get_state"), b.request("get_state")]);
    const records = readdirSync(join(profile, "stela-sessions")).map((file) => JSON.parse(readFileSync(join(profile, "stela-sessions", file), "utf8")));
    const target = records.find((record) => record.sessionId === right.sessionId);
    const integrated = a.waitFor(final("SENDER_INTEGRATED_REPLY")), replied = b.waitFor(final("RECEIVER_RESPONDED"));
    const admission = a.waitFor((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    const holding = action === "work-long" ? b.waitFor((event) => event.type === "tool_execution_start" && event.toolName === "fixture_hold") : undefined;
    await a.request("prompt", { message: `SEND:${target.id}` });
    const root = await admission; assert.equal(root.isError, false);
    assert.equal(root.result.details.work.deadline - root.result.details.work.startedAt, 1_800_000);
    if (holding) {
      await holding;
      // Commands skip input hooks: advance both isolated clocks, not budgets or genuine-input state.
      await a.request("prompt", { message: "/fixture-advance 660000" });
      await b.request("prompt", { message: "/fixture-advance 660000" });
      await b.request("prompt", { message: "/fixture-release" });
    }
    await Promise.all([integrated, replied]);
    const reply = b.events.find((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    assert.equal(reply.isError, false); assert.deepEqual(reply.result.details.work, root.result.details.work);
    const { entries } = await b.request("get_entries");
    assert.equal(entries.filter((entry: any) => entry.type === "message" && entry.message.role === "user").length, 0);
    const received = entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message");
    assert.equal(received.length, 1); assert.deepEqual(received[0].details.work, root.result.details.work);
    assert.match(received[0].content, /fixed deadline/);
    if (action === "work-long") {
      const sendMessage = (instance: ReturnType<typeof client>) => instance.events.find((event) => event.type === "message_end" && event.message?.role === "assistant" &&
        event.message.content.some((part: any) => part.type === "toolCall" && part.name === "ss_sessions_send")).message;
      // Tool-start events carry no timestamp. Use the actual fixture-generated assistant messages.
      const rootTime = sendMessage(a).timestamp, replyTime = sendMessage(b).timestamp;
      assert.ok(Number.isSafeInteger(rootTime) && Number.isSafeInteger(replyTime));
      assert.ok(replyTime - rootTime >= 600_000, "the actual fixture reply occurs after the ordinary window");
    } else {
      const denied = b.events.find((event) => event.type === "tool_execution_end" && event.toolName === "write");
      assert.equal(denied.isError, true); assert.match(JSON.stringify(denied.result), /Fixture receiver denies writes/);
      assert.equal(existsSync(join(scratch, "peer-action.txt")), false);
      const { entries: senderEntries } = await a.request("get_entries");
      assert.match(senderEntries.find((entry: any) => entry.customType === "stela-peer-message").content, /WORK_RESULT:WRITE_DENIED/);
    }
    assert.doesNotMatch(JSON.stringify([...a.events, ...b.events]), /UNEXPECTED_FIXTURE/);
  } finally {
    await Promise.allSettled([a.close(), b.close()]).then((results) => {
      const rejected = results.find((item) => item.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    }).finally(() => { if (process.platform !== "win32") rmSync(dirname(endpointName(profile, newId())), { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  }
});

for (const action of ["work-mixed-live", "work-mixed-expired"]) test(`native Pi: independent same-peer thread bypasses only unrelated ${action.endsWith("expired") ? "expired" : "live"} work (${action})`, { skip: !cli || !nativeAvailable, timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "ss-mixed-threads-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  const a = client(profile, scratch, "sender", false, action), b = client(profile, scratch, "receiver", false, action);
  try {
    const [left, right] = await Promise.all([a.request("get_state"), b.request("get_state")]);
    const records = readdirSync(join(profile, "stela-sessions")).map((file) => JSON.parse(readFileSync(join(profile, "stela-sessions", file), "utf8")));
    const source = records.find((record) => record.sessionId === left.sessionId), target = records.find((record) => record.sessionId === right.sessionId);
    const retained = a.waitFor(final("OLD_CONTEXT_RETAINED")), seeded = b.waitFor(final("OLD_ROOT_PENDING"));
    await b.request("prompt", { message: `SEED:${source.id}` }); await Promise.all([retained, seeded]);
    const old = b.events.find((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    assert.equal(old.isError, false); assert.equal(old.result.details.work.deadline - old.result.details.work.startedAt, 600_000);
    if (action === "work-mixed-expired") {
      // Commands advance isolated clocks without issuing another genuine input to either mailbox.
      await a.request("prompt", { message: "/fixture-advance 660000" });
      await b.request("prompt", { message: "/fixture-advance 660000" });
    }
    const integrated = a.waitFor(final("SENDER_INTEGRATED_REPLY")), replied = b.waitFor(final("RECEIVER_RESPONDED"));
    await a.request("prompt", { message: `SEND:${target.id}` }); await Promise.all([integrated, replied]);
    const root = a.events.find((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    const sends = b.events.filter((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send"), reply = sends[1];
    assert.equal(root.isError, false); assert.equal(reply.isError, false); assert.notEqual(root.result.details.thread, old.result.details.thread);
    assert.equal(reply.result.details.thread, root.result.details.thread); assert.equal(reply.result.details.replyTo, root.result.details.messageId);
    assert.equal(reply.result.details.hop, 1); assert.equal(reply.result.details.selection, "reply_to");
    assert.deepEqual(reply.result.details.work, root.result.details.work);
    if (action === "work-mixed-expired") {
      assert.equal(root.result.details.work.deadline - root.result.details.work.startedAt, 1_800_000);
      assert.equal(sends.length, 3); assert.equal(sends[2].isError, true);
      assert.equal(sends[2].result.details.code, "WORK_EXPIRED"); assert.equal(sends[2].result.details.stage, "admission");
      assert.equal(sends[2].result.details.context.thread, old.result.details.thread);
      assert.equal(sends[2].result.details.context.selection, "implicit");
    } else { assert.equal(root.result.details.work, undefined); assert.equal(sends.length, 2); }
    const { entries: receiverEntries } = await b.request("get_entries"), { entries: senderEntries } = await a.request("get_entries");
    assert.equal(receiverEntries.filter((entry: any) => entry.type === "message" && entry.message.role === "user").length, 1, "only the initial seed is human input to the receiver");
    assert.equal(receiverEntries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message").length, 1);
    assert.equal(senderEntries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message").length, 2);
    const events = JSON.stringify([...a.events, ...b.events]); assert.doesNotMatch(events, /UNEXPECTED_FIXTURE|CONTEXT_MISMATCH/);
    for (const record of records) assert.doesNotMatch(events, new RegExp(record.secret));
  } finally {
    await Promise.allSettled([a.close(), b.close()]).then((results) => {
      const rejected = results.find((item) => item.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    }).finally(() => { if (process.platform !== "win32") rmSync(dirname(endpointName(profile, newId())), { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  }
});

for (const action of ["work-late-live", "work-late-expired", "work-late-ordinary"]) test(`native Pi: proposal committed across TTL retains original implicit bounds (${action})`, { skip: !cli || !nativeAvailable, timeout: 60_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "ss-late-commit-pi-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  const a = client(profile, scratch, "sender", false, action), b = client(profile, scratch, "receiver", false, action, { flags: ["--extension", lateCommit] });
  try {
    const [, right] = await Promise.all([a.request("get_state"), b.request("get_state")]);
    const records = readdirSync(join(profile, "stela-sessions")).map((file) => JSON.parse(readFileSync(join(profile, "stela-sessions", file), "utf8")));
    const target = records.find((record) => record.sessionId === right.sessionId);
    const holding = b.waitFor((event) => event.type === "tool_execution_start" && event.toolName === "fixture_hold");
    await b.request("prompt", { message: "BUSY" }); await holding;
    const admission = a.waitFor((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    await a.request("prompt", { message: `SEND:${target.id}` }); const root = await admission;
    assert.equal(root.isError, false);
    if (action === "work-late-ordinary") assert.equal(root.result.details.work, undefined);
    else assert.equal(root.result.details.work.deadline - root.result.details.work.startedAt, 1_800_000);
    assert.equal(b.events.some((event) => event.type === "entry_appended" && event.entry?.customType === "stela-peer-message"), false);
    // The other process advances before the receiver's later boundary handler does.
    // No additional genuine input is sent to the receiver's mailbox.
    await a.request("prompt", { message: `/fixture-advance ${action === "work-late-expired" ? 1_830_000 : 660_000}` });
    await b.request("prompt", { message: "/fixture-release" });
    await b.waitFor(final("RECEIVER_RESPONDED"));
    const result = b.events.find((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send");
    if (action === "work-late-live") {
      assert.equal(result.isError, false); assert.equal(result.result.details.selection, "implicit");
      assert.equal(result.result.details.thread, root.result.details.thread); assert.equal(result.result.details.hop, 1);
      assert.equal(result.result.details.replyTo, undefined); assert.deepEqual(result.result.details.work, root.result.details.work);
      await a.waitFor(final("SENDER_INTEGRATED_REPLY"));
    } else {
      assert.equal(result.isError, true); assert.equal(result.result.details.stage, "admission");
      assert.equal(result.result.details.code, action === "work-late-expired" ? "WORK_EXPIRED" : "CONVERSATION_EXPIRED");
      assert.equal(result.result.details.context.thread, root.result.details.thread); assert.equal(result.result.details.context.selection, "implicit");
      const { entries } = await a.request("get_entries");
      assert.equal(entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message").length, 0, "expired context sends no new root to the sender");
    }
    const { entries } = await b.request("get_entries");
    const received = entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "stela-peer-message");
    assert.equal(received.length, 1);
    const evidence = entries.find((entry: any) => entry.type === "custom" && entry.customType === "ss-session-fixture-late");
    assert.ok(evidence); assert.equal(evidence.data.messageId, root.result.details.messageId);
    assert.ok(evidence.data.advancedAt >= root.result.details.expiresAt, "the actual later Pi handler advanced the admission clock before persistence");
    assert.ok(entries.indexOf(evidence) > entries.indexOf(received[0]), "Pi persists the message and the later handler's evidence in proposal order");
    assert.equal(entries.filter((entry: any) => entry.type === "message" && entry.message.role === "user").length, 1, "only BUSY was human input to the receiver");
    assert.equal(b.events.filter((event) => event.type === "tool_execution_end" && event.toolName === "ss_sessions_send").length, 1);
    const events = JSON.stringify([...a.events, ...b.events]); assert.doesNotMatch(events, /UNEXPECTED_FIXTURE/);
    for (const record of records) assert.doesNotMatch(events, new RegExp(record.secret));
  } finally {
    await Promise.allSettled([a.close(), b.close()]).then((results) => {
      const rejected = results.find((item) => item.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    }).finally(() => { if (process.platform !== "win32") rmSync(dirname(endpointName(profile, newId())), { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  }
});

test("native Pi: linked extension registers ss commands and the ss disable flag prevents presence", { skip: !cli, timeout: 35_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "ss-linked-sessions-")), profile = join(scratch, "agent"), linked = join(scratch, "linked-sessions");
  mkdirSync(profile, { mode: 0o700 });
  symlinkSync(dirname(extension), linked, process.platform === "win32" ? "junction" : "dir");
  const instance = client(profile, scratch, "sender", false, "message", { flags: ["--ss-sessions-disabled"], entry: join(linked, "index.ts") });
  try {
    await instance.request("get_state");
    const { commands } = await instance.request("get_commands");
    assert.equal(commands.filter((command: any) => command.name === "ss-sessions").length, 1);
    assert.equal(commands.some((command: any) => command.name === "stela-sessions"), false);
    assert.equal(readdirSync(profile).includes("stela-sessions"), false);
  } finally { await instance.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test("native Pi: inherited extension in a helper never registers presence or session tools", { skip: !cli, timeout: 35_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "stela-peer-child-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  const instance = client(profile, scratch, "sender", true);
  try {
    await instance.request("get_state");
    const { commands } = await instance.request("get_commands");
    assert.equal(commands.some((command: any) => command.name === "ss-sessions"), false);
    const answered = instance.waitFor((event) => event.type === "message_end" && event.message?.role === "assistant");
    await instance.request("prompt", { message: "Inspect inherited tool declarations" });
    const answer = JSON.stringify((await answered).message.content);
    assert.match(answer, /CHILD_TOOLS:/); assert.doesNotMatch(answer, /ss_sessions_list|ss_sessions_send/);
    assert.equal(readdirSync(profile).includes("stela-sessions"), false);
  } finally { await instance.close(); rmSync(scratch, { recursive: true, force: true }); }
});
