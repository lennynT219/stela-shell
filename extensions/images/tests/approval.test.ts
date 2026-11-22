import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {registerImages} from "../index.ts";
import {ImageError} from "../files.ts";
import {EDIT, GENERATE, REFERENCE, SAVE} from "../session.ts";
import {SUBMIT} from "../planning.ts";
import type {EditPhoto, Generate, GenerateWithReferences} from "../codex.ts";
import {png, renderFixture} from "./fixture.ts";
const submit = (prompt: string) => `${SUBMIT}\n${prompt}`;
function harness(generate: Generate = renderFixture, homeInsideProject = false, mode = "tui",
                 edit: EditPhoto = async () => assert.fail("unexpected edit dispatch"),
                 generateWithReferences: GenerateWithReferences = async () => assert.fail("unexpected reference dispatch")) {
  const root = mkdtempSync(join(tmpdir(), "ss-img-owner-")), cwd = join(root, "project"),
        home = join(homeInsideProject ? cwd : root, "codex");
  mkdirSync(cwd);
  mkdirSync(home);
  const tools = new Map<string, any>(), events = new Map<string, Function>(), entries: any[] = [];
  let sid = "session-a", active = [GENERATE, EDIT, REFERENCE, SAVE], seq = 0;
  const sm = {
    getCwd: () => cwd,
    getSessionId: () => sid,
    getSessionFile: () => join(root, `${sid}.jsonl`),
    getBranch: () => entries,
    getLeafId: () => entries.at(-1)?.id ?? null
  };
  let editor = "";
  const confirm = async () => assert.fail("unexpected second confirmation");
  const ctx = {cwd, sessionManager: sm, mode, hasUI: mode === "rpc" || mode === "tui", ui: {
    confirm, notify: () => {},
    getEditorText: () => editor, setEditorText: (text: string) => { editor = text }
  }};
  const host = {
    registerTool: (t: any) => tools.set(t.name, t),
    on: (e: string, h: Function) => events.set(e, h),
    getActiveTools: () => active
  };
  registerImages(host as any, {generate, edit, generateWithReferences, env: {CODEX_HOME: home}});
  const emit = (e: string, v: any = {}) => events.get(e)?.(v, ctx);
  emit("session_start");
  const push = (m: any) => entries.push({type: "message", id: String(++seq), message: m});
  function input(raw: string, source = "interactive", streamingBehavior?: string, images: any[] = []) {
    const r = emit("input", {source, text: raw, streamingBehavior, images});
    if (r?.action === "handled") return r;
    const prompt = r?.text ?? raw, attachments = r?.images ?? images;
    emit("before_agent_start", {messageType: "user", prompt, images: attachments});
    push({role: "user", content: [{type: "text", text: prompt}, ...attachments]});
    return r;
  }
  async function call(tool: string, args: object, update?: (r: any) => void) {
    const r = await tools.get(tool).execute("id", args, undefined, update, ctx);
    push({role: "toolResult", toolName: tool, ...r});
    return r;
  }
  return {
    root,
    cwd,
    home,
    input,
    call,
    emit,
    entries,
    type: (text: string) => { editor = text },
    editor: () => editor,
    answer: (text: string, stopReason = "stop") => {
      const message = {role: "assistant", content: [{type: "text", text}], stopReason};
      emit("message_end", {message});
      push(message);
      emit("agent_settled");
    },
    changeId: () => {
      sid = "fork";
      emit("session_start")
    },
    disable: () => active = [],
    close: () => rmSync(root, {recursive: true, force: true})
  };
}
test(
    "no unsolicited generation, foreign prompt or repeat; extension, streamed and replayed approval do not write",
    async () => {
      let count = 0;
      const h = harness(async a => {
        count++;
        return renderFixture(a)
      });
      const prompt = "Dibuja un faro";
      try {
        h.input("hola");
        assert.ok((await h.call(GENERATE, {prompt: "hola"})).isError);
        h.input("Quiero un dibujo de un faro.");
        assert.equal((await h.call(GENERATE, {prompt})).details.code, "draft_needed");
        h.input(submit(prompt));
        assert.equal(
            (await h.call(GENERATE, {prompt: "data from an earlier turn"})).details.code, "invalid_prompt");
        assert.equal(count, 0);
        const a = await h.call(GENERATE, {prompt});
        assert.equal(a.details.status, "preview");
        assert.ok((await h.call(GENERATE, {prompt})).isError);
        assert.equal(count, 1);
        for (const source of ["extension", "queued"]) {
          h.input(
              "guarda esta", source === "queued" ? "rpc" : source,
              source === "queued" ? "followUp" : undefined);
          assert.ok((await h.call(SAVE, {})).isError);
        }
        h.input("guarda esta");
        h.emit("before_agent_start", {messageType: "custom"});
        assert.ok((await h.call(SAVE, {})).isError);
        h.input("guarda esta");
        h.emit("session_tree");
        assert.ok((await h.call(SAVE, {})).isError);
        h.input("guarda esta");
        h.disable();
        assert.ok((await h.call(SAVE, {})).isError);
        assert.equal(existsSync(join(h.cwd, "media")), false);
      } finally {
        h.close();
      }
    });
