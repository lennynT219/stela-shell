// Opt-in behavioral observation. Preparing/analyzing never invokes a model.
// Live runs preserve the profile and production instructions; no prompt asks for delegation.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { spawnManaged } from "../../processes.ts";
import { files, oracle, simplePrompt, broadPrompt } from "./fixtures.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const MAX_FRAME = 1024 * 1024;
const MAX_STREAM = 32 * 1024 * 1024;
const sourceFiles = ["extensions/method/index.ts", "extensions/method/assets/method.md", "extensions/subagents/index.ts", "extensions/subagents/runner.ts", "extensions/subagents/tasks.ts", "extensions/subagents/processes.ts", "extensions/subagents/posix-supervisor.mjs", "extensions/subagents/assets/helper.md"];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const save = (path, value) => writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
export function redact(text) {
  return stripVTControlCharacters(String(text))
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*)["']?[^\s,}"']+["']?/gi, "$1[REDACTED]");
}
function sanitize(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(api[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(key) ? "[REDACTED]" : sanitize(item)]));
  return value;
}
const publicContent = (content) => Array.isArray(content)
  ? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => ({ type: "text", text: redact(part.text) })) : [];

/** Whitelist wire events; never persist cumulative snapshots, thinking or agent_end messages. */
export function publicEvent(event) {
  if (!event || typeof event !== "object") return undefined;
  if (["session", "agent_start", "turn_start", "agent_settled"].includes(event.type)) {
    return Object.fromEntries(["type", "id", "cwd", "aborted"].filter((key) => key in event).map((key) => [key, event[key]]));
  }
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const message = event.message;
    return { type: event.type, message: { role: "assistant", provider: message.provider, model: message.model, stopReason: message.stopReason,
      content: publicContent(message.content), ...(message.errorMessage ? { errorMessage: redact(message.errorMessage).slice(0, 2048) } : {}) } };
  }
  if (event.type === "tool_execution_start") return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, args: sanitize(event.args ?? {}) };
  if (event.type === "tool_execution_end") {
    const details = event.result?.details ?? {};
    return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError,
      result: { content: publicContent(event.result?.content), details: Object.fromEntries(["taskId", "label", "state", "duplicate", "timeoutSeconds", "requested"].filter((key) => key in details).map((key) => [key, details[key]])) } };
  }
  if (event.type === "entry_appended" && event.entry?.customType === "stela-subagent-result") {
    const entry = event.entry;
    return { type: event.type, entry: { id: entry.id, customType: entry.customType, content: redact(entry.content), details: Object.fromEntries(["taskId", "label", "state", "truncated"].filter((key) => key in (entry.details ?? {})).map((key) => [key, entry.details[key]])) } };
  }
  return undefined;
}

export function summarize(events) {
  const starts = new Map(events.filter((event) => event.type === "tool_execution_start").map((event) => [event.toolCallId, event]));
  const admissions = events.filter((event) => event.type === "tool_execution_end" && event.toolName === "stela_delegate" && !event.isError && event.result?.details?.taskId)
    .map((event) => ({ seq: event.seq, ...event.result.details, assignment: starts.get(event.toolCallId)?.args }));
  const results = events.filter((event) => event.type === "entry_appended" && event.entry?.customType === "stela-subagent-result")
    .map((event) => ({ seq: event.seq, entryId: event.entry.id, ...event.entry.details, content: event.entry.content }));
  const work = events.filter((event) => event.type === "tool_execution_start" && !["stela_delegate", "stela_cancel"].includes(event.toolName)
    && admissions.some((admission) => admission.seq < event.seq && !results.some((result) => result.taskId === admission.taskId && result.seq < event.seq)))
    .map((event) => ({ seq: event.seq, toolName: event.toolName, args: event.args }));
  const messages = events.filter((event) => event.type === "message_end" && event.message.role === "assistant");
  const text = (event) => event.message.content.map((part) => part.text).join("\n");
  const last = messages.at(-1);
  const count = (id) => results.filter((result) => result.taskId === id).length;
  return {
    sessionIds: events.filter((event) => event.type === "session").map((event) => event.id),
    delegatedCalls: admissions.length, uniqueTasks: new Set(admissions.map((item) => item.taskId)).size, admissions, results,
    missingResults: [...new Set(admissions.map((item) => item.taskId))].filter((id) => !count(id)),
    repeatedResults: [...new Set(results.map((item) => item.taskId))].filter((id) => count(id) > 1),
    principalWorkBeforeDelivery: work,
    principalMessages: messages.map((event) => ({ seq: event.seq, stopReason: event.message.stopReason, text: text(event) })),
    settled: events.some((event) => event.type === "agent_settled" && !event.aborted),
    providerErrors: messages.filter((event) => ["error", "aborted"].includes(event.message.stopReason)).map((event) => event.message.errorMessage ?? event.message.stopReason),
    observedModels: [...new Set(messages.filter((event) => event.message.provider && event.message.model).map((event) => `${event.message.provider}/${event.message.model}`))],
    finalAnswer: last ? text(last) : "",
    limitation: "Public parent event ordering establishes work before delivery, not concurrent child execution, hidden reasoning, runtime speed or total child usage. Utility and oracle coverage require human/source review.",
  };
}

