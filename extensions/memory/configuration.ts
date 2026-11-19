import { lstatSync, statSync, type BigIntStats } from "node:fs";
import { isAbsolute, join } from "node:path";

const token = (s: BigIntStats) => [s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(":");

/** Scope hint for local preferences, never a resolved vault identity or authority. */
function observe(environment: NodeJS.ProcessEnv): { stamp?: string; state: string } {
  const key = process.platform === "win32"
    ? Object.keys(environment).find(k => k.toUpperCase() === "USERPROFILE") : "HOME";
  const home = key ? environment[key] : undefined;
  if (!home || !isAbsolute(home) || home.includes("\0")) return { state: "invalid-environment" };
  const path = join(home,".config","brain","config.toml");
  try {
    const stamp = `${path}|${token(lstatSync(path,{bigint:true}))}|${token(statSync(path,{bigint:true}))}`;
    return { stamp, state: stamp };
  } catch (error) { return { state: `unavailable:${(error as NodeJS.ErrnoException).code ?? "unknown"}` }; }
}

export const observeConfiguredVault = (environment: NodeJS.ProcessEnv) => observe(environment).stamp;

/** Brain alone interprets configuration. SS observes metadata, never TOML/content. */
export function configuredVaultGuard(environment: NodeJS.ProcessEnv): () => boolean {
  let initial: string | undefined, changed = false;
  return () => {
    if (changed) return false;
    const current = observe(environment).state;
    if (initial === undefined) initial = current; // First genuine read, not extension startup.
    else if (current !== initial) changed = true;
    return !changed;
  };
}
