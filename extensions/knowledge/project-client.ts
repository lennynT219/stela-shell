import { brainCall } from "./client.ts";
import { minimalEnvironment } from "../memory/client.ts";
import { observeConfiguredVault } from "../memory/configuration.ts";
import { resolveExecutable, selectExecutable } from "../memory/executable.ts";
import { parse, stringify, uuid, type ObjectValue, type Value } from "../memory/protocol.ts";
import type { ProjectChoice } from "./project-menu.ts";

export type ProjectOperation = "status" | "list" | "read" | "draft_context" | "preview_create" | "bind" | "create_and_bind" | "update_body";
const DOCUMENT_BYTES = 512 * 1024;
export type ProjectCall = (op: ProjectOperation, args: ObjectValue, signal: AbortSignal) => Promise<ObjectValue>;
export const record = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (r: ObjectValue, ...keys: string[]) => Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k));
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && Buffer.byteLength(v) <= max;
const display = (v: unknown, max: number): v is string => bounded(v, max) && !!v.trim() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v);
const pathOk = (v: unknown): v is string => display(v, 4096) && /^01-proyectos\/[^/:\\]+\/[^/:\\]+\.md$/u.test(v) && v.split("/").every(s => s !== "." && s !== "..");
const project = (v: unknown): v is ObjectValue => record(v) && exact(v, "project_id", "title", "path") && uuid(v.project_id) && display(v.title, 1024) && pathOk(v.path);
export function choice(v: Value): ProjectChoice {
  if (!project(v)) throw new Error("Invalid Project description");
  return { id: String(v.project_id), title: String(v.title), path: String(v.path) };
}
const isWrite = (op: ProjectOperation) => op === "bind" || op === "create_and_bind" || op === "update_body";
const baseline = (v: unknown) => record(v) && exact(v, "vault_directory", "marker", "legacy_marker", "memory") &&
  bounded(v.vault_directory, 64 * 1024) && !!v.vault_directory && !v.vault_directory.includes("\0") &&
  [v.marker, v.legacy_marker].every(x => x === null || bounded(x, 8 * 1024)) && record(v.memory) && typeof v.memory.status === "string";
const revision = (v: unknown): v is number | bigint => typeof v === "number" ? Number.isSafeInteger(v) && v > 0 : typeof v === "bigint" && v > 0;
function memoryMatches(receipt: unknown, expected: Value) {
  if (!record(receipt) || !record(expected) || !record(expected.memory)) return false;
  const resolved = expected.memory;
  if (resolved.status === "unbound") return receipt.status === "deferred" && exact(receipt, "status");
  const before = resolved.memory;
  return resolved.status === "found" && record(before) && before.status === "found" && uuid(before.memory_id) &&
    ["associated", "unchanged"].includes(String(receipt.status)) && exact(receipt, "status", "memory_id", "revision") &&
    receipt.memory_id === before.memory_id && revision(before.revision) && revision(receipt.revision) &&
    BigInt(receipt.revision) === BigInt(before.revision) + (receipt.status === "associated" ? 1n : 0n);
}
const history = (v: unknown) => {
  if (!record(v)) return false;
  if (v.status === "unavailable") return exact(v, "status", "reason") && bounded(v.reason, 4096);
  return v.status === "found" && exact(v, "status", "format", "markdown", "returned_bytes", "total_bytes", "truncated") &&
    (v.format === 1 || v.format === 2) && bounded(v.markdown, 32768) && typeof v.total_bytes === "number" &&
    Number.isSafeInteger(v.total_bytes) && v.returned_bytes === Buffer.byteLength(v.markdown) &&
    v.total_bytes >= v.returned_bytes && v.truncated === (v.total_bytes > v.returned_bytes);
};
const failures = new Set(["invalid", "unbound", "unavailable", "unsupported", "denied", "not_found", "conflict", "partial", "manual_review", "busy", "too_large", "input_limit", "output_limit", "save_unconfirmed"]);

