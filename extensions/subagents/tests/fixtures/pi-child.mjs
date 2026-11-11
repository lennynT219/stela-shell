// A deterministic JSON-process fixture, not a model or a substitute for Pi integration.
const scenario = process.argv[2] ?? "success";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const ready = () => emit({ type: "entry_appended", entry: { customType: "stela-helper-ready", data: { tools: ["read"] } } });
const answer = (stopReason = "stop", content = [{ type: "text", text: "Answer: bounded evidence." }, { type: "text", text: "Limitations: source only." }]) => emit({ type: "message_end", message: { role: "assistant", stopReason, content } });
const settle = () => emit({ type: "agent_settled", aborted: false });

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
