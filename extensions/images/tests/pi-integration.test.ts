import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createInterface} from "node:readline";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {png} from "./fixture.ts";
const cli = process.env.SS_TEST_PI_CLI;
const extensionFiles = {renderer: "./fixtures/extension.ts", production: "../index.ts", stream: "./fixtures/stream-extension.ts"};
type Prompt = string | {message: string; images?: {type: "image"; mimeType: string; data: string}[]; expectHandled?: true};
async function run(root: string, prompts: Prompt[], session?: string, extension: keyof typeof extensionFiles = "renderer",
                   observe?: (turn: number, event: any, abort: () => void, confirm: (id: string, allow: boolean) => void) => void) {
  const cwd = join(root, "project"), profile = join(root, "pi"), sessions = join(root, "sessions"),
        home = join(root, "codex");
  for (const d of [cwd, profile, sessions, home]) mkdirSync(d, {recursive: true});
  const ext = (s: string) => fileURLToPath(new URL(s, import.meta.url));
  const ch = spawn(
      process.execPath,
      [
        cli!,
        "--offline",
        "--mode",
        "rpc",
        "--session-dir",
        sessions,
        ...(session ? ["--session", session] : []),
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-approve",
        "--extension",
        ext("./fixtures/provider.ts"),
        "--extension",
        ext(extensionFiles[extension]),
        "--tools",
        "ss_images_generate,ss_images_edit,ss_images_save",
        "--model",
        "ss-images-fixture/fixture",
        "--thinking",
        "off"
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          HOME: root,
          USERPROFILE: root,
          TMPDIR: root,
          CODEX_HOME: home,
          PI_CODING_AGENT_DIR: profile,
          NO_UPDATE_NOTIFIER: "1"
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
  const done = new Promise<number|null>((resolve, reject) => {
    ch.once("error", reject);
    ch.once("close", resolve)
  }),
        timer = setTimeout(() => ch.kill("SIGKILL"), 25000);
  let err = "", index = 0;
  ch.stderr.on("data", x => {err = (err + x).slice(-4096)});
  ch.stdin.on("error", () => {});
  const results: any[] = [];
  const send = () => {
    const p = prompts[index];
    const input = typeof p === "string" ? {message: p} : {message: p.message, images: p.images};
    ch.stdin.write(JSON.stringify({type: "prompt", id: "p" + index, ...input}) + "\n");
  };
  const advance = () => { if (++index === prompts.length) ch.stdin.end(); else send() };
  const confirm = (id: string, allow: boolean) => { ch.stdin.write(JSON.stringify({type: "extension_ui_response", id, confirmed: allow}) + "\n") };
  const abort = () => { ch.stdin.write('{"type":"abort","id":"abort-fixture"}\n') };
  const rl = createInterface({input: ch.stdout});
  send();
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      observe?.(index, e, abort, confirm);
      if (e.type === "response" && e.command === "prompt") {
        assert.ok(e.success, JSON.stringify(e));
        const p = prompts[index], handled = typeof p !== "string" && p.expectHandled;
        assert.equal(e.data.disposition, handled ? "handled" : "started");
        if (handled) advance(); // A consumed private input never starts an agent loop.
      }
      if (e.type === "tool_execution_end") results.push(e.result);
      if (e.type === "agent_settled") advance();
    }
    assert.equal(await done, 0, err);
    assert.equal(index, prompts.length, err);
    assert.doesNotMatch(err, /Failed to load extension|Extension error|Unhandled/);
    return results;
  } finally {
    rl.close();
    ch.stdin.end();
    if (ch.exitCode === null && ch.signalCode === null) ch.kill("SIGKILL");
    await done;
    clearTimeout(timer);
  }
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("Pi survives a Codex SDK turn failure, can abort a live SDK child and accepts the next prompt",
    {skip: !cli, timeout: 35_000}, async () => {
      const root = mkdtempSync(join(tmpdir(), "ss-images-stop-")), project = join(root, "project"), home = join(root, "codex");
      try {
        mkdirSync(project);
        // Codex's first argv is "exec", so using process.execPath as its binary runs just this local JS file.
        writeFileSync(join(project, "exec"), `
          const fs = require("node:fs"), path = require("node:path");
          const marker = name => path.join(process.env.FIXTURE_HOME, name);
          const send = e => console.log(JSON.stringify(e));
          process.stdin.resume().once("end", () => {
            const mode = process.env.FIXTURE_MODE;
            fs.appendFileSync(marker("starts"), mode + "\\n");
            if (mode === "hold") fs.writeFileSync(marker("held-pid"), String(process.pid));
            // Bound the fixture even if cancellation stops working. Never complete a turn or create a PNG.
            setTimeout(() => { fs.writeFileSync(marker("expired-" + mode), "expired"); process.exit(2); }, 5000);
            send({type:"thread.started",thread_id:"12345678-0000-4000-8000-000000000001"});
            send({type:"turn.started"});
            if (mode === "fail") send({type:"turn.failed",error:{message:"synthetic quota limit"}});
          });
        `);
        let requestsToAbort = 0, abortAccepted = false;
        const results = await run(root, [
          "Genera la imagen con este prompt: Fixture with a failed turn.",
          "Genera la imagen con este prompt: Fixture holding a turn open.",
          "guarda la primera"
        ], undefined, "stream", (turn, event, abort) => {
          if (event.type === "response" && event.id === "abort-fixture") abortAccepted = event.success;
          if (turn === 1 && event.type === "extension_ui_request" && event.method === "notify" &&
              event.message === "fixture: SDK stream waiting") {
            requestsToAbort++;
            abort();
          }
        });
        assert.equal(results[0]?.details?.code, "quota");
        assert.equal(requestsToAbort, 1);
        assert.equal(abortAccepted, true);
        assert.equal(results.at(-1)?.details?.code, "no_preview"); // Same Pi process served another turn.
        assert.equal(readFileSync(join(home, "starts"), "utf8"), "fail\nhold\n");
        assert.ok(!existsSync(join(home, "expired-hold")) && !existsSync(join(home, "expired-fail")));
        const pid = Number(readFileSync(join(home, "held-pid"), "utf8"));
        assert.ok(Number.isSafeInteger(pid) && pid > 0);
        assert.throws(() => process.kill(pid, 0), {code: "ESRCH"}); // Existence check, does not send a signal.
        assert.ok(!readdirSync(root).some(n => n.startsWith("ss-image-")));
        assert.ok(!existsSync(join(project, "media")));
      } finally { rmSync(root, {recursive: true, force: true}) }
    });
test("Pi RPC: private attachments, real per-edit UI consent, edited preview and approved save after reopen",
    {skip: !cli, timeout: 60_000}, async () => {
      const root = mkdtempSync(join(tmpdir(), "ss-photo-rpc-")), project = join(root, "project"),
        home = join(root, "codex"), file = join(root, "pi-clipboard-12345678-0000-4000-8000-000000000001.png");
      try {
        const instructions = ["Mejora la luz del faro seleccionado.", "Cambia únicamente el color del tejado.", "Conserva el dibujo del pelaje."],
          sources = [png(21, true), png(47, true), png(21, true)], previews = [png(21), png(47), png(21)];
        writeFileSync(file, sources[0]);
        const dialogs: number[] = [], reviews: number[] = [], edited: number[] = [], userPrompts: string[] = [];
        const prompts = instructions.map((s, i): Prompt => ({
          message: `Editar foto:\n${s}`, images: [{type: "image", mimeType: "image/png", data: sources[i].toString("base64")}]
        }));
        const [denied, firstEdit, secondEdit] = await run(root, prompts, undefined, "renderer", (turn, e, _abort, confirm) => {
          if (e.type === "message_end" && e.message.role === "user") {
            const c = e.message.content;
            assert.equal(c.length, 1);
            assert.equal(c[0].type, "text");
            userPrompts.push(c[0].text);
          }
          if (e.type === "tool_execution_update" && e.partialResult?.details?.status === "review") {
            reviews.push(turn);
            assert.deepEqual(Buffer.from(e.partialResult.content[1].data, "base64"), previews[turn]);
            assert.equal(e.partialResult.details.sha256, hash(previews[turn]));
          }
          if (e.type === "extension_ui_request" && e.method === "confirm") {
            dialogs.push(turn);
            assert.deepEqual(reviews, dialogs, "the preview precedes its matching confirmation");
            assert.match(e.title, /OpenAI/);
            assert.ok(e.message.includes(hash(previews[turn])));
            assert.ok(e.message.includes(instructions[turn]) && e.message.includes("PNG adjunto"));
            const outputs = join(home, "generated_images");
            assert.equal(existsSync(outputs) ? readdirSync(outputs).length : 0, Math.max(0, turn - 1));
            confirm(e.id, turn !== 0);
          }
          if (e.type === "tool_execution_update" && e.partialResult?.details?.status === "editing") edited.push(turn);
        });
        assert.deepEqual(dialogs, [0, 1, 2]);
        assert.deepEqual(edited, [1, 2]);
        assert.equal(denied?.details.code, "edit_declined");
        assert.deepEqual([firstEdit, secondEdit].map(x => x?.details.status), ["preview", "preview"]);
        assert.equal(new Set(userPrompts).size, 3, "each dispatch is bound to a distinct live marker");
        assert.ok(userPrompts.every(p => p.startsWith("Solicitud local de edición de foto (")));
        const expected = (i: number) => png((Buffer.byteLength(instructions[i]) + previews[i].toString("base64").length) % 230, true);
        assert.equal(firstEdit.details.sha256, hash(expected(1)));
        assert.equal(secondEdit.details.sha256, hash(expected(2)));
        assert.deepEqual(readFileSync(file), sources[0]);
        assert.ok(!existsSync(join(project, "media")));
        const session = join(root, "sessions", readdirSync(join(root, "sessions")).find(n => n.endsWith(".jsonl"))!);
        const log = readFileSync(session, "utf8");
        for (const secret of [file, ...instructions, ...sources.map(b => b.toString("base64")), ...previews.map(b => b.toString("base64"))])
          assert.ok(!log.includes(secret), "only the output preview belongs in the Pi conversation");
        const media = join(project, "media", "images");
        mkdirSync(media, {recursive: true});
        writeFileSync(join(media, "foto.png"), sources[0]);
        let pathRejections = 0;
        const [saved] = await run(root, [{message: `Editar foto:\n${file}\nCambia solo la luz.`, expectHandled: true},
          "guarda la segunda como foto.png"], session, "renderer", (turn, event) => {
          if (turn !== 0) return;
          assert.ok(!["agent_start", "tool_execution_start", "tool_execution_update"].includes(event.type));
          if (event.type === "extension_ui_request") {
            assert.notEqual(event.method, "confirm");
            if (event.method === "notify" && event.message.includes("En RPC adjunta")) pathRejections++;
          }
        });
        assert.equal(pathRejections, 1, "a path sent by RPC cannot read a host file or expose it in the UI");
        assert.ok(!readFileSync(session, "utf8").includes(file));
        assert.equal(saved?.details.relative, join("media", "images", "foto-2.png"));
        assert.deepEqual(readFileSync(join(media, "foto-2.png")), expected(2));
        assert.deepEqual(readFileSync(join(media, "foto.png")), sources[0]);
      } finally { rmSync(root, {recursive: true, force: true}) }
    });

test("real Pi RPC with a scripted chat: ask, draft, user edits and submits; only that last turn produces a preview",
    {skip: !cli, timeout: 35_000}, async () => {
      const root = mkdtempSync(join(tmpdir(), "ss-images-design-"));
      try {
        const text: string[] = [], calls: number[] = [];
        const edited = "Portada vertical: faro a la luz de la luna, mar en calma. Tinta azul. Sin letras.";
        const results = await run(root, ["Quiero una portada para mi cuento.", "Un faro, con calma nocturna. Sin letras.",
                   "Genera la imagen con este prompt:\n" + edited], undefined, "renderer", (turn, e) => {
          if (e.type === "message_end" && e.message.role === "assistant" && e.message.stopReason === "stop")
            text[turn] = e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
          if (e.type === "tool_execution_start") calls.push(turn);
          assert.ok(!(e.type === "extension_ui_request" && e.method === "set_editor_text"));
        });
        assert.match(text[0], /¿Qué debería verse/);
        assert.match(text[1], /Genera la imagen con este prompt:\nPortada vertical:[^\n]+Sin letras\./);
        assert.deepEqual(calls, [2]);
        assert.equal(results[0]?.details.status, "preview");
        assert.equal(results[0].details.sha256, hash(png(Buffer.byteLength(edited) % 230, true)));
        assert.ok(!existsSync(join(root, "project", "media")));
      } finally { rmSync(root, {recursive: true, force: true}) }
    });
test(
    "real Pi RPC: preview, exit, reopen same conversation, approve exact second PNG; no writes on mere praise or missing/changed source",
    {skip: !cli, timeout: 90_000}, async () => {
      const r = mkdtempSync(join(tmpdir(), "ss-images-pi-"));
      try {
        const [a, b, ignored] = await run(r, [
          "Genera la imagen con este prompt: Postal de un faro rojo", "Genera la imagen con este prompt: Una isla en la nieve",
          "Me gusta la primera"
        ]);
        assert.equal(a?.details.status, "preview", JSON.stringify(a));
        assert.equal(b?.details.status, "preview");
        assert.equal(ignored?.details.code, "save_order");
        for (const p of [a, b]) {
          assert.ok(p.content.find((s: any) => s.type === "image" && s.data && s.mimeType === "image/png"));
          assert.ok(p.content.some((s: any) => s.type === "text" && s.text.includes("PNG:")));
        }
        const media = join(r, "project", "media", "images");
        assert.ok(!existsSync(join(r, "project", "media")));
        const files = readdirSync(join(r, "sessions")).filter(s => s.endsWith(".jsonl"));
        assert.equal(files.length, 1);
        const f = join(r, "sessions", files[0]);
        const readOriginal = (d: any) => join(r, "codex", "generated_images", d.thread, d.file);
        const original = readFileSync(readOriginal(b.details));
        assert.equal(hash(original), b.details.sha256);
        assert.notEqual(a.details.sha256, b.details.sha256);
        mkdirSync(media, {recursive: true});
        writeFileSync(join(media, "portada.png"), "pre-existing");
        const [ambiguous, saved, again] =
            await run(r, ["guarda esta", "guarda la segunda como portada.png", "guarda la segunda"], f);
        assert.equal(ambiguous?.details.code, "ambiguous");
        assert.equal(saved?.details.status, "saved", JSON.stringify(saved));
        assert.equal(saved.details.relative, join("media", "images", "portada-2.png"));
        assert.deepEqual(readFileSync(join(media, "portada-2.png")), original);
        assert.equal(readFileSync(join(media, "portada.png"), "utf8"), "pre-existing");
        assert.equal(again?.details.status, "already_saved");
        writeFileSync(readOriginal(a.details), png(199));
        const [changed] = await run(r, ["guarda la primera"], f);
        assert.equal(changed?.details.code, "source_changed");
        rmSync(readOriginal(a.details));
        const [gone] = await run(r, ["guarda la primera"], f);
        assert.equal(gone?.details.code, "source_unavailable");
        assert.equal(readdirSync(media).length, 2);
      } finally {
        rmSync(r, {recursive: true, force: true});
      }
    });
test(
    "production extension + bundled Codex in a fresh, unauthenticated home: actionable failure, no automatic login or project writes",
    {skip: !cli, timeout: 35_000}, async () => {
      const r = mkdtempSync(join(tmpdir(), "ss-images-login-"));
      try {
        const [idea, a] = await run(r, ["Genera una postal", "Genera la imagen con este prompt: Postal de una montaña al amanecer."], undefined, "production");
        assert.equal(idea?.details.code, "draft_needed");
        assert.equal(a?.details.code, "login_required", JSON.stringify(a));
        assert.ok(!existsSync(join(r, "project", "media")));
      } finally {
        rmSync(r, {recursive: true, force: true});
      }
    });
