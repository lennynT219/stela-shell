import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeProject } from "../project-client.ts";
import { draftProject } from "../project-draft.ts";
import { projectMenu } from "../project-menu.ts";

const body = "## Summary\n\nFicha de prueba.\n\n## Objective\n\nObjetivo.\n\n## Scope\n\nAlcance.\n";
const project_id = "11111111-1111-4111-8111-111111111111";
const title = "Project de prueba", path = "01-proyectos/prueba/Proyecto.md";
const project = { id: project_id, title, path };
const header = `---\r\nbrain_type: project\r\nbrain_version: 1\r\nbrain_id: ${project_id}\r\ntitle: ${title}\r\n# Conservar.\r\n---\r\n`;

const wire = (operation: string, result: object) => Buffer.from(JSON.stringify({protocol_version:1,request_id:project_id,operation,result})+"\n");
test("Project body receipts correlate the exact selection; uncertain writes cannot look successful", () => {
  const expected_project = {project_id,title,path};
  const result = {status:"found",project:expected_project,markdown:header,body:""};
  assert.deepEqual(decodeProject(wire("read",result),project_id,"read",{project_id}),result);
  assert.throws(() => decodeProject(wire("read",{...result,body:"unrelated"}),project_id,"read",{project_id}));
  const args = {expected_project};
  const success = {status:"updated",project:expected_project};
  assert.deepEqual(decodeProject(wire("update_body",success),project_id,"update_body",args),success);
  assert.throws(() => decodeProject(wire("update_body",{...success,project:{...expected_project,path:"01-proyectos/prueba/Otra.md"}}),project_id,"update_body",args));
  for (const [status, expected] of [["partial","save_unconfirmed"],["unsupported","unsupported"]]) {
    assert.deepEqual(decodeProject(wire("update_body",{status,message:"private"}),project_id,"update_body",args),{status:expected});
  }
});

test("regeneration is optional and the menu confirms once after review", async () => {
  const selected = [/Editar ficha/, /Generar borrador/];
  const steps: string[] = [];
  const candidate = body + "## References\n\nReferencia aprobada.\n";
  await projectMenu({
    async select(_title, options) { const match = selected.shift()!; return options.find(s => match.test(s)); },
    async input() { return "Descripción de prueba"; },
    async editor(_title, prefill) { assert.equal(prefill,body); steps.push("review"); return candidate; },
    async confirm(title, text) { assert.equal(title,"Guardar ficha"); assert.ok(text.includes(path)); steps.push("confirm"); return true; },
    notify(text) { assert.equal(text,"Ficha actualizada."); },
  },"fixture",{
    status: async () => ({principal:project,memory:"found"}),
    list: async () => { throw Error("no catalog needed"); },
    draft: async input => { assert.deepEqual(input,{title,description:"Descripción de prueba",previousBody:"Texto vigente"}); return body; },
    preview: async () => { throw Error("no new project"); },
    bind: async () => { throw Error("no rebind"); },
    edit: async selected => {
      assert.equal(selected,project);
      return {body:"Texto vigente",async save(approved) { assert.equal(approved,candidate); steps.push("save"); return "updated"; }};
    },
  });
  assert.deepEqual(steps,["review","confirm","save"]);
});

test("draft includes bounded previous body and current Memory, not identity or storage baselines", async () => {
  const previousBody = "á".repeat(9000);
  const ctx = {model:{},modelRegistry:{async complete(_model:unknown, context:any) {
    const input = JSON.parse(context.messages[0].content[0].text);
    assert.equal(input.memory,"Memoria vigente");
    assert.equal(Buffer.byteLength(input.previousBody),16*1024);
    assert.equal(input.previousBodyExcerpt,true);
    assert.doesNotMatch(JSON.stringify(input),/privado-uuid/);
    return {stopReason:"stop",content:[{type:"text",text:body}]};
  }}} as unknown as Parameters<typeof draftProject>[0];
  assert.equal(await draftProject(ctx,{title,description:"",previousBody},{memory:{status:"found",memory:{status:"found",
    accepted_markdown:"Memoria vigente",memory_id:"privado-uuid"}}},new AbortController().signal),body.trim());
});

const cli = process.env.SS_TEST_PI_CLI, brain = process.env.SS_TEST_BRAIN_PROJECT_EDIT_EXE;
const local = (relative: string) => fileURLToPath(new URL(relative,import.meta.url));

