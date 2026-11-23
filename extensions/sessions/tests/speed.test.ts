import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bundledCodexBin } from "../../codex-runtime.ts";
import { querySpeeds, registerSpeed } from "../codex-speed.ts";

const fast = {id:"priority", name:"Fast"} as const, ultra = {id:"example_tier", name:"Ultrafast"} as const;
const row = {id:"catalog-id", model:"synthetic", hidden:false, serviceTiers:[fast, ultra]};
const script = `const pages=JSON.parse(process.argv[1]); let page=0, init=false; require('readline').createInterface({input:process.stdin}).on('line',s=>{
  const q=JSON.parse(s), reply=result=>console.log(JSON.stringify({id:q.id,result}));
  if(q.id===1 && q.method==='initialize') return reply({}); if(q.method==='initialized'){init=true;return;}
  if(!init||q.method!=='model/list'||q.params.modelProvider!=='openai'||q.params.includeHidden!==false||q.params.cursor!==(page?pages[page-1].nextCursor:undefined)) process.exit(2);
  reply(pages[page++]); });`;
const list=(...pages:object[])=>querySpeeds({bin:process.execPath,cwd:tmpdir(),env:{},args:["-e",script,JSON.stringify(pages)]},"synthetic",new AbortController().signal);

test("visible model/list receipts, exact wire model, pagination, no inferred speed or duplicate selection", async()=>{
  assert.deepEqual(await list({data:[{...row,hidden:true},{...row,model:"synthetic-plus"}],nextCursor:"p2"},{data:[row]}),[fast,ultra]);
  assert.deepEqual(await list({data:[{...row,serviceTiers:[],additionalSpeedTiers:["fast"]}]}),[]);
  assert.deepEqual(await list({data:[row,{...row,id:"second-id"}]}),undefined);
  assert.deepEqual(await list({data:[],nextCursor:"p2"},{data:[row],nextCursor:"p2"}),undefined);
  assert.deepEqual(await list({data:[{...row,serviceTiers:[{id:"default",name:"Fast"},{id:"unknown",name:"Something else"}]}]}),[]);
});

test("explicit, revocable choice applies only to a matching Codex chat request; invalidations win against late results",async()=>{
  const handlers:Record<string,Function>={}; let command:Function, pick:string|undefined, hits=0, catalog:any=[fast], wait:(()=>void)|undefined;
  const model={provider:"openai-codex",api:"openai-codex-responses",id:"synthetic",baseUrl:"https://chatgpt.com/backend-api"};
  const session="fixture", ctx:any={mode:"tui",model:{...model},sessionManager:{getSessionId:()=>session},isIdle:()=>true,
    ui:{notify:()=>{},select:async(_title:string,items:string[])=>{assert.equal(items[0],"Estándar"); return pick;}}};
  const speed=registerSpeed({on:(name:string,h:Function)=>handlers[name]=h,registerCommand:(_n:string,c:any)=>{command=c.handler;}} as any,
    ()=>{throw Error("Codex must not read a direct credential");}, async()=>{hits++; if(wait) await new Promise<void>(r=>wait=r); return catalog;});
  const menu=()=>command!("",ctx), emit=(name:string,event:object={})=>handlers[name](event,ctx);
  const body={model:model.id,stream:true,store:false,include:["reasoning.encrypted_content"],input:[],prompt_cache_key:session};
  const apply=(payload:any=body)=>emit("before_provider_request",{payload});
  emit("agent_start");assert.equal(apply(),undefined); emit("agent_end");assert.equal(hits,0);
  pick=undefined;await menu();assert.equal(speed(ctx),undefined);
  pick="Fast";await menu();assert.equal(speed(ctx),"fast");assert.equal(apply(),undefined);
  emit("agent_start"); assert.deepEqual(apply(),{...body,service_tier:"priority"}); assert.ok(!Object.hasOwn(body,"service_tier"));
  for(const change of [{model:"other"},{service_tier:"flex"},{prompt_cache_key:"summary"},{store:true},{input:undefined}]) assert.equal(apply({...body,...change}),undefined);
  ctx.model.api="pi-virtual"; assert.equal(apply(),undefined);ctx.model={...model};
  ctx.model.baseUrl="https://other.invalid/"; assert.equal(apply(),undefined);ctx.model={...model};emit("agent_end");
  pick=undefined;await menu();assert.equal(speed(ctx),"fast");
  catalog=undefined;pick="Estándar";await menu();assert.equal(speed(ctx),undefined);
  catalog=[fast];pick="Fast";await menu();catalog=[];pick=undefined;await menu();assert.equal(speed(ctx),undefined);
  catalog=[fast];pick="Fast";wait=()=>{};const slow=menu();emit("model_select");wait!();await slow;assert.equal(speed(ctx),undefined);
  wait=undefined;await menu();emit("session_shutdown");assert.equal(speed(ctx),undefined);
  const calls=hits;ctx.model.provider="openai";await menu();assert.equal(hits,calls);
});

const cli=process.env.SS_TEST_PI_CLI;
test("Pi TUI: browsing/cancelling sends no turn; Fast changes only the requested tier, Estándar removes it",{skip:process.platform!=="linux"||!cli,timeout:45000},async()=>{
  await promisify(execFile)("python3",["-B",fileURLToPath(new URL("./fixtures/speed-tui.py",import.meta.url)),process.execPath,cli!,bundledCodexBin()],{timeout:40000});
});
