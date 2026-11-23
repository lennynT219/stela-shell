import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { commandSearch, registerCommandSearch } from "../command-search.ts";

const item = (value: string, description = "") => ({ value, label:value, description });
const info = (name:string,description:string,source="extension")=>({name,description,source}) as SlashCommandInfo;
const options={signal:new AbortController().signal};

test("description search intersects this menu and its live commands, keeps native names first and avoids ambiguous prompt targets",async()=>{
  const entries=[info("ss-project","Elegir el proyecto de la carpeta"),info("other:1","Ver un proyecto"),info("hidden","proyecto"),
    info("template","proyecto","prompt"),info("skill:test","proyecto","skill"),info("collision","proyecto")];
  const menu=[...entries.filter(e=>e.name!=="hidden").map(e=>item(e.name,`[u] ${e.description}`)),item("collision"),item("hotkeys","Show all keyboard shortcuts")];
  const native={ prefix:"/proyecto",items:[item("proyecto-local")] };
  const p: AutocompleteProvider={getSuggestions:async([s])=>s==="/"?{prefix:"/",items:menu}:s==="/proyecto"?native:null,applyCompletion(){throw Error("must not dispatch on lookup");}};
  const search=commandSearch(p,()=>entries,()=>100);
  const get=async(s:string)=>(await search.getSuggestions([s],0,s.length,options))?.items;
  assert.deepEqual((await get("/proyecto"))?.map(i=>i.value),["proyecto-local","other:1","ss-project"]);
  assert.equal((await get("/PRÓYECTO"))?.at(-1)?.value,"ss-project");
  assert.equal((await get("/atajos"))?.[0].description,"Ver los atajos de teclado activos");
  menu.splice(menu.findIndex(i=>i.value==="ss-project"),1);
  assert.ok(!(await get("/proyecto"))?.some(i=>i.value==="ss-project"));
  assert.equal(native.items.length,1); // Host arrays were not edited.
  const compact=await commandSearch(p,()=>entries,()=>38).getSuggestions(["/atajos"],0,7,options);
  assert.match(compact!.items[0].label,/hotkeys · Ver los atajos/); assert.equal(compact!.items[0].value,"hotkeys");
});

test("an argument, path, custom prefix, forced Tab or cancelled request stays with the upstream provider",async()=>{
  const seen:string[]=[]; let applied:AutocompleteItem|undefined;
  const upstream={prefix:"not-our-prefix",items:[item("/tmp/file")]};
  const provider:AutocompleteProvider={triggerCharacters:["$"],getSuggestions:async([s])=>{seen.push(s);return upstream},
    applyCompletion(lines,cursorLine,cursorCol,i){applied=i;return {lines,cursorLine,cursorCol}},shouldTriggerFileCompletion:()=>false};
  const p=commandSearch(provider,()=>{throw Error("not a slash-name lookup")});
  for(const [s,line,col,opts] of [["/ss-project ",0,12,options],["/open /tm",0,9,options],["/tmp/fi",0,7,options],["@a",0,2,options],
    ["$hey",0,4,options],["/proyecto",1,9,options],["/proyecto",0,3,options],["/proyecto",0,9,{...options,force:true}],
    ["/proyecto",0,9,{signal:AbortSignal.abort()}],["/proyecto",0,9,options]] as const){
    assert.equal(await p.getSuggestions([s],line,col,opts),upstream);
  }
  assert.ok(!seen.includes("/")); assert.deepEqual(p.triggerCharacters,["$"]); assert.equal(p.shouldTriggerFileCompletion!(["@a"],0,2),false);
  p.applyCompletion(["@a"],0,2,upstream.items[0],"@a");assert.equal(applied,upstream.items[0]);
});

test("only the TUI installs a wrapper; no shortcut, command or model entry point is added",()=>{
  let start!:Function, wraps=0; registerCommandSearch({on:(event:string,f:Function)=>{assert.equal(event,"session_start");start=f;}} as any);
  for(const mode of ["rpc","print","tui"]) start({}, {mode,ui:{addAutocompleteProvider(){wraps++;}}});
  assert.equal(wraps,1);
});

const cli=process.env.SS_TEST_PI_CLI;
test("Pi TUI: find the actual project menu in Spanish, complete or cancel without binding, preserve native hotkeys", {skip:!cli || process.platform!=="linux",timeout:55_000},async()=>{
  const r=await promisify(execFile)("python3",["-B",fileURLToPath(new URL("./fixtures/command-search-tui.py",import.meta.url)),process.execPath,cli!],{timeout:50_000});
  assert.match(r.stdout,/project search verified/);
});
