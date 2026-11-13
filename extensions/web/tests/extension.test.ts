import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { registerWeb } from "../index.ts";

test("URL reader registration is inert, declares external read behavior and excludes helpers", async () => {
  const tools:any[]=[], hooks=new Map<string,Function>(); let calls=0;
  const pi:any={registerTool:(t:any)=>tools.push(t),on:(n:string,f:Function)=>hooks.set(n,f)};
  registerWeb(pi,{env:{STELA_SUBAGENT_CHILD:"1"}});assert.equal(tools.length,0);assert.equal(hooks.size,0);
  registerWeb(pi,{env:{},download:async()=>{calls++;throw new Error("PRIVATE_SENTINEL");}});
  assert.equal(calls,0);assert.equal(tools.length,1);assert.equal(tools[0].name,"stela_read_url");
  assert.equal(tools[0].annotations.openWorldHint,true);
  assert.equal(tools[0].parameters.additionalProperties,false);
  assert.ok(tools[0].promptGuidelines.every((s:string)=>s.includes("stela_read_url")));
  const result=await tools[0].execute("id",{url:"https://docs.example.org/"});
  assert.equal(result.isError,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL/);
  await hooks.get("session_shutdown")!();
  assert.equal((await tools[0].execute("id",{url:"https://docs.example.org/"})).details.code,"CLOSED");
});
test("manifest includes the reader once and dependency is exact/locked; existing extensions remain", () => {
  const pkg=JSON.parse(readFileSync(new URL("../../../package.json",import.meta.url),"utf8"));
  // tests are under extensions/web/tests, so repo root is three levels above.
  assert.equal(pkg.pi.extensions.filter((p:string)=>p==="./extensions/web/index.ts").length,1);
  for(const name of ["method","subagents","sessions"])assert.ok(pkg.pi.extensions.includes("./extensions/"+name+"/index.ts"));
  assert.equal(pkg.dependencies.htmlparser2,"12.0.0");
});
