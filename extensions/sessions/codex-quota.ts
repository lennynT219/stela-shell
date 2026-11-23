import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { codexRoute, hasCodexOAuth, readPiCodex } from "./codex-pi.ts";
import type { ReadCredential } from "./openai-speed.ts";
import { exchange, localCommand, record, type Command, type Conversation } from "./codex-stdio.ts";
export { readOnlyArgs as quotaArgs } from "./codex-stdio.ts";

export type Window = { minutes?: number; used: number; reset?: number; kind: "Principal" | "Secundaria" };
export type Quota = { state: "ok"; windows: Window[] } | { state: "loading" | "unavailable" | "signed-out" | "pi-signed-out" };
const unavailable: Quota = {state:"unavailable"};

/** Project just the Codex bucket. Never expose account identifiers, credits, other services or raw errors. */
export function decodeQuota(v:unknown): Quota {
  if (!record(v)) return unavailable;
  let bucket:unknown = v.rateLimits;
  if (v.rateLimitsByLimitId != null) {
    if (!record(v.rateLimitsByLimitId)) return unavailable;
    if (Object.hasOwn(v.rateLimitsByLimitId,"codex")) bucket = v.rateLimitsByLimitId.codex;
    else if (!record(bucket) || bucket.limitId !== "codex") return unavailable;
  }
  if (!record(bucket) || (bucket.limitId != null && bucket.limitId !== "codex")) return unavailable;
  const windows: Window[] = [];
  for (const k of ["primary","secondary"] as const) {
    const w = bucket[k];
    if (w == null) continue;
    if (!record(w) || typeof w.usedPercent !== "number" || !Number.isInteger(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) return unavailable;
    const mins = w.windowDurationMins, at = w.resetsAt;
    windows.push({kind:k === "primary" ? "Principal" : "Secundaria", used:w.usedPercent,
      minutes:typeof mins === "number" && Number.isSafeInteger(mins) && mins > 0 ? mins : undefined,
      reset:typeof at === "number" && Number.isSafeInteger(at) && at > 0 && Number.isFinite(new Date(at*1000).getTime()) ? at : undefined});
  }
  return windows.length ? {state:"ok",windows} : unavailable;
}

// The raw Codex usage endpoint returns durations in seconds, not app-server minutes.
export function decodePiQuota(body: unknown): Quota {
  if (!record(body) || !record(body.rate_limit)) return unavailable;
  const window = (w: unknown) => {
    if (w == null) return undefined;
    if (!record(w)) return {};
    const seconds = w.limit_window_seconds;
    return { usedPercent: w.used_percent, windowDurationMins: typeof seconds === "number" && seconds % 60 === 0 ? seconds / 60 : undefined,
      resetsAt: w.reset_at };
  };
  return decodeQuota({rateLimits:{primary:window(body.rate_limit.primary_window),secondary:window(body.rate_limit.secondary_window)}});
}

export async function readPiQuota(ctx: ExtensionContext, read: ReadCredential, signal: AbortSignal): Promise<Quota> {
  if (!codexRoute(ctx)) return unavailable;
  if (!hasCodexOAuth(ctx)) return { state:"pi-signed-out" };
  return decodePiQuota((await readPiCodex(ctx, read, "usage", signal))?.body);
}

export function quotaLines(q:Quota, now = new Date()): string[] {
  if (q.state !== "ok") return [q.state === "loading" ? "Codex · Consultando…" : q.state === "pi-signed-out" ? "Codex · Inicia sesión en Pi" : q.state === "signed-out" ? "Codex · Inicia sesión" : "Codex · No disponible"];
  const rows = q.windows.map(w => {
    const m=w.minutes, period = !m ? w.kind : m%1440===0 ? `${m/1440} d` : m%60===0 ? `${m/60} h` : `${m} min`;
    const d=w.reset ? new Date(w.reset*1000) : undefined;
    const time=d?.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    const reset=!d ? "—" : d.toDateString() === now.toDateString() ? time! : `${d.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit"})} ${time}`;
    return [period, `${w.used}%`, reset];
  });
  const col=Math.max(5,...rows.map(r=>r[0].length));
  return [`${"Codex".padEnd(col)}  Usado  Reinicio`, ...rows.map(([p,u,r])=>`${p.padEnd(col)}  ${u.padStart(5)}  ${r}`)];
}

export function queryQuota(cmd: Command, signal: AbortSignal): Promise<Quota> {
  return exchange<Quota>(cmd, signal, "stela-shell-quota", (function* (): Conversation<Quota> {
    const msg = yield { method: "account/rateLimits/read" as const, params: { excludeResetCreditDetails: true } };
    if (record(msg.error) && msg.error.message === "codex account authentication required to read rate limits") return { state: "signed-out" as const };
    return decodeQuota(msg.result);
  })(), unavailable);
}

export async function readCodexQuota(signal: AbortSignal): Promise<Quota> {
  try {
    const cmd = await localCommand();
    return cmd ? await queryQuota(cmd, signal) : { state: "signed-out" };
  } catch { return unavailable; }
}
