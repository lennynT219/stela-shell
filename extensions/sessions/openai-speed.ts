import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { advertisedTiers, record, type Catalog } from "./speed-tiers.ts";

const base = "https://api.openai.com/v1";
const maxBytes = 8 * 1024 * 1024;
export type ReadCredential = (provider: "openai" | "openai-codex") => unknown;
export const stamp = (token: string) => createHash("sha256").update(token).digest("hex");

// Cheap checks only: the footer renders frequently and must never resolve or read a credential.
export function directRoute(ctx: ExtensionContext) {
  const m = ctx.model, registry = ctx.modelRegistry;
  return m?.provider === "openai" && m.api === "openai-responses" && m.baseUrl === base &&
    !registry.getRegisteredNativeProvider("openai") && !registry.getRegisteredProviderConfig("openai") &&
    registry.getProviderAuthStatus("openai").source === "stored" && registry.isUsingOAuth(m);
}

function storedToken(read: ReadCredential) {
  const c = read("openai");
  return record(c) && c.type === "oauth" && Array.isArray(c.scopes) && c.scopes.includes("chatgpt.tokens.use.direct") &&
    typeof c.access === "string" && c.access && !c.access.startsWith("sk-") && typeof c.expires === "number" && c.expires > Date.now() ? c.access : undefined;
}

/** A choice is not transferable to another login (including after token rotation). */
export function sameLogin(ctx: ExtensionContext, read: ReadCredential, fingerprint: string) {
  if (!directRoute(ctx)) return false;
  const token = storedToken(read);
  return !!token && stamp(token) === fingerprint;
}

export function directTiers(catalog: unknown, model: string): Catalog {
  if (!record(catalog) || !Array.isArray(catalog.models)) return undefined;
  const rows = catalog.models.filter(r => record(r) && r.visibility === "list" && r.slug === model);
  return rows.length === 0 ? [] : rows.length === 1 ? advertisedTiers(rows[0].service_tiers) : undefined;
}

export async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel(); return undefined;
  }
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  try {
    while (!signal.aborted) {
      const part = await reader.read();
      if (part.done) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      size += part.value.byteLength;
      if (size > maxBytes) break;
      chunks.push(Buffer.from(part.value));
    }
    await reader.cancel();
  } finally { reader.releaseLock(); }
}

// Check Pi's effective auth, not just its provider ID or the existence of a stored OAuth grant.
async function resolvedToken(ctx: ExtensionContext, read: ReadCredential) {
  const model = ctx.model;
  if (!model || !directRoute(ctx)) return;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey || (auth.baseUrl && auth.baseUrl !== base) || ctx.model?.id !== model.id ||
      !directRoute(ctx) || storedToken(read) !== auth.apiKey) return;
  const overrides = [...Object.keys(model.headers ?? {}), ...Object.keys(auth.headers ?? {})];
  if (overrides.some(h => /^(authorization|api-key|x-api-key|openai-project|openai-organization|chatgpt-account-id)$/i.test(h))) return;
  return auth.apiKey;
}

export async function sameEffectiveLogin(ctx: ExtensionContext, read: ReadCredential, fingerprint: string) {
  try {
    const token = await resolvedToken(ctx, read);
    return !!token && stamp(token) === fingerprint;
  } catch { return false; }
}

/** Never forward arbitrary Pi headers or fall back to an API key. */
export async function readDirectSpeeds(ctx: ExtensionContext, read: ReadCredential, signal: AbortSignal,
  request = globalThis.fetch): Promise<{ tiers: Catalog; fingerprint: string } | undefined> {
  const model = ctx.model;
  if (!model || signal.aborted) return;
  try {
    const token = await resolvedToken(ctx, read);
    if (!token || signal.aborted || !directRoute(ctx) || ctx.model?.id !== model.id) return;
    const fingerprint = stamp(token);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    const response = await request(`${base}/models`, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error", credentials: "omit", cache: "no-store", signal: bounded });
    const tiers = directTiers(await readBody(response, bounded), model.id);
    if (!bounded.aborted && ctx.model?.id === model.id && sameLogin(ctx, read, fingerprint)) return { tiers, fingerprint };
  } catch { /* Do not surface private response bodies, headers, tokens or transport errors. */ }
}
