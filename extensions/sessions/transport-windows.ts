import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envelope, identifier, newId, type Envelope, type PeerInfo } from "./messages.ts";
import { answer, boundedString, decode, encode, MAX_PEERS, IO_DEADLINE_MS, presence, publicPeer, receipt, seal,
  type Payload, type Presence, type Receive, type Receipt, type SessionTransport } from "./protocol.ts";

export const WINDOWS_SESSIONS_HELPER = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "../../native/windows-sessions/target/release/stela-sessions.exe");
export const WINDOWS_SESSIONS_BUILD = "cargo build --locked --release --manifest-path native/windows-sessions/Cargo.toml";
const MAX_BRIDGE = 140 * 1024, MAX_PENDING = 32, MAX_BUFFERED_WRITE = 2 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const integer = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
function number(bytes: Buffer): number { if (bytes.length !== 4) throw new Error("Invalid native integer."); return bytes.readUInt32LE(); }
export function bridgeFrame(op: number, id: number, fields: Buffer[] = []): Buffer {
  const size = 5 + fields.reduce((n, value) => n + 4 + value.length, 0);
  if (size > MAX_BRIDGE || !Number.isSafeInteger(id) || id < 1 || id > 0xffff_ffff) throw new Error("Native bridge frame limit/ID.");
  return Buffer.concat([integer(size), Buffer.from([op]), integer(id), ...fields.flatMap((value) => [integer(value.length), value])]);
}
function fields(bytes: Buffer): Buffer[] {
  const result: Buffer[] = [];
  for (let offset = 5; offset < bytes.length;) {
    if (offset + 4 > bytes.length || result.length >= 130) throw new Error("Invalid native fields.");
    const size = bytes.readUInt32LE(offset); offset += 4;
    if (offset + size > bytes.length) throw new Error("Invalid native field size.");
    result.push(bytes.subarray(offset, offset + size)); offset += size;
  }
  return result;
}
interface Pending { resolve: (value: Buffer[]) => void; reject: (error: Error) => void; clear: () => void }
/** Private, bounded protocol. Not a general filesystem or model-callable RPC service. */
export class NativeBridge {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<void>;
  profile = ""; namespace = ""; pid = 0;
  incoming?: (connection: number, pid: number, bytes: Buffer) => void;
  private pending = new Map<number, Pending>();
  private counter = 0;
  private failure?: Error;
  private buffer = Buffer.alloc(0);
  private closing?: Promise<void>;
  private constructor(helper: string) {
    this.child = spawn(helper, ["--parent-pid", String(process.pid)], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.exited = new Promise((resolve) => this.child.once("close", () => { this.fail(new Error("Native session bridge closed; messaging unavailable.")); resolve(); }));
    this.child.once("error", () => this.fail(new Error("Could not start native session bridge.")));
    this.child.stdin.on("error", () => this.fail(new Error("Native session bridge disconnected.")));
    // Drain bounded native diagnostics without copying arbitrary stderr into model context.
    this.child.stderr.on("data", () => {});
    this.child.stdout.on("data", (chunk: Buffer) => {
      try {
        if (this.buffer.length + chunk.length > 2 * MAX_BRIDGE + 8) throw new Error("Native stream bound.");
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
          const size = this.buffer.readUInt32LE();
          if (size < 5 || size > MAX_BRIDGE) throw new Error("Invalid native frame size.");
          if (this.buffer.length < size + 4) break;
          const body = this.buffer.subarray(4, size + 4); this.buffer = this.buffer.subarray(size + 4);
          const op = body[0], id = body.readUInt32LE(1), values = fields(body);
          if (!id) throw new Error("Invalid native response ID.");
          if (op === 64) {
            if (values.length !== 2 || number(values[0]) === 0 || values[1].length > 128 * 1024) throw new Error("Invalid native incoming frame.");
            if (this.incoming) this.incoming(id, number(values[0]), values[1]); else this.respond(id);
          } else {
            if (op !== 0 && op !== 127) throw new Error("Invalid native response opcode.");
            const pending = this.pending.get(id); if (!pending) continue; // bounded late result after cancellation/deadline
            const error = op === 127 ? new Error(values.length === 1 && values[0].length <= 256 ? utf8.decode(values[0]) : "Native operation failed.") : undefined;
            this.pending.delete(id); pending.clear();
            if (error) pending.reject(error); else pending.resolve(values);
          }
        }
      } catch { this.fail(new Error("Malformed native bridge output; messaging stopped.")); }
    });
  }
  assertOpen(): void {
    if (this.failure) throw this.failure;
    if (this.child.exitCode !== null || this.child.signalCode !== null) throw new Error("Native session bridge unavailable.");
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) { pending.clear(); pending.reject(error); }
    this.pending.clear(); this.incoming = undefined;
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }
  private write(bytes: Buffer) {
    if (this.failure) throw this.failure;
    if (this.child.stdin.writableLength + bytes.length > MAX_BUFFERED_WRITE) throw new Error("Native bridge backpressure limit.");
    this.child.stdin.write(bytes);
  }
  static async open(profile: string, id: string, signal?: AbortSignal, helper = WINDOWS_SESSIONS_HELPER): Promise<NativeBridge> {
    signal?.throwIfAborted(); identifier(id);
    try { if (!statSync(helper).isFile()) throw new Error(); }
    catch { throw new Error(`Native Windows sessions helper missing or inaccessible. Build explicitly: ${WINDOWS_SESSIONS_BUILD}. No messaging state was created.`); }
    let bridge: NativeBridge;
    try { bridge = new NativeBridge(helper); }
    catch { throw new Error("Could not start native session bridge."); }
    try {
      const values = await bridge.call(1, [integer(1), Buffer.from(profile), Buffer.from(id)], signal);
      if (values.length !== 4 || number(values[0]) !== 1 || number(values[2]) !== bridge.child.pid) throw new Error("Incompatible native session bridge.");
      bridge.profile = utf8.decode(values[1]); bridge.pid = number(values[2]); bridge.namespace = identifier(utf8.decode(values[3]));
      signal?.throwIfAborted(); return bridge;
    } catch (error) { await bridge.close(); throw error; }
  }
  call(op: number, values: Buffer[] = [], signal?: AbortSignal, timeout = 5000): Promise<Buffer[]> {
    signal?.throwIfAborted();
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= MAX_PENDING || this.counter === 0xffff_ffff) return Promise.reject(new Error("Native request budget exhausted."));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const finish = (error: Error) => { const item = this.pending.get(id); if (!item) return; this.pending.delete(id); item.clear(); reject(error); };
      const abort = () => finish(new Error("Native operation cancelled; delivery may be unconfirmed. Do not automatically retry."));
      const timer = setTimeout(() => finish(new Error("Native operation deadline exceeded; delivery may be unconfirmed. Do not automatically retry.")), timeout);
      const clear = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pending.set(id, { resolve, reject, clear }); signal?.addEventListener("abort", abort, { once: true });
      try { this.write(bridgeFrame(op, id, values)); } catch (error) { finish(error as Error); }
    });
  }
  respond(id: number, bytes = Buffer.alloc(0)) { try { this.write(bridgeFrame(6, id, [bytes])); } catch { this.fail(new Error("Native admission response failed.")); } }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.incoming = undefined;
      const force = setTimeout(() => this.fail(new Error("Native bridge shutdown deadline.")), 1500);
      try { if (!this.failure) await this.call(7); } catch { /* shutdown remains bounded */ }
      this.child.stdin.end();
      await this.exited; clearTimeout(force);
    })();
  }
}

