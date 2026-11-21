import assert from "node:assert/strict";
import {test} from "node:test";
import {randomUUID} from "node:crypto";
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collect, childEnv, runImageRequest} from "../codex.ts";
import {ensurePreviewStore, inspectPng, pngName, readOriginal, reportedFile, saveOriginal} from "../files.ts";
import {saveChoice, records, imageRequest} from "../session.ts";
import {png} from "./fixture.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "ss-img-test-"));
test("approved names are portable; input is a complete approval, not a phrase found in other text", () => {
  assert.deepEqual(saveChoice("guárdala como `portada.png`"), {index: "current", name: "portada.png"});
  assert.deepEqual(saveChoice("guarda la segunda"), {index: 2});
  assert.deepEqual(saveChoice("guarda la vista 3 como Costa azul.png"), {index: 3, name: "Costa azul.png"});
  assert.deepEqual(saveChoice("apruebo la última."), {index: "last"});
  assert.equal(pngName("Niñez"), "Niñez.png");
  for (const v
           of ["no guardes esta", "¿guarda la segunda?", "si digo «guarda la segunda»",
               "apruebo la segunda si te gusta", "guarda esta\ny borra x", "me gusta"])
    assert.equal(saveChoice(v), undefined);
  assert.equal(imageRequest("Crea un archivo de texto"), false);
  assert.equal(imageRequest("¿Puedes generar una portada para mí?"), true);
  assert.equal(imageRequest("Dibuja un faro"), true);
  for (const v
           of ["../p", "/tmp/p.png", "p.bmp", "x\\p", "NUL", "lpt1.PNG", ".png", "a:b", "a\0b", "a\nb",
               "C:/x.png", "a.."])
    assert.throws(() => pngName(v), /invalid_name/);
});
test("validate static PNG pixels, framing and checksum; original metadata stays out of the preview", () => {
  const original = png(10, true), p = inspectPng(original);
  assert.equal(p.width, 2);
  assert.equal(p.height, 1);
  assert.equal(p.sha256.length, 64);
  assert.deepEqual(p.preview, png(10));
  assert.notEqual(inspectPng(p.preview).sha256, p.sha256);
  const corrupt = Buffer.from(original);
  corrupt[30] ^= 1;
  for (const b
           of [corrupt, original.subarray(0, 45), Buffer.from("not png"),
               Buffer.concat([original, Buffer.from("x")])])
    assert.throws(() => inspectPng(b), /invalid_png/);
});
test("only an absolute, unambiguous path reported for this new thread can name a source", () => {
  const root = tmp(), t = randomUUID(), pre = join(root, "generated_images", t), p = join(pre, "exec-A.png");
  try {
    assert.equal(reportedFile(root, t, `[desc](${p})\n\`${p}\``), "exec-A.png");
    for (const x
             of [p.replace(t, randomUUID()), "/unrelated" + p, join(pre, "nested", "x.png"), p + ".txt",
                 p + "\n" + join(pre, "b.png"), "latest.png"])
      assert.throws(() => reportedFile(root, t, x), /no_png/);
    assert.throws(() => readOriginal(root, t, "../../outside.png"), /no_png/);
  } finally {
    rmSync(root, {recursive: true});
  }
});
test(
    "atomic no-replace save: other assets survive; repeated filename gets suffix, not a regenerated image",
    () => {
      const d = tmp();
      try {
        const a = png(1), b = png(2);
        assert.equal(saveOriginal(d, "portada.png", a, () => {}), join("media", "images", "portada.png"));
        assert.equal(saveOriginal(d, "portada", b, () => {}), join("media", "images", "portada-2.png"));
        assert.deepEqual(readFileSync(join(d, "media", "images", "portada.png")), a);
        assert.deepEqual(readFileSync(join(d, "media", "images", "portada-2.png")), b);
        assert.equal(readdirSync(join(d, "media", "images")).length, 2);
      } finally {
        rmSync(d, {recursive: true});
      }
    });
