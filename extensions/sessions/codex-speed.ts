import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { exchange, localCommand, record, type Command, type Conversation } from "./codex-stdio.ts";

type Tier = { id: string; name: "Fast" | "Ultrafast" };
type Catalog = Tier[] | undefined; // []: no advertised option; undefined: no usable receipt
const STANDARD = "Estándar";

/** Use the selectable, visible model itself, never its marketing name, a prefix or a list of known models. */
function* catalog(model: string): Conversation<Catalog> {
  const cursors = new Set<string>();
  let cursor: string | undefined, tiers: Tier[] | undefined;
  for (let page = 0; page < 32; page++) {
    const { result } = yield { method: "model/list", params: { modelProvider: "openai", includeHidden: false, limit: 50, ...(cursor ? {cursor} : {}) } };
    if (!record(result) || !Array.isArray(result.data)) return undefined;
    for (const row of result.data) {
      if (!record(row) || row.hidden !== false || row.model !== model) continue;
      const advertised = row.serviceTiers ?? [];
      if (tiers || !Array.isArray(advertised)) return undefined;
      tiers = [];
      for (const t of advertised) {
        if (!record(t) || typeof t.id !== "string" || typeof t.name !== "string") continue;
        const name = t.name.toLowerCase();
        if (name !== "fast" && name !== "ultrafast") continue;
        if (!/^[a-z][a-z0-9_-]{0,47}$/.test(t.id) || ["default", "auto", "flex"].includes(t.id)) continue;
        const label = name === "fast" ? "Fast" : "Ultrafast";
        if (tiers.some(existing => existing.id === t.id || existing.name === label)) return undefined;
        tiers.push({ id: t.id, name: label });
      }
    }
    if (result.nextCursor == null) return tiers ?? [];
    if (typeof result.nextCursor !== "string" || !result.nextCursor || result.nextCursor.length > 4096 || cursors.has(result.nextCursor)) return undefined;
    cursor = result.nextCursor; cursors.add(cursor);
  }
}

export function querySpeeds(cmd: Command, model: string, signal: AbortSignal): Promise<Catalog> {
  return exchange<Catalog>(cmd, signal, "stela-shell-speed", catalog(model), undefined);
}
async function readSpeeds(model: string, signal: AbortSignal): Promise<Catalog> {
  try {
    const cmd = await localCommand();
    return cmd ? await querySpeeds(cmd, model, signal) : undefined;
  } catch { return undefined; }
}

function nativeModel(ctx: ExtensionContext) {
  const m = ctx.model;
  return m?.provider === "openai-codex" && m.api === "openai-codex-responses" &&
    m.baseUrl?.replace(/\/+$/, "") === "https://chatgpt.com/backend-api" ? m.id : undefined;
}

/** The choice is volatile, scoped to this TUI, its current session and its current physical model. */
export function registerCodexSpeed(pi: ExtensionAPI, read = readSpeeds) {
  let choice: { session: string; model: string; tier: Tier } | undefined;
  let pending: AbortController | undefined, running = false;
  const reset = () => { pending?.abort(); pending = undefined; choice = undefined; };
  pi.on("session_shutdown", () => { reset(); running = false; });
  pi.on("model_select", () => reset());
  pi.on("agent_start", () => { running = true; pending?.abort(); });
  pi.on("agent_end", () => { running = false; });
  const active = (ctx: ExtensionContext) => choice && ctx.mode === "tui" && choice.session === ctx.sessionManager.getSessionId() &&
    choice.model === nativeModel(ctx) ? choice.tier : undefined;

  pi.registerCommand("ss-speed", {
    description: "Elegir la velocidad de Codex para el modelo actual",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      if (args.trim()) { ctx.ui.notify("Usa /ss-speed y elige en el menú.", "info"); return; }
      const model = nativeModel(ctx), session = ctx.sessionManager.getSessionId();
      if (!model) { ctx.ui.notify("La velocidad solo se puede elegir con un modelo de OpenAI Codex.", "info"); return; }
      if (running || !ctx.isIdle()) { ctx.ui.notify("Espera a que termine el turno para cambiar la velocidad.", "info"); return; }
      pending?.abort(); const request = pending = new AbortController();
      const current = () => !request.signal.aborted && nativeModel(ctx) === model && ctx.sessionManager.getSessionId() === session && !running;
      try {
        const tiers = await read(model, request.signal);
        if (!current()) return;
        const prior = active(ctx);
        if (tiers && prior && !tiers.some(t => t.id === prior.id && t.name === prior.name)) choice = undefined;
        const names = (tiers ?? []).map(t => t.name);
        const note = !tiers ? "Catálogo no disponible" : !tiers.length ? "Sin velocidad adicional anunciada" : "Mayor velocidad puede consumir más cuota";
        const pick = await ctx.ui.select(`Velocidad · ${active(ctx)?.name ?? STANDARD} · ${note}`, [STANDARD, ...names], {signal: request.signal});
        if (!current() || !pick) return;
        const tier = tiers?.find(t => t.name === pick);
        if (pick === STANDARD) choice = undefined;
        else if (tier) choice = { session, model, tier };
        if (pick === STANDARD || tier) ctx.ui.notify(`Velocidad solicitada: ${pick}.`, "info");
      } finally { if (pending === request) pending = undefined; }
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    const tier = active(ctx), body = event.payload;
    // Pi's hook exposes the wire body, not the transport model. Match the selected native route,
    // current run and Codex chat payload; don't overwrite a tier supplied by another integration.
    if (!running || !tier || !record(body) || body.model !== nativeModel(ctx) || body.stream !== true || body.store !== false ||
        !Array.isArray(body.input) || !Array.isArray(body.include) || !body.include.includes("reasoning.encrypted_content") ||
        (body.prompt_cache_key != null && body.prompt_cache_key !== ctx.sessionManager.getSessionId()) || body.service_tier != null) return;
    return { ...body, service_tier: tier.id };
  });
  return (ctx: ExtensionContext) => active(ctx)?.name.toLowerCase();
}
