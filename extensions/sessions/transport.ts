import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { envelope, exactKeys, identifier, newId, object, type Envelope, type PeerInfo } from "./messages.ts";

// Worst-case JSON escaping of an 8 KiB message, then hex ciphertext, still fits.
export const MAX_FRAME_BYTES = 128 * 1024;
export const MAX_RECORD_BYTES = 4096;
export const MAX_SCAN_ENTRIES = 128;
export const MAX_PEERS = 32;
export const IO_DEADLINE_MS = 2000;
const MAX_CONNECTIONS = 8, MAX_OUTBOUND = 4;
const HEX64 = /^[a-f0-9]{64}$/;
interface Presence extends PeerInfo { version: 1; pid: number; secret: string }
interface Packet { version: 1; id: string; from: string; to: string; nonce: string; data: string; tag: string; proof: string }
export interface Receipt { accepted: boolean; duplicate?: boolean; error?: string }
type Payload = { kind: "ping" } | { kind: "message"; message: Envelope };

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const sign = (key: string, value: unknown) => createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify(value)).digest("hex");
function matches(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && HEX64.test(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
function header(packet: Packet) { return { version: packet.version, id: packet.id, from: packet.from, to: packet.to }; }
function unsigned(packet: Packet) { return { ...header(packet), nonce: packet.nonce, data: packet.data, tag: packet.tag }; }
function packet(value: unknown): Packet {
  const data = object(value);
  exactKeys(data, ["version", "id", "from", "to", "nonce", "data", "tag", "proof"]);
  if (data.version !== 1 || typeof data.nonce !== "string" || !/^[a-f0-9]{24}$/.test(data.nonce) || typeof data.tag !== "string" || !/^[a-f0-9]{32}$/.test(data.tag) || typeof data.data !== "string" || (data.data.length < 2 || data.data.length > 128 * 1024 || data.data.length % 2 !== 0 || !/^[a-f0-9]+$/.test(data.data)) || typeof data.proof !== "string" || !HEX64.test(data.proof)) throw new Error("Invalid transport packet.");
  return { version: 1, id: identifier(data.id), from: identifier(data.from), to: identifier(data.to), nonce: data.nonce, data: data.data, tag: data.tag, proof: data.proof };
}
function seal(from: Presence, to: Presence, payload: Payload): Packet {
  const base = { version: 1 as const, id: newId(), from: from.id, to: to.id };
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(to.secret, "hex"), nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(base)));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("hex");
  const fields = { ...base, nonce: nonce.toString("hex"), data, tag: cipher.getAuthTag().toString("hex") };
  return { ...fields, proof: sign(from.secret, fields) };
}
function unseal(value: Packet, own: Presence): Payload {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(own.secret, "hex"), Buffer.from(value.nonce, "hex"));
  decipher.setAAD(Buffer.from(JSON.stringify(header(value))));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  const data = object(JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, "hex")), decipher.final()]).toString("utf8")));
  exactKeys(data, data.kind === "ping" ? ["kind"] : ["kind", "message"]);
  if (data.kind === "ping") return { kind: "ping" };
  if (data.kind !== "message") throw new Error("Invalid request kind.");
  return { kind: "message", message: envelope(data.message) };
}
function encode(value: unknown): Buffer {
  const result = Buffer.from(JSON.stringify(value) + "\n");
  if (result.length > MAX_FRAME_BYTES) throw new Error("Transport frame limit exceeded.");
  return result;
}
/** Exactly one bounded JSON line. Absolute deadlines also cover clients that send no bytes. */
function readFrame(socket: Socket, consume: (data: unknown) => void, fail: () => void): void {
  let buffer = Buffer.alloc(0), done = false;
  socket.on("data", (chunk: Buffer) => {
    if (done) return;
    if (buffer.length + chunk.length > MAX_FRAME_BYTES) { done = true; fail(); return; }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(10);
    if (newline < 0) return;
    done = true;
    if (newline !== buffer.length - 1) { fail(); return; }
    try { consume(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline)))); }
    catch { fail(); }
  });
}
function owned(stat: ReturnType<typeof lstatSync>, privateMode: boolean): void {
  if (stat.uid !== process.getuid!() || (privateMode && (stat.mode & 0o077) !== 0)) throw new Error("Stela session state must be private and owned by the current account.");
}
function privateDirectory(path: string): void {
  try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = lstatSync(path);
  owned(stat, true);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe session directory.");
}
function safeAncestors(path: string): void {
  for (let current = path; ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== process.getuid!() && stat.uid !== 0) || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000)))) throw new Error("Unsafe session runtime ancestor.");
    if (dirname(current) === current) break;
  }
}
function boundedString(value: unknown, max: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max) throw new Error("Invalid presence metadata.");
  return value;
}
export function publicPeer(value: Presence): PeerInfo { return { id: value.id, sessionId: value.sessionId, name: value.name, cwd: value.cwd }; }

