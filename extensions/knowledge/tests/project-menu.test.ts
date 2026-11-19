import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeProject } from "../project-client.ts";
import { projectMenu, sourcesMenu, type ProjectChoice } from "../project-menu.ts";

const principal: ProjectChoice = { id: "11111111-1111-4111-8111-111111111111", title: "Principal", path: "01-proyectos/principal/Proyecto.md" };
const additional: ProjectChoice = { id: "22222222-2222-4222-8222-222222222222", title: "Adicional", path: "01-proyectos/adicional/Proyecto.md" };
const other: ProjectChoice = { id: "33333333-3333-4333-8333-333333333333", title: "Otro", path: "01-proyectos/otro/Proyecto.md" };
const created: ProjectChoice = { ...principal, title: "StelaShell", path: `01-proyectos/stelashell-${principal.id}/StelaShell.md` };
const draft = "## Summary\n\nEntorno personal sobre Pi.\n\n## Objective\n\nIntegrar Brain.\n\n## Scope\n\nExtensiones de Pi.\n";

function ui(actions: RegExp[], approve = true) {
  const notices: string[] = [], confirms: { title: string; message: string }[] = [];
  return {
    notices, confirms,
    async select(_title: string, labels: string[]) {
      const action = actions.shift();
      if (!action) return;
      const match = labels.find(label => action.test(label));
      assert.ok(match, `missing ${action} in ${labels.join("; ")}`);
      return match;
    },
    async input() { return ""; },
    async editor(_title: string, body?: string) { assert.equal(body, draft); return body + "\n## References\n\nDocumentación del proyecto.\n"; },
    async confirm(title: string, message: string) { confirms.push({ title, message }); return approve; },
    notify(message: string) { notices.push(message); },
  };
}

