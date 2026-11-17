import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryClient, MemoryClientError, DEADLINE_MS, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, minimalEnvironment, type Options } from "../client.ts";
import { U64_MAX } from "../protocol.ts";

const fixture = fileURLToPath(new URL("./fixtures/brain.mjs",import.meta.url));
const id = "550e8400-e29b-41d4-a716-446655440010";
const error = (code:string,status="error") => (e:any) => e instanceof MemoryClientError && e.code===code && e.status===status && !/DO_NOT_ECHO|Untrusted diagnostic/.test(e.message);
async function setup(mode="valid",overrides:Partial<Options>={}) {
  const dir=await mkdtemp(join(tmpdir(),"ss-memory-"));let calls=0,child:ChildProcessWithoutNullStreams|undefined;
  let readyResolve:()=>void; const ready=new Promise<void>(resolve=>{readyResolve=resolve;});
  const client=new MemoryClient({executable:process.execPath,cwd:dir,vault:dir,...overrides},{launch:(command,args,options)=>{
    calls++;assert.equal(command,process.execPath);assert.deepEqual(args,["memory","--max-input-bytes",String(overrides.maxInputBytes??MAX_INPUT_BYTES),"--max-output-bytes",String(overrides.maxOutputBytes??MAX_OUTPUT_BYTES)]);
    assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.deepEqual(options.stdio,["pipe","pipe","pipe"]);
    assert.ok(!Object.keys(options.env).some(k=>/KEY|TOKEN|SECRET|LD_PRELOAD|NODE_OPTIONS|PATH$/i.test(k) && !["HOMEPATH"].includes(k)));
    child=spawn(process.execPath,[fixture,mode,...args],options);
    child.stderr.on("data",data=>{if(data.toString().includes("READY"))readyResolve!();});return child;
  }});
  return {client,dir,ready,get calls(){return calls;},get child(){return child;},async close(){await client.close();await rm(dir,{recursive:true,force:true});}};
}

test("direct bounded argv/env and correlated capabilities/read; exit0 logical error is not saved",async()=>{
  const h=await setup("valid",{environment:{HOME:tmpdir(),OPENAI_API_KEY:"DO_NOT_ECHO",LD_PRELOAD:"DO_NOT_ECHO",NODE_OPTIONS:"DO_NOT_ECHO",PATH:"DO_NOT_ECHO"}});
  try {
    const cap=await h.client.call("capabilities");assert.equal(cap.result.status,"found");assert.equal(h.calls,1);
    const r=await h.client.call("read",{memory_id:id});assert.equal(r.result.accepted_markdown,"Exact 😀\r\ncontext\n");assert.equal(h.calls,2);
    const resolve=await h.client.call("resolve",{working_directory:h.dir,authorized_boundary:h.dir});assert.equal(resolve.result.status,"unbound");
  }finally{await h.close();}
  const logical=await setup("logical-error");
  try{assert.equal((await logical.client.call("update",{memory_id:id})).result.status,"conflict");assert.equal(logical.calls,1);}finally{await logical.close();}
  assert.deepEqual(minimalEnvironment({HOME:"home",SystemRoot:"root",TEMP:"tmp",HTTPS_PROXY:"no",AWS_SECRET_ACCESS_KEY:"no",PATH:"no"}),{HOME:"home",SystemRoot:"root",TEMP:"tmp"});
});

test("full u64 values cross both directions without Number rounding",async()=>{
  const incoming=await setup("wide"),outgoing=await setup("wide-input");
  try {
    assert.equal((await incoming.client.call("read",{memory_id:id})).result.revision,U64_MAX);
    const expected=9_007_199_254_740_993n;
    assert.equal((await outgoing.client.call("update",{memory_id:id,expected:{revision:expected,accepted_markdown:"exact"},body:"new"})).result.revision,2);
  }finally{await incoming.close();await outgoing.close();}
});

test("strict framing/version/correlation/duplicates/UTF-8 and typed receipts reject without raw diagnostics",async()=>{
  for(const mode of ["wrong-id","wrong-operation","wrong-version","missing-correlation","extra","duplicate","no-lf","truncated","multiple","bad-utf8","bom","unsupported-capability"]){
    const h=await setup(mode);
    try{await assert.rejects(h.client.call("capabilities"),error("INVALID_PROTOCOL"));assert.equal(h.calls,1);}finally{await h.close();}
  }
  for(const mode of ["status-only","wrong-identity","unsafe-float"]){
    const h=await setup(mode);
    try{await assert.rejects(h.client.call("update",{memory_id:id}),error("INVALID_PROTOCOL","save_unconfirmed"));assert.equal(h.calls,1);}finally{await h.close();}
  }
});

