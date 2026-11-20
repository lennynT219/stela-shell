// Brain owns Memory interpretation. This module validates the v1 transport and
// typed receipts; returned context/paths/approvals remain untrusted data.
const LEGACY_OPERATIONS = ["capabilities", "resolve", "read", "create", "replace_missing", "update", "accept_external", "inspect_recovery", "recover"] as const;
export const OPERATIONS = [...LEGACY_OPERATIONS, "update_sections"] as const;
export type Operation = typeof OPERATIONS[number];
export type Value = null | boolean | string | number | bigint | Value[] | { [key: string]: Value };
export type ObjectValue = { [key: string]: Value };
export interface Request { protocol_version: 1; request_id: string; operation: Operation; arguments: ObjectValue; vault?: string }
export interface Response { protocol_version: 1; request_id: string; operation: Operation; result: ObjectValue }
export const U64_MAX = 18_446_744_073_709_551_615n;
export class ProtocolError extends Error { constructor() { super("Invalid or incompatible Brain Memory protocol."); this.name = "ProtocolError"; } }
const invalid = (): never => { throw new ProtocolError(); };
const record = (v: unknown): v is ObjectValue => !!v && typeof v === "object" && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000";
const uint = (v: unknown): v is number | bigint => typeof v === "number" ? Number.isSafeInteger(v) && v > 0 : typeof v === "bigint" && v > 0n && v <= U64_MAX;
function keys(v: ObjectValue, required: string[], optional: string[] = []) {
  if (!required.every(k => Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) invalid();
}
function identity(v: Value, expected?: Value) { if (!uuid(v) || (expected !== undefined && v !== expected)) invalid(); }
const nullableString = (v: Value) => v === null || typeof v === "string";

/** Node's source-aware JSON API preserves the complete u64 range, without a library. */
export function requireJSONRuntime() {
  let source: string | undefined;
  JSON.parse("9007199254740993", ((_k: string, _v: unknown, context: { source?: string }) => { source = context?.source; }) as never);
  if (source !== "9007199254740993" || typeof (JSON as any).rawJSON !== "function") invalid();
}
/** Reject duplicate keys (including escaped aliases) and excessive nesting before parsing. */
function structure(text: string) {
  const stack: (Set<string> | null)[] = []; let key = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      for (; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      if (i >= text.length) invalid();
      if (key && stack.at(-1)) {
        let name: string; try { name = JSON.parse(text.slice(start, i + 1)); } catch { return invalid(); }
        if (stack.at(-1)!.has(name)) invalid(); stack.at(-1)!.add(name); key = false;
      }
    } else if (c === "{" || c === "[") {
      if (stack.length >= 64) invalid(); stack.push(c === "{" ? new Set() : null); key = c === "{";
    } else if (c === "}" || c === "]") { stack.pop(); key = false; }
    else if (c === ",") key = stack.at(-1) instanceof Set;
    else if (c === ":") key = false;
  }
}
export function parse(text: string): Value {
  structure(text);
  try {
    return JSON.parse(text, ((_key: string, value: unknown, context: { source?: string }) => {
      if (typeof value !== "number") return value;
      if (!context?.source || !/^-?(0|[1-9]\d*)$/.test(context.source)) invalid();
      const integer = BigInt(context.source);
      if (integer < -U64_MAX || integer > U64_MAX) invalid();
      return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer;
    }) as never) as Value;
  } catch { return invalid(); }
}
/** Preflight bounds even an already-large string before JSON.stringify allocates escaped output. */
export function stringify(value: Value | Request, limit: number): string {
  let lowerBound = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++lowerBound > limit || depth > 64) invalid();
    if (typeof v === "string") lowerBound += Buffer.byteLength(v);
    else if (typeof v === "bigint") { if (v < -U64_MAX || v > U64_MAX) invalid(); }
    else if (typeof v === "number") { if (!Number.isSafeInteger(v)) invalid(); }
    else if (v !== null && typeof v !== "boolean") {
      if (!v || typeof v !== "object" || ancestors.has(v)) invalid();
      const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
      if (![null, array ? Array.prototype : Object.prototype].includes(prototype)) invalid();
      const serializer = Object.getOwnPropertyDescriptor(v, "toJSON");
      if (serializer && (!Object.hasOwn(serializer, "value") || typeof serializer.value === "function")) invalid();
      // Sparse arrays can expand to enormous null-filled JSON despite having no
      // enumerable keys. Bound length first, then require plain dense contents.
      if (array && ((v as unknown[]).length > Math.floor((limit - 1) / 2) || Object.keys(v).length !== (v as unknown[]).length)) invalid();
      ancestors.add(v);
      const visitField = (k: string) => {
        const descriptor = Object.getOwnPropertyDescriptor(v, k);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid(); visit(descriptor.value, depth + 1);
      };
      if (array) {
        for (let i = 0; i < (v as unknown[]).length; i++) visitField(String(i));
      } else for (const k of Object.keys(v)) {
        lowerBound += Buffer.byteLength(k); if (lowerBound > limit) invalid(); visitField(k);
      }
      ancestors.delete(v);
    }
    if (lowerBound > limit) invalid();
  };
  visit(value, 0);
  const text = JSON.stringify(value, (_key, v) => typeof v === "bigint" ? (JSON as any).rawJSON(v.toString()) : v);
  if (Buffer.byteLength(text) > limit) invalid();
  return text;
}
function state(v: Value, id: Value) {
  if (!record(v)) invalid();
  keys(v, ["status", "memory_id", "revision", "accepted_markdown", "observed_markdown", "approval_candidate", "reason"]);
  identity(v.memory_id, id);
  if (!["found", "manual_review", "partial", "not_found"].includes(v.status as string) ||
      !(v.revision === null || uint(v.revision)) || ![v.accepted_markdown, v.observed_markdown, v.approval_candidate, v.reason].every(nullableString)) invalid();
  if (["found", "manual_review"].includes(v.status as string) && (!uint(v.revision) || typeof v.accepted_markdown !== "string")) invalid();
  if (v.status === "manual_review" && typeof v.observed_markdown !== "string") invalid();
}
function observation(v: Value, id: Value) {
  if (!record(v)) invalid();
  keys(v, ["memory_id", "current", "history", "pending", "marker", "reservation", "history_corrupt"], ["reassociation", "history_bytes", "accepted_head"]);
  identity(v.memory_id, id);
  if (![v.current, v.history, v.pending, v.marker, v.reservation].every(nullableString) || typeof v.history_corrupt !== "boolean" ||
      (v.reassociation !== undefined && typeof v.reassociation !== "string") ||
      (v.accepted_head !== undefined && typeof v.accepted_head !== "string") ||
      (v.history_bytes !== undefined && (!Array.isArray(v.history_bytes) || !v.history_bytes.every(n => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)))) invalid();
}
export function decode(bytes: Uint8Array, request: Request, inputLimit: number, outputLimit: number): Response {
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return invalid(); }
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) invalid();
  const envelope = parse(text);
  if (!record(envelope)) invalid();
  keys(envelope, ["protocol_version", "request_id", "operation", "result"]);
  if (envelope.protocol_version !== 1 || envelope.request_id !== request.request_id || envelope.operation !== request.operation || !record(envelope.result)) invalid();
  const r = envelope.result, a = request.arguments;
  if (typeof r.status !== "string") invalid();
  // All serialized Failure variants carry a message. Never surface that text as trusted diagnostics.
  if (Object.hasOwn(r, "message")) {
    keys(r, ["status", "message"], ["memory_id", "io_kind", "reason", "required_bytes"]);
    if (!["not_found", "unavailable", "busy", "conflict", "manual_review", "partial", "invalid", "unsupported", "too_large"].includes(r.status) ||
        typeof r.message !== "string" || (r.memory_id !== undefined && !uuid(r.memory_id)) ||
        ["io_kind", "reason"].some(k => r[k] !== undefined && typeof r[k] !== "string") ||
        (r.required_bytes !== undefined && !uint(r.required_bytes))) invalid();
  } else if (request.operation === "capabilities") {
    keys(r, ["status", "protocol_version", "brain_version", "operations", "max_input_bytes", "max_output_bytes", "history_version", "document_version", "lock", "authority", "cancellation"]);
    const versions = r.history_version === 1 ? [LEGACY_OPERATIONS] : r.history_version === 2 ? [OPERATIONS] : [];
    const supported = Array.isArray(r.operations) ? r.operations : [];
    if (r.status !== "found" || r.protocol_version !== 1 || r.document_version !== 1 || typeof r.brain_version !== "string" ||
        !versions.some(ops => supported.length === ops.length && ops.every((op,i) => supported[i] === op)) ||
        r.max_input_bytes !== inputLimit || r.max_output_bytes !== outputLimit || r.lock !== "std_try_lock" || r.authority !== "trusted_local_caller" ||
        r.cancellation !== "host_terminates_process; mutation_confirmation_may_be_lost") invalid();
  } else if (request.operation === "read") state(r, a.memory_id);
  else if (request.operation === "resolve") {
    if (r.status === "unbound") {
      keys(r, ["status", "directory"], ["declared_by"]);
      if (typeof r.directory !== "string" || (r.declared_by !== undefined && typeof r.declared_by !== "string")) invalid();
    } else if (r.reason === "unfinished_creation" && !Object.hasOwn(r, "memory")) {
      keys(r, ["status", "directory", "memory_id", "request_id", "reason"]);
      if (r.status !== "partial" || typeof r.directory !== "string") invalid(); identity(r.memory_id); identity(r.request_id);
    } else {
      keys(r, ["status", "binding_directory", "binding", "memory"]);
      if (typeof r.binding_directory !== "string" || !record(r.binding)) invalid();
      keys(r.binding, ["binding_version", "memory_id"], ["memory_subfolders"]);
      if (r.binding.binding_version !== 1 || (r.binding.memory_subfolders !== undefined && (!Array.isArray(r.binding.memory_subfolders) || !r.binding.memory_subfolders.every(p => typeof p === "string")))) invalid();
      identity(r.binding.memory_id); state(r.memory, r.binding.memory_id);
      if ((r.memory as ObjectValue).status !== r.status) invalid();
    }
  } else if (request.operation === "inspect_recovery") {
    keys(r, ["status", "observation"], ["reason"]);
    observation(r.observation, a.memory_id);
    if (!((r.status === "found" && (r.observation as ObjectValue).history_corrupt === false && r.reason === undefined) ||
        (r.status === "partial" && r.reason === "history_corrupt" && (r.observation as ObjectValue).history_corrupt === true))) invalid();
  } else {
    keys(r, ["status", "memory_id", "revision", "request_id"], request.operation === "replace_missing" ? ["replaced_memory_id"] : []);
    identity(r.memory_id, request.operation === "create" || request.operation === "replace_missing" ? undefined : a.memory_id);
    identity(r.request_id, request.operation === "recover" ? undefined : request.request_id);
    if (!uint(r.revision) || !(r.status === "saved" || ((request.operation === "update" || request.operation === "update_sections") && r.status === "unchanged"))) invalid();
    if (request.operation === "update_sections" && a.edits !== undefined) {
      // The entire batch is one update or a no-op. A contradictory revision is
      // not a publication receipt, even if the request and Memory IDs match.
      if (!record(a.expected) || !uint(a.expected.revision) ||
          BigInt(r.revision) !== BigInt(a.expected.revision) + (r.status === "saved" ? 1n : 0n)) invalid();
    }
    if (request.operation === "create" && r.revision !== 1) invalid();
    if (request.operation === "replace_missing") {
      identity(r.replaced_memory_id, a.expected_memory_id);
      if (r.memory_id === r.replaced_memory_id || r.revision !== 1) invalid();
    }
  }
  return envelope as unknown as Response;
}
