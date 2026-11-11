// Native process-lifecycle fixture. Descendants deliberately retain stdout and
// ignore POSIX SIGTERM so cleanup must cover the owned tree, not just the leader.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "hang";
const depth = Number(process.argv[3] ?? "2");
let descendants = [];
if (depth > 0) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "hang", String(depth - 1)], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  descendants = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("message", resolve);
    child.once("exit", (code) => reject(new Error(`fixture descendant exited early: ${code}`)));
  });
  child.disconnect();
  child.unref();
}
const pids = [process.pid, ...descendants];
if (process.send) process.send(pids);
else process.stdout.write(`${JSON.stringify(pids)}\n`);
if (mode !== "exit") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
