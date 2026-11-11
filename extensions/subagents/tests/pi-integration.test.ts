import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLaunch } from "../runner.ts";

const cli = process.env.STELA_TEST_PI_CLI;
const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
const provider = fileURLToPath(new URL("./fixtures/provider.ts", import.meta.url));
const exec = promisify(execFile);

for (const action of ["read", "write", "permission-denied"]) {
  test(`native Pi integration: ${action}`, { skip: !cli, timeout: 30_000 }, async () => {
    const scratch = mkdtempSync(join(tmpdir(), "stela-pi-integration-"));
    const home = join(scratch, "home");
    const profile = join(home, "agent");
    const cwd = join(scratch, "workspace");
    mkdirSync(profile, { recursive: true }); mkdirSync(cwd);
    writeFileSync(join(cwd, "source.txt"), "OBSERVED_FIXTURE_EVIDENCE\n");
    try {
      const execution = exec(process.execPath, [cli!,
        "--offline", "--mode", "json", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
        "--extension", provider, "--extension", extension,
        "--model", "stela-fixture/deterministic", "--thinking", "off", "Resolve the fixture assignment",
      ], {
        cwd, timeout: 25_000, maxBuffer: 2 * 1024 * 1024,
        env: {
          PATH: process.env.PATH, HOME: home, TMPDIR: scratch,
          ...(process.platform === "win32" ? {
            SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
            USERPROFILE: home, TEMP: scratch, TMP: scratch,
            APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
          } : {}),
          PI_CODING_AGENT_DIR: profile, PI_OFFLINE: "1", NO_UPDATE_NOTIFIER: "1", STELA_FIXTURE_ACTION: action,
        },
      });
      // Pi reads piped stdin before startup; close the test client's unused input.
      execution.child.stdin?.end();
      const { stdout, stderr } = await execution;
      assert.doesNotMatch(stderr, /Failed to load extension|Extension error/);
      const events = stdout.trim().split("\n").map((line) => JSON.parse(line));
      const receipt = events.find((event) => event.type === "tool_execution_end" && event.toolName === "stela_delegate");
      assert.ok(receipt, stdout + stderr);
      assert.equal(receipt.isError, false, JSON.stringify(receipt));
      const results = events.filter((event) => event.type === "entry_appended" && event.entry?.customType === "stela-subagent-result");
      // Observe the native boundary commit and its subsequent model-facing projection.
      const integrated = events.filter((event) => event.type === "message_end" && event.message?.role === "assistant").flatMap((event) => event.message.content).filter((part) => part.type === "text" && part.text.startsWith("INTEGRATED"));
      assert.equal(integrated.length, 1, stdout + stderr);
      assert.equal(results.length, 1, "a task result must be committed exactly once");
      assert.equal(results[0].entry.details.result, undefined, "raw diagnostics must not enter persisted result details");
      if (action === "read") {
        assert.match(integrated[0].text, /completed/, stdout + stderr);
        assert.match(integrated[0].text, /OBSERVED_FIXTURE_EVIDENCE/);
      } else {
        assert.match(integrated[0].text, /failed/);
        assert.doesNotMatch(integrated[0].text, /OBSERVED_FIXTURE_EVIDENCE/);
      }
      assert.equal(existsSync(join(cwd, "forbidden.txt")), false);
      assert.deepEqual(readdirSync(cwd), ["source.txt"]);
      assert.equal(readFileSync(join(cwd, "source.txt"), "utf8"), "OBSERVED_FIXTURE_EVIDENCE\n");
      assert.ok(events.some((event) => event.type === "agent_settled"));
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
}

test("native launch resolution preserves explicit policy resources and refuses unknown policy flags", { skip: !cli }, () => {
  const launch = resolveLaunch([process.execPath, cli!, "--extension", provider, "--no-extensions", "--system-prompt", "policy text", "--model", "fixture/model", "--stela-subagent-concurrency", "5"], process.execPath);
  assert.deepEqual(launch.resourceArgs, ["--extension", provider, "--no-extensions", "--system-prompt", "policy text"]);
  assert.throws(() => resolveLaunch([process.execPath, cli!, "--unknown-policy", "strict"], process.execPath), /Cannot safely inherit/);
  assert.throws(() => resolveLaunch([process.execPath, cli!, "--extension", "npm:unknown"], process.execPath), /remote package flags/);
});
