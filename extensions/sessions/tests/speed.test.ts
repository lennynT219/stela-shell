import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerSpeed } from "../codex-speed.ts";
import { readPiCodex, readPiCodexSpeeds } from "../codex-pi.ts";
import { decodePiQuota } from "../codex-quota.ts";

const fast = {id:"priority", name:"Fast"} as const;
const row = {slug:"synthetic", visibility:"list", service_tiers:[fast]};
const token = `fixture.${Buffer.from(JSON.stringify({"https://api.openai.com/auth":{chatgpt_account_id:"fixture"}})).toString("base64url")}.fixture`;
function codexHost() {
  const grant = {type:"oauth",access:token,accountId:"fixture",expires:Date.now()+60000};
  const model = {provider:"openai-codex",api:"openai-codex-responses",id:"synthetic",baseUrl:"https://chatgpt.com/backend-api"};
  const registry = {isUsingOAuth:()=>true,getProviderAuthStatus:()=>({source:"stored"}),getRegisteredNativeProvider:()=>undefined,
    getRegisteredProviderConfig:()=>undefined,getApiKeyAndHeaders:async():Promise<any>=>({ok:true,apiKey:grant.access})};
  const ctx:any = {mode:"tui",model:{...model},modelRegistry:registry,sessionManager:{getSessionId:()=>"fixture"},isIdle:()=>true,
    ui:{notify:()=>{},select:async()=>undefined}};
  const read = (provider: string) => { assert.equal(provider,"openai-codex"); return grant; };
  return {ctx,model,registry,read,grant};
}

test("Codex uses the Pi OAuth grant for exact visible model tiers, never a built-in catalog or legacy flags", async t=>{
  const {ctx,read}=codexHost(); let models:object[]=[]; let requests=0;
  t.mock.method(globalThis,"fetch",async(url:string,opts:RequestInit)=>{
    assert.equal(url,"https://chatgpt.com/backend-api/codex/models?client_version=0.171.0");
    assert.equal(opts.method,"GET");assert.equal(opts.redirect,"error");assert.equal(opts.body,undefined);
    const headers = new Headers(opts.headers);
    assert.equal(headers.get("authorization"),`Bearer ${token}`);
    assert.equal(headers.get("chatgpt-account-id"),"fixture");
    requests++;return Response.json({models});
  });
  const list=async(...rows:object[])=>{models=rows;return (await readPiCodexSpeeds(ctx,read,new AbortController().signal))?.tiers;};
  assert.deepEqual(await list({...row,visibility:"hide"},{...row,slug:"synthetic-more"},row),[fast]);
  assert.deepEqual(await list({...row,service_tiers:[],additional_speed_tiers:["fast"]}),[]);
  assert.equal(await list(row,row),undefined);
  assert.deepEqual(await list({...row,service_tiers:[{id:"flex",name:"Fast"},{id:"ultrafast",name:"Ultrafast"}]}),[{id:"ultrafast",name:"Ultrafast"}]);
  assert.equal(requests,4);
});

test("Codex quota rejects alternate auth and discards a receipt if the Pi login changes or the read is cancelled",async()=>{
  const {ctx,read,registry,grant}=codexHost(); let requests=0;
  const payload={rate_limit:{primary_window:{used_percent:64,limit_window_seconds:18000,reset_at:1234},
    secondary_window:{used_percent:28,limit_window_seconds:604800}},additional_rate_limits:[{limit_name:"unrelated"}]};
  const get:typeof fetch=async(url,opts)=>{
    assert.equal(String(url),"https://chatgpt.com/backend-api/wham/usage");
    assert.equal(opts?.method,"GET");assert.equal(opts.redirect,"error");
    assert.equal(new Headers(opts.headers).get("authorization"),`Bearer ${token}`);
    requests++;return Response.json(payload);
  };
  const query=(request=get, signal=new AbortController().signal)=>readPiCodex(ctx,read,"usage",signal,request);
  const r=await query();
  assert.deepEqual(decodePiQuota(r?.body),{state:"ok",windows:[
    {kind:"Principal",used:64,minutes:300,reset:1234},{kind:"Secundaria",used:28,minutes:10080,reset:undefined}
  ]});
  assert.ok(!JSON.stringify(r).includes(token));
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:"sk-test"});assert.equal(await query(),undefined);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:token,baseUrl:"https://other.invalid"});assert.equal(await query(),undefined);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:token,headers:{"ChatGPT-Account-Id":"other"}});assert.equal(await query(),undefined);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:token});grant.accountId="other";assert.equal(await query(),undefined);
  grant.accountId="fixture";registry.getProviderAuthStatus=()=>({source:"runtime"});assert.equal(await query(),undefined);
  registry.getProviderAuthStatus=()=>({source:"stored"});assert.equal(requests,1);
  assert.equal(await query(async (...args)=>{const response=await get(...args);grant.type="api_key";return response;}),undefined);
  grant.type="oauth";const abort=new AbortController();
  registry.getApiKeyAndHeaders=async()=>{abort.abort();return {ok:true,apiKey:token};};
  assert.equal(await query(get,abort.signal),undefined);assert.equal(requests,2);
});

