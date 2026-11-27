// Offline presentation fixture. A text-only answer remains in flight until F3; no service or tool calls.
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixture(pi: ExtensionAPI) {
  let release: (() => void) | undefined;
  pi.registerShortcut("f3", { description: "Finish the synthetic text stream", handler: () => { release?.(); } });
  pi.registerProvider("ss-work-fixture", {
    baseUrl: "http://127.0.0.1:1/unused", apiKey: "local-fixture", api: "ss-work-text",
    models: [{ id: "text", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, _context, options) {
      const stream = createAssistantMessageEventStream(), block = { type: "text" as const, text: "" };
      const message: AssistantMessage = { role: "assistant", model:model.id, api:model.api, provider:model.provider,
        timestamp:Date.now(), stopReason:"pending", content:[], usage:{input:0, output:0, cacheRead:0, cacheWrite:0,
          totalTokens:0, cost:{input:0, output:0, cacheRead:0, cacheWrite:0, total:0}} };
      const finish = () => {
        if (release !== finish) return;
        release = undefined; options?.signal?.removeEventListener("abort",finish);
        if (options?.signal?.aborted) {
          message.stopReason = "aborted"; message.errorMessage = "Fixture cancelled";
          stream.push({type:"error",reason:"aborted",error:message});
        } else {
          stream.push({type:"text_end",contentIndex:0,content:block.text,partial:message}); message.stopReason = "stop";
          stream.push({type:"done",reason:"stop",message});
        }
        stream.end();
      };
      release = finish; options?.signal?.addEventListener("abort",finish,{once:true});
      if (options?.signal?.aborted) finish();
      else {
        stream.push({type:"start",partial:message}); message.content.push(block);
        stream.push({type:"text_start",contentIndex:0,partial:message}); block.text = "TEXTO_EN_CURSO";
        stream.push({type:"text_delta",contentIndex:0,delta:block.text,partial:message});
      }
      return stream;
    },
  });
}
