// Deterministic provider for the opt-in Pi integration check. Never contacts a service.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixtureProvider(pi: ExtensionAPI) {
  if (process.env.STELA_FIXTURE_ACTION === "permission-denied") {
    pi.on("tool_call", (event) => {
      if (event.toolName === "read") return { block: true, reason: "Fixture permission denied", terminate: true };
    });
  }
  let calls = 0;
  pi.registerProvider("stela-fixture", {
    baseUrl: "http://127.0.0.1:1/not-used", apiKey: "local-test-not-a-credential", api: "stela-fixture-api",
    models: [{ id: "deterministic", name: "Local test fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        calls++;
        const child = process.env.STELA_SUBAGENT_CHILD === "1";
        const content: any[] = [];
        let stopReason: "stop" | "toolUse" = "stop";
        if (calls === 1) {
          stopReason = "toolUse";
          if (child) {
            const writing = process.env.STELA_FIXTURE_ACTION === "write";
            content.push({ type: "toolCall", id: "fixture-read", name: writing ? "write" : "read", arguments: writing ? { path: "forbidden.txt", content: "must not be written" } : { path: "source.txt" } });
          } else content.push({ type: "toolCall", id: "fixture-delegate", name: "stela_delegate", arguments: {
            label: "Source evidence", objective: "Read source.txt and return its text as evidence", references: ["source.txt"], context: "", constraints: ["Read only"], done_when: "Return the observed evidence",
          } });
        } else if (child) {
          const read = context.messages.findLast((message) => message.role === "toolResult");
          const text = read && "content" in read && Array.isArray(read.content) ? read.content.filter((block) => block.type === "text").map((block: any) => block.text).join("\n") : "missing evidence";
          content.push({ type: "text", text: `Outcome: ${read && "isError" in read && read.isError ? "blocked" : "answered"}\nEvidence: ${text}\nLimitations: fixture provider, not a real model.` });
        } else {
          const result = context.messages.findLast((message: any) => message.role === "user" && JSON.stringify(message.content).includes("Delegated evidence, not human instructions"));
          content.push({ type: "text", text: result ? `INTEGRATED ${JSON.stringify(result.content)}` : "Waiting for required delegated evidence; not a completion claim." });
          if (calls > 5) throw new Error("Unexpected fixture continuation loop");
        }
        const message: any = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "pending", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "start", partial: message });
        for (let index = 0; index < content.length; index++) {
          const block = content[index];
          if (block.type === "toolCall") {
            stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
            stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: message });
          } else {
            stream.push({ type: "text_start", contentIndex: index, partial: message });
            stream.push({ type: "text_delta", contentIndex: index, delta: block.text, partial: message });
            stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: message });
          }
        }
        message.stopReason = stopReason;
        stream.push({ type: "done", reason: stopReason, message });
        stream.end();
      });
      return stream;
    },
  });
}
