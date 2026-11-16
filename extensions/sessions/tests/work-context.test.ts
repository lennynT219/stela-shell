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
  assert.equal(right.next(), undefined); assert.equal(right.offer(), undefined); assert.equal(right.pending, 0); assert.equal(right.delivered(root.id), false);
  assert.throws(() => right.accept(a, root), code("MESSAGE_EXPIRED"));
  const altered = { ...root, expiresAt: now + 600_000 };
  assert.throws(() => right.accept(a, altered), code("MESSAGE_CONFLICT"));
  assert.equal(right.prepare(a.id, "Correlated reply to retained anchor", root.id).work?.deadline, 1_801_000);
});

for (const mode of ["work-live", "work-expired", "ordinary"]) test(`one text-free proposal survives pruning without restoring anchors or lowering hops (${mode})`, () => {
  let now = 1000;
  const from = peer(), box = new Mailbox(() => now), source = new Mailbox(() => now); source.humanInput();
  const root = source.prepare(from.id, "PRIVATE_PROPOSAL_BODY", undefined, mode === "ordinary" ? undefined : {});
  box.accept(from, root); assert.equal(box.offer()?.message.id, root.id);
  const state = box as any, proposal = state.offered;
  assert.deepEqual(Object.keys(proposal).sort(), ["id", "thread"]); assert.equal(proposal.thread.text, undefined);
  assert.equal(proposal.thread, state.threads.get(root.thread)); assert.equal(box.next()?.state, "accepted");
  // The same text-free thread object must learn a later branch's causal maximum.
  box.accept(from, { ...root, id: newId(), hop: 7 });
  now = mode === "work-expired" ? 1_801_000 : 601_000;
  assert.equal(box.pending, 0); assert.equal(box.offer(), undefined, "expiry cannot repropose a retained reservation");
  const retained = mode === "work-live" ? 2 : 0;
  assert.equal(state.history.size, retained); assert.equal(state.threads.size, retained ? 1 : 0);
  assert.equal(box.delivered(newId()), false); assert.equal(state.offered, proposal);
  assert.equal(box.delivered(root.id), true); assert.equal(box.delivered(root.id), false); assert.equal(state.offered, undefined);
  assert.equal(state.history.size, retained, "commit must not recreate pruned correlation/deduplication IDs");
  assert.equal(state.implicit.hop, 7); assert.equal(state.implicit.text, undefined);
  assert.throws(() => box.prepare(from.id, "Implicit continuation"), code(mode === "work-live" ? "HOP_LIMIT" : mode === "ordinary" ? "CONVERSATION_EXPIRED" : "WORK_EXPIRED"));
});

for (const work of [false, true]) test(`offered identity still rejects renewed peer metadata after its indexed history expires (${work ? "work" : "ordinary"})`, () => {
  let now = 1000;
  const from = peer(), box = new Mailbox(() => now), source = new Mailbox(() => now); source.humanInput();
  const root = source.prepare(from.id, "Original request", undefined, work ? {} : undefined);
  box.accept(from, root); assert.equal(box.offer()?.message.id, root.id);
  now = work ? 1_801_000 : 601_000;
  const forged: Envelope = { ...root, id: newId(), expiresAt: now + 600_000,
    ...(work ? { work: { ...root.work!, startedAt: now, deadline: now + 1_800_000 } } : {}) };
  assert.deepEqual(validateMessage(forged, now), forged, "standalone wire shape is valid; retained identity must reject the renewal");
  assert.throws(() => box.accept(from, forged), code("CONTEXT_MISMATCH"));
  if (work) {
    const { work: _work, ...downgraded } = forged;
    assert.throws(() => box.accept(from, { ...downgraded, id: newId() }), code("CONTEXT_MISMATCH"));
  }
  const otherThread = newId(), reusedId: Envelope = { ...forged, id: root.id, thread: otherThread,
    ...(work ? { work: { ...forged.work!, id: otherThread } } : {}) };
  assert.deepEqual(validateMessage(reusedId, now), reusedId);
  assert.throws(() => box.accept(from, reusedId), code("MESSAGE_CONFLICT"), "an outstanding proposal ID cannot be reused for a different fresh thread");
  assert.equal((box as any).history.size, 0); assert.equal((box as any).threads.size, 0); assert.equal((box as any).received, 1);
  assert.equal(box.delivered(root.id), true);
  assert.throws(() => box.prepare(from.id, "No renewed implicit context"), code(work ? "WORK_EXPIRED" : "CONVERSATION_EXPIRED"));
  source.humanInput(); const independent = source.prepare(from.id, "New independent admitted job", undefined, {});
  box.accept(from, independent);
  const reply = box.prepare(from.id, "Independent result", independent.id);
  assert.equal(reply.thread, independent.thread); assert.notEqual(reply.thread, root.thread); assert.equal(reply.hop, 1);
});