test("isolated Pi + Brain: cancel, reject a concurrent edit, then fill the same Project", {skip:!cli||!brain,timeout:45_000}, async () => {
  const root = mkdtempSync(join(tmpdir(),"ss-project-edit-"));
  try {
    const vault = join(root,"vault"), work = join(root,"work"), profile = join(root,"profile"), config = join(root,".config","brain");
    const file = join(vault,path), marker = join(work,".brain.toml");
    for (const dir of [work,profile,config,...["00-limbo","01-proyectos/prueba","02-areas","03-recursos","04-archivo","99-sistema/plantillas","99-sistema/documentacion"].map(p=>join(vault,p))]) mkdirSync(dir,{recursive:true});
    writeFileSync(join(config,"config.toml"),`config_version = 1\nvault_path = ${JSON.stringify(vault)}\n`);
    const binding = `binding_version = 2\n[principal_project]\nproject_id = "${project_id}"\nproject_path = "${path}"\nallow_write = true\n`;
    writeFileSync(marker,binding); writeFileSync(file,header);
    const env = {PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:root,USERPROFILE:root,TEMP:root,TMP:root,
      PI_CODING_AGENT_DIR:profile,NO_UPDATE_NOTIFIER:"1",BRAIN_BIN:brain};
    const request_id = randomUUID();
    const seed = spawnSync(brain!,["memory"],{cwd:work,env,encoding:"utf8",timeout:6500,input:JSON.stringify({protocol_version:1,request_id,operation:"create",arguments:{
      context:{working_directory:work,authorized_boundary:work},title:"Memoria de prueba",
      sections:["Finalidad estable de prueba","Decisiones","Estado","Evidencia","Próximo paso"],summary:"Prueba de contexto"}})});
    assert.ifError(seed.error); assert.equal(seed.status,0,seed.stderr);
    const receipt = JSON.parse(seed.stdout); assert.equal(receipt.request_id,request_id); assert.equal(receipt.result.status,"saved");
    const markerBefore = readFileSync(marker,"utf8");
    const child = spawn(process.execPath,[cli!,"--mode","rpc","--offline","--no-session","--approve","--no-extensions","--no-mcp","--no-skills","--no-prompt-templates","--no-context-files",
      "-e",local("./fixtures/project-edit-provider.ts"),"-e",local("../../memory/index.ts"),"-e",local("../index.ts"),"--model","ss-project-edit-fixture/deterministic"],
      {cwd:work,env,stdio:"pipe"});
    const closed = new Promise<number|null>((ok,no) => { child.once("error",no); child.once("close",ok); });
    child.stdin.on("error",() => {});
    let stderr = ""; child.stderr.setEncoding("utf8").on("data",s => { stderr = (stderr+s).slice(-4096); });
    const timer = setTimeout(() => child.kill(),37_000);
    const reader = createInterface({input:child.stdout})[Symbol.asyncIterator]();
    const send = (request: object) => child.stdin.write(JSON.stringify(request)+"\n");
    const later = "Texto de otra edición.\n";
    async function edit(id:string,approve:boolean,existing:string,compete=false,generate=false) {
      send({type:"prompt",id,message:"/ss-project"});
      let step=0; const notices:string[]=[];
      while (true) {
        const {value,done} = await reader.next(); assert.ok(!done,stderr);
        const event = JSON.parse(value);
        if (event.type === "response" && event.id === id) {
          assert.equal(event.success,true,JSON.stringify(event)); assert.equal(event.data?.disposition,"handled");
          assert.equal(step,generate ? 5 : 4,notices.join("\n")); return notices.join("\n");
        }
        if (event.type !== "extension_ui_request") continue;
        if (event.method === "notify") { notices.push(event.message); continue; }
        if (!["select","input","editor","confirm"].includes(event.method)) continue;
        const response = {type:"extension_ui_response",id:event.id};
        if (step < 2) {
          const name = step === 0 ? /Editar ficha/ : generate ? /Generar borrador/ : /Editar el texto actual/;
          const value = event.options.find((s:string)=>name.test(s)); assert.ok(value);
          send({...response,value});
        } else if (step === 2 && generate) {
          assert.equal(event.method,"input");
          send({...response,value:"Incluir la finalidad estable."});
        } else if (step === (generate ? 3 : 2)) {
          assert.equal(event.method,"editor");
          if (generate) assert.match(event.prefill,/Borrador generado/,stderr);
          else assert.equal(event.prefill,existing || "## Summary\n\n\n## Objective\n\n\n## Scope\n\n");
          send({...response,value:body+(generate ? "## References\n\nSolo la versión editada.\n" : "")});
        } else {
          assert.equal(event.title,"Guardar ficha"); assert.ok(event.message.includes(path));
          if (compete) writeFileSync(file,header+later);
          send({...response,confirmed:approve});
        }
        step++;
      }
    }
    try {
      await edit("cancel",false,"");
      assert.equal(readFileSync(file,"utf8"),header);
      assert.match(await edit("conflict",true,"",true),/No se guardó/);
      assert.equal(readFileSync(file,"utf8"),header+later);
      assert.match(await edit("apply",true,later),/Ficha actualizada/);
      assert.equal(readFileSync(file,"utf8"),header+body);
      assert.match(await edit("regenerate",true,body,false,true),/Ficha actualizada/);
      assert.equal(readFileSync(file,"utf8"),header+body+"## References\n\nSolo la versión editada.\n");
      assert.equal(readFileSync(marker,"utf8"),markerBefore);
      child.stdin.end(); assert.equal(await closed,0,stderr);
    } finally {
      clearTimeout(timer); child.stdin.end(); if (child.exitCode === null && child.signalCode === null) child.kill(); await closed;
    }
  } finally { rmSync(root,{recursive:true,force:true,maxRetries:4}); }
});
