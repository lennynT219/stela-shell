import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp,mkdir,readFile,readdir,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryClient } from "../client.ts";
import { U64_MAX } from "../protocol.ts";
const executable=process.env.SS_TEST_BRAIN_EXE;

test("actual Brain capabilities touch no default configuration/vault/marker", {skip:!executable},async()=>{
  const root=await mkdtemp(join(tmpdir(),"ss-memory-brain-"));
  const client=new MemoryClient({executable:executable!,cwd:root,environment:{HOME:root,USERPROFILE:root}});
  try {
    assert.equal((await client.call("capabilities")).result.status,"found");
    assert.deepEqual(await readdir(root),[]);
  }finally{await client.close();await rm(root,{recursive:true,force:true});}
});

test("actual Brain synthetic create/resolve/read/update and exact u64 stale rejection through SS client", {skip:!executable},async()=>{
  const root=await mkdtemp(join(tmpdir(),"ss-memory-brain-")),vault=join(root,"vault"),work=join(root,"work");
  await mkdir(vault);await mkdir(work);
  const client=new MemoryClient({executable:executable!,cwd:work,vault,environment:{HOME:root,USERPROFILE:root}});
  const context={working_directory:work,authorized_boundary:work};
  try {
    assert.equal((await client.call("resolve",context)).result.status,"unavailable","an empty directory is not an initialized Brain vault");
    assert.deepEqual(await readdir(vault),[],"the client must not initialize/repair the selected vault implicitly");
    for(const path of ["00-limbo","01-proyectos","02-areas","03-recursos","04-archivo","99-sistema","99-sistema/plantillas","99-sistema/documentacion"]) await mkdir(join(vault,path),{recursive:true});
    assert.equal((await client.call("resolve",context)).result.status,"unbound");assert.deepEqual(await readdir(work),[]);
    const receipt=(await client.call("create",{context,title:"Synthetic SS client",sections:["Synthetic objective","Fixed decisions","Initial status","Evidence","Next actions"]})).result;
    assert.equal(receipt.status,"saved");assert.equal(receipt.revision,1);
    const id=receipt.memory_id as string,first=(await client.call("read",{memory_id:id})).result;
    assert.equal(first.status,"found");assert.equal(first.accepted_markdown,await readFile(join(vault,"05-memorias",id,"Memoria.md"),"utf8"));
    const resolve=(await client.call("resolve",context)).result;assert.equal(resolve.status,"found");assert.equal((resolve.binding as any).memory_id,id);
    const unchanged=(await client.call("update",{memory_id:id,expected:{revision:U64_MAX,accepted_markdown:first.accepted_markdown},body:"unchanged"})).result;
    assert.equal(unchanged.status,"conflict","max-u64 must arrive exactly, not overflow into invalid JSON or an imprecise integer");
    const before=first.accepted_markdown as string,body=before.slice(before.indexOf("## Objective and scope")).replace("Synthetic objective","Updated objective");
    const updated=(await client.call("update",{memory_id:id,expected:{revision:1,accepted_markdown:before},body})).result;
    assert.equal(updated.status,"saved");assert.equal(updated.revision,2);
    const current=(await client.call("read",{memory_id:id})).result;assert.equal(current.revision,2);
    assert.equal(current.accepted_markdown,await readFile(join(vault,"05-memorias",id,"Memoria.md"),"utf8"));
    const noOp=(await client.call("update",{memory_id:id,expected:{revision:2,accepted_markdown:current.accepted_markdown},body})).result;
    assert.equal(noOp.status,"unchanged");assert.equal(noOp.revision,2);
  }finally{await client.close();await rm(root,{recursive:true,force:true});}
});
