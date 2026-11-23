import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {createServer} from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledCodexBin, childEnv } from "../../codex-runtime.ts";
import { decodeQuota, queryQuota, quotaArgs, quotaLines } from "../codex-quota.ts";
import { recordedUSD, registerUsageFooter } from "../usage-footer.ts";

const bucket={limitId:"codex",primary:{usedPercent:0,windowDurationMins:300,resetsAt:null},secondary:{usedPercent:87,windowDurationMins:10080,resetsAt:null}};
test("only explicit Codex windows, local reset times, and no fabricated usage",()=>{
  const now=new Date(2030,0,1,14,0), end=new Date(2030,0,1,17,30).getTime()/1000;
  const q=decodeQuota({accountId:"private",rateLimits:{limitId:"other"},rateLimitsByLimitId:{unrelated:{}, codex:{...bucket,primary:{...bucket.primary,resetsAt:end}}}});
  assert.deepEqual(quotaLines(q,now).map(s=>s.replace(/ +/g," ")),["Codex Usado Reinicio","5 h 0% 17:30","7 d 87% —"]);
  assert.deepEqual(quotaLines(decodeQuota({rateLimits:{primary:{usedPercent:100}}})).slice(1),["Principal   100%  —"]);
  for (const response of [{}, {rateLimits:{}},{rateLimits:{...bucket,limitId:"other"}},{rateLimits:{primary:{usedPercent:null}}},{rateLimits:{primary:{usedPercent:-1}}},{rateLimitsByLimitId:{other:bucket},rateLimits:{primary:bucket.primary}}])
    assert.deepEqual(decodeQuota(response),{state:"unavailable"});
});

test("recorded USD and current context have distinct scopes; the cached line follows model, compaction and session",()=>{
  const u=(total:number)=>({cost:{total}});
  const entries:any[]=[{type:"usage",usage:u(.08)},{type:"message",message:{role:"assistant",usage:u(.12)}},
    {type:"message",message:{role:"toolResult",usage:u(.05)}},{type:"compaction",usage:u(.1)},{type:"branch_summary",usage:u(.07)},
    {type:"message",message:{role:"user",usage:u(99)}},{type:"tool_result",usage:u(99)}];
  let scans=0, ctxPct:number|null=38, leaf="a", model="selected", render:Function=()=>{};
  const sm={getSessionId:()=>"one",getLeafId:()=>leaf,getEntries:()=>{scans++;return entries;}};
  let reasoning=false, level:string|undefined="off";
  const ctx={mode:"tui",sessionManager:sm,get thinkingLevel(){return level;},get model(){return {id:model,reasoning}},getContextUsage:()=>({percent:ctxPct}),ui:{setFooter:(factory:Function)=>{render=factory({}, {fg:(_:string,s:string)=>s}).render;}}};
  registerUsageFooter({on:(_n:string,f:Function)=>f({},ctx)} as any,(s,w)=>s.slice(0,w));
  assert.equal(render(80)[0],"Ctx 38% · US$0.42 · selected"); render(80); assert.equal(scans,1);
  ctxPct=null; leaf="compaction"; assert.equal(render(80)[0],"Ctx — · US$0.42 · selected");
  model="other"; assert.equal(render(80)[0],"Ctx — · US$0.42 · other");
  reasoning=true; assert.equal(render(80)[0],"Ctx — · US$0.42 · other · off");
  level="high"; assert.equal(render(80)[0],"Ctx — · US$0.42 · other · high"); assert.equal(scans,3);
  model="long-model-name-for-small-terminals"; assert.match(render(38)[0],/^Ctx — · US\$0\.42 · long-model.* · high$/);
  level=undefined; assert.match(render(38)[0],/ · —$/);
  assert.equal(recordedUSD([{type:"usage",usage:u(NaN)}] as any),undefined);
});

