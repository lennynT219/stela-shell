import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export interface ExecutableSelection { command: string; path: string }
export class ExecutableError extends Error {
  readonly code: "INVALID_EXECUTABLE" | "EXECUTABLE_NOT_FOUND";
  constructor(code: "INVALID_EXECUTABLE" | "EXECUTABLE_NOT_FOUND") {
    super("Brain executable could not be selected; no process was started.");
    this.name = "ExecutableError"; this.code = code;
  }
}

/** Windows root-/drive-relative names are not pinned to a complete location. */
function validateCommand(command: string): void {
  if (!command.trim() || command.includes("\0") || (!isAbsolute(command) && /[\\/]/.test(command)))
    throw new ExecutableError("INVALID_EXECUTABLE");
  if (process.platform === "win32" && (
      /^[\\/](?![\\/])/.test(command) || /^[A-Za-z]:(?![\\/])/.test(command) ||
      (isAbsolute(command) && !/\.exe$/i.test(command))))
    throw new ExecutableError("INVALID_EXECUTABLE");
}

/** Loading Memory authorizes this host-owned selection; no CLI flags. */
export function selectExecutable(environment: NodeJS.ProcessEnv): ExecutableSelection {
  const command = environment.BRAIN_BIN?.trim() ? environment.BRAIN_BIN : "brain";
  validateCommand(command);
  if (isAbsolute(command)) return { command, path: "" };
  // Windows environment keys are case-insensitive; POSIX keys are not.
  const key = process.platform === "win32" ? Object.keys(environment).find(k => k.toUpperCase() === "PATH") : "PATH";
  const path = (key ? environment[key] : undefined) ?? "";
  if (path.includes("\0")) throw new ExecutableError("INVALID_EXECUTABLE");
  return { command, path };
}

/** Resolve once for the current owner. No shell, command probe or backend I/O. */
export function resolveExecutable(selection: ExecutableSelection, cwd: string): string {
  if (!isAbsolute(cwd) || cwd.includes("\0")) throw new ExecutableError("INVALID_EXECUTABLE");
  validateCommand(selection.command);
  if (isAbsolute(selection.command)) return selection.command;
  // The direct Windows client accepts native .exe files, never shell scripts.
  const name = process.platform === "win32" && !/\.exe$/i.test(selection.command)
    ? `${selection.command}.exe` : selection.command;
  // An absent/empty PATH is not permission to guess a system installation.
  if (!selection.path) throw new ExecutableError("EXECUTABLE_NOT_FOUND");
  for (const entry of selection.path.split(delimiter)) {
    const directory = process.platform === "win32" && /^".*"$/.test(entry) ? entry.slice(1,-1) : entry;
    const candidate = join(resolve(cwd,directory || "."),name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate,process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* Continue metadata-only PATH selection; no candidate is executed. */ }
  }
  throw new ExecutableError("EXECUTABLE_NOT_FOUND");
}
