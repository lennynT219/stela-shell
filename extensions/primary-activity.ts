/**
 * Ephemeral handoff from the owned authenticated sessions receiver to Memory.
 * Never infer authority from a custom message, transcript, event-bus payload or
 * model argument. Trusted extensions share OS permissions; this is not a sandbox.
 */
export interface ActivityOwner {
  sessionManager: { getSessionId(): string };
  cwd: string;
}
export interface PrimaryActivity { valid(): boolean }
interface Source {
  sessionId: string;
  cwd: string;
  live(): boolean;
  observe(ctx: ActivityOwner): void;
  activity?: PrimaryActivity;
}
// Pi loads extensions with separate jiti module caches. A module-local WeakMap
// would silently split producer/consumer state. Share only this versioned weak
// registry in the host realm; expose only validity, not Memory/message payloads
// or persisted grants. Receiver-owned closures remain private host state.
const KEY = Symbol.for("stela-shell.primary-activity.v1");
function registry(create = false): WeakMap<object, Source> | undefined {
  const host = globalThis as typeof globalThis & { [KEY]?: WeakMap<object, Source> };
  if (!Object.hasOwn(host, KEY) && create) Object.defineProperty(host, KEY, { value: new WeakMap<object, Source>() });
  const value = host[KEY];
  return value instanceof WeakMap ? value : undefined;
}

/** Called only by the owned sessions activation, not by input/custom-message hooks. */
export function openPrimaryActivity(owner: ActivityOwner, live: () => boolean, observe: (ctx: ActivityOwner) => void) {
  const sources = registry(true);
  if (!sources) throw new Error("Primary activity registry unavailable.");
  const key = owner.sessionManager, sessionId = key.getSessionId(), cwd = owner.cwd;
  const previous = sources.get(key);
  if (previous?.live()) throw new Error("A primary activity source already owns this session.");
  let closed = false;
  const current = () => !closed && sources.get(key) === source && key.getSessionId() === sessionId && owner.cwd === cwd && live();
  const source: Source = { sessionId, cwd, live: current, observe };
  sources.set(key, source);
  return {
    /** Only after actual authenticated in-flight delivery commits to the active branch. */
    committed(deadline: number, proof: () => boolean) {
      if (!current() || !Number.isSafeInteger(deadline) || deadline <= Date.now()) return;
      const activity: PrimaryActivity = Object.freeze({
        valid: () => current() && source.activity === activity && Date.now() < deadline && proof(),
      });
      source.activity = activity;
    },
    close() {
      closed = true;
      source.activity = undefined;
      if (sources.get(key) === source) sources.delete(key);
    },
  };
}

/** Live source checks also work when Memory's context hook runs before sessions'. */
export function primaryActivity(ctx: ActivityOwner): PrimaryActivity | undefined {
  const source = registry()?.get(ctx.sessionManager);
  if (!source || source.sessionId !== ctx.sessionManager.getSessionId() || source.cwd !== ctx.cwd || !source.live()) return;
  source.observe(ctx); // Owner proves commitment; arbitrary/history entries alone cannot do so.
  return source.activity?.valid() ? source.activity : undefined;
}
