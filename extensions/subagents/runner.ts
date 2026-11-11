import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import type { Assignment } from "./tasks.ts";

export const CHILD_MARKER = "STELA_SUBAGENT_CHILD";
export const CHILD_SCOPE = "STELA_SUBAGENT_SCOPE";
export const READY_ENTRY = "stela-helper-ready";
export const BLOCKED_ENTRY = "stela-helper-blocked";
export const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
export const RESULT_BYTES = 8 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;

export interface Launch { command: string; prefix: string[]; resourceArgs: string[] }
export interface Scope { roots: Array<{ path: string; directory: boolean }>; tools: string[] }
export interface RunOptions {
  assignment: Assignment;
  cwd: string;
  model: string;
  thinking: string;
  scope: Scope;
  launch: Launch;
  trusted: boolean;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  killGraceMs?: number;
}
export interface RunResult {
  status: "completed" | "failed" | "cancelled";
  output: string;
  error?: string;
  diagnostics: string;
  trace: string[];
  truncated: boolean;
}

export function boundedText(text: string, bytes: number): string {
  const clean = stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  if (Buffer.byteLength(clean) <= bytes) return clean;
  const suffix = "\n[Truncated; omitted text was not retained.]";
  let prefix = Buffer.from(clean).subarray(0, Math.max(0, bytes - Buffer.byteLength(suffix))).toString("utf8");
  while (Buffer.byteLength(prefix + suffix) > bytes) prefix = prefix.slice(0, -1);
  return prefix + suffix;
}

export function makeScope(references: string[], cwd: string, tools: string[]): Scope {
  if (!tools.length || tools.some((name) => !READ_TOOLS.includes(name as typeof READ_TOOLS[number]))) throw new Error("No supported, authorized read tools are available.");
  return {
    roots: [...new Set(references.map((path) => realpathSync(resolve(cwd, path.replace(/^@/, "")))))]
      .map((path) => {
        const stat = statSync(path);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error("References must be regular files or directories.");
        return { path, directory: stat.isDirectory() };
      }),
    tools: [...tools],
  };
}

export function pathInScope(path: string, cwd: string, scope: Scope): boolean {
  try {
    const target = realpathSync(resolve(cwd, path.replace(/^@/, "")));
    return scope.roots.some((root) => {
      const rel = relative(root.path, target);
      return rel === "" || (root.directory && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
    });
  } catch { return false; }
}

/** Only native Pi launches are supported. Never silently fall back to another pi on PATH. */
export function resolveLaunch(argv = process.argv, execPath = process.execPath): Launch {
  const script = argv[1] && existsSync(argv[1]) ? realpathSync(argv[1]) : undefined;
  let prefix: string[];
  if (/^(node|bun)(\.exe)?$/i.test(basename(execPath))) {
    if (!script || !/[\\/]dist[\\/](bundle[\\/])?cli\.js$/.test(script)) throw new Error("Subagents require a native packaged Pi CLI launch; this SDK/bridge/source launcher is not supported.");
    const packageRoot = basename(dirname(script)) === "bundle" ? resolve(dirname(script), "../..") : resolve(dirname(script), "..");
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    if (manifest.name !== "@earendil-works/pi-coding-agent") throw new Error("Cannot identify the parent Pi executable.");
    prefix = [script];
  } else {
    if (!/^pi(\.exe)?$/i.test(basename(execPath))) throw new Error("Unsupported Pi executable; no fallback was attempted.");
    prefix = [];
  }
  const resourceArgs: string[] = [];
  const retainedValues = new Set(["-e", "--extension", "--system-prompt", "--append-system-prompt", "--skill", "--prompt-template", "--theme"]);
  const retainedFlags = new Set(["-ne", "--no-extensions", "-ns", "--no-skills", "-np", "--no-prompt-templates", "--no-themes", "-nc", "--no-context-files", "--no-mcp"]);
  const skippedValues = new Set(["--mode", "--provider", "--model", "--thinking", "--models", "--session", "--session-id", "--session-dir", "--fork", "-n", "--name", "-t", "--tools", "-xt", "--exclude-tools", "--tui-mode", "--use-theme", "--stela-subagent-concurrency"]);
  const skippedFlags = new Set(["-p", "--print", "-c", "--continue", "-r", "--resume", "--no-session", "-nt", "--no-tools", "-nbt", "--no-builtin-tools", "-a", "--approve", "-na", "--no-approve", "--offline", "--verbose"]);
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") break;
    if (retainedValues.has(arg) || skippedValues.has(arg)) {
      const value = argv[++i];
      if (!value) throw new Error(`Missing parent option value: ${arg}`);
      if (retainedValues.has(arg)) {
        // Re-resolving remote -e sources could install or update packages. Do not do it.
        if (["-e", "--extension"].includes(arg) && !value.startsWith("builtin:") && !existsSync(value)) throw new Error("Child launch requires local explicit extension paths; remote package flags are not replayed.");
        resourceArgs.push(arg, value);
      }
    } else if (retainedFlags.has(arg)) resourceArgs.push(arg);
    else if (!skippedFlags.has(arg) && arg.startsWith("-")) {
      throw new Error(`Cannot safely inherit parent option ${arg}; delegation was not started.`);
    }
  }
  return { command: execPath, prefix, resourceArgs };
}

export function childArguments(options: RunOptions): string[] {
  return [
    ...options.launch.prefix, ...options.launch.resourceArgs,
    "--offline", "--mode", "json", "--print", "--no-session", "--no-mcp", "--tools", options.scope.tools.join(","),
    options.trusted ? "--approve" : "--no-approve",
    "--extension", fileURLToPath(new URL("./index.ts", import.meta.url)),
    "--append-system-prompt", fileURLToPath(new URL("./assets/helper.md", import.meta.url)),
    "--model", options.model, "--thinking", options.thinking,
  ];
}

