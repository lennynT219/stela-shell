import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { test } from "node:test";
import { Mailbox, envelope, newId, SessionError, validateMessage, workContext, workSeconds, type Envelope, type PeerInfo, type SessionCode } from "../messages.ts";
import { answer, decode, encode, IO_DEADLINE_MS, MAX_FRAME_BYTES, presence, receipt, seal, sendBounded, unseal, type Payload, type Presence } from "../protocol.ts";
import { bridgeFrame } from "../transport-windows.ts";

const peer = (): PeerInfo => ({ id: newId(), sessionId: "synthetic", name: "Work fixture", cwd: "/synthetic" });
const code = (expected: SessionCode) => (error: unknown) => error instanceof SessionError && error.code === expected;
function pair() {
  let time = 1000;
  const a = peer(), b = peer(), left = new Mailbox(() => time), right = new Mailbox(() => time);
  left.humanInput();
  const root = left.prepare(b.id, "Bounded assignment", undefined, {});
  right.accept(a, root); right.delivered(root.id);
  return { a, b, left, right, root, setTime(value: number) { time = value; } };
}
const record = (): Presence => ({ version: 1, ...peer(), pid: process.pid, secret: randomBytes(32).toString("hex") });
function signed(value: Record<string, unknown>, peer: Presence) {
  return { ...value, proof: createHmac("sha256", Buffer.from(peer.secret, "hex")).update(JSON.stringify(value)).digest("hex") };
}

test("work admission requires genuine-input eligibility and fixes the approved time bounds once", () => {
  const a = peer(), box = new Mailbox(() => 1000);
  assert.throws(() => box.prepare(a.id, "Not human-originated", undefined, {}), code("INVALID_WORK_CONTEXT"));
  box.humanInput();
  const root = box.prepare(a.id, "Root", undefined, {});
  // Independently derived from the requirements: 30min=1,800,000ms, max60min=3,600,000ms.
  assert.deepEqual(root.work, { version: 1, id: root.thread, startedAt: 1000, deadline: 1_801_000 });
  assert.equal(root.expiresAt, 601_000); assert.equal(root.hop, 0);
  assert.throws(() => box.prepare(a.id, "Cannot renew", undefined, {}), code("INVALID_WORK_CONTEXT"));
  assert.equal(box.prepare(a.id, "Implicit inheritance").work?.deadline, 1_801_000);
  box.humanInput();
  assert.equal(box.prepare(a.id, "Maximum", undefined, { timeout_seconds: 3600 }).work?.deadline, 3_601_000);
  box.humanInput();
  assert.equal(box.prepare(a.id, "Minimum", undefined, { timeout_seconds: 600 }).work?.deadline, 601_000);
  for (const timeout_seconds of [599, 3601, 600.5, NaN, Infinity, null, "1800"]) assert.throws(() => workSeconds({ timeout_seconds }), code("INVALID_WORK_CONTEXT"));
  assert.throws(() => workSeconds({ deadline: 999999999 }), /Unexpected/);
  assert.throws(() => workSeconds(null), /object/);
});

test("ordinary automatic context cannot upgrade, and an ordinary send consumes fresh-root eligibility", () => {
  const a = peer(), box = new Mailbox(() => 1000);
  box.humanInput(); box.prepare(a.id, "Ordinary first");
  assert.throws(() => box.prepare(a.id, "Upgrade", undefined, {}), code("INVALID_WORK_CONTEXT"));
  const ordinary: Envelope = { id: newId(), thread: newId(), hop: 0, expiresAt: 601_000, text: "Ordinary input" };
  box.accept(a, ordinary); box.delivered(ordinary.id);
  assert.throws(() => box.prepare(a.id, "Upgrade by reply", ordinary.id, {}), code("INVALID_WORK_CONTEXT"));
});

