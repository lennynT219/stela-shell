import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync,writeFileSync,readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryClient } from "../client.ts";
const cli=process.env.SS_TEST_PI_CLI??process.env.STELA_TEST_PI_CLI,brain=process.env.SS_TEST_BRAIN_EXE;
const provider=fileURLToPath(new URL("./fixtures/provider.ts",import.meta.url)),extension=fileURLToPath(new URL("../index.ts",import.meta.url));
function setup(){
  const root=mkdtempSync(join(tmpdir(),"ss-memory-pi-")),work=join(root,"work"),vault=join(root,"vault"),profile=join(root,"agent");
  for(const p of [work,profile,...["00-limbo","01-proyectos","02-areas","03-recursos","04-archivo","99-sistema","99-sistema/plantillas","99-sistema/documentacion"].map(p=>join(vault,p))])mkdirSync(p,{recursive:true});
  const config=join(root,".config","brain");mkdirSync(config,{recursive:true});
  writeFileSync(join(config,"config.toml"),`config_version = 1\nvault_path = ${JSON.stringify(vault)}\n`);
  return{root,work,vault,profile};
}
type Fixture=ReturnType<typeof setup>;
function client(f:Fixture,mode="normal",options:{configured?:boolean;child?:boolean;executable?:string;current?:string}={}){
  const memory=options.configured===false?[]:["--extension",extension];
  const child=spawn(process.execPath,[cli!,"--offline","--mode","rpc","--no-session","--no-extensions","--no-mcp","--no-skills","--no-prompt-templates","--no-context-files","--no-approve","--extension",provider,...memory,"--model","ss-memory-fixture/deterministic","--thinking","off"],{
    cwd:f.work,env:{PATH:process.env.PATH,BRAIN_BIN:options.executable??brain!,HOME:f.root,USERPROFILE:f.root,TMPDIR:f.root,PI_CODING_AGENT_DIR:f.profile,PI_OFFLINE:"1",NO_UPDATE_NOTIFIER:"1",SS_MEMORY_FIXTURE_MODE:mode,...(options.current?{SS_MEMORY_FIXTURE_CURRENT:options.current}:{}),...(options.child?{STELA_SUBAGENT_CHILD:"1"}:{})},stdio:["pipe","pipe","pipe"]});
  const events:any[]=[],waits=new Set<any>();let buffer="",stderr="",bytes=0,counter=0,failure:Error|undefined;
  const fail=(error:Error)=>{failure=error;for(const w of waits){clearTimeout(w.timer);w.reject(error);}waits.clear();};
  child.stdout.setEncoding("utf8");child.stdout.on("data",(chunk:string)=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024){fail(new Error("Fixture output bound exceeded"));child.kill("SIGKILL");return;}
    buffer+=chunk;let split;
    while((split=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);if(!line.trim())continue;
      try{const e=JSON.parse(line);events.push(e);for(const w of [...waits])if(w.predicate(e)){clearTimeout(w.timer);waits.delete(w);w.resolve(e);}}catch{fail(new Error("Malformed RPC fixture"));}}
  });
  child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});child.on("error",fail);
  const exited=new Promise<void>(resolve=>child.once("exit",code=>{fail(new Error(`Fixture exit ${code}: ${stderr}`));resolve();}));
  const waitFor=(predicate:(e:any)=>boolean,start=0)=>{
    const e=events.slice(start).find(predicate);if(e)return Promise.resolve(e);if(failure)return Promise.reject(failure);
    return new Promise<any>((resolve,reject)=>{const w={predicate,resolve,reject,timer:setTimeout(()=>{waits.delete(w);reject(new Error(`Fixture deadline: ${stderr}\n${JSON.stringify(events.slice(-5))}`));},20_000)};waits.add(w);});
  };
  const send=(value:any)=>child.stdin.write(JSON.stringify(value)+"\n");
  const request=async(type:string,extra={})=>{const id=`memory-rpc-${++counter}`,pending=waitFor(e=>e.type==="response"&&e.id===id);send({id,type,...extra});const response=await pending;assert.equal(response.success,true,JSON.stringify(response));return response.data;};
  return{events,waitFor,request,send,async run(action:string,approval?:boolean){const start=events.length;
    const final=waitFor(e=>e.type==="message_end"&&e.message?.role==="assistant"&&e.message.content.some((p:any)=>p.type==="text"&&/^(MEMORY_|UNEXPECTED_)/.test(p.text)),start);
    const dialog=approval===undefined?undefined:waitFor(e=>e.type==="extension_ui_request"&&e.method==="confirm",start);
    await request("prompt",{message:`CASE:${action}`});
    if(dialog){const d=await dialog;send({type:"extension_ui_response",id:d.id,confirmed:approval});}
    const answer=await final;await waitFor(e=>e.type==="agent_settled",start);return{start,answer,text:answer.message.content.filter((p:any)=>p.type==="text").map((p:any)=>p.text).join("\n")};},
    async close(){if(child.exitCode===null&&child.signalCode===null){child.stdin.end();const timer=setTimeout(()=>child.kill("SIGKILL"),5000);await exited;clearTimeout(timer);}assert.equal(child.exitCode,0,stderr);assert.doesNotMatch(stderr,/Failed to load extension|Extension error|Unhandled/);}};
}
async function seed(f:Fixture){const c=new MemoryClient({executable:brain!,vault:f.vault,cwd:f.work,environment:{HOME:f.root,USERPROFILE:f.root,TMPDIR:f.root}});try{
  const r=(await c.call("create",{context:{working_directory:f.work,authorized_boundary:f.work},title:"Synthetic Pi Memory",sections:["Fixture scope","Accepted constraints","Initial status","Observed evidence","Concrete next step"]})).result;
  assert.equal(r.status,"saved");const id=r.memory_id as string;return{id,current:join(f.vault,"05-memorias",id,"Memoria.md"),history:join(f.vault,"05-memorias",id,"Historial.md")};
}finally{await c.close();}}
const finalText=(e:any)=>e.type==="message_end"&&e.message?.role==="assistant"&&e.message.stopReason==="stop";

