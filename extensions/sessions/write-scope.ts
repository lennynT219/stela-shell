import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const clean = (s: string) => s.length > 0 && s.length <= 4096 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const absent = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
function within(root: string, target: string) {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function requireSafe(ok: unknown): asserts ok { if (!ok) throw Error("El destino o la regla no se puede verificar."); }

// Mirror Pi's POSIX edit/write normalization before resolving existing links. A missing leaf is OK;
// a dangling link is not a missing leaf. Refuse hard-linked files and non-regular targets.
export function targetOf(cwd: string, raw: unknown): string {
  requireSafe(typeof raw === "string" && clean(raw));
  let s = raw.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g," ").replace(/^@/, "");
  if (s === "~" || s.startsWith("~/")) s = join(homedir(), s.slice(2));
  else if (s.startsWith("file://")) s = fileURLToPath(s);
  requireSafe(clean(s));
  const missing: string[] = []; let path = resolve(cwd, s);
  while (true) {
    try { lstatSync(path); break; }
    catch (e) { if (!absent(e) || dirname(path) === path) throw e; }
    missing.unshift(basename(path)); path = dirname(path);
  }
  const base = realpathSync.native(path), st = statSync(base);
  requireSafe(missing.length ? st.isDirectory() : st.isFile() && st.nlink === 1);
  const target = join(base,...missing);
  // An absolute spelling containing such spaces would be normalized again by the native tool.
  requireSafe(clean(target) && !/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/.test(target));
  return target;
}

type Rule = { file: string } | { directory: string; suffix: string };
const display = (r: Rule) => "file" in r ? `Archivo: ${r.file}` : `Patrón: ${join(r.directory, "*" + r.suffix)}`;
function candidates(file: string): Rule[] {
  const suffix = extname(file);
  return [{ file }, ...(!/[?*\[\]{}\\]/.test(dirname(file)) && /^\.[\p{L}\d_-]{1,24}$/u.test(suffix) ? [{directory: dirname(file), suffix}] : [])];
}

