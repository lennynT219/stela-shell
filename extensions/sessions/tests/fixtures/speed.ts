// Offline catalog and Responses transport for Pi's native adapters; Sessions owns the real selector.
import { appendFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixture(_pi: ExtensionAPI) {
  const trace = process.env.SS_SPEED_TRACE!;
  let calls = 0;
  globalThis.WebSocket = class { constructor() { throw Error("Offline fixture"); } } as any;
  globalThis.fetch = async (url, options) => {
    if (process.env.SS_DIRECT_SPEED_FIXTURE) {
      if (String(url) === "https://api.openai.com/v1/models" && options?.method === "GET" && options.redirect === "error" &&
          new Headers(options.headers).get("Authorization") === "Bearer fixture-direct") {
        appendFileSync(trace, JSON.stringify({catalog:true}) + "\n");
        return Response.json({models:[
          {slug:"gpt-4.1",visibility:"list",service_tiers:[{id:"priority",name:"Fast"}]},
          {slug:"gpt-5.2",visibility:"list",service_tiers:[{id:"ultrafast",name:"Ultrafast"}]},
          {slug:"gpt-4o",visibility:"list",service_tiers:[]},
        ]});
      }
      if (String(url) !== "https://api.openai.com/v1/responses" || options?.method !== "POST") return new Response("offline", {status:403});
    } else if (String(url) !== "https://chatgpt.com/backend-api/codex/responses" || options?.method !== "POST") return new Response("offline", {status: 403});
    const body = JSON.parse(typeof options.body === "string" ? options.body : zstdDecompressSync(options.body as Uint8Array).toString());
    appendFileSync(trace, JSON.stringify({model:body.model,tier:body.service_tier ?? null}) + "\n");
    const n = ++calls, text = `Respuesta local ${n}`, id = `msg_${n}`;
    const msg = {id, type:"message", role:"assistant", status:"completed", content:[{type:"output_text",text,annotations:[]}]};
    const response = {id:`resp_${n}`,model:body.model,status:"completed",output:[msg],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
    const events = [{type:"response.created", response:{...response,status:"in_progress",output:[]}},
      {type:"response.output_item.added",output_index:0,item:{...msg,status:"in_progress",content:[]}},
      {type:"response.content_part.added",output_index:0,content_index:0,item_id:id,part:{type:"output_text",text:"",annotations:[]}},
      {type:"response.output_text.delta",output_index:0,content_index:0,item_id:id,delta:text},
      {type:"response.output_item.done",output_index:0,item:msg},{type:"response.completed",response}];
    return new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(""), {headers:{"content-type":"text/event-stream"}});
  };
}
