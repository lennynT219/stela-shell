import {tmpdir} from "node:os";
import {isAbsolute, normalize, sep} from "node:path";
import {MAX_PROMPT, MAX_REFERENCES} from "./codex.ts";
import {fail, inspectPng, MAX_BYTES, readPhotoFile} from "./files.ts";
import {submissionBody, submittedPrompt, SUBMIT} from "./planning.ts";

export const PHOTO_HEADING = "Editar foto:", REFERENCE_HEADING = "Generar con referencias:";
const editHeading = /^\s*(?:Editar foto|Edit photo):/iu;
// A bare reserved heading is consumed too, but cannot grant a request without the colon.
const refHeading = /^\s*(?:Genera(?:r)? con referencias?|Generate with references?)[ \t]*(:|(?=\r?\n|$))/iu;
const pathLike = /^(?:[/\\]|[A-Z]:[/\\]|file:\/\/|~[/\\]|\.{1,2}[/\\]|[@"'](?:[/\\]|[A-Z]:[/\\]))/iu;
// Reserve apparent file selections, including common mistakes, rather than silently sending
// a path as a text-only prompt or dropping an attempted second reference.
const imageSuffix = /\.(?:png|jpe?g|gif|webp|bmp|heic|avif|svg)["']?$/iu;
function selectionLine(line: string) {
  const s = line.trim();
  return pathLike.test(s) || (imageSuffix.test(s) && (!/\s/u.test(s) || /^[^\s/\\]+[/\\]/u.test(s)));
}
export const photoRequest = (text: string) => editHeading.test(text);
export function referenceRequest(text: string, attached: boolean) {
  if (refHeading.test(text)) return true;
  const body = submissionBody(text);
  return body !== undefined && (attached || body.split("\n").some(selectionLine));
}
const unsafeDisplay = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/u;
export const photoUsage = "Escribe «Editar foto:», pega en la línea siguiente la ruta absoluta de un PNG y debajo escribe los cambios. En RPC adjunta un único PNG en vez de indicar una ruta.";
export const referenceUsage = `Escribe «${REFERENCE_HEADING}», pega de 1 a ${MAX_REFERENCES} rutas absolutas de PNG (una por línea) y añade el prompt completo en el mismo mensaje. En RPC adjunta esos PNG en lugar de rutas. Máximo 12 MiB en total.`;

type Attachment = {type: string; mimeType: string; data: string};
type Source = {kind: "file"; path: string} | {kind: "attachment"; data: string};
export type ImageSelection = {sources: Source[]; instructions: string};

/** Pi's TUI pastes clipboard images as temporary paths, not as input-event attachments. */
export function pastedImages(text: string) {
  const directory = tmpdir();
  const prefix = (directory.endsWith(sep) ? directory : directory + sep).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(?:^|\\s)(${prefix}pi-clipboard-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\\.[a-z0-9]+)(?=\\s|$)`, "giu");
  const paths: string[] = [];
  const instructions = text.replace(pattern, (_match, path: string) => { paths.push(path); return " " }).trim();
  return {paths, instructions};
}

function localFile(line: string, error: string) {
  // No shell quoting/expansion, URLs, UNC/device paths, traversal, or Windows alternate streams.
  if (!isAbsolute(line) || /^[/\\]{2}/u.test(line) || !/\.png$/iu.test(line) ||
      line.split(/[/\\]/u).some(s => s === "." || s === "..") || Buffer.byteLength(line) > 4096 ||
      (process.platform === "win32" && (!/^[a-z]:[/\\]/iu.test(line) || line.slice(2).includes(":"))))
    return fail(error);
  return normalize(line);
}
const decodedLength = (s: string) => s.length / 4 * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);

/** Parse only the current human selection, without opening paths. Never mix RPC attachment bytes and host paths. */
function selectInput(text: string, images: readonly Attachment[], edit: boolean): ImageSelection {
  const max = edit ? 1 : MAX_REFERENCES, error = edit ? "photo_selection" : "reference_selection";
  if (text.length > 4096 * max + MAX_PROMPT + 208 || images.length > max) return fail(error);
  const ref = !edit && refHeading.exec(text);
  const body = edit ? (photoRequest(text) ? text.replace(editHeading, "") : undefined) :
    ref ? (ref[1] === ":" ? text.slice(ref[0].length) : undefined) : submissionBody(text);
  if (body === undefined) return fail(error);
  const clean = body.replace(/\r\n/gu, "\n");
  if (unsafeDisplay.test(clean) || !clean.isWellFormed()) return fail(error);
  const lines = clean.trim().split("\n");
  const looksSelected = edit ? (line: string) => pathLike.test(line.trim()) : selectionLine;
  let sources: Source[];
  if (images.length) {
    let total = 0;
    sources = images.map(img => {
      if (img?.type !== "image" || img.mimeType !== "image/png" || typeof img.data !== "string" ||
          !img.data.length || img.data.length % 4 || (total += decodedLength(img.data)) > MAX_BYTES) return fail(error);
      return {kind: "attachment", data: img.data};
    });
  } else {
    // One contiguous group at the start (also at the end for references pasted after the prompt).
    const last = !edit && !looksSelected(lines[0]);
    const paths: string[] = [];
    while (lines.length && looksSelected(lines[last ? lines.length - 1 : 0])) {
      if (paths.length === max) return fail(error);
      paths.push(localFile((last ? lines.pop()! : lines.shift()!).trim(), error));
    }
    if (!paths.length) return fail(error);
    sources = (last ? paths.reverse() : paths).map(path => ({kind: "file", path}));
  }
  if (lines.some(looksSelected)) return fail(error);
  const instructions = lines.join("\n").trim();
  if (!instructions || Buffer.byteLength(instructions) > MAX_PROMPT ||
      (!edit && !submittedPrompt(`${SUBMIT}\n${instructions}`))) return fail(error);
  return {sources, instructions};
}
export const selectPhoto = (text: string, images: readonly Attachment[] = []) => selectInput(text, images, true);
export const selectReferences = (text: string, images: readonly Attachment[] = []) => selectInput(text, images, false);

function readSource(source: Source, remaining: number) {
  if (source.kind === "file") return readPhotoFile(source.path, remaining);
  if (decodedLength(source.data) > remaining) return fail("invalid_png");
  const bytes = Buffer.from(source.data, "base64");
  if (bytes.toString("base64") !== source.data) return fail("invalid_png");
  const {width, height, preview} = inspectPng(bytes);
  return {width, height, preview, sourceBytes: bytes.length};
}
/** Pin the metadata-stripped input buffers in order, at submission. */
export function reviewImages({sources}: ImageSelection) {
  let remaining = MAX_BYTES;
  return sources.map(source => {
    const {sourceBytes, ...photo} = readSource(source, remaining);
    remaining -= sourceBytes;
    return photo;
  });
}
