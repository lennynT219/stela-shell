import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerMemory } from "../index.ts";
import type { Client, Configuration } from "../state.ts";
import type { ObjectValue, Operation } from "../protocol.ts";
import type { ExecutableSelection } from "../executable.ts";

function host(options:{configured?:boolean;child?:boolean;write?:boolean;found?:boolean;realConfiguration?:boolean;env?:NodeJS.ProcessEnv;resolveExecutable?:(selection:ExecutableSelection,cwd:string)=>string}={}) {
  const hooks=new Map<string,Function[]>(),tools=new Map<string,any>(),flags=new Map<string,unknown>(),statuses:any[]=[];
  let active=options.write===false?["ss_memory_read"]:["ss_memory_read","ss_memory_save"],calls:Operation[]=[],cancelled=0,closed=0,clientCount=0,unavailable=false,configurationValid=true;
  const configurations:Configuration[]=[];
  let closeGate:{wait:Promise<void>;started:()=>void}|undefined;
  const cwd=join(tmpdir(),"ss-memory-extension"),manager={getSessionId:()=>"owned-session"};
  const ctx:any={cwd,sessionManager:manager,hasUI:false,signal:undefined,ui:{setStatus:(...x:any[])=>statuses.push(x)},model:{contextWindow:32000}};
  const pi:any={on:(event:string,callback:Function)=>{hooks.set(event,[...(hooks.get(event)??[]),callback]);},registerFlag:(n:string,x:any)=>flags.set(n,x.default),
    getFlag:(n:string)=>flags.get(n),getActiveTools:()=>active,registerTool:(tool:any)=>tools.set(tool.name,tool)};
  const config:Configuration={executable:join(tmpdir(),process.platform==="win32"?"brain.exe":"brain"),vault:join(tmpdir(),"vault"),boundary:cwd};
  const client:Client={call:async(operation:Operation)=>{calls.push(operation);if(unavailable)throw Error("private backend diagnostic");
    const id="550e8400-e29b-41d4-a716-446655440001",raw="SYNTHETIC_EPHEMERAL_ONLY";
    return {protocol_version:1,request_id:"unused",operation,result:options.found?{status:"found",binding_directory:cwd,binding:{binding_version:1,memory_id:id},memory:{status:"found",memory_id:id,revision:1,accepted_markdown:raw,observed_markdown:raw,approval_candidate:null,reason:null}}:{status:"unbound",directory:cwd}};},cancel:()=>{cancelled++;},close:async()=>{closed++;if(closeGate){closeGate.started();await closeGate.wait;}}};
  registerMemory(pi,{env:options.env??(options.child?{STELA_SUBAGENT_CHILD:"1"}:{}),
    ...(options.realConfiguration?{}:{configuration:()=>options.configured===false?undefined:config}),
    resolveExecutable:options.resolveExecutable,configuredVaultGuard:()=>{let changed=false;return()=>{if(!configurationValid)changed=true;return!changed;};},
    client:(_ctx,selected)=>{clientCount++;configurations.push({...selected});return client;}});
  const emit=async(name:string,event:any={},context=ctx)=>{let result;for(const cb of hooks.get(name)??[])result=await cb(event,context)??result;return result;};
  return {pi,ctx,tools,hooks,flags,calls,statuses,config,configurations,emit,setConfigurationChanged:()=>{configurationValid=false;},setActive:(a:string[])=>active=a,setUnavailable:()=>{unavailable=true;},holdClose:()=>{let release!:()=>void,notify!:()=>void;const wait=new Promise<void>(r=>release=r),started=new Promise<void>(r=>notify=r);closeGate={wait,started:notify};return{release,started};},count:()=>({clientCount,cancelled,closed})};
}

test("helpers are excluded before tools/lifecycle/resources; unavailable host seam does no I/O",async()=>{
  const child=host({child:true});assert.equal(child.flags.size,0);assert.equal(child.tools.size,0);assert.equal(child.hooks.size,0);assert.equal(child.count().clientCount,0);
  const disabled=host({configured:false});await disabled.emit("session_start");await disabled.emit("input",{source:"rpc"});await disabled.emit("before_agent_start",{systemPrompt:"BASE"});
  assert.equal(disabled.count().clientCount,0);assert.deepEqual(disabled.calls,[]);
  const result=await disabled.tools.get("ss_memory_save").execute("id",{reason:"test"},undefined,undefined,disabled.ctx);
  assert.equal(result.isError,true);assert.match(result.content[0].text,/NOT_CONFIGURED/);
  const invalid=host();invalid.config.boundary="relative";await invalid.emit("session_start");
  assert.deepEqual(invalid.calls,[]);assert.match(JSON.stringify(invalid.statuses),/configuración inválida/);
});

