import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface ProjectChoice {
  id: string;
  title: string;
  path: string;
}

export interface ProjectStatus {
  principal?: ProjectChoice;
  memory: "found" | "unbound" | "unavailable";
}

export interface DraftRequest {
  title: string;
  description: string;
}

export interface Publication {
  status: "linked" | "linked_scope_changed" | "partial" | "save_unconfirmed" | "not_applied";
  project?: ProjectChoice;
  effects?: { created: boolean; reserved: boolean; notesCreated: boolean };
}

// Domain-facing ports. The adapter retains backend fingerprints and rechecks
// ownership; the menu never constructs paths, identities or approval tokens.
export interface ProjectMenuPort {
  status(): Promise<ProjectStatus>;
  list(): Promise<ProjectChoice[]>;
  draft(input: DraftRequest): Promise<string | undefined>;
  preview(title: string, body: string): Promise<{ path: string; apply(): Promise<Publication> } | undefined>;
  bind(project: ProjectChoice): Promise<Publication>;
}

export interface SourcesMenuPort {
  status(): Promise<ProjectStatus>;
  list(): Promise<ProjectChoice[]>;
  selected(): Promise<readonly string[]>;
  apply(ids: readonly string[]): Promise<void>;
}

type Menu = Pick<ExtensionContext["ui"], "select" | "input" | "editor" | "confirm" | "notify">;
const template = "## Summary\n\n\n## Objective\n\n\n## Scope\n\n";
const choose = async <T>(ui: Menu, title: string, options: readonly { label: string; value: T }[]) => {
  const entries = new Map(options.map(({ label, value }, i) => [`${i + 1}. ${label}`, value]));
  const selected = await ui.select(title, [...entries.keys()]);
  return selected === undefined ? undefined : entries.get(selected);
};
const label = (p: ProjectChoice) => `${p.title} · ${p.path}`;

function effects(before: ProjectStatus, after: string): string {
  return [
    `Project: ${before.principal ? label(before.principal) : "sin vincular"} → ${after}`,
    before.memory === "found"
      ? "Memory: se asocia conservando su identidad y su historial."
      : "Memory: no se crea ahora; el primer guardado útil se asociará al Project.",
    "Knowledge: lectura y escritura en el Project principal, sujetas a los controles de Brain y Pi. Las fuentes adicionales siguen en solo lectura.",
  ].join("\n");
}

function report(ui: Menu, result: Publication) {
  switch (result.status) {
    case "linked": return ui.notify(`Carpeta vinculada${result.project ? ` a ${label(result.project)}` : ""}.`, "info");
    case "linked_scope_changed": return ui.notify(`Brain confirmó el vínculo${result.project ? ` a ${label(result.project)}` : ""}, pero cambió el alcance observado. Revisa antes de volver a escribir.`, "warning");
    case "partial": {
      const name = result.project ? `: ${label(result.project)}` : "";
      const progress = result.effects?.created ? `Project creado${name}.
No lo crees otra vez; selecciona la ficha existente solo después de revisar el estado.` :
        result.effects?.reserved ? `Carpeta reservada${name}; no hay ficha confirmada. No repitas la creación.` :
          result.effects?.notesCreated ? `Brain creó notas/ para el Project existente${name}.` : `Operación incompleta${name}.`;
      return ui.notify(`${progress}\nNo se confirmó el vínculo completo. Revisa el Project y la Memory antes de volver a escribir.`, "warning");
    }
    case "save_unconfirmed": return ui.notify("No se confirmó el resultado de la escritura. No reintentes: revisa primero el estado en Brain.", "warning");
    case "not_applied": return ui.notify("Brain no aplicó el vínculo. No se reintentó.", "warning");
  }
}

export async function projectMenu(ui: Menu, folderName: string, port: ProjectMenuPort) {
  const current = await port.status();
  if (current.memory === "unavailable") {
    ui.notify("Memory no está disponible para verificar el vínculo. No se harán cambios.", "warning");
    return;
  }
  const mode = await choose(ui, `Proyecto de esta carpeta: ${current.principal?.title ?? "sin vincular"}`, [
    { label: "Seleccionar un Project activo…", value: "select" },
    { label: "Crear un Project nuevo…", value: "create" },
  ] as const);
  if (mode === undefined) return;
  if (mode === "select") {
    const projects = await port.list();
    if (!projects.length) return ui.notify("No hay Projects activos para seleccionar.", "info");
    const project = await choose(ui, "Projects activos", projects.map(value => ({ label: label(value), value })));
    if (!project || !await ui.confirm("Vincular", effects(current, label(project)))) return;
    return report(ui, await port.bind(project));
  }
  const title = (await ui.input(`Nombre del Project · sugerido: ${folderName} (Enter para aceptarlo)`, folderName))?.trim();
  if (title === undefined || !(title || folderName)) return;
  const chosenTitle = title || folderName;
  const author = await choose(ui, "Ficha inicial del Project", [
    { label: "Generar borrador con el modelo activo (usa Memory e Historial si están disponibles)", value: "agent" },
    { label: "Redactar manualmente", value: "manual" },
  ] as const);
  if (author === undefined) return;
  let draft: string | undefined;
  if (author === "agent") {
    const description = await ui.input("Descripción breve opcional (se enviará al modelo con el contexto disponible)", "");
    if (description === undefined) return;
    draft = await port.draft({ title: chosenTitle, description: description.trim() });
    if (!draft) ui.notify("No se obtuvo un borrador con información suficiente. Puedes completar la ficha manualmente.", "warning");
  }
  const body = await ui.editor("Ficha del Project · contenido en español, encabezados en inglés", draft ?? template);
  if (body === undefined) return;
  const preview = await port.preview(chosenTitle, body);
  if (!preview) return;
  if (preview.path.split("/").at(-1) !== `${chosenTitle}.md`) {
    return ui.notify("Brain propuso un archivo que no coincide con el nombre del Project. No se creó nada. Comprueba que estés usando un Brain compatible.", "warning");
  }
  if (!await ui.confirm("Crear y vincular", effects(current, `${chosenTitle} · ${preview.path}`))) return;
  report(ui, await preview.apply());
}

export async function sourcesMenu(ui: Menu, port: SourcesMenuPort) {
  const { principal } = await port.status();
  if (!principal) return ui.notify("Vincula primero un Project principal con /ss-project.", "info");
  const projects = (await port.list()).filter(project => project.id !== principal.id);
  const initial = await port.selected();
  const selected = new Set(projects.filter(p => initial.includes(p.id)).map(p => p.id));
  while (true) {
    const action = await choose(ui, `Fuentes de conocimiento · Principal: ${principal.title} (fija)`, [
      ...projects.map(p => ({ label: `[${selected.has(p.id) ? "x" : " "}] ${label(p)} · solo lectura`, value: p.id })),
      { label: "Aplicar", value: "apply" },
      { label: "Restablecer", value: "reset" },
      { label: "Cancelar", value: "cancel" },
    ]);
    if (action === undefined || action === "cancel") return;
    if (action === "apply" || action === "reset") {
      const ids = action === "reset" ? [] : projects.filter(p => selected.has(p.id)).map(p => p.id);
      await port.apply(ids);
      ui.notify(ids.length ? `Fuentes adicionales activas: ${ids.length}.` : "Solo queda activa la fuente principal.", "info");
      return;
    }
    if (selected.has(action)) selected.delete(action); else selected.add(action);
  }
}
