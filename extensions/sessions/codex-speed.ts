import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { exchange, localCommand, type Command, type Conversation } from "./codex-stdio.ts";
import { directRoute, readDirectSpeeds, sameEffectiveLogin, sameLogin, type ReadCredential } from "./openai-speed.ts";
import { advertisedTiers, record, type Catalog, type Tier } from "./speed-tiers.ts";

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
      if (tiers) return undefined;
      tiers = advertisedTiers(row.serviceTiers);
      if (!tiers) return undefined;
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

function nativeProvider(ctx: ExtensionContext) {
  const m = ctx.model;
  if (m?.provider === "openai-codex" && m.api === "openai-codex-responses" &&
      m.baseUrl?.replace(/\/+$/, "") === "https://chatgpt.com/backend-api") return "openai-codex";
  if (directRoute(ctx)) return "openai";
}

/** The choice is volatile, scoped to this TUI, its current session and its current physical model. */
export function registerSpeed(pi: ExtensionAPI, credential: ReadCredential, readCodex = readSpeeds) {
  let choice: { session: string; provider: string; model: string; tier: Tier; fingerprint?: string } | undefined;
  let pending: AbortController | undefined, running = false;
  const reset = () => { pending?.abort(); pending = undefined; choice = undefined; };
  pi.on("session_shutdown", () => { reset(); running = false; });
  pi.on("model_select", () => reset());
  pi.on("agent_start", () => { running = true; pending?.abort(); });
  pi.on("agent_end", () => { running = false; });
  const active = (ctx: ExtensionContext) => choice && ctx.mode === "tui" && choice.session === ctx.sessionManager.getSessionId() &&
    choice.model === ctx.model?.id && choice.provider === nativeProvider(ctx) ? choice : undefined;

  pi.registerCommand("ss-speed", {
    description: "Elegir la velocidad del modelo actual en OpenAI con ChatGPT o Codex",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      if (args.trim()) { ctx.ui.notify("Usa /ss-speed y elige en el menú.", "info"); return; }
      const provider = nativeProvider(ctx), model = ctx.model?.id, session = ctx.sessionManager.getSessionId();
      if (!provider || !model) { ctx.ui.notify("Elige un modelo de OpenAI con login de ChatGPT o de OpenAI Codex para cambiar la velocidad.", "info"); return; }
      if (running || !ctx.isIdle()) { ctx.ui.notify("Espera a que termine el turno para cambiar la velocidad.", "info"); return; }
      pending?.abort(); const request = pending = new AbortController();
      const current = () => !request.signal.aborted && nativeProvider(ctx) === provider && ctx.model?.id === model && ctx.sessionManager.getSessionId() === session && !running;
      try {
        const direct = provider === "openai" ? await readDirectSpeeds(ctx, credential, request.signal) : undefined;
        const tiers = provider === "openai" ? direct?.tiers : await readCodex(model, request.signal);
        if (!current()) return;
        const prior = active(ctx);
        if (prior && ((provider === "openai" && (!tiers || prior.fingerprint !== direct?.fingerprint)) ||
            (tiers && !tiers.some(t => t.id === prior.tier.id && t.name === prior.tier.name)))) choice = undefined;
        const names = (tiers ?? []).map(t => t.name);
        const note = !tiers ? "Catálogo no disponible" : !tiers.length ? "Sin velocidad adicional anunciada" : "Mayor velocidad puede consumir más cuota";
        const pick = await ctx.ui.select(`Velocidad · ${active(ctx)?.tier.name ?? STANDARD} · ${note}`, [STANDARD, ...names], {signal: request.signal});
        if (!current() || !pick) return;
        const tier = tiers?.find(t => t.name === pick);
        if (pick === STANDARD) choice = undefined;
        else if (tier && (provider === "openai-codex" || (direct && sameLogin(ctx, credential, direct.fingerprint)))) {
          choice = { session, model, provider, tier, fingerprint: direct?.fingerprint };
        } else { choice = undefined; return; }
        ctx.ui.notify(`Velocidad solicitada: ${pick}.`, "info");
      } finally { if (pending === request) pending = undefined; }
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    const selected = active(ctx), body = event.payload;
    // Pi exposes the body, not an independent transport identity. Direct Responses need not include reasoning.
    if (!running || !selected || !record(body) || body.model !== selected.model || body.stream !== true || body.store !== false ||
        !Array.isArray(body.input) || (body.prompt_cache_key != null && body.prompt_cache_key !== selected.session) || body.service_tier != null) return;
    if (selected.provider === "openai-codex" && (!Array.isArray(body.include) || !body.include.includes("reasoning.encrypted_content"))) return;
    if (selected.provider === "openai") {
      return sameEffectiveLogin(ctx, credential, selected.fingerprint!).then(matches => {
        if (choice !== selected) return; // Another menu or model selection won during auth resolution.
        if (!matches || !running || active(ctx) !== selected) { choice = undefined; return; }
        return { ...body, service_tier: selected.tier.id };
      });
    }
    return { ...body, service_tier: selected.tier.id };
  });
  return (ctx: ExtensionContext) => active(ctx)?.tier.name.toLowerCase();
}
