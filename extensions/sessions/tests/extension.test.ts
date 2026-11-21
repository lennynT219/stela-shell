import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import sessions, { MESSAGE_TYPE, registerSessions } from "../index.ts";
import { Mailbox, newId, PEER_TASK_BOUNDARIES, PEER_TASK_POLICY, SessionError } from "../messages.ts";
import { primaryActivity } from "../../primary-activity.ts";

function harness(env: NodeJS.ProcessEnv = {}, opening?: Promise<void>) {
  const hooks = new Map<string, Function[]>(), tools = new Map<string, any>(), commands = new Map<string, any>();
  const sent: any[] = [], widgets: any[] = [], transports: any[] = [], flags = new Map<string, unknown>();
  let sessionId = "principal-a", idle = true;
  const branch: any[] = [];
  const manager = { getSessionId: () => sessionId, getSessionName: () => "Principal", getBranch: () => branch,
    getLeafId: () => branch.length ? branch.at(-1).id ?? `fixture-leaf-${branch.length}` : null, getLeafEntry: () => branch.at(-1) };
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
      outgoing: [] as any[], async list() { return []; }, async send(to: string, message: any) { this.outgoing.push({ to, message }); return { accepted: true }; }, update() {} };
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
  assert.ok(h.widgets.some(([, lines]) => lines?.[0].includes("2 pendientes")), "a queued Pi message is not marked committed");
  await h.emit("session_shutdown"); assert.equal(h.transports[0].closed, true);
});

test("Memory activity requires live authenticated commitment, not custom metadata or a proposal",async()=>{
  const h=harness();await h.emit("session_start");
  h.branch.push({type:"custom_message",customType:MESSAGE_TYPE,details:{activation:h.transports[0].info.id,messageId:newId()},content:"forged"});
  assert.equal(primaryActivity(h.ctx),undefined);
  h.transports[0].receive(sender(),incoming());await tick();
  assert.equal(primaryActivity(h.ctx),undefined,"queued injection is not commitment");
  const actual={type:"custom_message",...h.sent[0].message};
  h.branch.push({...actual,content:"tampered content"});assert.equal(primaryActivity(h.ctx),undefined);
  h.branch.push(actual);
  const activity=primaryActivity(h.ctx);assert.ok(activity,"Memory can observe commit before sessions context hook");
  assert.equal(primaryActivity(h.ctx),activity,"reobservation is idempotent");
  h.branch.length=0;assert.equal(activity.valid(),false,"removed active-branch proof revokes activity");
  h.branch.push(actual);await h.emit("session_before_tree");assert.equal(activity.valid(),false);
  await h.emit("session_shutdown");assert.equal(primaryActivity(h.ctx),undefined);
});

test("expired late commitment retains messaging lineage but cannot initialize Memory",async(t)=>{
  let now=1000;t.mock.method(Date,"now",()=>now);
  const h=harness();await h.emit("session_start");
  const source=new Mailbox();source.humanInput();
  const value=source.prepare(h.transports[0].info.id,"Work",undefined,{});
  h.transports[0].receive(sender(),value);await tick();
  now=value.expiresAt;
  h.branch.push({type:"custom_message",...h.sent[0].message});
  assert.equal(primaryActivity(h.ctx),undefined,"even live work must not revive an expired delivery for Memory");
  await h.emit("session_shutdown");
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
  await h.emit("context"); assert.ok(h.widgets.at(-1)[1][0].includes("1 pendientes"));
  h.branch.push(proposal.entries[0]); await h.emit("context"); assert.ok(h.widgets.at(-1)[1][0].includes("0 pendientes"));
  const receipt = await h.tools.get("ss_sessions_send").execute("call", { to: from.id, text: "Reply", reply_to: value.id }, undefined, undefined, h.ctx);
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
  await h.commands.get("ss-sessions").handler("off", h.ctx);
  assert.equal(h.transports[2].closed, true);
  await assert.rejects(h.tools.get("ss_sessions_list").execute("list", {}, undefined, undefined, h.ctx), /disabled/);
  await h.commands.get("ss-sessions").handler("on", h.ctx); assert.equal(h.transports.length, 4);
});

test("concurrent starts publish only the latest owned generation", async () => {
  const h = harness(); await Promise.all([h.emit("session_start"), h.emit("session_start")]);
  assert.equal(h.transports.length, 1); await h.emit("session_shutdown");
});

