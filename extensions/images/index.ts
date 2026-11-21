import type {ExtensionAPI, ExtensionContext} from "@earendil-works/pi-coding-agent";
import {createHash, randomUUID} from "node:crypto";
import {realpathSync, statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {setImmediate as nextUiTurn} from "node:timers/promises";
import {callRenderer, type MakeText} from "../presentation.ts";
import {editPhoto, generate, homePath, MAX_PROMPT, type EditPhoto, type Generate, type Generated} from "./codex.ts";
import {fail, ImageError, readOriginal, saveOriginal, suggestedName, ensurePreviewStore} from "./files.ts";
import {offeredSubmission, planningRules, submittedPrompt, SUBMIT} from "./planning.ts";
import {PHOTO_HEADING, photoConsent, photoRequest, photoUsage, reviewPhoto, selectPhoto, type PhotoSelection} from "./photo.ts";
import {EDIT, GENERATE, SAVE, completeDescription, imageRequest, records, samePreview, saveChoice, select, type BranchEntry, type Owner, type Preview, type Receipt} from "./session.ts";

const messages: Record<string, string> = {
  not_requested: "Se requiere una petición directa y actual para esta acción.",
  draft_needed: `Todavía estamos definiendo la imagen. Pregunta por lo que falte, muestra un prompt completo y espera a que el usuario lo envíe con «${SUBMIT}». No se generó nada.`,
  invalid_prompt:
      "Usa el prompt visual completo del envío actual (máximo 4096 bytes), sin perder restricciones. No añadas historial ni archivos.",
  photo_selection: photoUsage,
  photo_rpc_attachment: "En RPC adjunta un único PNG a este envío; no se abren rutas del equipo que ejecuta Pi.",
  photo_unavailable: "No se pudo abrir el PNG elegido. Selecciona un archivo local normal, sin enlaces, y vuelve a enviar la solicitud.",
  edit_ui: "Editar foto necesita la confirmación de la TUI o de un cliente RPC. No se envió la foto.",
  edit_declined: "No autorizaste esta edición. No se envió la foto a Codex.",
  photo_cleanup: "No se pudo confirmar la limpieza del directorio temporal privado de esta edición. No se reintentó.",
  save_order: "Para aprobar un PNG indica, por ejemplo, «guarda la segunda como portada.png».",
  ambiguous:
      "Hay varias vistas previas. Indica el número, por ejemplo «guarda la vista 2», o «guarda la última».",
  no_preview: "La vista indicada no está en esta rama de la conversación.",
  invalid_name:
      "El nombre debe ser un nombre de archivo PNG sin carpeta, con letras, números, espacios, guiones o guiones bajos.",
  cancelled: "Operación cancelada; no se volverá a generar la imagen.",
  deadline: "Se agotó el plazo de la operación de imágenes. No se hizo otra petición.",
  busy: "Ya hay una operación de imágenes en curso.",
  login_required:
      "Inicia sesión en Codex con ChatGPT y vuelve a pedir la imagen. Sin CLI global, puedes usar el lanzador del paquete (README de Imágenes). No introduzcas claves en el chat.",
  runtime_missing: "No se encontró el ejecutable de la dependencia de Codex para esta plataforma.",
  configuration:
      "No se pudo aplicar el perfil restringido de imágenes de Codex. No se generó nada. Revisa las incompatibilidades en extensions/images/README.md.",
  quota: "Codex informó de un límite de uso. No se reintentó ni se usó la API de pago.",
  generation_failed: "Codex no pudo completar la generación. No se reintentó.",
  incomplete: "No se recibió la confirmación de fin de turno de Codex.",
  unexpected_result:
      "Codex realizó una operación no prevista o devolvió una respuesta no reconocida. No se aceptó el resultado.",
  no_png: "Codex no devolvió una ruta inequívoca a un PNG de este hilo.",
  invalid_png: "El archivo no es un PNG estático compatible o excede los límites de tamaño.",
  source_changed: "El PNG ya no coincide con la vista previa. No se copió ni se regeneró.",
  source_unavailable: "No se pudo abrir el PNG original de esta vista previa. No se copió ni se regeneró.",
  unsafe_directory: "No se admiten directorios redirigidos o sustituidos.",
  unsafe_workspace:
      "Codex necesita su almacenamiento y una carpeta temporal fuera del proyecto para crear la vista previa.",
  name_taken: "No se encontró un nombre disponible.",
  save_uncertain:
      "La copia llegó a publicarse, pero el directorio cambió. Comprueba el destino antes de volver a guardar.",
  save_failed:
      "No se pudo publicar la copia sin sobrescribir. Revisa el acceso y el soporte de enlaces físicos en media/images/.",
  scope_changed: "Cambió la sesión, la rama, la carpeta o la activación de la herramienta.",
};
const block = (text: string) => ({type: "text" as const, text});
function errorResult(e: unknown) {
  const code = e instanceof ImageError && Object.hasOwn(messages, e.message) ? e.message : "scope_changed";
  return {isError: true, details: {status: "error", code}, content: [block(messages[code])]};
}
interface Dependencies {
  generate?: Generate;
  edit?: EditPhoto;
  env?: NodeJS.ProcessEnv;
  text?: MakeText
}
type Grant = {
  raw: string; leaf: string | null; mode: "plan" | "generate" | "edit" | "save"; ready: boolean; used: boolean;
  prompt?: string;
  photo?: PhotoSelection;
  choice?: ReturnType<typeof select>;
  problem?: unknown
};
function directoryId(path: string) {
  const st = statSync(path, {bigint: true});
  return `${st.dev}:${st.ino}`;
}
function literalUser(m: any, raw: string) {
  return m?.role === "user" &&
      (m.content === raw ||
       (Array.isArray(m.content) && m.content.length === 1 && m.content[0].type === "text" &&
        m.content[0].text === raw));
}

export function registerImages(pi: ExtensionAPI, deps: Dependencies = {}) {
  const env = deps.env ?? process.env;
  if (env.STELA_SUBAGENT_CHILD) return;
  let manager: ExtensionContext["sessionManager"]|undefined, owner: Owner|undefined, grant: Grant|undefined,
      running: AbortController|undefined;
  const revoke = () => {
    grant = undefined;
    running?.abort();
  };
  // Carries only permission to OFFER an editable draft on the next conversational answer, never its text or a generation grant.
  let planningReply = false;
  const reset = () => { planningReply = false; revoke() };
  const open = (_e: unknown, ctx: ExtensionContext) => {
    reset();
    manager = undefined;
    owner = undefined;
    try {
      if (!isAbsolute(ctx.cwd) || realpathSync(ctx.cwd) !== realpathSync(ctx.sessionManager.getCwd())) return;
      owner = {
        session: ctx.sessionManager.getSessionId(),
        project: realpathSync(ctx.cwd),
        directoryId: directoryId(ctx.cwd),
        sessionFile: ctx.sessionManager.getSessionFile() ?? null
      };
      manager = ctx.sessionManager;
    } catch { /* No eligible session working directory. */
    }
  };
  const branch = (ctx: ExtensionContext) => ctx.sessionManager.getBranch() as BranchEntry[];
  const owned = (ctx: ExtensionContext) => {
    try {
      return !!owner && manager === ctx.sessionManager && owner.session === manager.getSessionId() &&
          owner.sessionFile === (manager.getSessionFile() ?? null) &&
          realpathSync(ctx.cwd) === owner.project && directoryId(ctx.cwd) === owner.directoryId;
    } catch {
      return false;
    }
  };
  pi.on("session_start", open);
  pi.on("session_tree", open);
  pi.on("session_shutdown", () => {
    reset();
    owner = undefined;
    manager = undefined;
  });
  for (const event
           of ["session_before_switch", "session_before_fork", "session_before_tree",
               "session_before_compact"] as const)
    pi.on(event, reset);
  pi.on("agent_settled", revoke);
  pi.on("input", (ev, ctx) => {
    const continuing = planningReply;
    reset();
    if (photoRequest(ev.text)) {
      // Do not pass the input photo, its path or instructions to the chat model (including on rejection).
      try {
        if (!owned(ctx) || !pi.getActiveTools().includes(EDIT)) return fail("scope_changed");
        if ((ev.source !== "interactive" && ev.source !== "rpc") || ev.streamingBehavior) return fail("not_requested");
        if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return fail("edit_ui");
        // An RPC client can review only bytes it supplied, not use a partial UI update to read a host file.
        if ((ev.source !== "interactive" || ctx.mode !== "tui") && ev.images?.length !== 1) return fail("photo_rpc_attachment");
        const photo = selectPhoto(ev.text, ev.images);
        const raw = `Solicitud local de edición de foto (${randomUUID()}). Abre ss_images_edit sin argumentos para revisar el envío.`;
        grant = {raw, leaf: ctx.sessionManager.getLeafId(), mode: "edit", photo, ready: false, used: false};
        return {action: "transform" as const, text: raw, images: []};
      } catch (e) {
        try { ctx.ui.notify(errorResult(e).content[0].text, "warning") } catch { /* still consume the private input */ }
        return {action: "handled" as const};
      }
    }
    if (!owned(ctx) || !owner || !(ev.source === "interactive" || ev.source === "rpc") ||
        ev.streamingBehavior || ev.images?.length)
      return;
    const choice = saveChoice(ev.text), prompt = submittedPrompt(ev.text);
    if (!choice && !prompt && !continuing && !imageRequest(ev.text)) return;
    const g: Grant = {
      raw: ev.text,
      leaf: ctx.sessionManager.getLeafId(),
      mode: choice ? "save" : prompt ? "generate" : "plan",
      prompt,
      ready: false,
      used: false
    };
    if (choice) {
      try {
        const entries = branch(ctx), previews = records(entries, owner).previews;
        const afterLastUser =
            entries.slice(entries.findLastIndex(e => e.type === "message" && e.message?.role === "user") + 1);
        const shown = records(afterLastUser, owner).previews;
        g.choice = select(previews, choice, shown.length === 1 ? shown[0].thread : undefined);
      } catch (e) {
        g.problem = e;
      }
    }
    grant = g;
  });
  pi.on("before_agent_start", (ev, ctx) => {
    if (grant && owned(ctx) && ev.messageType === "user" && !ev.images?.length && ev.prompt === grant.raw)
      grant.ready = true;
    else
      reset();
  });
  function check(ctx: ExtensionContext, g: Grant|undefined, tool: string, signal?: AbortSignal) {
    if (signal?.aborted) return fail("cancelled");
    if (!owned(ctx) || !pi.getActiveTools().includes(tool)) return fail("scope_changed");
    if (!g || g !== grant || !g.ready || (tool === SAVE) !== (g.mode === "save") || (tool === EDIT) !== (g.mode === "edit"))
      return fail(tool === SAVE ? "save_order" : "not_requested");
    const entries = branch(ctx), start = g.leaf === null ? -1 : entries.findIndex(e => e.id === g.leaf);
    if (g.leaf !== null && start < 0) return fail("scope_changed");
    const last = entries.slice(start + 1).findLast(e => e.type === "message" && e.message?.role === "user");
    if (!literalUser(last?.message, g.raw)) return fail("not_requested");
  }
  function previewHome(scope: Owner) {
    let home: string;
    try { home = realpathSync(homePath(env)) } catch { return fail("login_required") }
    ensurePreviewStore(scope.project, home);
    return home;
  }
  function previewResult(ctx: ExtensionContext, scope: Owner, home: string, {thread, file}: Generated, name: string) {
    const png = readOriginal(home, thread, file), prev = records(branch(ctx), scope).previews;
    if (prev.some(p => p.thread === thread)) return fail("unexpected_result");
    const d: Preview = {...scope, v: 1, status: "preview", thread, file, home, name,
      sha256: png.sha256, width: png.width, height: png.height};
    const n = prev.length + 1;
    return {details: d, content: [
      block(`Vista ${n} · ${d.width} × ${d.height} · PNG: ${png.path}\nNo se ha guardado en el proyecto. Para aprobar: «guarda la vista ${n}».`),
      {type: "image" as const, mimeType: "image/png", data: png.preview.toString("base64")}
    ]};
  }
  pi.on("message_end", (ev, ctx) => {
    const g = grant, m = ev.message;
    if (g?.mode !== "plan" || m.role !== "assistant" || m.stopReason !== "stop") return;
    try {
      check(ctx, g, GENERATE);
      const text = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      const offer = offeredSubmission(text, MAX_PROMPT);
      planningReply = !!offer || /[?？]/u.test(text);
      // RPC getEditorText() always returns an empty string. Leave RPC clients the visible copyable block.
      if (offer && ctx.mode === "tui" && ctx.hasUI && ctx.ui.getEditorText() === "") ctx.ui.setEditorText(offer);
    } catch { /* No owner / UI: the ordinary chat draft is still visible, nothing is submitted. */ }
  });
  pi.registerTool({
    name: GENERATE,
    label: "Generar imagen",
    description:
        `Generate one PNG preview with Codex and the local ChatGPT login, only after the user submits the visual prompt with «${SUBMIT}». Ordinary image ideas are for collaborative prompt-writing in chat instead. Supply the complete visual prompt verbatim from the current submission; no history or attachments. Does not save in the project.`,
    promptSnippet: "Help draft an image prompt in chat, then generate one preview from the user's final submission",
    promptGuidelines: planningRules,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {prompt: {type: "string", minLength: 1, maxLength: MAX_PROMPT}}
    } as never,
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true},
    renderCall: callRenderer(GENERATE, "Generar imagen", deps.text),
    async execute(_id, args, signal, onUpdate, ctx) {
      const g = grant;
      let op: AbortController|undefined;
      const deadline = AbortSignal.timeout(7 * 60_000);
      try {
        check(ctx, g, GENERATE, signal);
        if (g?.mode === "plan") return fail("draft_needed");
        if (g?.mode !== "generate" || !g.prompt || g.used) return fail("not_requested");
        if (running) return fail("busy");
        const arg = (args as {prompt?: unknown}).prompt;
        const prompt = arg === g.raw.trim() ? g.prompt : completeDescription(g.prompt, arg);
        if (!prompt || Buffer.byteLength(prompt) > MAX_PROMPT) return fail("invalid_prompt");
        g.used = true;
        running = op = new AbortController();
        const combined = AbortSignal.any([op.signal, deadline, ...(signal ? [signal] : [])]);
        const scope = owner!, home = previewHome(scope);
        onUpdate?.(
            {content: [block("Generando una vista previa con Codex…")], details: {status: "generating"}});
        const result = await (deps.generate ?? generate)({prompt, home, project: scope.project, signal: combined});
        check(ctx, g, GENERATE, combined);
        return previewResult(ctx, scope, home, result, suggestedName(prompt));
      } catch (e) {
        return errorResult(deadline.aborted ? new ImageError("deadline") : e);
      } finally {
        if (op && op === running) running = undefined;
      }
    },
  });
  pi.registerTool({
    name: EDIT,
    label: "Editar foto",
    description: "Review one locally selected PNG, ask for permission to send the complete photo and the exact edit instructions to OpenAI via Codex, then return one edited preview. The current direct submission supplies both; no model-provided paths, attachments, instructions or approvals. No project copy.",
    promptSnippet: "Review one selected photo and ask before sending it to Codex for editing",
    promptGuidelines: [
      `For edits of an existing photo (not text-to-image), show the user how to submit ‘${PHOTO_HEADING}’ followed in the TUI by one absolute PNG path on its own line and their edit instructions. In RPC they must attach one PNG instead of a path. Never open or resend a photo with another tool or use a path from history.`,
      "On a local photo-edit request marked for ss_images_edit, call ss_images_edit directly with no arguments. The host shows the full source and instructions and asks the user before every transfer. A chat reply or previous upload is not consent. Do not generate a substitute. Saving the resulting preview is separate."
    ],
    parameters: {type: "object", additionalProperties: false, properties: {}} as never,
    exposure: "model-only", // The input review is a local UI update, never a nested tool result.
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true},
    renderCall: callRenderer(EDIT, "Editar foto", deps.text),
    async execute(_id, args, signal, onUpdate, ctx) {
      const g = grant, deadline = AbortSignal.timeout(7 * 60_000);
      let op: AbortController|undefined;
      try {
        check(ctx, g, EDIT, signal);
        if (!g?.photo || g.used || Object.keys(args).length) return fail("not_requested");
        if (running) return fail("busy");
        g.used = true;
        if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return fail("edit_ui");
        running = op = new AbortController();
        const combined = AbortSignal.any([op.signal, deadline, ...(signal ? [signal] : [])]);
        const checkCurrent = () => check(ctx, g, EDIT, combined);
        const scope = owner!, home = previewHome(scope), prompt = g.photo.instructions;
        const photo = reviewPhoto(g.photo);
        g.photo = undefined;
        const sha256 = createHash("sha256").update(photo.preview).digest("hex");
        onUpdate?.({details: {status: "review", sha256}, content: [block(`Foto seleccionada: ${photo.label}`),
          {type: "image", mimeType: "image/png", data: photo.preview.toString("base64")}]});
        // Pi queues partial results; its callback is void, not a delivery receipt. Let the host render,
        // and identify the exact reviewed PNG in the dialog even on a client without inline images.
        await nextUiTurn();
        checkCurrent();
        const consent = await ctx.ui.confirm("¿Enviar esta foto a OpenAI?", photoConsent(photo, prompt, sha256), {signal: combined});
        checkCurrent();
        if (consent !== true) return fail("edit_declined");
        onUpdate?.({details: {status: "editing"}, content: [block("Editando la foto con Codex…")]});
        const result = await (deps.edit ?? editPhoto)({prompt, photo: photo.preview, home,
          project: scope.project, signal: combined, checkCurrent});
        checkCurrent();
        return previewResult(ctx, scope, home, result, "foto-editada.png");
      } catch (e) {
        if (e instanceof ImageError && e.message === "photo_cleanup") return errorResult(e);
        return errorResult(deadline.aborted ? new ImageError("deadline") : e);
      } finally {
        if (op && op === running) running = undefined;
      }
    }
  });
  pi.registerTool({
    name: SAVE,
    label: "Guardar imagen",
    description:
        "Save the exact previously previewed PNG explicitly approved by the current user, under media/images/ in this session’s project. Target and optional filename come from that live approval, not model arguments. No generation or overwrite.",
    promptSnippet: "Save the preview explicitly approved by the user",
    promptGuidelines: [
      "Use ss_images_save with no arguments when the user approves a preview, including after reopening this conversation. If unclear ask which numbered preview to save. Never use another tool to copy an unapproved or rejected result."
    ],
    parameters: {type: "object", additionalProperties: false, properties: {}} as never,
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
    renderCall: callRenderer(SAVE, "Guardar imagen", deps.text),
    async execute(_id, args, signal, _update, ctx) {
      try {
        const g = grant;
        check(ctx, g, SAVE, signal);
        if (!g || g.used || Object.keys(args).length) return fail("save_order");
        g.used = true;
        if (g.problem) throw g.problem;
        if (!g.choice) return fail("save_order");
        const scope = owner!, {preview: p, name} = g.choice, {previews, saved} = records(branch(ctx), scope);
        if (!previews.some(v => samePreview(v, p))) return fail("scope_changed");
        const prior = saved.get(p.thread);
        if (prior)
          return {
            content: [block(`Esta vista ya se guardó como ${prior.relative}. No se creó otra copia.`)],
            details: {status: "already_saved", relative: prior.relative}
          };
        let home: string;
        try {
          home = realpathSync(homePath(env));
        } catch {
          return fail("source_unavailable");
        }
        if (home !== p.home) return fail("source_changed");
        const png = readOriginal(home, p.thread, p.file);
        if (png.sha256 !== p.sha256 || png.width !== p.width || png.height !== p.height)
          return fail("source_changed");
        const relative = saveOriginal(scope.project, name, png.bytes, () => check(ctx, g, SAVE, signal));
        const d: Receipt = {...scope, v: 1, status: "saved", thread: p.thread, sha256: p.sha256, relative};
        return {details: d, content: [block(`Guardada: ${relative}`)]};
      } catch (e) {
        return errorResult(e);
      }
    },
  });
}
export default async function images(pi: ExtensionAPI) {
  if (process.env.STELA_SUBAGENT_CHILD) return;
  const {Text} = await import("@earendil-works/pi-tui");
  registerImages(pi, {text: t => new Text(t, 0, 0)});
}