test("stream caps and nonzero exit do not turn a possible mutation into a confirmed rejection",async()=>{
  for(const [mode,code] of [["overflow","OUTPUT_TOO_LARGE"],["stderr","STDERR_TOO_LARGE"],["nonzero","PROCESS_FAILED"],["too-large","OUTPUT_TOO_LARGE"]]){
    const h=await setup(mode,{maxOutputBytes:1024});
    try{await assert.rejects(h.client.call("update",{memory_id:id}),error(code,"save_unconfirmed"));assert.equal(h.calls,1);}finally{await h.close();}
  }
  const read=await setup("too-large");
  try{assert.equal((await read.client.call("read",{memory_id:id})).result.status,"too_large");}finally{await read.close();}
});

test("one slot/no queue; signal cancellation and close wait for owned child closure",async()=>{
  for(const close of [false,true]){
    const h=await setup("wait"),controller=new AbortController();
    try {
      const pending=h.client.call("update",{memory_id:id},controller.signal);
      const rejected=assert.rejects(pending,(e:any)=>error(close?"CLOSED":"CANCELLED","save_unconfirmed")(e)&&e.submitted&&e.cleanupConfirmed);
      await h.ready;await assert.rejects(h.client.call("read",{memory_id:id}),error("BUSY"));assert.equal(h.calls,1);
      if(close)await h.client.close();else controller.abort();
      await rejected;assert.ok(h.child!.exitCode!==null||h.child!.signalCode!==null);
      if(close)await assert.rejects(h.client.call("capabilities"),error("CLOSED"));
    }finally{await h.close();}
  }
});

test("total deadline kills a waiting owned child and retains uncertainty",async()=>{
  const h=await setup("wait",{deadlineMs:150});
  try{
    await assert.rejects(h.client.call("update",{memory_id:id}),(e:any)=>error("DEADLINE","save_unconfirmed")(e)&&e.cleanupConfirmed);
    assert.ok(h.child!.exitCode!==null||h.child!.signalCode!==null);assert.equal(h.calls,1);
  }finally{await h.close();}
});

test("pre-admission invalid input/configuration, abort and absent executable do not start mutations",async()=>{
  for(const overrides of [{executable:"brain"},{cwd:"relative"},{vault:"relative"},{maxInputBytes:1023},{maxOutputBytes:MAX_OUTPUT_BYTES+1},{deadlineMs:DEADLINE_MS+1},{deadlineMs:0}]){
    assert.throws(()=>new MemoryClient({executable:process.execPath,cwd:tmpdir(),...overrides}),error("INVALID_CONFIGURATION"));
  }
  const h=await setup("valid",{maxInputBytes:1024});
  try {
    const controller=new AbortController();controller.abort();
    await assert.rejects(h.client.call("create",{},controller.signal),error("CANCELLED"));
    await assert.rejects(h.client.call("create",{body:"😀".repeat(300)}),error("INVALID_INPUT"));
    await assert.rejects(h.client.call("create",{revision:Number.MAX_SAFE_INTEGER+1}),error("INVALID_INPUT"));
    const cyclic:any={};cyclic.self=cyclic;await assert.rejects(h.client.call("create",cyclic),error("INVALID_INPUT"));
    const deep:any={};let node=deep;for(let i=0;i<70;i++)node=node.next={};
    await assert.rejects(h.client.call("create",deep),error("INVALID_INPUT"));assert.equal(h.calls,0);
    const absent=new MemoryClient({executable:join(h.dir,"missing.exe"),cwd:h.dir,vault:h.dir});
    try{await assert.rejects(absent.call("create",{}),(e:any)=>error("UNAVAILABLE")(e)&&!e.submitted);}finally{await absent.close();}
    const unconfigured=new MemoryClient({executable:process.execPath,cwd:h.dir});
    try{await assert.rejects(unconfigured.call("read",{memory_id:id}),error("INVALID_CONFIGURATION"));}finally{await unconfigured.close();}
  }finally{await h.close();}
});

test("recovery receipt may reference original publication; corrupt observation bytes remain exact",async()=>{
  const recover=await setup("recovery"),inspect=await setup("valid");
  try {
    const r=await recover.client.call("recover",{memory_id:id});
    assert.notEqual(r.result.request_id,r.request_id);assert.equal(r.result.status,"saved");
    const o=await inspect.client.call("inspect_recovery",{memory_id:id});
    assert.equal(o.result.status,"partial");const observation=o.result.observation as any;
    assert.deepEqual(observation.history_bytes,[255,128,0]);assert.equal(observation.history,null);assert.equal(observation.current,"Untrusted 😀\r\n");
  }finally{await recover.close();await inspect.close();}
});
