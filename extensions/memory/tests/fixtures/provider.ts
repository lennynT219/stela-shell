// Disposable deterministic Pi/Brain integration only. No provider/network inference.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

const textOf=(m:any)=>typeof m?.content==="string"?m.content:(m?.content??[]).filter((p:any)=>p.type==="text").map((p:any)=>p.text).join("\n");
export default function provider(pi:ExtensionAPI) {
  let calls=0,continued=false,releaseHold:(()=>void)|undefined;
  pi.registerCommand("fixture-memory-release",{description:"Release only the isolated fixture hold",handler:async()=>{releaseHold?.();}});
  pi.on("agent_before_settle",event=>{
    if(process.env.SS_MEMORY_FIXTURE_MODE!=="continuation"||continued||event.outcome!=="completed")return;
    continued=true;
    return{entries:[...event.entries,{type:"custom_message",customType:"ss-memory-fixture-continuation",content:"Continue the existing completed fixture without another save.",display:false}],continue:true};
  });
  pi.on("tool_call",event=>{
    if(event.toolName!=="ss_memory_save")return;
    if(["denied","readonly"].includes(process.env.SS_MEMORY_FIXTURE_MODE??""))return{block:true,reason:process.env.SS_MEMORY_FIXTURE_MODE==="readonly"?"Fixture tool policy keeps Memory read-only.":"Fixture denies Memory writes."};
    if(process.env.SS_MEMORY_FIXTURE_MODE==="conflict")appendFileSync(process.env.SS_MEMORY_FIXTURE_CURRENT!,"\nHuman change during tool admission\n");
  });
  pi.registerTool({name:"fixture_memory_hold",label:"Fixture hold",description:"Wait for the isolated abort case",parameters:{type:"object",properties:{}} as never,
    async execute(_id,_args,signal){await new Promise<void>(resolve=>{releaseHold=resolve;if(signal?.aborted)resolve();else signal?.addEventListener("abort",()=>resolve(),{once:true});});releaseHold=undefined;return{content:[{type:"text",text:"HOLD_RELEASED"}],details:{}};}});
  pi.registerProvider("ss-memory-fixture",{baseUrl:"http://127.0.0.1:1/not-used",apiKey:"local-fixture-not-a-credential",api:"ss-memory-fixture-api",
    models:[{id:"deterministic",name:"Local Memory fixture",reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:2048}],
    streamSimple(model,context){
      const stream=createAssistantMessageEventStream();queueMicrotask(()=>{
        ++calls;const content:any[]=[],messages=context.messages as any[];
        const root=messages.findLastIndex(m=>m.role==="user"&&textOf(m).startsWith("CASE:"));
        const action=textOf(messages[root]).slice(5),recent=messages.slice(root+1),toolResult=recent.findLast(m=>m.role==="toolResult"&&["ss_memory_save","ss_memory_read"].includes(m.toolName));
        const recall=messages.map(textOf).find(t=>t.startsWith("SS_MEMORY_CONTEXT_V1\n"));let state:any;
        try{state=JSON.parse(recall!.split("\n").slice(2).join("\n"));}catch{}
        let reason="stop";
        const text=(value:string)=>content.push({type:"text",text:value});
        const tool=(name:string,args:unknown)=>{reason="toolUse";content.push({type:"toolCall",id:`memory-fixture-${calls}`,name,arguments:args});};
        const create={reason:"Verified durable fixture decision",title:"Synthetic Pi Memory",sections:["Fixture scope","Accepted constraints","Initial status","Observed evidence","Concrete next step"]};
        if(action==="greeting")text("MEMORY_GREETING");
        else if(action==="disabled")text(recall?"UNEXPECTED_DISABLED_CONTEXT":"MEMORY_DISABLED");
        else if(action==="helper")text(messages.flatMap(m=>m.toolsAdded??[]).some((t:any)=>t.name.startsWith("ss_memory_"))||recall?"UNEXPECTED_HELPER_MEMORY":"MEMORY_HELPER_EXCLUDED");
        else if(action==="abort")tool("fixture_memory_hold",{});
        else if(!toolResult){
          if(!state)text("UNEXPECTED_MISSING_MEMORY_CONTEXT");
          else if(action==="read")tool("ss_memory_read",{});
          else if(action==="manual")tool("ss_memory_save",{action:"accept_manual",reason:"Accept explicitly reviewed human edit"});
          else if(action==="missing")tool("ss_memory_save",{...create,action:"replace_missing"});
          else if(action==="update"||action==="noop"||action==="conflict"){
            tool("ss_memory_save",{reason:"Verified useful successor",changes:{"Objective and scope":"Updated fixture scope\n\n"}});
          }else tool("ss_memory_save",create);
        }else if(action==="save_abort")tool("fixture_memory_hold",{});
        else{
          let result:any;try{result=JSON.parse(textOf(toolResult));}catch{}
          if(action==="read"&&(!state?.accepted_markdown||Object.hasOwn(result??{},"accepted_markdown")))text("UNEXPECTED_PERSISTED_OR_MISSING_CONTEXT");
          else text(`MEMORY_RESULT:${result?.status??(toolResult.isError?"denied":"invalid")}:${result?.read_back??"none"}`);
        }
        const message:any={role:"assistant",content,api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:"pending",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        stream.push({type:"start",partial:message});
        for(let i=0;i<content.length;i++){
          const b=content[i];if(b.type==="toolCall"){stream.push({type:"toolcall_start",contentIndex:i,partial:message});stream.push({type:"toolcall_end",contentIndex:i,toolCall:b,partial:message});}
          else{stream.push({type:"text_start",contentIndex:i,partial:message});stream.push({type:"text_delta",contentIndex:i,delta:b.text,partial:message});stream.push({type:"text_end",contentIndex:i,content:b.text,partial:message});}
        }
        message.stopReason=reason;stream.push({type:"done",reason,message});stream.end();
      });return stream;
    }});
}
