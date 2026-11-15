import assert from "node:assert/strict";
import { test } from "node:test";
import web, { WebClient, registerWeb, boundedResult, errorResult, MAX_OUTPUT, DEADLINE_MS } from "../index.ts";
import { WebError } from "../network.ts";

const input={query:"AbortSignal documentation",objective:"Find public API evidence"};
const data=()=>({provider:"exa" as const,retrieved_at:"2026-11-15T00:00:00.000Z",results:[{title:"API",url:"https://example.org/docs",snippet:"Evidence"}],truncated:false,warnings:["ADAPTER_WARNING"]});
const code=(expected:string)=>(error:any)=>error instanceof WebError&&error.code===expected;
const tick=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
function harness(overrides:any={}) {
  const hooks=new Map<string,Function[]>(),tools=new Map<string,any>();let sessionId="a",calls=0;
  const manager={getSessionId:()=>sessionId};const ctx:any={sessionManager:manager};
  const text=(content:string):any=>({content,render:()=>content.split("\n"),invalidate(){}});
  const pi:any={on:(event:string,callback:Function)=>hooks.set(event,[...(hooks.get(event)??[]),callback]),registerTool:(tool:any)=>tools.set(tool.name,tool)};
  registerWeb(pi,{env:{},text,search:async()=>{calls++;return data();},...overrides});
  return {pi,ctx,tools,hooks,get calls(){return calls;},setSession(value:string){sessionId=value;},
    async emit(event:string,value:any={}){for(const fn of hooks.get(event)??[])await fn(value,ctx);}};
}

test("web registration has compact ss identity, no startup I/O and helper exclusion before all hooks",async()=>{
  const h=harness();assert.equal(h.calls,0);
  assert.deepEqual([...h.tools.keys()],["ss_web_search","ss_web_read"]);
  const readTool=h.tools.get("ss_web_read");assert.equal(readTool.label,"Leer página");assert.deepEqual(readTool.parameters.required,["url"]);assert.equal(readTool.parameters.additionalProperties,false);
  const tool=h.tools.get("ss_web_search");assert.ok(tool);assert.equal(tool.label,"Buscar web");assert.equal(tool.parameters.additionalProperties,false);
  assert.deepEqual(tool.parameters.required,["query","objective"]);
  const theme:any={fg:(_key:string,value:string)=>value,bold:(value:string)=>value};
  assert.equal(tool.renderCall({},theme,{expanded:false}).content,"Buscar web");
  assert.equal(tool.renderCall({},theme,{expanded:true}).content,"Buscar web ss_web_search");
  await h.emit("session_start");assert.equal(h.calls,0);
  const result=await tool.execute("call",input,undefined,undefined,h.ctx);assert.equal(result.details.status,"ok");
  const value=JSON.parse(result.content[0].text);assert.equal(value.provider,"exa");assert.ok(value.warnings.includes("ADAPTER_WARNING"));
  assert.match(value.warnings[0],/UNTRUSTED WEB EVIDENCE/);assert.equal(value.document_version,"unknown");
  assert.equal(result.details.results,1);assert.doesNotMatch(JSON.stringify(result.details),/Evidence/);
  assert.match(tool.renderResult(result,{expanded:false},theme).content,/1 fuentes/);
  assert.match(tool.renderResult(result,{expanded:true},theme).content,/Evidence/);
  const child=harness({env:{STELA_SUBAGENT_CHILD:"1"}});assert.equal(child.tools.size,0);assert.equal(child.hooks.size,0);
  const original=process.env.STELA_SUBAGENT_CHILD;process.env.STELA_SUBAGENT_CHILD="1";
  try{await web(child.pi);}finally{if(original===undefined)delete process.env.STELA_SUBAGENT_CHILD;else process.env.STELA_SUBAGENT_CHILD=original;}
  assert.equal(child.tools.size,0);
});

test("one shared two-operation budget rejects busy without queue; cancellation releases owned slots",async()=>{
  let calls=0;const started:Function[]=[];
  const waiting=async(_input:any,signal:AbortSignal):Promise<never>=>{
    calls++;return await new Promise((_resolve,reject)=>{started.push(()=>{});signal.addEventListener("abort",()=>reject(new WebError("CANCELLED")),{once:true});});
  };
  const client=new WebClient({env:{},search:waiting,read:waiting});
  const a=client.search(input),b=client.read({url:"https://example.org/"});const aError=assert.rejects(a,code("CANCELLED")),bError=assert.rejects(b,code("CANCELLED"));
  await tick();await assert.rejects(client.search(input),code("BUSY"));await assert.rejects(client.read({url:"https://example.org/"}),code("BUSY"));assert.equal(calls,2);
  await client.close();await Promise.all([aError,bError]);assert.equal(started.length,2);
  await assert.rejects(client.search(input),code("CLOSED"));
  const already=new AbortController();already.abort();
  await assert.rejects(new WebClient({env:{}}).search(input,already.signal),code("CANCELLED"));
});

