import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the checkout even when the extension is loaded through a profile link.
export const WINDOWS_JOB_HELPER = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "../../native/windows-job/target/release/stela-job.exe");
export const WINDOWS_HELPER_BUILD = "cargo build --locked --release --manifest-path native/windows-job/Cargo.toml";
export const POSIX_SUPERVISOR = fileURLToPath(new URL("./posix-supervisor.mjs", import.meta.url));

export interface ProcessSpec {
  command: string;
  args: string[];
  detached: boolean;
}
export interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  terminate(): void;
  forceTerminate(): void;
  cleanup(): void;
}

/** Plan only. Tests can validate either platform without pretending to run it. */
export function processSpec(command: string, args: string[], platform: NodeJS.Platform = process.platform, parentPid = process.pid): ProcessSpec {
  if (platform === "win32") {
    if (!win32.isAbsolute(command) || !/\.exe$/i.test(command)) throw new Error("Windows requires the parent's absolute native .exe, not a shell launcher.");
    return { command: WINDOWS_JOB_HELPER, args: ["--parent-pid", String(parentPid), "--", command, ...args], detached: false };
  }
  // Reuse the owner's exact JS runtime, including Bun's embedded runtime in a
  // compiled Pi. --eval fails closed if that executable cannot run JavaScript.
  return { command: process.execPath, args: ["--eval", `import(${JSON.stringify(new URL("./posix-supervisor.mjs", import.meta.url).href)})`], detached: true };
}

/** The Windows helper is built explicitly, never downloaded/compiled on delegation. */
export function requireWindowsHelper(path = WINDOWS_JOB_HELPER): void {
  try {
    if (statSync(path).isFile()) return;
  } catch { /* Give the same actionable error for an absent or inaccessible artifact. */ }
  throw new Error(`Windows Job Object helper is missing or inaccessible. Build it explicitly from the StelaShell root: ${WINDOWS_HELPER_BUILD}. No child was started.`);
}

/** POSIX supervisor control never shares the target's stdin or JSON output. */
function spawnPosix(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ManagedProcess {
  const spec = processSpec(command, args);
  const child = spawn(spec.command, spec.args, {
    ...options, env: { ...options.env, BUN_BE_BUN: "1" }, shell: false,
    detached: spec.detached, stdio: ["pipe", "pipe", "pipe", "ipc"],
  }) as ChildProcessWithoutNullStreams;
  let ready = false;
  let cleaned = false;
  let stopRequested: boolean | undefined;
  let groupPid: number | undefined;
  const send = (message: object) => {
    if (cleaned || !child.connected) return;
    child.send(message, (error) => {
      if (error && child.connected && !cleaned) child.emit("error", error);
    });
  };
  const signalGroup = () => {
    if (!groupPid) return;
    try { process.kill(-groupPid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  const stop = (force: boolean) => {
    if (cleaned) return;
    stopRequested = force || stopRequested === true;
    if (ready) send({ type: "stop", force: stopRequested });
    else if (child.pid) {
      // No launch request has been sent. Even a runtime that never acknowledges
      // startup must be cancellable, without leaving a separate supervisor.
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  };
  child.on("message", (value) => {
    const message = value as { type?: string; pid?: number; message?: string };
    if (message?.type === "ready" && !ready) {
      ready = true;
      if (stopRequested !== undefined) send({ type: "stop", force: stopRequested });
      else send({ type: "start", command, args, bunBeBun: options.env.BUN_BE_BUN ?? null });
    } else if (message?.type === "started" && Number.isSafeInteger(message.pid) && message.pid! > 0) groupPid = message.pid;
    else if (message?.type === "error" && typeof message.message === "string") child.emit("error", new Error(`Could not run POSIX child: ${message.message}`));
    else if (child.connected) child.disconnect();
  });
  child.once("exit", (_code, signal) => {
    // Normal exits already cleaned the group. A signal crash while the owner
    // is alive needs a fallback; never keep polling or reuse an old group PID.
    if (signal) {
      try { signalGroup(); } catch (error) { child.emit("error", error); }
    }
    cleaned = true;
  });
  return { child, terminate: () => stop(false), forceTerminate: () => stop(true), cleanup: () => stop(true) };
}

/** Shared pipes and argv; only process ownership/termination varies by OS. */
export function spawnManaged(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ManagedProcess {
  const windows = process.platform === "win32";
  if (!windows) return spawnPosix(command, args, options);
  if (windows) {
    requireWindowsHelper();
    if (!statSync(command).isFile()) throw new Error("The parent executable is not a regular file.");
  }
  const spec = processSpec(command, args);
  const child = spawn(spec.command, spec.args, {
    ...options,
    shell: false,
    detached: spec.detached,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let cleaned = false;
  const signal = (kind: NodeJS.Signals) => {
    if (!child.pid || cleaned) return;
    try {
      if (windows) {
        // Terminating the controller closes its non-inherited Job handle. The
        // kernel kills the contained tree; a leader PID lookup is not involved.
        child.kill(kind);
      } else process.kill(-child.pid, kind);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const cleanup = () => {
    if (cleaned) return;
    signal("SIGKILL");
    cleaned = true;
  };
  // The Windows controller waits for an empty Job on normal completion.
  // POSIX group cleanup now belongs to the independent supervisor above.
  child.once("exit", () => {
    try { cleanup(); } catch (error) { child.emit("error", error); }
  });
  return {
    child,
    terminate: () => signal("SIGTERM"),
    forceTerminate: () => signal("SIGKILL"),
    cleanup,
  };
}
