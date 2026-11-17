import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { decode, OPERATIONS, requireJSONRuntime, stringify, type ObjectValue, type Operation, type Request, type Response } from "./protocol.ts";

export const MAX_INPUT_BYTES = 4 * 1024 * 1024, MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_STDERR_BYTES = 16 * 1024, DEADLINE_MS = 10_000;
export type ErrorCode = "INVALID_CONFIGURATION" | "INVALID_INPUT" | "BUSY" | "CLOSED" | "CANCELLED" | "DEADLINE" | "UNAVAILABLE" | "PROCESS_FAILED" | "OUTPUT_TOO_LARGE" | "STDERR_TOO_LARGE" | "INVALID_PROTOCOL" | "CLEANUP_UNCONFIRMED" | "UNSUPPORTED_RUNTIME";
export class MemoryClientError extends Error {
  readonly code: ErrorCode;
  readonly status: "error" | "save_unconfirmed";
  readonly submitted: boolean;
  readonly cleanupConfirmed: boolean;
  constructor(code: ErrorCode, submitted = false, mutating = false, cleanupConfirmed = true) {
    super(submitted && mutating ? "Brain Memory publication is unconfirmed. Do not retry, roll back or allocate another identity." : "Brain Memory operation failed; no automatic retry or fallback was used.");
    this.name = "MemoryClientError"; this.code = code; this.submitted = submitted;
    this.status = submitted && mutating ? "save_unconfirmed" : "error"; this.cleanupConfirmed = cleanupConfirmed;
  }
}
interface LaunchOptions { cwd: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: ["pipe", "pipe", "pipe"] }
export type Launcher = (executable: string, args: string[], options: LaunchOptions) => ChildProcessWithoutNullStreams;
export interface Options {
  // Trusted host configuration, NOT model/tool arguments or a grant of authority.
  executable: string; cwd: string; vault?: string; allowConfiguredVault?: boolean;
  environment?: NodeJS.ProcessEnv; maxInputBytes?: number; maxOutputBytes?: number; deadlineMs?: number;
}
export interface Dependencies { launch?: Launcher }
const mutations = new Set<Operation>(["create", "replace_missing", "update", "accept_external", "recover"]);
const validPath = (v: unknown): v is string => typeof v === "string" && isAbsolute(v) && !v.includes("\0");
const allowedEnvironment = new Set(["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMROOT", "TMP", "TEMP", "TMPDIR"]);
export function minimalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) if (allowedEnvironment.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  return env;
}

