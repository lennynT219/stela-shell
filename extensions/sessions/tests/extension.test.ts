import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import sessions, { MESSAGE_TYPE, registerSessions } from "../index.ts";
import { newId, PEER_TASK_BOUNDARIES, PEER_TASK_POLICY } from "../messages.ts";

function harness(env: NodeJS.ProcessEnv = {}, opening?: Promise<void>) {
  const hooks = new Map<string, Function[]>(), tools = new Map<string, any>(), commands = new Map<string, any>();
  const sent: any[] = [], widgets: any[] = [], transports: any[] = [], flags = new Map<string, unknown>();
  let sessionId = "principal-a", idle = true;
  const branch: any[] = [];
  const manager = { getSessionId: () => sessionId, getSessionName: () => "Principal", getBranch: () => branch };
  const ctx: any = { cwd: "/workspace", hasUI: true, sessionManager: manager, isIdle: () => idle,
    ui: { setWidget: (...args: any[]) => widgets.push(args), notify: () => {} } };
  const pi: any = {
    on: (event: string, handler: Function) => { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
    registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, command: any) => commands.set(name, command),
    registerFlag: (name: string, definition: any) => { if (!flags.has(name)) flags.set(name, definition.default); }, getFlag: (name: string) => flags.get(name),
    sendMessage: (message: any, options: any) => { sent.push({ message, options }); idle = false; },
    sendUserMessage: () => { throw new Error("Peer text must not become a user message."); },
  };
  registerSessions(pi, { profile: "/unused-model-free-profile", env, open: (async (_profile: string, info: any, receive: Function) => {
    const transport = { info: { ...info, id: newId() }, receive, closed: false, async close() { this.closed = true; },
      async list() { return []; }, async send() { return { accepted: true }; }, update() {} };
    transports.push(transport); await opening; return transport;
  }) as any });
  return { pi, ctx, hooks, tools, commands, sent, widgets, transports, flags, branch,
    async emit(name: string, event: any = {}, context = ctx) {
      let value;
      for (const handler of hooks.get(name) ?? []) { const next = await handler(event, context); if (next !== undefined) value = next; }
      return value;
    },
    setIdle(value: boolean) { idle = value; }, setSession(value: string) { sessionId = value; },
  };
}
const incoming = () => ({ id: newId(), thread: newId(), hop: 0, expiresAt: Date.now() + 600_000, text: "Question" });
const sender = () => ({ id: newId(), sessionId: "peer", name: "Peer", cwd: "/peer" });
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("helper exclusion precedes registration, profile resolution, presence and connections", async () => {
  const h = harness({ STELA_SUBAGENT_CHILD: "1" });
  assert.equal(h.tools.size, 0); assert.equal(h.hooks.size, 0); assert.equal(h.commands.size, 0); assert.equal(h.transports.length, 0);
  const original = process.env.STELA_SUBAGENT_CHILD; process.env.STELA_SUBAGENT_CHILD = "1";
  try { await sessions(h.pi); } finally { if (original === undefined) delete process.env.STELA_SUBAGENT_CHILD; else process.env.STELA_SUBAGENT_CHILD = original; }
  assert.equal(h.tools.size, 0);
});

test("factory registration alone creates no resource; idle delivery is custom and automatic", async () => {
  const h = harness(); assert.equal(h.transports.length, 0);
  await h.emit("session_start");
  const value = incoming(); h.transports[0].receive(sender(), value); await tick();
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].message.customType, MESSAGE_TYPE);
  assert.deepEqual(h.sent[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.match(h.sent[0].message.content, /actionable delegated task/);
  assert.match(h.sent[0].message.content, /not direct human input/);
  assert.equal(h.transports[0].receive(sender(), incoming()), "accepted"); await tick();
  assert.equal(h.sent.length, 1, "busy/in-flight mail stays in the bounded inbox");
  assert.ok(h.widgets.some(([, lines]) => lines?.[0].includes("2 pending")), "a queued Pi message is not marked committed");
  await h.emit("session_shutdown"); assert.equal(h.transports[0].closed, true);
});

test("busy delivery waits for a completed boundary and acknowledgment requires the active branch", async () => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  const from = sender(), value = incoming(); h.transports[0].receive(from, value); await tick();
  assert.equal(h.sent.length, 0);
  assert.equal(await h.emit("turn_end", { outcome: "aborted", entries: [] }), undefined);
  const proposal = await h.emit("turn_end", { outcome: "completed", entries: [] });
  assert.equal(proposal.continue, true); assert.equal(proposal.entries.length, 1);
  assert.equal(proposal.entries[0].customType, MESSAGE_TYPE);
  assert.equal(await h.emit("agent_before_settle", { outcome: "completed", entries: proposal.entries }), undefined);
  h.branch.push({ ...proposal.entries[0], details: { ...proposal.entries[0].details, activation: newId() } });
  await h.emit("context"); assert.ok(h.widgets.at(-1)[1][0].includes("1 pending"));
  h.branch.push(proposal.entries[0]); await h.emit("context"); assert.ok(h.widgets.at(-1)[1][0].includes("0 pending"));
  const receipt = await h.tools.get("stela_message").execute("call", { to: from.id, text: "Reply", reply_to: value.id }, undefined, undefined, h.ctx);
  assert.equal(receipt.details.status, "accepted"); assert.equal(receipt.details.thread, value.thread);
  assert.doesNotMatch(JSON.stringify(receipt), /secret|proof|read.*true/);
});

