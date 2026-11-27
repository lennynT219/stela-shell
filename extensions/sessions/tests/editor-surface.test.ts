import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi TUI: only the draft is tinted; the exposed part of Stela opens the Panel", {
  skip: !cli || process.platform !== "linux", timeout: 45_000,
}, async () => {
  const { stdout } = await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/editor-surface.py", import.meta.url)), process.execPath, cli!], { timeout: 40_000 });
  assert.match(stdout, /Surface and exposed hit target verified/);
});
