// A disposable parent for the controller's parent-death contract. Never Pi or a model.
import { spawnManaged } from "../../processes.ts";
import { fileURLToPath } from "node:url";

const child = spawnManaged(process.execPath, [fileURLToPath(new URL("./process-tree.mjs", import.meta.url)), "hang"], {
  cwd: process.cwd(), env: process.env,
});
child.child.stdout.pipe(process.stdout);
child.child.stderr.pipe(process.stderr);
child.child.stdin.end();
child.child.once("close", (code) => { process.exitCode = code ?? 1; });