test("native Pi + Brain: lookup precedes work; greeting/no-op and pre-final create/update use one identity",{skip:!cli||!brain,timeout:60_000},async()=>{
  const f=setup(),p=client(f);try{
    await p.request("get_state");assert.equal(existsSync(join(f.work,".brain.toml")),false);
    assert.equal((await p.run("greeting")).text,"MEMORY_GREETING");assert.equal(existsSync(join(f.work,".brain.toml")),false);
    assert.equal((await p.run("save")).text,"MEMORY_RESULT:saved:confirmed");
    const ids=readdirSync(join(f.vault,"05-memorias")).filter(n=>/^[\da-f-]{36}$/.test(n));assert.equal(ids.length,1);const raw=()=>readFileSync(join(f.vault,"05-memorias",ids[0],"Memoria.md"),"utf8");
    assert.match(raw(),/memory_revision: 1/);assert.equal((await p.run("update")).text,"MEMORY_RESULT:saved:confirmed");assert.match(raw(),/memory_revision: 2/);assert.match(raw(),/Updated fixture scope/);
    const before=raw();assert.equal((await p.run("noop")).text,"MEMORY_RESULT:unchanged:confirmed");assert.equal(raw(),before);
    assert.deepEqual(readdirSync(join(f.vault,"05-memorias")).filter(n=>/^[\da-f-]{36}$/.test(n)),ids);
    const saved=p.events.map((e,i)=>({e,i})).filter(({e})=>e.type==="tool_execution_end"&&e.toolName==="ss_memory_save");assert.equal(saved.length,3);
    for(const {e,i} of saved){assert.equal(e.isError,false);const final=p.events.findIndex((v,j)=>j>i&&finalText(v));assert.ok(final>i,"confirmed tool result must precede final response");}
    const entries=(await p.request("get_entries")).entries;assert.equal(entries.some((e:any)=>e.customType==="ss-memory-context"),false,"Memory context must be ephemeral, not a second persisted canonical store");
    assert.equal(p.events.some(e=>e.type==="extension_ui_request"&&["confirm","select","input","editor"].includes(e.method)),false,"status updates are allowed; ordinary saves need no manual-review dialog");
    await p.request("new_session");assert.equal((await p.run("noop")).text,"MEMORY_RESULT:unchanged:confirmed");assert.equal(raw(),before);
    assert.equal((await p.run("read")).text,"MEMORY_RESULT:found:none");
    const readEntries=(await p.request("get_entries")).entries,readResult=readEntries.find((e:any)=>e.message?.role==="toolResult"&&e.message.toolName==="ss_memory_read");
    assert.ok(readResult);assert.equal(JSON.stringify(readResult).includes("accepted_markdown"),false,"recalled Markdown is ephemeral, not duplicated in the explicit read receipt");
  }finally{await p.close();rmSync(f.root,{recursive:true,force:true});}
});