export function snapshot(workspace) {
  const result = {};
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) walk(target);
      else result[relative(workspace, target).replaceAll("\\", "/")] = entry.isFile() ? sha(readFileSync(target)) : "non-regular-entry";
    }
  };
  walk(workspace);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export function writeWorkspace(workspace) {
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(files)) {
    const path = join(workspace, name); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); save(path, content);
  }
  return snapshot(workspace);
}

export function prepare(root, { cli, profile, model }) {
  if (existsSync(root)) throw new Error("Use a new artifact directory; an existing experiment is never overwritten or resumed automatically.");
  const settingsPath = join(profile, "settings.json");
  const settingsText = readFileSync(settingsPath, "utf8");
  const settings = JSON.parse(settingsText);
  const help = execFileSync(process.execPath, [cli, "--offline", "--help"], { cwd: repository, env: { ...process.env, PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!help.includes("--stela-subagent-concurrency")) throw new Error("The selected profile did not register the production subagent extension. No profile activation is performed by this experiment.");
  const routes = ["stela-method", "stela-subagents"].map((name) => ({ name, target: realpathSync(join(profile, "extensions", name)) }));
  if (routes[0].target !== join(repository, "extensions/method") || routes[1].target !== join(repository, "extensions/subagents")) throw new Error("Profile links do not point at this checkout; resolve the target before testing.");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const cases = [
    { id: "simple", prompt: simplePrompt, expectation: "Direct retrieval; no helper normally justified." },
    { id: "broad-1", prompt: broadPrompt, expectation: "Independent questions offer a delegation opportunity; no fixed helper count is required." },
    { id: "broad-2", prompt: broadPrompt, expectation: "Independent repetition, not a retry or an instruction to delegate." },
  ].map((item) => {
    const directory = join(root, item.id); mkdirSync(directory, { mode: 0o700 });
    const workspace = join(directory, "workspace");
    return { ...item, directory, workspace, inputHashes: writeWorkspace(workspace) };
  });
  const manifest = {
    schema: 1, createdAt: new Date().toISOString(), sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    sourceHashes: Object.fromEntries(sourceFiles.map((path) => [path, sha(readFileSync(join(repository, path)))])),
    node: process.version, piVersion: execFileSync(process.execPath, [cli, "--offline", "--version"], { cwd: repository, encoding: "utf8" }).trim(),
    profile, settingsSha256: sha(settingsText), resourceRoutes: routes, model,
    thinkingSelection: settings.defaultThinkingLevel ?? "Pi default, no CLI override", defaultTools: settings.defaultTools ?? "Pi defaults",
    cli: realpathSync(cli), args: ["--offline", "--mode", "json", "--print", "--no-session", "--no-mcp", "--model", model],
    limits: { caseSeconds: 600, principalTurns: 20, acceptedTasks: 5 }, cases,
    qualifications: ["No provider fixture, role template, altered FARO or delegation cue in task prompts.", "MCP is disabled only for these runs; the profile, production extensions, default tools and other instructions remain loaded.", "JSON mode observes decisions/integration, not TUI presentation or actual execution overlap.", "The private oracle and artifacts are outside the authorized workspace, never given to the observed principal.", "No total-cost or speed claim: child usage is not aggregated by the production core."],
  };
  save(join(root, "manifest.json"), manifest);
  save(join(root, "oracle.json"), oracle.map((item) => ({ ...item, line: files[item.file].split("\n").findIndex((line) => line.includes(item.anchor)) + 1 })));
  console.log(`Prepared ${root}; no model request was made.`);
  return manifest;
}

async function runCase(item, manifest) {
  const events = [];
  const output = join(item.directory, "events.jsonl");
  save(output, "");
  let buffer = "", streamBytes = 0, diagnostics = "", stopReason, turns = 0;
  let forceTimer;
  const managed = spawnManaged(process.execPath, [manifest.cli, ...manifest.args], {
    cwd: item.workspace, env: { ...process.env, PI_CODING_AGENT_DIR: manifest.profile, PI_OFFLINE: "1", NO_UPDATE_NOTIFIER: "1" },
  });
  const child = managed.child;
  const stop = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    managed.terminate();
    forceTimer = setTimeout(() => managed.forceTerminate(), 1500);
  };
  const capture = (event) => {
    const visible = publicEvent(event);
    if (visible) {
      const record = { seq: events.length + 1, ...visible }; events.push(record);
      writeFileSync(output, `${JSON.stringify(record)}\n`, { flag: "a", mode: 0o600 });
    }
    if (event.type === "turn_start" && ++turns > manifest.limits.principalTurns) stop("Principal-turn observation bound reached; not a behavioral verdict.");
    if (event.type === "tool_execution_end" && event.toolName === "stela_delegate" && !event.isError) {
      const details = event.result?.details ?? {};
      console.log(`${item.id}: admitted ${details.taskId ?? "unknown"} | ${details.label ?? ""} | ${details.state ?? ""}`);
      if (new Set(events.filter((record) => record.type === "tool_execution_end" && record.toolName === "stela_delegate" && !record.isError).map((record) => record.result?.details?.taskId)).size > manifest.limits.acceptedTasks) stop("Assignment observation bound reached; not a behavioral verdict.");
    }
    if (event.type === "entry_appended" && event.entry?.customType === "stela-subagent-result") console.log(`${item.id}: delivered ${event.entry.details?.taskId} | ${event.entry.details?.state}`);
  };
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (stopReason) return;
    streamBytes += Buffer.byteLength(chunk);
    if (streamBytes > MAX_STREAM) { stop("JSON stream bound reached."); return; }
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_FRAME) { stop("JSON frame bound reached."); return; }
      if (!line.trim()) continue;
      try { capture(JSON.parse(line)); } catch { stop("Invalid JSON event or public-event capture failure."); return; }
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME) stop("JSON frame bound reached.");
  });
  child.stderr.on("data", (chunk) => { diagnostics = redact(diagnostics + chunk).slice(0, 8192); });
  child.on("error", (error) => { diagnostics = redact(`${diagnostics}\n${error.message}`).slice(0, 8192); });
  child.stdin.on("error", () => stop("Could not send the task."));
  const deadline = setTimeout(() => stop("Case hard deadline reached; not a behavioral verdict."), manifest.limits.caseSeconds * 1000);
  const interrupt = () => stop("Experiment interrupted.");
  process.once("SIGTERM", interrupt); process.once("SIGINT", interrupt);
  const closed = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
  child.stdin.end(item.prompt);
  const exit = await closed;
  clearTimeout(deadline); clearTimeout(forceTimer);
  process.removeListener("SIGTERM", interrupt); process.removeListener("SIGINT", interrupt);
  managed.cleanup();
  if (buffer.trim() && !stopReason) stopReason = "Unterminated JSON event.";
  const summary = { id: item.id, ...exit, observationLimit: stopReason ?? null, diagnostics, workspaceUnchanged: JSON.stringify(snapshot(item.workspace)) === JSON.stringify(item.inputHashes), settingsUnchanged: sha(readFileSync(join(manifest.profile, "settings.json"))) === manifest.settingsSha256, ...summarize(events) };
  save(join(item.directory, "summary.json"), summary);
  save(join(item.directory, "answer.md"), `${summary.finalAnswer}\n`);
  console.log(`${item.id}: ended | ${summary.uniqueTasks} unique helpers | ${summary.results.length} deliveries | settled=${summary.settled} | workspaceUnchanged=${summary.workspaceUnchanged}`);
  return summary;
}