test("fresh result after minute ten correlates to retained metadata without renewing the work deadline", () => {
  const p = pair(); p.setTime(661_000); // Eleven minutes after admission, not wall-clock waiting.
  const reply = p.right.prepare(p.a.id, "Long work result", p.root.id);
  assert.equal(reply.expiresAt, 1_261_000); assert.equal(reply.work?.deadline, 1_801_000);
  assert.equal(reply.hop, 1); assert.equal(p.left.accept(p.b, reply), "accepted"); p.left.delivered(reply.id);
  p.setTime(1_800_999);
  const last = p.left.prepare(p.b.id, "Last bounded follow-up", reply.id);
  assert.equal(last.expiresAt, 1_801_000); assert.equal(last.work?.startedAt, 1000);
  p.right.accept(p.a, last); p.right.delivered(last.id);
  p.setTime(1_801_000);
  assert.throws(() => p.right.prepare(p.a.id, "At deadline"), code("WORK_EXPIRED"));
  assert.throws(() => p.right.prepare(p.a.id, "No automatic renewal", undefined, {}), code("WORK_EXPIRED"));
  p.right.humanInput();
  assert.equal(p.right.prepare(p.a.id, "New authorized root", undefined, {}).work?.startedAt, 1_801_000);
});

test("expired queued work is never delivered, while its bounded correlation/deduplication ID remains", () => {
  let now = 1000;
  const a = peer(), b = peer(), left = new Mailbox(() => now), right = new Mailbox(() => now);
  left.humanInput(); const root = left.prepare(b.id, "Queued", undefined, {}); right.accept(a, root);
  now = 601_000;
  assert.equal(right.next(), undefined); assert.equal(right.pending, 0); assert.equal(right.delivered(root.id), false);
  assert.throws(() => right.accept(a, root), code("MESSAGE_EXPIRED"));
  const altered = { ...root, expiresAt: now + 600_000 };
  assert.throws(() => right.accept(a, altered), code("MESSAGE_CONFLICT"));
  assert.equal(right.prepare(a.id, "Correlated reply to retained anchor", root.id).work?.deadline, 1_801_000);
});

test("work replies bind exact peer, work, thread and immutable metadata; replay cannot lower hops", () => {
  const p = pair(), reply = p.right.prepare(p.a.id, "Answer", p.root.id);
  assert.throws(() => p.left.accept(peer(), reply), code("CONTEXT_MISMATCH"));
  assert.throws(() => p.left.accept(p.b, { ...reply, thread: newId() }), code("CONTEXT_MISMATCH"));
  for (const work of [{ ...reply.work!, id: newId() }, { ...reply.work!, deadline: reply.work!.deadline + 1 }, { ...reply.work!, startedAt: 0 }]) {
    assert.throws(() => p.left.accept(p.b, { ...reply, work }), code("CONTEXT_MISMATCH"));
  }
  assert.throws(() => p.left.accept(p.b, { ...reply, hop: 0 }), code("CONTEXT_MISMATCH"));
  assert.equal(p.left.accept(p.b, reply), "accepted"); assert.equal(p.left.accept(p.b, reply), "duplicate");
  assert.throws(() => p.left.accept(p.b, { ...reply, id: newId(), replyTo: undefined }), code("HOP_LIMIT"));
  const { work: _work, ...downgraded } = reply;
  assert.throws(() => p.left.accept(p.b, { ...downgraded, id: newId() }), code("CONTEXT_MISMATCH"));
});

test("omitted or older replies cannot launder work identity, causal hop, lifetime or expiry", () => {
  const p = pair();
  const one = p.right.prepare(p.a.id, "One", p.root.id); p.left.accept(p.b, one); p.left.delivered(one.id);
  const two = p.left.prepare(p.b.id, "Two"); p.right.accept(p.a, two); p.right.delivered(two.id);
  const three = p.right.prepare(p.a.id, "Older anchor", p.root.id);
  assert.equal(three.hop, 3); assert.deepEqual(three.work, p.root.work);
  let current = three;
  for (let hop = 3; hop < 8; hop++) {
    const receiver = hop % 2 ? p.left : p.right, sender = hop % 2 ? p.b : p.a;
    receiver.accept(sender, current); receiver.delivered(current.id);
    if (hop < 7) current = receiver.prepare(sender.id, "No correlation fields");
    else assert.throws(() => receiver.prepare(sender.id, "Ninth hop"), code("HOP_LIMIT"));
  }
});

