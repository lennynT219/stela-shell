import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const cli=process.env.STELA_TEST_PI_CLI;
const provider=fileURLToPath(new URL("./fixtures/provider.ts",import.meta.url));
const fixture=fileURLToPath(new URL("./fixtures/reader-fixture.ts",import.meta.url));

for(const action of ["read","denied","helper"])test("native Pi URL reader: "+action,{skip:!cli,timeout:35_000},async()=>{
  const home=mkdtempSync(join(tmpdir(),"stela-web-pi-")),profile=join(home,"profile"),marker=join(home,"calls.txt");
  mkdirSync(profile);
  try{
    const child=spawn(process.execPath,[cli!,"--offline","--mode","json","--no-session","--no-extensions","--no-mcp",
      "--no-skills","--no-prompt-templates","--no-context-files","--no-approve","--extension",provider,"--extension",fixture,
      "--model","stela-web-fixture/deterministic","--thinking","off","-p","Read the known documentation URL."],
      {cwd:home,env:{PATH:process.env.PATH,HOME:home,TMPDIR:home,PI_CODING_AGENT_DIR:profile,PI_OFFLINE:"1",
        NO_UPDATE_NOTIFIER:"1",STELA_WEB_FIXTURE_ACTION:action,STELA_WEB_FIXTURE_MARKER:marker,
        ...(action==="helper"?{STELA_SUBAGENT_CHILD:"1"}:{})},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",overflow=false;
    const timer=setTimeout(()=>child.kill("SIGKILL"),25000);
    child.stdout.on("data",chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>2**21){overflow=true;child.kill("SIGKILL");}});
    child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-8192);});
    const exit=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);}).finally(()=>clearTimeout(timer));
    assert.equal(overflow,false);assert.equal(exit,0,stderr);assert.doesNotMatch(stderr,/Failed to load extension|Extension error|Unhandled/);
    const events=stdout.trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));
    const used=events.filter(e=>e.type==="tool_execution_end"&&e.toolName==="stela_read_url");
    if(action==="helper"){
      assert.equal(used.length,0);assert.equal(existsSync(marker),false);assert.match(stdout,/HELPER_HAS_NO_WEB_TOOL/);
    }else if(action==="denied"){
      assert.equal(used.length,1);assert.equal(used[0].isError,true);assert.match(JSON.stringify(used[0]),/Fixture denies URL reading/);
      assert.equal(existsSync(marker),false,"blocked dispatch must not invoke the injected transport");
    }else{
      assert.equal(used.length,1);assert.equal(used[0].isError,false);
      const text=used[0].result.content[0].text,value=JSON.parse(text);
      assert.equal(value.title,"Version 2 docs");assert.match(value.excerpt,/AbortController/);
      assert.match(value.warning,/UNTRUSTED/);assert.equal(value.section.matched,true);
      assert.equal(value.version_context,"1.0");assert.equal(value.document_version,"unknown");
      assert.ok(Buffer.byteLength(text)<=2**14);assert.equal(readFileSync(marker,"utf8"),"called\n");
      assert.match(stdout,/FIXTURE_READ_COMPLETE/);
      assert.deepEqual(events.filter(e=>e.type==="tool_execution_start").map(e=>e.toolName),["stela_read_url"],
        "fixture must not execute commands embedded in page evidence");
    }
  }finally{rmSync(home,{recursive:true,force:true});}
});
