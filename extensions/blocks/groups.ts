import { foldable } from "./families.ts";

type Slot = { id: string; name: string; ok: boolean; expanded: boolean; invalidate?: () => void };
/** Groups come from adjacent calls in ONE assistant message, never arrival order or a script. Nothing is persisted. */
export class ReadGroups {
  private byId = new Map<string, Slot[]>();
  private runs = new Set<Slot[]>();
  private dirty = new Set<Slot>();
  private scheduled = false;
  reset() { this.byId.clear(); this.runs.clear(); this.dirty.clear(); }
  assistant(content: unknown) {
    if (!Array.isArray(content)) return;
    let run: Slot[] = [];
    const add = () => {
      if (run.length >= 2 && run.length <= 128 && run.every(s => !this.byId.has(s.id)) && new Set(run.map(s => s.id)).size === run.length) {
        this.runs.add(run); for (const s of run) this.byId.set(s.id, run);
        while (this.byId.size > 1024) {
          const oldest = this.runs.values().next().value!; this.runs.delete(oldest);
          for (const item of oldest) this.byId.delete(item.id);
        }
      }
      run = [];
    };
    for (const block of content) {
      if (block?.type !== "toolCall" || typeof block.id !== "string" || !foldable(block.name)) { add(); continue; }
      if (run.length && run[0].name !== block.name) add();
      run.push({ id: block.id, name: block.name, ok: false, expanded: false });
    }
    add();
  }
  private redraw(run: Slot[]) {
    for (const s of run) if (s.invalidate) this.dirty.add(s);
    if (!this.dirty.size || this.scheduled) return;
    this.scheduled = true; queueMicrotask(() => {
      this.scheduled = false; const slots = [...this.dirty]; this.dirty.clear();
      for (const s of slots) { try { s.invalidate?.(); } catch { /* no longer mounted */ } }
    });
  }
  mark(id: string, name: string, ok: boolean) {
    const run = this.byId.get(id), slot = run?.find(s => s.id === id && s.name === name);
    if (run && slot && slot.ok !== ok) { slot.ok = ok; this.redraw(run); }
  }
  bind(id: string, name: string, expanded: boolean, invalidate: () => void) {
    const run = this.byId.get(id), slot = run?.find(s => s.id === id && s.name === name);
    if (!run || !slot) return;
    slot.invalidate = invalidate;
    if (slot.expanded !== expanded) { slot.expanded = expanded; this.redraw(run); }
  }
  /** Expanding a verified run changes its visibility, not its yellow surface. Partial/failed neighbors never join it. */
  grouped(id: string): boolean {
    const run = this.byId.get(id); if (!run) return false;
    const i = run.findIndex(s => s.id === id);
    return i >= 0 && run[i].ok && (run[i-1]?.ok === true || run[i+1]?.ok === true);
  }
  /** 0 hides only a successful follower; 1 means keep this row, including unknown/partial results. */
  count(id: string): number {
    const run = this.byId.get(id); if (!run) return 1;
    const i = run.findIndex(s => s.id === id);
    if (i < 0 || !run[i].ok || run[i].expanded) return 1;
    let lo = i, hi = i;
    while (lo > 0 && run[lo-1].ok) lo--;
    while (hi+1 < run.length && run[hi+1].ok) hi++;
    if (run.slice(lo,hi+1).some(s => s.expanded)) return 1;
    return i === lo ? hi-lo+1 : 0;
  }
}
