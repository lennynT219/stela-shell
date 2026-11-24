/** Presentation vocabulary only. No tool registration, routing, permission or outcome is inferred from a color. */
export const FAMILIES = {
  // Icon and OKHSL hue only. Pi's active theme supplies the strength of the panels and lettering.
  memory: ["🧠", 295], knowledge: ["📚", 232], web: ["🌐", 202], sessions: ["💬", 158],
  tasks: ["🧩", 52], images: ["🖼", 337], files: ["📄", 235], terminal: [">_", 126],
  code: ["", 96], other: ["", 229],
} as const;
export type Family = keyof typeof FAMILIES;
export const TOOLS = {
  read: ["files", "Leer"], edit: ["files", "Editar"], write: ["files", "Escribir"], bash: ["terminal", "Ejecutar"],
  codemode: ["code", "Acciones"], ss_memory_read: ["memory", "Leer"], ss_memory_save: ["memory", "Guardar"],
  ss_knowledge_sources: ["knowledge", "Fuentes"], ss_knowledge_list: ["knowledge", "Listar"],
  ss_knowledge_read: ["knowledge", "Leer"], ss_knowledge_create: ["knowledge", "Crear"], ss_knowledge_update: ["knowledge", "Actualizar"],
  ss_knowledge_rename: ["knowledge", "Renombrar"],
  ss_web_search: ["web", "Buscar"], ss_web_read: ["web", "Leer"],
  ss_sessions_list: ["sessions", "Listar"], ss_sessions_send: ["sessions", "Enviar"],
  ss_tasks_delegate: ["tasks", "Delegar"], ss_tasks_cancel: ["tasks", "Cancelar"],
  ss_images_generate: ["images", "Generar"], ss_images_generate_with_references: ["images", "Generar con refs."],
  ss_images_edit: ["images", "Editar"], ss_images_save: ["images", "Guardar"],
} as const satisfies Record<string, readonly [Family, string]>;
export type Tool = keyof typeof TOOLS;
export const known = (s: unknown): s is Tool => typeof s === "string" && Object.hasOwn(TOOLS, s);
export const foldable = (s: string) => s === "read" || s === "ss_web_read" || s === "ss_web_search";
export type Level = "ok" | "pending" | "warn" | "error";
export interface Line { family: Family; verb: string; subject: string; level: Level; notice: string }

/** User-provided names, paths and terminal output are text, never terminal sequences or line breaks. */
export function short(v: unknown, max = 160): string {
  if (typeof v !== "string") return "";
  const s = v.slice(0, max * 4).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/gu, " ").trim();
  return (s.length > max || v.length > max * 4) ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
export const field = (v: unknown): Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