export async function run(root) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (sha(readFileSync(join(manifest.profile, "settings.json"))) !== manifest.settingsSha256) throw new Error("Profile settings changed since preparation; no run was started.");
  for (const [path, hash] of Object.entries(manifest.sourceHashes)) if (sha(readFileSync(join(repository, path))) !== hash) throw new Error(`Production input changed: ${path}`);
  for (const item of manifest.cases) if (JSON.stringify(snapshot(item.workspace)) !== JSON.stringify(item.inputHashes)) throw new Error(`Fixture changed: ${item.id}`);
  writeFileSync(join(root, "started.json"), `${JSON.stringify({ startedAt: new Date().toISOString() })}\n`, { flag: "wx", mode: 0o600 });
  const summaries = [];
  for (const item of manifest.cases) {
    console.log(`Starting ${item.id} | ${manifest.model} | fresh session | public events only`);
    const summary = await runCase(item, manifest); summaries.push(summary);
    save(join(root, "summary.json"), { summaries, remaining: manifest.cases.slice(summaries.length).map((next) => next.id), assessment: "Pending evidence review; tool counts are not a behavioral score." });
    if (summary.code !== 0 || summary.observationLimit || !summary.settled || summary.providerErrors.length || !summary.workspaceUnchanged || !summary.settingsUnchanged || /Failed to load extension|Extension error/.test(summary.diagnostics)) {
      console.log(`Stopped after ${item.id}; remaining cases were not attempted. No retry, provider fallback or configuration change.`);
      process.exitCode = 1; break;
    }
  }
  console.log(`OBSERVATION_DONE ${root}`);
}

function main() {
  const [action, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--out", "--cli", "--profile", "--model"].includes(args[i]) || !args[i + 1]) throw new Error("Use prepare --out DIR --cli FILE --profile DIR --model PROVIDER/ID, or run --out DIR.");
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.out) throw new Error("An explicit private artifact directory is required.");
  const root = resolve(options.out);
  if (action === "prepare" && options.cli && options.profile && options.model) return prepare(root, { cli: resolve(options.cli), profile: resolve(options.profile), model: options.model });
  if (action === "run") {
    // A separate run directory is required for every approved repetition.
    if (existsSync(join(root, "started.json"))) throw new Error("This experiment has already started; automatic replay is forbidden.");
    return run(root);
  }
  throw new Error("Unknown action or incomplete preparation options.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(main).catch((error) => { console.error(redact(error.message)); process.exitCode = 1; });
}