test("explicit multiline prompts use the submitted body without a model echo, including legacy reflow", async () => {
  const seen: string[] = [], h = harness(async a => { seen.push(a.prompt); return renderFixture(a) });
  const body = "Cuadrícula 2 × 2.\r\n\r\n    Tinta #FFD400.\n  Sin letras.";
  try {
    for (const args of [{}, {prompt:"   Cuadrícula 2 × 2. Tinta #FFD400. Sin letras."}]) {
      h.input(submit(body));
      assert.equal((await h.call(GENERATE, args)).details.status, "preview");
    }
    h.input(submit("á".repeat(2049)));
    assert.equal((await h.call(GENERATE, {})).details.code, "invalid_prompt");
    h.input("Genera una postal");
    assert.equal((await h.call(GENERATE, {})).details.code, "invalid_prompt");
    assert.deepEqual(seen,[body,body]);
  } finally { h.close() }
});

test("a model cannot discard a visual constraint, even if its excerpt is literal", async () => {
  const seen: string[] = [];
  const h = harness(async a => { seen.push(a.prompt); return renderFixture(a) });
  const raw = "Genera un logo para SS, sin letras";
  try {
    h.input(submit(raw));
    for (const prompt of ["un logo para SS", "sin letras"]) {
      assert.equal((await h.call(GENERATE, {prompt})).details.code, "invalid_prompt");
    }
    assert.deepEqual(seen, []);
    assert.equal((await h.call(GENERATE, {prompt: "un logo para SS, sin letras"})).details.status, "preview");
    assert.deepEqual(seen, [raw]);
  } finally {
    h.close();
  }
});

test("chat questions, a displayed draft, revisions and praise do not generate; a natural generation request does without copying the draft", async () => {
  const seen: string[] = [], h = harness(async a => { seen.push(a.prompt); return renderFixture(a) });
  const draft = 'Portada vertical: una casa aislada entre pinos; tinta negra y niebla. Sin letras.';
  const revised = draft.replace('tinta negra', 'acuarela azul');
  const offer = (p: string) => `Puedes editarlo:\n\`\`\`text\n${submit(p)}\n\`\`\``;
  try {
    h.input("Quiero una portada");
    assert.equal((await h.call(GENERATE, {prompt: "Quiero una portada"})).details.code, "draft_needed");
    h.answer("¿Qué debería verse en la portada y qué atmósfera buscas?");
    h.input("Una casa entre pinos, con niebla; sin letras.");
    assert.equal((await h.call(GENERATE, {prompt: draft})).details.code, "draft_needed");
    h.answer(offer(draft));
    assert.equal(h.editor(), submit(draft));
    h.type("");
    h.input("Mejor acuarela azul.");
    h.answer(offer(revised));
    assert.equal(h.editor(), submit(revised));
    h.input("Sí, me gusta");
    assert.ok((await h.call(GENERATE, {prompt: revised})).isError);
    assert.ok((await h.call(SAVE, {})).isError);
    for (const [source, streaming] of [["extension", undefined], ["rpc", "followUp"]] as const) {
      h.input(submit(revised), source, streaming);
      assert.ok((await h.call(GENERATE, {prompt: revised})).isError);
    }
    assert.deepEqual(seen, []);
    const edited = revised.replace('azul', 'verde');
    h.input("Genera la portada");
    assert.equal((await h.call(GENERATE, {prompt: edited})).details.status, "preview");
    assert.ok((await h.call(GENERATE, {prompt: edited})).isError);
    assert.deepEqual(seen, [edited]);
    assert.ok(!existsSync(join(h.cwd, "media")));
  } finally { h.close() }
});
test("offering a draft never replaces typed input, prefills RPC, or carries across a scope change", () => {
  const block = `\`\`\`text\n${submit("Mar en calma.")}\n\`\`\``;
  for (const [mode, initial, change] of [["tui", "mi texto", false], ["rpc", "", false], ["tui", "", true]] as const) {
    const h = harness(renderFixture, false, mode);
    try {
      h.input("Pinta el mar");
      h.type(initial);
      if (change) h.changeId();
      h.answer(block);
      assert.equal(h.editor(), initial);
    } finally { h.close() }
  }
});

