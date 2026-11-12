// A local lifecycle supervisor, never a Pi session or model. Its private IPC
// channel belongs only to the owner; the target inherits the three stdio pipes.
import { spawn } from "node:child_process";
import { constants } from "node:os";

const GRACE_MS = 1000;
const MAX_CONTROL_BYTES = 1024 * 1024;
let target;
let stopping = false;
let finished = false;
let groupCleaned = false;
let forceTimer;

const signalGroup = (signal) => {
  if (!target?.pid) return;
  try { process.kill(-target.pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
};
const cleanup = () => {
  if (groupCleaned) return;
  signalGroup("SIGKILL");
  groupCleaned = true;
};
const finish = (code) => {
  if (finished) return;
  finished = true;
  clearTimeout(forceTimer);
  try { cleanup(); }
  catch { code = 125; }
  process.exit(code);
};
const stop = (force) => {
  if (finished) return;
  stopping = true;
  if (!target?.pid) { finish(125); return; }
  try { signalGroup(force ? "SIGKILL" : "SIGTERM"); }
  catch { finish(125); return; }
  // Escalation belongs here as well as in the owner: owner death cannot remove it.
  forceTimer ??= setTimeout(() => {
    try { signalGroup("SIGKILL"); } catch { finish(125); }
  }, GRACE_MS);
};
const fail = (message) => {
  // Never print the assignment, argv or environment into diagnostics.
  process.stderr.write(`stela-posix: ${message}\n`);
  if (!process.connected || !process.send) { stop(true); return; }
  process.send({ type: "error", message }, () => stop(true));
  // Never hang on error delivery if the owner disappears while writing.
  setTimeout(() => stop(true), 100).unref();
};

process.on("SIGTERM", () => stop(false));
process.on("SIGINT", () => stop(false));
process.on("SIGHUP", () => stop(true));
process.on("uncaughtException", () => { finish(125); });
process.on("unhandledRejection", () => { finish(125); });
process.on("exit", () => { try { cleanup(); } catch { /* best effort at teardown */ } });
process.on("disconnect", () => stop(true));
process.on("message", (message) => {
  if (finished) return;
  if (message?.type === "stop") { stop(message.force === true); return; }
  if (Buffer.byteLength(JSON.stringify(message)) > MAX_CONTROL_BYTES ||
      message?.type !== "start" || target || typeof message.command !== "string" || !message.command ||
      !Array.isArray(message.args) || message.args.some((arg) => typeof arg !== "string") ||
      !(message.bunBeBun === null || typeof message.bunBeBun === "string")) {
    fail("invalid launch request"); return;
  }
  if (stopping || !process.connected) { finish(125); return; }
  const env = { ...process.env };
  // Compiled Bun Pi can reuse its embedded JS runtime for this supervisor only.
  if (message.bunBeBun === null) delete env.BUN_BE_BUN;
  else env.BUN_BE_BUN = message.bunBeBun;
  target = spawn(message.command, message.args, {
    env, shell: false, detached: true, stdio: [0, 1, 2],
  });
  target.once("error", () => { fail("could not spawn child"); });
  target.once("spawn", () => {
    if (process.connected) process.send({ type: "started", pid: target.pid }, () => {});
    else stop(true);
  });
  // Exit, not close: descendants can keep inherited stdout/stderr open.
  target.once("exit", (code, signal) => finish(code ?? 128 + (constants.signals[signal] ?? 0)));
});
// No target may launch before a live owner completes this handshake. Disconnect
// before startup is harmless; disconnect during spawn/work kills the owned group.
if (process.connected && process.send) process.send({ type: "ready" }, (error) => { if (error) stop(true); });
else finish(125);
