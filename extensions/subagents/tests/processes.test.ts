import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { processSpec, requireWindowsHelper, spawnManaged, WINDOWS_JOB_HELPER, POSIX_SUPERVISOR } from "../processes.ts";

const treeFixture = fileURLToPath(new URL("./fixtures/process-tree.mjs", import.meta.url));
const ownerFixture = fileURLToPath(new URL("./fixtures/managed-owner.mjs", import.meta.url));
const nativeSkip = process.platform !== "win32" ? "Windows Job Object integration requires Windows" :
  !existsSync(WINDOWS_JOB_HELPER) ? "Build the Windows helper explicitly before native tests" : false;

test("POSIX process plan reuses the owner runtime for the private-channel supervisor", () => {
  const args = ["a b", "ñ🙂", "literal & | $ % !", ""];
  const plan = processSpec("/usr/bin/node", args, "linux");
  assert.equal(plan.command, process.execPath);
  assert.equal(plan.args[0], "--eval");
  assert.ok(plan.args[1].includes(new URL("../posix-supervisor.mjs", import.meta.url).href));
  assert.ok(!plan.args.includes(args[0]), "launch data is sent only after the supervisor handshake");
  assert.equal(plan.detached, true);
  assert.ok(existsSync(POSIX_SUPERVISOR));
});

test("Windows process plan uses the fixed controller and preserves argv without a shell", () => {
  const args = ["C:\\space dir\\script.js", "", 'a"b', "ñ🙂 & | % !", "trailing\\"];
  const plan = processSpec("C:\\Program Files\\nodejs\\node.exe", args, "win32", 1234);
  assert.equal(plan.command, WINDOWS_JOB_HELPER);
  assert.deepEqual(plan.args, ["--parent-pid", "1234", "--", "C:\\Program Files\\nodejs\\node.exe", ...args]);
  assert.equal(plan.detached, false);
  for (const command of ["node.exe", "C:\\tools\\pi.cmd", "C:\\tools\\pi.bat", "pi"]) {
    assert.throws(() => processSpec(command, [], "win32"), /absolute native .exe/);
  }
});

test("absent or non-file Windows helper fails with explicit build guidance", () => {
  const dir = mkdtempSync(join(tmpdir(), "stela-helper-missing-"));
  try {
    for (const path of [join(dir, "absent.exe"), dir]) {
      assert.throws(() => requireWindowsHelper(path), /Build it explicitly.*cargo build.*No child was started/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function closed(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Native fixture exceeded its cleanup deadline"));
    }, 10_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  // The caller first waits for readiness, then awaits this same rejecting promise.
  void done.catch(() => {});
  return done;
}
function firstPids(child: ReturnType<typeof spawn>): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture tree was not ready within 8 seconds")), 8000);
    let text = "";
    child.stdout!.setEncoding("utf8");
    const data = (chunk: string) => {
      text += chunk;
      if (text.includes("\n")) {
        child.stdout!.off("data", data);
        clearTimeout(timer);
        try { resolve(JSON.parse(text.slice(0, text.indexOf("\n")))); } catch (error) { reject(error); }
      }
    };
    child.stdout!.on("data", data);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", () => {
      clearTimeout(timer);
      if (!text.includes("\n")) reject(new Error("Fixture exited before tree was ready"));
    });
  });
}
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // A terminated Linux orphan can remain as a zombie until its adopter reaps it.
    return process.platform !== "linux" || !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ");
  }
  catch (error) { if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) return false; throw error; }
}
async function assertTerminated(pids: number[]) {
  for (let attempt = 0; attempt < 100 && pids.some(isAlive); attempt++) await delay(20);
  assert.deepEqual(pids.filter(isAlive), [], "owned descendant processes must not survive cleanup");
}
function emergencyCleanup(pids: number[]) {
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already terminated */ }
  }
}

test("POSIX supervisor preserves argv, stdin and environment without sharing the lifetime channel", { skip: process.platform === "win32", timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "stela posix ñ space-"));
  const script = join(dir, "argv ñ fixture.mjs");
  const args = ["", "space value", 'embedded"quote', "trailing\\", "ñ🙂 & | % !"];
  writeFileSync(script, `import { readFileSync } from "node:fs"; console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), marker: process.env.STELA_TEST_MARKER, bunBeBun: process.env.BUN_BE_BUN ?? null, input: readFileSync(0, "utf8") }));`);
  const env = { ...process.env, STELA_TEST_MARKER: "inherited ñ", BUN_BE_BUN: "original-value" };
  const managed = spawnManaged(process.execPath, [script, ...args], { cwd: dir, env });
  const done = closed(managed.child);
  let stdout = ""; let stderr = "";
  managed.child.stdout.on("data", (chunk) => { stdout += chunk; });
  managed.child.stderr.on("data", (chunk) => { stderr += chunk; });
  managed.child.stdin.end("bounded assignment ñ🙂");
  try {
    assert.equal((await done).code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { args, cwd: dir, marker: "inherited ñ", bunBeBun: "original-value", input: "bounded assignment ñ🙂" });
  } finally { managed.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});

for (const action of ["leader-exit", "terminate", "force-terminate", "supervisor-exit"] as const) {
  test(`POSIX supervisor removes descendants retaining stdio on ${action}`, { skip: process.platform === "win32", timeout: 15_000 }, async () => {
    const managed = spawnManaged(process.execPath, [treeFixture, action === "leader-exit" ? "exit" : "hang"], { cwd: process.cwd(), env: process.env });
    const done = closed(managed.child);
    const pidsPromise = firstPids(managed.child);
    let pids: number[] = [];
    managed.child.stderr.resume(); managed.child.stdin.end();
    try {
      pids = await pidsPromise;
      assert.equal(pids.length, 3);
      if (action === "terminate") managed.terminate();
      if (action === "force-terminate") managed.forceTerminate();
      if (action === "supervisor-exit") managed.child.kill("SIGKILL");
      const result = await done;
      if (action === "leader-exit") assert.equal(result.code, 0);
      await assertTerminated([...pids, managed.child.pid!]);
    } finally { managed.cleanup(); emergencyCleanup(pids); }
  });
}

