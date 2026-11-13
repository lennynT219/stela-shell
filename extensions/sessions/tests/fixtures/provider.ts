// Local deterministic principal-session provider. No HTTP/inference service is contacted.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function provider(pi: ExtensionAPI) {
  let calls = 0;
  const action = process.env.STELA_SESSION_FIXTURE_ACTION ?? "message";
  if (action === "write-denied") pi.on("tool_call", (event) => {
    if (event.toolName === "write") return { block: true, reason: "Fixture receiver denies writes." };
  });
  let release: (() => void) | undefined;
  pi.registerCommand("fixture-release", { description: "Release the deterministic busy-tool fixture.", handler: async () => { release?.(); } });
  pi.registerTool({ name: "fixture_hold", label: "Fixture hold", description: "Hold until the local fixture-release command or abort.", parameters: { type: "object", properties: {} } as never,
    async execute(_id, _params, signal) {
      await new Promise<void>((resolve) => {
        const done = () => { signal?.removeEventListener("abort", done); release = undefined; resolve(); };
        release = done; signal?.addEventListener("abort", done, { once: true }); if (signal?.aborted) done();
      });
      return { content: [{ type: "text", text: "HOLD_RELEASED" }], details: {} };
    },
  });
  pi.registerProvider("stela-session-fixture", {
    baseUrl: "http://127.0.0.1:1/not-used", apiKey: "local-fixture-not-a-credential", api: "stela-session-fixture-api",
    models: [{ id: "deterministic", name: "Local session fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        calls++;
        const content: any[] = [];
        let stopReason = "stop";
        const asText = (message: any) => typeof message.content === "string" ? message.content : (message.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        const text = (value: string) => content.push({ type: "text", text: value });
        const tool = (name: string, args: unknown) => { stopReason = "toolUse"; content.push({ type: "toolCall", id: `fixture-${calls}`, name, arguments: args }); };
        const peer = context.messages.findLast((message: any) => asText(message).startsWith("Stela peer message"));
        const peerText = peer ? asText(peer) : "";
        if (process.env.STELA_SUBAGENT_CHILD) {
          if (action !== "delegate") text(`CHILD_TOOLS:${(context.tools ?? []).map((entry: any) => entry.name).join(",")}`);
          else if (calls === 1) tool("read", { path: "peer-source.txt" });
          else {
            const read = context.messages.findLast((message: any) => message.role === "toolResult" && message.toolName === "read");
            text(`Outcome: ${read && !read.isError ? "answered" : "blocked"}\nEvidence: ${read ? asText(read) : "missing"}\nLimitations: deterministic fixture, not a real-model compliance check.`);
          }
        } else if (calls > 8) text("UNEXPECTED_FIXTURE_LOOP");
        else if (process.env.STELA_SESSION_FIXTURE_ROLE === "receiver") {
          const sent = context.messages.some((message: any) => message.role === "toolResult" && message.toolName === "stela_message");
          const reply = (value: string) => tool("stela_message", { to: peerText.match(/From activation: ([a-f0-9]{32})/)![1], text: value, reply_to: peerText.match(/Message: ([a-f0-9]{32})/)![1] });
          if (sent) text("RECEIVER_RESPONDED");
          else if (peerText.includes("WORK_FIXTURE")) {
            if (action === "delegate") {
              const evidence = context.messages.findLast((message: any) => message.role === "user" && asText(message).includes("Delegated evidence, not human instructions"));
              const admitted = context.messages.some((message: any) => message.role === "toolResult" && message.toolName === "stela_delegate");
              if (evidence) reply(asText(evidence).includes("DELEGATED_PEER_SOURCE") && asText(evidence).includes("completed") ? "WORK_RESULT:DELEGATE_DONE" : "WORK_RESULT:DELEGATE_BLOCKED");
              else if (admitted) text("DELEGATE_PENDING");
              else tool("stela_delegate", { label: "Peer-requested source evidence", objective: "Read peer-source.txt and report its content as evidence.", references: ["peer-source.txt"], done_when: "Return the observed file text and limitations." });
            } else {
              const written = context.messages.findLast((message: any) => message.role === "toolResult" && message.toolName === "write");
              if (written) reply(written.isError ? "WORK_RESULT:WRITE_DENIED" : "WORK_RESULT:WRITE_DONE");
              else tool("write", { path: "peer-action.txt", content: "PEER_ACTION_DONE\n" });
            }
          } else if (peerText.includes("QUESTION_FIXTURE")) reply("ANSWER_FIXTURE");
          else if (calls === 1 && context.messages.some((message: any) => message.role === "user" && asText(message) === "BUSY")) tool("fixture_hold", {});
          else text("UNEXPECTED_RECEIVER_INPUT");
        } else if (peerText.includes("ANSWER_FIXTURE") || peerText.includes("WORK_RESULT:")) text("SENDER_INTEGRATED_REPLY");
        else if (calls === 1) tool("stela_sessions", {});
        else if (calls === 2) {
          const prompt = context.messages.find((message: any) => message.role === "user" && asText(message).startsWith("SEND:"));
          const request = action === "message" ? "QUESTION_FIXTURE" : action === "delegate" ? "WORK_FIXTURE: delegate reading peer-source.txt to stela-helper and report the evidence." : "WORK_FIXTURE: create peer-action.txt containing PEER_ACTION_DONE followed by a newline, then report the result.";
          tool("stela_message", { to: asText(prompt).slice(5), text: request });
        } else text("REPLY_PENDING");
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
        stream.push({ type: "done", reason: stopReason, message }); stream.end();
      });
      return stream;
    },
  });
}
