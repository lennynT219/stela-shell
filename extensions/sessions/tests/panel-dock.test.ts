import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi editor: the Panel control follows the bottom of the draft, not the cursor or completion list", {
  skip: !cli || process.platform !== "linux", timeout: 50_000,
}, async () => {
  const { stdout } = await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/panel-dock.py", import.meta.url)), process.execPath, cli!], { timeout: 45_000 });
  assert.match(stdout, /Dock verified with Kitty and text/);
});