for(const mode of ["denied","readonly","disabled","helper","abort"])test(`native Pi Memory: ${mode} creates no Memory`,{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup(),p=client(f,mode,{configured:mode!=="disabled",child:mode==="helper"});try{
    await p.request("get_state");
    if(mode==="abort"){
      const start=p.events.length,held=p.waitFor(e=>e.type==="tool_execution_start"&&e.toolName==="fixture_memory_hold",start);
      await p.request("prompt",{message:"CASE:abort"});await held;await p.request("abort");await p.waitFor(e=>e.type==="agent_settled"&&e.aborted,start);
    }else{
      const r=await p.run(mode==="readonly"||mode==="denied"?"save":mode);
      assert.equal(r.text,mode==="denied"?"MEMORY_RESULT:denied:none":mode==="readonly"?"MEMORY_RESULT:denied:none":mode==="helper"?"MEMORY_HELPER_EXCLUDED":"MEMORY_DISABLED");
    }
    assert.equal(existsSync(join(f.work,".brain.toml")),false);
    assert.equal(existsSync(join(f.vault,"05-memorias")),false);
  }finally{await p.close();rmSync(f.root,{recursive:true,force:true});}
});

test("native Pi Memory: changed manual bytes at tool admission cannot be overwritten",{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup();let p:ReturnType<typeof client>|undefined;try{const s=await seed(f),history=readFileSync(s.history),before=readFileSync(s.current,"utf8");p=client(f,"conflict",{current:s.current});await p.request("get_state");
    assert.equal((await p.run("conflict")).text,"MEMORY_RESULT:conflict:none");assert.equal(readFileSync(s.current,"utf8"),before+"\nHuman change during tool admission\n");assert.deepEqual(readFileSync(s.history),history);
  }finally{await p?.close();rmSync(f.root,{recursive:true,force:true});}
});

for(const approved of [false,true])test(`native Pi Memory: actual UI manual-edit approval (${approved})`,{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup();let p:ReturnType<typeof client>|undefined;try{const s=await seed(f);writeFileSync(s.current,readFileSync(s.current,"utf8").replace("Fixture scope","Human-approved scope"));const current=readFileSync(s.current),history=readFileSync(s.history);
    p=client(f);await p.request("get_state");assert.equal((await p.run("manual",approved)).text,approved?"MEMORY_RESULT:saved:confirmed":"MEMORY_RESULT:pending:none");
    if(approved){assert.match(readFileSync(s.current,"utf8"),/memory_revision: 2/);assert.match(readFileSync(s.current,"utf8"),/Human-approved scope/);}else{assert.deepEqual(readFileSync(s.current),current);assert.deepEqual(readFileSync(s.history),history);}
  }finally{await p?.close();rmSync(f.root,{recursive:true,force:true});}
});

for(const approved of [false,true])test(`native Pi Memory: actual UI missing-reference offer (${approved})`,{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup();let p:ReturnType<typeof client>|undefined;try{const s=await seed(f),marker=readFileSync(join(f.work,".brain.toml"));rmSync(join(f.vault,"05-memorias",s.id),{recursive:true});p=client(f);await p.request("get_state");
    assert.equal((await p.run("missing",approved)).text,approved?"MEMORY_RESULT:saved:confirmed":"MEMORY_RESULT:pending:none");
    if(approved){const dirs=readdirSync(join(f.vault,"05-memorias")).filter(n=>/^[\da-f-]{36}$/.test(n));assert.equal(dirs.length,1);assert.notEqual(dirs[0],s.id);assert.ok(readFileSync(join(f.work,".brain.toml"),"utf8").includes(dirs[0]));}
    else assert.deepEqual(readFileSync(join(f.work,".brain.toml")),marker);
  }finally{await p?.close();rmSync(f.root,{recursive:true,force:true});}
});

