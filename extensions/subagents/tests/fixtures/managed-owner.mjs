// A disposable parent for the controller's parent-death contract. Never Pi or a model.
import { spawnManaged } from "../../processes.ts";
import { fileURLToPath } from "node:url";

const startupExit = process.argv[2] === "startup-exit";
const args = startupExit
  ? ["-e", "require('node:fs').writeFileSync(process.argv[1], 'unexpected')", process.argv[3]]
  : [fileURLToPath(new URL("./process-tree.mjs", import.meta.url)), "hang"];
const child = spawnManaged(process.execPath, args, {
  cwd: process.cwd(), env: process.env,
});
if (startupExit) {
  process.stdout.write(`${JSON.stringify([child.child.pid])}\n`);
  // No event-loop turn: the owner cannot process a supervisor-ready handshake.
  process.kill(process.pid, "SIGKILL");
}
if (process.argv[2] === "with-supervisor") {
  let buffer = "";
  child.child.stdout.setEncoding("utf8");
  child.child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.includes("\n")) {
      process.stdout.write(`${JSON.stringify([child.child.pid, ...JSON.parse(buffer.slice(0, buffer.indexOf("\n")))])}\n`);
      buffer = "";
    }
  });
} else child.child.stdout.pipe(process.stdout);
child.child.stderr.pipe(process.stderr);
child.child.stdin.end();
child.child.once("close", (code) => { process.exitCode = code ?? 1; });
