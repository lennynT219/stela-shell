// Isolated deterministic RPC provider. Does not call a model service.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";

export default function provider(pi: ExtensionAPI) {
  let count = 0;
  pi.registerProvider("ss-knowledge-fixture", {
    baseUrl: "http://127.0.0.1:1/unused", apiKey: "fixture-only", api: "ss-knowledge-fixture-api",
    models: [{ id: "deterministic", name: "Offline note fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const mode = process.env.SS_KNOWLEDGE_CASE!, messages = context.messages as any[];
        const last = messages.findLast(m => m.role === "toolResult" && m.toolName.startsWith("ss_knowledge_"));
        const content: any[] = [];
        const tool = (name: string, args: object) => content.push({ type: "toolCall", id: `note-fixture-${++count}`, name: `ss_knowledge_${name}`, arguments: args });
        if (!last) tool(mode === "write" ? "list" : "read", mode === "write" ? {} : { note_id: process.env.SS_KNOWLEDGE_NOTE });
        else if (mode === "write" && last.toolName === "ss_knowledge_list" && !last.isError)
          tool("create", { title: "Naming conventions", body: readFileSync(process.env.SS_KNOWLEDGE_SOURCE!, "utf8") });
        else if (mode === "update" && last.toolName === "ss_knowledge_read" && !last.isError)
          tool("update", { note_id: process.env.SS_KNOWLEDGE_NOTE, body: readFileSync(process.env.SS_KNOWLEDGE_SOURCE!, "utf8") });
        else content.push({ type: "text", text: "KNOWLEDGE_FIXTURE_DONE" });
        const stopReason = content[0].type === "toolCall" ? "toolUse" : "stop";
        const message: any = { role: "assistant", content, api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(), stopReason,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "start", partial: message });
        const block = content[0];
        if (block.type === "toolCall") {
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: message });
        } else {
          stream.push({ type: "text_start", contentIndex: 0, partial: message });
          stream.push({ type: "text_delta", contentIndex: 0, delta: block.text, partial: message });
          stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial: message });
        }
        stream.push({ type: "done", reason: stopReason, message }); stream.end();
      });
      return stream;
    },
  });
}
