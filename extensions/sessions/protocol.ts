import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { envelope, exactKeys, identifier, newId, object, type Envelope, type PeerInfo } from "./messages.ts";

// Worst-case JSON escaping of an 8 KiB message, then hex ciphertext, still fits.
export const MAX_FRAME_BYTES = 128 * 1024;
export const MAX_RECORD_BYTES = 4096;
export const MAX_SCAN_ENTRIES = 128;
export const MAX_PEERS = 32;
export const IO_DEADLINE_MS = 2000;
export const MAX_CONNECTIONS = 8, MAX_OUTBOUND = 4;
const HEX64 = /^[a-f0-9]{64}$/;
export interface Presence extends PeerInfo { version: 1; pid: number; secret: string }
interface Packet { version: 1; id: string; from: string; to: string; nonce: string; data: string; tag: string; proof: string }
export interface Receipt { accepted: boolean; duplicate?: boolean; error?: string }
export type Payload = { kind: "ping" } | { kind: "message"; message: Envelope };

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
const sign = (key: string, value: unknown) => createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify(value)).digest("hex");
export function matches(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && HEX64.test(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
function header(packet: Packet) { return { version: packet.version, id: packet.id, from: packet.from, to: packet.to }; }
function unsigned(packet: Packet) { return { ...header(packet), nonce: packet.nonce, data: packet.data, tag: packet.tag }; }
export function packet(value: unknown): Packet {
  const data = object(value);
  exactKeys(data, ["version", "id", "from", "to", "nonce", "data", "tag", "proof"]);
  if (data.version !== 1 || typeof data.nonce !== "string" || !/^[a-f0-9]{24}$/.test(data.nonce) || typeof data.tag !== "string" || !/^[a-f0-9]{32}$/.test(data.tag) || typeof data.data !== "string" || (data.data.length < 2 || data.data.length > 128 * 1024 || data.data.length % 2 !== 0 || !/^[a-f0-9]+$/.test(data.data)) || typeof data.proof !== "string" || !HEX64.test(data.proof)) throw new Error("Invalid transport packet.");
  return { version: 1, id: identifier(data.id), from: identifier(data.from), to: identifier(data.to), nonce: data.nonce, data: data.data, tag: data.tag, proof: data.proof };
}
export function seal(from: Presence, to: Presence, payload: Payload): Packet {
  const base = { version: 1 as const, id: newId(), from: from.id, to: to.id };
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(to.secret, "hex"), nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(base)));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("hex");
  const fields = { ...base, nonce: nonce.toString("hex"), data, tag: cipher.getAuthTag().toString("hex") };
  return { ...fields, proof: sign(from.secret, fields) };
}
export function unseal(value: Packet, own: Presence): Payload {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(own.secret, "hex"), Buffer.from(value.nonce, "hex"));
  decipher.setAAD(Buffer.from(JSON.stringify(header(value))));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  const data = object(JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, "hex")), decipher.final()]).toString("utf8")));
  exactKeys(data, data.kind === "ping" ? ["kind"] : ["kind", "message"]);
  if (data.kind === "ping") return { kind: "ping" };
  if (data.kind !== "message") throw new Error("Invalid request kind.");
  return { kind: "message", message: envelope(data.message) };
}
export function encode(value: unknown): Buffer {
  const result = Buffer.from(JSON.stringify(value) + "\n");
  if (result.length > MAX_FRAME_BYTES) throw new Error("Transport frame limit exceeded.");
  return result;
}
export function boundedString(value: unknown, max: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max) throw new Error("Invalid presence metadata.");
  return value;
}
export function publicPeer(value: Presence): PeerInfo { return { id: value.id, sessionId: value.sessionId, name: value.name, cwd: value.cwd }; }


export type Receive = (from: PeerInfo, message: Envelope) => "accepted" | "duplicate";
export interface SessionTransport {
  readonly info: PeerInfo;
  readonly profile: string;
  update(name: string): void | Promise<void>;
  list(signal?: AbortSignal): Promise<PeerInfo[]>;
  send(to: string, message: Envelope, signal?: AbortSignal): Promise<Receipt>;
  close(): Promise<void>;
}
export type OpenTransport = (profile: string, info: Omit<PeerInfo, "id">, receive: Receive, signal?: AbortSignal) => Promise<SessionTransport>;
export function presence(value: unknown, id: string): Presence {
  const data = object(value);
  exactKeys(data, ["version", "id", "sessionId", "name", "cwd", "pid", "secret"]);
  if (data.version !== 1 || data.id !== identifier(id) || typeof data.secret !== "string" || !/^[a-f0-9]{64}$/.test(data.secret) || !Number.isSafeInteger(data.pid) || (data.pid as number) <= 0) throw new Error("Invalid presence record.");
  return { version: 1, id, secret: data.secret, pid: data.pid as number, sessionId: boundedString(data.sessionId, 128), name: boundedString(data.name, 256), cwd: boundedString(data.cwd, 1024) };
}
export function decode(bytes: Buffer): unknown {
  if (bytes.length > MAX_FRAME_BYTES || bytes.indexOf(10) !== bytes.length - 1) throw new Error("Invalid transport frame.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, -1)));
}
export async function answer(raw: unknown, own: Presence, lookup: (id: string) => Presence | Promise<Presence>, receive: Receive, peerPid?: number): Promise<Buffer> {
  const request = packet(raw);
  if (request.to !== own.id) throw new Error("Wrong activation.");
  const payload = unseal(request, own), sender = await lookup(request.from);
  if ((peerPid !== undefined && sender.pid !== peerPid) || !matches(request.proof, sign(sender.secret, unsigned(request)))) throw new Error("Sender authentication failed.");
  let receipt: Receipt = { accepted: true };
  if (payload.kind === "message") {
    try { receipt = { accepted: true, duplicate: receive(publicPeer(sender), payload.message) === "duplicate" }; }
    catch { receipt = { accepted: false, error: "Recipient rejected the message (budget, lineage, inbox or session state)." }; }
  }
  const response = { version: 1, id: request.id, from: own.id, to: request.from, ...receipt };
  return encode({ ...response, proof: sign(own.secret, response) });
}
export function receipt(raw: unknown, request: Packet, ownId: string, peer: Presence): Receipt {
  const data = object(raw); exactKeys(data, ["version", "id", "from", "to", "accepted", "duplicate", "error", "proof"]);
  const { proof, ...response } = data;
  if (data.version !== 1 || data.id !== request.id || data.from !== peer.id || data.to !== ownId || typeof data.accepted !== "boolean" || (data.duplicate !== undefined && typeof data.duplicate !== "boolean") || (data.error !== undefined && (typeof data.error !== "string" || data.error.length > 256)) || !matches(proof, sign(peer.secret, response))) throw new Error("Invalid peer acknowledgment.");
  return { accepted: data.accepted, ...(data.duplicate === undefined ? {} : { duplicate: data.duplicate as boolean }), ...(data.error === undefined ? {} : { error: data.error as string }) };
}
