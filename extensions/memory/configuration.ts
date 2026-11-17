import { lstatSync, statSync, type BigIntStats } from "node:fs";
import { isAbsolute, join } from "node:path";

const token = (s: BigIntStats) => [s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(":");

/** Brain alone interprets configuration. SS observes metadata, never TOML/content. */
export function configuredVaultGuard(environment: NodeJS.ProcessEnv): () => boolean {
  const key = process.platform === "win32"
    ? Object.keys(environment).find(k => k.toUpperCase() === "USERPROFILE") : "HOME";
  const home = key ? environment[key] : undefined;
  const path = home && isAbsolute(home) && !home.includes("\0") ? join(home,".config","brain","config.toml") : undefined;
  const observe = () => {
    if (!path) return "invalid-environment";
    try {
      // Include both the link itself and the followed target, if any.
      return `${token(lstatSync(path,{bigint:true}))}|${token(statSync(path,{bigint:true}))}`;
    } catch (error) {
      // Missing/unavailable configuration is left for Brain to report, not repaired.
      return `unavailable:${(error as NodeJS.ErrnoException).code ?? "unknown"}`;
    }
  };
  let initial: string | undefined, changed = false;
  return () => {
    if (changed) return false;
    const current = observe();
    if (initial === undefined) initial = current; // First genuine read, not extension startup.
    else if (current !== initial) changed = true;
    return !changed;
  };
}