test("creation lets the operator review the Spanish draft and applies the exact edited preview once", async () => {
  const view = ui([/Crear un Project/, /Generar borrador/]);
  let writes = 0;
  await projectMenu(view, created.title, {
    status: async () => ({ memory: "unbound" }),
    list: async () => { throw Error("no catalog needed for creation"); },
    draft: async input => { assert.deepEqual(input, { title: created.title, description: "" }); return draft; },
    preview: async (title, body) => {
      assert.equal(title, created.title);
      assert.match(body, /## References\n\nDocumentación del proyecto\./);
      return { path: created.path, apply: async () => { writes++; return { status: "partial", project: created,
        effects: { created: true, reserved: true, notesCreated: true } }; } };
    },
    bind: async () => { throw Error("no automatic second write"); },
  });
  assert.equal(writes, 1);
  assert.equal(view.confirms.length, 1);
  assert.equal(view.confirms[0].title, "Crear y vincular");
  assert.ok(view.confirms[0].message.includes(created.path));
  assert.match(view.confirms[0].message, /primer guardado útil/);
  assert.match(view.notices.join("\n"), /Project creado[\s\S]*No se confirmó el vínculo/);
});

test("creation does not confirm or apply a generic filename offered by an older Brain", async () => {
  const view = ui([/Crear un Project/, /Generar borrador/]);
  await projectMenu(view, created.title, {
    status: async () => ({ memory: "unbound" }), list: async () => [], draft: async () => draft,
    preview: async () => ({ path: created.path.replace(/StelaShell\.md$/, "Proyecto.md"),
      apply: async () => { throw Error("must not submit a mismatched filename"); } }),
    bind: async () => { throw Error("not a bind"); },
  });
  assert.equal(view.confirms.length, 0);
  assert.match(view.notices.join("\n"), /no coincide con el nombre del Project/);
});

test("cancelling a rebind writes nothing and shows the old and new Projects", async () => {
  const view = ui([/Seleccionar un Project/, /Adicional/], false);
  await projectMenu(view, "workspace", {
    status: async () => ({ principal, memory: "found" }), list: async () => [additional],
    draft: async () => undefined, preview: async () => { throw Error("not a creation"); },
    bind: async () => { throw Error("no write without approval"); },
  });
  assert.equal(view.confirms.length, 1);
  assert.match(view.confirms[0].message, /Principal.*→ Adicional/);
  assert.match(view.confirms[0].message, /conservando su identidad y su historial/);
});

test("reservation only is reported as partial, not as a created Project", async () => {
  const view = ui([/Crear un Project/, /Generar borrador/]);
  await projectMenu(view, created.title, {
    status: async () => ({ memory: "unbound" }), list: async () => [], draft: async () => draft,
    preview: async () => ({ path: created.path, apply: async () => ({ status: "partial", project: created,
      effects: { created: false, reserved: true, notesCreated: false } }) }),
    bind: async () => { throw Error("no automatic binding"); },
  });
  assert.match(view.notices.join("\n"), /Carpeta reservada.*no hay ficha confirmada/);
  assert.doesNotMatch(view.notices.join("\n"), /Project creado|Carpeta vinculada/);
});

test("select multiple read-only sources, reset them, or cancel without committing", async () => {
  const writes: (readonly string[])[] = [];
  const port = {
    status: async () => ({ principal, memory: "unavailable" as const }),
    list: async () => [principal, additional, other], selected: async () => [other.id],
    async apply(ids: readonly string[]) { writes.push(ids); assert.ok(!ids.includes(principal.id)); },
  };
  await sourcesMenu(ui([/Adicional.*solo lectura/, /Aplicar/]), port);
  await sourcesMenu(ui([/Restablecer$/]), port);
  await sourcesMenu(ui([/Adicional.*solo lectura/, /Cancelar/]), port);
  assert.deepEqual(writes, [[additional.id, other.id], []]);
});

test("project receipts match request, editable body and selected identity; partial creation is not success", () => {
  const id = "request";
  const project = { project_id: created.id, title: created.title, path: created.path };
  const preview = { ...project, body: draft }, expected = { vault_directory: "/private-vault", marker: null, legacy_marker: null, memory: { status: "unbound" } };
  const draftArgs = { title: created.title, body: draft };
  const wire = (operation: string, result: object, request_id = id) => Buffer.from(JSON.stringify({ protocol_version: 1, operation, request_id, result }) + "\n");
  const response = { status: "preview", preview, expected };
  const invalidName = { status: "invalid", reason: "INVALID_PROJECT_FILENAME" };
  assert.deepEqual(decodeProject(wire("preview_create", { ...invalidName, message: "private backend message" }), id,
    "preview_create", { ...draftArgs, title: "CON" }), invalidName);
  assert.deepEqual(decodeProject(wire("preview_create", { ...invalidName, reason: "arbitrary", message: "private" }), id,
    "preview_create", draftArgs), { status: "invalid" });
  assert.deepEqual(decodeProject(wire("preview_create", response), id, "preview_create", draftArgs), response);
  assert.throws(() => decodeProject(wire("preview_create", response), id, "preview_create", { ...draftArgs, body: draft + "changed" }));
  assert.throws(() => decodeProject(wire("preview_create", response, "unexpected"), id, "preview_create", draftArgs));
  const { vault_directory: _vault, ...legacyBaseline } = expected;
  assert.throws(() => decodeProject(wire("preview_create", { ...response, expected: legacyBaseline }), id, "preview_create", draftArgs));
  for (const project_created of [true, false]) {
    const partial = { status: "partial", project_created, project_reserved: true, notes_created: false, project };
    assert.deepEqual(decodeProject(wire("create_and_bind", { ...partial, reason: "internal", message: "private" }), id,
      "create_and_bind", { preview, expected }), partial);
    assert.throws(() => decodeProject(wire("create_and_bind", partial), id, "create_and_bind", { preview, expected }));
  }
  const bound = { status: "bound", project, allow_write: true, memory: { status: "deferred" }, created: true, notes_created: false };
  assert.deepEqual(decodeProject(wire("create_and_bind", bound), id, "create_and_bind", { preview, expected }), bound);
  const existingProject = { project_id: principal.id, title: principal.title, path: principal.path };
  const bind = { ...bound, project: existingProject, created: false, notes_created: true };
  const args = { project_id: principal.id, expected_project: existingProject, expected };
  assert.deepEqual(decodeProject(wire("bind", bind), id, "bind", args), bind);
  assert.throws(() => decodeProject(wire("bind", { ...bind, created: true }), id, "bind", args));
  assert.throws(() => decodeProject(wire("bind", { ...bind, project: { ...existingProject, title: "Changed" } }), id, "bind", args));
  const memory_id = other.id;
  const found = { ...expected, memory: { status: "found", memory: { status: "found", memory_id, revision: 7 } } };
  const associated = { ...bind, memory: { status: "associated", memory_id, revision: 8 } };
  const foundArgs = { ...args, expected: found };
  assert.deepEqual(decodeProject(wire("bind", associated), id, "bind", foundArgs), associated);
  assert.throws(() => decodeProject(wire("bind", { ...associated, memory: { ...associated.memory, memory_id: additional.id } }), id, "bind", foundArgs));
  assert.throws(() => decodeProject(wire("bind", { ...associated, memory: { ...associated.memory, revision: 7 } }), id, "bind", foundArgs));
  assert.throws(() => decodeProject(wire("create_and_bind", { status: "conflict", message: "conflicting evidence", project_created: true }), id,
    "create_and_bind", { preview }), "do not mistake a contradictory mutation receipt for an ordinary refusal");
});
