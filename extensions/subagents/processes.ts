import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the checkout even when the extension is loaded through a profile link.
export const WINDOWS_JOB_HELPER = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "../../native/windows-job/target/release/stela-job.exe");
export const WINDOWS_HELPER_BUILD = "cargo build --locked --release --manifest-path native/windows-job/Cargo.toml";

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
  return { command, args: [...args], detached: true };
}

/** The Windows helper is built explicitly, never downloaded/compiled on delegation. */
export function requireWindowsHelper(path = WINDOWS_JOB_HELPER): void {
  try {
    if (statSync(path).isFile()) return;
  } catch { /* Give the same actionable error for an absent or inaccessible artifact. */ }
  throw new Error(`Windows Job Object helper is missing or inaccessible. Build it explicitly from the StelaShell root: ${WINDOWS_HELPER_BUILD}. No child was started.`);
}

/** Shared pipes and argv; only process ownership/termination varies by OS. */
export function spawnManaged(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ManagedProcess {
  const windows = process.platform === "win32";
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
  // An exiting POSIX leader can leave descendants holding its stdout open.
  // Kill the owned group on exit, before waiting for pipe close. The Windows
  // controller already waits for an empty Job on normal completion.
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
