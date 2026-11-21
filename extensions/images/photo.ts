import {isAbsolute, normalize} from "node:path";
import {MAX_PROMPT} from "./codex.ts";
import {fail, inspectPng, MAX_BYTES, readPhotoFile} from "./files.ts";

export const PHOTO_HEADING = "Editar foto:";
const heading = /^\s*(?:Editar foto|Edit photo):/iu;
export const photoRequest = (text: string) => heading.test(text);
const unsafeDisplay = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/u;
export const photoUsage = "Escribe «Editar foto:», pega en la línea siguiente la ruta absoluta de un PNG y debajo escribe los cambios. En RPC adjunta un único PNG en vez de indicar una ruta.";

type Attachment = {type: string; mimeType: string; data: string};
type Source = {kind: "file"; path: string} | {kind: "attachment"; data: string};
export type PhotoSelection = {source: Source; instructions: string};

function localFile(line: string) {
  // No shell quoting/expansion, URLs, UNC/device paths, traversal, or Windows alternate streams.
  if (!isAbsolute(line) || /^[/\\]{2}/u.test(line) || !/\.png$/iu.test(line) ||
      line.split(/[/\\]/u).some(s => s === "." || s === "..") || Buffer.byteLength(line) > 4096 ||
      (process.platform === "win32" && (!/^[a-z]:[/\\]/iu.test(line) || line.slice(2).includes(":"))))
    return fail("photo_selection");
  return normalize(line);
}

/** Parse only the dedicated live input, without stat'ing or opening any path (even on success). */
export function selectPhoto(text: string, images: readonly Attachment[] = []): PhotoSelection {
  if (!photoRequest(text) || text.length > 8400 || images.length > 1) return fail("photo_selection");
  const body = text.replace(heading, "").replace(/\r\n/gu, "\n");
  if (unsafeDisplay.test(body) || !body.isWellFormed()) return fail("photo_selection");
  const lines = body.trim().split("\n");
  let source: Source;
  if (images.length) {
    const img = images[0];
    if (img?.type !== "image" || img.mimeType !== "image/png" || typeof img.data !== "string" ||
        !img.data.length || img.data.length > 4 * Math.ceil(MAX_BYTES / 3) || img.data.length % 4)
      return fail("photo_selection");
    source = {kind: "attachment", data: img.data};
  } else {
    source = {kind: "file", path: localFile(lines.shift()!.trim())};
  }
  // A second path / a path plus an attachment is not an instruction. Never choose between sources.
  if (lines.some(s => /^(?:[/\\]|[A-Z]:[/\\]|file:\/\/)/iu.test(s.trim()))) return fail("photo_selection");
  const instructions = lines.join("\n").trim();
  if (!instructions || Buffer.byteLength(instructions) > MAX_PROMPT) return fail("photo_selection");
  return {source, instructions};
}

/** Keep the exact complete pixel image that will be shown and attached; don't retain ancillary text/EXIF. */
export function reviewPhoto({source}: PhotoSelection) {
  if (source.kind === "file") return {label: source.path, ...readPhotoFile(source.path)};
  const bytes = Buffer.from(source.data, "base64");
  if (bytes.length > MAX_BYTES || bytes.toString("base64") !== source.data) return fail("invalid_png");
  const {width, height, preview} = inspectPng(bytes);
  return {label: "PNG adjunto en este envío", width, height, preview};
}
export function photoConsent(photo: ReturnType<typeof reviewPhoto>, instructions: string, sha256: string) {
  return `Foto: ${photo.label} (${photo.width} × ${photo.height})\nSHA-256 del PNG mostrado: ${sha256}\n\nCambios solicitados:\n${instructions}\n\nSe enviarán a OpenAI mediante Codex estas instrucciones y la foto completa, incluidas las personas que pidas quitar. Se pedirá conservar lo demás. El archivo original no se modifica. ¿Autorizar solo esta edición?`;
}
