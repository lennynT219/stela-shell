// A deterministic JSON-process fixture, not a model or a substitute for Pi integration.
const scenario = process.argv[2] ?? "success";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const ready = () => emit({ type: "entry_appended", entry: { customType: "stela-helper-ready", data: { tools: ["read"] } } });
const answer = (stopReason = "stop", content = [{ type: "text", text: "Answer: bounded evidence." }, { type: "text", text: "Limitations: source only." }]) => emit({ type: "message_end", message: { role: "assistant", stopReason, content } });
const settle = () => emit({ type: "agent_settled", aborted: false });
const blank = (kind) => (kind.includes("controls") ? "\u001b[31m \u001b[0m\u0007" : kind.includes("unicode") ? "\u2003" : " ").repeat(9000);

if (scenario !== "no-guard") ready();
emit({ type: "agent_start" });
if (scenario === "success") {
  emit({ type: "tool_execution_start", toolName: "read", args: { path: "/fixture/source.ts" } });
  emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "intermediate text not returned" }] } });
  answer(); settle();
} else if (scenario === "echo") {
  answer("stop", [{ type: "text", text: input }]); settle();
} else if (scenario === "unicode") {
  const line = `${JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ñ🙂\u2028evidence" }] } })}\n`;
  const bytes = Buffer.from(line);
  for (let i = 0; i < bytes.length; i += 3) { process.stdout.write(bytes.subarray(i, i + 3)); await new Promise((resolve) => setImmediate(resolve)); }
  settle();
} else if (scenario === "large") {
  answer("stop", [{ type: "text", text: "evidence ".repeat(4000) }]); settle();
} else if (scenario.startsWith("blank-")) {
  answer("stop", [{ type: "text", text: blank(scenario) }]); settle();
} else if (scenario === "ranges") {
  for (const args of [
    { path: "/fixture/source.ts", offset: 1, limit: 200, content: "DO_NOT_RETAIN_CONTENT" },
    { path: "/fixture/source.ts", offset: 201, limit: 80 },
    { path: "/fixture/source.ts" },
    { path: "/fixture/source.ts", offset: null, limit: "DO_NOT_RETAIN_CONTENT" },
    { path: `/fixture/${"x".repeat(500)}`, offset: 42, limit: 7 },
  ]) emit({ type: "tool_execution_start", toolName: "read", args });
  answer(); settle();
} else if (scenario.startsWith("stream-")) {
  answer("toolUse", [{ type: "text", text: "Earlier public evidence" }]);
  emit({ type: "message_start", message: { role: "assistant", content: [], stopReason: "pending" } });
  const update = (type, fields) => emit({ type: "message_update", assistantMessageEvent: { type, ...fields, partial: { content: [{ type: "text", text: "PRIVATE_SNAPSHOT_DO_NOT_RETAIN" }] } } });
  update("thinking_delta", { contentIndex: 1, delta: "PRIVATE_REASONING_DO_NOT_RETAIN" });
  update("toolcall_delta", { contentIndex: 3, delta: "PRIVATE_PAYLOAD_DO_NOT_RETAIN" });
  if (scenario === "stream-blank-final") update("text_delta", { contentIndex: 0, delta: blank("spaces") });
  else if (scenario !== "stream-thinking-hang") {
    update("text_delta", { contentIndex: 0, delta: "Stream A" });
    update("text_end", { contentIndex: 0, content: "Stream corrected ñ🙂" });
    update("text_delta", { contentIndex: 2, delta: "Second block" });
    if (scenario === "stream-large-hang") update("text_delta", { contentIndex: 2, delta: "ñ🙂 public ".repeat(3000) });
  }
  if (scenario === "stream-blank-final") { answer("stop", [{ type: "text", text: blank("spaces") }]); settle(); }
  else if (scenario === "stream-empty-final") { answer("stop", []); settle(); }
  else if (scenario === "stream-valid-final") { answer(); settle(); }
  else {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  }
} else if (scenario.startsWith("partial-")) {
  emit({ type: "tool_execution_start", toolName: "read", args: { path: "/fixture/source.ts", offset: 1, limit: 200 } });
  answer("toolUse", [{ type: "text", text: "Older public text A" }]);
  answer("toolUse", [
    { type: "thinking", thinking: "PRIVATE_REASONING_DO_NOT_RETAIN" },
    { type: "text", text: scenario === "partial-large-hang" ? "ñ🙂 evidence ".repeat(2000) : "Partial evidence B: ñ🙂" },
    { type: "toolCall", name: "read", arguments: { path: "PRIVATE_PAYLOAD_DO_NOT_RETAIN" } },
  ]);
  answer("toolUse", []);
  answer("toolUse", [{ type: "text", text: " \n\t " }]);
  answer("toolUse", [{ type: "toolCall", name: "read", arguments: { path: "PRIVATE_PAYLOAD_DO_NOT_RETAIN" } }]);
  if (scenario.startsWith("partial-blank-")) { answer("stop", [{ type: "text", text: blank(scenario) }]); settle(); }
  else if (scenario === "partial-empty-final") { answer("stop", []); settle(); }
  else if (scenario === "partial-spaces-final") { answer("stop", [{ type: "text", text: " \n\t " }]); settle(); }
  else if (scenario === "partial-thinking-final") { answer("stop", [{ type: "thinking", thinking: "PRIVATE_REASONING_DO_NOT_RETAIN" }]); settle(); }
  else if (scenario === "partial-valid-final") { answer(); settle(); }
  else if (scenario === "partial-restarted") {
    answer(); settle(); emit({ type: "agent_start" }); settle();
  } else {
    if (scenario === "partial-ignore-term") process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  }
} else if (scenario === "malformed") process.stdout.write("not JSON\n");
else if (scenario === "oversized-frame") process.stdout.write("x".repeat(1024 * 1024 + 1));
else if (scenario === "unterminated") process.stdout.write('{"type":"agent_settled"}');
else if (scenario === "missing-settle") answer();
else if (scenario === "empty") { answer("stop", []); settle(); }
else if (scenario === "error") { answer("error"); settle(); }
else if (scenario === "length") { answer("length"); settle(); }
else if (scenario === "no-guard") { answer(); settle(); }
else if (scenario === "unexpected-tool") { emit({ type: "tool_execution_start", toolName: "bash", args: {} }); answer(); settle(); }
else if (scenario === "blocked") { emit({ type: "entry_appended", entry: { customType: "stela-helper-blocked" } }); answer(); settle(); }
else if (scenario === "nonzero") { process.stderr.write("fixture startup error\n"); process.exitCode = 3; }
else if (scenario === "signal") process.kill(process.pid, "SIGTERM");
else if (scenario === "descendant") {
  const { spawn } = await import("node:child_process");
  const descendant = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000);'], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await new Promise((resolve) => descendant.once("message", resolve));
  descendant.disconnect(); descendant.unref();
  answer("stop", [{ type: "text", text: `DESCENDANT_PID=${descendant.pid}` }]);
  settle();
}
else if (scenario === "hang" || scenario === "ignore-term") {
  if (scenario === "ignore-term") process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
