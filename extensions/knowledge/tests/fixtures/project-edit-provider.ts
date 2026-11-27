import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixture(pi: ExtensionAPI) {
  pi.registerProvider("ss-project-edit-fixture", {
    baseUrl:"http://127.0.0.1:1/unused", apiKey:"fixture-only", api:"ss-project-edit-fixture-api",
    models:[{ id:"deterministic",name:"Offline Project draft",reasoning:false,input:["text"],contextWindow:32000,maxTokens:2048,
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0} }],
    streamSimple(model, context) {
      try {
        const input = context.messages.find(m => m.role === "user")?.content;
        const text = typeof input === "string" ? input : input?.[0]?.type === "text" ? input[0].text : "";
        const sources = JSON.parse(text);
        assert.equal(sources.title,"Project de prueba");
        assert.equal(sources.description,"Incluir la finalidad estable.");
        assert.match(sources.previousBody,/Ficha de prueba/);
        assert.match(sources.memory,/Finalidad estable de prueba/);
        assert.match(sources.history,/Prueba de contexto/);
        assert.equal(Object.hasOwn(sources,"expected_markdown"),false);
      } catch (e) {
        // This provider sees only the temporary fixture's synthetic data.
        console.error(e);
        throw e;
      }
      const stream = createAssistantMessageEventStream();
      stream.push({type:"done",reason:"stop",message:{role:"assistant",content:[{type:"text",text:"## Summary\n\nBorrador generado.\n\n## Objective\n\nObjetivo.\n\n## Scope\n\nAlcance."}],
        api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:"stop",
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});
      stream.end();
      return stream;
    },
  });
}
