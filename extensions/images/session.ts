import {fail, pngName, UUID} from "./files.ts";
export const GENERATE = "ss_images_generate", EDIT = "ss_images_edit", SAVE = "ss_images_save";
export interface Owner {
  session: string;
  project: string;
  directoryId: string;
  sessionFile: string|null
}
export interface Preview extends Owner {
  v: 1;
  status: "preview";
  thread: string;
  file: string;
  home: string;
  sha256: string;
  width: number;
  height: number;
  name: string
}
export interface Receipt extends Owner {
  v: 1;
  status: "saved";
  thread: string;
  sha256: string;
  relative: string
}
export interface BranchEntry {
  type: string;
  id: string;
  message?: any
}
export interface Choice {
  index: "current"|"last"|number;
  name?: string
}
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const ordinals =
    ["primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "septima", "octava", "novena", "decima"];
/** Only a complete, direct save request binds a target. Never infer approval from 'me gusta', a quoted example, tool arguments, or session replay. */
export function saveChoice(input: string): Choice|undefined {
  if (input.length > 320 || /[\r\n]/.test(input)) return;
  const match = /^(?:por favor,?\s+)?(?:gu[aá]rda(?:la|me)?|apruebo|save)\b(.*)$/iu.exec(
      input.trim().replace(/[.!]$/u, ""));
  if (!match) return;
  const parts = /^(.*?)(?:\b(?:como|as)\s+(.+))?$/iu.exec(match[1].trim());
  if (!parts) return;
  let target = fold(parts[1]).replace(/^(?:la |el |the )/u, "").trim();
  let index: Choice["index"];
  if (["", "esta", "esta imagen", "esta vista previa", "imagen", "it", "this", "this image"].includes(target))
    index = "current";
  else if (["ultima", "ultima imagen", "mas reciente", "latest", "last"].includes(target))
    index = "last";
  else {
    target = target.replace(/\s+(?:imagen|vista previa)$/u, "");
    const ordinal = ordinals.indexOf(target);
    const number = /^(?:(?:imagen|vista(?: previa)?|preview)\s*)?#?([1-9][0-9]{0,4})$/u.exec(target);
    if (ordinal < 0 && !number) return;
    index = ordinal >= 0 ? ordinal + 1 : Number(number![1]);
  }
  let name = parts[2]?.trim();
  if (name) {
    const quote = name[0];
    if (["`", "\"", "'"].includes(quote) && name.endsWith(quote)) name = name.slice(1, -1);
  }
  return {index, ...(name !== undefined ? {name} : {})};
}
export function imageRequest(s: string) {
  const v = fold(s).replace(/^[¿¡]/, "").replace(/^(?:por favor[, ]+|please )/, "");
  if (/^(?:dibuja(?:me)?|pinta(?:me)?|ilustra|draw|paint|illustrate)\s+\S/u.test(v)) return true;
  // This recognizes conversations for the optional editor offer, never permission to generate.
  return /^(?:genera(?:me)?|crea(?:me)?|haz(?:me)?|disena(?:me)?|quiero|quisiera|necesito|me gustaria|puedes (?:crear|generar|dibujar)|generate|create|make)\s+(?:(?:por favor|para mi|please)\s+)?(?:(?:un[ao]?|el|la|otra?|mi|an?|the|another|new)\s+)*(?:imagen|postal|portada|ilustracion|retrato|foto(?:grafia)?|cartel|logo(?:tipo)?|miniatura|dibujo|pintura|poster|image|picture|postcard|cover|thumbnail|painting|illustration|portrait|banner|infografia|infographic|boceto|sketch|viñeta|vineta|comic|collage|diagrama|diagram|mural|flyer|render)\b/u
      .test(v);
}
/** Never fill in arbitrary omitted text: a shorter argument may omit only a leading request verb/article.
 * In that case restoring the harmless prefix also preserves medium cues such as “Pinta”. */
export function completeDescription(raw: string, prompt: unknown): string|undefined {
  if (typeof prompt !== "string" || !prompt || prompt !== prompt.trim()) return;
  const full = raw.trim();
  if (prompt === full) return full;
  if (!full.endsWith(prompt)) return;
  const prefix = full.slice(0, -prompt.length);
  if (/\s$/u.test(prefix) &&
      /^(?:(?:por favor|please)[, ]+)?(?:genera(?:me)?|crea(?:me)?|dibuja(?:me)?|pinta(?:me)?|ilustra|draw|paint|illustrate|create|generate|make)(?:\s+(?:un[ao]?|el|la|an?|the))?$/u
          .test(fold(prefix).replace(/^[¿¡]/u, ""))) return full;
}
export function records(branch: BranchEntry[], owner: Owner) {
  const previews: Preview[] = [], saved = new Map<string, Receipt>();
  const seen = new Set<string>();
  for (const entry of branch) {
    const m = entry.message, d = m?.details;
    if (entry.type !== "message" || m?.role !== "toolResult" || m.isError || d?.v !== 1 ||
        d.session !== owner.session || d.project !== owner.project || d.sessionFile !== owner.sessionFile ||
        d.directoryId !== owner.directoryId || !UUID.test(d.thread) || typeof d.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(d.sha256))
      continue;
    if ((m.toolName === GENERATE || m.toolName === EDIT) && d.status === "preview" && !seen.has(d.thread) &&
        typeof d.home === "string" && typeof d.file === "string" && typeof d.name === "string" &&
        Number.isSafeInteger(d.width) && Number.isSafeInteger(d.height)) {
      seen.add(d.thread);
      previews.push(d as Preview);
    } else if (
        m.toolName === SAVE && d.status === "saved" && seen.has(d.thread) && typeof d.relative === "string" &&
        /^media[\\/]images[\\/][^\\/]+\.png$/.test(d.relative) &&
        previews.find(x => x.thread === d.thread)?.sha256 === d.sha256)
      saved.set(d.thread, d);
  }
  return {previews, saved};
}
export function select(previews: Preview[], choice: Choice, presented?: string) {
  if (!previews.length) return fail("no_preview");
  const current = choice.index === "current" && previews.length > 1;
  const i = current                    ? 1 + previews.findIndex(p => p.thread === presented) :
      typeof choice.index === "number" ? choice.index :
                                         previews.length;
  if (current && !i) return fail("ambiguous");
  const preview = previews[i - 1];
  if (!preview) return fail("no_preview");
  return {preview, name: pngName(choice.name ?? preview.name), index: i};
}
export function samePreview(a: Preview, b: Preview) {
  return a.thread === b.thread && a.sha256 === b.sha256 && a.file === b.file && a.home === b.home &&
      a.session === b.session && a.project === b.project;
}
