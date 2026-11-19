import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Owner = Pick<ExtensionContext, "sessionManager" | "cwd">;
export interface AssociationClaim {
  valid(): boolean;
  finish(outcome: "not_applied" | "bound" | "uncertain"): void;
}
export interface AssociationScope { executable: string; environment: string; vaultScope: string | undefined }
type Reserve = (ctx: Owner, scope: AssociationScope) => AssociationClaim | undefined;
// Trusted host-only bridge across independent Pi loader caches. No model data,
// ambient policy override, or persisted access grant lives here.
const key = Symbol.for("stela-shell.project-association.v1");
const host = globalThis as typeof globalThis & { [key]?: WeakMap<object, Reserve> };

export function registerProjectAssociation(owner: Owner, reserve: Reserve): () => void {
  if (!Object.hasOwn(host, key)) Object.defineProperty(host, key, { value: new WeakMap<object, Reserve>() });
  const map = host[key];
  if (!(map instanceof WeakMap)) throw new Error("Project association unavailable");
  map.set(owner.sessionManager, reserve);
  return () => { if (map.get(owner.sessionManager) === reserve) map.delete(owner.sessionManager); };
}

export function reserveProjectAssociation(ctx: Owner, scope: AssociationScope) {
  return host[key]?.get(ctx.sessionManager)?.(ctx, scope);
}
