import { field, known, short, TOOLS, type Line } from "./families.ts";

type Result = { content?: { type: string; text?: string }[]; details?: unknown; isError?: boolean };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const host = (s: unknown) => { try { return new URL(String(s)).hostname; } catch { return ""; } };
const human = (s: unknown) => typeof s === "string" && !/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/iu.test(s.trim()) ? short(s) : "";
export const peerName = (s: unknown) => human(s) || (s === "" ? "sesión sin nombre" : "nombre no disponible");
export function action(name: string, args: unknown): Line {
  const [family, verb] = known(name) ? TOOLS[name] : ["other" as const, short(name, 64) || "Llamada"];
  const a = field(args);
  const subject = family === "files" ? short(a.path) : family === "terminal" ? short(a.command) :
    name === "ss_web_search" ? short(a.query, 90) : name === "ss_web_read" ? short(host(a.url)) :
    name === "ss_knowledge_create" ? short(a.title) : name === "ss_tasks_delegate" ? short(a.label) :
    name === "ss_sessions_send" ? "→ nombre no disponible" : "";
  return { family, verb, subject, level: "ok", notice: "" };
}
const labels: Record<string, string> = {
  conflict: "Conflicto", denied: "Permiso denegado", invalid: "Datos no válidos", unavailable: "No disponible",
  not_found: "No se encontró", unbound: "Sin vínculo", unbound_or_unavailable: "Sin vínculo o no disponible",
  source_not_enabled: "Fuente no habilitada", cancelled: "Cancelada", pending: "Pendiente", manual_review: "Requiere revisión",
  partial: "Parcial", busy: "Ocupado", save_unconfirmed: "Guardado sin confirmar", write_paused: "Escritura pausada",
  scope_or_activity_changed: "Cambió el ámbito o la actividad", read_required: "Requiere lectura previa", list_required: "Requiere listado previo",
  HUMAN_APPROVAL_REQUIRED: "Requiere permiso", HUMAN_APPROVAL_DENIED: "Permiso denegado",
  DELIVERY_UNCONFIRMED: "Entrega sin confirmar", UNSUPPORTED_WORK_CONTEXT: "Destino incompatible", queued: "En cola", running: "En curso", cancelling: "Cancelación en curso", completed: "Terminada", failed: "Falló",
};
const named = (x: unknown) => typeof x === "string" && Object.hasOwn(labels,x) ? labels[x] : short(x,80);
export const NO_CODEMODE_DETAIL = "Detalle no disponible";

function scriptFailure(r: Result): string {
  // Pi supplies an envelope and diagnostic; arbitrary script output is not a status.
  const [header, diagnostic, ...rest] = r.content ?? [];
  if (header?.type !== "text" || !/^Script failed\nWall time [\d.]+ seconds\nOutput:\n$/u.test(header.text ?? "") || diagnostic?.type !== "text" || rest.length) return "El script falló";
  const message = diagnostic.text ?? "";
  if (/^Script error:\nScript aborted: [^\n]+\n\n(?:The script did not start\.|No tool calls were made\.)$/u.test(message)) return "Cancelado";
  if (/^Script error:\nScript timed out: Execution timed out after \d+ ms(?: while waiting for a free codemode worker)?\n\n(?:The script did not start\.|No tool calls were made\.)$/u.test(message)) return "Tiempo agotado";
  if (/^Script error:\nNo codemode worker became free within \d+ seconds\.[^\n]*\n\nThe script did not start\.$/u.test(message)) return "No se pudo iniciar";
  return "El script falló";
}

export function codemodeOutcome(row: Line, r: Result, partial: boolean, failed: boolean): Line {
  const calls = field(r.details).calls;
  if (!Array.isArray(calls)) return { ...row, subject: "", notice: partial ? "En curso" : NO_CODEMODE_DETAIL, level: partial ? "pending" : failed ? "error" : "ok" };
  if (calls.length > 0) return { ...row, subject: plural(calls.length,"acción","acciones"), notice: failed ? "Falló la ejecución" : row.notice };
  return { ...row, subject: "", notice: partial ? "En curso" : failed ? scriptFailure(r) : "Script completado" };
}

const textOf = (r: Result) => r.content?.find(c => c.type === "text")?.text ?? "";
const messageOf = (r: Result) => short(textOf(r).split("\n",1)[0],100);
const json = (r: Result) => { const s = textOf(r); if (s[0] === "{" && s.length <= 1024 * 1024) try { return field(JSON.parse(s)); } catch {} return {}; };
export const imageOutput = (r: Result) => r.content?.some(x => x.type === "image") === true;

