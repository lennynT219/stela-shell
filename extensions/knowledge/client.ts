import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { minimalEnvironment } from "../memory/client.ts";
import { configuredVaultGuard } from "../memory/configuration.ts";
import { selectExecutable, resolveExecutable } from "../memory/executable.ts";
import { parse, stringify, uuid, type ObjectValue } from "../memory/protocol.ts";

export const NOTE_BYTES = 512 * 1024;
const IO_BYTES = 4 * 1024 * 1024;
export type Operation = "list" | "read" | "create" | "update";
export type Call = (operation: Operation, args: ObjectValue, signal: AbortSignal) => Promise<ObjectValue>;
export const writing = (op: Operation) => op === "create" || op === "update";
const failures = new Set(["invalid", "unsupported", "unbound", "unavailable", "denied", "not_found", "conflict", "busy", "input_limit", "output_limit", "save_unconfirmed"]);
const record = (v: unknown): v is ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (obj: ObjectValue, ...keys: string[]) => Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));
const bytes = (v: unknown, max: number): v is string => typeof v === "string" && Buffer.byteLength(v) <= max;

export function decodeReceipt(output: Uint8Array, requestId: string, op: Operation, args: ObjectValue): ObjectValue {
  const invalid = () => { throw new Error("Invalid Brain notes receipt"); };
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) return invalid();
  const envelope = parse(text);
  if (!record(envelope) || !exact(envelope, "protocol_version", "request_id", "result") ||
      envelope.protocol_version !== 1 || envelope.request_id !== requestId || !record(envelope.result)) return invalid();
  const r = envelope.result;
  if (typeof r.status === "string" && failures.has(r.status)) {
    if (!exact(r, "status", "message") || !bytes(r.message, 4096)) return invalid();
    // Never echo paths or backend error text. A failed write response whose
    // publication state is not known must not be treated as a refusal.
    return { status: writing(op) && ["output_limit", "save_unconfirmed"].includes(r.status) ? "save_unconfirmed" : r.status };
  }
  if (!uuid(r.project_id) || (args.project_id !== undefined && r.project_id !== args.project_id)) return invalid();
  if (op === "list") {
    if (r.status !== "listed" || !exact(r, "status", "project_id", "notes") || !Array.isArray(r.notes) || r.notes.length > 256) return invalid();
    const seen = new Set<string>();
    for (const item of r.notes) {
      if (!record(item) || !exact(item, "note_id", "title") || !uuid(item.note_id) || seen.has(item.note_id) || !bytes(item.title, NOTE_BYTES)) return invalid();
      seen.add(item.note_id);
    }
  } else {
    if (!uuid(r.note_id) || !bytes(r.title, NOTE_BYTES) || (args.note_id !== undefined && r.note_id !== args.note_id)) return invalid();
    const fields = ["status", "project_id", "note_id", "title"];
    if (op === "read") {
      if (r.status !== "found" || !exact(r, ...fields, "markdown", "body") || !bytes(r.markdown, NOTE_BYTES) || !bytes(r.body, NOTE_BYTES)) return invalid();
    } else if (!exact(r, ...fields) || (op === "create" ? r.status !== "created" || r.title !== args.title : r.status !== "updated" && r.status !== "unchanged")) return invalid();
  }
  return r;
}

export function resolveScope(cwd: string, source: NodeJS.ProcessEnv) {
  const selection = selectExecutable(source), env = minimalEnvironment(source);
  const executable = resolveExecutable(selection, cwd), vaultMatches = configuredVaultGuard(env);
  const bindings = [join(cwd, ".brain.toml"), join(cwd, ".brain-notes.toml")];
  const stamp = (path: string) => {
    try {
      const s = lstatSync(path, { bigint: true });
      if (!s.isFile() || s.isSymbolicLink()) throw new Error("Invalid binding file");
      return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  };
  const initial = bindings.map(stamp);
  if (initial.every(s => s === null) || !vaultMatches()) throw new Error("Knowledge binding unavailable");
  let changed = false;
  const valid = () => {
    if (changed) return false;
    try {
      changed = bindings.some((path, i) => stamp(path) !== initial[i]) || !vaultMatches() ||
        JSON.stringify(selectExecutable(source)) !== JSON.stringify(selection) ||
        JSON.stringify(minimalEnvironment(source)) !== JSON.stringify(env);
    } catch { changed = true; }
    return !changed;
  };
  return { valid, call: makeCall(executable, cwd, env) };
}

export function makeCall(executable: string, cwd: string, env: NodeJS.ProcessEnv): Call {
  return (operation, args, signal) => brainCall(executable, cwd, env, "notes", operation, args, signal,
    writing(operation), decodeReceiptFor(operation));
}

const decodeReceiptFor = (op: Operation) => (output: Uint8Array, id: string, args: ObjectValue) => decodeReceipt(output, id, op, args);

/** Shared bounded one-shot transport; callers own the operation and receipt schema. */
export async function brainCall(executable: string, cwd: string, env: NodeJS.ProcessEnv,
  endpoint: "notes" | "projects", operation: string, args: ObjectValue, signal: AbortSignal, mutating: boolean,
  decodeResult: (output: Uint8Array, requestId: string, args: ObjectValue) => ObjectValue): Promise<ObjectValue> {
  if (signal.aborted) return { status: "cancelled" };
  const requestId = randomUUID();
  let input: string;
  try { input = stringify({ protocol_version: 1, request_id: requestId, operation, arguments: args }, IO_BYTES - 1) + "\n"; }
  catch { return { status: "input_limit" }; }
  return new Promise<ObjectValue>(resolve => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(executable, [endpoint], { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { resolve({ status: "unavailable" }); return; }
    let submitted = false, failure: string | undefined, output = 0, stderr = 0;
    const chunks: Buffer[] = [];
    const stop = (why: string) => {
      if (failure) return;
      failure = why; chunks.length = 0;
      try { child.kill("SIGKILL"); } catch { /* wait for close; never admit another call meanwhile */ }
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
    };
    const abort = () => stop("cancelled");
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("deadline"), 10_000);
    child.once("spawn", () => {
      if (signal.aborted) { abort(); return; }
      if (failure) return;
      submitted = true;
      try { child.stdin!.end(input); } catch { stop("unavailable"); }
    });
    child.on("error", () => stop("unavailable"));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.on("error", () => stop("unavailable"));
    child.stdout!.on("data", (chunk: Buffer) => {
      if (failure) return;
      output += chunk.length;
      if (output > IO_BYTES) stop("output_limit"); else chunks.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => { if ((stderr += chunk.length) > 16 * 1024) stop("unavailable"); });
    child.once("close", (code, killed) => {
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (!failure && code === 0 && !killed) {
        try { resolve(decodeResult(Buffer.concat(chunks, output), requestId, args)); return; }
        catch { failure = "invalid_receipt"; }
      }
      resolve({ status: submitted && mutating ? "save_unconfirmed" : failure ?? "unavailable" });
    });
    if (signal.aborted) abort();
  });
}