test("stdio receipt: initialize then one read only, sign-out differs from failures and cancellation",async()=>{
  const src=`let steps=[];require('readline').createInterface({input:process.stdin}).on('line',s=>{let r=JSON.parse(s);steps.push(r.method);if(r.id===1) console.log(JSON.stringify({id:1,result:{}})); if(r.id===2){if(steps.join(',')!=='initialize,initialized,account/rateLimits/read'||!r.params.excludeResetCreditDetails) process.exit(2);const mode=process.argv[1];if(mode==='stall')return;console.log(mode==='bad'?'not JSON':JSON.stringify(mode==='ok'?{id:2,result:{rateLimits:${JSON.stringify(bucket)}}}:{id:2,error:{message:mode==='login'?'codex account authentication required to read rate limits':'do not display'}}))}})`;
  const run=(mode:string,signal=new AbortController().signal)=>queryQuota({bin:process.execPath,args:["-e",src,mode],cwd:tmpdir(),env:{}},signal);
  assert.equal((await run("ok")).state,"ok"); assert.equal((await run("login")).state,"signed-out");
  assert.equal((await run("bad")).state,"unavailable"); assert.equal((await run("error")).state,"unavailable");
  assert.equal((await run("stall",AbortSignal.timeout(100))).state,"unavailable");
});

test("pinned Codex reads usage without a thread and rejects the empty isolated profile",async()=>{
  const home=await mkdtemp(join(tmpdir(),"ss-quota-"));
  try {
    const local={HOME:home,USERPROFILE:home,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HTTPS_PROXY:"http://127.0.0.1:1",HTTP_PROXY:"http://127.0.0.1:1",ALL_PROXY:"http://127.0.0.1:1"};
    const q=await queryQuota({bin:bundledCodexBin(),cwd:home,env:childEnv(home,local),args:["app-server","--stdio"]},new AbortController().signal);
    assert.equal(q.state,"signed-out");
  } finally { await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:50}); }
});

test("two measured windows from the pinned app-server and a loopback-only synthetic Pro account",async()=>{
  const home=await mkdtemp(join(tmpdir(),"ss-quota-fake-")), routes:string[]=[];
  const now=Math.floor(Date.now()/1000), reset=now+3600;
  const win=(pct:number,seconds:number)=>({used_percent:pct,limit_window_seconds:seconds,reset_after_seconds:3600,reset_at:reset});
  const server=createServer((req,res)=>{
    routes.push(`${req.method} ${req.url}`);
    const ok=req.url==="/backend-api/wham/usage";
    res.writeHead(ok?200:404,{"Content-Type":"application/json"}); res.end(JSON.stringify(ok ? {plan_type:"pro",rate_limit:{allowed:true,limit_reached:false,primary_window:win(64,5*3600),secondary_window:win(28,7*24*3600)},additional_rate_limits:[]} : {}));
  });
  try {
    await new Promise<void>((resolve,reject)=>server.once("error",reject).listen(0,"127.0.0.1",resolve));
    const port=(server.address() as {port:number}).port;
    const enc=(o:object)=>Buffer.from(JSON.stringify(o)).toString("base64url");
    const jwt=`${enc({alg:"none",typ:"JWT"})}.${enc({exp:now+3600,iat:now,sub:"fixture","https://api.openai.com/auth":{chatgpt_plan_type:"pro",chatgpt_account_id:"fixture"}})}.fixture`;
    await writeFile(join(home,"auth.json"),JSON.stringify({auth_mode:"chatgpt",tokens:{id_token:jwt,access_token:jwt,refresh_token:"unused-fixture",account_id:"fixture"},last_refresh:new Date().toISOString()}),{mode:0o600});
    const env=childEnv(home,{HOME:home,USERPROFILE:home,SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,NO_PROXY:"127.0.0.1",HTTPS_PROXY:"http://127.0.0.1:1",HTTP_PROXY:"http://127.0.0.1:1",ALL_PROXY:"http://127.0.0.1:1"});
    const args=["-c",'cli_auth_credentials_store="file"',...quotaArgs.map(s=>s.startsWith("chatgpt_base_url=")?`chatgpt_base_url="http://127.0.0.1:${port}/backend-api/"`:s)];
    const q=await queryQuota({bin:bundledCodexBin(),args,cwd:home,env},new AbortController().signal);
    assert.deepEqual(q,{state:"ok",windows:[{kind:"Principal",used:64,minutes:300,reset},{kind:"Secundaria",used:28,minutes:10080,reset}]});
    assert.ok(routes.includes("GET /backend-api/wham/usage")); assert.ok(routes.every(s=>s.startsWith("GET ")),routes.join(", "));
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

const cli=process.env.SS_TEST_PI_CLI;
test("Pi TUI: compact footer and account quota stay on separate surfaces",{skip:process.platform!=="linux"||!cli,timeout:45000},async()=>{
  await promisify(execFile)("python3",["-B",fileURLToPath(new URL("./fixtures/usage-tui.py",import.meta.url)),process.execPath,cli!],{timeout:40000});
});
