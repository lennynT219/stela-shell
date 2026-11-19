import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reserveProjectAssociation } from "../project-association.ts";
import { stringify, uuid, type ObjectValue, type Value } from "../memory/protocol.ts";
import { resolveScope } from "./client.ts";
import { choice, projectClient, record } from "./project-client.ts";
import { draftProject } from "./project-draft.ts";
import { projectMenu, sourcesMenu, type ProjectChoice, type ProjectStatus, type Publication } from "./project-menu.ts";
import { sourcesPreference } from "./sources.ts";
import { basename } from "node:path";

const LIMIT = 4 * 1024 * 1024;
const equal = (a: Value, b: Value) => stringify(a, LIMIT) === stringify(b, LIMIT);
function need(condition: unknown): asserts condition {
  if (!condition) throw new Error("Project scope or receipt unavailable");
}
function dialogs(ui: ExtensionContext["ui"], current: () => boolean, signal: AbortSignal) {
  const good = () => !signal.aborted && current();
  return {
    select: (title: string, values: string[]) => good() ? ui.select(title, values, { signal }) : Promise.resolve(undefined),
    input: (title: string, value?: string) => good() ? ui.input(title, value, { signal }) : Promise.resolve(undefined),
    editor: (title: string, value?: string) => good() ? ui.editor(title, value) : Promise.resolve(undefined),
    confirm: (title: string, message: string) => good() ? ui.confirm(title, message, { signal }) : Promise.resolve(false),
    notify: ui.notify.bind(ui),
  };
}

export function visibleProjects(result: ObjectValue): ProjectChoice[] {
  if (result.status !== "listed" || !Array.isArray(result.projects)) throw new Error("Project catalog unavailable");
  return result.projects.map(choice);
}

export interface MenuHooks {
  acquire(ctx: ExtensionCommandContext): { signal: AbortSignal; valid(): boolean; release(): void } | undefined;
  changed(uncertain: boolean): void;
  writesPaused(): boolean;
  profile(): Promise<string>;
}

