import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerSpeed } from "../codex-speed.ts";
import { directTiers, readDirectSpeeds } from "../openai-speed.ts";

const base = "https://api.openai.com/v1", model = "future-model", fast = {id:"priority",name:"Fast"}, ultra = {id:"ultrafast",name:"Ultrafast"};
const visible = {slug:model, visibility:"list", service_tiers:[fast]};
const ok = () => Response.json({models:[visible]});
const signal = () => new AbortController().signal;
function host() {
  const grant = {type:"oauth",access:"synthetic-subscription-token",expires:Date.now()+60000,scopes:["chatgpt.tokens.use.direct"]};
  const registry = { isUsingOAuth:()=>true, getProviderAuthStatus:()=>({source:"stored"}), getRegisteredNativeProvider:()=>undefined,
    getRegisteredProviderConfig:()=>undefined, getApiKeyAndHeaders:async():Promise<any>=>({ok:true,apiKey:grant.access}) };
  const ctx:any = {model:{provider:"openai",api:"openai-responses",id:model,baseUrl:base},modelRegistry:registry,
    mode:"tui",sessionManager:{getSessionId:()=>"current"},isIdle:()=>true,ui:{notify(){},select:async()=>"Fast"}};
  return {grant,registry,ctx};
}

test("the direct subscription catalog matches exact visible slugs; missing, ambiguous, hidden and legacy entries cannot opt in",()=>{
  const c = {models:[visible,{slug:"second-model",visibility:"list",service_tiers:[ultra]},{...visible,slug:"future",visibility:"hide"},
    {...visible,slug:"standard-only",service_tiers:[],additional_speed_tiers:["fast"],default_service_tier:"priority"}]};
  assert.deepEqual(directTiers(c,model),[fast]); assert.deepEqual(directTiers(c,"second-model"),[ultra]);
  for(const id of ["future","other","standard-only"]) assert.deepEqual(directTiers(c,id),[]);
  for(const v of [{data:[visible]},{models:[visible,visible]},{models:[{...visible,service_tiers:[fast,fast]}]}]) assert.equal(directTiers(v,model),undefined);
});

test("GET only for the effective native subscription credential, fixed destination, no redirects or API-key fallback",async()=>{
  const {ctx,registry,grant}=host(); let requests=0;
  const get:typeof fetch=async(url,opts)=>{
    assert.equal(String(url),base+"/models");assert.equal(opts?.method,"GET"); assert.equal(opts.redirect,"error"); assert.equal(opts.body,undefined);
    assert.equal(opts.credentials,"omit");assert.equal(new Headers(opts.headers).get("Authorization"),"Bearer synthetic-subscription-token");
    requests++;return ok();
  };
  const read=()=>readDirectSpeeds(ctx,()=>grant,signal(),get);
  const discovery=await read();assert.deepEqual(discovery?.tiers,[fast]); assert.equal(JSON.stringify(discovery).includes(grant.access),false);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:"another-credential"});assert.equal(await read(),undefined);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:grant.access,baseUrl:"https://other.invalid"});assert.equal(await read(),undefined);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:grant.access,headers:{Authorization:"different"}});assert.equal(await read(),undefined);
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:grant.access});
  grant.scopes=[]; assert.equal(await read(),undefined);grant.scopes=["chatgpt.tokens.use.direct"];
  grant.type="api_key";assert.equal(await read(),undefined);grant.type="oauth";
  ctx.model.baseUrl="https://gateway.invalid/v1";assert.equal(await read(),undefined);ctx.model.baseUrl=base;
  registry.getProviderAuthStatus=()=>({source:"runtime"});assert.equal(await read(),undefined);registry.getProviderAuthStatus=()=>({source:"stored"});
  registry.isUsingOAuth=()=>false;assert.equal(await read(),undefined);
  assert.equal(requests,1);
});

test("invalid receipts never disclose response text or select from a partial catalog",async()=>{
  const {ctx,grant}=host();
  for (const response of [new Response('private error',{status:403}),new Response('{"models":'),
      new Response('private',{headers:{"content-length":String(9*1024*1024)}}),new Response(new Uint8Array(8*1024*1024+1))]) {
    const got=await readDirectSpeeds(ctx,()=>grant,signal(),async()=>response);
    assert.equal(got?.tiers,undefined);assert.ok(!JSON.stringify(got??{}).includes("private"));
  }
  assert.equal(await readDirectSpeeds(ctx,()=>grant,AbortSignal.abort(),async()=>{throw Error("unexpected");}),undefined);
});

test("an explicit choice is bound to its login and model, including switches during discovery and auth checks",async t=>{
  const {ctx,grant,registry}=host(); let picks=0, cmd:Function=()=>{}, fetches=0;
  const handlers:Record<string,Function>={};
  ctx.ui.select=async()=>{picks++;return "Fast";};
  const speed=registerSpeed({on:(n:string,h:Function)=>handlers[n]=h,registerCommand:(_:string,c:any)=>cmd=c.handler} as any,
    ()=>grant,async()=>{throw Error("direct path must not use Codex");});
  const get=t.mock.method(globalThis,"fetch",async()=>{fetches++;return ok();});
  const menu=()=>cmd("",ctx), emit=(n:string)=>handlers[n]({},ctx);
  const body={model,input:[],store:false,stream:true}; // no reasoning, no include
  const apply=()=>handlers.before_provider_request({payload:body},ctx);
  await menu();assert.equal(picks,1);assert.equal(speed(ctx),"fast");emit("agent_start");
  assert.deepEqual(await apply(),{...body,service_tier:"priority"}); grant.access="new-user";assert.equal(await apply(),undefined);assert.equal(speed(ctx),undefined);emit("agent_end");
  await menu();emit("agent_start");registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:"unexpected-api-credential"});
  assert.equal(await apply(),undefined);assert.equal(speed(ctx),undefined);emit("agent_end");
  registry.getApiKeyAndHeaders=async()=>({ok:true,apiKey:grant.access});
  get.mock.mockImplementation(async()=>{fetches++;ctx.model.id="replacement";emit("model_select");return ok();});
  await menu();assert.equal(picks,2);assert.equal(speed(ctx),undefined);
  ctx.model.id=model;get.mock.mockImplementation(async()=>{fetches++;return ok();});await menu();emit("agent_start");
  registry.getApiKeyAndHeaders=async()=>{emit("model_select");return {ok:true,apiKey:grant.access};};
  assert.equal(await apply(),undefined);assert.equal(fetches,4,"no catalog query per turn or on a switch");
});

const cli=process.env.SS_TEST_PI_CLI;
test("Pi TUI direct: Fast on a non-reasoning model, Ultrafast on another, standard only on a third",{skip:process.platform!=="linux"||!cli,timeout:45000},async()=>{
  await promisify(execFile)("python3",["-B",fileURLToPath(new URL("./fixtures/direct-speed-tui.py",import.meta.url)),process.execPath,cli!],{timeout:40000});
});
