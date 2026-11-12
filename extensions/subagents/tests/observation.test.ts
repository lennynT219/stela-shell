import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { publicEvent, summarize, snapshot, writeWorkspace } from "./behavior/observe.mjs";
import { files, oracle, simplePrompt, broadPrompt } from "./behavior/fixtures.mjs";

test("observation prompts ask for application outcomes, not agents or a forced workflow", () => {
  for (const prompt of [simplePrompt, broadPrompt]) {
    assert.doesNotMatch(prompt, /agent|deleg|paralel|stela|FARO|helper/i);
    assert.match(prompt, /No modifiques archivos/);
  }
  for (const expected of oracle) {
    assert.ok(files[expected.file].includes(expected.anchor), expected.id);
    assert.equal(files[expected.file].split(expected.anchor).length - 1, 1, `${expected.id}: unique evidence anchor`);
  }
});

test("public observation excludes thinking, snapshots, raw traces and unrelated entries", () => {
  for (const event of [
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "PRIVATE" } },
    { type: "agent_end", messages: [{ content: [{ type: "thinking", thinking: "PRIVATE" }] }] },
    { type: "entry_appended", entry: { customType: "unrelated", data: "PRIVATE" } },
  ]) assert.equal(publicEvent(event), undefined);
  const event = publicEvent({ type: "message_end", message: { role: "assistant", provider: "test", model: "test", stopReason: "stop", content: [
    { type: "text", text: "Public evidence" }, { type: "thinking", thinking: "PRIVATE" }, { type: "toolCall", arguments: { private: "PRIVATE" } },
  ] } });
  assert.equal(event.message.content.length, 1);
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE/);
  const result = publicEvent({ type: "entry_appended", entry: { customType: "stela-subagent-result", content: "Public result", details: { taskId: "one", state: "failed", result: { diagnostics: "PRIVATE" } } } });
  assert.deepEqual(result.entry.details, { taskId: "one", state: "failed" });
});

test("public tool arguments remain valid structured data while obvious credentials are redacted", () => {
  const event = publicEvent({ type: "tool_execution_start", toolCallId: "call", toolName: "read", args: {
    path: "source.txt", apiKey: "not-a-real-secret", nested: { access_token: "not-a-real-secret", text: "Authorization: Bearer private-test-token" },
  } });
  assert.equal(event.args.path, "source.txt");
  assert.doesNotMatch(JSON.stringify(event), /not-a-real-secret|private-test-token/);
  assert.equal(event.args.apiKey, "[REDACTED]");
  assert.equal(event.args.nested.text, "Authorization: Bearer [REDACTED]");
});

test("observation correlates admission, public work and unique delivery without inferring concurrency", () => {
  const events = [
    { seq: 0, type: "session", id: "fresh-session" },
    { seq: 1, type: "tool_execution_start", toolCallId: "d", toolName: "stela_delegate", args: { objective: "Check prices", references: ["src/pricing"] } },
    { seq: 2, type: "tool_execution_end", toolCallId: "d", toolName: "stela_delegate", result: { details: { taskId: "one", state: "queued" } } },
    { seq: 3, type: "tool_execution_start", toolCallId: "r", toolName: "read", args: { path: "src/orders.mjs" } },
    { seq: 4, type: "entry_appended", entry: { customType: "stela-subagent-result", content: "Evidence", details: { taskId: "one", state: "completed" } } },
    { seq: 5, type: "message_end", message: { role: "assistant", provider: "test", model: "test", stopReason: "stop", content: [{ type: "text", text: "Integrated conclusion" }] } },
    { seq: 6, type: "agent_settled", aborted: false },
  ];
  const summary = summarize(events);
  assert.equal(summary.uniqueTasks, 1);
  assert.deepEqual(summary.sessionIds, ["fresh-session"]);
  assert.deepEqual(summary.missingResults, []);
  assert.deepEqual(summary.repeatedResults, []);
  assert.deepEqual(summary.principalWorkBeforeDelivery.map((item) => item.seq), [3]);
  assert.equal(summary.admissions[0].assignment.objective, "Check prices");
  assert.equal(summary.finalAnswer, "Integrated conclusion");
  assert.equal(summary.settled, true);
  assert.match(summary.limitation, /not concurrent child execution/);
  const missing = summarize(events.filter((event) => event.seq !== 4));
  assert.deepEqual(missing.missingResults, ["one"]);
  const duplicate = summarize([...events, { ...events[4], seq: 7 }]);
  assert.deepEqual(duplicate.repeatedResults, ["one"]);
});

test("synthetic workspaces are identical, mutation-detectable and contain no private oracle", () => {
  const root = mkdtempSync(join(tmpdir(), "stela-observation-fixture-"));
  try {
    const one = join(root, "one"), two = join(root, "two");
    const hashes = writeWorkspace(one);
    assert.deepEqual(writeWorkspace(two), hashes);
    assert.equal(Object.keys(hashes).length, Object.keys(files).length);
    assert.ok(Object.keys(hashes).every((path) => !/oracle|AGENTS|WORK_STATE|observe/.test(path)));
    writeFileSync(join(two, "extra.txt"), "mutation");
    assert.notDeepEqual(snapshot(two), hashes);
    assert.equal(readFileSync(join(one, "src/config.mjs"), "utf8"), files["src/config.mjs"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("private oracle cases reproduce actual synthetic application defects without inference", async () => {
  const root = mkdtempSync(join(tmpdir(), "stela-observation-oracle-"));
  try {
    writeWorkspace(root);
    const module = (path: string) => import(pathToFileURL(join(root, path)).href);
    const { quoteOrder } = await module("src/pricing/quote.mjs");
    const { requestErrors } = await module("src/validation/request.mjs");
    const { deliveryErrors } = await module("src/validation/delivery.mjs");
    const { canReadOrder, visibleOrders } = await module("src/access/policy.mjs");
    const { publicOrder } = await module("src/access/view.mjs");
    const delivery = { name: "Example", street: "Example 12", country: "ES", postalCode: "28001" };
    assert.equal(quoteOrder({ items: [{ sku: "notebook", quantity: 1, unitPriceCents: 1 }] }).subtotalCents, 1);
    assert.equal(quoteOrder({ items: [{ sku: "notebook", quantity: 1 }] }).taxCents, 75);
    const quote = quoteOrder({ items: [{ sku: "bag", quantity: 1 }], discountCode: "PREFERRED10" });
    assert.equal(quote.merchandiseCents, 4680); assert.equal(quote.deliveryCents, 0);
    // Both live reports miscomputed this expectation as 890 tax / 6020 total.
    // Independent contract arithmetic: 4680 * 19% = 889.2, rounded to 889.
    const expectedTaxCents = Math.round(quote.merchandiseCents * 1900 / 10000);
    assert.equal(expectedTaxCents, 889);
    assert.equal(quote.merchandiseCents + expectedTaxCents + 450, 6019);
    for (const quantity of ["2", 0, -1]) assert.deepEqual(requestErrors({ items: [{ sku: "pen", quantity }], delivery }), []);
    assert.deepEqual(deliveryErrors({ ...delivery, postalCode: "prefix28001suffix" }), []);
    const actor = { id: "shared-id", tenantId: "one", role: "customer" };
    const order = { id: "order", customerId: actor.id, tenantId: "two", internalNote: "internal", paymentToken: "test-only" };
    assert.equal(canReadOrder(actor, order), true);
    assert.equal(visibleOrders(actor, [order]).length, 1);
    assert.equal(publicOrder(order).internalNote, "internal");
    assert.equal(publicOrder(order).paymentToken, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
