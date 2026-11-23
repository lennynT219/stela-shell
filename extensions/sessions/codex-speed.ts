import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hasCodexOAuth, readPiCodexSpeeds, sameCodexLogin, sameEffectiveCodexLogin } from "./codex-pi.ts";
import { directRoute, readDirectSpeeds, sameEffectiveLogin, sameLogin, type ReadCredential } from "./openai-speed.ts";
import { record, type Tier } from "./speed-tiers.ts";

const STANDARD = "Estándar";

function nativeProvider(ctx: ExtensionContext) {
  if (hasCodexOAuth(ctx)) return "openai-codex";
  if (directRoute(ctx)) return "openai";
}

/** The choice is volatile, scoped to this TUI, its current session and its current physical model. */
export function registerSpeed(pi: ExtensionAPI, credential: ReadCredential, readCodex = readPiCodexSpeeds) {
  let choice: { session: string; provider: string; model: string; tier: Tier; fingerprint: string } | undefined;
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
        const fromCodex = provider === "openai-codex";
        const discovery = await (fromCodex ? readCodex : readDirectSpeeds)(ctx, credential, request.signal);
        const tiers = discovery?.tiers;
        if (!current()) return;
        const prior = active(ctx);
        if (prior && (!tiers || prior.fingerprint !== discovery?.fingerprint ||
            !tiers.some(t => t.id === prior.tier.id && t.name === prior.tier.name))) choice = undefined;
        const names = (tiers ?? []).map(t => t.name);
        const note = !tiers ? "Catálogo no disponible" : !tiers.length ? "Sin velocidad adicional anunciada" : "Mayor velocidad puede consumir más cuota";
        const pick = await ctx.ui.select(`Velocidad · ${active(ctx)?.tier.name ?? STANDARD} · ${note}`, [STANDARD, ...names], {signal: request.signal});
        if (!current() || !pick) return;
        const tier = tiers?.find(t => t.name === pick);
        if (pick === STANDARD) choice = undefined;
        else if (tier && discovery && (fromCodex ? sameCodexLogin : sameLogin)(ctx, credential, discovery.fingerprint)) {
          choice = { session, model, provider, tier, fingerprint: discovery.fingerprint };
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
    const verify = selected.provider === "openai-codex" ? sameEffectiveCodexLogin : sameEffectiveLogin;
    return verify(ctx, credential, selected.fingerprint).then(matches => {
      if (choice !== selected) return; // Another menu or model selection won during auth resolution.
      if (!matches || !running || active(ctx) !== selected) { choice = undefined; return; }
      return { ...body, service_tier: selected.tier.id };
    });
  });
  return (ctx: ExtensionContext) => active(ctx)?.tier.name.toLowerCase();
}
