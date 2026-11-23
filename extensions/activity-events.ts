import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Local presentation data only. No result payloads, task controls or model events. */
export const TASKS_EVENT = "stela:activity:tasks", REQUEST_TASKS = "stela:activity:request-tasks";
export type TaskStatus = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
export type TaskRow = { id: string; label: string; objective: string; state: TaskStatus; lastAction?: string };
export interface TaskSignal { manager: ExtensionContext["sessionManager"]; id: string; tasks: TaskRow[]; launched: number; claim(): void }
export const activeState = (s: unknown): s is "queued" | "running" | "cancelling" => s === "queued" || s === "running" || s === "cancelling";
