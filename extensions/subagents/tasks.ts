import { randomUUID } from "node:crypto";
import type { RunResult } from "./runner.ts";

export interface Assignment {
  label: string;
  objective: string;
  references: string[];
  context: string;
  constraints: string[];
  done_when: string;
}

export type TaskState = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
export interface Task {
  id: string;
  assignment: Assignment;
  state: TaskState;
  result?: RunResult;
  delivered: boolean;
  sourcesMayHaveChanged: boolean;
}

export const MAX_PENDING = 8;
const MAX_HISTORY = 32;

/** Revalidate at execution time: other Pi hooks may have changed tool arguments. */
export function validateAssignment(value: unknown): Assignment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an assignment object.");
  const input = value as Record<string, unknown>;
  const keys = ["label", "objective", "references", "context", "constraints", "done_when"];
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error("Unknown assignment field.");
  const string = (value: unknown, name: string, max: number, empty = false): string => {
    if (typeof value !== "string" || (!empty && !value.trim()) || /\u0000/.test(value) || Buffer.byteLength(value) > max) {
      throw new Error(`Invalid ${name}: expected ${empty ? "a" : "a nonempty"} string of at most ${max} UTF-8 bytes.`);
    }
    return value.trim();
  };
  const list = (value: unknown, name: string, max: number): string[] => {
    if (!Array.isArray(value) || value.length > 16) throw new Error(`Invalid ${name}: expected at most 16 strings.`);
    return [...new Set(value.map((item) => string(item, name, max)))];
  };
  const assignment = {
    label: string(input.label, "label", 120),
    objective: string(input.objective, "objective", 4096),
    references: list(input.references, "references", 1024),
    context: string(input.context ?? "", "context", 8192, true),
    constraints: list(input.constraints ?? [], "constraints", 1024),
    done_when: string(input.done_when, "done_when", 2048),
  };
  if (/[\p{Cc}\p{Cf}]/u.test(assignment.label)) throw new Error("The label must be plain single-line text.");
  if (!assignment.references.length) throw new Error("Name at least one authorized file or directory in references.");
  if (Buffer.byteLength(JSON.stringify(assignment)) > 16 * 1024) throw new Error("Assignment exceeds 16 KiB.");
  return assignment;
}

export function concurrencyLimit(value: unknown): number {
  if (typeof value !== "string" || !/^[1-5]$/.test(value)) throw new Error("--stela-subagent-concurrency must be an integer from 1 to 5.");
  return Number(value);
}

interface Entry {
  task: Task;
  key: string;
  controller: AbortController;
  execute: (signal: AbortSignal) => Promise<RunResult>;
}

/** In-memory, session-owned queue. It never restores or relaunches old work. */
export class TaskQueue {
  private entries = new Map<string, Entry>();
  private live = new Set<string>();
  private waiters = new Set<() => void>();
  private closed = false;
  private concurrency: number;
  private onChange: () => void;

  constructor(concurrency = 5, onChange: () => void = () => {}) {
    this.concurrency = concurrencyLimit(String(concurrency));
    this.onChange = onChange;
  }

  list(): Task[] { return [...this.entries.values()].map(({ task }) => structuredClone(task)); }
  get(id: string): Task | undefined {
    const task = this.entries.get(id)?.task;
    return task && structuredClone(task);
  }
  hasWork(): boolean { return this.live.size > 0 || [...this.entries.values()].some(({ task }) => task.state === "queued"); }

