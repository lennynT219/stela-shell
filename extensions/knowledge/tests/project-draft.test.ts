import { strict as assert } from "node:assert";
import { test } from "node:test";
import { draftProject } from "../project-draft.ts";

const draft = "## Summary\n\nResumen en español.\n\n## Objective\n\nObjetivo.\n\n## Scope\n\nAlcance.\n";

test("draft sends only explicit description, accepted Memory and associated History to the active model", async () => {
  const model = { id: "fixture" };
  let request: any;
  const ctx = { model, modelRegistry: { async complete(active: unknown, context: unknown) {
    assert.equal(active, model); request = context;
    return { stopReason: "stop", content: [{ type: "text", text: draft }] };
  } } } as never;
  const result = await draftProject(ctx, { title: "Proyecto", description: "Descripción" }, {
    memory: { status: "found", memory: { status: "found", accepted_markdown: "Estado vigente", observed_markdown: "PRIVATE_UNACCEPTED" } },
    history: { status: "found", markdown: "Antecedentes", truncated: true },
    not_needed: "PRIVATE_BASELINE",
  }, new AbortController().signal);
  assert.equal(result, draft.trim());
  assert.equal(Object.hasOwn(request, "tools"), false);
  assert.deepEqual(JSON.parse(request.messages[0].content[0].text), {
    title: "Proyecto", description: "Descripción", memory: "Estado vigente", memoryExcerpt: false,
    history: "Antecedentes", historyExcerpt: true,
  });
  assert.match(request.systemPrompt, /Memory tiene prioridad/);
  assert.doesNotMatch(JSON.stringify(request), /PRIVATE_/);
});

test("no provider call for unavailable information or an aborted request", async () => {
  const ctx = { model: { id: "fixture" }, modelRegistry: { complete() { throw Error("not authorized to call"); } } } as never;
  assert.equal(await draftProject(ctx, { title: "Proyecto", description: "" }, {
    memory: { status: "manual_review", memory: { status: "manual_review", accepted_markdown: "No usar" } },
    history: { status: "found", markdown: "No usar" },
  }, new AbortController().signal), undefined);
  assert.equal(await draftProject(ctx, { title: "Proyecto", description: "Descripción" }, undefined, AbortSignal.abort()), undefined);
});
