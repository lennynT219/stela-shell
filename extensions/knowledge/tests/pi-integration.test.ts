import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = process.env.SS_TEST_PI_CLI, brain = process.env.SS_TEST_BRAIN_NOTES_EXE;
const provider = fileURLToPath(new URL("./fixtures/provider.ts", import.meta.url));
const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
const source = fileURLToPath(new URL("../../../docs/NAMING.md", import.meta.url));
const projectID = "11111111-1111-4111-8111-111111111111", outsider = "22222222-2222-4222-8222-222222222222";

function prepare(root: string) {
  const work = join(root, "work"), vault = join(root, "vault"), homeConfig = join(root, ".config", "brain");
  for (const dir of [work, homeConfig, join(root, "agent"), ...[
    "00-limbo", "01-proyectos/fixture/notas", "02-areas", "03-recursos", "04-archivo", "99-sistema/plantillas", "99-sistema/documentacion",
  ].map(path => join(vault, path))]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(homeConfig, "config.toml"), `config_version = 1\nvault_path = ${JSON.stringify(vault)}\n`);
  writeFileSync(join(work, ".brain-notes.toml"), `binding_version = 1\nproject_id = "${projectID}"\nproject_path = "01-proyectos/fixture/Fixture.md"\nallow_write = true\n`);
  writeFileSync(join(vault, "01-proyectos/fixture/Fixture.md"), `---\nbrain_type: project\nbrain_version: 1\nbrain_id: ${projectID}\ntitle: Fixture\n---\n`);
  writeFileSync(join(vault, "00-limbo/Private.md"), `---\nbrain_type: note\nbrain_version: 1\nbrain_id: ${outsider}\ntitle: Private\n---\nNot in this project.\n`);
  return work;
}

async function freshPi(root: string, work: string, mode: "write" | "read" | "update", sourcePath: string, note?: string) {
  const tools = { write: "ss_knowledge_list,ss_knowledge_create", read: "ss_knowledge_read", update: "ss_knowledge_read,ss_knowledge_update" };
  const child = spawn(process.execPath, [cli!, "--offline", "--mode", "rpc", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--extension", provider, "--extension", extension,
    "--tools", tools[mode], "--model", "ss-knowledge-fixture/deterministic", "--thinking", "off"], {
    cwd: work, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SS_KNOWLEDGE_CASE: mode, SS_KNOWLEDGE_SOURCE: sourcePath, SS_KNOWLEDGE_NOTE: note,
      BRAIN_BIN: brain!, HOME: root, USERPROFILE: root, TMPDIR: root, PI_CODING_AGENT_DIR: join(root, "agent"), NO_UPDATE_NOTIFIER: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "", output = 0;
  child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-8192); });
  child.stdout.on("data", data => { if ((output += data.length) > 8 * 1024 * 1024) child.kill("SIGKILL"); });
  const lines = createInterface({ input: child.stdout });
  const closed = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  const results: any[] = [];
  let settled = false;
  try {
    child.stdin.on("error", () => {});
    child.stdin.write(JSON.stringify({ type: "prompt", id: "note-fixture", message: "Exercise the isolated note fixture" }) + "\n");
    for await (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "response" && event.id === "note-fixture") assert.equal(event.success, true, JSON.stringify(event));
      if (event.type === "tool_execution_end" && event.toolName.startsWith("ss_knowledge_")) results.push(JSON.parse(event.result.content[0].text));
      if (event.type === "agent_settled") { settled = true; child.stdin.end(); }
    }
    assert.equal(await closed, 0, stderr);
    assert.equal(settled, true, stderr);
    assert.doesNotMatch(stderr, /Failed to load extension|Extension error|Unhandled/);
    return results;
  } finally { lines.close(); child.stdin.end(); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; clearTimeout(timeout); }
}

test("isolated Pi + Brain: create and recover the naming contract in a fresh read-only session", { skip: !cli || !brain, timeout: 50_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "ss-knowledge-pi-"));
  try {
    const work = prepare(root);
    // Keep the integration test useful after the migration has retired the source.
    let expected: string;
    try { expected = readFileSync(source, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; expected = "# Naming conventions\n\nUse the scoped fixture note.\n"; }
    const input = join(root, "source.md"); writeFileSync(input, expected);
    const [listed, created] = await freshPi(root, work, "write", input);
    assert.deepEqual(listed, { status: "listed", notes: [] });
    assert.equal(created?.status, "created", JSON.stringify(created));
    const [found] = await freshPi(root, work, "read", input, created.note_id);
    assert.deepEqual(found, { status: "found", note_id: created.note_id, title: "Naming conventions", body: expected });
    assert.deepEqual(await freshPi(root, work, "read", input, outsider), [{ status: "not_found" }]);
    const revised = expected + "\nFixture-only update.\n";
    writeFileSync(input, revised);
    const [beforeUpdate, updated] = await freshPi(root, work, "update", input, created.note_id);
    assert.deepEqual(beforeUpdate, found);
    assert.deepEqual(updated, { status: "updated", note_id: created.note_id, title: "Naming conventions" });
    assert.deepEqual(await freshPi(root, work, "read", input, created.note_id), [{ ...found, body: revised }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
