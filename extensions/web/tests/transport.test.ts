import assert from "node:assert/strict";
import { test } from "node:test";
import tls from "node:tls";
import dns from "node:dns/promises";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { createServer, connect } from "node:net";
import { ReadError, openPinned, safeURL, resolvePublic } from "../network.ts";

// Deliberately mocked TLS over a local TCP fixture: tests the real HTTPS Agent/HTTP
// request ordering and headers, NOT TLS cryptography. Public smoke covers actual TLS.
for (const permitted of [true,false]) test(`native HTTP dispatch waits for validated connected peer (${permitted ? "match" : "mismatch"})`, async t => {
  const sockets = new Set<any>(); let observed="";
  const server=createServer(socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));
    socket.on("data",data=>{observed+=data.toString();socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 8\r\nConnection: close\r\n\r\nEvidence");});});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const port=(server.address() as any).port, original=tls.connect;
  let captured:any;
  (tls as any).connect=(options:any,ready:Function)=>{
    captured=options;
    const socket=connect({host:"127.0.0.1",port},()=>{
      if(permitted)Object.defineProperty(socket,"remoteAddress",{get:()=>"1.1.1.1"});
      ready();
    });
    options.signal?.addEventListener("abort",()=>socket.destroy(),{once:true});
    return socket;
  };
  syncBuiltinESMExports();
  t.after(()=>{tls.connect=original;syncBuiltinESMExports();});
  const request=openPinned(safeURL("https://docs.example.org/guide?lang=es"),"1.1.1.1",new AbortController().signal);
  if(!permitted){await assert.rejects(request,ReadError);assert.equal(observed,"");return;}
  const hop=await request;
  let body="";for await(const chunk of hop.response)body+=chunk;hop.close();
  assert.equal(body,"Evidence");assert.match(observed,/^GET \/guide\?lang=es HTTP\/1\.1\r\n/);
  assert.match(observed,/Host: docs\.example\.org\r\n/i);assert.doesNotMatch(observed,/Cookie:|Authorization:/i);
  assert.equal(captured.host,"1.1.1.1");assert.equal(captured.servername,"docs.example.org");assert.equal(captured.rejectUnauthorized,true);
  assert.ok(captured.checkServerIdentity("ignored",{subjectaltname:"DNS:wrong.example.org"}) instanceof Error);
});

test("TLS transport errors fail closed before HTTP writes", async t=>{
  const original=tls.connect;let captured:any;
  (tls as any).connect=(options:any)=>{
    captured=options;
    const socket=new PassThrough();
    queueMicrotask(()=>socket.emit("error",new Error("Fixture TLS handshake failure")));
    return socket;
  };
  syncBuiltinESMExports();t.after(()=>{tls.connect=original;syncBuiltinESMExports();});
  await assert.rejects(openPinned(safeURL("https://docs.example.org/"),"1.1.1.1",new AbortController().signal),ReadError);
  assert.equal(captured.rejectUnauthorized,true);
});

test("scoped DNS resolver rejects mixed answers and cancels actual outstanding resolver work", async t=>{
  const Original=dns.Resolver;
  let cancelled=0, pending:Function[]=[], ready!:()=>void;
  let mode="mixed";
  class FixtureResolver {
    constructor(_options:any){}
    resolve4(){return mode==="mixed" ? Promise.resolve(["1.1.1.1"]) : new Promise((_r,reject)=>{pending.push(reject);if(pending.length===2)ready();});}
    resolve6(){return mode==="mixed" ? Promise.resolve(["::1"]) : new Promise((_r,reject)=>{pending.push(reject);if(pending.length===2)ready();});}
    cancel(){cancelled++;for(const reject of pending)reject(Object.assign(new Error("fixture"),{code:"ECANCELLED"}));pending=[];}
  }
  (dns as any).Resolver=FixtureResolver;syncBuiltinESMExports();
  t.after(()=>{dns.Resolver=Original;syncBuiltinESMExports();});
  await assert.rejects(resolvePublic("docs.example.org",new AbortController().signal),(e:any)=>e.code==="PRIVATE_DESTINATION");
  mode="pending";const admitted=new Promise<void>(resolve=>{ready=resolve;});const controller=new AbortController();
  const resolving=resolvePublic("docs.example.org",controller.signal);await admitted;controller.abort();
  await assert.rejects(resolving,(e:any)=>e.code==="CANCELLED");assert.equal(pending.length,0);assert.ok(cancelled>=2);
});