export function registerProjectCommands(pi: ExtensionAPI, env: NodeJS.ProcessEnv, hooks: MenuHooks) {
  const owned = (name: string, description: string, run: (ctx: ExtensionCommandContext, client: ReturnType<typeof projectClient>, signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    pi.registerCommand(name, { description, async handler(_args, ctx) {
      if (!ctx.hasUI || !ctx.isProjectTrusted()) {
        if (ctx.hasUI) ctx.ui.notify("Este menú requiere una sesión interactiva con la carpeta aprobada en Pi.", "warning");
        return;
      }
      const claim = hooks.acquire(ctx);
      if (!claim) { ctx.ui.notify("Espera a que termine el trabajo activo antes de abrir este menú.", "warning"); return; }
      try {
        const client = projectClient(ctx.cwd, env);
        const current = () => claim.valid() && ctx.isIdle() && !ctx.hasPendingMessages() && client.valid();
        need(current());
        await run(ctx, client, AbortSignal.any([claim.signal, ...(ctx.signal ? [ctx.signal] : [])]), current);
      } catch { if (claim.valid()) ctx.ui.notify("No se pudo completar la operación. Verifica el ámbito o la compatibilidad de Brain. No hubo reintento automático.", "warning"); }
      finally { claim.release(); }
    } });
  };

  owned("ss-project", "Seleccionar o crear el Project principal de esta carpeta", async (ctx, brain, signal, current) => {
    need(current() && !hooks.writesPaused());
    const reservation = reserveProjectAssociation(ctx, brain.authority);
    need(reservation);
    let outcome: "not_applied" | "bound" | "uncertain" = "not_applied";
    const canRead = () => current() && reservation.valid() && pi.getActiveTools().includes("ss_memory_read");
    const canWrite = () => canRead() && pi.getActiveTools().includes("ss_memory_save") && !hooks.writesPaused();
    try {
      need(canWrite());
      const statusReply = await brain.call("status", {}, signal);
      need(canRead() && ["unbound", "found"].includes(String(statusReply.status)) && record(statusReply.expected) && record(statusReply.expected.memory));
      const expected = statusReply.expected, memory = expected.memory as ObjectValue;
      const principal = statusReply.principal === null ? undefined : choice(statusReply.principal);
      const status: ProjectStatus = { principal, memory: memory.status === "found" ? "found" : memory.status === "unbound" ? "unbound" : "unavailable" };
      const write = async (operation: "bind" | "create_and_bind", args: ObjectValue, selected: ProjectChoice): Promise<Publication> => {
        if (!canWrite() || signal.aborted || outcome !== "not_applied") return { status: "not_applied" };
        try {
          // This bool comes only after the exact preview/selection was confirmed in the user UI.
          outcome = "uncertain";
          const r = await brain.call(operation, { ...args, expected, human_approved: true }, signal);
          if (r.status === "bound") {
            const actual = choice(r.project);
            if (actual.id !== selected.id) return { status: "save_unconfirmed" };
            if (!canWrite() || signal.aborted || actual.path !== selected.path || actual.title !== selected.title)
              return { status: "linked_scope_changed", project: actual };
            outcome = "bound";
            return { status: "linked", project: actual };
          }
          if (r.status === "partial") return { status: "partial", project: choice(r.project),
            effects: { created: r.project_created === true, reserved: r.project_reserved === true, notesCreated: r.notes_created === true } };
          if (r.status === "save_unconfirmed") return { status: "save_unconfirmed" };
          outcome = "not_applied";
          return { status: "not_applied" };
        } catch { return { status: outcome === "uncertain" ? "save_unconfirmed" : "not_applied" }; }
      };
      await projectMenu(dialogs(ctx.ui, canRead, signal), basename(ctx.cwd), {
        status: async () => status,
        list: async () => { need(canRead()); return visibleProjects(await brain.call("list", {}, signal)); },
        async draft(input) {
          if (!canRead() || signal.aborted) return;
          const r = await brain.call("draft_context", {}, signal);
          if (!canRead() || signal.aborted) return;
          // Refuse to generate from a changed baseline; the operator may start a new command.
          if (r.status === "found") need(equal(r.memory, memory));
          try { return await draftProject(ctx, input, r.status === "found" ? r : undefined, AbortSignal.any([signal, AbortSignal.timeout(60_000)])); }
          catch { return undefined; }
        },
        async preview(title, body) {
          need(canWrite() && !signal.aborted);
          const r = await brain.call("preview_create", { title, body }, signal);
          need(canWrite() && !signal.aborted);
          if (r.status === "invalid") {
            ctx.ui.notify(r.reason === "INVALID_PROJECT_FILENAME"
              ? "El título no se puede usar como nombre de archivo. Elige un título válido y vuelve a abrir /ss-project."
              : "Brain rechazó la vista previa. Revisa el título y los encabezados de la ficha.", "warning");
            return;
          }
          need(r.status === "preview" && record(r.preview) && equal(r.expected, expected));
          const preview = r.preview;
          const selected = choice({ project_id: preview.project_id, path: preview.path, title: preview.title });
          return { path: selected.path, apply: () => write("create_and_bind", { preview }, selected) };
        },
        async bind(selected) {
          if (!canWrite() || signal.aborted) return { status: "not_applied" };
          const active = visibleProjects(await brain.call("list", {}, signal));
          if (!active.some(p => p.id === selected.id && p.path === selected.path && p.title === selected.title)) return { status: "not_applied" };
          return write("bind", { project_id: selected.id,
            expected_project: { project_id: selected.id, title: selected.title, path: selected.path } }, selected);
        },
      });
    } finally {
      reservation.finish(outcome);
      if (outcome !== "not_applied") hooks.changed(outcome === "uncertain");
    }
  });

  owned("ss-knowledge", "Activar, desactivar o restablecer fuentes adicionales de Knowledge", async (ctx, brain, signal, current) => {
    const canRead = () => current() && pi.getActiveTools().includes("ss_knowledge_list");
    need(canRead());
    const scope = resolveScope(ctx.cwd, env);
    const listed = await scope.call("list", {}, signal);
    if (listed.status === "unbound") { ctx.ui.notify("Vincula primero un Project principal con /ss-project.", "info"); return; }
    need(canRead() && scope.valid() && listed.status === "listed" && uuid(listed.project_id));
    const catalog = visibleProjects(await brain.call("list", {}, signal));
    const principal = catalog.find(p => p.id === listed.project_id);
    need(principal && canRead() && scope.valid());
    const preference = sourcesPreference(await hooks.profile(), ctx.cwd, principal.id, brain.authority.vaultScope);
    await sourcesMenu(dialogs(ctx.ui, () => canRead() && scope.valid(), signal), {
      status: async () => ({ principal, memory: "unavailable" }),
      list: async () => catalog,
      selected: async () => preference.ids,
      async apply(ids) {
        need(canRead() && scope.valid() && !signal.aborted);
        const latest = await scope.call("list", {}, signal);
        need(latest.status === "listed" && latest.project_id === principal.id && canRead() && scope.valid() && !signal.aborted);
        const active = visibleProjects(await brain.call("list", {}, signal));
        need(canRead() && scope.valid() && !signal.aborted && active.some(p => p.id === principal.id) && ids.every(id => active.some(p => p.id === id)));
        preference.commit(ids);
        hooks.changed(false);
      },
    });
  });
}