test("delayed correlated branch results cannot lower the active work hop or lose their valid anchor", () => {
  const p = pair(), c = peer(), third = new Mailbox(() => 1000);
  const branch = p.left.prepare(c.id, "Independent branch"); third.accept(p.a, branch); third.delivered(branch.id);
  const fast = third.prepare(p.a.id, "Fast branch result", branch.id); p.left.accept(c, fast); p.left.delivered(fast.id);
  const delayed = p.right.prepare(p.a.id, "Earlier branch result", p.root.id);
  assert.equal(delayed.hop, 1); assert.equal(fast.hop, 2);
  assert.equal(p.left.accept(p.b, delayed), "accepted"); p.left.delivered(delayed.id);
  assert.equal(p.left.prepare(p.b.id, "Follow-up on old anchor", delayed.id).hop, 3);
});

test("a committed unrelated entry cannot replace even an expired active work boundary", () => {
  const p = pair(); p.setTime(1_801_000);
  const unrelated: Envelope = { id: newId(), thread: newId(), hop: 0, expiresAt: 2_401_000, text: "Unrelated fresh entry" };
  p.right.accept(p.a, unrelated); p.right.delivered(unrelated.id);
  assert.throws(() => p.right.prepare(p.a.id, "Cannot downgrade", unrelated.id), code("WORK_EXPIRED"));
  assert.throws(() => p.right.prepare(p.a.id, "Cannot omit reference"), code("WORK_EXPIRED"));
});

test("work admission does not reset automatic send or receive budgets", () => {
  let now = 1000;
  const a = peer(), b = peer(), box = new Mailbox(() => now), source = new Mailbox(() => now);
  box.humanInput(); for (let i = 0; i < 15; i++) box.prepare(a.id, "Ordinary send");
  source.humanInput(); const work = source.prepare(b.id, "Work", undefined, {}); box.accept(a, work); box.delivered(work.id);
  box.prepare(a.id, "Sixteenth send", work.id);
  assert.throws(() => box.prepare(a.id, "Seventeenth send"), code("SEND_BUDGET"));
  const receives = new Mailbox(() => now);
  for (let i = 0; i < 15; i++) {
    const value = { id: newId(), thread: newId(), hop: 0, expiresAt: now + 600_000, text: "Ordinary incoming" };
    receives.accept(a, value); receives.delivered(value.id);
  }
  receives.accept(a, work); receives.delivered(work.id);
  assert.throws(() => receives.accept(a, { ...work, id: newId(), hop: 1 }), code("RECEIVE_BUDGET"));
});

test("work history stays capped at sixty-four live IDs after delivery TTL, without eviction", () => {
  let now = 1000;
  const a = peer(), box = new Mailbox(() => now);
  for (let i = 0; i < 64; i++) { box.humanInput(); box.prepare(a.id, "Work anchor", undefined, {}); }
  now = 661_000; box.humanInput();
  assert.throws(() => box.prepare(a.id, "No eviction", undefined, {}), code("STATE_FULL"));
  now = 1_801_000; box.humanInput();
  assert.equal(box.prepare(a.id, "Expired IDs pruned", undefined, {}).hop, 0);
});

test("work codec is strict and ordinary envelopes/presence retain their exact v1 schemas", () => {
  const p = pair();
  assert.throws(() => envelope(p.root, 1000), /Unexpected/);
  assert.throws(() => workContext({ ...p.root.work, version: 2 }, 1000), code("INVALID_WORK_CONTEXT"));
  assert.throws(() => workContext({ ...p.root.work, deadline: 3_601_001 }, 1000), code("INVALID_WORK_CONTEXT"));
  assert.throws(() => workContext({ ...p.root.work, startedAt: 1001 }, 1000), code("INVALID_WORK_CONTEXT"));
  assert.throws(() => validateMessage({ ...p.root, approval: true }, 1000), /Unexpected/);
  const r = record(); assert.throws(() => presence({ ...r, workVersion: 1 }, r.id), /Unexpected/);
});