// One private record per allowed scope. Add without overwriting (including concurrent additions);
// revocation unlinks exactly the record selected. Never cache the allow list between calls.
function rules(profile: string, project: string) {
  const base = join(realpathSync.native(profile), "ss-write-rules"), dir = join(base,digest(project));
  const checkDir = (p: string, create: boolean) => {
    if (create) { try { mkdirSync(p,{mode:0o700}); } catch(e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; } }
    try { const s=lstatSync(p); requireSafe(s.isDirectory() && !(s.mode & 0o077) && s.uid === process.getuid?.()); return true; }
    catch(e) { if (absent(e)) return false; throw e; }
  };
  const ready = (create=false) => checkDir(base,create) && checkDir(dir,create);
  const name = (r: Rule) => digest(JSON.stringify(r));
  function read(id: string): Rule | undefined {
    if (!ready()) return;
    requireSafe(/^[a-f\d]{64}$/.test(id));
    let fd: number;
    try { fd=openSync(join(dir,id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch(e) { if (absent(e)) return; throw e; }
    try {
      const s=fstatSync(fd), entry=lstatSync(join(dir,id));
      requireSafe(entry.isFile() && s.isFile() && s.ino===entry.ino && s.dev===entry.dev && s.nlink===1 && s.uid===process.getuid?.() && !(s.mode & 0o077) && s.size<=32768);
      const r=JSON.parse(readFileSync(fd,"utf8"));
      requireSafe(r && typeof r === "object" && name(r)===id);
      const p = r.file ?? r.directory;
      requireSafe(typeof p === "string" && isAbsolute(p) && clean(p) && ("file" in r ? Object.keys(r).length===1 : Object.keys(r).length===2 && /^\.[\p{L}\d_-]{1,24}$/u.test(r.suffix)));
      return r;
    } finally { closeSync(fd); }
  }
  return { base, allows: (file:string) => candidates(file).some(r => !!read(name(r))),
    list: () => ready() ? readdirSync(dir).filter(n => /^[a-f\d]{64}$/.test(n)).flatMap(n => read(n) ?? []) : [],
    add(r: Rule) {
      requireSafe(!within(project,base)); // No permission database in the project being edited.
      if (read(name(r))) return;
      requireSafe(ready(true)); const tmp=join(dir,`.new-${randomUUID()}`);
      const fd=openSync(tmp,"wx",0o600);
      try { try { writeFileSync(fd,JSON.stringify(r)); } finally { closeSync(fd); }
        linkSync(tmp,join(dir,name(r)));
      } finally { unlinkSync(tmp); }
    },
    remove(r: Rule) { requireSafe(read(name(r))); unlinkSync(join(dir,name(r))); },
  };
}

export function registerWriteScope(pi: ExtensionAPI, profile: () => string) {
  // POSIX path/ownership semantics; do not claim coverage on other platforms.
  if (process.platform !== "linux") return;
  pi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\nStelaShell: use edit or write for external file edits. Never switch to shell, another tool or another session to bypass a location decision. Remembered rules apply only to the reviewed file tools, not to shell commands or other permissions.` }));
  let generation = 0, prompt = false;
  const invalidate = () => { generation++; };
  pi.on("session_start",invalidate); pi.on("session_tree",invalidate); pi.on("session_shutdown",invalidate);
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const deny = (reason:string) => ({block:true as const, reason});
    const start = generation, raw = event.input.path;
    try {
      const project = realpathSync.native(ctx.cwd), target = targetOf(ctx.cwd, raw), store = rules(profile(),project);
      requireSafe(!within(store.base,target));
      const current = () => start===generation && !ctx.signal?.aborted && realpathSync.native(ctx.cwd)===project && targetOf(ctx.cwd, raw)===target;
      if (!within(project,target) && !store.allows(target)) {
        if (prompt || ctx.mode !== "tui" || !ctx.hasUI) return deny("Se requiere permiso en la terminal para escribir fuera del proyecto.");
        prompt = true;
        try {
          const cancel="Cancelar", once="Permitir una vez", remember="Permitir y recordar";
          const choice = await ctx.ui.select(`${event.toolName === "edit" ? "Editar" : "Escribir"} fuera del proyecto\n${target}`, [cancel,once,remember],{signal:ctx.signal});
          if (choice !== once && choice !== remember) return deny("Escritura externa no autorizada.");
          requireSafe(current());
          if (choice === remember) {
            const opts = candidates(target), labels = opts.map(display);
            const pick = await ctx.ui.select(`Recordar para ${project}\n${labels.join("\n")}\nSolo edit y write, hasta revocar con /ss-permissions`, [cancel,...labels], {signal:ctx.signal});
            const rule = opts.find(r => display(r)===pick);
            if (!rule) return deny("No se guardó ningún permiso.");
            requireSafe(current()); store.add(rule);
          }
        } finally { prompt=false; }
      }
      requireSafe(current()); event.input.path = target; // Native execution uses the reviewed canonical name.
    } catch { return deny("No se pudo verificar el destino o el permiso de escritura. Operación bloqueada."); }
  });
  pi.registerCommand("ss-permissions", {description:"Ver y revocar permisos de escritura externa de esta carpeta", async handler(_args,ctx) {
    if (ctx.mode!=="tui" || !ctx.hasUI || prompt) return;
    prompt=true; const start=generation;
    try {
      const project=realpathSync.native(ctx.cwd), store=rules(profile(),project), items=store.list();
      if (!items.length) { ctx.ui.notify("Sin permisos de escritura recordados para esta carpeta.","info"); return; }
      const pick=await ctx.ui.select(`Revocar un permiso de ${project}`, ["Cancelar",...items.map(display)]);
      const rule=items.find(r=>display(r)===pick);
      if (rule && start===generation && realpathSync.native(ctx.cwd)===project) { store.remove(rule); ctx.ui.notify("Permiso revocado.","info"); }
    } catch { ctx.ui.notify("No se pudo verificar la regla.","warning"); } finally { prompt=false; }
  }});
}