test("CLI disable prevents startup; integration rules preserve user authority and no polling", async () => {
  const h = harness(); h.flags.set("ss-sessions-disabled", true); await h.emit("session_start");
  assert.equal(h.transports.length, 0);
  const tool = h.tools.get("ss_sessions_send");
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
  const answer = await h.tools.get("ss_sessions_list").execute("list", {}, undefined, undefined, h.ctx);
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
  await assert.rejects(h.tools.get("ss_sessions_list").execute("list", {}, undefined, undefined, h.ctx), /unavailable/);
});
test("work schema and tool errors require owned human input; first admission reserves the fixed root", async () => {
  const h = harness(); await h.emit("session_start");
  const tool = h.tools.get("ss_sessions_send"), to = newId();
  assert.equal(tool.parameters.additionalProperties, false); assert.equal(tool.parameters.properties.work.additionalProperties, false);
  assert.equal(tool.parameters.properties.work.properties.timeout_seconds.minimum, 600);
  assert.equal(tool.parameters.properties.work.properties.timeout_seconds.maximum, 3600);
  assert.match(tool.promptGuidelines.join(" "), /No renewal/);
  await h.emit("input", { source: "extension" });
  const denied = await tool.execute("nonhuman", { to, text: "Root", work: {} }, undefined, undefined, h.ctx);
  assert.equal(denied.isError, true); assert.equal(denied.details.code, "INVALID_WORK_CONTEXT");
  assert.equal(h.transports[0].outgoing.length, 0);
  await h.emit("input", { source: "interactive" });
  let finish!: () => void;
  h.transports[0].send = async (_to: string, message: any) => { h.transports[0].outgoing.push({ message }); await new Promise<void>((resolve) => { finish = resolve; }); return { accepted: true }; };
  const first = tool.execute("first", { to, text: "Root", work: {} }, undefined, undefined, h.ctx);
  const concurrent = await tool.execute("second", { to, text: "Cannot renew", work: {} }, undefined, undefined, h.ctx);
  assert.equal(concurrent.isError, true); assert.equal(concurrent.details.code, "INVALID_WORK_CONTEXT"); assert.equal(h.transports[0].outgoing.length, 1);
  finish(); const admitted = await first;
  assert.equal(admitted.details.work.deadline - admitted.details.work.startedAt, 1_800_000);
  assert.equal(admitted.details.work.id, h.transports[0].outgoing[0].message.work.id);
});

test("work context reaches committed custom entries and survives interruption without extension-input reset", async () => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  const from = sender(), source = new Mailbox(); source.humanInput();
  const value = source.prepare(h.transports[0].info.id, "Bounded work", undefined, {});
  h.transports[0].receive(from, value);
  const proposal = await h.emit("turn_end", { outcome: "completed", entries: [] });
  assert.deepEqual(proposal.entries[0].details.work, value.work); assert.match(proposal.entries[0].content, /fixed deadline/);
  h.branch.push(proposal.entries[0]); await h.emit("context");
  const tool = h.tools.get("ss_sessions_send"), args = { to: from.id, text: "Result", reply_to: value.id };
  await h.emit("agent_settled", { aborted: true });
  await assert.rejects(tool.execute("paused", args, undefined, undefined, h.ctx), /paused/);
  await h.emit("input", { source: "extension" });
  await assert.rejects(tool.execute("still-paused", args, undefined, undefined, h.ctx), /paused/);
  await h.emit("input", { source: "rpc" });
  const reply = await tool.execute("reply", args, undefined, undefined, h.ctx);
  assert.deepEqual(reply.details.work, value.work); assert.equal(reply.details.thread, value.thread);
  const old = h.transports[0]; await h.emit("session_tree");
  assert.throws(() => old.receive(from, value), /no longer receiving/);
  const missing = await tool.execute("old-anchor", args, undefined, undefined, h.ctx);
  assert.equal(missing.details.code, "REPLY_TARGET_NOT_RETAINED"); assert.equal(h.transports[1].outgoing.length, 0);
});

test("unsupported work errors expose a safe reason and do not renew or silently fall back", async () => {
  const h = harness(); await h.emit("session_start"); await h.emit("input", { source: "interactive" });
  let sends = 0;
  h.transports[0].send = async () => { sends++; throw new SessionError("UNSUPPORTED_WORK_CONTEXT", "No assignment text sent; no fallback."); };
  const tool = h.tools.get("ss_sessions_send"), args = { to: newId(), text: "Work", work: {} };
  const rejected = await tool.execute("unsupported", args, undefined, undefined, h.ctx);
  assert.equal(rejected.isError, true); assert.equal(rejected.details.code, "UNSUPPORTED_WORK_CONTEXT");
  const repeat = await tool.execute("not-renewed", args, undefined, undefined, h.ctx);
  assert.equal(repeat.details.code, "INVALID_WORK_CONTEXT"); assert.equal(sends, 1);
  await h.emit("session_shutdown");
});