test("only genuine interactive/RPC input enables read-before-work; recalled context stays untrusted and ephemeral",async()=>{
  const h=host({found:true});await h.emit("session_start");assert.deepEqual(h.calls,[]);
  await h.emit("input",{source:"extension"});assert.equal(await h.emit("before_agent_start",{systemPrompt:"BASE"}),undefined);assert.deepEqual(h.calls,[]);
  await h.emit("input",{source:"rpc"});const prompt=await h.emit("before_agent_start",{systemPrompt:"BASE"});assert.equal(h.calls[0],"resolve");assert.match(prompt.systemPrompt,/^BASE/);assert.match(prompt.systemPrompt,/BEFORE composing/);
  const original=[{role:"user",content:"Meaningful work"}],result=await h.emit("context",{messages:original});
  assert.match(result.messages[0].content,/UNTRUSTED RECALLED PROJECT DATA/);assert.equal(result.messages[1],original[0]);assert.equal(original.length,1);
  assert.equal(h.calls.length,1);await h.emit("agent_settled",{aborted:false});assert.equal(h.calls.length,1,"settlement must never publish or start bookkeeping");
  const read=await h.tools.get("ss_memory_read").execute("id",{},undefined,undefined,h.ctx);
  assert.equal(read.details.status,"found");assert.doesNotMatch(JSON.stringify(read),/SYNTHETIC_EPHEMERAL_ONLY|accepted_markdown/);
  assert.match((await h.emit("context",{messages:[]})).messages[0].content,/SYNTHETIC_EPHEMERAL_ONLY/);
});

test("automatic lookup failure is not retried by later context hooks; inactive reader cannot be bypassed",async()=>{
  const h=host();h.setUnavailable();await h.emit("session_start");await h.emit("input",{source:"interactive"});await h.emit("before_agent_start",{systemPrompt:"BASE"});
  await h.emit("context",{messages:[]});await h.emit("context",{messages:[]});assert.deepEqual(h.calls,["resolve"]);
  assert.doesNotMatch(JSON.stringify(h.statuses),/private backend diagnostic/);
  const denied=host();await denied.emit("session_start");denied.setActive(["ss_memory_save"]);await denied.emit("input",{source:"rpc"});await denied.emit("before_agent_start",{systemPrompt:"BASE"});assert.deepEqual(denied.calls,[]);
  const revoked=[];
  for(const change of ["reader","configuration"]) {
    const cached=host({found:true});await cached.emit("session_start");await cached.emit("input",{source:"rpc"});await cached.emit("before_agent_start",{systemPrompt:"BASE"});
    if(change==="reader")cached.setActive(["ss_memory_save"]);else cached.config.vault=join(tmpdir(),"different-vault");
    const recalled=await cached.emit("context",{messages:[]});revoked.push(recalled.messages[0].content.includes("AUTHORITY_CHANGED"));
    assert.doesNotMatch(recalled.messages[0].content,/SYNTHETIC_EPHEMERAL_ONLY/);
    assert.deepEqual(cached.calls,["resolve"],"revocation must not silently load another scope");
  }
  assert.deepEqual(revoked,[true,true],"cached context must not escape read/configuration revocation");
});

test("navigation, compaction, multiple input and shutdown invalidate/cancel owners, never write from hooks",async()=>{
  const h=host();await h.emit("session_start");await h.emit("input",{source:"rpc"});await h.emit("before_agent_start",{systemPrompt:"BASE"});
  for(const event of ["session_before_compact","session_compact"])await h.emit(event);
  await h.emit("context",{messages:[]});assert.deepEqual(h.calls,["resolve","resolve"]);
  await h.emit("input",{source:"rpc",streamingBehavior:"steer"});await h.emit("context",{messages:[]});assert.equal(h.calls.length,3);
  const old=await h.tools.get("ss_memory_read").execute("id",{},undefined,undefined,{...h.ctx,sessionManager:{getSessionId:()=>"other"}});assert.equal(old.isError,true);
  await h.emit("session_before_tree");await h.emit("session_tree");assert.equal(h.count().closed,1);
  assert.deepEqual(h.statuses.at(-1),["ss-memory",undefined],"old-owner saved status must not carry into a new context");
  assert.equal(await h.emit("context",{messages:[]}),undefined,"new navigation owner needs genuine input first");
  await h.emit("agent_settled",{aborted:true});await h.emit("session_shutdown");assert.equal(h.count().closed,2);assert.equal(h.calls.some(op=>op!=="resolve"),false);
});

test("overlapping navigation startups wait for the same owned client close before creating a new one",async()=>{
  const h=host();await h.emit("session_start");const held=h.holdClose();
  const first=h.emit("session_tree");await held.started;const second=h.emit("session_tree");
  await h.emit("context",{messages:[]});const before=h.count().clientCount;
  held.release();await Promise.all([first,second]);assert.equal(before,1,"new resource ownership cannot bypass an outstanding close");assert.equal(h.count().clientCount,2);
});