  enqueue(assignment: Assignment, scopeKey: string, execute: Entry["execute"]): { task: Task; duplicate: boolean } {
    if (this.closed) throw new Error("This task queue is closed.");
    const { label: _label, ...meaning } = assignment;
    // Exact normalized duplicates only; semantic equivalence is the parent's responsibility.
    const key = JSON.stringify([scopeKey, { ...meaning, references: [...meaning.references].sort(), constraints: [...meaning.constraints].sort() }]);
    const duplicate = [...this.entries.values()].find((entry) => entry.key === key && ["queued", "running", "cancelling"].includes(entry.task.state));
    if (duplicate) return { task: structuredClone(duplicate.task), duplicate: true };
    if ([...this.entries.values()].filter(({ task }) => !task.delivered).length >= MAX_PENDING) {
      throw new Error("Eight outstanding assignments already exist. Integrate or cancel existing work first.");
    }
    for (const [id, entry] of this.entries) {
      if (this.entries.size < MAX_HISTORY) break;
      if (entry.task.delivered) this.entries.delete(id);
    }
    const task: Task = { id: `task-${randomUUID()}`, assignment: structuredClone(assignment), state: "queued", delivered: false, sourcesMayHaveChanged: false };
    this.entries.set(task.id, { task, key, controller: new AbortController(), execute });
    // Admission is synchronous; execution starts after the tool can return its task ID.
    queueMicrotask(() => this.pump());
    this.changed();
    return { task: structuredClone(task), duplicate: false };
  }

  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || !["queued", "running"].includes(entry.task.state)) return false;
    if (entry.task.state === "queued") {
      entry.task.state = "cancelled";
      entry.task.result = { status: "cancelled", output: "", error: "Cancelled before launch.", diagnostics: "", trace: [], truncated: false };
    } else entry.task.state = "cancelling";
    entry.controller.abort();
    this.changed();
    return true;
  }

  async cancelAll(close = false): Promise<void> {
    this.closed ||= close;
    // Remove queued work before stopping running children, so released slots cannot start it.
    for (const { task } of this.entries.values()) if (task.state === "queued") this.cancel(task.id);
    for (const { task } of this.entries.values()) if (task.state === "running") this.cancel(task.id);
    await this.waitForIdle();
  }

  async waitForIdle(signal?: AbortSignal): Promise<void> {
    if (!this.hasWork() || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => { this.waiters.delete(check); signal?.removeEventListener("abort", done); resolve(); };
      const check = () => { if (!this.hasWork()) done(); };
      this.waiters.add(check);
      signal?.addEventListener("abort", done, { once: true });
      check();
    });
  }

  async waitForTask(id: string): Promise<void> {
    if (!this.entries.has(id) || this.entries.get(id)?.task.result) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!this.entries.has(id) || this.entries.get(id)?.task.result) { this.waiters.delete(check); resolve(); }
      };
      this.waiters.add(check);
      check();
    });
  }

  pendingResults(): Task[] {
    return this.list().filter((task) => task.result && !task.delivered);
  }
  markDelivered(ids: string[]): void {
    for (const id of ids) { const task = this.entries.get(id)?.task; if (task?.result) task.delivered = true; }
    this.changed();
  }
  markSourcesPossiblyChanged(): void {
    for (const { task } of this.entries.values()) if (!task.delivered) task.sourcesMayHaveChanged = true;
  }

  private changed(): void {
    for (const waiter of this.waiters) waiter();
    // A display failure must not strand a process or corrupt the queue.
    try { this.onChange(); } catch { /* Pi may already be tearing down its UI. */ }
  }

  private pump(): void {
    if (this.closed) return;
    for (const entry of this.entries.values()) {
      if (this.live.size >= this.concurrency) break;
      if (entry.task.state !== "queued") continue;
      entry.task.state = "running";
      this.live.add(entry.task.id);
      this.changed();
      void Promise.resolve().then(() => entry.execute(entry.controller.signal)).catch((error): RunResult => ({
        status: "failed", output: "", error: error instanceof Error ? error.message : "Child execution failed.", diagnostics: "", trace: [], truncated: false,
      })).then((result) => {
        if (entry.controller.signal.aborted) result = { ...result, status: "cancelled", error: "Cancelled; any output is partial." };
        entry.task.result = result;
        entry.task.state = result.status;
        this.live.delete(entry.task.id);
        this.changed();
        this.pump();
      });
    }
  }
}