test("native Pi Memory: another extension's continuation does not publish again after the reply",{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup(),p=client(f,"continuation");try{await p.request("get_state");assert.equal((await p.run("save")).text,"MEMORY_RESULT:saved:confirmed");
    assert.equal(p.events.filter(e=>e.type==="tool_execution_end"&&e.toolName==="ss_memory_save").length,1);
    assert.equal(p.events.filter(finalText).length,2);const entries=(await p.request("get_entries")).entries;
    assert.equal(entries.filter((e:any)=>e.customType==="ss-memory-fixture-continuation").length,1);
  }finally{await p.close();rmSync(f.root,{recursive:true,force:true});}
});

test("native Pi Memory: steering during a held tool refreshes the human-owned context before save",{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup(),p=client(f);try{await p.request("get_state");const start=p.events.length;
    const held=p.waitFor(e=>e.type==="tool_execution_start"&&e.toolName==="fixture_memory_hold",start);
    await p.request("prompt",{message:"CASE:abort"});await held;
    const final=p.waitFor(finalText,start);await p.request("prompt",{message:"CASE:save",streamingBehavior:"steer"});
    await p.request("prompt",{message:"/fixture-memory-release"});const answer=await final;await p.waitFor(e=>e.type==="agent_settled",start);
    assert.ok(answer.message.content.some((v:any)=>v.text==="MEMORY_RESULT:saved:confirmed"));
    assert.equal(p.events.filter(e=>e.type==="tool_execution_end"&&e.toolName==="ss_memory_save").length,1);
  }finally{await p.close();rmSync(f.root,{recursive:true,force:true});}
});

test("native Pi Memory: abort after confirmed publication preserves the saved receipt and bytes",{skip:!cli||!brain,timeout:40_000},async()=>{
  const f=setup(),p=client(f);try{await p.request("get_state");const start=p.events.length;
    const saved=p.waitFor(e=>e.type==="tool_execution_end"&&e.toolName==="ss_memory_save",start),held=p.waitFor(e=>e.type==="tool_execution_start"&&e.toolName==="fixture_memory_hold",start);
    await p.request("prompt",{message:"CASE:save_abort"});assert.equal((await saved).result.details.status,"saved");await held;
    await p.request("abort");await p.waitFor(e=>e.type==="agent_settled"&&e.aborted,start);
    const dirs=readdirSync(join(f.vault,"05-memorias")).filter(n=>/^[\da-f-]{36}$/.test(n));assert.equal(dirs.length,1);assert.match(readFileSync(join(f.vault,"05-memorias",dirs[0],"Memoria.md"),"utf8"),/memory_revision: 1/);
  }finally{await p.close();rmSync(f.root,{recursive:true,force:true});}
});

test("native Pi + Brain: lost mutation receipt is save_unconfirmed, without retry/new identity",{skip:!cli||!brain||process.platform==="win32",timeout:40_000},async()=>{
  const f=setup();let p:ReturnType<typeof client>|undefined;try{
    const wrapper=join(f.root,"receipt-loss.mjs");
    writeFileSync(wrapper,`#!${process.execPath}\nimport {spawn} from 'node:child_process';let chunks=[];for await(const c of process.stdin)chunks.push(c);const input=Buffer.concat(chunks),op=JSON.parse(input).operation;const child=spawn(${JSON.stringify(brain)},process.argv.slice(2),{stdio:['pipe','pipe','inherit']});let output=[];child.stdout.on('data',c=>output.push(c));child.on('error',()=>process.exit(24));child.on('close',code=>{if(op==='create')process.exit(23);process.stdout.write(Buffer.concat(output));process.exitCode=code??24;});child.stdin.end(input);\n`,{mode:0o700});
    p=client(f,"normal",{executable:wrapper});await p.request("get_state");assert.equal((await p.run("save")).text,"MEMORY_RESULT:save_unconfirmed:none");
    const dirs=readdirSync(join(f.vault,"05-memorias")).filter(n=>/^[\da-f-]{36}$/.test(n));assert.equal(dirs.length,1);assert.ok(readFileSync(join(f.work,".brain.toml"),"utf8").includes(dirs[0]));
    assert.equal(p.events.filter(e=>e.type==="tool_execution_end"&&e.toolName==="ss_memory_save").length,1);
  }finally{await p?.close();rmSync(f.root,{recursive:true,force:true});}
});