test("normal tool surfaces name permission hints and pre-final policy without model authority arguments",()=>{
  const h=host(),read=h.tools.get("ss_memory_read"),save=h.tools.get("ss_memory_save");
  assert.equal(read.annotations.readOnlyHint,true);assert.equal(save.annotations.readOnlyHint,false);assert.equal(save.label,"Guardar memoria");
  for(const name of ["vault","executable","cwd","memory_id","expected","human_approved"])assert.equal(Object.hasOwn(save.parameters.properties,name),false);
  assert.equal(save.parameters.additionalProperties,false);assert.match(save.promptGuidelines.join("\n"),/No later\/post-response save/);
  assert.equal(h.flags.size,0,"Memory registers no startup flags");assert.equal(h.tools.has("ss_memory_stage"),false);
});

test("loading Memory authorizes current-folder use with Brain configuration and no startup flags",async()=>{
  const selected=join(tmpdir(),process.platform==="win32"?"selected.exe":"selected"),selections:ExecutableSelection[]=[];
  const h=host({realConfiguration:true,env:{BRAIN_BIN:selected},resolveExecutable:(selection)=>{selections.push({...selection});return selection.command;}});
  await h.emit("session_start");assert.equal(h.flags.size,0);assert.deepEqual(selections,[{command:selected,path:""}]);
  assert.deepEqual(h.configurations,[{executable:selected,boundary:h.ctx.cwd}],"vault selection belongs to Brain, not an SS flag");
  assert.deepEqual(h.calls,[],"startup must not launch a Brain request");
  await h.emit("input",{source:"rpc"});await h.emit("before_agent_start",{systemPrompt:"BASE"});assert.deepEqual(h.calls,["resolve"]);
  await h.tools.get("ss_memory_save").execute("id",{reason:"Useful outcome",title:"Fixture",sections:["Scope","Decisions","Status","Evidence","Next"]},undefined,undefined,h.ctx);
  assert.equal(h.calls.includes("create"),true,"ordinary mutation is admitted without a separate write flag");
});

test("executable is pinned per owner; command/PATH/environment/config drift denies old cached delivery",async()=>{
  for(const change of ["command","path","environment","configuration"]) {
    const env:NodeJS.ProcessEnv={BRAIN_BIN:"chosen-brain",PATH:join(tmpdir(),"selected-bin")},selections:ExecutableSelection[]=[];
    const h=host({realConfiguration:true,found:true,env,resolveExecutable:(selection)=>{selections.push({...selection});return join(tmpdir(),process.platform==="win32"?"pinned.exe":"pinned");}});
    await h.emit("session_start");assert.deepEqual(selections,[{command:"chosen-brain",path:env.PATH}]);
    await h.emit("input",{source:"rpc"});await h.emit("before_agent_start",{systemPrompt:"BASE"});
    assert.match((await h.emit("context",{messages:[]})).messages[0].content,/SYNTHETIC_EPHEMERAL_ONLY/);
    if(change==="command")env.BRAIN_BIN="different-brain";
    else if(change==="path")env.PATH=join(tmpdir(),"different-bin");
    else if(change==="environment")env.TMPDIR=join(tmpdir(),"different-environment");
    else h.setConfigurationChanged();
    const recalled=await h.emit("context",{messages:[]});assert.match(recalled.messages[0].content,/AUTHORITY_CHANGED/);
    assert.doesNotMatch(recalled.messages[0].content,/SYNTHETIC_EPHEMERAL_ONLY/);assert.equal(selections.length,1);assert.deepEqual(h.calls,["resolve"]);
    await h.emit("session_tree");assert.equal(selections.length,2,"only a new owner selects an executable again");
  }
});

test("absolute BRAIN_BIN ignores unrelated PATH changes; ordinary tool revocation still denies saves",async()=>{
  const env={BRAIN_BIN:join(tmpdir(),process.platform==="win32"?"brain.exe":"brain"),PATH:join(tmpdir(),"ignored-bin")},selections:ExecutableSelection[]=[];
  const h=host({realConfiguration:true,found:true,env,resolveExecutable:(selection)=>{selections.push({...selection});return selection.command;}});
  await h.emit("session_start");assert.deepEqual(selections,[{command:env.BRAIN_BIN,path:""}]);
  await h.emit("input",{source:"rpc"});await h.emit("before_agent_start",{systemPrompt:"BASE"});env.PATH="other";
  assert.match((await h.emit("context",{messages:[]})).messages[0].content,/SYNTHETIC_EPHEMERAL_ONLY/);assert.equal(selections.length,1);
  h.setActive(["ss_memory_read"]);
  const result=await h.tools.get("ss_memory_save").execute("id",{reason:"Blocked write",body:"body"},undefined,undefined,h.ctx);
  assert.equal(result.isError,true);assert.match(result.content[0].text,/AUTHORITY_CHANGED/);assert.deepEqual(h.calls,["resolve"]);
});
