import { strict as assert } from "node:assert";
import { test } from "node:test";
import { registerKnowledge } from "../index.ts";
import { decodeReceipt, type Call } from "../client.ts";
import type { ObjectValue } from "../../memory/protocol.ts";

const project = "11111111-1111-1111-1111-111111111111", note = "22222222-2222-2222-2222-222222222222";
const additional = "33333333-3333-3333-3333-333333333333";
const meta = { project_id: project, note_id: note, title: "Names" };
const markdown = "---\nbrain_id: test\n---\n# Names\n";
function fixture() {
  const tools = new Map<string, any>(), handlers = new Map<string, any[]>(), active = new Set<string>();
  const ctx = { cwd: "/workspace", sessionManager: { getSessionId: () => "owner" } };
  const calls: { operation: string; args: ObjectValue }[] = [];
  let writeResult: ObjectValue | undefined, valid = true, ids: string[] = [];
  const call: Call = async (operation, args) => {
    calls.push({ operation, args });
    const selected = args.project_id ?? project;
    if (operation === "read") return args.note_id === note ? { status: "found", ...meta, project_id: selected, markdown, body: "# Names\n" } : { status: "not_found" };
    if (operation === "list") return { status: "listed", project_id: selected, notes: [{ note_id: note, title: "Names" }] };
    return writeResult ?? { status: operation === "create" ? "created" : "updated", ...meta };
  };
  registerKnowledge({
    on(event: string, fn: any) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); },
    registerTool(tool: any) { tools.set(tool.name, tool); if (tool.defaultActive) active.add(tool.name); },
    getActiveTools: () => [...active], registerCommand() {},
  } as never, { env: {}, scope: () => ({ valid: () => valid, call }),
    projects: () => ({ valid: () => true, authority: { executable: "fixture", environment: "[]", vaultScope: "fixture" },
      call: async () => ({ status: "listed", projects: [
      { project_id: project, title: "Principal", path: "01-proyectos/principal/Proyecto.md" },
      { project_id: additional, title: "Adicional", path: "01-proyectos/adicional/Proyecto.md" },
    ] }) }),
    preference: async () => { const observed = ids; return { ids: observed, valid: () => ids === observed, commit() {} }; },
  });
  const emit = (event: string, data = {}) => { for (const fn of handlers.get(event) ?? []) fn(data, ctx); };
  emit("session_start");
  return { calls, active, emit, setWrite: (value: ObjectValue) => { writeResult = value; }, revoke: () => { valid = false; },
    select: (next: string[]) => { ids = next; },
    run: async (op: string, input: ObjectValue = {}) => {
      const result = await tools.get(`ss_knowledge_${op}`).execute("call", input, undefined, undefined, ctx);
      return JSON.parse(result.content[0].text);
    } };
}

test("read starts only after input, exposes body not baseline, and rejects unknown scope arguments", async () => {
  const h = fixture();
  assert.deepEqual(await h.run("list"), { status: "denied" });
  h.emit("input", { source: "rpc" });
  assert.deepEqual(await h.run("list", { project_id: "invalid-id" }), { status: "invalid" });
  assert.deepEqual(await h.run("read", { note_id: note }), { status: "found", note_id: note, title: "Names", body: "# Names\n" });
  assert.equal(h.calls.length, 1);
  h.revoke();
  assert.deepEqual(await h.run("read", { note_id: note }), { status: "scope_or_activity_changed" });
  assert.equal(h.calls.length, 1);
});

test("writes need tool activation, a scoped list for create and a private read baseline for update", async () => {
  const h = fixture(); h.emit("input", { source: "interactive" });
  assert.deepEqual(await h.run("create", { title: "Contract", body: "# Contract" }), { status: "denied" });
  h.active.add("ss_knowledge_create"); h.active.add("ss_knowledge_update");
  assert.deepEqual(await h.run("create", { title: "Contract", body: "# Contract" }), { status: "list_required" });
  await h.run("list");
  assert.equal((await h.run("create", { title: "Contract", body: "# Contract" })).status, "created");
  assert.deepEqual(h.calls.at(-1)?.args, { title: "Contract", body: "# Contract", project_id: project, require_named_link: true });
  assert.deepEqual(await h.run("update", { note_id: note, body: "new" }), { status: "read_required" });
  await h.run("read", { note_id: note });
  h.setWrite({ status: "conflict" });
  assert.deepEqual(await h.run("update", { note_id: note, body: "new" }), { status: "conflict" });
  assert.deepEqual(h.calls.at(-1)?.args, { note_id: note, body: "new", project_id: project, expected_markdown: markdown });
  assert.deepEqual(await h.run("update", { note_id: note, body: "try again" }), { status: "read_required" });
});

