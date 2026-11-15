// Reworked bdcfdc6 transport fixtures against the NEW shared GET/POST transport.
import assert from "node:assert/strict";
import { test } from "node:test";
import tls from "node:tls";
import dns from "node:dns/promises";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { createServer, connect } from "node:net";
import { WebError, openPinned, safeURL, resolvePublic } from "../network.ts";

// Actual local TCP/HTTP dispatch with mocked TLS: tests ordering, NOT cryptography.
for (const method of ["GET","POST"] as const) for (const permitted of [true,false])
  test(`HTTP ${method} writes only after peer validation (${permitted ? "match" : "mismatch"})`, async t => {
    const sockets = new Set<any>(); let observed = "";
    const server = createServer(socket => {
      sockets.add(socket); socket.on("close",()=>sockets.delete(socket));
      socket.on("data",data => {
        observed += data.toString(); const split = observed.indexOf("\r\n\r\n");
        if (split < 0) return;
        const length = Number(observed.match(/content-length: (\d+)/i)?.[1] ?? 0);
        if (Buffer.byteLength(observed.slice(split + 4)) < length) return;
        socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 8\r\nConnection: close\r\n\r\nEvidence");
      });
    });
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));});
    const port=(server.address() as any).port, original=tls.connect; let captured:any;
    (tls as any).connect=(options:any,ready:Function)=>{
      captured=options;
      const socket=connect({host:"127.0.0.1",port},()=>{
        if(permitted)Object.defineProperty(socket,"remoteAddress",{get:()=>"1.1.1.1"}); ready();
      });
      const abort=()=>socket.destroy(); options.signal?.addEventListener("abort",abort,{once:true});
      socket.once("close",()=>options.signal?.removeEventListener("abort",abort)); return socket;
    };
    syncBuiltinESMExports();t.after(()=>{tls.connect=original;syncBuiltinESMExports();});
    const body=method==="POST" ? Buffer.from('{"query":"public","objective":"reference"}') : undefined;
    const pending=openPinned(safeURL("https://docs.example.org/guide?lang=es"),"1.1.1.1",new AbortController().signal,{method,body});
    if(!permitted){await assert.rejects(pending,WebError);assert.equal(observed,"");return;}
    const hop=await pending; let output="";for await(const chunk of hop.response)output+=chunk;hop.close();
    assert.equal(output,"Evidence");assert.match(observed,new RegExp(`^${method} /guide\\?lang=es HTTP/1\\.1\\r\\n`));
    assert.match(observed,/Host: docs\.example\.org\r\n/i);assert.doesNotMatch(observed,/Cookie:|Authorization:/i);
    if(body) assert.ok(observed.endsWith(body.toString()));
    assert.equal(captured.host,"1.1.1.1");assert.equal(captured.servername,"docs.example.org");assert.equal(captured.rejectUnauthorized,true);
    assert.ok(captured.checkServerIdentity("ignored",{subjectaltname:"DNS:wrong.example.org"}) instanceof Error);
  });

test("TLS failure never yields a socket to HTTP",async t=>{
  const original=tls.connect;let captured:any;
  (tls as any).connect=(options:any)=>{captured=options;const socket=new PassThrough();queueMicrotask(()=>socket.emit("error",new Error("private handshake diagnostic")));return socket;};
  syncBuiltinESMExports();t.after(()=>{tls.connect=original;syncBuiltinESMExports();});
  await assert.rejects(openPinned(safeURL("https://example.org/"),"1.1.1.1",new AbortController().signal),(error:any)=>error.code==="NETWORK_FAILED"&&!String(error).includes("private handshake"));
  assert.equal(captured.rejectUnauthorized,true);
});

test("real resolver boundary rejects mixed DNS and cancellation stops owned DNS work",async t=>{
  const Original=dns.Resolver;let cancelled=0,pending:Function[]=[],ready!:()=>void,mode="mixed";
  class FixtureResolver {
    resolve4(){return mode==="mixed" ? Promise.resolve(["1.1.1.1"]) : new Promise((_r,reject)=>{pending.push(reject);if(pending.length===2)ready();});}
    resolve6(){return mode==="mixed" ? Promise.resolve(["::1"]) : new Promise((_r,reject)=>{pending.push(reject);if(pending.length===2)ready();});}
    cancel(){cancelled++;for(const reject of pending)reject(Object.assign(new Error("fixture"),{code:"ECANCELLED"}));pending=[];}
  }
  (dns as any).Resolver=FixtureResolver;syncBuiltinESMExports();t.after(()=>{dns.Resolver=Original;syncBuiltinESMExports();});
  await assert.rejects(resolvePublic("docs.example.org",new AbortController().signal),(error:any)=>error.code==="PRIVATE_DESTINATION");
  mode="pending";const admitted=new Promise<void>(resolve=>{ready=resolve;});const controller=new AbortController();
  const resolving=resolvePublic("docs.example.org",controller.signal);await admitted;controller.abort();
  await assert.rejects(resolving,(error:any)=>error.code==="CANCELLED");assert.equal(pending.length,0);assert.ok(cancelled>=2);
});
