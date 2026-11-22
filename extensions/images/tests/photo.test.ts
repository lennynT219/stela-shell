import assert from "node:assert/strict";
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {runEditRequest, runReferenceRequest} from "../codex.ts";
import {MAX_BYTES} from "../files.ts";
import {REFERENCE_HEADING, referenceRequest, reviewImages, selectPhoto, selectReferences} from "../photo.ts";
import {png} from "./fixture.ts";

const reviewPhoto = (selection: ReturnType<typeof selectPhoto>) => reviewImages(selection)[0];
const image = (bytes: Buffer) => ({type: "image", mimeType: "image/png", data: bytes.toString("base64")});
test("one explicitly selected PNG: bounded input, no traversal, metadata, hidden instructions or ambiguous sources", () => {
  const root = mkdtempSync(join(tmpdir(), "ss-photo-source-"));
  try {
    const file = join(root, "Mi foto.png"), original = png(17, true), caption = "Conserva el sujeto.\nCambia el color.";
    writeFileSync(file, original);
    const [path, attached] = [selectPhoto(`Editar foto:\r\n${file}\r\n${caption}`), selectPhoto(`Edit photo: ${caption}`, [image(original)])];
    for (const selection of [path, attached]) {
      assert.equal(selection.instructions, caption);
      const result = reviewPhoto(selection);
      assert.equal(result.width, 2);
      assert.deepEqual(result.preview, png(17));
    }
    const submit = (p: string) => `Editar foto:\n${p}\n${caption}`;
    for (const bad of ["~/x.png", "file:///other.png", "//server/foto.png", `${root}/../x.png`, `${root}/foto.jpg`, `${file}\n${file}`])
      assert.throws(() => selectPhoto(submit(bad)), /photo_selection/);
    for (const invalid of [submit(file), `Editar foto: ${caption}\x1b[2J`, `Editar foto: A\u202eB`, `Editar foto: ${"á".repeat(2049)}`])
      assert.throws(() => selectPhoto(invalid, [image(original)]), /photo_selection/);
    for (const attachments of [[image(original), image(original)], [{...image(original), mimeType: "image/jpeg"}],
      [{...image(original), data: "a".repeat(4 * Math.ceil(MAX_BYTES / 3) + 4)}]])
      assert.throws(() => selectPhoto("Editar foto: Ajusta la luz", attachments), /photo_selection/);
    for (const bad of [image(Buffer.from("not a picture")), {...image(original), data: "!".repeat(100)}])
      assert.throws(() => reviewPhoto(selectPhoto("Editar foto: Azul", [bad])), /invalid_png/);
    if (process.platform !== "win32") {
      const link = join(root, "link.png"), dir = join(root, "dir");
      symlinkSync(file, link);
      symlinkSync(root, dir);
      for (const redirected of [link, join(dir, "Mi foto.png")])
        assert.throws(() => reviewPhoto(selectPhoto(submit(redirected))), /invalid_png|photo_unavailable/);
      linkSync(file, join(root, "hard.png"));
      assert.throws(() => reviewPhoto(path), /invalid_png/);
    }
    assert.deepEqual(readFileSync(file), original);
  } finally { rmSync(root, {recursive: true, force: true}) }
});

test("only explicit reference submissions: ordered PNGs before or after a prompt, never mixed or silently dropped", () => {
  const root = mkdtempSync(join(tmpdir(), "ss-refs-source-"));
  try {
    const paths = [1,2,3].map((n) => join(root, `Imagen ${n}.png`));
    paths.forEach((p,i) => writeFileSync(p, png(31+i,true)));
    const prompt = "Usa la forma de la primera y los colores de la segunda.\nSin letras.",
      files = paths.join("\n"), args = paths.map((_,i) => image(png(31+i,true)));
    for (const header of [REFERENCE_HEADING, "Generate with references:", "Genera la imagen con este prompt:"]) {
      for (const [s, a] of [[files+"\n"+prompt, []], [prompt+"\n"+files, []], [prompt, args]] as const) {
        const raw = header + "\n" + s;
        assert.ok(referenceRequest(raw, !!a.length));
        const selected = selectReferences(raw, a);
        assert.equal(selected.instructions, prompt);
        assert.deepEqual(reviewImages(selected).map(x => x.preview), [png(31),png(32),png(33)]);
      }
    }
    assert.ok(!referenceRequest("Genera la imagen con este prompt: Un logo.",false));
    assert.ok(!referenceRequest("Dibuja un faro",true)); // ordinary chat attachment is not authorization
    for (const s of ["Generar con referencias\n"+prompt, "Genera la imagen con este prompt:\n"+join(root,"foto.jpg")+"\n"+prompt,
      REFERENCE_HEADING+"\n"+paths[0]+"\nsilueta.png\n"+prompt]) {
      assert.ok(referenceRequest(s,false));
      assert.throws(() => selectReferences(s), /reference_selection/);
    }
    for (const [s,a] of [[prompt, []], [files, []], [files+"\n"+paths[0]+"\n"+prompt, []], [prompt, [...args,args[0]]],
      [paths[0]+"\n"+prompt,args], [paths[0]+"\n"+prompt+"\n"+paths[1],[]], [paths[0]+"\nusa el anterior",[]],
      [prompt, [args[0],{...args[1], mimeType:"image/jpeg"}]], [prompt+"\x1b[2J",args], [prompt, [args[0],{...args[1],data:"A".repeat(4 * Math.ceil(MAX_BYTES/3))}]] ] as const)
      assert.throws(() => selectReferences(REFERENCE_HEADING+"\n"+s,a), /reference_selection/);
    assert.throws(() => reviewImages(selectReferences(REFERENCE_HEADING+"\n"+prompt,[args[0], image(Buffer.from("not PNG"))])), /invalid_png/);
  } finally { rmSync(root,{recursive:true,force:true}) }
});