test("POSIX supervisor survives abrupt owner death and removes the full tree", { skip: process.platform === "win32", timeout: 15_000 }, async () => {
  const owner = spawn(process.execPath, [ownerFixture, "with-supervisor"], { stdio: ["pipe", "pipe", "pipe"] });
  const done = closed(owner);
  let pids: number[] = [];
  owner.stderr.resume(); owner.stdin.end();
  try {
    pids = await firstPids(owner);
    assert.equal(pids.length, 4, "the supervisor and all three target processes must be tracked");
    owner.kill("SIGKILL");
    await done;
    await assertTerminated(pids);
  } finally { owner.kill("SIGKILL"); emergencyCleanup(pids); }
});

test("POSIX owner death before supervisor readiness never starts the target", { skip: process.platform === "win32", timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "stela-posix-startup-"));
  const marker = join(dir, "must-not-exist");
  const owner = spawn(process.execPath, [ownerFixture, "startup-exit", marker], { stdio: ["pipe", "pipe", "pipe"] });
  const done = closed(owner);
  let pids: number[] = [];
  owner.stderr.resume(); owner.stdin.end();
  try {
    pids = await firstPids(owner);
    assert.equal(pids.length, 1, "the fixture reports only the not-yet-ready supervisor");
    await done;
    await assertTerminated(pids);
    assert.equal(existsSync(marker), false);
  } finally { owner.kill("SIGKILL"); emergencyCleanup(pids); rmSync(dir, { recursive: true, force: true }); }
});

test("POSIX cancellation before readiness never starts the target", { skip: process.platform === "win32", timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "stela-posix-cancel-"));
  const marker = join(dir, "must-not-exist");
  const managed = spawnManaged(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], 'unexpected')", marker], { cwd: dir, env: process.env });
  const done = closed(managed.child);
  managed.child.stdout.resume(); managed.child.stderr.resume(); managed.child.stdin.end();
  managed.forceTerminate();
  try {
    await done;
    assert.equal(existsSync(marker), false);
    await assertTerminated([managed.child.pid!]);
  } finally { managed.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});

test("Windows native controller preserves spaces, Unicode, quotes and shell metacharacters", { skip: nativeSkip, timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "stela native ñ space-"));
  const script = join(dir, "argv ñ fixture.mjs");
  const args = ["", "space value", 'embedded"quote', "trailing\\", 'slashes\\\\"quote', "ñ🙂", "& | %PATH% ! $(literal)"];
  writeFileSync(script, "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), marker: process.env.STELA_TEST_MARKER }));");
  const managed = spawnManaged(process.execPath, [script, ...args], { cwd: dir, env: { ...process.env, STELA_TEST_MARKER: "inherited ñ" } });
  const done = closed(managed.child);
  let stdout = ""; let stderr = "";
  managed.child.stdout.on("data", (chunk) => { stdout += chunk; });
  managed.child.stderr.on("data", (chunk) => { stderr += chunk; });
  managed.child.stdin.end();
  try {
    assert.equal((await done).code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), { args, cwd: dir, marker: "inherited ñ" });
  } finally { managed.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});

for (const action of ["leader-exit", "terminate", "force-terminate"] as const) {
  test(`Windows native Job removes the entire tree on ${action}`, { skip: nativeSkip, timeout: 15_000 }, async () => {
    const managed = spawnManaged(process.execPath, [treeFixture, action === "leader-exit" ? "exit" : "hang"], { cwd: process.cwd(), env: process.env });
    const done = closed(managed.child);
    const pidsPromise = firstPids(managed.child);
    let pids: number[] = []; let stderr = "";
    managed.child.stderr.on("data", (chunk) => { stderr += chunk; });
    managed.child.stdin.end();
    try {
      pids = await pidsPromise;
      assert.equal(pids.length, 3);
      if (action === "terminate") managed.terminate();
      if (action === "force-terminate") managed.forceTerminate();
      const result = await done;
      if (action === "leader-exit") assert.equal(result.code, 0, stderr);
      await assertTerminated(pids);
    } finally { managed.cleanup(); emergencyCleanup(pids); }
  });
}

test("Windows controller detects abrupt parent death and removes descendants", { skip: nativeSkip, timeout: 15_000 }, async () => {
  const owner = spawn(process.execPath, [ownerFixture], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const done = closed(owner);
  let pids: number[] = [];
  owner.stdin.end();
  try {
    pids = await firstPids(owner);
    assert.equal(pids.length, 3);
    owner.kill("SIGKILL");
    await done;
    await assertTerminated(pids);
  } finally { owner.kill("SIGKILL"); emergencyCleanup(pids); }
});

test("Windows startup fails closed when the parent cannot be opened", { skip: nativeSkip, timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "stela-fail-closed-"));
  const marker = join(dir, "must-not-exist");
  const child = spawn(WINDOWS_JOB_HELPER, ["--parent-pid", "4294967295", "--", process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1], 'unexpected')", marker], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const done = closed(child);
  let stderr = "";
  child.stderr!.on("data", (chunk) => { stderr += chunk; });
  child.stdin!.end();
  try {
    assert.equal((await done).code, 125);
    assert.match(stderr, /open parent process/);
    assert.equal(existsSync(marker), false);
  } finally { child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
});
