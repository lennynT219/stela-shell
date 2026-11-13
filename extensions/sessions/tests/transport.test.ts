import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createConnection, createServer } from "node:net";
import { once } from "node:events";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { Mailbox, newId } from "../messages.ts";
import { endpointName, IO_DEADLINE_MS, MAX_FRAME_BYTES, PeerTransport } from "../transport.ts";

const posix = { skip: process.platform === "win32", timeout: 15_000 };
function workspace(t: TestContext) {
  const scratch = mkdtempSync(join(tmpdir(), "stela-sessions-")), profile = join(scratch, "agent");
  mkdirSync(profile, { mode: 0o700 });
  t.after(() => { rmSync(scratch, { recursive: true, force: true }); if (process.platform !== "win32") rmSync(dirname(endpointName(profile, newId())), { recursive: true, force: true }); });
  return { scratch, profile };
}
async function node(t: TestContext, profile: string, name: string, box = new Mailbox()) {
  const transport = await PeerTransport.open(profile, { name, sessionId: name, cwd: "/fixture" }, (from, message) => box.accept(from, message));
  t.after(() => transport.close());
  return { transport, box };
}

test("local discovery, encrypted send, correlated reply, duplicate and owned cleanup", posix, async (t) => {
  const { profile } = workspace(t), a = await node(t, profile, "a"), b = await node(t, profile, "b");
  assert.deepEqual(await a.transport.list(), [b.transport.info]);
  assert.doesNotMatch(JSON.stringify(await a.transport.list()), /secret|endpoint|proof/);
  const value = a.box.prepare(b.transport.info.id, "PRIVATE_FIXTURE_TEXT");
  assert.deepEqual(await a.transport.send(b.transport.info.id, value), { accepted: true, duplicate: false });
  assert.deepEqual(await a.transport.send(b.transport.info.id, value), { accepted: true, duplicate: true });
  assert.equal(b.box.pending, 1); b.box.delivered(value.id);
  const reply = b.box.prepare(a.transport.info.id, "ANSWER", value.id);
  assert.equal((await b.transport.send(a.transport.info.id, reply)).accepted, true);
  assert.equal(a.box.next()?.message.replyTo, value.id);
  const record = readFileSync(join(profile, "stela-sessions", `${a.transport.info.id}.json`), "utf8");
  assert.doesNotMatch(record, /PRIVATE_FIXTURE_TEXT|ANSWER/);
  b.transport.update("renamed"); assert.equal((await a.transport.list())[0].name, "renamed");
  await b.transport.close(); assert.deepEqual(await a.transport.list(), []);
  assert.equal(existsSync(join(profile, "stela-sessions", `${b.transport.info.id}.json`)), false);
  assert.equal(existsSync(endpointName(a.transport.profile, b.transport.info.id)), false);
});

test("profile isolation and full UTF-8/escaped-text payloads", posix, async (t) => {
  const { scratch, profile } = workspace(t), other = join(scratch, "other"); mkdirSync(other, { mode: 0o700 });
  t.after(() => rmSync(dirname(endpointName(other, newId())), { recursive: true, force: true }));
  const a = await node(t, profile, "a"), b = await node(t, other, "b"), c = await node(t, profile, "c");
  assert.deepEqual(await b.transport.list(), []);
  await assert.rejects(a.transport.send(b.transport.info.id, a.box.prepare(b.transport.info.id, "Outside profile")), /presence/);
  for (const text of ["🙂".repeat(2048), "\u0000".repeat(8191) + "x"]) {
    const value = a.box.prepare(c.transport.info.id, text);
    assert.equal((await a.transport.send(c.transport.info.id, value)).accepted, true);
    assert.equal(c.box.next()!.message.text, text); c.box.delivered(value.id);
  }
});

test("unsafe presence permissions, symlinks, stale records and arbitrary endpoints are not trusted", posix, async (t) => {
  const { profile } = workspace(t), a = await node(t, profile, "a"), b = await node(t, profile, "b");
  const path = join(profile, "stela-sessions", `${b.transport.info.id}.json`), original = readFileSync(path, "utf8");
  chmodSync(path, 0o644); assert.deepEqual(await a.transport.list(), []);
  await assert.rejects(a.transport.send(b.transport.info.id, a.box.prepare(b.transport.info.id, "Denied")), /unsafe/);
  chmodSync(path, 0o600);
  const alias = join(profile, "stela-sessions", `${newId()}.json`); symlinkSync(path, alias);
  assert.equal((await a.transport.list()).length, 1);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(original), endpoint: "tcp://remote:1234" }));
  assert.deepEqual(await a.transport.list(), []);
  writeFileSync(path, original); await b.transport.close();
  writeFileSync(path, original, { mode: 0o600 });
  assert.deepEqual(await a.transport.list(), []);
  assert.equal(existsSync(path), true, "discovery never deletes an ambiguous/stale peer record");
});

