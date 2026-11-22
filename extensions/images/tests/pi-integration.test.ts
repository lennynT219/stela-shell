import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
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
const ext = (s: string) => fileURLToPath(new URL(s, import.meta.url));
function piFixture(root: string, session: string|undefined, extension: keyof typeof extensionFiles) {
  const cwd = join(root, "project"), profile = join(root, "pi"), sessions = join(root, "sessions"), home = join(root, "codex");
  for (const d of [cwd, profile, sessions, home]) mkdirSync(d, {recursive: true});
  const args = [cli!, "--offline", "--session-dir", sessions, ...(session ? ["--session", session] : []),
    "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
    "--extension", ext("./fixtures/provider.ts"), "--extension", ext(extensionFiles[extension]), "--tools",
    "ss_images_generate,ss_images_edit,ss_images_generate_with_references,ss_images_save", "--model", "ss-images-fixture/fixture", "--thinking", "off"];
  const env = {PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOME: root, USERPROFILE: root,
    TMPDIR: root, CODEX_HOME: home, PI_CODING_AGENT_DIR: profile, NO_UPDATE_NOTIFIER: "1"};
  return {args, cwd, env};
}
async function run(root: string, prompts: Prompt[], session?: string, extension: keyof typeof extensionFiles = "renderer",
                   observe?: (turn: number, event: any, abort: () => void) => void) {
  const {args, cwd, env} = piFixture(root,session,extension);
  const ch = spawn(process.execPath, [...args,"--mode","rpc"], {cwd, env, stdio:"pipe"});
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
  const abort = () => { ch.stdin.write('{"type":"abort","id":"abort-fixture"}\n') };
  const rl = createInterface({input: ch.stdout});
  send();
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      observe?.(index, e, abort);
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
test("Pi RPC: contextual captions reach chat, not external pixels; only the requested change dispatches", {skip:!cli}, async () => {
  const root = mkdtempSync(join(tmpdir(),"ss-guided-"));
  try {
    const caption = "Traslada el acabado de la muestra al dibujo anterior.", source = png(123,true);
    const images = [{type:"image" as const,mimeType:"image/png" as const,data:source.toString("base64")}];
    const calls: number[] = [];
    const results = await run(root,["Genera una foto de un faro", {message:"¿Qué opciones habría?",images}, {message:caption,images}], undefined,"renderer",(turn,e) => {
      if (e.type === "tool_execution_start") calls.push(turn);
      if (turn && e.type === "message_end" && e.message.role === "user") {
        assert.equal(e.message.content.length,1); assert.equal(e.message.content[0].type,"text");
      }
      assert.ok(e.type !== "extension_ui_request" || e.method !== "confirm");
    });
    assert.deepEqual(calls,[0,2]); assert.deepEqual(results.map(r=>r.details.status),["preview","preview"]);
    const sessions = join(root,"sessions"), log = readFileSync(join(sessions,readdirSync(sessions).find(f=>f.endsWith(".jsonl"))!),"utf8");
    assert.ok(log.includes(caption));
    for (const bytes of [source,png(123)]) assert.ok(!log.includes(bytes.toString("base64")));
    assert.ok(!existsSync(join(root,"project","media")));
  } finally { rmSync(root,{recursive:true,force:true}) }
});

test("Pi RPC: natural edit requests with private attachments, no second confirmation, edited preview and approved save after reopen",
    {skip: !cli, timeout: 60_000}, async () => {
      const root = mkdtempSync(join(tmpdir(), "ss-photo-rpc-")), project = join(root, "project"),
        home = join(root, "codex"), file = join(root, "pi-clipboard-12345678-0000-4000-8000-000000000001.png");
      try {
        const instructions = ["Mejora la luz del faro seleccionado.", "Cambia únicamente el color del tejado.", "Mejora el dibujo del pelaje."],
          sources = [png(21, true), png(47, true), png(21, true)], previews = [png(21), png(47), png(21)];
        writeFileSync(file, sources[0]);
        const edited: number[] = [], userPrompts: string[] = [];
        const prompts = instructions.map((s, i): Prompt => ({
          message: i === 0 ? s : `Editar foto:\n${s}`, images: [{type: "image", mimeType: "image/png", data: sources[i].toString("base64")}]
        }));
        const results = await run(root, prompts, undefined, "renderer", (turn, e) => {
          if (e.type === "message_end" && e.message.role === "user") {
            const c = e.message.content;
            assert.equal(c.length, 1);
            assert.equal(c[0].type, "text");
            userPrompts.push(c[0].text);
          }
          assert.ok(e.type !== "extension_ui_request" || e.method !== "confirm");
          if (e.type === "tool_execution_update" && e.partialResult?.details?.status === "editing") edited.push(turn);
        });
        assert.deepEqual(edited, [0, 1, 2]);
        assert.deepEqual(results.map(x => x?.details.status), ["preview", "preview", "preview"]);
        assert.equal(new Set(userPrompts).size, 3, "each dispatch is bound to a distinct live marker");
        assert.ok(userPrompts.every(p => p.startsWith("Solicitud local de edición de foto (")));
        const expected = (i: number) => png((Buffer.byteLength(instructions[i]) + previews[i].toString("base64").length) % 230, true);
        results.forEach((r, i) => assert.equal(r.details.sha256, hash(expected(i))));
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
          "guarda la vista 3 como foto.png"], session, "renderer", (turn, event) => {
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

test("real Linux Pi terminal: submit current clipboard PNGs without another confirmation and save only the numbered output",
    {skip: !cli || process.platform !== "linux" || spawnSync("python3", ["--version"]).status !== 0, timeout: 48_000}, () => {
      const root = mkdtempSync(join(tmpdir(),"ss-ref-tui-"));
      try {
        const {args, cwd, env} = piFixture(root,undefined,"renderer"), inputs = [png(32,true),png(52,true)];
        const files = [1,2].map(n => join(root,`pi-clipboard-12345678-0000-4000-8000-00000000000${n}.png`));
        files.forEach((name,i) => writeFileSync(name,inputs[i]));
        const r = spawnSync("python3",[ext("./fixtures/reference-tui.py"),process.execPath,...args],
          {cwd, env:{...env, TERM:"xterm-256color",LANG:"C.UTF-8"},encoding:"utf8",timeout:42_000});
        assert.equal(r.status,0,r.stderr+String(r.error??""));
        const generatedDir = join(root,"codex","generated_images"), threads = readdirSync(generatedDir);
        assert.equal(threads.length,1);
        const dir = join(generatedDir,threads[0]);
        assert.deepEqual(readFileSync(join(cwd,"media","images","sello.png")),readFileSync(join(dir,readdirSync(dir)[0])));
        files.forEach((name,i) => assert.deepEqual(readFileSync(name),inputs[i]));
      } finally { rmSync(root,{recursive:true,force:true}) }
    });

test("real Pi RPC: natural and legacy reference requests dispatch without confirmation; only outputs reach chat and can be saved after reopen",
    {skip: !cli, timeout: 60_000}, async () => {
      const root = mkdtempSync(join(tmpdir(),"ss-refs-rpc-"));
      try {
        const prompt = "REF-FIXTURE-PRIVADO: crea un icono.\nUsa el contorno de la primera y la paleta de la tercera.",
          file = join(root,"foto del cliente.png"), sources = [31,62,95].map(i => png(i,true)), refs = [31,62,95].map(i => png(i));
        writeFileSync(file,sources[0]); // Only the RPC client is allowed to attach this; a path alone must be consumed.
        const attachments = sources.map(b => ({type:"image" as const, mimeType:"image/png" as const, data:b.toString("base64")}));
        const requests = ["En base a estas fotos genera un icono. " + prompt, prompt + " Sin letras."];
        const markers: string[] = [], generated: number[] = [];
        let context: any;
        const results = await run(root, [
          {message:`Generar con referencias:\n${file}\n${prompt}`,expectHandled:true},
          {message:requests[0],images:attachments}, {message:"Genera la imagen con este prompt:\n"+requests[1],images:attachments},
          "Inspecciona el contexto sintético."
        ],undefined,"renderer",(turn,e) => {
          if (!turn) assert.ok(!["agent_start","tool_execution_start","tool_execution_update"].includes(e.type));
          if (e.type === "message_end" && e.message.role === "user" && [1,2].includes(turn)) {
            assert.equal(e.message.content.length,1);
            const m = e.message.content[0].text; assert.match(m,/^Solicitud local de generación con referencias \(/u); markers.push(m);
          }
          assert.ok(e.type !== "extension_ui_request" || e.method !== "confirm");
          if (e.type === "tool_execution_update" && e.partialResult?.details?.status === "generating") generated.push(turn);
          if (turn===3 && e.type==="message_end" && e.message.role==="assistant" && e.message.stopReason==="stop")
            context=JSON.parse(e.message.content[0].text);
        });
        assert.equal(new Set(markers).size,2);
        assert.deepEqual(generated,[1,2]);
        const seeds = requests.map(text => {
          const digest=createHash("sha256").update(text); refs.forEach(b => digest.update(b));
          return digest.digest()[0]%230;
        });
        assert.deepEqual(results.map(r => [r?.details.status,r?.details.sha256]), seeds.map(seed => ["preview",hash(png(seed,true))]));
        assert.deepEqual(context,{images:seeds.map(seed => hash(png(seed))),privatePrompt:false});
        const session=join(root,"sessions",readdirSync(join(root,"sessions")).find(f => f.endsWith(".jsonl"))!);
        const log=readFileSync(session,"utf8");
        for(const sensitive of [prompt.split(":")[0],file,...[...sources,...refs].map(b=>b.toString("base64"))]) assert.ok(!log.includes(sensitive));
        assert.ok(!existsSync(join(root,"project","media"))); assert.deepEqual(readFileSync(file),sources[0]);
        const [saved]=await run(root,["guarda la vista 2 como icono.png"],session);
        assert.equal(saved?.details.relative,join("media","images","icono.png"));
        assert.deepEqual(readFileSync(join(root,"project",saved.details.relative)),png(seeds[1],true));
      } finally { rmSync(root,{recursive:true,force:true}) }
    });

test("real Pi RPC with a scripted chat: plan, generate without a prompt copy and correct the latest preview",
    {skip: !cli, timeout: 35_000}, async () => {
      const root = mkdtempSync(join(tmpdir(), "ss-images-design-"));
      try {
        const text: string[] = [], calls: number[] = [];
        const edited = "Portada vertical: faro a la luz de la luna, mar en calma. Tinta azul. Sin letras.";
        const results = await run(root, ["Quiero una portada para mi cuento.", "Un faro, con calma nocturna. Sin letras.",
                   "Genera la portada", "Haz la luna más grande."], undefined, "renderer", (turn, e) => {
          if (e.type === "message_end" && e.message.role === "assistant" && e.message.stopReason === "stop")
            text[turn] = e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
          if (e.type === "tool_execution_start") calls.push(turn);
          assert.ok(!(e.type === "extension_ui_request" && e.method === "set_editor_text"));
        });
        assert.match(text[0], /¿Qué debería verse/);
        assert.match(text[1], /^Portada vertical:[^\n]+Sin letras\./);
        assert.deepEqual(calls, [2, 3]);
        assert.deepEqual(results.map(r => r?.details.status), ["preview", "preview"]);
        const previewSeed = Buffer.byteLength(edited) % 230;
        assert.equal(results[0].details.sha256, hash(png(previewSeed, true)));
        const correctedSeed = (Buffer.byteLength("Haz la luna más grande.") + png(previewSeed).toString("base64").length) % 230;
        assert.equal(results[1].details.sha256, hash(png(correctedSeed, true)));
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
        const results = await run(r, ["Genera una postal de una montaña al amanecer.", "Genera la imagen con este prompt: Postal de una montaña al amanecer."], undefined, "production");
        assert.deepEqual(results.map(r => r?.details.code), ["login_required", "login_required"]);
        assert.ok(!existsSync(join(r, "project", "media")));
      } finally {
        rmSync(r, {recursive: true, force: true});
      }
    });
