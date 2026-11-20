/** Fixed local diagnostics; never render arbitrary backend text or host paths. */
const DIAGNOSTICS: Record<string, { label: string; message: string }> = {
  ACTIVITY_REQUIRED: { label: "requiere actividad autorizada", message: "Memory necesita una entrada humana/RPC o trabajo PRIMARY autenticado de SS en esta activación; no se inició Brain." },
  ACTIVITY_CHECK_FAILED: { label: "actividad no verificable", message: "No se pudo verificar la actividad PRIMARY con su receptor activo. No se usó el historial como autorización." },
  AGENTIC_ACTIVITY_EXPIRED: { label: "actividad agéntica no vigente", message: "La actividad PRIMARY que habilitó Memory expiró o dejó de pertenecer al contexto activo. No se reintentó ni se simuló una entrada humana." },
  OWNER_CLOSED: { label: "propietario cerrado", message: "El propietario de Memory está cerrado; esta operación no puede usarlo." },
  OWNER_CHANGED: { label: "propietario cambiado", message: "La operación ya no pertenece al propietario actual de Memory." },
  INPUT_CHANGED: { label: "actividad cambiada", message: "Una actividad posterior invalidó esta operación de Memory." },
  READ_DISABLED: { label: "lectura desactivada", message: "La lectura de Memory no está habilitada por las herramientas o permisos actuales." },
  WRITE_DISABLED: { label: "guardado desactivado", message: "El guardado de Memory no está habilitado por las herramientas o permisos actuales." },
  ENVIRONMENT_CHANGED: { label: "entorno cambiado", message: "Cambió la selección del ejecutable o el entorno autorizado. No se volvió a resolver ni reparar automáticamente." },
  SCOPE_CHANGED: { label: "contexto cambiado", message: "Cambió la configuración de alcance autorizada de Memory. No se adoptó el nuevo contexto automáticamente." },
  CONFIGURATION_CHANGED: { label: "configuración cambiada", message: "Cambió la configuración observada de Brain. El propietario anterior no puede adoptarla automáticamente." },
  SCOPE_CHECK_FAILED: { label: "contexto no verificable", message: "No se pudo verificar que el contexto autorizado de Memory siga vigente." },
  EXECUTABLE_NOT_FOUND: { label: "Brain no encontrado", message: "Esta activación no pudo resolver Brain con su selección y entorno. No se instaló ni cambió la configuración." },
  EDIT_NOT_FOUND: { label: "texto no encontrado", message: "El texto original no aparece en la sección indicada. No se aplicó ninguna edición." },
  EDIT_AMBIGUOUS: { label: "texto ambiguo", message: "El texto original aparece más de una vez en esa sección. Usa un fragmento único. No se aplicó ninguna edición." },
  EDITS_OVERLAP: { label: "ediciones solapadas", message: "Las ediciones se solapan en el contenido original. Combínalas en una sola. No se aplicó ninguna edición." },
  UNCLOSED_HTML: { label: "HTML sin cerrar", message: "El documento contiene HTML sin cerrar. Usa código en línea o escapa los marcadores literales; no se reintentó el guardado." },
};
export function localDiagnostic(code: unknown) {
  return typeof code === "string" && Object.hasOwn(DIAGNOSTICS, code) ? DIAGNOSTICS[code] : undefined;
}
