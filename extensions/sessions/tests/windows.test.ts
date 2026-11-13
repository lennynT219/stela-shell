import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mailbox, newId } from "../messages.ts";
import { decode, encode, receipt, seal } from "../protocol.ts";
import { NativeBridge, WindowsTransport, WINDOWS_SESSIONS_HELPER, bridgeFrame } from "../transport-windows.ts";
const windows = { skip: process.platform !== "win32" || !existsSync(WINDOWS_SESSIONS_HELPER), timeout: 20_000 };
const cleanup = new WeakMap<TestContext, Array<() => Promise<void>>>();
function workspace(t: TestContext) {
  const scratch = mkdtempSync(join(tmpdir(),"stela-windows-sessions-")), profile = join(scratch,"perfil ñ🙂");
  mkdirSync(profile);
  const owned: Array<() => Promise<void>> = []; cleanup.set(t, owned);
  t.after(async()=>{ try { await Promise.all(owned.map(close=>close())); } finally { rmSync(scratch,{recursive:true,force:true}); } });
  return {scratch,profile};
}
async function peer(t: TestContext, profile: string, name: string) {
  const box = new Mailbox();
  const transport = await WindowsTransport.open(profile,{name,sessionId:name,cwd:profile},(from,message)=>box.accept(from,message));
  cleanup.get(t)!.push(()=>transport.close()); return {box,transport,bridge:(transport as any).bridge as NativeBridge};
}
function grantWorldRead(path: string) {
  const script = '$ErrorActionPreference="Stop"; $p=$env:STELA_ACL_FIXTURE; $dir=[System.IO.Directory]::Exists($p); if($dir){$acl=[System.IO.Directory]::GetAccessControl($p)}else{$acl=[System.IO.File]::GetAccessControl($p)}; $sid=[System.Security.Principal.SecurityIdentifier]::new("S-1-1-0"); $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,"Read","Allow"); $acl.AddAccessRule($rule); if($dir){[System.IO.Directory]::SetAccessControl($p,$acl)}else{[System.IO.File]::SetAccessControl($p,$acl)}';
  const result = spawnSync("powershell",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,STELA_ACL_FIXTURE:path},encoding:"utf8",timeout:8000});
  assert.equal(result.status,0,result.stderr);
}
test("Windows bridge framing rejects oversized payloads and invalid request IDs",()=>{
  assert.throws(()=>bridgeFrame(1,0),/limit\/ID/);
  assert.throws(()=>bridgeFrame(1,1,[Buffer.alloc(140*1024)]),/limit/);
});
test("Windows missing artifact fails before messaging state; cancellation does not launch", {skip:process.platform!=="win32"}, async(t)=>{
  const {scratch,profile}=workspace(t);
  await assert.rejects(WindowsTransport.open(profile,{name:"a",sessionId:"a",cwd:profile},()=>"accepted",undefined,join(scratch,"missing.exe")),/missing or inaccessible/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(WindowsTransport.open(profile,{name:"a",sessionId:"a",cwd:profile},()=>"accepted",controller.signal),/abort/i);
  assert.equal(existsSync(join(profile,"stela-sessions")),false);
});
test("Windows protected discovery, duplicate/correlated replies, Unicode and escaped byte limits",windows,async(t)=>{
  const {profile}=workspace(t), a=await peer(t,profile,"a"), b=await peer(t,profile,"b");
  assert.notEqual(a.bridge.pid,process.pid);
  assert.equal((await a.transport.list())[0].id,b.transport.info.id);
  const value=a.box.prepare(b.transport.info.id,"Native evidence");
  assert.deepEqual(await a.transport.send(b.transport.info.id,value),{accepted:true,duplicate:false});
  assert.deepEqual(await a.transport.send(b.transport.info.id,value),{accepted:true,duplicate:true});
  b.box.delivered(value.id);
  const reply=b.box.prepare(a.transport.info.id,"Reply",value.id);
  assert.equal((await b.transport.send(a.transport.info.id,reply)).accepted,true);
  assert.equal(a.box.next()!.message.replyTo,value.id);
  for(const text of ["🙂".repeat(2048),"\0".repeat(8191)+"x"]){
    const message=a.box.prepare(b.transport.info.id,text);
    assert.equal((await a.transport.send(b.transport.info.id,message)).accepted,true);
    assert.equal(b.box.next()!.message.text,text);b.box.delivered(message.id);
  }
  await b.transport.update("renamed");assert.equal((await a.transport.list())[0].name,"renamed");
  const record=JSON.parse(readFileSync(join(profile,"stela-sessions",b.transport.info.id+".json"),"utf8"));
  assert.equal(record.pid,b.bridge.pid);
  assert.doesNotMatch(JSON.stringify(a.transport.info),/secret|namespace|endpoint/);
});
test("Windows canonical profile aliases share a namespace; distinct profiles stay isolated",windows,async(t)=>{
  const {scratch,profile}=workspace(t), other=join(scratch,"other");mkdirSync(other);
  const a=await peer(t,profile,"a"), b=await peer(t,profile.replace(/^[A-Z]/,s=>s.toLowerCase()),"b"), c=await peer(t,other,"c");
  assert.equal(a.bridge.namespace,b.bridge.namespace);assert.notEqual(a.bridge.namespace,c.bridge.namespace);
  assert.deepEqual(await c.transport.list(),[]);
  await assert.rejects(a.transport.send(c.transport.info.id,a.box.prepare(c.transport.info.id,"outside")),/State handle open failed/);
});
test("Windows unsafe existing state DACL and profile/state junctions fail closed without repair",windows,async(t)=>{
  const {scratch,profile}=workspace(t), state=join(profile,"stela-sessions");
  mkdirSync(state);grantWorldRead(state);
  await assert.rejects(WindowsTransport.open(profile,{name:"a",sessionId:"a",cwd:profile},()=>"accepted"),/DACL/);
  assert.deepEqual(readdirSync(state),[]);
  const target=join(scratch,"target");mkdirSync(target);
  const alias=join(scratch,"alias");symlinkSync(target,alias,"junction");
  await assert.rejects(WindowsTransport.open(alias,{name:"a",sessionId:"a",cwd:alias},()=>"accepted"),/Unsafe state/);
  assert.deepEqual(readdirSync(target),[]);
  const second=join(scratch,"second");mkdirSync(second);symlinkSync(target,join(second,"stela-sessions"),"junction");
  await assert.rejects(WindowsTransport.open(second,{name:"a",sessionId:"a",cwd:second},()=>"accepted"),/Unsafe state/);
  assert.deepEqual(readdirSync(target),[]);
});
test("Windows private records reject broadened ACLs and hard links",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  const file=join(profile,"stela-sessions",b.transport.info.id+".json"),alias=join(profile,"stela-sessions","alias");
  linkSync(file,alias);
  assert.deepEqual(await a.transport.list(),[]);
  await assert.rejects(a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"denied")),/Unsafe state/);
  unlinkSync(alias);assert.equal((await a.transport.list()).length,1);
  grantWorldRead(file);
  assert.deepEqual(await a.transport.list(),[]);
  await assert.rejects(a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"denied")),/DACL/);
  assert.equal(b.box.pending,0);
});
test("Windows live root ACL changes stop reads and publication without repairing permissions",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  grantWorldRead(join(profile,"stela-sessions"));
  await assert.rejects(a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"blocked")),/DACL/);
  await assert.rejects(b.transport.update("blocked"),/DACL/);
  assert.equal(b.box.pending,0);
});
test("Windows pipe server/client PID spoofing cannot admit a message",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  for(const changed of [b,a]){
    const file=join(profile,"stela-sessions",changed.transport.info.id+".json"),original=readFileSync(file);
    writeFileSync(file,JSON.stringify({...JSON.parse(original.toString()),pid:process.pid}));
    await assert.rejects(a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"not admitted")),/unconfirmed/);
    writeFileSync(file,original);
    assert.equal(b.box.pending,0);
  }
  assert.equal((await a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"valid"))).accepted,true);
});
test("Windows first pipe instance rejects occupied activation; malformed wire does not kill receiver",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  await assert.rejects(NativeBridge.open(profile,b.transport.info.id),/handle operation failed/);
  const pid=Buffer.alloc(4);pid.writeUInt32LE(b.bridge.pid);
  await assert.rejects(a.bridge.call(5,[Buffer.from(b.transport.info.id),pid,Buffer.from('{"version":1}\n')]),/unconfirmed/);
  assert.equal((await a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"still alive"))).accepted,true);
});
test("Windows JS inbox rejection is a negative receipt, never a native acceptance",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  for(let i=0;i<8;i++)assert.equal((await a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"queued"))).accepted,true);
  assert.equal((await a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"overflow"))).accepted,false);
  assert.equal(b.box.pending,8);
});
test("Windows cancellation while awaiting JS admission holds no false receipt and close revokes pending work",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  let observed!:()=>void;
  const incoming=new Promise<void>(resolve=>{observed=resolve;});
  b.bridge.incoming=()=>observed(); // Native reception alone must not acknowledge.
  const controller=new AbortController();
  const pending=a.transport.send(b.transport.info.id,a.box.prepare(b.transport.info.id,"not admitted"),controller.signal);
  const rejected=assert.rejects(pending,/cancelled|unconfirmed/);
  await incoming;controller.abort();await rejected;
  assert.equal(b.box.pending,0);await a.transport.close();
  await assert.rejects(a.transport.list(),/closed/);
});
test("Windows altered public wire proof/tag cannot enter the JS inbox",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  const pid=Buffer.alloc(4);pid.writeUInt32LE(b.bridge.pid);
  for(const field of ["proof","tag"] as const){
    const packet=seal((a.transport as any).own,(b.transport as any).own,{kind:"message",message:a.box.prepare(b.transport.info.id,"invalid authentication")});
    packet[field]=(packet[field][0]==="0"?"1":"0")+packet[field].slice(1);
    await assert.rejects(a.bridge.call(5,[Buffer.from(b.transport.info.id),pid,encode(packet)]),/unconfirmed/);
    assert.equal(b.box.pending,0);
  }
});
test("Windows squatted pipe gets ciphertext and an unsigned ACK cannot authenticate",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  const own=(a.transport as any).own,peerPresence=(b.transport as any).own;
  const target=b.transport.info.id,namespace=b.bridge.namespace;
  await b.transport.close();
  let captured="";
  const fake=createServer(socket=>socket.once("data",bytes=>{captured=bytes.toString();socket.write(JSON.stringify({accepted:true})+String.fromCharCode(10));}));
  await new Promise<void>((resolve,reject)=>{fake.once("error",reject);fake.listen("\\\\.\\pipe\\stela-"+namespace+"-"+target,resolve);});
  cleanup.get(t)!.push(()=>new Promise<void>(resolve=>fake.close(()=>resolve())));
  const packet=seal(own,peerPresence,{kind:"message",message:a.box.prepare(target,"PRIVATE_TEST_PAYLOAD")});
  const pid=Buffer.alloc(4);pid.writeUInt32LE(process.pid);
  const [raw]=await a.bridge.call(5,[Buffer.from(target),pid,encode(packet)]);
  assert.ok(captured.length>0);assert.doesNotMatch(captured,/PRIVATE_TEST_PAYLOAD/);
  assert.throws(()=>receipt(decode(raw),packet,own.id,peerPresence),/acknowledgment/);
});
test("Windows partial/idle pipe clients expire without JS admission",windows,async(t)=>{
  const {profile}=workspace(t),b=await peer(t,profile,"b");
  const sockets=[createConnection("\\\\.\\pipe\\stela-"+b.bridge.namespace+"-"+b.transport.info.id),createConnection("\\\\.\\pipe\\stela-"+b.bridge.namespace+"-"+b.transport.info.id)];
  cleanup.get(t)!.push(async()=>{for(const socket of sockets)socket.destroy();});
  for(const socket of sockets)socket.on("error",()=>{});
  const closed=sockets.map(socket=>new Promise<void>(resolve=>socket.once("close",()=>resolve())));
  await Promise.all(sockets.map(socket=>once(socket,"connect")));
  sockets[0].write("{");
  await Promise.all(closed);assert.equal(b.box.pending,0);
});
test("Windows bridge death during discovery cannot manufacture an empty healthy result",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  const call=a.bridge.call.bind(a.bridge);
  a.bridge.call=async(op,...args)=>{const result=await call(op,...args);if(op===4){a.bridge.child.kill("SIGKILL");await a.bridge.exited;}return result;};
  await assert.rejects(a.transport.list(),/unavailable/);
});
test("Windows malformed private framing stops the bridge and revokes discovery",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  a.bridge.child.stdin.write(Buffer.from([255,255,255,255]));
  await a.bridge.exited;
  await assert.rejects(a.transport.list(),/closed|stopped|unavailable/i);
  assert.deepEqual(await b.transport.list(),[]);
});
test("Windows killed native process is unavailable, not silently restarted",windows,async(t)=>{
  const {profile}=workspace(t),a=await peer(t,profile,"a"),b=await peer(t,profile,"b");
  const pid=a.bridge.pid;a.bridge.child.kill("SIGKILL");await a.bridge.exited;
  await assert.rejects(a.transport.list(),/unavailable/);
  assert.equal(a.bridge.pid,pid);assert.deepEqual(await b.transport.list(),[]);
  assert.equal((await b.transport.list()).length,0);
});
test("Windows bridge exits after abrupt Pi-owner death",windows,async(t)=>{
  const {profile}=workspace(t);
  const fixture=fileURLToPath(new URL("./fixtures/windows-owner.mjs",import.meta.url));
  const owner=spawn(process.execPath,["--experimental-strip-types",fixture,profile],{stdio:["pipe","pipe","pipe"]});
  t.after(()=>{if(owner.exitCode===null&&owner.signalCode===null)owner.kill("SIGKILL");});
  let buffer="";const ready=new Promise<{nativePid:number}>((resolve,reject)=>{
    owner.once("error",reject);owner.stdout.on("data",(chunk)=>{buffer+=chunk.toString();if(buffer.includes("\n"))resolve(JSON.parse(buffer.split("\n")[0]));});
    owner.once("exit",()=>reject(new Error("Owner exited before readiness")));
  });
  const {nativePid}=await ready,exited=once(owner,"exit");owner.kill("SIGKILL");await exited;
  const script='try { $p=[System.Diagnostics.Process]::GetProcessById([int]$env:STELA_NATIVE_PID) } catch { exit 0 }; if($p.WaitForExit(5000)){exit 0}else{exit 1}';
  const result=spawnSync("powershell",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,STELA_NATIVE_PID:String(nativePid)},timeout:8000,encoding:"utf8"});
  assert.equal(result.status,0,"Native bridge survived its owner");
});
