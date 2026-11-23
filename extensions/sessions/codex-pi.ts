import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { directTiers, readBody, stamp, type ReadCredential } from "./openai-speed.ts";
import { record, type Catalog } from "./speed-tiers.ts";

const provider = "openai-codex";
const base = "https://chatgpt.com/backend-api";
// Catalog protocol version, matching the Codex build pinned in this project; no CLI is started.
const endpoints = { models: `${base}/codex/models?client_version=0.171.0`, usage: `${base}/wham/usage` };
const nativeBase = (url: string | undefined) => url?.replace(/\/+$/, "") === base;

export function codexRoute(ctx: ExtensionContext) {
  const m = ctx.model, registry = ctx.modelRegistry;
  return m?.provider === provider && m.api === "openai-codex-responses" && nativeBase(m.baseUrl) &&
    !registry.getRegisteredNativeProvider(provider) && !registry.getRegisteredProviderConfig(provider);
}

function storedLogin(read: ReadCredential) {
  const c = read(provider);
  if (!record(c) || c.type !== "oauth" || typeof c.access !== "string" || !c.access || c.access.length > 32_768 ||
      typeof c.expires !== "number" || !Number.isFinite(c.expires) || c.expires <= Date.now()) return;
  try {
    const parts = c.access.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const id = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || (c.accountId != null && c.accountId !== id)) return;
    return { token: c.access, id };
  } catch { return; }
}

export function hasCodexOAuth(ctx: ExtensionContext) {
  return codexRoute(ctx) && ctx.modelRegistry.getProviderAuthStatus(provider).source === "stored" && ctx.modelRegistry.isUsingOAuth(ctx.model!);
}

export function sameCodexLogin(ctx: ExtensionContext, read: ReadCredential, fingerprint: string) {
  const login = hasCodexOAuth(ctx) ? storedLogin(read) : undefined;
  return !!login && stamp(login.token) === fingerprint;
}

async function resolveLogin(ctx: ExtensionContext, read: ReadCredential) {
  const model = ctx.model;
  if (!model || !hasCodexOAuth(ctx)) return;
  // Pi can refresh its own OAuth as needed. Require the effective credential to be that exact grant.
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey || (auth.baseUrl && !nativeBase(auth.baseUrl)) ||
      ctx.model?.id !== model.id || !hasCodexOAuth(ctx)) return;
  const headers = [...Object.entries(model.headers ?? {}), ...Object.entries(auth.headers ?? {})];
  if (headers.some(([h, value]) => /^(authorization|api-key|x-api-key|openai-project|openai-organization|chatgpt-account-id)$/i.test(h) && value != null)) return;
  const login = storedLogin(read);
  return login?.token === auth.apiKey ? login : undefined;
}

// Pi's resolver has no AbortSignal in its public API; drop late resolutions before sending a GET.
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener("abort", stop); resolve(undefined); };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export async function sameEffectiveCodexLogin(ctx: ExtensionContext, read: ReadCredential, fingerprint: string) {
  try {
    if (!sameCodexLogin(ctx, read, fingerprint)) return false;
    const login = await untilAbort(resolveLogin(ctx, read), AbortSignal.timeout(8000));
    return !!login && stamp(login.token) === fingerprint;
  } catch { return false; }
}

/** One bounded authenticated read. Never use CODEX_HOME, share a refresh token, or follow redirects. */
export async function readPiCodex(ctx: ExtensionContext, read: ReadCredential, kind: keyof typeof endpoints,
  signal: AbortSignal, request = globalThis.fetch): Promise<{ body: unknown; fingerprint: string } | undefined> {
  if (signal.aborted || !hasCodexOAuth(ctx)) return;
  const model = ctx.model!.id;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  try {
    const login = await untilAbort(resolveLogin(ctx, read), bounded);
    if (!login || bounded.aborted) return;
    const fingerprint = stamp(login.token);
    const response = await request(endpoints[kind], { method: "GET", headers: {
      Authorization: `Bearer ${login.token}`, "chatgpt-account-id": login.id, originator: "pi", Accept: "application/json",
    }, redirect: "error", credentials: "omit", cache: "no-store", signal: bounded });
    const body = await readBody(response, bounded);
    if (!bounded.aborted && ctx.model?.id === model && sameCodexLogin(ctx, read, fingerprint)) return { body, fingerprint };
  } catch { /* Never expose backend errors, tokens or account information. */ }
}

export async function readPiCodexSpeeds(ctx: ExtensionContext, read: ReadCredential, signal: AbortSignal): Promise<{ tiers: Catalog; fingerprint: string } | undefined> {
  const model = ctx.model?.id;
  if (!model) return;
  const result = await readPiCodex(ctx, read, "models", signal);
  return result ? { tiers: directTiers(result.body, model), fingerprint: result.fingerprint } : undefined;
}
