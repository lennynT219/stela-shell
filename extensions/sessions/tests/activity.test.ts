import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decodeQuestion, watchQuestions, type AttentionTransport, type PeerQuestion } from "../attention.ts";
import { matchesTarget } from "../activity.ts";
import { activityView, plain, type ViewState } from "../activity-view.ts";
import { Mailbox } from "../messages.ts";
import { endpointName, PeerTransport } from "../transport.ts";

const route = { core: "a".repeat(32), address: "t4", pid: process.pid };
const q = { id: "3".repeat(32), name: "Docs", token: "b".repeat(32), route };

test("only a local live blocked Pi in the exact terminal/process qualifies for a manual jump", () => {
  const meta = { address: "t4", state: "live", status: { app: "pi", state: "blocked", kind: "permission" }, foreground: { pid: process.pid } };
  assert.equal(matchesTarget(q, meta), true);
  for (const bad of [{ ...meta, address: "other/t4" }, { ...meta, state: "finished" }, { ...meta, foreground: { pid: process.pid + 1 } }, { ...meta, status: { app: "pi", state: "done" } }, { ...meta, status: { app: "other", state: "blocked" } }, { ...meta, status: { app: "pi", state: "blocked", kind: "auth" } }]) assert.equal(matchesTarget(q, bad), false);
  assert.equal(matchesTarget({ ...q, route: null }, meta), false);
  assert.throws(() => decodeQuestion({ token: q.token, route, text: "private prompt" }));
  assert.throws(() => decodeQuestion({ token: q.token, route: { ...route, address: "other/t4" } }));
  assert.doesNotMatch(plain("foo\x1b[31m\r\n漢字\u202e"), /[\p{Cf}\p{Cc}]/u);
});

test("an authenticated live question survives inspection, not replacement, navigation or profile boundaries", { skip: process.platform === "win32", timeout: 12_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "ss-q-")), other = join(root, "different"); mkdirSync(other, { mode: 0o700 });
  const all: Awaited<ReturnType<typeof PeerTransport.open>>[] = [];
  let admissions = 0, view: ReturnType<typeof watchQuestions> | undefined, remote: ReturnType<typeof watchQuestions> | undefined;
  const box = new Mailbox();
  const open = async (dir: string) => {
    const t = await PeerTransport.open(dir, { sessionId: "same", name: "Docs", cwd: root }, (from, msg) => { admissions++; return box.accept(from, msg); });
    all.push(t); assert.ok(t.questionFor); return t as AttentionTransport;
  };
  let wake: (() => void) | undefined, items: PeerQuestion[] = [];
  const until = async (f: () => boolean) => { while (!f()) await new Promise<void>(resolve => { wake = resolve; }); };
  try {
    const a = await open(root), b = await open(root), foreign = await open(other);
    const msg = new Mailbox().prepare(b.info.id, "synthetic question?");
    assert.equal((await a.send(b.info.id, msg)).accepted, true); assert.equal(box.pending, 1);
    assert.equal(await a.questionFor(b.info.id), null, "neither inbox, question-like prose nor ACK is a human dialog");
    const publish = (qs: PeerQuestion[]) => { items = qs; wake?.(); };
    let dialog: object | null = {};
    remote = watchQuestions(b, () => {}, () => route, () => dialog);
    view = watchQuestions(a, publish, () => null, () => null);
    await until(() => items.length === 1);
    const seen = items[0]; assert.equal(seen.id, b.info.id); assert.equal(await view.current(seen), true);
    assert.deepEqual(Object.keys(seen).sort(), ["id", "name", "route", "token"]);
    assert.ok(!Object.hasOwn((await a.list())[0], "route"), "model-facing discovery has no UI metadata");
    const presence = readFileSync(join(root, "stela-sessions", `${seen.id}.json`), "utf8");
    assert.ok(!presence.includes(seen.token) && !presence.includes(route.core));
    await assert.rejects(foreign.questionFor(b.info.id));
    dialog = {}; // Distinct dialog, same name/process, not even another render yet.
    assert.equal(await view.current(seen), false); await until(() => items.length === 1 && items[0].token !== seen.token);
    dialog = null; remote.sync(); await until(() => !items.length); assert.equal(await view.current(seen), false);
    dialog = {}; remote.sync(); await until(() => items.length === 1); assert.notEqual(items[0].token, seen.token);
    remote.close(); await b.close(); await until(() => !items.length); assert.equal(admissions, 1, "no UI operation admitted a message");
  } finally {
    view?.close(); remote?.close(); await Promise.allSettled(all.map(t => t.close()));
    for (const path of new Set(all.map(t => dirname(endpointName(t.profile, t.info.id))))) rmdirSync(path);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a narrow notice keeps its action; a redraw between press and click cannot change the destination", () => {
  const state: ViewState = { open: false, tasks: [], questions: [q] };
  const opened: string[] = [];
  const view = activityView({ terminal: { rows: 24, columns: 38 }, mode: "regular", requestRender() {} } as any,
    { fg: (_role: string, s: string) => s } as any, { truncateToWidth: (s: string, n: number) => s.slice(0, n) } as any,
    state, { toggle: () => assert.fail("a question must never open the panel"), canOpen: p => !!p.route, question: p => opened.push(p.token) });
  const mouse = (type: string) => view.widget.handleMouse!({ button: "left", y: 0, type } as any);
  assert.match(view.widget.render(38)[0], /Docs.*\[Ver pregunta\]/);
  mouse("press"); state.questions = [{ ...q, token: "c".repeat(32) }]; view.widget.render(38); mouse("release"); mouse("click");
  assert.deepEqual(opened, []);
  mouse("press"); mouse("release"); mouse("click"); assert.deepEqual(opened, [state.questions[0].token]);
  state.questions = [{ ...q, route: null }]; assert.match(view.widget.render(38)[0], /Docs.*en origen/);
  mouse("press"); mouse("click"); assert.equal(opened.length, 1); view.dispose();
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
const hc = process.env.SS_TEST_HC;
const run = promisify(execFile);
for (const [file, binary] of [["activity-tui.py", undefined], ["panel-mascot.py", undefined], ["activity-herdr.py", hc]] as const) {
  test(`two isolated Pi terminals: ${file}`, { skip: process.platform !== "linux" || !cli || (file.includes("herdr") && !binary), timeout: 60_000 }, async () => {
    const { stdout } = await run("python3", ["-B", fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), process.execPath, cli!, ...(binary ? [binary] : [])], { timeout: 50_000, maxBuffer: 512 * 1024 });
    assert.match(stdout, /checked in two Pi terminals/);
  });
}