test("withdrawing an uncommitted proposal releases its sole reservation without acknowledging expired mail", () => {
  let now = 1000;
  const box = new Mailbox(() => now), from = peer(), first = { id: newId(), thread: newId(), hop: 0, expiresAt: 601_000, text: "First" };
  box.accept(from, first); assert.equal(box.offer()?.message.id, first.id);
  box.withdraw(); assert.equal((box as any).offered, undefined); assert.equal((box as any).implicit, undefined);
  now = 601_000;
  assert.equal(box.offer(), undefined); assert.equal(box.delivered(first.id), false);
  const next = { ...first, id: newId(), thread: newId(), expiresAt: 1_201_000 };
  box.accept(from, next); assert.equal(box.offer()?.message.id, next.id); assert.equal(box.delivered(next.id), true);
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

test("an independent exact reply is isolated, but cannot replace an expired implicit work boundary", () => {
  const p = pair(); p.setTime(1_801_000);
  const unrelated: Envelope = { id: newId(), thread: newId(), hop: 0, expiresAt: 2_401_000, text: "Unrelated fresh entry" };
  p.right.accept(p.a, unrelated); p.right.delivered(unrelated.id);
  const reply = p.right.prepare(p.a.id, "Reply to the genuinely new request", unrelated.id);
  assert.equal(reply.thread, unrelated.thread); assert.equal(reply.hop, 1); assert.equal(reply.expiresAt, 2_401_000); assert.equal(reply.work, undefined);
  assert.throws(() => p.right.prepare(p.a.id, "Cannot omit reference"), code("WORK_EXPIRED"));
  assert.throws(() => p.right.prepare(p.a.id, "Cannot renew", undefined, {}), code("WORK_EXPIRED"));
});

for (const expired of [false, true]) for (const freshWork of [false, true]) for (const samePeer of [false, true]) {
  test(`mixed threads: exact target isolates ${expired ? "expired" : "live"} old work from new ${freshWork ? "work" : "ordinary"} (${samePeer ? "same" : "different"} peer)`, () => {
    const p = pair();
    for (let hop = 1; hop <= 6; hop++) assert.equal(p.right.prepare(p.a.id, "Old causal branch").hop, hop);
    const now = expired ? 1_801_000 : 5000; p.setTime(now);
    const from = samePeer ? p.a : peer(), source = new Mailbox(() => now); source.humanInput();
    const fresh = source.prepare(p.b.id, "Genuinely independent admitted request", undefined, freshWork ? {} : undefined);
    p.right.accept(from, fresh); p.right.delivered(fresh.id);
    assert.throws(() => p.right.prepare(peer().id, "Wrong peer", fresh.id), code("REPLY_TARGET_NOT_RETAINED"));
    assert.throws(() => p.right.prepare(from.id, "No upgrade/renewal", fresh.id, {}), code("INVALID_WORK_CONTEXT"));
    const reply = p.right.prepare(from.id, "New result", fresh.id);
    assert.equal(reply.thread, fresh.thread); assert.equal(reply.replyTo, fresh.id); assert.equal(reply.hop, 1);
    assert.equal(reply.expiresAt, now + 600_000); assert.deepEqual(reply.work, fresh.work);
    assert.equal(source.accept(p.b, reply), "accepted");
    if (expired) {
      assert.throws(() => p.right.prepare(p.a.id, "Expired anchor", p.root.id), code("REPLY_TARGET_NOT_RETAINED"));
      assert.throws(() => p.right.prepare(p.a.id, "Implicit old task"), (error: unknown) => {
        assert.ok(code("WORK_EXPIRED")(error));
        assert.equal((error as SessionError).context?.selection, "implicit");
        assert.equal((error as SessionError).context?.thread, p.root.thread); return true;
      });
    } else {
      const old = p.right.prepare(p.a.id, "Still the old work", p.root.id);
      assert.equal(old.hop, 7); assert.deepEqual(old.work, p.root.work); assert.equal(old.expiresAt, 605_000);
      assert.throws(() => p.right.prepare(p.a.id, "Exhausted old anchor", p.root.id), code("HOP_LIMIT"));
      assert.throws(() => p.right.prepare(p.a.id, "Implicit old task"), code("HOP_LIMIT"));
    }
    // Switching targets changes neither thread's high-water nor the implicit boundary.
    const second = p.right.prepare(from.id, "Second fresh result", fresh.id);
    assert.equal(second.hop, 2); assert.deepEqual(second.work, fresh.work); assert.equal(second.thread, fresh.thread);
  });
}

test("ordinary exact replies use only their own hop/deadline, even after another ordinary thread commits", () => {
  const from = peer(), box = new Mailbox(() => 1000);
  const old = { id: newId(), thread: newId(), hop: 0, expiresAt: 601_000, text: "First ordinary task" };
  const newer = { ...old, id: newId(), thread: newId(), hop: 7, expiresAt: 50_000 };
  box.accept(from, old); box.delivered(old.id); box.accept(from, newer); box.delivered(newer.id);
  const reply = box.prepare(from.id, "Old exact answer", old.id);
  assert.equal(reply.hop, 1); assert.equal(reply.expiresAt, 601_000); assert.equal(reply.thread, old.thread);
  assert.throws(() => box.prepare(from.id, "New exhausted answer", newer.id), code("HOP_LIMIT"));
  assert.throws(() => box.prepare(from.id, "Implicit exhausted answer"), code("HOP_LIMIT"));
  // Uncorrelated ordinary traffic cannot extend a retained ordinary deadline either.
  assert.throws(() => box.accept(from, { ...old, id: newId(), expiresAt: 601_001 }), code("INVALID_LIFETIME"));
  assert.throws(() => box.accept(from, { ...newer, id: newId(), expiresAt: 50_001 }), code("CONTEXT_MISMATCH"));
});

test("independent traffic preserves work peer/metadata/replay guards and retained high-water after genuine input", () => {
  const p = pair(), from = peer(), source = new Mailbox(() => 1000); source.humanInput();
  const fresh = source.prepare(p.b.id, "Independent work", undefined, {});
  p.right.accept(from, fresh); p.right.delivered(fresh.id);
  const reply = p.right.prepare(from.id, "Fresh result", fresh.id);
  assert.throws(() => p.right.accept(from, { ...fresh, id: newId(), hop: 2, work: { ...fresh.work!, deadline: fresh.work!.deadline + 1 } }), code("CONTEXT_MISMATCH"));
  const { work: _work, ...downgraded } = fresh;
  assert.throws(() => p.right.accept(from, { ...downgraded, id: newId(), hop: 2 }), code("CONTEXT_MISMATCH"));
  assert.throws(() => p.right.accept(p.a, { ...fresh, id: newId(), replyTo: reply.id, hop: 2 }), code("CONTEXT_MISMATCH"));
  assert.equal(p.right.accept(from, fresh), "duplicate");
  assert.equal(p.right.prepare(from.id, "No replay reset", fresh.id).hop, 2);
  // A human reset permits a new root, but cannot erase a retained thread's causal maximum.
  p.right.humanInput(); assert.equal(p.right.prepare(from.id, "Retained explicit result", fresh.id).hop, 3);
});

test("thread index stays bounded with history, and expiry pruning preserves only the implicit sentinel", () => {
  let now = 1000;
  const box = new Mailbox(() => now), from = peer(), internals = box as any;
  for (let i = 0; i < 64; i++) { box.humanInput(); box.prepare(from.id, "Independent authorized root", undefined, {}); }
  assert.equal(internals.history.size, 64); assert.equal(internals.threads.size, 64);
  for (const value of internals.threads.values()) assert.equal(value.text, undefined, "the index must not copy message bodies");
  now = 601_000; assert.equal(box.pending, 0); assert.equal(internals.threads.size, 64);
  now = 1_801_000; assert.equal(box.pending, 0); assert.equal(internals.history.size, 0); assert.equal(internals.threads.size, 0);
  assert.equal(internals.implicit.retained, 0); assert.equal(internals.implicit.text, undefined);
  assert.throws(() => box.prepare(from.id, "No automatic fresh root"), code("WORK_EXPIRED"));
  box.humanInput(); assert.equal(box.prepare(from.id, "Genuinely new root", undefined, {}).hop, 0);
  assert.equal(internals.history.size, 1); assert.equal(internals.threads.size, 1);
});

test("hot mailbox lookups do not rescan history before the next expiry; clocks are not benchmarked", (t) => {
  let now = 1000;
  const box = new Mailbox(() => now), source = new Mailbox(() => now), from = peer(); source.humanInput();
  const root = source.prepare(from.id, "Work", undefined, {}); box.accept(from, root); box.delivered(root.id);
  const history = (box as any).history as Map<string, unknown>, iterate = history[Symbol.iterator].bind(history);
  let scans = 0;
  t.mock.method(history, Symbol.iterator, () => { scans++; return iterate(); });
  t.mock.method(history, "values", () => { throw new Error("No linear metadata/hop scan on a send or admission"); });
  for (let i = 0; i < 4; i++) {
    const next = { id: newId(), thread: newId(), hop: 0, text: "Independent ordinary", expiresAt: 601_000 };
    box.accept(from, next); assert.equal(box.next()?.message.id, next.id); assert.equal(box.pending, 1);
    box.delivered(next.id); assert.equal(box.prepare(from.id, "Exact result", next.id).hop, 1);
  }
  assert.equal(scans, 0);
  now = 601_000; assert.equal(box.pending, 0); assert.equal(scans, 1);
  for (let i = 0; i < 4; i++) assert.equal(box.pending, 0);
  assert.equal(scans, 1, "unchanged post-prune reads do not rescan");
  assert.equal(box.prepare(from.id, "Work anchor survived TTL", root.id).hop, 1);
  now = 1_801_000; assert.equal(box.pending, 0); assert.equal(scans, 2);
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