export function decodeProject(output: Uint8Array, requestId: string, op: ProjectOperation, args: ObjectValue): ObjectValue {
  const invalid = (): never => { throw new Error("Invalid Brain projects receipt"); };
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) return invalid();
  const e = parse(text);
  if (!record(e) || !exact(e, "protocol_version", "request_id", "operation", "result") || e.protocol_version !== 1 ||
      e.request_id !== requestId || e.operation !== op || !record(e.result)) return invalid();
  const r = e.result;
  const destination = op === "create_and_bind" ? args.preview : args.expected_project;
  const matches = (v: unknown) => project(v) && record(destination) && v.project_id === destination.project_id &&
    v.path === destination.path && v.title === destination.title && (op !== "bind" || v.project_id === args.project_id);
  if (r.status === "partial" && (Object.hasOwn(r, "project") || Object.hasOwn(r, "project_reserved") ||
      Object.hasOwn(r, "project_created") || Object.hasOwn(r, "notes_created"))) {
    if ((op !== "bind" && op !== "create_and_bind") || !exact(r, "status", "project_created", "project_reserved", "notes_created", "project", "reason", "message") ||
        !matches(r.project) || ![r.project_created, r.project_reserved, r.notes_created].every(v => typeof v === "boolean") ||
        (r.project_created && !r.project_reserved) || (op === "bind" && (r.project_created || r.project_reserved)) ||
        !bounded(r.reason, 4096) || !bounded(r.message, 4096)) return invalid();
    const { message: _privateMessage, reason: _privateReason, ...receipt } = r;
    return receipt;
  }
  if (typeof r.status === "string" && failures.has(r.status) && Object.hasOwn(r, "message")) {
    if (!(exact(r, "status", "message") || (exact(r, "status", "message", "reason") && bounded(r.reason, 4096))) || !bounded(r.message, 4096)) return invalid();
    if (op === "preview_create" && r.status === "invalid" && r.reason === "INVALID_PROJECT_FILENAME") {
      return { status: "invalid", reason: r.reason };
    }
    return { status: isWrite(op) && ["partial", "output_limit", "save_unconfirmed", "too_large"].includes(r.status) ? "save_unconfirmed" : r.status };
  }
  if (op === "status") {
    if (!exact(r, "status", "binding", "allow_write", "principal", "expected") || !baseline(r.expected) || typeof r.allow_write !== "boolean" ||
        !["unified", "legacy", "none"].includes(String(r.binding)) ||
        !(r.status === "unbound" && r.principal === null && r.allow_write === false || r.status === "found" && project(r.principal) && r.binding !== "none")) return invalid();
  } else if (op === "list") {
    if (!exact(r, "status", "projects") || r.status !== "listed" || !Array.isArray(r.projects) || r.projects.length > 1024 ||
        !r.projects.every(project) || new Set(r.projects.map(p => p.project_id)).size !== r.projects.length) return invalid();
  } else if (op === "read") {
    if (!exact(r, "status", "project", "markdown", "body") || r.status !== "found" || !project(r.project) ||
        r.project.project_id !== args.project_id || !bounded(r.markdown, DOCUMENT_BYTES) || !bounded(r.body, DOCUMENT_BYTES) ||
        r.markdown.length <= r.body.length || !r.markdown.endsWith(r.body)) return invalid();
  } else if (op === "update_body") {
    if (!exact(r, "status", "project") || !["updated", "unchanged"].includes(String(r.status)) || !matches(r.project)) return invalid();
  } else if (op === "draft_context") {
    if (!exact(r, "status", "memory", "history") || r.status !== "found" || !record(r.memory) || typeof r.memory.status !== "string" || !history(r.history)) return invalid();
  } else if (op === "preview_create") {
    const p = r.preview;
    if (!exact(r, "status", "preview", "expected") || r.status !== "preview" || !baseline(r.expected) || !record(p) ||
        !exact(p, "project_id", "title", "body", "path") || !uuid(p.project_id) || !pathOk(p.path) || !display(p.title, 1024) ||
        p.title !== args.title || p.body !== args.body) return invalid();
  } else {
    if (r.status !== "bound" || !exact(r, "status", "project", "allow_write", "memory", "created", "notes_created") ||
        !matches(r.project) || r.allow_write !== true || r.created !== (op === "create_and_bind") ||
        typeof r.notes_created !== "boolean" || !memoryMatches(r.memory, args.expected)) return invalid();
  }
  return r;
}

export function projectClient(cwd: string, source: NodeJS.ProcessEnv) {
  const selection = selectExecutable(source), env = minimalEnvironment(source);
  const executable = resolveExecutable(selection, cwd), vaultScope = observeConfiguredVault(env);
  const environment = JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  const signature = () => stringify({ selection: { ...selectExecutable(source) }, env: minimalEnvironment(source) as ObjectValue }, 64 * 1024);
  const initial = signature();
  let revoked = false;
  const valid = () => {
    try { if (signature() !== initial || observeConfiguredVault(env) !== vaultScope || vaultScope === undefined) revoked = true; }
    catch { revoked = true; }
    return !revoked;
  };
  const call: ProjectCall = (op, args, signal) => !valid() ? Promise.resolve({ status: "unavailable" }) :
    brainCall(executable, cwd, env, "projects", op, args, signal, isWrite(op), (bytes, id, input) => decodeProject(bytes, id, op, input));
  return { valid, call, authority: { executable, environment, vaultScope } };
}
