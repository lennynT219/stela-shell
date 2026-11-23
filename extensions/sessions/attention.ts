import { createHash, randomUUID } from "node:crypto";
import { watch, lstatSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { SessionTransport } from "./protocol.ts";

/** Display metadata only. Never publish prompt text, options, answers or session contents. */
export interface TerminalRoute { core: string; address: string; pid: number }
export interface Question { token: string; route: TerminalRoute | null }
export interface PeerQuestion extends Question { id: string; name: string }
const HEX = /^[a-f0-9]{32}$/;
const only = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
export function decodeQuestion(value: unknown): Question | null {
  if (value === null) return null;
  const q = value as Question;
  if (!q || !only(q, ["token", "route"]) || typeof q.token !== "string" || !HEX.test(q.token)) throw new Error("Invalid question token");
  if (q.route !== null) {
    const r = q.route;
    if (!r || !only(r, ["core", "address", "pid"]) || typeof r.core !== "string" || !HEX.test(r.core) ||
      typeof r.address !== "string" || !/^t[0-9a-z]{1,12}$/.test(r.address) || !Number.isSafeInteger(r.pid) || r.pid < 1) throw new Error("Invalid terminal route");
  }
  return { token: q.token, route: q.route && { ...q.route } };
}

/** Scope a Herdr address to this particular local core socket, not a similarly named terminal on another core. */
export function herdrRoute(env = process.env): TerminalRoute | null {
  const address = env.HC_TERMINAL_ID, socket = env.HC_TERMINAL_SOCKET;
  if (process.platform !== "linux" || !address || !/^t[0-9a-z]{1,12}$/.test(address) || !socket?.startsWith("/")) return null;
  try {
    const s = lstatSync(socket, { bigint: true });
    if (!s.isSocket() || s.uid !== BigInt(process.getuid!())) return null;
    return { address, pid: process.pid, core: createHash("sha256").update(`${s.dev}:${s.ino}`).digest("hex").slice(0, 32) };
  } catch { return null; }
}

export type AttentionTransport = SessionTransport & Required<Pick<SessionTransport, "questionFor">>;
/** Filesystem events are invalidation hints only. Only an authenticated, live response supplies a question. */
export function watchQuestions(t: AttentionTransport, changed: (questions: PeerQuestion[]) => void, ownRoute: () => TerminalRoute | null, focusedDialog: () => object | null) {
  const abort = new AbortController(), { signal } = abort;
  let watcher: FSWatcher | undefined, next: NodeJS.Timeout | undefined, expiry: NodeJS.Timeout | undefined;
  const pending = new Map<string, PeerQuestion>(), hints = new Set<string>();
  let discover = false, busy = false;
  const publish = () => {
    if (signal.aborted) return;
    changed([...pending.values()].sort((a, b) => a.id.localeCompare(b.id)));
    clearTimeout(expiry);
    // A killed process may leave its presence file behind. Recheck only advertised questions.
    if (pending.size) expiry = setTimeout(() => { for (const id of pending.keys()) schedule(id); }, 5000).unref();
  };
  async function refresh() {
    next = undefined;
    if (busy || signal.aborted) return;
    busy = true;
    const all = discover, ids = new Set(hints); hints.clear(); discover = false;
    try {
      if (all) {
        const peers = await t.list(signal); ids.clear();
        for (const p of peers) ids.add(p.id);
        for (const id of pending.keys()) if (!ids.has(id)) pending.delete(id);
      }
      for (const id of ids) {
        if (signal.aborted) return;
        const q = await t.questionFor(id, signal).catch(() => null);
        if (!q || hints.has(id) || discover) pending.delete(id);
        else if (pending.has(id) || pending.size < 32) pending.set(id, { ...q, id });
      }
    } catch { pending.clear(); }
    finally { busy = false; publish(); if (hints.size || discover) arm(); }
  }
  function arm() { if (!next && !busy && !signal.aborted) next = setTimeout(() => { void refresh(); }, 75).unref(); }
  function schedule(id?: string) {
    if (signal.aborted) return;
    if (!id || hints.size >= 32) { discover = true; hints.clear(); } else if (!discover) hints.add(id);
    arm();
  }
  try {
    watcher = watch(join(t.profile, "stela-sessions"), { persistent: false }, (_event, name) => {
      if (!name) schedule();
      else if (/^[a-f0-9]{32}\.json$/.test(name) && name !== `${t.info.id}.json`) schedule(name.slice(0, -5));
    });
    watcher.on("error", () => { watcher?.close(); abort.abort(); clearTimeout(next); clearTimeout(expiry); changed([]); });
    schedule(); // also find a question that was open before this panel's session started
  } catch { /* no filesystem watcher: don't invent any peers */ }
  let dialog: object | null = null, advertised: Question | null = null, touch = Promise.resolve();
  // Check the actual focused object on every frame *and* on authenticated inspection. Identical titles
  // or a new dialog that opened between frames never reuse the previous dialog's token.
  const sync = () => {
    if (signal.aborted) return null;
    const current = focusedDialog();
    if (current !== dialog) {
      dialog = current;
      advertised = current ? { token: randomUUID().replaceAll("-", ""), route: ownRoute() } : null;
      // Touch only the existing protected presence: no question or terminal route on disk.
      touch = touch.then(async () => { if (!signal.aborted) await t.update(t.info.name); }).catch(() => {});
    }
    return advertised;
  };
  t.readQuestion = sync; sync();
  return {
    sync,
    async current(q: PeerQuestion) {
      if (signal.aborted) return false;
      const now = await t.questionFor(q.id, signal).catch(() => null);
      return !signal.aborted && !!now && now.token === q.token && !!q.route && now.route?.address === q.route.address && now.route?.core === q.route.core && now.route?.pid === q.route.pid;
    },
    close() {
      if (t.readQuestion === sync) t.readQuestion = undefined;
      abort.abort(); watcher?.close(); clearTimeout(next); clearTimeout(expiry); changed([]);
    },
  };
}
