const groups = [
  ["Web", ["ss_web_search", "ss_web_read"]],
  ["Imágenes", ["ss_images_generate", "ss_images_save"]],
  ["Memoria", ["ss_memory_read", "ss_memory_save"]],
  ["Conocimiento", ["ss_knowledge_list", "ss_knowledge_read"]],
  ["Codemode", ["codemode"]],
] as const;

/** Local Pi tool selection only. A mark says nothing about availability of an external service. */
export function capabilityLines(active: readonly string[]): string[] {
  const names = new Set(active);
  return groups.map(([label, tools]) => `  ${tools.every(name => names.has(name)) ? "✓ " : "  "}${label}`);
}