test("multiple staged reference snapshots are removed even when scope is revoked partway through staging", async () => {
  const root = mkdtempSync(join(tmpdir(),"ss-refs-clean-")), project = join(root,"project"), temp = join(root,"temp");
  mkdirSync(project); mkdirSync(temp);
  const key = process.platform === "win32" ? "TEMP" : "TMPDIR", prev = process.env[key], refs = [png(18),png(19)];
  process.env[key] = temp;
  try {
    for (const cause of ["beforeDispatch","duringPreparation"] as const) {
      const ctrl = new AbortController();
      let checks = 0;
      await assert.rejects(runReferenceRequest({home:root, project, signal:ctrl.signal, prompt:"Una marca nueva.", references:refs,
        checkCurrent: () => {
          if (++checks === 2 && cause === "duringPreparation") {
            const work = readdirSync(temp);
            assert.equal(work.length,1); assert.deepEqual(readdirSync(join(temp,work[0])), ["reference-1.png"]);
            ctrl.abort();
          }
        }}, async(cwd) => {
        assert.equal(cause,"beforeDispatch");
        assert.deepEqual(readdirSync(cwd).sort(), ["reference-1.png","reference-2.png"]);
        refs.forEach((b,i) => assert.deepEqual(readFileSync(join(cwd,`reference-${i+1}.png`)),b));
        throw Error("fixture preflight failure");
      }),cause === "duringPreparation" ? /cancelled/ : /generation_failed/);
      assert.deepEqual(readdirSync(temp),[]);
    }
    assert.deepEqual(readdirSync(project),[]);
  } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
    rmSync(root,{recursive:true,force:true});
  }
});

test("the private reference copy is removed on preflight failure, active cancellation and scope loss before SDK iteration", async () => {
  const root = mkdtempSync(join(tmpdir(), "ss-photo-clean-")), project = join(root, "project");
  mkdirSync(project);
  try {
    for (const mode of ["failure", "cancel", "revoked", "cleanup"]) {
      const ac = new AbortController(), photo = png(81);
      let workspace = "", iterated = false, revoked = false;
      const request = {home: root, project, prompt: "Cambia solo la luz.", photo, signal: ac.signal,
        checkCurrent: () => { if (revoked) ac.abort() }};
      await assert.rejects(runEditRequest(request, async (cwd, signal) => {
        workspace = cwd;
        assert.deepEqual(readdirSync(cwd), ["source.png"]);
        assert.deepEqual(readFileSync(join(cwd, "source.png")), photo);
        if (mode === "cleanup") writeFileSync(join(cwd, "unexpected-fixture"), "forces rmdir to fail");
        if (mode === "failure" || mode === "cleanup") throw Error("synthetic preflight failure");
        revoked = mode === "revoked";
        return {events: (async function*() {
          iterated = true;
          ac.abort();
          assert.ok(signal.aborted);
          yield {type: "error" as const, message: "cancelled"};
        })()};
      }), mode === "cleanup" ? /photo_cleanup/ : mode === "failure" ? /generation_failed/ : /cancelled/);
      assert.equal(iterated, mode === "cancel");
      assert.ok(workspace && !existsSync(join(workspace, "source.png")));
      if (mode === "cleanup") {
        assert.deepEqual(readdirSync(workspace), ["unexpected-fixture"]);
        rmSync(workspace, {recursive: true}); // test-owned marker and directory
      } else assert.ok(!existsSync(workspace));
      assert.deepEqual(readdirSync(project), []);
    }
  } finally { rmSync(root, {recursive: true, force: true}) }
});