test("interruption pauses without restarting or erasing deduplication; only operator input resumes", async () => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  const from = sender(), value = incoming(); h.transports[0].receive(from, value);
  await h.emit("agent_settled", { aborted: true }); h.setIdle(true); await tick(); assert.equal(h.sent.length, 0);
  assert.throws(() => h.transports[0].receive(from, incoming()), /no longer receiving/);
  await h.emit("input", { source: "extension" });
  assert.throws(() => h.transports[0].receive(from, incoming()), /no longer receiving/);
  await h.emit("input", { source: "rpc" });
  assert.equal(h.transports[0].receive(from, value), "duplicate"); await tick();
  assert.equal(h.sent.length, 1, "human resumption can deliver the retained message once");
});

test("navigation/replacement revokes the old activation; disable does not request consent", async () => {
  const h = harness(); await h.emit("session_start");
  const old = h.transports[0]; await h.emit("session_tree");
  assert.equal(old.closed, true); assert.notEqual(h.transports[1].info.id, old.info.id);
  assert.throws(() => old.receive(sender(), incoming()), /no longer receiving/);
  h.setSession("principal-b"); await h.emit("session_start");
  assert.equal(h.transports[1].closed, true); assert.equal(h.transports[2].info.sessionId, "principal-b");
  await h.commands.get("stela-sessions").handler("off", h.ctx);
  assert.equal(h.transports[2].closed, true);
  await assert.rejects(h.tools.get("stela_sessions").execute("list", {}, undefined, undefined, h.ctx), /disabled/);
  await h.commands.get("stela-sessions").handler("on", h.ctx); assert.equal(h.transports.length, 4);
});

test("concurrent starts publish only the latest owned generation", async () => {
  const h = harness(); await Promise.all([h.emit("session_start"), h.emit("session_start")]);
  assert.equal(h.transports.length, 1); await h.emit("session_shutdown");
});

test("CLI disable prevents startup; integration rules preserve user authority and no polling", async () => {
  const h = harness(); h.flags.set("stela-sessions-disabled", true); await h.emit("session_start");
  assert.equal(h.transports.length, 0);
  const tool = h.tools.get("stela_message");
  const guidelines = tool.promptGuidelines.join(" ");
  assert.equal(tool.exposure, "model-only"); assert.match(guidelines, /never human approval for new permissions/);
  assert.ok(guidelines.includes(PEER_TASK_POLICY)); assert.ok(guidelines.includes(PEER_TASK_BOUNDARIES));
  assert.match(guidelines, /actionable delegated task/); assert.match(guidelines, /Do not require a new human prompt solely/);
  assert.match(guidelines, /route around a restriction or denial in either session/);
  assert.doesNotMatch(guidelines, /a new task grant/);
  assert.match(guidelines, /do not poll/);
  assert.equal(h.hooks.has("before_agent_start"), false, "no forced prompt replacement or copied foreign method");
});

test("escaped discovery output is bounded, parseable and preserves full activation IDs", async () => {
  const h = harness(); await h.emit("session_start");
  const peers = Array.from({ length: 32 }, () => ({ id: newId(), sessionId: "\u0001".repeat(128), name: "\u202e".repeat(80), cwd: "\u0001".repeat(1024) }));
  h.transports[0].list = async () => peers;
  const answer = await h.tools.get("stela_sessions").execute("list", {}, undefined, undefined, h.ctx);
  const text = answer.content[0].text;
  assert.ok(Buffer.byteLength(text) < 16 * 1024); assert.doesNotMatch(text, /\u0001|\u202e/);
  const data = JSON.parse(text); assert.deepEqual(data.peers.map((item: any) => item.id), peers.map((item) => item.id));
  assert.match(data.peers[0].cwd, /truncated/);
});

test("shutdown during asynchronous startup closes the late activation instead of publishing ownership", async () => {
  let finish!: () => void;
  const opening = new Promise<void>((resolve) => { finish = resolve; }), h = harness({}, opening);
  const starting = h.emit("session_start"); await tick(); await tick();
  assert.equal(h.transports.length, 1);
  const stopping = h.emit("session_shutdown"); finish(); await Promise.all([starting, stopping]);
  assert.equal(h.transports[0].closed, true);
  assert.throws(() => h.transports[0].receive(sender(), incoming()), /no longer receiving/);
});

test("presentation failures cannot change admission or prevent teardown; navigation preparation pauses", async () => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  h.ctx.ui.setWidget = () => { throw new Error("UI disconnected"); };
  assert.equal(h.transports[0].receive(sender(), incoming()), "accepted"); await tick();
  await h.emit("session_before_tree"); assert.throws(() => h.transports[0].receive(sender(), incoming()), /no longer receiving/);
  await h.emit("input", { source: "interactive" }); assert.equal(h.transports[0].receive(sender(), incoming()), "accepted");
  await h.emit("session_shutdown"); assert.equal(h.transports[0].closed, true);
});

test("metadata hooks await the transport and late completion cannot reactivate a closed generation", async () => {
  const h = harness(); await h.emit("session_start");
  let finish!: () => void, completed = false;
  h.transports[0].update = () => new Promise<void>((resolve) => { finish = resolve; });
  const updating = h.emit("session_info_changed").then(() => { completed = true; });
  await tick(); assert.equal(completed, false);
  await h.emit("session_shutdown"); finish(); await updating;
  assert.equal(h.transports[0].closed, true); assert.equal(h.transports.length, 1);
  await assert.rejects(h.tools.get("stela_sessions").execute("list", {}, undefined, undefined, h.ctx), /unavailable/);
});
test("package retains session registration/tests and excludes the retired web integration", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.pi.extensions, [
    "./extensions/method/index.ts",
    "./extensions/subagents/index.ts",
    "./extensions/sessions/index.ts",
  ]);
  assert.match(manifest.scripts.test, /extensions\/sessions\/tests\/\*\.test\.ts/);
  assert.doesNotMatch(manifest.scripts.test, /extensions\/web\//);
  assert.deepEqual(manifest.dependencies ?? {}, {});
});