export class WindowsTransport implements SessionTransport {
  readonly info: PeerInfo;
  readonly profile: string;
  private closed = false;
  private active = new Set<number>();
  private bridge: NativeBridge;
  private own: Presence;
  private constructor(bridge: NativeBridge, own: Presence, receive: Receive) {
    this.bridge = bridge; this.own = own;
    this.info = publicPeer(own); this.profile = bridge.profile;
    bridge.incoming = (connection, pid, bytes) => {
      if (this.closed || this.active.size >= 8) { bridge.respond(connection); return; }
      this.active.add(connection);
      void Promise.resolve().then(() => answer(decode(bytes), own, (id) => this.readPresence(id), (from, message) => {
        if (this.closed) throw new Error("Activation closed."); return receive(from, message);
      }, pid)).then((bytes) => bridge.respond(connection, bytes), () => bridge.respond(connection)).finally(() => this.active.delete(connection));
    };
  }
  static async open(profile: string, info: Omit<PeerInfo, "id">, receive: Receive, signal?: AbortSignal, helper?: string): Promise<WindowsTransport> {
    const metadata = { sessionId: boundedString(info.sessionId,128), name: boundedString(info.name,256), cwd: boundedString(info.cwd,1024) };
    const id = newId(), bridge = await NativeBridge.open(profile, id, signal, helper);
    const own: Presence = { version: 1, id, pid: bridge.pid, secret: randomBytes(32).toString("hex"), ...metadata };
    const transport = new WindowsTransport(bridge, own, receive);
    try { await transport.update(info.name, signal); signal?.throwIfAborted(); return transport; }
    catch (error) { await transport.close(); throw error; }
  }
  private async readPresence(id: string): Promise<Presence> {
    if (this.closed) throw new Error("Session transport closed.");
    const values = await this.bridge.call(3, [Buffer.from(identifier(id))]);
    if (values.length !== 1) throw new Error("Invalid native presence result.");
    return presence(JSON.parse(utf8.decode(values[0])), id);
  }
  async update(name: string, signal?: AbortSignal): Promise<void> {
    if (this.closed) return;
    const replacement = { ...this.own, name: boundedString(name,256) };
    const bytes = Buffer.from(JSON.stringify(replacement)); if (bytes.length > 4096) throw new Error("Presence byte limit.");
    await this.bridge.call(2,[bytes],signal); this.own.name = replacement.name; this.info.name = replacement.name;
  }
  private async request(peer: Presence, payload: Payload, signal?: AbortSignal): Promise<Receipt> {
    signal?.throwIfAborted(); if (this.closed) throw new Error("Session transport closed.");
    const request = seal(this.own, peer, payload);
    const result = await this.bridge.call(5, [Buffer.from(peer.id),integer(peer.pid),encode(request)],signal,IO_DEADLINE_MS);
    if (result.length !== 1) throw new Error("Invalid native wire result.");
    return receipt(decode(result[0]), request, this.own.id, peer);
  }
  async send(to: string, message: Envelope, signal?: AbortSignal): Promise<Receipt> {
    if (to === this.own.id) throw new Error("Cannot message this activation itself.");
    return this.request(await this.readPresence(identifier(to)), { kind: "message", message: envelope(message) }, signal);
  }
  async list(signal?: AbortSignal): Promise<PeerInfo[]> {
    signal?.throwIfAborted(); if (this.closed) throw new Error("Session transport closed.");
    const ids = await this.bridge.call(4,[],signal); const candidates: Presence[] = [];
    for (const id of ids) {
      signal?.throwIfAborted();
      try { candidates.push(await this.readPresence(identifier(utf8.decode(id)))); } catch { /* unsafe/stale records never prove reachability */ }
      if (candidates.length > MAX_PEERS) throw new Error("Peer candidate limit reached; review stale records manually.");
    }
    const result: PeerInfo[] = [];
    for (let offset = 0; offset < candidates.length; offset += 4) {
      signal?.throwIfAborted();
      await Promise.all(candidates.slice(offset,offset+4).map(async (peer) => {
        try { if ((await this.request(peer,{kind:"ping"},signal)).accepted) result.push(publicPeer(peer)); } catch { /* unconfirmed != live */ }
      }));
    }
    signal?.throwIfAborted(); this.bridge.assertOpen();
    if (this.closed) throw new Error("Session transport closed.");
    return result.sort((a,b) => a.id.localeCompare(b.id));
  }
  async close(): Promise<void> { this.closed = true; await this.bridge.close(); }
}