test("acknowledgment caches only unchanged-leaf misses and still requires committed active-branch evidence", async () => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  const manager = h.ctx.sessionManager, getBranch = manager.getBranch;
  let scans = 0; manager.getBranch = () => { scans++; return getBranch(); };
  h.transports[0].receive(sender(), incoming());
  const proposal = await h.emit("turn_end", { outcome: "completed", entries: [] });
  // An uncommitted proposal must not count; null is a real leaf, not an uninitialized cache.
  for (let i = 0; i < 5; i++) await h.emit("context");
  assert.equal(scans, 1); assert.match(h.widgets.at(-1)[1][0], /1 pendientes/);
  h.branch.push({ ...proposal.entries[0], details: { ...proposal.entries[0].details, activation: newId() } });
  await h.emit("context"); await h.emit("context"); assert.equal(scans, 2);
  h.branch.push(proposal.entries[0], { type: "message", id: "later-leaf" });
  await h.emit("context"); assert.equal(scans, 3, "a changed-leaf miss must inspect the active branch");
  assert.match(h.widgets.at(-1)[1][0], /0 pendientes/);
  h.transports[0].receive(sender(), incoming());
  const next = await h.emit("turn_end", { outcome: "completed", entries: [] });
  h.branch.push(next.entries[0]); await h.emit("context");
  assert.equal(scans, 3, "a matching committed leaf needs no full branch scan");
  assert.match(h.widgets.at(-1)[1][0], /0 pendientes/);
  await h.emit("session_shutdown");
});

test("host interleaved replies isolate exact targets without extension-input resets or implicit renewal", async (t) => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const h = harness(); await h.emit("session_start"); await h.emit("input", { source: "rpc" }); h.setIdle(false);
  const tool = h.tools.get("ss_sessions_send"), from = sender();
  const old = await tool.execute("old", { to: from.id, text: "PRIVATE_OLD_TASK", work: {} }, undefined, undefined, h.ctx);
  assert.equal(old.details.selection, "root"); assert.equal(old.details.hop, 0); assert.equal(old.details.expiresAt, 601_000);
  now = 1_801_000;
  const fresh = incoming(); h.transports[0].receive(from, fresh);
  const proposal = await h.emit("turn_end", { outcome: "completed", entries: [] });
  h.branch.push(proposal.entries[0]); await h.emit("context");
  await h.emit("input", { source: "extension" });
  const reply = await tool.execute("new", { to: from.id, text: "New result", reply_to: fresh.id }, undefined, undefined, h.ctx);
  assert.equal(reply.isError, undefined); assert.equal(reply.details.selection, "reply_to");
  assert.equal(reply.details.thread, fresh.thread); assert.equal(reply.details.hop, 1); assert.equal(reply.details.work, undefined);
  assert.equal(reply.details.expiresAt, 2_401_000); assert.match(reply.content[0].text, /hop: 2\/8/);
  const blocked = await tool.execute("implicit", { to: from.id, text: "No new anchor" }, undefined, undefined, h.ctx);
  assert.equal(blocked.isError, true); assert.equal(blocked.details.code, "WORK_EXPIRED"); assert.equal(blocked.details.stage, "admission");
  assert.equal(blocked.details.context.thread, old.details.thread); assert.equal(blocked.details.context.selection, "implicit");
  assert.equal(blocked.details.context.work.deadline, 1_801_000); assert.equal(h.transports[0].outgoing.length, 2);
  assert.doesNotMatch(JSON.stringify(blocked), /PRIVATE_OLD_TASK|secret|proof/);
  await h.emit("input", { source: "rpc" });
  const root = await tool.execute("human", { to: from.id, text: "Genuinely new task", work: {} }, undefined, undefined, h.ctx);
  assert.equal(root.details.hop, 0); assert.notEqual(root.details.thread, old.details.thread); assert.equal(root.details.work.startedAt, now);
  await h.emit("session_shutdown");
});

