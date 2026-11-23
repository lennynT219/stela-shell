import { execFile } from "node:child_process";
import { devNull } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);
export interface GitSummary { branch: string; ahead?: string; behind?: string; added?: string; removed?: string }
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** Local tracking refs only. Do not refresh the index, contact a promisor remote or run external diff/clean drivers. */
export async function readGitSummary(cwd: string, signal: AbortSignal): Promise<GitSummary | undefined> {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", GIT_ALLOW_PROTOCOL: "", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
  // The panel describes the session folder even if Pi was launched from a Git hook.
  for (const key of ["GIT_DIR","GIT_COMMON_DIR","GIT_WORK_TREE","GIT_INDEX_FILE","GIT_OBJECT_DIRECTORY","GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_NAMESPACE"]) delete env[key];
  const git = async (...args: string[]) => (await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", ...args],
    { cwd, signal, env, windowsHide: true, timeout: 2500, maxBuffer: 128 * 1024 })).stdout;
  let row: GitSummary | undefined;
  try {
    // Exclude all paths: only Git's machine-readable branch headers are needed, even in a huge dirty tree.
    const status = await git("status", "--porcelain=v2", "--branch", "--ahead-behind", "-uno", "--ignore-submodules=all", "--", ":(top,exclude,glob)**");
    const head = /^# branch\.head (.+)$/m.exec(status)?.[1], revision = /^# branch\.oid (.+)$/m.exec(status)?.[1];
    if (!head || !revision || (!oid.test(revision) && revision !== "(initial)")) return;
    const ab = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(status);
    row = { branch: head === "(detached)" ? `HEAD@${revision.slice(0,7)}` : head, ahead: ab?.[1], behind: ab?.[2] };
    const base = revision === "(initial)" ? (await git("hash-object", "-t", "tree", "--", devNull)).trim() : revision;
    if (!oid.test(base)) return row;
    let drivers = "";
    try { drivers = await git("config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process)$"); }
    catch (e) { if ((e as {code?:number}).code !== 1) throw e; } // No matching config keys.
    const config: string[] = [];
    for (const driver of new Set(drivers.split("\0").filter(Boolean).map(k => k.slice(0,k.lastIndexOf("."))))) {
      if (!/^filter\.[\w.-]+$/.test(driver)) return row;
      config.push("-c",`${driver}.clean=`,"-c",`${driver}.process=`,"-c",`${driver}.required=false`);
    }
    const stat = (await git(...config,"diff","--no-ext-diff","--no-textconv","--no-relative","--no-color","--ignore-submodules=all","--shortstat",base,"--")).trim();
    const counts = /^(?:\d+ files? changed)(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/.exec(stat);
    if (stat && !counts) return row;
    row.added = counts?.[1] ?? "0"; row.removed = counts?.[2] ?? "0";
  } catch { /* Not a worktree / missing git: no row. Failed diff: never invent zero counts. */ }
  return signal.aborted ? undefined : row;
}

/** Runs off the render path, only while the panel is open; never overlaps scans in the same panel. */
export function watchGit(cwd: string, publish: (row?: GitSummary) => void) {
  const controller = new AbortController(); let timer: NodeJS.Timeout | undefined;
  const update = async () => {
    const row = await readGitSummary(cwd,controller.signal);
    if (controller.signal.aborted) return;
    publish(row); timer = setTimeout(update,5000); timer.unref();
  };
  void update();
  return () => { controller.abort(); clearTimeout(timer); };
}