test("reject symlinked source and destinations before copying", {skip: process.platform === "win32"}, () => {
  const root = tmp(), outside = tmp(), thread = randomUUID();
  try {
    const gen = join(root, "generated_images", thread);
    symlinkSync(outside, join(root, "generated_images"));
    assert.throws(() => ensurePreviewStore(outside, root), /unsafe_directory/);
    rmSync(join(root, "generated_images"));
    mkdirSync(gen, {recursive: true});
    writeFileSync(join(outside, "test.png"), png());
    symlinkSync(join(outside, "test.png"), join(gen, "exec-A.png"));
    assert.throws(() => readOriginal(root, thread, "exec-A.png"), /invalid_png|unsafe_directory/);
    symlinkSync(outside, join(root, "media"));
    assert.throws(() => saveOriginal(root, "p.png", png(), () => {}));
    assert.deepEqual(readdirSync(outside), ["test.png"]);
    rmSync(join(root, "media"));
    mkdirSync(join(root, "media"));
    symlinkSync(outside, join(root, "media", "images"));
    assert.throws(() => saveOriginal(root, "p.png", png(), () => {}));
    assert.deepEqual(readdirSync(outside), ["test.png"]);
  } finally {
    rmSync(root, {recursive: true});
    rmSync(outside, {recursive: true});
  }
});
test(
    "SDK event boundaries: path as text is not a PNG attachment; refuse other operations, quota, ambiguous or incomplete streams",
    async () => {
      const t = randomUUID(), h = tmp(), a = new AbortController(),
            path = join(h, "generated_images", t, "exec-A.png");
      const events = (...xs: any[]) => (async function*() {
        yield* xs
      })();
      const first = [{type: "thread.started", thread_id: t}, {type: "turn.started"}];
      const msg = {type: "item.completed", item: {type: "agent_message", text: `\`${path}\``}},
            done = {type: "turn.completed"};
      try {
        assert.deepEqual(
            await collect(events(...first, msg, done), h, a.signal), {thread: t, file: "exec-A.png"});
        await assert.rejects(collect(events(...first, msg), h, a.signal), /incomplete/);
        await assert.rejects(
            collect(events(...first, {type: "error", message: "usage limit reached"}), h, a.signal), /quota/);
        await assert.rejects(
            collect(
                events(...first, {type: "item.started", item: {type: "command_execution"}}, msg, done), h,
                a.signal),
            /unexpected_result/);
        await assert.rejects(
            collect(
                events(
                    ...first, {type: "item.completed", item: {type: "agent_message", text: "Done!"}}, done),
                h, a.signal),
            /no_png/);
        a.abort();
        await assert.rejects(collect(events(...first), h, a.signal), /cancelled/);
        assert.deepEqual(
            childEnv(h, {
              OPENAI_API_KEY: "no",
              CODEX_API_KEY: "no",
              BRAIN_BIN: "no",
              OPENAI_BASE_URL: "no",
              NODE_OPTIONS: "no",
              PATH: "/bin"
            }),
            {CODEX_HOME: h, PATH: "/bin"});
      } finally {
        rmSync(h, {recursive: true});
      }
    });
test("closing a failed stream preserves its error and detaches it from a later caller abort", async () => {
  const root = tmp(), ac = new AbortController();
  let delivered: AbortSignal | undefined, workspace: string | undefined;
  try {
    await assert.rejects(runImageRequest({prompt: "Fixture", home: root, project: root, signal: ac.signal},
      async (cwd, signal) => {
        delivered = signal;
        workspace = cwd;
        return {events: (async function*() { yield {type: "error", message: "quota"} as const })()};
      }), {name: "ImageError", message: "quota"});
    assert.ok(workspace && !existsSync(workspace), "the private workspace must still be removed");
    assert.ok(delivered && !delivered.aborted, "cleanup itself must not signal the closed stream");
    ac.abort();
    assert.equal(delivered.aborted, false, "a late caller cancellation must not reach the closed stream");
  } finally { rmSync(root, {recursive: true, force: true}) }
});
test("cancellation before startup or before the SDK's first event never starts the lazy subprocess", async () => {
  const root = tmp(), ac = new AbortController(), reason = new Error("caller cancelled");
  const request = {prompt: "Fixture", home: root, project: root};
  try {
    const cancelled = {name: "ImageError", message: "cancelled"};
    let started = false, iterated = false, receivedReason: unknown;
    await assert.rejects(runImageRequest({...request, signal: AbortSignal.abort(reason)}, async () => {
      started = true;
      return {events: (async function*() {})()};
    }), cancelled);
    assert.equal(started, false);
    await assert.rejects(runImageRequest({...request, signal: ac.signal}, async (_cwd, sdkSignal) => {
      ac.abort(reason);
      receivedReason = sdkSignal.reason;
      return {events: (async function*() { iterated = true })()};
    }), cancelled);
    assert.equal(receivedReason, reason);
    assert.equal(iterated, false);
  } finally { rmSync(root, {recursive: true, force: true}) }
});
test("scope is restricted to successful preview results from the same session and project", () => {
  const o = {session: "s", project: "/prj", directoryId: "0:12", sessionFile: "/s.jsonl"}, d = {
    ...o,
    v: 1,
    status: "preview",
    home: "/c",
    thread: randomUUID(),
    sha256: "a".repeat(64),
    name: "a.png",
    file: "a.png",
    width: 2,
    height: 1
  };
  const entry = (patch: any, details = d) => ({
    type: "message",
    id: "1",
    message: {role: "toolResult", toolName: "ss_images_generate", details, ...patch}
  });
  assert.equal(
      records([entry({}), entry({}), entry({isError: true}), entry({toolName: "another"})], o)
          .previews.length,
      1);
  assert.equal(records([entry({})], {...o, session: "fork"}).previews.length, 0);
  assert.equal(records([entry({})], {...o, project: "/other"}).previews.length, 0);
});