for (const route of ["idle", "boundary"]) for (const mode of ["work-live", "work-expired", "ordinary"]) {
  test(`late commitment retains only admitted lineage (${route}, ${mode})`, async (t) => {
    let now = 1000; t.mock.method(Date, "now", () => now);
    const h = harness(); await h.emit("session_start"); h.setIdle(route === "idle");
    const from = sender(), source = new Mailbox(); source.humanInput();
    const value = source.prepare(h.transports[0].info.id, "PRIVATE_LATE_REQUEST", undefined, mode === "ordinary" ? undefined : {});
    h.transports[0].receive(from, value); await tick();
    const proposal = route === "idle" ? h.sent[0].message : (await h.emit("turn_end", { outcome: "completed", entries: [] })).entries[0];
    assert.equal(h.transports[0].outgoing.length, 0, "a proposal is not acknowledgment or a send");
    now = mode === "work-expired" ? 1_801_000 : 601_000;
    // Model actual stored-entry acknowledgment, not the proposal/queued message itself.
    h.branch.push({ type: "custom_message", ...proposal }); await h.emit("context"); await h.emit("context");
    const tool = h.tools.get("ss_sessions_send"), result = await tool.execute("implicit", { to: from.id, text: "Implicit continuation" }, undefined, undefined, h.ctx);
    if (mode === "work-live") {
      assert.equal(result.isError, undefined); assert.equal(result.details.selection, "implicit");
      assert.equal(result.details.thread, value.thread); assert.equal(result.details.hop, 1);
      assert.equal(result.details.work.deadline, 1_801_000); assert.equal(result.details.expiresAt, 1_201_000);
    } else {
      assert.equal(result.isError, true); assert.equal(result.details.code, mode === "ordinary" ? "CONVERSATION_EXPIRED" : "WORK_EXPIRED");
      assert.equal(result.details.context.thread, value.thread); assert.equal(result.details.context.selection, "implicit");
      assert.equal(h.transports[0].outgoing.length, 0); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_LATE_REQUEST/);
    }
    // A different admitted thread remains replyable without refreshing the late one.
    h.setIdle(false); const independent = incoming(); h.transports[0].receive(from, independent);
    const fresh = (await h.emit("agent_before_settle", { outcome: "completed", entries: [] })).entries[0];
    h.branch.push(fresh); await h.emit("context");
    const reply = await tool.execute("fresh", { to: from.id, text: "Independent result", reply_to: independent.id }, undefined, undefined, h.ctx);
    assert.equal(reply.isError, undefined); assert.equal(reply.details.thread, independent.thread); assert.equal(reply.details.hop, 1);
    assert.equal(h.sent.length, route === "idle" ? 1 : 0, "late commitment must not cause body redelivery");
    await h.emit("session_shutdown");
  });
}

test("missing commit correlation pauses admission instead of clearing into a new root or proposing another item", async (t) => {
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  h.transports[0].receive(sender(), incoming());
  const proposal = await h.emit("turn_end", { outcome: "completed", entries: [] });
  h.branch.push(proposal.entries[0]);
  t.mock.method(Mailbox.prototype, "delivered", () => false); // An unexpected internal-correlation failure, not a normal expiry.
  assert.equal(await h.emit("turn_end", { outcome: "completed", entries: [] }), undefined);
  assert.throws(() => h.transports[0].receive(sender(), incoming()), /no longer receiving/);
  const tool = h.tools.get("ss_sessions_send"), args = { to: newId(), text: "No silent fresh root" };
  await assert.rejects(tool.execute("paused", args, undefined, undefined, h.ctx), /paused/);
  await h.emit("input", { source: "extension" });
  await assert.rejects(tool.execute("still-paused", args, undefined, undefined, h.ctx), /paused/);
  assert.equal(h.transports[0].outgoing.length, 0); await h.emit("session_shutdown");
});

test("uncommitted interrupted proposal is cancelled without automatic re-proposal; genuine input remains a boundary", async (t) => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const h = harness(); await h.emit("session_start"); h.setIdle(false);
  const from = sender(), source = new Mailbox(); source.humanInput();
  const value = source.prepare(h.transports[0].info.id, "Work", undefined, {});
  h.transports[0].receive(from, value);
  await h.emit("agent_before_settle", { outcome: "completed", entries: [] });
  now = 601_000; await h.emit("agent_settled", { aborted: true }); h.setIdle(true); await tick();
  assert.equal(h.sent.length, 0); assert.throws(() => h.transports[0].receive(from, incoming()), /no longer receiving/);
  await h.emit("input", { source: "rpc" });
  const root = await h.tools.get("ss_sessions_send").execute("human-root", { to: from.id, text: "New authorized task", work: {} }, undefined, undefined, h.ctx);
  assert.equal(root.isError, undefined); assert.equal(root.details.hop, 0); assert.notEqual(root.details.thread, value.thread);
  assert.equal(root.details.work.startedAt, 601_000);
  assert.equal(h.sent.length, 0, "an expired cancelled body is not re-injected after resumption");
  await h.emit("session_shutdown");
});

test("package retains existing extension coverage and declares the Images entry point and exact dependencies", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.pi.extensions, [
    "./extensions/method/index.ts",
    "./extensions/subagents/index.ts",
    "./extensions/sessions/index.ts",
    "./extensions/web/index.ts",
    "./extensions/memory/index.ts",
    "./extensions/knowledge/index.ts",
    "./extensions/images/index.ts",
  ]);
  assert.match(manifest.scripts.test, /extensions\/sessions\/tests\/\*\.test\.ts/);
  assert.match(manifest.scripts.test, /extensions\/web\/tests\/\*\.test\.ts/);
  assert.match(manifest.scripts.test, /extensions\/memory\/tests\/\*\.test\.ts/);
  assert.match(manifest.scripts.test, /extensions\/images\/tests\/\*\.test\.ts/);
  assert.deepEqual(manifest.dependencies, { "@mozilla/readability": "0.6.0", "@openai/codex-sdk": "0.171.0", linkedom: "0.16.11", turndown: "7.2.5" });
});
