import { action, imageOutput, outcome } from "./summary.ts";
import { field, foldable, known, short, type Line } from "./families.ts";

interface Fact { id: string; name: string; subject: string; notice: string; level: Line["level"]; image: boolean }
interface Slot { name: string; initial: Line; fact?: Fact }
// The existing Pi display record for this very row; used only while rendering expanded detail, never persisted here.
export interface BatchLine extends Line { record?: { name: string; args?: string; error?: string; durationMs?: number; cost?: number } }
const LIMIT = 256;
/** Keep only short display metadata. No script output, arguments object, note body, prompt, PNG or model call. */
export class Batches {
  private active = new Map<string, Map<string, Slot>>();
  reset() { this.active.clear(); }
  start(id: string, name: string, args: unknown, parent?: string) {
    if (!parent) {
      if (name === "codemode" && this.active.size < 32) this.active.set(id, new Map());
    } else {
      const batch = this.active.get(parent);
      if (batch && batch.size < LIMIT && known(name)) batch.set(id, { name, initial: action(name,args) });
    }
  }
  end(id: string, name: string, result: any, isError: boolean, parent?: string) {
    if (!parent) { this.active.delete(id); return; }
    const slot = this.active.get(parent)?.get(id);
    if (!slot || name !== slot.name) return;
    const row = outcome(name,slot.initial,result,false,isError);
    // Pi already keeps its own clipped error record. Never persist arbitrary error output or a shell command here.
    const meta = field(result.details);
    const rawError = (isError || result.isError) && !meta.code && !meta.status;
    const notice = rawError && !(name === "bash" && /^Salida -?\d+(?: · Parcial)?$/.test(row.notice))
      ? (meta.truncated || meta.truncation?.truncated ? "Error · Parcial" : "") : row.notice;
    slot.fact = { id, name, subject: name === "bash" ? "" : row.subject, level: row.level, notice, image: imageOutput(result) };
  }
  facts(id: string): Fact[] { return [...(this.active.get(id)?.values() ?? [])].flatMap(s => s.fact ? [s.fact] : []); }
}
function preview(raw: unknown) {
  if (typeof raw !== "string" || !raw.startsWith("{") || raw.length > 4096) return {};
  try { return field(JSON.parse(raw)); } catch { return {}; } // Pi's argument previews may be clipped. Never parse script source instead.
}

/** Every attempted child remains represented. Only adjacent, positively verified successful reads can fold together. */
export function batchLines(details: unknown, live: readonly Fact[], expanded: boolean, parentImage?: boolean): BatchLine[] {
  const d = field(details), facts = new Map<string,Fact>();
  const recorded = field(d.ssBlocks).v === 1 && Array.isArray(d.ssBlocks.facts) ? d.ssBlocks.facts.slice(0,LIMIT) : [];
  for (const f of [...recorded,...live]) if (f && typeof f.id === "string" && known(f.name) && ["ok","pending","warn","error"].includes(f.level)) facts.set(f.id,f);
  const rows: BatchLine[] = [];
  let group = "", count = 1;
  for (const c of Array.isArray(d.calls) ? d.calls : []) {
    if (!c || typeof c.name !== "string") continue;
    const row = action(c.name,preview(c.args));
    const f = typeof c.id === "string" && !c.id.endsWith("/?") ? facts.get(c.id) : undefined;
    const fact = f?.name === c.name ? f : undefined;
    if (fact) { row.subject = short(fact.subject) || row.subject; row.notice = short(fact.notice); row.level = fact.level; }
    if (c.status === "error" || c.status === "cancelled") {
      if (row.level !== "warn") row.level = "error";
      row.notice ||= c.status === "cancelled" ? "Cancelada" : short(c.error,100) || "Error";
    } else if (c.status === "running") { row.level = "pending"; row.notice = "En curso"; }
    else if (!fact) { row.notice = c.status === "ok" ? "Sin detalle del resultado" : "Resultado no confirmado"; row.level = "warn"; }
    if (fact?.image && c.status === "ok") {
      if (parentImage === false) row.level = "warn";
      row.notice = [row.notice, parentImage === false ? "Imagen no mostrada en la salida" : "Imagen devuelta"].filter(Boolean).join(" · ");
    }
    if (!row.subject && c.status !== "running" && ["ss_knowledge_read","ss_knowledge_update","ss_knowledge_create"].includes(c.name)) row.subject = "título no disponible";
    const canFold = !expanded && c.status === "ok" && row.level === "ok" && fact && !fact.image && foldable(c.name);
    if (canFold && group === c.name) {
      count++; const leader = rows[rows.length-1]; leader.subject = `×${count}`; leader.notice = "";
    } else { group = canFold ? c.name : ""; count = 1; rows.push(expanded ? { ...row, record: c } : row); }
  }
  return rows;
}
