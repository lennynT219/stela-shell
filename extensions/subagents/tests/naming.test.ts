import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registerSubagents } from "../index.ts";
import { registerSessions, MESSAGE_TYPE } from "../../sessions/index.ts";
import { callRenderer, messageRenderer } from "../../presentation.ts";

const theme: any = { fg: (_color: string, value: string) => value, bold: (value: string) => value };
const context: any = { expanded: false };
const text = (content: string): any => ({ content, render: () => content.split("\n"), invalidate() {} });
function registration(env: NodeJS.ProcessEnv = {}) {
  const tools = new Map<string, any>(), commands = new Map<string, any>(), flags = new Map<string, any>(), renderers = new Map<string, any>();
  const pi: any = {
    on() {}, registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerFlag: (name: string, flag: any) => flags.set(name, flag),
    registerMessageRenderer: (name: string, renderer: any) => renderers.set(name, renderer),
  };
  registerSubagents(pi, { env, text });
  registerSessions(pi, { env, profile: "/unused-test-profile", text, open: async () => { throw new Error("Registration must not open resources."); } });
  return { tools, commands, flags, renderers };
}

test("ss public surface has one canonical name per operation and short Spanish titles", () => {
  const h = registration();
  assert.deepEqual([...h.tools].map(([name, tool]) => [name, tool.label]), [
    ["ss_tasks_delegate", "Delegar"], ["ss_tasks_cancel", "Cancelar tarea"],
    ["ss_sessions_list", "Sesiones"], ["ss_sessions_send", "Enviar mensaje"],
  ]);
  assert.deepEqual([...h.commands.keys()], ["ss-tasks", "ss-sessions"]);
  assert.deepEqual([...h.flags.keys()], ["ss-tasks-concurrency", "ss-sessions-disabled"]);
  for (const [name, tool] of h.tools) {
    assert.match(name, /^ss_[a-z]+_[a-z]+$/);
    const guidelines = tool.promptGuidelines?.join("\n") ?? "";
    assert.doesNotMatch(guidelines, /stela_delegate|stela_cancel|stela_sessions|stela_message/);
    if (name !== "ss_sessions_list") assert.equal(tool.exposure, "model-only");
    assert.equal(typeof tool.renderCall, "function");
    const rendered = tool.renderCall({}, theme, context);
    assert.equal(rendered.content, tool.label);
    assert.doesNotMatch(rendered.content, /ss_|stela|Stela/);
  }
  // Session-tree names are persisted compatibility contracts, not public branding.
  assert.deepEqual([...h.renderers.keys()], ["stela-subagent-result", "stela-peer-message"]);
  assert.equal(MESSAGE_TYPE, "stela-peer-message");
});

test("short tool headers preserve arguments and reveal the actual identity on expansion", () => {
  const args = { text: "evidence\u001b[31m\u202e\u009b\n漢字😀", to: "a".repeat(32), nested: { value: true } };
  const original = structuredClone(args);
  const render = callRenderer("ss_sessions_send", "Enviar mensaje", text)!;
  const collapsed: any = render(args, theme, context);
  assert.equal(collapsed.content.split("\n")[0], "Enviar mensaje");
  assert.deepEqual(JSON.parse(collapsed.content.slice(collapsed.content.indexOf("\n") + 1)), original);
  assert.doesNotMatch(collapsed.content, /\u001b|\u202e|\u009b/);
  assert.match(collapsed.content, /\\u202e/);
  const expanded: any = render(args, theme, { ...context, expanded: true });
  assert.equal(expanded.content.split("\n")[0], "Enviar mensaje ss_sessions_send");
  assert.deepEqual(args, original, "presentation must not mutate executable arguments");
});

test("helper exclusion still precedes tools, commands and renderer registration", () => {
  const h = registration({ STELA_SUBAGENT_CHILD: "1", STELA_SUBAGENT_SCOPE: JSON.stringify({ roots: [{ path: "/reference", directory: false }], tools: ["read"] }) });
  for (const map of [h.tools, h.commands, h.flags, h.renderers]) assert.equal(map.size, 0);
});

test("compatible custom-message types get short safe headers without changing model content", () => {
  const h = registration();
  for (const [type, label] of [["stela-subagent-result", "Ayudante"], ["stela-peer-message", "Mensaje"]]) {
    const message = { customType: type, content: "source\u001b[31m\u202e\nEvidence remains visible", details: {} };
    const original = structuredClone(message);
    const rendered = h.renderers.get(type)(message, {}, theme);
    assert.equal(rendered.content.split("\n")[0], label);
    assert.doesNotMatch(rendered.content, /\u001b|\u202e/);
    assert.match(rendered.content, /Evidence remains visible/);
    assert.deepEqual(message, original);
  }
});

const cli = process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;
test("Pi Text renders short titles and Unicode arguments within narrow and resized widths", { skip: !cli }, async () => {
  const require = createRequire(cli!);
  const { Text, visibleWidth } = await import(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
  const render = callRenderer("ss_tasks_delegate", "Delegar", (content) => new Text(content, 0, 0))!;
  const args = { label: "漢字😀 e\u0301", references: ["a".repeat(180)], objective: "evidence\u202e" };
  for (const expanded of [false, true]) {
    const component = render(args, theme, { ...context, expanded });
    for (const width of [12, 80, 20]) {
      component.invalidate();
      const lines = component.render(width);
      assert.ok(lines.length > 0);
      assert.ok(lines.every((line: string) => visibleWidth(line) <= width));
      assert.doesNotMatch(lines.join("\n"), /\u202e/);
      assert.match(lines[0], /Delegar/);
    }
  }
  const message = messageRenderer("Mensaje", (content) => new Text(content, 0, 0))({ customType: "stela-peer-message", content: "漢字😀\u202e\nEvidence", timestamp: 0 }, {} as any, theme)!;
  assert.ok(message.render(12).every((line: string) => visibleWidth(line) <= 12));
});
