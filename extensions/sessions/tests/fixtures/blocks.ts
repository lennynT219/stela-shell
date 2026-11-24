// Offline UI fixture. Real Pi, file tools, Codemode, permission dialog and Knowledge adapter; synthetic services.
import { appendFileSync, writeFileSync, renameSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerKnowledge } from "../../../knowledge/index.ts";

const note = "12345678-1111-4111-8111-000000000001", project = "99999999-1111-4111-8111-000000000099";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+xde0AAAAASUVORK5CYII=";
export default function fixture(pi: ExtensionAPI) {
  const title = "Árbol de diseño"; let total = 0;
  registerKnowledge(pi,{ scope: () => ({ valid: () => true, async call(op,args) {
    const meta = { project_id: project, note_id: note, title };
    if (op === "list") return { project_id: project, status: "listed", notes: [{ note_id: note,title }] };
    if (op === "read") return { ...meta, status: "found", body: "CONTENIDO_NOTA_INTERNO", markdown: "---\n---\nCONTENIDO_NOTA_INTERNO" };
    if (op === "create") return { ...meta, title: args.title, status: "created" };
    return { ...meta, status: "updated" };
  } }) });
  for (const [name, result] of [
    ["ss_web_read", { content: [{ type: "text", text: "texto parcial" }], details: { status: "partial", truncated: true } }],
    ["ss_memory_save", { isError: true, content: [{ type:"text",text:'{"status":"save_unconfirmed"}' }], details: { status:"save_unconfirmed" } }],
    ["ss_images_generate", { content: [{ type: "text", text: "Vista 1 · 1 × 1 · PNG: fixture" }, { type: "image", mimeType: "image/png", data: png }], details: { status: "preview" } }],
  ] as const) pi.registerTool({ name, label:name, description:"Synthetic renderer input only", parameters: { type:"object",properties:name==="ss_memory_save"?{reason:{type:"string"}}:{} } as never,
    async execute() { return structuredClone(result) as any; } });
  pi.on("tool_call",async (e,ctx) => {
    if (e.toolName === "read" && e.input.path === "no.txt" && !await ctx.ui.confirm("Permiso de prueba", "¿Autorizar lectura en la prueba?"))
      return { block: true, reason: "Permiso denegado en la prueba" };
  });
  pi.on("tool_execution_start",e => { appendFileSync(process.env.SS_BLOCK_FRAME! + ".calls",e.toolName + "\n"); });
  let screen: any;
  pi.on("session_start",(_e,ctx) => { ctx.ui.setWidget("fixture-frame",t => { screen = t; return { render: () => [], invalidate() {} }; }); });
  pi.registerShortcut("f8", { description:"Snapshot of the disposable terminal", handler: async ctx => {
    const file=process.env.SS_BLOCK_FRAME!;
    const theme=ctx.ui.theme;
    const native = {name:theme.name, appearance:theme.appearance, mode:theme.getColorMode(), panel:theme.getBgAnsi("toolSuccessBg"), user:theme.getBgAnsi("userMessageBg")};
    writeFileSync(file+".tmp",JSON.stringify({ lines: screen.getScreenLines(), draft: ctx.ui.getEditorText(), native })); renameSync(file+".tmp",file);
  } });
  pi.registerProvider("ss-blocks",{ baseUrl:"http://127.0.0.1:1/unused", apiKey:"test-only", api:"ss-blocks-api",
    models:[{id:"test", name:"Fixture", reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:2048}],
    streamSimple(model,context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const content:any[] = []; const tool=(id:string,name:string,args:object) => content.push({type:"toolCall",id,name,arguments:args});
        if (process.env.SS_BLOCK_NAME) {
          const messages = context.messages;
          const listing = messages.findLast(m => m.role === "toolResult" && m.toolName === "ss_sessions_list");
          if (process.env.SS_BLOCK_NAME === "Diseño") content.push({type:"text",text:"LLEGÓ_EL_MENSAJE"});
          else if (!listing || listing.role !== "toolResult") tool("list-peers","ss_sessions_list",{});
          else {
            const info = JSON.parse(listing.content.find(c => c.type === "text")!.text);
            const send = messages.some(m => m.role === "user" && JSON.stringify(m.content).includes("Envía saludo"));
            if (!send) content.push({type:"text",text:"Sesiones disponibles: "+info.peers.map((p:any) => p.name).join(", ")});
            else if (messages.some(m => m.role === "toolResult" && m.toolName === "ss_sessions_send")) content.push({type:"text",text:"FIN_DEL_ENVÍO"});
            else tool("send-peer","ss_sessions_send",{to:info.peers.find((p:any) => p.name === "Diseño").id,text:"Saludos desde la prueba"});
          }
        } else switch (++total) {
          case 1: tool("a","read",{path:"a.txt"});tool("b","read",{path:"b.txt"});tool("missing","read",{path:"ausente.txt"});tool("notes","ss_knowledge_list",{});break;
          case 2: tool("bundle","codemode",{code:`await Promise.all([tools.read({path:'a.txt'}),tools.read({path:'b.txt'})]);\nawait tools.write({path:'lote.txt',content:'OK'});\nawait tools.ss_knowledge_read({note_id:'${note}'});\nawait tools.ss_web_read({});\nawait tools.read({path:'no.txt'}).catch(() => {});\ntext([0,['Primera línea','Segunda línea'].join('\\n')]); text('SALIDA_FILTRADA')`});break;
          case 3: {
            const parent = context.messages.findLast(m => m.role === "toolResult" && m.toolName === "codemode");
            const visible = JSON.stringify(parent?.content);
            if (!visible?.includes("SALIDA_FILTRADA") || /CONTENIDO_NOTA_INTERNO|ssBlocks/.test(visible)) { content.push({type:"text",text:"BATCH_CONTENT_CHANGED"}); break; }
            tool("later","codemode",{code:"await tools.write({path:'anterior.txt',content:'SE CONSERVA'}); throw new Error('Fallo posterior de prueba')"});break;
          }
          case 4: tool("update","ss_knowledge_update",{note_id:note,body:"cambio sintético"});break;
          case 5: tool("uncertain","ss_memory_save",{reason:"Motivo del ensayo"});tool("image","ss_images_generate",{});break;
          case 6: tool("shell","bash",{command:"printf 'RESULTADO_%s\\n' TERMINAL",timeout:5});break;
          case 7: tool("edit","edit",{path:"cambio.txt",edits:[{oldText:"texto antiguo",newText:"texto nuevo"}]});break;
          case 8: tool("script-only","codemode",{code:"store('example',2); text('SCRIPT_SIN_HERRAMIENTAS')"});break;
          case 9: tool("failed-script","codemode",{code:"throw new Error('ERROR_SIN_HERRAMIENTAS')"});break;
          case 10: tool("timeout-script","codemode",{code:'// @options: {"timeout_ms": 200}\nwhile (true) {}'});break;
          default: content.push({type:"text",text:"FIN_DE_BLOQUES"});
        }
        const stopReason = content[0].type==="toolCall"?"toolUse":"stop";
        const m:any = {role:"assistant",content,api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason,
          usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        stream.push({type:"start",partial:m});
        content.forEach((b,i)=>{ if(b.type==="toolCall"){stream.push({type:"toolcall_start",contentIndex:i,partial:m});stream.push({type:"toolcall_end",contentIndex:i,toolCall:b,partial:m});}
          else {stream.push({type:"text_start",contentIndex:i,partial:m});stream.push({type:"text_delta",contentIndex:i,delta:b.text,partial:m});stream.push({type:"text_end",contentIndex:i,content:b.text,partial:m});} });
        stream.push({type:"done",reason:stopReason,message:m}); stream.end();
      }); return stream;
    },
  });
}
