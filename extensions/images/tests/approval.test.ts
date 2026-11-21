import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {registerImages} from "../index.ts";
import {EDIT, GENERATE, SAVE} from "../session.ts";
import {SUBMIT} from "../planning.ts";
import type {EditPhoto, Generate} from "../codex.ts";
import {png, renderFixture} from "./fixture.ts";
const submit = (prompt: string) => `${SUBMIT}\n${prompt}`;
function harness(generate: Generate = renderFixture, homeInsideProject = false, mode = "tui",
                 edit: EditPhoto = async () => assert.fail("unexpected edit dispatch")) {
  const root = mkdtempSync(join(tmpdir(), "ss-img-owner-")), cwd = join(root, "project"),
        home = join(homeInsideProject ? cwd : root, "codex");
  mkdirSync(cwd);
  mkdirSync(home);
  const tools = new Map<string, any>(), events = new Map<string, Function>(), entries: any[] = [];
  let sid = "session-a", active = [GENERATE, EDIT, SAVE], seq = 0;
  const sm = {
    getCwd: () => cwd,
    getSessionId: () => sid,
    getSessionFile: () => join(root, `${sid}.jsonl`),
    getBranch: () => entries,
    getLeafId: () => entries.at(-1)?.id ?? null
  };
  let editor = "";
  let confirm = async (_title: string, _msg: string) => false;
  const ctx = {cwd, sessionManager: sm, mode, hasUI: mode === "rpc" || mode === "tui", ui: {
    confirm: (title: string, msg: string) => confirm(title, msg), notify: () => {},
    getEditorText: () => editor, setEditorText: (text: string) => { editor = text }
  }};
  const host = {
    registerTool: (t: any) => tools.set(t.name, t),
    on: (e: string, h: Function) => events.set(e, h),
    getActiveTools: () => active
  };
  registerImages(host as any, {generate, edit, env: {CODEX_HOME: home}});
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
    confirm: (fn: typeof confirm) => { confirm = fn },
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
        h.input(prompt);
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

test("chat questions, a displayed draft, revisions and praise do not generate; one live edited submission does", async () => {
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
    h.input(submit(edited));
    assert.equal((await h.call(GENERATE, {prompt: revised})).details.code, "invalid_prompt");
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

test("edit consent covers the displayed pixels and text once, never a path change during the dialog", async () => {
  let sent = 0, dialogs = 0, reviewed: Buffer|undefined;
  const instructions = "Conserva el sujeto. Cambia solo el cielo.";
  const h = harness(renderFixture, false, "tui", async a => {
    sent++;
    assert.equal(a.prompt, instructions);
    assert.deepEqual(a.photo, reviewed);
    assert.deepEqual(a.photo, png(42)); // The same pixels, without metadata.
    return renderFixture(a);
  });
  try {
    const path = join(h.root, "Foto familiar.png"), raw = `Editar foto:\n${path}\n${instructions}`;
    writeFileSync(path, png(42, true));
    h.confirm(async (_title, msg) => {
      dialogs++;
      assert.ok(msg.includes(path) && msg.includes(instructions) && msg.includes("OpenAI"));
      assert.ok(reviewed && !sent, "review is local, before dispatch");
      writeFileSync(path, png(199)); // Only the pre-dialog snapshot may be sent.
      return true;
    });
    const marker = h.input(raw);
    assert.deepEqual(marker.images, []);
    assert.ok(!marker.text.includes(path) && !marker.text.includes(instructions));
    assert.ok((await h.call(GENERATE, {prompt: instructions})).isError);
    assert.ok((await h.call(EDIT, {path})).isError);
    assert.equal(dialogs, 0);
    const edited = await h.call(EDIT, {}, r => {
      if (r.details.status === "review") reviewed = Buffer.from(r.content[1].data, "base64");
    });
    assert.equal(edited.details.status, "preview");
    assert.ok(!existsSync(join(h.cwd, "media")));
    assert.ok((await h.call(EDIT, {})).isError);
    h.input(marker.text); // Cannot replay the local placeholder or previous approval.
    assert.ok((await h.call(EDIT, {})).isError);
    assert.equal(dialogs, 1);
    assert.equal(sent, 1);
  } finally { h.close() }
});

test("queued/injected/ambiguous or headless edit inputs are consumed locally and cannot dispatch", async () => {
  const image = {type: "image", mimeType: "image/png", data: png().toString("base64")};
  const raw = "Editar foto:\nIlumina la escena.";
  for (const mode of ["rpc", "print"]) {
    const h = harness(renderFixture, false, mode);
    try {
      h.confirm(async () => assert.fail("no dialog expected"));
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

test("changing scope or disabling the tool while the confirmation is open invalidates even a yes", async () => {
  const image = {type: "image", mimeType: "image/png", data: png(8).toString("base64")};
  for (const change of ["switch", "disable"]) {
    const h = harness();
    try {
      h.input("Editar foto:\nCambia el color.", "rpc", undefined, [image]);
      let dialogs = 0;
      h.confirm(async () => { dialogs++; if (change === "switch") h.emit("session_before_tree"); else h.disable(); return true });
      assert.match((await h.call(EDIT, {})).details.code, /cancelled|scope_changed/);
      assert.equal(dialogs, 1);
      assert.ok(!existsSync(join(h.home, "generated_images")));
    } finally { h.close() }
  }
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