/** Endpoint derivation never accepts a caller/record-supplied address. Not a Windows runtime test. */
export function endpointName(profile: string, id: string, platform: NodeJS.Platform = process.platform): string {
  identifier(id);
  const profileHash = hash(platform === "win32" ? profile.toLowerCase() : profile);
  if (platform === "win32") return `\\\\.\\pipe\\stela-${profileHash}-${id}`;
  return join(realpathSync("/tmp"), `stela-${process.getuid!()}-${profileHash}`, `${id}.sock`);
}

/** Per-activation IPC, no daemon, retries, TCP listener, transcript store or consent manager. */
export class PeerTransport {
  readonly info: PeerInfo;
  readonly profile: string;
  private readonly root: string;
  private readonly endpoint: string;
  private readonly own: Presence;
  private readonly server: Server;
  private readonly incoming = new Set<Socket>();
  private readonly outgoing = new Set<Socket>();
  private closed = false;
  private published = false;
  private listening = false;
  private onMessage: (from: PeerInfo, message: Envelope) => "accepted" | "duplicate";

  private constructor(profile: string, info: Omit<PeerInfo, "id">, onMessage: PeerTransport["onMessage"]) {
    // Node alone does not establish Windows DACLs/remote-client rejection. Fail before I/O.
    if (process.platform === "win32" || typeof process.getuid !== "function") throw new Error("Stela session transport is unavailable on Windows until native profile/pipe protections are implemented and verified.");
    this.profile = realpathSync(profile);
    safeAncestors(this.profile);
    this.root = join(this.profile, "stela-sessions");
    privateDirectory(this.root);
    const id = newId();
    this.endpoint = endpointName(this.profile, id);
    if (Buffer.byteLength(this.endpoint) >= 104) throw new Error("Local socket path is too long.");
    safeAncestors(dirname(dirname(this.endpoint)));
    privateDirectory(dirname(this.endpoint));
    this.own = { version: 1, id, sessionId: boundedString(info.sessionId, 128), name: boundedString(info.name, 256), cwd: boundedString(info.cwd, 1024), pid: process.pid, secret: randomBytes(32).toString("hex") };
    this.info = publicPeer(this.own);
    this.onMessage = onMessage;
    this.server = createServer((socket) => this.connection(socket));
    this.server.on("error", () => { /* listen errors reject open(); later errors leave sends unconfirmed */ });
  }
  static async open(profile: string, info: Omit<PeerInfo, "id">, receive: PeerTransport["onMessage"], signal?: AbortSignal): Promise<PeerTransport> {
    signal?.throwIfAborted();
    const transport = new PeerTransport(profile, info, receive);
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { transport.server.off("error", failed); reject(error); };
        transport.server.once("error", failed);
        transport.server.listen({ path: transport.endpoint, signal }, () => {
          transport.listening = true;
          transport.server.off("error", failed);
          transport.server.unref(); resolve();
        });
        signal?.addEventListener("abort", () => failed(new Error("Session startup aborted.")), { once: true });
      });
      signal?.throwIfAborted();
      // Protect the socket before publishing any endpoint/secret. No pre-existing path is removed.
      const { chmodSync } = await import("node:fs");
      chmodSync(transport.endpoint, 0o600);
      transport.checkSocket(transport.own.id);
      transport.writePresence(false);
      transport.published = true;
      return transport;
    } catch (error) { await transport.close(); throw error; }
  }
  private file(id: string): string { return join(this.root, `${identifier(id)}.json`); }
  private writePresence(replace: boolean): void {
    privateDirectory(this.root);
    const path = this.file(this.own.id), text = JSON.stringify(this.own);
    if (Buffer.byteLength(text) > MAX_RECORD_BYTES) throw new Error("Presence metadata exceeds its encoded byte limit.");
    if (!replace) { writeFileSync(path, text, { flag: "wx", mode: 0o600 }); return; }
    if (this.readPresence(this.own.id).secret !== this.own.secret) throw new Error("Session activation changed.");
    const temporary = join(this.root, `.${this.own.id}-${newId()}.tmp`);
    try { writeFileSync(temporary, text, { flag: "wx", mode: 0o600 }); renameSync(temporary, path); }
    finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  }
  private readPresence(id: string): Presence {
    privateDirectory(this.root);
    let fd: number | undefined;
    try {
      fd = openSync(this.file(id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd); owned(stat, true);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_RECORD_BYTES) throw new Error("Unsafe presence record.");
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1), size = readSync(fd, bytes, 0, bytes.length, 0);
      if (size > MAX_RECORD_BYTES) throw new Error("Presence record is too large.");
      const data = object(JSON.parse(bytes.subarray(0, size).toString("utf8")));
      exactKeys(data, ["version", "id", "sessionId", "name", "cwd", "pid", "secret"]);
      if (data.version !== 1 || data.id !== id || typeof data.secret !== "string" || !HEX64.test(data.secret) || !Number.isSafeInteger(data.pid) || (data.pid as number) <= 0) throw new Error("Invalid presence record.");
      return { version: 1, id, secret: data.secret, pid: data.pid as number, sessionId: boundedString(data.sessionId, 128), name: boundedString(data.name, 256), cwd: boundedString(data.cwd, 1024) };
    } catch { throw new Error("Peer presence is unavailable or unsafe."); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  private checkSocket(id: string): void {
    privateDirectory(dirname(this.endpoint));
    const stat = lstatSync(endpointName(this.profile, id)); owned(stat, true);
    if (!stat.isSocket() || stat.isSymbolicLink()) throw new Error("Unsafe local socket.");
  }
  update(name: string): void {
    if (this.closed) return;
    this.own.name = boundedString(name, 256); this.info.name = this.own.name;
    this.writePresence(true);
  }
  private connection(socket: Socket): void {
    if (this.closed || this.incoming.size >= MAX_CONNECTIONS) { socket.destroy(); return; }
    this.incoming.add(socket);
    const deadline = setTimeout(() => socket.destroy(), IO_DEADLINE_MS);
    socket.on("error", () => {});
    socket.once("close", () => { clearTimeout(deadline); this.incoming.delete(socket); });
    readFrame(socket, (raw) => {
      const request = packet(raw);
      if (request.to !== this.own.id || this.closed) throw new Error("Wrong activation.");
      // Decrypt before sender lookup; outsiders without the recipient capability cannot force reads.
      // A squatted endpoint cannot read message text or forge a valid acknowledgment.
      const payload = unseal(request, this.own), sender = this.readPresence(request.from);
      if (!matches(request.proof, sign(sender.secret, unsigned(request)))) throw new Error("Sender authentication failed.");
      let receipt: Receipt = { accepted: true };
      if (payload.kind === "message") {
        try { receipt = { accepted: true, duplicate: this.onMessage(publicPeer(sender), payload.message) === "duplicate" }; }
        catch { receipt = { accepted: false, error: "Recipient rejected the message (budget, lineage, inbox or session state)." }; }
      }
      const response = { version: 1, id: request.id, from: this.own.id, to: request.from, ...receipt };
      socket.end(encode({ ...response, proof: sign(this.own.secret, response) }));
    }, () => socket.destroy());
  }
  private async request(peer: Presence, payload: Payload, signal?: AbortSignal): Promise<Receipt> {
    signal?.throwIfAborted();
    if (this.closed || this.outgoing.size >= MAX_OUTBOUND) throw new Error("Session transport is closed or its outbound limit was reached.");
    this.checkSocket(peer.id);
    const request = seal(this.own, peer, payload);
    const bytes = encode(request);
    return new Promise<Receipt>((resolve, reject) => {
      const socket = createConnection(endpointName(this.profile, peer.id));
      this.outgoing.add(socket);
      let done = false;
      const finish = (error?: Error, receipt?: Receipt) => {
        if (done) return;
        done = true; clearTimeout(deadline); signal?.removeEventListener("abort", aborted);
        this.outgoing.delete(socket); socket.destroy();
        if (error) reject(error); else resolve(receipt!);
      };
      const aborted = () => finish(new Error("Send cancelled; delivery may be unconfirmed. Do not automatically retry."));
      const deadline = setTimeout(() => finish(new Error("Delivery unconfirmed: deadline exceeded. It may have been accepted; do not automatically retry.")), IO_DEADLINE_MS);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      socket.once("connect", () => { if (!this.closed && !done) socket.write(bytes); else finish(new Error("Session closed before send.")); });
      socket.on("error", () => finish(new Error("Peer unavailable; delivery unconfirmed. Do not automatically retry.")));
      socket.once("close", () => finish(new Error("Peer disconnected; delivery unconfirmed. Do not automatically retry.")));
      readFrame(socket, (raw) => {
        const data = object(raw); exactKeys(data, ["version", "id", "from", "to", "accepted", "duplicate", "error", "proof"]);
        const { proof, ...response } = data;
        if (data.version !== 1 || data.id !== request.id || data.from !== peer.id || data.to !== this.own.id || typeof data.accepted !== "boolean" || (data.duplicate !== undefined && typeof data.duplicate !== "boolean") || (data.error !== undefined && (typeof data.error !== "string" || data.error.length > 256)) || !matches(proof, sign(peer.secret, response))) throw new Error("Invalid peer acknowledgment.");
        finish(undefined, { accepted: data.accepted, ...(data.duplicate === undefined ? {} : { duplicate: data.duplicate as boolean }), ...(data.error === undefined ? {} : { error: data.error as string }) });
      }, () => finish(new Error("Invalid peer acknowledgment; delivery unconfirmed. Do not automatically retry.")));
    });
  }
  async send(to: string, message: Envelope, signal?: AbortSignal): Promise<Receipt> {
    if (to === this.own.id) throw new Error("Cannot message this activation itself.");
    return this.request(this.readPresence(identifier(to)), { kind: "message", message: envelope(message) }, signal);
  }
  async list(signal?: AbortSignal): Promise<PeerInfo[]> {
    if (this.closed) throw new Error("Session transport is closed.");
    privateDirectory(this.root);
    const directory = opendirSync(this.root), candidates: Presence[] = [];
    try {
      let count = 0, item;
      while ((item = directory.readSync())) {
        if (++count > MAX_SCAN_ENTRIES) throw new Error("Presence scan limit reached; review stale session records manually.");
        if (!/^[a-f0-9]{32}\.json$/.test(item.name) || item.name === `${this.own.id}.json`) continue;
        try { candidates.push(this.readPresence(item.name.slice(0, -5))); } catch { /* malformed/inaccessible entries are not peers */ }
        if (candidates.length > MAX_PEERS) throw new Error("Peer candidate limit reached; review stale records manually.");
      }
    } finally { directory.closeSync(); }
    const result: PeerInfo[] = [];
    for (let index = 0; index < candidates.length; index += MAX_OUTBOUND) {
      signal?.throwIfAborted();
      await Promise.all(candidates.slice(index, index + MAX_OUTBOUND).map(async (peer) => {
        try { if ((await this.request(peer, { kind: "ping" }, signal)).accepted) result.push(publicPeer(peer)); }
        catch { /* unconfirmed presence is not advertised as live; never delete ambiguous records */ }
      }));
    }
    signal?.throwIfAborted();
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const socket of [...this.incoming, ...this.outgoing]) socket.destroy();
    if (this.published) {
      try { if (this.readPresence(this.own.id).secret === this.own.secret) unlinkSync(this.file(this.own.id)); } catch { /* never remove a replacement or an unsafe record */ }
    }
    if (this.listening) await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
