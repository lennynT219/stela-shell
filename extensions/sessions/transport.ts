import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { identifier, newId, type Envelope, type PeerInfo } from "./messages.ts";
import { MAX_FRAME_BYTES, MAX_RECORD_BYTES, MAX_SCAN_ENTRIES, MAX_PEERS, IO_DEADLINE_MS, MAX_CONNECTIONS, MAX_OUTBOUND,
  answer, boundedString, encode, presence, publicPeer, receipt, seal, type Payload, type Presence, type Receipt, type SessionTransport } from "./protocol.ts";
export { MAX_FRAME_BYTES, MAX_RECORD_BYTES, MAX_SCAN_ENTRIES, MAX_PEERS, IO_DEADLINE_MS } from "./protocol.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
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
/** POSIX endpoint derivation. Windows requires handle-validated native profile identity. */
export function endpointName(profile: string, id: string, platform: NodeJS.Platform = process.platform): string {
  identifier(id);
  if (platform === "win32") throw new Error("Windows endpoints require validated native profile identity, not a string path.");
  const profileHash = hash(profile);
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
    // This class is POSIX-only; open() selects the protected native Windows backend.
    if (process.platform === "win32" || typeof process.getuid !== "function") throw new Error("POSIX session transport requires native account/permission APIs; use the platform factory.");
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
  static async open(profile: string, info: Omit<PeerInfo, "id">, receive: PeerTransport["onMessage"], signal?: AbortSignal): Promise<SessionTransport> {
    signal?.throwIfAborted();
    if (process.platform === "win32") return (await import("./transport-windows.ts")).WindowsTransport.open(profile, info, receive, signal);
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
      return presence(JSON.parse(bytes.subarray(0, size).toString("utf8")), id);
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
      void answer(raw, this.own, (id) => this.readPresence(id), (from, message) => {
        if (this.closed) throw new Error("Session closed.");
        return this.onMessage(from, message);
      }).then((bytes) => { if (!this.closed && !socket.destroyed) socket.end(bytes); else socket.destroy(); }, () => socket.destroy());
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
        finish(undefined, receipt(raw, request, this.own.id, peer));
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
