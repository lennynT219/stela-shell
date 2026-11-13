import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { endpointName } from "../transport.ts";
import { newId, PEER_TASK_POLICY } from "../messages.ts";
import { WINDOWS_SESSIONS_HELPER } from "../transport-windows.ts";

const cli = process.env.STELA_TEST_PI_CLI;
const nativeAvailable = process.platform !== "win32" || existsSync(WINDOWS_SESSIONS_HELPER);
const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
const provider = fileURLToPath(new URL("./fixtures/provider.ts", import.meta.url));
const subagents = fileURLToPath(new URL("../../subagents/index.ts", import.meta.url));

/** Bounded event-driven test client: no provider polling, secrets, external profile or inference. */
function client(profile: string, home: string, role: string, child = false, action = "message") {
  const processChild = spawn(process.execPath, [cli!, "--offline", "--mode", "rpc", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
    "--extension", provider, "--extension", extension, ...(action === "delegate" ? ["--extension", subagents] : []), "--model", "stela-session-fixture/deterministic", "--thinking", "off"], {
    cwd: home, env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", NO_UPDATE_NOTIFIER: "1", STELA_SESSION_FIXTURE_ROLE: role, STELA_SESSION_FIXTURE_ACTION: action, ...(child ? { STELA_SUBAGENT_CHILD: "1" } : {}) }, stdio: ["pipe", "pipe", "pipe"],
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
    const admission = a.waitFor((event) => event.type === "tool_execution_end" && event.toolName === "stela_message");
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
      assert.equal(instance.events.filter((event) => event.type === "tool_execution_end" && event.toolName === "stela_message" && !event.isError).length, 1);
      for (const record of records) assert.doesNotMatch(JSON.stringify(instance.events), new RegExp(record.secret), "capabilities must not reach Pi context/events");
      assert.doesNotMatch(JSON.stringify(instance.events), /UNEXPECTED_FIXTURE|extension_ui_request.*(?:confirm|select)/);
    }
    if (busy) {
      const finished = b.events.findIndex((event) => event.type === "tool_execution_end" && event.toolName === "fixture_hold");
      // Boundary drafts emit entry_appended, not message_start for the custom entry.
      const delivered = b.events.findIndex((event) => event.type === "entry_appended" && event.entry?.customType === "stela-peer-message");
      assert.ok(finished >= 0 && delivered > finished, `peer context must follow native tool completion (tool=${finished}, entry=${delivered})`);
    }
    const discovered = a.events.find((event) => event.type === "tool_execution_end" && event.toolName === "stela_sessions");
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
    const used = b.events.filter((event) => event.type === "tool_execution_end" && event.toolName === (action === "delegate" ? "stela_delegate" : "write"));
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

test("native Pi: inherited extension in a helper never registers presence or session tools", { skip: !cli, timeout: 35_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "stela-peer-child-")), profile = join(scratch, "agent"); mkdirSync(profile, { mode: 0o700 });
  const instance = client(profile, scratch, "sender", true);
  try {
    await instance.request("get_state");
    const { commands } = await instance.request("get_commands");
    assert.equal(commands.some((command: any) => command.name === "stela-sessions"), false);
    const answered = instance.waitFor((event) => event.type === "message_end" && event.message?.role === "assistant");
    await instance.request("prompt", { message: "Inspect inherited tool declarations" });
    const answer = JSON.stringify((await answered).message.content);
    assert.match(answer, /CHILD_TOOLS:/); assert.doesNotMatch(answer, /stela_sessions|stela_message/);
    assert.equal(readdirSync(profile).includes("stela-sessions"), false);
  } finally { await instance.close(); rmSync(scratch, { recursive: true, force: true }); }
});
