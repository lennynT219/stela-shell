import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { capabilityLines } from "../capabilities.ts";

const labels = ["Web", "Imágenes", "Memoria", "Conocimiento", "Codemode"];
test("marks only complete local capability baselines; missing or partial tools leave just the name", () => {
  assert.deepEqual(capabilityLines([]), labels.map(label => `    ${label}`));
  assert.deepEqual(capabilityLines(["ss_web_read", "ss_images_edit", "ss_memory_read", "ss_knowledge_sources", "other_codemode"]),
    labels.map(label => `    ${label}`));
  assert.deepEqual(capabilityLines(["ss_web_search", "ss_web_read", "ss_images_generate", "ss_images_save", "ss_memory_read", "ss_memory_save",
    "ss_knowledge_list", "ss_knowledge_read", "codemode"]), labels.map(label => `  ✓ ${label}`));
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi Panel: inline capabilities stay expanded until folded, show current tools, and leave the draft and services alone", {
  skip: process.platform !== "linux" || !cli, timeout: 45_000,
}, async () => {
  await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/capabilities-tui.py", import.meta.url)),
    process.execPath, cli!], { timeout: 40_000, maxBuffer: 512 * 1024 });
});