test("a draft cannot prefill a reference path chosen by the model into the local file-selection workflow", () => {
  const h = harness();
  try {
    h.input("Quiero un logo.");
    h.answer("```text\n" + submit("Un icono.\n" + join(h.root, "archivo.png")) + "\n```");
    assert.equal(h.editor(),"");
  } finally { h.close() }
});

test("a current TUI photo is pinned at submission and sent once without a second confirmation", async () => {
  let sent = 0;
  const instructions = "Ponle alas a esta foto.";
  const h = harness(renderFixture, false, "tui", async a => {
    sent++;
    assert.equal(a.prompt, instructions);
    assert.deepEqual(a.photo, png(42)); // The submitted pixels, without metadata.
    return renderFixture(a);
  });
  const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  try {
    writeFileSync(path, png(42, true), {flag: "wx"});
    const marker = h.input(`${instructions} ${path}`);
    writeFileSync(path, png(199));
    assert.deepEqual(marker.images, []);
    assert.ok(!marker.text.includes(path) && !marker.text.includes(instructions));
    assert.ok((await h.call(GENERATE, {prompt: instructions})).isError);
    assert.ok((await h.call(EDIT, {path})).isError);
    assert.equal((await h.call(EDIT, {})).details.status, "preview");
    assert.ok(!existsSync(join(h.cwd, "media")));
    assert.ok((await h.call(EDIT, {})).isError);
    h.input(marker.text);
    assert.ok((await h.call(EDIT, {})).isError);
    assert.equal(sent, 1);
  } finally { rmSync(path, {force:true}); h.close() }
});

test("queued/injected/ambiguous or headless edit inputs are consumed locally and cannot dispatch", async () => {
  const image = {type: "image", mimeType: "image/png", data: png().toString("base64")};
  const raw = "Editar foto:\nIlumina la escena.";
  for (const mode of ["rpc", "print"]) {
    const h = harness(renderFixture, false, mode);
    try {
      for (const [source, queue, images] of [["extension", undefined, [image]], ["rpc", "steer", [image]],
        ["rpc", undefined, [image, image]], ["rpc", undefined, []], ...(mode === "print" ? [["rpc", undefined, [image]]] : [])] as any[]) {
        assert.equal(h.input(raw, source, queue, images)?.action, "handled");
        assert.ok((await h.call(EDIT, {})).isError);
      }
      const hostFile = join(h.root, "local.png");
      writeFileSync(hostFile, png());
      assert.equal(h.input(`Editar foto:\n${hostFile}\nAjusta la luz.`, "rpc")?.action, "handled");
      assert.ok((await h.call(EDIT, {})).isError);
      assert.deepEqual(h.entries.filter(e => e.message.role === "user"), []);
      assert.ok(!existsSync(join(h.cwd, "media")));
    } finally { h.close() }
  }
});

test("changing scope or disabling the tool before dispatch invalidates a direct submission", async () => {
  const image = {type: "image", mimeType: "image/png", data: png(8).toString("base64")};
  for (const change of ["switch", "disable"]) {
    const h = harness();
    try {
      h.input("Ponle alas a esta foto.", "rpc", undefined, [image]);
      const result = await h.call(EDIT, {}, () => {
        if (change === "switch") h.emit("session_before_tree"); else h.disable();
      });
      assert.match(result.details.code, /cancelled|scope_changed/);
      assert.ok(!existsSync(join(h.home, "generated_images")));
    } finally { h.close() }
  }
});