test("authenticated work query has no assignment text and its response is request/activation/version bound", async (t) => {
  t.mock.method(Date, "now", () => 1000);
  const a = record(), b = record(), request = seal(a, b, { kind: "work_support", version: 1 });
  assert.deepEqual(unseal(request, b), { kind: "work_support", version: 1 });
  let received = 0;
  const raw = decode(await answer(request, b, () => a, () => { received++; return "accepted"; }));
  assert.deepEqual(receipt(raw, request, a.id, b, "work_support"), { accepted: true }); assert.equal(received, 0);
  assert.throws(() => receipt(raw, seal(a, b, { kind: "work_support", version: 1 }), a.id, b, "work_support"), /acknowledgment/);
  assert.throws(() => receipt(raw, request, newId(), b, "work_support"), /acknowledgment/);
  for (const changes of [{ workVersion: 2 }, { supported: false }, { from: newId() }, { kind: "work_message" }, { secret: b.secret }]) {
    const { proof: _proof, ...base } = raw as Record<string, unknown>;
    assert.throws(() => receipt(signed({ ...base, ...changes }, b), request, a.id, b, "work_support"));
  }
  const ordinaryAck = signed({ version: 1, id: request.id, from: b.id, to: a.id, accepted: true }, b);
  assert.throws(() => receipt(ordinaryAck, request, a.id, b, "work_support"));
  assert.throws(() => unseal(seal(a, b, { kind: "work_support", version: 2 } as never), b), /version/);
  assert.throws(() => unseal(seal(a, b, { kind: "work_support", version: 1, text: "SECRET_ASSIGNMENT" } as never), b), /Unexpected/);
});

test("strict work payload/receipt transports fresh messages and safe rejection codes, not v1 extras", async (t) => {
  const p = pair(); p.setTime(661_000); t.mock.method(Date, "now", () => 661_000);
  const reply = p.right.prepare(p.a.id, "Result", p.root.id), { work, ...plain } = reply;
  const a = record(), b = record(), payload: Payload = { kind: "work_message", version: 1, work: work!, message: plain };
  const request = seal(a, b, payload);
  assert.deepEqual(unseal(request, b), payload);
  const raw = decode(await answer(request, b, () => a, (_from, value) => { assert.deepEqual(value, reply); return "accepted"; }));
  assert.deepEqual(receipt(raw, request, a.id, b, "work_message"), { accepted: true, duplicate: false });
  assert.throws(() => receipt(raw, request, a.id, b), /Unexpected/);
  const rejected = decode(await answer(request, b, () => a, () => { throw new SessionError("STATE_FULL", "DO_NOT_LEAK_PRIVATE_PATH"); }));
  const failure = receipt(rejected, request, a.id, b, "work_message");
  assert.equal(failure.accepted, false); assert.equal(failure.code, "STATE_FULL"); assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_PATH/);
  const ordinary = seal(a, b, { kind: "message", message: plain });
  const ordinaryRaw = decode(await answer(ordinary, b, () => a, () => { throw new SessionError("STATE_FULL", "private"); }));
  assert.deepEqual(Object.keys(ordinaryRaw as object).sort(), ["accepted", "error", "from", "id", "proof", "to", "version"]);
  assert.equal(receipt(ordinaryRaw, ordinary, a.id, b).code, undefined);
  for (const invalid of [{ ...payload, version: 2 }, { ...payload, message: reply }, { ...payload, extra: true }]) assert.throws(() => unseal(seal(a, b, invalid as never), b));
});

