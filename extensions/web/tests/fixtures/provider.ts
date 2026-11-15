// Deterministic isolated Pi provider/transport. No public service or inference is contacted.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWeb } from "../../index.ts";
import { search } from "../../search.ts";
import { read } from "../../read.ts";
const paragraph="PUBLIC READER EVIDENCE: AbortSignal communicates cancellation to asynchronous work. The controller requests cancellation without claiming remote processing stopped. ";
const article=`<html><head><title>Public signal reference</title></head><body><article><h1>Public signal reference</h1><p>${paragraph.repeat(8)}</p><h2>Code</h2><pre><code>const signal = AbortSignal.timeout(1000);</code></pre><p>${paragraph.repeat(4)}</p></article></body></html>`;

export default function provider(pi: ExtensionAPI) {
  const mode=process.env.SS_WEB_FIXTURE_MODE??"search";let calls=0,requests=0;
  if(mode==="denied")pi.on("tool_call",event=>{
    if(event.toolName.startsWith("ss_web_"))return{block:true,reason:"Fixture denies web access."};
  });
  if(process.env.SS_WEB_USE_PRODUCTION!=="1")registerWeb(pi,{
    search:(input,signal)=>search(input,signal,{download:async(url,_signal,options)=>{
      requests++;
      if(url.hostname!=="mcp.exa.ai"||options?.method!=="POST")throw new Error("Unexpected fixture request");
      const args=JSON.parse(options.body!.toString()).params.arguments;
      if(!args.objective)throw new Error("Missing explicit objective");
      return{body:Buffer.from(JSON.stringify({jsonrpc:"2.0",id:1,result:{content:[{type:"text",text:JSON.stringify({results:[{title:"Public reference",url:"https://docs.example.org/guide",text:"PUBLIC_SEARCH_EVIDENCE"}]})}]}})),url,contentType:"application/json",redirects:0};
    }}),
    read:(input,signal)=>read(input,signal,{download:async(url)=>{
      requests++;if(url.href!=="https://docs.example.org/guide")throw new Error("Unexpected selected fixture URL");
      return{body:Buffer.from(article),url,contentType:"text/html; charset=utf-8",redirects:0};
    }}),
  });
  pi.registerProvider("ss-web-fixture",{
    baseUrl:"http://127.0.0.1:1/not-used",apiKey:"local-fixture-not-a-credential",api:"ss-web-fixture-api",
    models:[{id:"deterministic",name:"Local web fixture",reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:2048}],
    streamSimple(model,context){
      const stream=createAssistantMessageEventStream();queueMicrotask(()=>{
        calls++;const content:any[]=[];let reason="stop";
        const text=(value:string)=>content.push({type:"text",text:value});
        const tool=(name:string,args:unknown)=>{reason="toolUse";content.push({type:"toolCall",id:`web-fixture-${calls}`,name,arguments:args});};
        const asText=(message:any)=>typeof message.content==="string"?message.content:(message.content??[]).filter((part:any)=>part.type==="text").map((part:any)=>part.text).join("\n");
        // Pi 1.5.2 advertises schemas in system-message toolsAdded, not context.tools.
        const advertised=(context.messages as any[]).flatMap(message=>message.toolsAdded??[]);
        if(mode==="helper")text(advertised.some((tool:any)=>tool.name.startsWith("ss_web_"))?"UNEXPECTED_WEB_EXPOSURE":"WEB_HELPER_EXCLUDED");
        else if(mode==="surface"){
          const expected=(process.env.SS_WEB_EXPECT_TOOLS??"ss_web_search,ss_web_read").split(",");
          const actual=advertised.filter((tool:any)=>tool.name.startsWith("ss_web_")).map((tool:any)=>tool.name).sort();
          text(JSON.stringify(actual)===JSON.stringify(expected.sort())?"WEB_SURFACE_OK":"UNEXPECTED_WEB_SURFACE:"+actual.join(","));
        }else if(calls===1)tool("ss_web_search",{query:"public AbortSignal reference",objective:"Find public API evidence",limit:1});
        else{
          const result=context.messages.findLast((message:any)=>message.role==="toolResult"&&message.toolName==="ss_web_search");
          let value:any;try{value=JSON.parse(asText(result??{}));}catch{}
          if(mode==="denied")text(result?.isError&&requests===0&&asText(result).includes("Fixture denies web access.")?"WEB_DENIAL_OK":"UNEXPECTED_WEB_DENIAL");
          else if(mode==="flow"){
            const page=context.messages.findLast((message:any)=>message.role==="toolResult"&&message.toolName==="ss_web_read");
            if(!page&&value?.results?.[0]?.url)tool("ss_web_read",{url:value.results[0].url});
            else{let evidence:any;try{evidence=JSON.parse(asText(page??{}));}catch{}
              text(!page?.isError&&requests===2&&evidence?.status==="ok"&&evidence.extraction==="readability+turndown"&&evidence.document_version==="unknown"&&evidence.content.includes("PUBLIC READER EVIDENCE")&&evidence.content.includes("```")?"WEB_FLOW_OK":"UNEXPECTED_WEB_FLOW");}
          }else text(!result?.isError&&requests===1&&value?.provider==="exa"&&value.results?.[0]?.url==="https://docs.example.org/guide"&&value.results[0].snippet==="PUBLIC_SEARCH_EVIDENCE"?"WEB_SEARCH_OK":"UNEXPECTED_WEB_SEARCH");
        }
        const message:any={role:"assistant",content,api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:"pending",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        stream.push({type:"start",partial:message});
        for(let index=0;index<content.length;index++){
          const block=content[index];
          if(block.type==="toolCall"){stream.push({type:"toolcall_start",contentIndex:index,partial:message});stream.push({type:"toolcall_end",contentIndex:index,toolCall:block,partial:message});}
          else{stream.push({type:"text_start",contentIndex:index,partial:message});stream.push({type:"text_delta",contentIndex:index,delta:block.text,partial:message});stream.push({type:"text_end",contentIndex:index,content:block.text,partial:message});}
        }
        message.stopReason=reason;stream.push({type:"done",reason,message});stream.end();
      });return stream;
    },
  });
}