test("explicit, revocable choice applies only to a matching Codex chat request; invalidations win against late results",async()=>{
  const handlers:Record<string,Function>={}; let command:Function, pick:string|undefined, hits=0, catalog:any=[fast], wait:(()=>void)|undefined;
  const {ctx,model,read}=codexHost();
  const session="fixture", fingerprint=createHash("sha256").update(token).digest("hex");
  ctx.ui.select=async(_title:string,items:string[])=>{assert.equal(items[0],"Estándar"); return pick;};
  const speed=registerSpeed({on:(name:string,h:Function)=>handlers[name]=h,registerCommand:(_n:string,c:any)=>{command=c.handler;}} as any,
    read, async()=>{hits++; if(wait) await new Promise<void>(r=>wait=r); return {tiers:catalog,fingerprint};});
  const menu=()=>command!("",ctx), emit=(name:string,event:object={})=>handlers[name](event,ctx);
  const body={model:model.id,stream:true,store:false,include:["reasoning.encrypted_content"],input:[],prompt_cache_key:session};
  const apply=(payload:any=body)=>emit("before_provider_request",{payload});
  emit("agent_start");assert.equal(apply(),undefined); emit("agent_end");assert.equal(hits,0);
  pick=undefined;await menu();assert.equal(speed(ctx),undefined);
  pick="Fast";await menu();assert.equal(speed(ctx),"fast");assert.equal(apply(),undefined);
  emit("agent_start"); assert.deepEqual(await apply(),{...body,service_tier:"priority"}); assert.ok(!Object.hasOwn(body,"service_tier"));
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

test("reload consumes the same-chat handoff once and restores only a still-advertised tier for the same login", async () => {
  for (const scenario of ["valid", "new", "quit", "different-manager", "different-session", "different-cwd", "different-model", "different-login", "retired-tier", "unavailable"] as const) {
    const {ctx,read,grant} = codexHost();
    ctx.cwd = "/fixture";
    let catalog = { tiers: [fast] as (typeof fast)[] | undefined, fingerprint: createHash("sha256").update(token).digest("hex") }, queries = 0;
    ctx.ui.select = async () => "Fast";
    const runtime = () => {
      const events: Record<string,Function> = {};
      let menu!: Function;
      const speed = registerSpeed({on:(name:string,f:Function)=>events[name]=f,registerCommand:(_:string,c:any)=>menu=c.handler} as any,
        read, async () => { queries++; return catalog; });
      return { speed, menu, emit:(name:string, reason:string, context=ctx)=>events[name]({reason},context) };
    };
    const old = runtime();
    await old.menu("",ctx); assert.equal(old.speed(ctx),"fast",scenario);
    old.emit("session_shutdown",scenario==="quit"?"quit":"reload"); assert.equal(old.speed(ctx),undefined);
    const next = runtime();
    const target = {...ctx,model:{...ctx.model}};
    if (scenario==="different-manager") target.sessionManager = {getSessionId:()=>"fixture"};
    if (scenario==="different-session") target.sessionManager.getSessionId = ()=>"different";
    if (scenario==="different-cwd") target.cwd = "/another";
    if (scenario==="different-model") target.model.id = "other";
    if (scenario==="different-login") grant.access += "rotated";
    if (scenario==="retired-tier") catalog = {...catalog,tiers:[]};
    if (scenario==="unavailable") catalog = {...catalog,tiers:undefined};
    await next.emit("session_start",scenario==="new"?"new":"reload",target);
    assert.equal(next.speed(target),scenario==="valid"?"fast":undefined,scenario);
    assert.equal(queries,["valid","retired-tier","unavailable"].includes(scenario)?2:1,scenario);
    const repeat = runtime();
    await repeat.emit("session_start","reload",target);
    assert.equal(repeat.speed(target),undefined,scenario);
  }
});

const cli=process.env.SS_TEST_PI_CLI;
test("Pi TUI: a reload preserves verified Fast, but a new chat and Standard do not inherit it",{skip:process.platform!=="linux"||!cli,timeout:45000},async()=>{
  await promisify(execFile)("python3",["-B",fileURLToPath(new URL("./fixtures/speed-tui.py",import.meta.url)),process.execPath,cli!],{timeout:40000});
});