/** Project only user-visible facts from results, not prose interpreted as completion, prompt text or private image paths. */
export function outcome(name: string, base: Line, r: Result, partial = false, error = false): Line {
  const v = { ...base }, d = field(r.details);
  const m = v.family === "memory" ? { ...json(r), ...d } : d;
  const status = short(m.status,64);
  if (name.startsWith("ss_knowledge_") && typeof d.title === "string") v.subject = short(d.title);
  if (name === "ss_sessions_send" && typeof d.peerName === "string") v.subject = `→ ${peerName(d.peerName)}`;
  const clipped = Boolean(d.truncated || field(d.truncation).truncated || d.fullOutputPath);
  if (partial) return { ...v, level: clipped ? "warn" : "pending", notice: clipped ? "En curso · Salida parcial" : "En curso" };
  if (error || r.isError || status === "error" || ["save_unconfirmed", "write_paused", "denied", "conflict", "manual_review"].includes(status)) {
    if (!v.subject && ["ss_knowledge_read","ss_knowledge_update","ss_knowledge_rename"].includes(name)) v.subject = "título no disponible";
    const exit = name === "bash" ? textOf(r).slice(-100).match(/Command exited with code (-?\d+)\s*$/)?.[1] : undefined;
    const reason = named(d.code) || (status && status !== "error" ? named(status) : "") || (exit ? `Salida ${exit}` : messageOf(r)) || "Error";
    const safeReason = v.family === "sessions" ? reason.replace(/\b(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/gi,"…") : reason;
    return { ...v, level: ["pending", "manual_review", "partial", "save_unconfirmed", "write_paused"].includes(status) || d.code === "HUMAN_APPROVAL_REQUIRED" ? "warn" : "error", notice: [safeReason, clipped ? "Parcial" : "", d.write_paused ? "Escritura pausada" : ""].filter(Boolean).join(" · ") };
  }
  switch (name) {
    case "ss_knowledge_list": {
      const n = d.noteCount ?? json(r).notes?.length;
      if (Number.isSafeInteger(n)) v.subject = plural(n,"nota","notas");
      break;
    }
    case "ss_knowledge_sources": {
      const x = d.additionalCount !== undefined ? d : json(r);
      const n = x.additionalCount ?? x.sources?.length;
      v.subject = [short(x.principalName ?? x.principal?.title), Number.isSafeInteger(n) && n > 0 ? `+${n} solo lectura` : ""].filter(Boolean).join(" · "); break;
    }
    case "ss_knowledge_create": case "ss_knowledge_read": case "ss_knowledge_update": case "ss_knowledge_rename":
      v.subject = short(d.title ?? json(r).title) || v.subject || "título no disponible";
      v.notice = status === "unchanged" ? "Sin cambios" : status === "updated" ? "Actualizada" : status === "renamed" ? "Renombrada" : status === "created" ? "Creada" : "";
      break;
    case "write": v.notice = "Escrito"; break;
    case "edit": v.notice = "Editado"; break;
    case "ss_sessions_list":
      if (Array.isArray(d.peers)) {
        v.subject = plural(d.peers.length,"sesión","sesiones");
        if ([d.self,...d.peers].some(p => [p?.name,p?.sessionId,p?.cwd].some(s => typeof s === "string" && s.endsWith("…[truncated]")))) { v.level = "warn"; v.notice = "Nombres o rutas parciales"; }
      }
      if (d.paused) { v.level = "warn"; v.notice = [v.notice,"Mensajes en pausa"].filter(Boolean).join(" · "); }
      break;
    case "ss_sessions_send": v.subject ||= `→ ${peerName(d.peerName)}`; if (status === "accepted") v.notice = "Aceptado para entrega"; break;
    case "ss_tasks_delegate": v.subject = short(d.label) || v.subject; v.notice = [d.duplicate ? "Ya delegada" : "", named(d.state)].filter(Boolean).join(" · "); break;
    case "ss_tasks_cancel": v.subject = short(d.label); v.notice = d.requested === true ? "Cancelación solicitada" : named(d.state) || "Sin nueva cancelación"; break;
    case "ss_web_search": case "ss_web_read": {
      if (Number.isSafeInteger(d.results)) v.notice = plural(d.results,"resultado","resultados");
      const warnings = json(r).warnings;
      if (Array.isArray(warnings)) {
        const codes = warnings.filter(w => typeof w === "string" && !w.startsWith("UNTRUSTED WEB EVIDENCE,"));
        if (codes.length) {
          v.level = "warn"; v.notice = [codes.some(w => w.startsWith("FRAGMENT_NOT_RESOLVED:")) ? "Fragmento no comprobado" : "Advertencias",v.notice].filter(Boolean).join(" · ");
        }
      }
      break;
    }
    case "ss_memory_read": case "ss_memory_save":
      v.subject = typeof m.revision === "string" || typeof m.revision === "number" ? `rev. ${short(String(m.revision),32)}` : "";
      if (status === "unbound") v.notice = "Sin vínculo";
      if (status === "saved" || status === "unchanged") v.notice = (status === "saved" ? "Guardada" : "Sin cambios") + (m.read_back === "confirmed" ? " · verificada" : " · relectura no confirmada");
      if (m.read_back && m.read_back !== "confirmed" || m.manual_approval_required || m.replacement_offer) { v.level = "warn"; v.notice ||= "Requiere revisión"; }
      break;
    case "ss_images_generate": case "ss_images_generate_with_references": case "ss_images_edit":
      if (status === "preview" && imageOutput(r)) {
        const number = textOf(r).match(/^Vista (\d{1,6}) ·/u)?.[1];
        v.subject = number ? `vista ${number}` : "vista previa"; v.notice = "Sin guardar";
      } else { v.level = "warn"; v.notice = "Sin imagen adjunta"; }
      break;
    case "ss_images_save": v.subject = short(d.relative); v.notice = status === "saved" ? "Guardada" : status === "already_saved" ? "Ya guardada" : status; break;
  }
  if (v.level === "ok" && (name === "read" && !r.content?.some(p => p.type === "text" || p.type === "image") || v.family === "web" && !["ok","partial"].includes(status))) {
    v.level = "warn"; v.notice = "Resultado no confirmado";
  }
  if (status === "partial" || clipped ||
      name === "read" && /\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/.test(textOf(r).slice(-120))) {
    v.level = "warn"; v.notice = ["Parcial", v.notice].filter(Boolean).join(" · ");
  }
  if (m.scope_changed || m.write_paused) { v.level = "warn"; v.notice = [v.notice || (status === "updated" || status === "created" ? "Publicada" : ""), m.scope_changed ? "Ámbito cambiado" : "", m.write_paused ? "Escritura pausada" : ""].filter(Boolean).join(" · "); }
  return v;
}
