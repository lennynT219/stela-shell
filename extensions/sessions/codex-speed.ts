import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hasCodexOAuth, readPiCodexSpeeds, sameCodexLogin, sameEffectiveCodexLogin } from "./codex-pi.ts";
import { directRoute, readDirectSpeeds, sameEffectiveLogin, sameLogin, type ReadCredential } from "./openai-speed.ts";
import { record, type Tier } from "./speed-tiers.ts";

const STANDARD = "Estándar";
type Choice = { session: string; provider: "openai" | "openai-codex"; model: string; tier: Tier; fingerprint: string };

// Pi replaces extension instances on /reload, but retains the same session manager.
// This one-use handoff is process-local, not session history, profile settings, or a grant for other chats.
const reloadKey = Symbol.for("stela-shell.speed-reload.v1");
const host = globalThis as typeof globalThis & { [reloadKey]?: WeakMap<object, { cwd: string; expiresAt: number; choice: Choice }> };
function reloadChoices() {
  if (!Object.hasOwn(host, reloadKey)) Object.defineProperty(host, reloadKey, { value: new WeakMap() });
  return host[reloadKey] instanceof WeakMap ? host[reloadKey] : undefined;
}

function nativeProvider(ctx: ExtensionContext) {
  if (hasCodexOAuth(ctx)) return "openai-codex";
  if (directRoute(ctx)) return "openai";
}

/** A speed choice is local to this chat and model, with a bounded recheck on /reload. */
export function registerSpeed(pi: ExtensionAPI, credential: ReadCredential, readCodex = readPiCodexSpeeds) {
  let choice: Choice | undefined;
  let pending: AbortController | undefined, running = false;
  const reset = () => { pending?.abort(); pending = undefined; choice = undefined; };
  const matches = (ctx: ExtensionContext, value: Choice) => ctx.mode === "tui" && value.session === ctx.sessionManager.getSessionId() &&
    value.model === ctx.model?.id && value.provider === nativeProvider(ctx);
  const active = (ctx: ExtensionContext) => choice && matches(ctx, choice) ? choice : undefined;
  const sameGrant = (ctx: ExtensionContext, value: Choice) =>
    (value.provider === "openai-codex" ? sameCodexLogin : sameLogin)(ctx, credential, value.fingerprint);
  const discover = (ctx: ExtensionContext, provider: Choice["provider"], signal: AbortSignal) =>
    (provider === "openai-codex" ? readCodex : readDirectSpeeds)(ctx, credential, signal);

  pi.on("session_shutdown", (event, ctx) => {
    if (ctx.mode === "tui") {
      const carry = reloadChoices(), selected = active(ctx);
      carry?.delete(ctx.sessionManager);
      if (event.reason === "reload" && selected) {
        carry?.set(ctx.sessionManager, { cwd: ctx.cwd, expiresAt: performance.now() + 60_000, choice: selected });
      }
    }
    reset(); running = false;
  });
  pi.on("session_start", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const carry = reloadChoices(), handoff = carry?.get(ctx.sessionManager);
    carry?.delete(ctx.sessionManager); // Never interpret persisted entries as a speed choice.
    if (event.reason !== "reload" || !handoff || handoff.cwd !== ctx.cwd || handoff.expiresAt <= performance.now()) return;
    const saved = handoff.choice;
    if (!matches(ctx, saved) || !sameGrant(ctx, saved)) return;
    const request = pending = new AbortController();
    const timer = setTimeout(() => request.abort(), 8000);
    try {
      const result = await new Promise<Awaited<ReturnType<typeof discover>>>(resolve => {
        request.signal.addEventListener("abort", () => resolve(undefined), { once: true });
        void discover(ctx, saved.provider, request.signal).then(resolve, () => resolve(undefined));
      });
      if (!request.signal.aborted && pending === request && !running && result?.fingerprint === saved.fingerprint &&
          result.tiers?.some(t => t.id === saved.tier.id && t.name === saved.tier.name) && matches(ctx, saved) && sameGrant(ctx, saved)) {
        choice = saved;
      }
    } finally {
      clearTimeout(timer);
      if (pending === request) pending = undefined;
    }
  });
  pi.on("model_select", () => reset());
  pi.on("agent_start", () => { running = true; pending?.abort(); });
  pi.on("agent_end", () => { running = false; });

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
        const discovery = await discover(ctx, provider, request.signal);
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