test("oversized/unauthenticated frames and idle connections are closed without mailbox work", posix, async (t) => {
  const { profile } = workspace(t), a = await node(t, profile, "a");
  for (const input of [Buffer.alloc(MAX_FRAME_BYTES + 1, 120), Buffer.from('{"version":1}\n')]) {
    const socket = createConnection(endpointName(a.transport.profile, a.transport.info.id)); socket.on("error", () => {});
    const closed = once(socket, "close"); await once(socket, "connect"); socket.write(input); await closed;
  }
  const socket = createConnection(endpointName(a.transport.profile, a.transport.info.id)); socket.on("error", () => {});
  const closed = once(socket, "close"); await once(socket, "connect"); await closed;
  assert.equal(a.box.pending, 0); assert.ok(IO_DEADLINE_MS <= 2500, "the idle-connection deadline is bounded");
});

test("a squatted endpoint receives ciphertext, not plaintext, and cannot forge its ACK", posix, async (t) => {
  const { profile } = workspace(t), a = await node(t, profile, "a"), b = await node(t, profile, "b");
  const path = join(profile, "stela-sessions", `${b.transport.info.id}.json`), record = readFileSync(path);
  await b.transport.close(); writeFileSync(path, record, { mode: 0o600 });
  const endpoint = endpointName(a.transport.profile, b.transport.info.id);
  let captured = "";
  const fake = createServer((socket) => {
    socket.once("data", (bytes) => { captured = bytes.toString(); socket.end('{"accepted":true}\n'); });
  });
  await new Promise<void>((resolve) => fake.listen(endpoint, resolve)); chmodSync(endpoint, 0o600);
  t.after(() => new Promise<void>((resolve) => fake.close(() => resolve())));
  await assert.rejects(a.transport.send(b.transport.info.id, a.box.prepare(b.transport.info.id, "DO_NOT_DISCLOSE_FIXTURE")), /unconfirmed/);
  assert.ok(captured.length > 0); assert.doesNotMatch(captured, /DO_NOT_DISCLOSE_FIXTURE|secret/);
});

test("backpressure, abort and closed activation do not retry or enqueue extras", posix, async (t) => {
  const { profile } = workspace(t), a = await node(t, profile, "a"), b = await node(t, profile, "b");
  for (let i = 0; i < 8; i++) assert.equal((await a.transport.send(b.transport.info.id, a.box.prepare(b.transport.info.id, "Queued"))).accepted, true);
  assert.equal((await a.transport.send(b.transport.info.id, a.box.prepare(b.transport.info.id, "Overflow"))).accepted, false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(a.transport.send(b.transport.info.id, a.box.prepare(b.transport.info.id, "Aborted"), controller.signal), /abort/i);
  assert.equal(b.box.pending, 8);
  await a.transport.close(); await assert.rejects(a.transport.list(), /closed/);
});

test("insecure runtime directories fail closed without chmodding existing resources", posix, async (t) => {
  const { profile } = workspace(t), root = join(profile, "stela-sessions"); mkdirSync(root, { mode: 0o755 });
  await assert.rejects(PeerTransport.open(profile, { name: "a", sessionId: "a", cwd: "/" }, () => "accepted"), /private/);
  assert.deepEqual(readdirSync(root), []);
});

test("invalid sender proof or ciphertext tag cannot enqueue even a well-framed request", posix, async (t) => {
  const { profile } = workspace(t), a = await node(t, profile, "a"), b = await node(t, profile, "b");
  const presence = (id: string) => JSON.parse(readFileSync(join(profile, "stela-sessions", `${id}.json`), "utf8"));
  const sender = presence(a.transport.info.id), target = presence(b.transport.info.id);
  for (const failure of ["proof", "tag"]) {
    const base = { version: 1, id: newId(), from: sender.id, to: target.id }, nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(target.secret, "hex"), nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(base)));
    const data = Buffer.concat([cipher.update(JSON.stringify({ kind: "message", message: a.box.prepare(target.id, "Not authenticated") })), cipher.final()]).toString("hex");
    const fields = { ...base, nonce: nonce.toString("hex"), data, tag: cipher.getAuthTag().toString("hex") };
    if (failure === "tag") fields.tag = (fields.tag[0] === "0" ? "1" : "0") + fields.tag.slice(1);
    const signature = createHmac("sha256", Buffer.from(sender.secret, "hex")).update(JSON.stringify(fields)).digest("hex");
    const proof = failure === "proof" ? (signature[0] === "0" ? "1" : "0") + signature.slice(1) : signature;
    const socket = createConnection(endpointName(a.transport.profile, target.id)); socket.on("error", () => {});
    const closed = once(socket, "close"); await once(socket, "connect"); socket.write(JSON.stringify({ ...fields, proof }) + "\n"); await closed;
    assert.equal(b.box.pending, 0);
  }
});

test("Windows endpoint derivation is local/profile-specific, not a native-security check", () => {
  const id = newId();
  assert.match(endpointName("C:\\profile", id, "win32"), /^\\\\\.\\pipe\\stela-[a-f0-9]{32}-[a-f0-9]{32}$/);
  assert.notEqual(endpointName("C:\\profile", id, "win32"), endpointName("C:\\other", id, "win32"));
});

test("strict Windows transport remains unavailable before creating messaging state", { skip: process.platform !== "win32" }, async (t) => {
  const { profile } = workspace(t);
  await assert.rejects(PeerTransport.open(profile, { name: "a", sessionId: "a", cwd: "/" }, () => "accepted"), /unavailable on Windows/);
  assert.equal(existsSync(join(profile, "stela-sessions")), false);
});
