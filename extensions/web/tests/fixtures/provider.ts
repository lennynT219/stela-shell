import { createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function provider(pi: ExtensionAPI) {
  const action = process.env.STELA_WEB_FIXTURE_ACTION;
  if (action === "denied") pi.on("tool_call", event => {
    if (event.toolName === "stela_read_url") return { block: true, reason: "Fixture denies URL reading", terminate: true };
  });
  let calls = 0;
  pi.registerProvider("stela-web-fixture", {
    baseUrl: "http://127.0.0.1:1/not-used", apiKey: "local-test-not-a-credential", api: "stela-web-fixture-api",
    models: [{ id: "deterministic", name: "Offline web fixture", reasoning: false, input: ["text"],
      cost: { input: 0,output: 0,cacheRead: 0,cacheWrite: 0 }, contextWindow: 32000,maxTokens: 2048 }],
    streamSimple(model,context) {
      const stream=createAssistantMessageEventStream();
      queueMicrotask(()=>{
        if (++calls > 2) throw Error("Unexpected fixture continuation");
        const content:any[]=[];
        const available=getCurrentTools(context.messages).some(tool=>tool.name==="stela_read_url");
        let stopReason:"stop"|"toolUse"="stop";
        if(calls===1 && available){
          stopReason="toolUse";content.push({type:"toolCall",id:"url-read",name:"stela_read_url",
            arguments:{url:"https://docs.example.org/guide",section:"cancel",version_context:"1.0"}});
        }else content.push({type:"text",text:available ? "FIXTURE_READ_COMPLETE" : "HELPER_HAS_NO_WEB_TOOL"});
        const message:any={role:"assistant",content,api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:"pending",
          usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        stream.push({type:"start",partial:message});
        for(let i=0;i<content.length;i++){
          const block=content[i];
          if(block.type==="toolCall"){
            stream.push({type:"toolcall_start",contentIndex:i,partial:message});
            stream.push({type:"toolcall_end",contentIndex:i,toolCall:block,partial:message});
          }else{
            stream.push({type:"text_start",contentIndex:i,partial:message});
            stream.push({type:"text_delta",contentIndex:i,delta:block.text,partial:message});
            stream.push({type:"text_end",contentIndex:i,content:block.text,partial:message});
          }
        }
        message.stopReason=stopReason;stream.push({type:"done",reason:stopReason,message});stream.end();
      });
      return stream;
    },
  });
}