test("an ordinary chat attachment is not an image operation and cannot be reused", async () => {
  const h = harness(), image = {type: "image", mimeType: "image/png", data: png(8).toString("base64")};
  try {
    assert.equal(h.input("¿Qué ves en esta imagen?", "rpc", undefined, [image]), undefined);
    h.input("Ponle alas a esta foto.", "rpc");
    assert.equal((await h.call(EDIT, {})).details.code, "not_requested");
    assert.equal((await h.call(REFERENCE, {})).details.code, "not_requested");
  } finally { h.close() }
});

test("reference generation sends the pinned ordered set and instructions without another confirmation", async () => {
  const prompt = "Crea una figura distinta: contorno de la primera, color de la segunda.", refs = [png(19),png(23)];
  let calls = 0;
  const h = harness(undefined, false, "tui", undefined, async req => {
    calls++; assert.equal(req.prompt,prompt); assert.deepEqual(req.references,refs);
    return renderFixture(req);
  });
  try {
    const paths = ["A.png","B.png"].map((n,i) => { const path = join(h.root,n); writeFileSync(path,png(i ? 23 : 19,true)); return path });
    const raw = [SUBMIT,prompt,...paths].join("\n"), marker = h.input(raw);
    assert.deepEqual(marker.images,[]); assert.match(marker.text,/ss_images_generate_with_references/);
    for (const content of [...paths,prompt]) assert.ok(!marker.text.includes(content));
    assert.ok((await h.call(EDIT,{})).isError && (await h.call(GENERATE,{prompt})).isError);
    assert.ok((await h.call(REFERENCE,{paths})).isError);
    writeFileSync(paths[0],png(73)); rmSync(paths[1]);
    const gained = await h.call(REFERENCE,{});
    assert.equal(gained.details.status,"preview"); assert.ok(!existsSync(join(h.cwd,"media")));
    assert.ok((await h.call(REFERENCE,{})).isError); h.input(marker.text);
    assert.ok((await h.call(REFERENCE,{})).isError); assert.equal(calls,1);
  } finally { h.close() }
});

test("private reference submissions consume invalid, injected and queued inputs; revocation or corrupt PNG cannot dispatch", async () => {
  const data = {type:"image", mimeType:"image/png", data:png(74).toString("base64")}, prompt = "Haz un icono nuevo.";
  for (const mode of ["rpc","print"]) {
    const h = harness(undefined,false,mode); // any dispatch fails
    try {
      const header = "Generar con referencias:", raw = header+"\n"+prompt;
      for (const [text,source,queue,imgs] of [
        [raw,"extension",undefined,[data]], [raw,"rpc","followUp",[data]], [raw,"rpc",undefined,[]],
        [header+"\n"+join(h.root,"absent.png")+"\n"+prompt,"rpc",undefined,[]],
        [submit(prompt),"rpc","steer",[data]], [raw,"rpc",undefined,[data,data,data,data]],
        ...(mode === "print" ? [[raw,"rpc",undefined,[data]]] : [])
      ] as any[]) assert.equal(h.input(text,source,queue,imgs).action,"handled");
      assert.deepEqual(h.entries,[]);
      if (mode !== "rpc") continue;
      const corrupt = {...data, data: Buffer.from("not a PNG").toString("base64")};
      assert.equal(h.input(raw,"rpc",undefined,[data,corrupt]).action,"handled");
      assert.ok((await h.call(REFERENCE,{})).isError);
      h.input(raw,"rpc",undefined,[data]);
      const result = await h.call(REFERENCE,{},() => h.emit("session_before_tree"));
      assert.equal(result.details.code,"cancelled");
      assert.ok(!existsSync(join(h.home,"generated_images")));
    } finally { h.close() }
  }
});