test("maximally escaped work payload stays within unchanged encrypted/native framing bounds", () => {
  const now = Date.now(), box = new Mailbox(() => now), a = record(), b = record(); box.humanInput();
  const { work, ...message } = box.prepare(b.id, "\u0000".repeat(8191) + "x", undefined, { timeout_seconds: 3600 });
  const bytes = encode(seal(a, b, { kind: "work_message", version: 1, work: work!, message }));
  assert.ok(bytes.length < MAX_FRAME_BYTES); assert.ok(bridgeFrame(5, 1, [Buffer.from(b.id), Buffer.alloc(4), bytes]).length < 140 * 1024);
  assert.equal(unseal(JSON.parse(bytes.toString()), b).kind, "work_message");
});

test("unsupported or unconfirmed negotiation sends one text-free query, with no fallback/retry", async () => {
  const box = new Mailbox(), a = peer(); box.humanInput(); const value = box.prepare(a.id, "SECRET_ASSIGNMENT", undefined, {});
  for (const mode of ["old", "negative", "unknown-ack"]) {
    const sent: Payload[] = [];
    await assert.rejects(sendBounded(value, undefined, async () => async (payload) => {
      sent.push(payload); if (mode === "negative") return { accepted: false }; throw new Error(mode);
    }), code("UNSUPPORTED_WORK_CONTEXT"));
    assert.deepEqual(sent, [{ kind: "work_support", version: 1 }]); assert.doesNotMatch(JSON.stringify(sent), /SECRET_ASSIGNMENT/);
  }
});

test("negotiation and assignment share one absolute deadline, even if a timer has not fired", async (t) => {
  let now = 0; t.mock.method(performance, "now", () => now);
  const box = new Mailbox(), a = peer(); box.humanInput(); const value = box.prepare(a.id, "Not sent after negotiation deadline", undefined, {});
  const sent: Payload[] = [];
  await assert.rejects(sendBounded(value, undefined, async () => async (payload) => {
    sent.push(payload); now = IO_DEADLINE_MS; return { accepted: true };
  }), code("DELIVERY_UNCONFIRMED"));
  assert.equal(sent.length, 1); assert.equal(sent[0].kind, "work_support");
});

test("cancellation during negotiation cannot send work text or create a second I/O budget", async () => {
  const controller = new AbortController(), box = new Mailbox(), a = peer(); box.humanInput(); const value = box.prepare(a.id, "Secret", undefined, {});
  let operations = 0;
  await assert.rejects(sendBounded(value, controller.signal, async (signal) => async () => {
    operations++; controller.abort(); assert.equal(signal?.aborted, true); return { accepted: true };
  }), code("DELIVERY_UNCONFIRMED"));
  assert.equal(operations, 1);
  await assert.rejects(sendBounded(value, controller.signal, async () => { throw new Error("Must not connect"); }), /abort/i);
});

test("lost work-send response reports uncertainty without sending another query or message", async () => {
  const box = new Mailbox(), a = peer(); box.humanInput(); const value = box.prepare(a.id, "Assignment", undefined, {});
  const sent: Payload[] = [];
  await assert.rejects(sendBounded(value, undefined, async () => async (payload) => {
    sent.push(payload); if (payload.kind === "work_support") return { accepted: true }; throw new Error("Private raw wire detail");
  }), (error: unknown) => code("DELIVERY_UNCONFIRMED")(error) && !String(error).includes("Private raw wire detail"));
  assert.deepEqual(sent.map((payload) => payload.kind), ["work_support", "work_message"]);
});

test("negotiation cannot refresh a message that expired while support was being established", async (t) => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const box = new Mailbox(() => now), a = peer(); box.humanInput(); const value = box.prepare(a.id, "Expiring", undefined, {});
  const sent: Payload[] = [];
  await assert.rejects(sendBounded(value, undefined, async () => async (payload) => {
    sent.push(payload); now = 601_000; return { accepted: true };
  }), code("MESSAGE_EXPIRED"));
  assert.equal(sent.length, 1);
});