test("global deadline aborts actual owned waiting and invalid extended budgets fail before work",async()=>{
  let observed=false;
  const client=new WebClient({env:{},deadlineMs:25,search:async(_input,signal)=>await new Promise((_resolve,reject)=>{
    signal.addEventListener("abort",()=>{observed=true;reject(new WebError("CANCELLED"));},{once:true});
  })});
  await assert.rejects(client.search(input),code("DEADLINE"));assert.equal(observed,true);await client.close();
  for(const deadlineMs of [0,-1,Infinity,NaN,DEADLINE_MS+1])await assert.rejects(new WebClient({env:{},deadlineMs}).search(input),code("INVALID_INPUT"));
  await assert.rejects(new WebClient({env:{HTTPS_PROXY:"http://proxy.example.org/"}}).search(input),code("PROXY_UNSUPPORTED"));
});

test("complete serialized output budget preserves Unicode/URLs and does not duplicate page body",()=>{
  const source="https://example.org/"+"x".repeat(1800);
  const value={kind:"read",status:"ok",requested_url:source,final_url:source,truncated:false,warnings:[],content:'😀漢字"\\\n'.repeat(10_000)};
  const result=boundedResult(value),parsed=JSON.parse(result.content[0].text);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=MAX_OUTPUT);assert.equal(parsed.truncated,true);assert.equal(parsed.status,"partial");
  assert.equal(parsed.requested_url,source);assert.equal(parsed.final_url,source);assert.ok(parsed.content.length>0);
  assert.doesNotMatch(parsed.content,/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
  assert.equal(value.truncated,false);assert.equal(value.content.length,'😀漢字"\\\n'.repeat(10_000).length);
  assert.equal((JSON.stringify(result.details).match(/😀/gu)??[]).length,0);
  const search=boundedResult({kind:"search",status:"ok",truncated:false,warnings:[],results:Array.from({length:10},(_,i)=>({title:"😀".repeat(1000),url:source+String(i),snippet:"S".repeat(10000)}))});
  const rows=JSON.parse(search.content[0].text);assert.ok(Buffer.byteLength(JSON.stringify(search))<=MAX_OUTPUT);
  assert.equal(rows.truncated,true);assert.ok(rows.results.length<10);assert.ok(rows.results.every((row:any)=>row.url.startsWith(source)));
  const controls=boundedResult({kind:"read",status:"ok",truncated:false,warnings:[],content:"Evidence\u202e\u009b"});
  assert.doesNotMatch(controls.content[0].text,/[\u202e\u009b]/u);assert.equal(JSON.parse(controls.content[0].text).content,"Evidence\u202e\u009b");
});

test("navigation/shutdown owns cancellation; foreign or replaced contexts cannot start network work",async()=>{
  let sawAbort=false;
  const h=harness({search:async(_input:any,signal:AbortSignal)=>await new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>{sawAbort=true;reject(new WebError("CANCELLED"));},{once:true}))});
  await h.emit("session_start");const tool=h.tools.get("ss_web_search");
  const pending=tool.execute("call",input,undefined,undefined,h.ctx);await tick();
  await h.emit("session_before_tree");assert.equal((await pending).details.code,"CANCELLED");assert.equal(sawAbort,true);
  const wrong=await tool.execute("call",input,undefined,undefined,{sessionManager:{getSessionId:()=>"a"}});assert.equal(wrong.details.code,"CLOSED");
  h.setSession("b");assert.equal((await tool.execute("call",input,undefined,undefined,h.ctx)).details.code,"CLOSED");
  await h.emit("session_tree");await h.emit("session_shutdown");assert.equal((await tool.execute("call",input,undefined,undefined,h.ctx)).details.code,"CLOSED");
  const error=errorResult(new Error("credential DO_NOT_ECHO"));assert.equal(error.details.code,"NETWORK_FAILED");assert.doesNotMatch(JSON.stringify(error),/DO_NOT_ECHO/);
});