test("corrections use only an intact selected preview; an ambiguous target or missing attachment does not dispatch", async () => {
  const sent: Buffer[] = [];
  const h = harness(renderFixture, false, "tui", async req => {
    sent.push(req.photo);
    return renderFixture(req);
  });
  try {
    const gen = async (prompt: string) => {
      h.input(submit(prompt));
      return h.call(GENERATE, {prompt});
    };
    const first = "Un gato con alas.", second = "Un perro que vuela.";
    const a = await gen(first);
    await gen(second);
    const fix = "Haz las alas más pequeñas.";
    h.input(fix);
    assert.equal((await h.call(EDIT, {})).details.status, "preview");
    assert.deepEqual(sent[0], png(Buffer.byteLength(second) % 230));
    h.input("Gracias.");
    h.input(fix);
    assert.equal((await h.call(EDIT, {})).details.status, "preview");
    assert.deepEqual(sent[1], png(Buffer.byteLength(fix) % 230));
    h.input("Corrige la vista 1: reduce las alas.");
    assert.equal((await h.call(EDIT, {})).details.status, "preview");
    assert.deepEqual(sent[2], png(Buffer.byteLength(first) % 230));
    h.input("Corrige la vista 1: cambia el color.");
    writeFileSync(join(h.home, "generated_images", a.details.thread, a.details.file), png(199));
    assert.equal((await h.call(EDIT, {})).details.code, "source_changed");
    h.input("En base a esta foto genera un logo.");
    assert.ok((await h.call(GENERATE, {prompt:"Un logo."})).isError);
    assert.equal(sent.length, 3);
    assert.ok(!existsSync(join(h.cwd, "media")));
  } finally { h.close() }
});

test("the agent assigns roles to a contextual selection; the host binds the exact two inputs for one turn", async () => {
  const calls: {photo: Buffer; guide?: Buffer; prompt: string}[] = [];
  const h = harness(renderFixture, false, "tui", async req => { calls.push(req); return renderFixture(req) });
  const file = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  const guide = png(87), caption = "dele ese estilo y los coloes tambien";
  try {
    writeFileSync(file, guide, {flag:"wx"});
    const base = "Una mascota en espiral";
    h.input(submit(base)); await h.call(GENERATE, {prompt:base});
    const marker = h.input(`${caption}\n${file}`);
    assert.deepEqual(marker.images, []); assert.ok(marker.text.includes(caption) && !marker.text.includes(file));
    writeFileSync(file, png(23));
    assert.equal((await h.call(EDIT, {base:"preview", path:file})).details.code,"not_requested");
    assert.equal((await h.call(EDIT, {base:"preview"})).details.status,"preview");
    assert.equal(calls[0].prompt,caption); assert.deepEqual(calls[0].guide,guide);
    assert.deepEqual(calls[0].photo,png(Buffer.byteLength(base)%230));
    assert.ok((await h.call(REFERENCE, {})).isError);
    h.input(`¿Qué opinas?\n${file}`); h.answer("¿Quieres cambiar la vista o comentar el acabado?");
    h.input("sí"); assert.ok((await h.call(EDIT,{base:"preview"})).isError);
    h.input(`Corrige la vista 99 con esta referencia.\n${file}`);
    assert.equal((await h.call(EDIT,{base:"preview"})).details.code,"no_preview");
    h.input(`La que quiero modificar es la foto recién pegada.\n${file}`);
    assert.equal((await h.call(EDIT,{base:"attachment"})).details.status,"preview");
    assert.equal(calls.length,2); assert.deepEqual(calls[1].photo,png(23)); assert.equal(calls[1].guide,undefined);
    assert.ok(!existsSync(join(h.cwd,"media")));
  } finally { rmSync(file,{force:true}); h.close() }
});

test("a numeric clarification selects the exact preview and resumes the pending recolor, including its palette", async () => {
  const edits: {prompt: string; photo: Buffer}[] = [];
  const h = harness(renderFixture, false, "tui", async req => { edits.push(req); return renderFixture(req) });
  try {
    for (const prompt of ["Una estrella", "Una estrella plana"]) {
      h.input(submit(prompt)); await h.call(GENERATE, {prompt});
    }
    h.input("la 2");
    assert.equal((await h.call(EDIT, {})).details.code, "not_requested");
    const instruction = "cambia la vista 1 o la vista 2 a los colores acordados";
    h.input(instruction);
    assert.equal((await h.call(EDIT, {agreedPalette: ["#FFD400", "#2B2D31"]})).details.code, "revision_ambiguous");
    h.answer("¿La 1 o la 2?");
    h.input("3");
    assert.equal((await h.call(EDIT, {})).details.code, "no_preview");
    h.answer("Hay dos vistas. ¿Cuál prefieres?");
    h.input("la 2");
    assert.equal((await h.call(EDIT, {})).details.status, "preview");
    assert.equal(edits.length, 1);
    assert.equal(edits[0].prompt, `${instruction}\nPaleta acordada: #FFD400, #2B2D31.`);
    assert.deepEqual(edits[0].photo, png(Buffer.byteLength("Una estrella plana") % 230));
  } finally { h.close() }
});

