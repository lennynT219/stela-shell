import assert from "node:assert/strict";
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {runEditRequest} from "../codex.ts";
import {MAX_BYTES} from "../files.ts";
import {reviewPhoto, selectPhoto} from "../photo.ts";
import {png} from "./fixture.ts";

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