/** One direct trusted child, one admitted request, no queue/probe/retry/install. */
export class MemoryClient {
  private readonly options: Options;
  private readonly dependencies: Dependencies;
  private readonly inputLimit: number;
  private readonly outputLimit: number;
  private readonly deadline: number;
  private closed = false;
  private active?: { stop: (code: ErrorCode) => void; done: Promise<Response>; exited: boolean };
  constructor(options: Options, dependencies: Dependencies = {}) {
    this.options = { ...options, environment: minimalEnvironment(options.environment ?? process.env) }; this.dependencies = dependencies;
    this.inputLimit = options.maxInputBytes ?? MAX_INPUT_BYTES; this.outputLimit = options.maxOutputBytes ?? MAX_OUTPUT_BYTES; this.deadline = options.deadlineMs ?? DEADLINE_MS;
    if (!validPath(options.executable) || !validPath(options.cwd) || (options.vault !== undefined && !validPath(options.vault)) ||
        (process.platform === "win32" && !/\.exe$/i.test(options.executable)) ||
        !Number.isSafeInteger(this.inputLimit) || this.inputLimit < 1024 || this.inputLimit > MAX_INPUT_BYTES ||
        !Number.isSafeInteger(this.outputLimit) || this.outputLimit < 1024 || this.outputLimit > MAX_OUTPUT_BYTES ||
        !Number.isFinite(this.deadline) || this.deadline <= 0 || this.deadline > DEADLINE_MS) throw new MemoryClientError("INVALID_CONFIGURATION");
    try { requireJSONRuntime(); } catch { throw new MemoryClientError("UNSUPPORTED_RUNTIME"); }
  }
  async call(operation: Operation, args: ObjectValue = {}, signal?: AbortSignal): Promise<Response> {
    if (this.closed) throw new MemoryClientError("CLOSED");
    if (this.active) throw new MemoryClientError("BUSY");
    if (signal?.aborted) throw new MemoryClientError("CANCELLED");
    if (!OPERATIONS.includes(operation) || !args || typeof args !== "object" || Array.isArray(args)) throw new MemoryClientError("INVALID_INPUT");
    if (operation !== "capabilities" && this.options.vault === undefined && this.options.allowConfiguredVault !== true) throw new MemoryClientError("INVALID_CONFIGURATION");
    const started = performance.now(), request: Request = { protocol_version: 1, request_id: randomUUID(), operation, arguments: args,
      ...(this.options.vault !== undefined ? { vault: this.options.vault } : {}) };
    let input: string; try { input = stringify(request, this.inputLimit); } catch { throw new MemoryClientError("INVALID_INPUT"); }
    const remaining = this.deadline - (performance.now() - started);
    if (remaining <= 0) throw new MemoryClientError("DEADLINE");
    const mutating = mutations.has(operation);
    let child: ChildProcessWithoutNullStreams | undefined, failure: ErrorCode | undefined, submitted = false, stopping = false, settled = false;
    let chunks: Buffer[] = [], stdoutBytes = 0, stderrBytes = 0;
    let rejectResult: (error: MemoryClientError) => void = () => {};
    const stop = (code: ErrorCode) => {
      failure ??= code;
      if (!child || stopping) return;
      stopping = true; chunks = [];
      try {
        const killed = child.kill("SIGKILL");
        if (!killed && child.pid && child.exitCode === null && child.signalCode === null) {
          if (!settled) { settled = true; rejectResult(new MemoryClientError("CLEANUP_UNCONFIRMED", submitted, mutating, false)); }
        }
      } catch {
        if (!settled) { settled = true; rejectResult(new MemoryClientError("CLEANUP_UNCONFIRMED", submitted, mutating, false)); }
      }
      // Direct trusted Brain does not spawn descendants. Destroy inherited pipes
      // too, so an unexpected open pipe cannot keep the request waiting forever.
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    };
    const abort = () => stop("CANCELLED");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("DEADLINE"), remaining);
    const done = new Promise<Response>((resolve, reject) => {
      rejectResult = reject;
      try {
        child = (this.dependencies.launch ?? spawn)(this.options.executable,
          ["memory", "--max-input-bytes", String(this.inputLimit), "--max-output-bytes", String(this.outputLimit)],
          { cwd: this.options.cwd, env: this.options.environment!, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch { settled = true; reject(new MemoryClientError("UNAVAILABLE")); return; }
      child.once("spawn", () => {
        if (failure || signal?.aborted) { stop(failure ?? "CANCELLED"); return; }
        // Once handed to stdin, publication may have happened even if a later
        // signal/EOF/parse/exit error prevents observing the receipt.
        submitted = true;
        try { child!.stdin.end(input, "utf8"); } catch { stop("PROCESS_FAILED"); }
      });
      child.on("error", () => stop(submitted ? "PROCESS_FAILED" : "UNAVAILABLE"));
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", () => stop("PROCESS_FAILED"));
      child.stdout.on("data", (chunk: Buffer) => {
        if (failure) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.outputLimit) stop("OUTPUT_TOO_LARGE"); else chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_STDERR_BYTES) stop("STDERR_TOO_LARGE"); // Never retain/log raw stderr.
      });
      child.once("close", (code, exitSignal) => {
        if (this.active?.done === done) { this.active.exited = true; this.active = undefined; }
        if (settled) return;
        settled = true;
        if (failure || code !== 0 || exitSignal) { reject(new MemoryClientError(failure ?? "PROCESS_FAILED", submitted, mutating)); return; }
        try {
          if (performance.now() - started >= this.deadline) { reject(new MemoryClientError("DEADLINE", submitted, mutating)); return; }
          const result = decode(Buffer.concat(chunks, stdoutBytes), request, this.inputLimit, this.outputLimit);
          if (performance.now() - started >= this.deadline) { reject(new MemoryClientError("DEADLINE", submitted, mutating)); return; }
          if (mutating && result.result.status === "too_large") { reject(new MemoryClientError("OUTPUT_TOO_LARGE", submitted, true)); return; }
          resolve(result);
        } catch { reject(new MemoryClientError("INVALID_PROTOCOL", submitted, mutating)); }
        finally { chunks = []; }
      });
      if (failure || signal?.aborted) stop(failure ?? "CANCELLED");
    });
    const active = { stop, done, exited: child === undefined }; this.active = active;
    try { return await done; }
    finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      // If OS termination could not be confirmed, keep the sole slot reserved
      // until its actual close event instead of admitting overlapping mutations.
      if (this.active === active && active.exited) this.active = undefined;
    }
  }
  cancel() { this.active?.stop("CANCELLED"); }
  async close() { this.closed = true; const active = this.active; active?.stop("CLOSED"); await active?.done.catch(() => {}); }
}
