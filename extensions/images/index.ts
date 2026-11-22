import type {ExtensionAPI, ExtensionContext} from "@earendil-works/pi-coding-agent";
import {randomUUID} from "node:crypto";
import {realpathSync, statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {callRenderer, type MakeText} from "../presentation.ts";
import {editPhoto, generate, generateWithReferences, homePath, MAX_PROMPT, type EditPhoto, type Generate, type Generated, type GenerateWithReferences} from "./codex.ts";
import {fail, ImageError, readOriginal, saveOriginal, suggestedName, ensurePreviewStore} from "./files.ts";
import {offeredSubmission, planningRules, submissionBody, submittedPrompt, SUBMIT} from "./planning.ts";
import {PHOTO_HEADING, REFERENCE_HEADING, pastedImages, photoRequest, photoUsage, referenceRequest, referenceUsage, reviewImages, selectPhoto, selectReferences} from "./photo.ts";
import {EDIT, GENERATE, REFERENCE, SAVE, completeDescription, imageAction, imageRequest, mentionsSource, records, revisionChoice, revisionReply, samePreview, saveChoice, select, type BranchEntry, type Owner, type Preview, type Receipt} from "./session.ts";

const messages: Record<string, string> = {
  not_requested: "Se requiere una petición directa y actual para esta acción.",
  draft_needed: "Todavía estamos definiendo la imagen. Aclara lo que falte y espera a que el usuario pida generar. No se generó nada.",
  revision_ambiguous: "Hay varias vistas posibles. Indica el número de la vista que quieres corregir.",
  invalid_prompt:
      "Usa el prompt visual completo del envío actual (máximo 4096 bytes), sin perder restricciones. No añadas historial ni archivos.",
  reference_selection: referenceUsage,
  reference_rpc_attachment: "En RPC adjunta los PNG de referencia al prompt de este envío. No se abren rutas del equipo que ejecuta Pi.",
  reference_ui: "Envía las referencias desde la TUI o un cliente RPC. No se enviaron las referencias.",
  photo_selection: photoUsage,
  photo_rpc_attachment: "En RPC adjunta un único PNG a este envío; no se abren rutas del equipo que ejecuta Pi.",
  photo_unavailable: "No se pudo abrir el PNG elegido. Selecciona un archivo local normal, sin enlaces, y vuelve a enviar la solicitud.",
  edit_ui: "Envía la foto desde la TUI o un cliente RPC. No se envió la foto.",
  photo_cleanup: "No se pudo confirmar la limpieza del directorio temporal privado de los PNG seleccionados. No se reintentó.",
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
  no_png: "No se pudo identificar el PNG de este hilo.",
  no_png_missing: "El turno terminó sin indicar una ruta PNG reconocible del hilo. No se pudo confirmar si se creó un archivo.",
  no_png_multiple: "El turno indicó varias rutas PNG distintas del hilo. No se eligió un archivo ni se repitió el envío.",
  palette_needed: "La edición pide la paleta acordada. Usa sus valores hexadecimales conocidos en agreedPalette; si no se conocen, pregunta qué colores usar. No se envió la imagen.",
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
  generateWithReferences?: GenerateWithReferences;
  edit?: EditPhoto;
  env?: NodeJS.ProcessEnv;
  text?: MakeText
}
const toolFor = {plan: GENERATE, generate: GENERATE, edit: EDIT, reference: REFERENCE, save: SAVE} as const;
type Grant = {
  raw: string; leaf: string | null; mode: keyof typeof toolFor; ready: boolean; used: boolean;
  prompt?: string;
  photos?: Buffer[];
  contextual?: boolean;
  revision?: Preview;
  revisionPrompt?: string;
  pendingPalette?: string[];
  revisionProblem?: unknown;
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
  let planningReply = false, pendingRevision: {instruction: string; palette?: string[]}|undefined;
  const reset = () => { planningReply = false; pendingRevision = undefined; revoke() };
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
    const continuing = planningReply, correction = pendingRevision;
    reset();
    const pasted = ctx.mode === "tui" ? pastedImages(ev.text) : undefined;
    const attached = !!ev.images?.length, markedEdit = photoRequest(ev.text), markedRef = referenceRequest(ev.text, attached);
    // A single current selection beside an existing preview has no predetermined role.
    // Only its caption is exposed to Pi; the model chooses the operation, not the files.
    if (!markedEdit && !markedRef && (ev.images?.length === 1 || pasted?.paths.length === 1) && owner &&
        records(branch(ctx), owner).previews.length) {
      try {
        if (!owned(ctx) || !pi.getActiveTools().some(name => name === EDIT || name === REFERENCE) || !ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc") ||
            (ev.source !== "interactive" && ev.source !== "rpc") || ev.streamingBehavior) return fail("not_requested");
        if (pasted?.paths.length && (attached || ev.source !== "interactive" || ctx.mode !== "tui")) return fail("photo_selection");
        const caption = (pasted?.instructions ?? ev.text).trim();
        // Do not treat additional path lines as sources or forward file paths inside captions.
        if (!caption || /(?:^|[\s(\["'`@])(?:[\\/]|[a-z]:[\\/]|file:\/\/|~[\\/]|\.{1,2}[\\/])/imu.test(caption)) return fail("photo_selection");
        const selection = selectPhoto([PHOTO_HEADING, ...(pasted?.paths ?? []), caption].join("\n"), ev.images);
        const photos = reviewImages(selection).map(p => p.preview);
        const raw = `PNG actual seleccionado con una vista previa disponible (${randomUUID()}).\n${caption}`;
        const g: Grant = {raw, leaf: ctx.sessionManager.getLeafId(), mode: "edit", contextual: true,
          photos, prompt: caption, ready: false, used: false};
        try { g.revision = select(records(branch(ctx), owner).previews, revisionChoice(caption)).preview }
        catch (e) { g.revisionProblem = e }
        grant = g;
        return {action: "transform" as const, text: raw, images: []};
      } catch (e) {
        try { ctx.ui.notify(errorResult(e).content[0].text, "warning") } catch { /* consume the input */ }
        return {action: "handled" as const};
      }
    }
    const natural = (attached || pasted?.paths.length) && !markedEdit && !markedRef ? imageAction(pasted?.instructions ?? ev.text, true) : undefined;
    const edit = markedEdit || natural === "edit";
    if (edit || markedRef || natural === "generate") {
      // Consume the private input even on failure: no paths, reference pixels or private prompt in chat.
      const mode = edit ? "edit" : "reference", tool = toolFor[mode];
      try {
        if (!owned(ctx) || !pi.getActiveTools().includes(tool)) return fail("scope_changed");
        if ((ev.source !== "interactive" && ev.source !== "rpc") || ev.streamingBehavior) return fail("not_requested");
        if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return fail(edit ? "edit_ui" : "reference_ui");
        // RPC clients may review only bytes they supplied, never host files.
        if ((ev.source !== "interactive" || ctx.mode !== "tui") && !ev.images?.length)
          return fail(edit ? "photo_rpc_attachment" : "reference_rpc_attachment");
        if (natural && attached && pasted?.paths.length) return fail(edit ? "photo_selection" : "reference_selection");
        const submission = natural ? [edit ? PHOTO_HEADING : REFERENCE_HEADING, ...(pasted?.paths ?? []), pasted?.instructions ?? ev.text].join("\n") : ev.text;
        const selection = (edit ? selectPhoto : selectReferences)(submission, ev.images);
        const photos = reviewImages(selection).map(p => p.preview);
        const raw = `Solicitud local de ${edit ? "edición de foto" : "generación con referencias"} (${randomUUID()}). Abre ${tool} sin argumentos para procesar el envío actual.`;
        grant = {raw, leaf: ctx.sessionManager.getLeafId(), mode, photos, prompt: selection.instructions, ready: false, used: false};
        return {action: "transform" as const, text: raw, images: []};
      } catch (e) {
        try { ctx.ui.notify(errorResult(e).content[0].text, "warning") } catch { /* still consume the private input */ }
        return {action: "handled" as const};
      }
    }
    if (!owned(ctx) || !owner || !(ev.source === "interactive" || ev.source === "rpc") ||
        ev.streamingBehavior || ev.images?.length)
      return;
    const choice = saveChoice(ev.text), prompt = submittedPrompt(ev.text), action = imageAction(ev.text, false, continuing);
    const selector = revisionReply(ev.text);
    if (selector && !correction) return; // A standalone choice cannot start a new edit.
    const selectedReply = correction && selector;
    const g: Grant = {raw: ev.text, leaf: ctx.sessionManager.getLeafId(), mode: "plan", ready: false, used: false};
    const entries = branch(ctx), previews = records(entries, owner).previews;
    const afterLastUser = entries.slice(entries.findLastIndex(e => e.type === "message" && e.message?.role === "user") + 1);
    const shown = records(afterLastUser, owner).previews, presented = shown.length === 1 ? shown[0].thread : undefined;
    if (choice) {
      g.mode = "save";
      try { g.choice = select(previews, choice, presented) } catch (e) { g.problem = e }
    } else if (prompt || (action === "generate" && submissionBody(ev.text) === undefined && !mentionsSource(ev.text))) {
      g.mode = "generate";
      g.prompt = prompt;
    }
    // For a normal text turn the host binds a possible source, not an interpretation.
    // Explicit submissions and attachment markers cannot be repurposed as preview edits.
    if (!choice && submissionBody(ev.text) === undefined && previews.length && !attached && !pasted?.paths.length &&
        ev.text.trim() && !/^Solicitud local de /u.test(ev.text) &&
        !/\b(?:(?:foto|imagen) adjunta|attached (?:photo|image))\b/iu.test(ev.text)) {
      g.revisionPrompt = selectedReply ? correction!.instruction : ev.text.trim();
      if (selectedReply) g.pendingPalette = correction!.palette;
      try {
        const target = selectedReply || revisionChoice(ev.text);
        g.revision = select(previews, target).preview;
      } catch (e) {
        g.revisionProblem = e instanceof ImageError && e.message === "ambiguous" ? new ImageError("revision_ambiguous") : e;
      }
    }
    if (g.mode === "plan" && !continuing && !imageRequest(ev.text)) {
      if (!g.revisionPrompt) return;
      g.mode = "edit";
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
    if (!g || g !== grant || !g.ready || (tool !== toolFor[g.mode] && !(tool === EDIT && g.revisionPrompt) && !(tool === REFERENCE && g.contextual)))
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
    if (g?.mode !== "plan" || g.used || m.role !== "assistant" || m.stopReason !== "stop") return;
    try {
      check(ctx, g, GENERATE);
      const text = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      const offer = offeredSubmission(text, MAX_PROMPT);
      planningReply = !!text.trim();
      // RPC getEditorText() always returns an empty string. Leave RPC clients the visible copyable block.
      if (offer && !referenceRequest(offer, false) && ctx.mode === "tui" && ctx.hasUI && ctx.ui.getEditorText() === "") ctx.ui.setEditorText(offer);
    } catch { /* No owner / UI: the ordinary chat draft is still visible, nothing is submitted. */ }
  });
  pi.registerTool({
    name: GENERATE,
    label: "Generar imagen",
    description:
        `Generate one PNG preview with Codex and the local ChatGPT login on a direct request to generate. Prepare a self-contained visual prompt from the user's agreed choices. A legacy «${SUBMIT}» submission supplies its own text. Do not forward history or attach files. Does not save in the project.`,
    promptSnippet: "Help design an image in chat; generate directly when the user requests it",
    promptGuidelines: planningRules,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {prompt: {type: "string", minLength: 1, maxLength: MAX_PROMPT, description: "For ordinary generation requests. Omit when the current submission already contains the explicit final prompt."}}
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
        if (g?.mode !== "generate" || g.used) return fail("not_requested");
        if (running) return fail("busy");
        const arg = (args as {prompt?: unknown}).prompt;
        const prompt = g.prompt ? (arg === undefined || arg === g.raw.trim() ? g.prompt : completeDescription(g.prompt, arg)) :
          typeof arg === "string" ? arg.trim() : undefined;
        if (!prompt || Buffer.byteLength(prompt) > MAX_PROMPT || !prompt.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]|\r(?!\n)/u.test(prompt))
          return fail("invalid_prompt");
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
  // The current explicit submission grants a single dispatch; edit and reference generation retain distinct inputs.
  for (const mode of ["edit", "reference"] as const) {
    const edit = mode === "edit", tool = toolFor[mode], label = edit ? "Editar foto" : "Generar con referencias";
    pi.registerTool({
      name: tool, label,
      description: edit ?
        "Send one explicitly selected PNG and its edit instructions from the current direct submission to OpenAI via Codex, then return one edited preview. No model-provided paths, attachments, instructions or approvals. No project copy." :
        "Generate one NEW PNG using 1–3 explicitly selected PNG visual references and a prompt from the current direct submission to OpenAI via Codex. Not a photo edit. No model arguments, earlier files or project copy.",
      promptSnippet: edit ? "Edit the PNG explicitly submitted in this request with Codex" :
        "Generate a new image with Codex from visual references explicitly submitted in this request",
      promptGuidelines: edit ? [
        "For ‘PNG actual seleccionado con una vista previa disponible’, interpret the caption and conversation to decide the roles. To modify the preview using the current PNG as visual guidance, call ss_images_edit with base:'preview'. To modify the supplied PNG itself, use base:'attachment'. To create an entirely new composition from the supplied PNG use ss_images_generate_with_references instead. Never ask to attach the existing preview or provide a header. Do not call an image tool for discussion, feedback, a bare attachment or advice; you cannot see the selected PNG. If roles are genuinely unclear, clarify; a later turn requiring an external reference needs only that PNG reattached. Never infer authorization from an old upload.",
        `For a photo edit, use the current attached PNG or a PNG pasted by Pi in the TUI. For another local PNG, the TUI also accepts ‘${PHOTO_HEADING}’ with an absolute PNG path on its own line. RPC requires an attachment. Never open a path with another tool.`,
        "A direct edit instruction with a current attached or pasted PNG is routed automatically; don't ask for a heading. On the local edit marker, call ss_images_edit with no arguments. Interpret the current user's intent in the context of the preview, not by matching words or an imperative form. Call the edit tool only when they want an actual visual change now. Respond conversationally to feedback, hypothetical questions, advice requests or unrelated messages; if intent is genuinely unclear, clarify rather than dispatch. Do not ask for a rephrase when the change is understood. When the requested change uses previously agreed colors, supply their known hex values in agreedPalette; clarify unknown colors instead of guessing. Otherwise use no arguments. For a preview correction, use the newest preview on the active branch without asking which one, unless the user explicitly selects another. An invalid or conflicting explicit selection is not permission to substitute the newest preview. Submitting the request authorizes sending that picture and edit instructions to OpenAI via Codex. Never resend an ordinary earlier attachment or generate a substitute. Saving is separate."
      ] : [
        `For a NEW image inspired by references (not an edit), use the current attached or pasted PNGs. In the TUI ‘${REFERENCE_HEADING}’ with 1–3 current absolute PNG paths is also supported. If a necessary reference is missing, request it instead of generating from text alone. Never open paths, reuse files from history, or send attachments with ss_images_generate.`,
        `On a local request marked for ${REFERENCE}, call it directly with no arguments. Submitting that marked request authorizes sending the full reference set and prompt to OpenAI via Codex, without a second confirmation. Previous uploads or ordinary chat replies are insufficient. No text-only or edit fallback; saving the output is separate.`
      ],
      parameters: {type: "object", additionalProperties: false, properties: edit ? {base: {type: "string", enum: ["preview", "attachment"], description: "Only for a current contextual PNG selection; identifies which image to edit."}, agreedPalette: {type: "array", minItems: 1, maxItems: 8, items: {type: "string", pattern: "^#[0-9a-fA-F]{6}$"}}} : {}} as never,
      exposure: "model-only", // Private source images are never tool results.
      annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true},
      renderCall: callRenderer(tool, label, deps.text),
      async execute(_id, args, signal, onUpdate, ctx) {
        const g = grant, deadline = AbortSignal.timeout(7 * 60_000);
        let op: AbortController|undefined;
        try {
          check(ctx, g, tool, signal);
          if (!g || g.used) return fail("not_requested");
          const base = (args as {base?: unknown}).base;
          if (g.contextual && edit && base !== "preview" && base !== "attachment") return fail("not_requested");
          const usePreview = edit && (g.contextual ? base === "preview" : !!g.revisionPrompt);
          const instruction = (edit && g.revisionPrompt) || g.prompt;
          if (Object.keys(args).some(k => !(edit && g.contextual && k === "base") && !(usePreview && k === "agreedPalette"))) return fail("not_requested");
          const supplied = (args as {agreedPalette?: unknown}).agreedPalette;
          const palette = supplied === undefined ? g.pendingPalette : supplied;
          if (palette !== undefined && (!Array.isArray(palette) || !palette.length || palette.length > 8 || !palette.every(c => typeof c === "string" && /^#[\da-f]{6}$/iu.test(c)))) return fail("palette_needed");
          if (usePreview && g.revisionProblem) {
            g.used = true;
            if (!g.contextual && instruction && g.revisionProblem instanceof ImageError && ["revision_ambiguous", "no_preview"].includes(g.revisionProblem.message))
              pendingRevision = {instruction, palette: palette === undefined ? undefined : [...palette as string[]]};
            throw g.revisionProblem;
          }
          if ((!g.photos && !g.revision) || !instruction) return fail("not_requested");
          if (running) return fail("busy");
          g.used = true;
          if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc"))
            return fail(edit ? "edit_ui" : "reference_ui");
          running = op = new AbortController();
          const combined = AbortSignal.any([op.signal, deadline, ...(signal ? [signal] : [])]);
          const checkCurrent = () => check(ctx, g, tool, combined);
          const scope = owner!, home = previewHome(scope), prompt = palette ? `${instruction}\nPaleta acordada: ${(palette as string[]).join(", ")}.` : instruction;
          if (Buffer.byteLength(prompt) > MAX_PROMPT) return fail("invalid_prompt");
          let photos = g.photos;
          g.photos = undefined;
          const guide = usePreview && g.contextual ? photos?.[0] : undefined;
          if (usePreview) {
            const p = g.revision;
            if (!p || (g.contextual && !guide)) return fail("no_preview");
            if (!records(branch(ctx), scope).previews.some(v => samePreview(v, p))) return fail("scope_changed");
            if (p.home !== home) return fail("source_changed");
            const png = readOriginal(home, p.thread, p.file);
            if (png.sha256 !== p.sha256 || png.width !== p.width || png.height !== p.height) return fail("source_changed");
            photos = [png.preview];
          }
          if (!photos?.length) return fail("not_requested");
          onUpdate?.({details: {status: edit ? "editing" : "generating"}, content: [block(edit ? "Editando la foto enviada mediante Codex…" : "Generando una imagen nueva con las referencias enviadas mediante Codex…")]});
          checkCurrent();
          const request = {prompt, home, project: scope.project, signal: combined, checkCurrent};
          const result = edit ? await (deps.edit ?? editPhoto)({...request, photo: photos[0], ...(guide ? {guide} : {})}) :
            await (deps.generateWithReferences ?? generateWithReferences)({...request, references: photos});
          checkCurrent();
          return previewResult(ctx, scope, home, result, edit ? "foto-editada.png" : "imagen-con-referencias.png");
        } catch (e) {
          if (e instanceof ImageError && e.message === "photo_cleanup") return errorResult(e);
          return errorResult(deadline.aborted ? new ImageError("deadline") : e);
        } finally {
          if (op && op === running) running = undefined;
        }
      }
    });
  }
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