test("colloquial revisions and an explicitly repeated failed palette change stay on the chosen preview", async () => {
  const sent: {prompt: string; photo: Buffer}[] = [];
  const h = harness(renderFixture, false, "tui", async req => {
    sent.push(req);
    if (sent.length === 2) throw new ImageError("no_png_missing");
    return renderFixture(req);
  });
  try {
    h.input(submit("Una mascota"));
    await h.call(GENERATE, {prompt: "Una mascota"});
    // Input itself does not dispatch. This harness simulates the chat agent's decision,
    // not a second intent classifier in the host.
    h.input("Qué bonita quedó.");
    h.answer("Gracias.");
    assert.equal(sent.length, 0);
    h.input("¿Podríamos dejar la silueta casi plana para que se lea en pequeño?");
    assert.equal((await h.call(EDIT, {})).details.status, "preview");
    const raw = "Volvamos a nuestra combinación cromática inicial.", palette = {agreedPalette: ["#FFD400", "#2B2D31"]};
    h.input(raw);
    assert.equal((await h.call(EDIT, {agreedPalette: ["otra instrucción"]})).details.code, "palette_needed");
    assert.equal(sent.length, 1);
    assert.equal((await h.call(EDIT, palette)).details.code, "no_png_missing");
    h.answer("No se obtuvo una vista nueva.");
    assert.equal(sent.length, 2);
    h.input(raw);
    assert.equal((await h.call(EDIT, palette)).details.status, "preview");
    assert.deepEqual(sent[1].photo, sent[2].photo);
    assert.equal(sent[2].prompt, `${raw}\nPaleta acordada: #FFD400, #2B2D31.`);
    assert.ok(!existsSync(join(h.cwd, "media")));
  } finally { h.close() }
});

test("a Codex home inside the project is rejected before generating", async () => {
  const h = harness(async () => assert.fail("generator must not start"), true);
  try {
    h.input(submit("Dibuja un faro"));
    assert.equal((await h.call(GENERATE, {prompt: "un faro"})).details.code, "unsafe_workspace");
  } finally {
    h.close();
  }
});
test("switching session revokes pending generation; a fork cannot inherit preview ownership", async () => {
  let begin!: () => void, release!: () => void;
  const began = new Promise<void>(ok => begin = ok), wait = new Promise<void>(ok => release = ok);
  const h = harness(async a => {
    const v = await renderFixture(a);
    begin();
    await wait;
    return v;
  });
  try {
    h.input(submit("Genera una imagen de prueba"));
    const running = h.call(GENERATE, {prompt: "imagen de prueba"});
    await began;
    h.emit("session_before_switch");
    release();
    assert.ok((await running).isError);
    h.input(submit("Dibuja un faro"));
    assert.equal((await h.call(GENERATE, {prompt: "un faro"})).details.status, "preview");
    h.changeId();
    h.input("guarda la primera");
    assert.equal((await h.call(SAVE, {})).details.code, "no_preview");
    assert.equal(existsSync(join(h.cwd, "media")), false);
  } finally {
    release();
    h.close();
  }
});
test(
    "save parameters cannot redirect approval; helper receives neither tools nor lifecycle hooks",
    async () => {
      const h = harness();
      try {
        h.input(submit("Dibuja un faro"));
        await h.call(GENERATE, {prompt: "un faro"});
        h.input("guarda esta");
        assert.ok((await h.call(SAVE, {filename: "other.png"})).isError);
        assert.equal(existsSync(join(h.cwd, "media")), false);
      } finally {
        h.close();
      }
      registerImages(
          {on: () => assert.fail("helper hook"), registerTool: () => assert.fail("helper tool")} as any,
          {env: {STELA_SUBAGENT_CHILD: "1"}});
    });
