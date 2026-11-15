import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const cli=process.env.SS_TEST_PI_CLI??process.env.STELA_TEST_PI_CLI;
const provider=fileURLToPath(new URL("./fixtures/provider.ts",import.meta.url));
const extension=fileURLToPath(new URL("../index.ts",import.meta.url));
function client(root:string,mode:string,entry?:string){
  const profile=join(root,"agent");mkdirSync(profile,{mode:0o700});
  const child=spawn(process.execPath,[cli!,"--offline","--mode","rpc","--no-session","--no-extensions","--no-mcp","--no-skills","--no-prompt-templates","--no-context-files","--no-approve","--extension",provider,...(entry?["--extension",entry]:[]),"--model","ss-web-fixture/deterministic","--thinking","off"],{
    cwd:root,env:{PATH:process.env.PATH,HOME:root,TMPDIR:root,PI_CODING_AGENT_DIR:profile,PI_OFFLINE:"1",NO_UPDATE_NOTIFIER:"1",SS_WEB_FIXTURE_MODE:mode,...(mode==="surface"?{SS_WEB_USE_PRODUCTION:"1"}:{}),...(mode==="helper"?{STELA_SUBAGENT_CHILD:"1"}:{})},stdio:["pipe","pipe","pipe"],
  });
  const events:any[]=[],waits=new Set<any>();let buffer="",stderr="",bytes=0,counter=0,failure:Error|undefined;
  const fail=(error:Error)=>{failure=error;for(const wait of waits){clearTimeout(wait.timer);wait.reject(error);}waits.clear();};
  child.stdout.setEncoding("utf8");child.stdout.on("data",(chunk:string)=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024){fail(new Error("Fixture output bound exceeded"));child.kill("SIGKILL");return;}
    buffer+=chunk;let split;
    while((split=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);if(!line.trim())continue;
      try{const event=JSON.parse(line);events.push(event);for(const wait of [...waits])if(wait.predicate(event)){clearTimeout(wait.timer);waits.delete(wait);wait.resolve(event);}}
      catch{fail(new Error("Malformed RPC fixture output"));}
    }
  });
  child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});child.on("error",fail);
  const exited=new Promise<void>(resolve=>child.once("exit",code=>{fail(new Error(`Fixture exit ${code}: ${stderr}`));resolve();}));
  const waitFor=(predicate:(event:any)=>boolean)=>{
    const event=events.find(predicate);if(event)return Promise.resolve(event);if(failure)return Promise.reject(failure);
    return new Promise<any>((resolve,reject)=>{const wait={predicate,resolve,reject,timer:setTimeout(()=>{waits.delete(wait);reject(new Error(`Fixture deadline: ${stderr}\n${JSON.stringify(events.slice(-6))}`));},20_000)};waits.add(wait);});
  };
  return{events,waitFor,async request(type:string,extra={}){const id=`request-${++counter}`,pending=waitFor(event=>event.type==="response"&&event.id===id);child.stdin.write(JSON.stringify({id,type,...extra})+"\n");const response=await pending;assert.equal(response.success,true,JSON.stringify(response));return response.data;},
    async close(){if(child.exitCode===null&&child.signalCode===null){child.stdin.end();const timer=setTimeout(()=>child.kill("SIGKILL"),5000);await exited;clearTimeout(timer);}assert.equal(child.exitCode,0,stderr);assert.doesNotMatch(stderr,/Failed to load extension|Extension error|Unhandled/);}};
}
const cases=[
  ["search","WEB_SEARCH_OK"],["flow","WEB_FLOW_OK"],["denied","WEB_DENIAL_OK"],["helper","WEB_HELPER_EXCLUDED"],["surface","WEB_SURFACE_OK"],
];
for(const [mode,marker] of cases)test(`native Pi web: ${mode}`,{skip:!cli,timeout:30_000},async()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-web-pi-"));let instance:ReturnType<typeof client>|undefined;
  try{
    let entry:string|undefined=mode==="helper"?extension:undefined;
    if(mode==="surface"){const linked=join(root,"linked-web");symlinkSync(dirname(extension),linked,process.platform==="win32"?"junction":"dir");entry=join(linked,"index.ts");}
    instance=client(root,mode,entry);await instance.request("get_state");
    const completed=instance.waitFor(event=>event.type==="message_end"&&event.message?.role==="assistant"&&event.message.content.some((part:any)=>part.type==="text"&&(part.text===marker||part.text.startsWith("UNEXPECTED_"))));
    await instance.request("prompt",{message:"Verify the deterministic web fixture."});
    assert.ok((await completed).message.content.some((part:any)=>part.text===marker),"native fixture must confirm the expected behavior: "+JSON.stringify(instance.events.filter(event=>event.type==="tool_execution_end").map(event=>({tool:event.toolName,result:event.result}))));
    const toolResults=instance.events.filter(event=>event.type==="tool_execution_end"&&event.toolName.startsWith("ss_web_"));
    assert.equal(toolResults.length,mode==="flow"?2:mode==="search"||mode==="denied"?1:0);
    if(mode==="search"||mode==="flow")for(const result of toolResults){assert.equal(result.isError,false);assert.ok(Buffer.byteLength(JSON.stringify(result.result))<=16*1024);}
    if(mode==="flow"){
      assert.deepEqual(toolResults.map(event=>event.toolName),["ss_web_search","ss_web_read"]);
      const page=JSON.parse(toolResults[1].result.content[0].text);assert.equal(page.final_url,"https://docs.example.org/guide");
      assert.doesNotMatch(JSON.stringify(toolResults[1].result.details),/PUBLIC READER EVIDENCE/);
    }
    if(mode==="denied")assert.equal(toolResults[0].isError,true);
    assert.doesNotMatch(JSON.stringify(instance.events),/UNEXPECTED_|extension_ui_request.*(?:confirm|select)/);
  }finally{await instance?.close();rmSync(root,{recursive:true,force:true});}
});
