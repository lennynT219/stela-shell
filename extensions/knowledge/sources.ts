import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { uuid } from "../memory/protocol.ts";

export interface SourcePreference {
  ids: readonly string[];
  commit(ids: readonly string[]): void;
  valid(): boolean;
}
const LIMIT = 64 * 1024;
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 1024 && ids.every(uuid) && new Set(ids).size === ids.length;

function read(path: string): string | null {
  try {
    const initial = lstatSync(path);
    if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.size > LIMIT) throw new Error("Invalid Knowledge preferences");
    const fd = openSync(path, "r");
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || file.dev !== initial.dev || file.ino !== initial.ino || file.size !== initial.size) throw new Error("Knowledge preferences changed");
      const buffer = Buffer.alloc(LIMIT + 1);
      let size = 0;
      while (size < buffer.length) {
        const n = readSync(fd, buffer, size, buffer.length - size, null);
        if (!n) break;
        size += n;
      }
      if (size !== initial.size) throw new Error("Knowledge preferences changed");
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    } finally { closeSync(fd); }
  } catch (e) { if (absent(e)) return null; throw e; }
}

/** Stores only explicit additional source IDs in the existing Pi profile, never notes or Memory. */
export function sourcesPreference(profile: string, cwd: string, principal: string, vaultScope: string | undefined): SourcePreference {
  if (!isAbsolute(profile) || !isAbsolute(cwd) || !uuid(principal) || !vaultScope) throw new Error("Invalid Knowledge preference scope");
  const root = realpathSync.native(profile), folder = realpathSync.native(cwd);
  const folderKey = process.platform === "win32" ? folder.toLowerCase() : folder;
  const key = createHash("sha256").update(JSON.stringify([folderKey, principal, vaultScope])).digest("hex");
  const path = join(root, `ss-knowledge-${key}.json`), original = read(path);
  const ids: unknown = original === null ? [] : JSON.parse(original);
  if (!validIds(ids) || ids.includes(principal)) throw new Error("Invalid Knowledge preferences");
  const valid = () => {
    try { return read(path) === original; }
    catch { return false; }
  };
  return {
    ids: Object.freeze(ids), valid,
    commit(next) {
      if (!validIds(next) || next.includes(principal) || !valid()) throw new Error("Knowledge preferences changed");
      if (JSON.stringify(next) === JSON.stringify(ids)) return;
      const temp = join(root, `.ss-knowledge-${randomUUID()}.tmp`);
      let created = false;
      try {
        const fd = openSync(temp, "wx", 0o600);
        created = true;
        try { writeFileSync(fd, JSON.stringify(next) + "\n", "utf8"); }
        finally { closeSync(fd); }
        if (!valid()) throw new Error("Knowledge preferences changed");
        renameSync(temp, path);
        created = false;
      } finally { if (created) unlinkSync(temp); }
    },
  };
}