test("a Brain that rejects named linked creation is not retried without the host guard", async () => {
  const h = fixture(); h.emit("input", { source: "rpc" });
  h.active.add("ss_knowledge_create");
  await h.run("list");
  assert.deepEqual(await h.run("create", { title: "Contract", body: "body", require_named_link: false }), { status: "invalid" });
  h.setWrite({ status: "invalid" });
  assert.deepEqual(await h.run("create", { title: "Contract", body: "body" }), { status: "invalid" });
  assert.deepEqual(h.calls.filter(c => c.operation === "create").map(c => c.args.require_named_link), [true]);
});

test("unconfirmed publication pauses writes without preventing inspection or clearing on navigation", async () => {
  const h = fixture(); h.emit("input", { source: "rpc" });
  h.active.add("ss_knowledge_create"); h.active.add("ss_knowledge_update");
  await h.run("list"); h.setWrite({ status: "save_unconfirmed" });
  assert.deepEqual(await h.run("create", { title: "Contract", body: "body" }), { status: "save_unconfirmed" });
  h.emit("session_tree"); h.emit("input", { source: "rpc" });
  assert.equal((await h.run("read", { note_id: note })).status, "found");
  assert.deepEqual(await h.run("update", { note_id: note, body: "new" }), { status: "write_paused" });
  assert.equal(h.calls.filter(c => c.operation === "create" || c.operation === "update").length, 1);
});

test("additional sources require explicit selection and never seed a write baseline", async () => {
  const h = fixture(); h.emit("input", { source: "interactive" });
  h.active.add("ss_knowledge_create"); h.active.add("ss_knowledge_update");
  assert.deepEqual(await h.run("read", { project_id: additional, note_id: note }), { status: "source_not_enabled" });
  assert.equal(h.calls.some(c => c.args.project_id === additional), false);
  h.select([additional]);
  assert.deepEqual((await h.run("sources")).sources, [{ project_id: additional, title: "Adicional", path: "01-proyectos/adicional/Proyecto.md", read_only: true }]);
  assert.deepEqual((await h.run("read", { project_id: additional, note_id: note })).source,
    { project_id: additional, title: "Adicional", read_only: true });
  assert.deepEqual(await h.run("update", { note_id: note, body: "no" }), { status: "read_required" });
  assert.deepEqual(await h.run("create", { title: "No", body: "no" }), { status: "list_required" });
  assert.deepEqual(await h.run("create", { title: "No", body: "no", project_id: additional }), { status: "invalid" });
  h.select([]);
  assert.deepEqual(await h.run("read", { project_id: additional, note_id: note }), { status: "source_not_enabled" });
});

test("checks strict receipt correlation and does not disclose failure messages", () => {
  const id = "request", wire = (data: object, request_id = id) => Buffer.from(JSON.stringify({ protocol_version: 1, request_id, result: data }) + "\n");
  const found = { status: "found", ...meta, markdown, body: "# Names\n" };
  assert.deepEqual(decodeReceipt(wire(found), id, "read", { note_id: note }), found);
  assert.throws(() => decodeReceipt(wire(found, "wrong"), id, "read", { note_id: note }));
  assert.throws(() => decodeReceipt(wire(found), id, "read", { note_id: project }));
  assert.throws(() => decodeReceipt(wire({ status: "listed", project_id: project, notes: [{ note_id: note, title: "x" }, { note_id: note, title: "y" }] }), id, "list", {}));
  const created = { status: "created", ...meta };
  assert.deepEqual(decodeReceipt(wire(created), id, "create", { project_id: project, title: meta.title }), created);
  assert.throws(() => decodeReceipt(wire(created), id, "create", { project_id: project, title: "Other title" }));
  assert.deepEqual(decodeReceipt(wire({ status: "denied", message: "/private/path" }), id, "create", {}), { status: "denied" });
  assert.deepEqual(decodeReceipt(wire({ status: "output_limit", message: "output" }), id, "update", {}), { status: "save_unconfirmed" });
});
