import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Local presentation data only. No result payloads, task controls or model events. */
export const TASKS_EVENT = "stela:activity:tasks", REQUEST_TASKS = "stela:activity:request-tasks";
// One in-process span around the parent's actual await, not a task admission or a request to run anything.
export const HELPER_WAIT_EVENT = "stela:activity:helper-wait";
export interface HelperWaitSignal { manager: ExtensionContext["sessionManager"]; id: string; span: symbol; waiting: boolean }
export type TaskStatus = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
export type TaskRow = { id: string; label: string; objective: string; state: TaskStatus; lastAction?: string };
export interface TaskSignal { manager: ExtensionContext["sessionManager"]; id: string; tasks: TaskRow[]; launched: number; claim(): void }
export const activeState = (s: unknown): s is "queued" | "running" | "cancelling" => s === "queued" || s === "running" || s === "cancelling";
