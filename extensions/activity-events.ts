import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Presentation only: shared by the helper queue and the TUI. No result text, task control or model event. */
export const TASKS_EVENT = "stela:activity:tasks", REQUEST_TASKS = "stela:activity:request-tasks";
export type TaskRow = { label: string; state: "queued" | "running" | "cancelling" };
export interface TaskSignal { manager: ExtensionContext["sessionManager"]; id: string; tasks: TaskRow[]; claim(): void }
export const activeState = (s: unknown): s is TaskRow["state"] => s === "queued" || s === "running" || s === "cancelling";