/** One-shot JSON process; no session transcripts, whole-conversation copies, or model-side polling. */
export async function runChild(options: RunOptions): Promise<RunResult> {
  const result: RunResult = { status: "failed", output: "", diagnostics: "", trace: [], truncated: false };
  if (options.signal.aborted) return { ...result, status: "cancelled", error: "Cancelled before launch." };
  if (process.platform === "win32") return { ...result, error: "This first runner requires POSIX process-group cleanup; Windows is not supported yet." };
  return new Promise((resolveResult) => {
    let child: ReturnType<typeof spawn>;
    let ready = false;
    let settled = false;
    let stopReason: string | undefined;
    let completed = false;
    let stopping = false;
    let reason: string | undefined;
    let buffer = "";
    let totalBytes = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
    const group = process.platform !== "win32";

    const kill = (signal: NodeJS.Signals) => {
      if (!child?.pid) return;
      try {
        if (group) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") result.diagnostics = boundedText(`${result.diagnostics}\nCould not terminate child: ${String(error)}`, 2048);
      }
    };
    const stop = (message: string) => {
      reason ??= message;
      if (stopping || completed) return;
      stopping = true;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), options.killGraceMs ?? 1000);
    };
    const abort = () => stop("Cancelled by the parent.");
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (completed) return;
      completed = true;
      clearTimeout(deadline); clearTimeout(killTimer); clearTimeout(shutdownDeadline);
      options.signal.removeEventListener("abort", abort);
      if (options.signal.aborted) result.status = "cancelled";
      else if (reason || code !== 0 || signal || !ready || !settled || stopReason !== "stop" || !result.output.trim()) result.status = "failed";
      else result.status = "completed";
      if (result.status !== "completed") result.error = boundedText(reason ?? (signal ? `Child terminated by ${signal}.` : code !== 0 ? `Child exited with code ${code}.` : !ready ? "Child read-only guard did not initialize." : !settled ? "Child exited without agent_settled." : `Incomplete child response (${stopReason ?? "no assistant output"}).`), 1024);
      resolveResult(result);
    };
    const frame = (line: string) => {
      if (!line.trim() || stopping) return;
      let event: any;
      try { event = JSON.parse(line); } catch { stop("Malformed child JSON stream."); return; }
      if (!event || typeof event.type !== "string") { stop("Invalid child event."); return; }
      if (event.type === "entry_appended" && event.entry?.customType === READY_ENTRY) ready = true;
      if (event.type === "entry_appended" && event.entry?.customType === BLOCKED_ENTRY) stop("Child attempted a disallowed operation or exceeded its work budget.");
      if (event.type === "agent_start") {
        settled = false;
        if (!ready) stop("Child started without the read-only guard.");
      }
      if (event.type === "tool_execution_start") {
        if (!options.scope.tools.includes(event.toolName)) { stop("Unexpected child tool execution."); return; }
        const detail = typeof event.args?.path === "string" ? ` ${event.args.path}` : "";
        if (result.trace.length < 32) result.trace.push(boundedText(`${event.toolName}${detail}`, 256));
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const message = event.message;
        stopReason = message.stopReason;
        const output = Array.isArray(message.content) ? message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n") : "";
        result.truncated = Buffer.byteLength(output) > RESULT_BYTES;
        result.output = boundedText(output, RESULT_BYTES);
        if (typeof message.errorMessage === "string") result.diagnostics = boundedText(message.errorMessage, 2048);
      }
      if (event.type === "agent_settled") {
        settled = true;
        if (event.aborted) reason ??= "Child run was aborted.";
        // The run is done; do not let extension shutdown hang indefinitely.
        shutdownDeadline ??= setTimeout(() => stop("Child did not exit after settlement."), 5000);
      }
    };
    try {
      child = spawn(options.launch.command, childArguments(options), {
        cwd: options.cwd,
        env: { ...(options.env ?? process.env), [CHILD_MARKER]: "1", [CHILD_SCOPE]: JSON.stringify(options.scope), PI_OFFLINE: "1" },
        shell: false, detached: group, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reason = `Could not spawn child: ${String(error)}`;
      finish(null, null);
      return;
    }
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (stopping) return;
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > MAX_STREAM_BYTES) { stop("Child stream exceeded 16 MiB."); return; }
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES) { stop("Child JSON frame exceeded 1 MiB."); return; }
        frame(line);
      }
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) stop("Child JSON frame exceeded 1 MiB.");
    });
    child.stderr!.on("data", (chunk: string) => { result.diagnostics = boundedText(result.diagnostics + chunk, 2048); });
    child.on("error", (error) => { reason ??= `Could not run child: ${error.message}`; });
    child.on("close", (code, signal) => {
      // The leader may exit before a descendant that ignored SIGTERM. Do not orphan
      // anything still in this child-owned group when clearing the escalation timer.
      if (group) kill("SIGKILL");
      if (buffer.trim() && !stopping) reason ??= "Unterminated child JSON record.";
      finish(code, signal);
    });
    child.stdin!.on("error", (error) => stop(`Could not send assignment: ${error.message}`));
    // Piped input avoids command-line prompt interpolation and temporary prompt files.
    child.stdin!.end(`Resolve this bounded assignment. Its references are the only authorized read surfaces.\n${JSON.stringify(options.assignment)}\n`);
    options.signal.addEventListener("abort", abort, { once: true });
    deadline = setTimeout(() => stop("Child exceeded its 120-second execution deadline; no retry was started."), options.timeoutMs ?? 120_000);
    if (options.signal.aborted) abort();
  });
}
