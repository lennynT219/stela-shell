import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { realpathSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { read, extract, PARSER_LIMITS, type Dependencies } from "../read.ts";
import { WebClient } from "../index.ts";
import { WebError, MAX_BODY } from "../network.ts";
const signal=()=>new AbortController().signal;
const code=(expected:string)=>(error:any)=>error instanceof WebError&&error.code===expected;
function page(body:string|Buffer,contentType="text/plain; charset=utf-8"):Dependencies["download"] {
  return async()=>({body:Buffer.from(body),url:new URL("https://example.org/final"),contentType,redirects:1});
}
const prose="The public AbortSignal API communicates cancellation to asynchronous operations. A controller owns the signal and can request cancellation without pretending the remote service stopped processing. ";
const html=`<!doctype html><html><head><title>Public signal reference</title></head><body><nav>Menu</nav><article><h1>Public signal reference</h1><p>${prose.repeat(5)}</p><h2>Example</h2><pre><code>const signal = AbortSignal.timeout(1000);</code></pre><p>${prose.repeat(3)}</p><a href="/more">More</a></article></body></html>`;

test("plain text and Markdown bypass all DOM/parser code while keeping source provenance",async()=>{
  for(const [mime,body,method] of [["text/plain","First line\r\nEvidence 😀","plain-text"],["text/markdown","# Guide\n\n```js\nconst n = 1;\n```","markdown"]]){
    const result=await read({url:"https://example.org/requested#example"},signal(),{
      download:page(body,mime),extract:async()=>{assert.fail("No parser may be created for text/Markdown");},now:()=>"2026-11-15T00:00:00Z",
    });
    assert.equal(result.status,"ok");assert.equal(result.extraction,method);assert.equal(result.scope,"page");
    assert.equal(result.requested_url,"https://example.org/requested#example");assert.equal(result.final_url,"https://example.org/final");
    assert.equal(result.document_version,"unknown");assert.equal(result.redirects,1);assert.equal(result.retrieved_at,"2026-11-15T00:00:00Z");
    assert.match(result.warnings.join("\n"),/FRAGMENT_NOT_RESOLVED/);assert.equal(result.content,body.replace(/\r\n/g,"\n"));
  }
});

test("read only accepts one explicit URL; legacy selectors, credentials, oversized and unsupported bodies fail",async()=>{
  const deps={download:async()=>{assert.fail("Unexpected I/O");}};
  for(const input of [null,[],{}, {url:2},{url:"https://example.org/",section:"Intro"},{url:"https://example.org/",version_context:"v1"}])
    await assert.rejects(read(input as any,signal(),deps),code("INVALID_INPUT"));
  await assert.rejects(read({url:"https://example.org/?token=DO_NOT_ECHO"},signal(),deps),code("CREDENTIAL_URL"));
  await assert.rejects(read({url:"https://example.org/"},signal(),{download:page(Buffer.alloc(MAX_BODY+1))}),code("BODY_TOO_LARGE"));
  for(const [body,mime,expected] of [["%PDF-1.7","text/plain","UNSUPPORTED_CONTENT"],["binary\u0000data","text/plain","UNSUPPORTED_CONTENT"],["{}","application/json","UNSUPPORTED_CONTENT"],["text","text/plain; charset=not-an-encoding","UNSUPPORTED_CHARSET"]])
    await assert.rejects(read({url:"https://example.org/"},signal(),{download:page(body,mime)}),code(expected));
  await assert.rejects(read({url:"https://example.org/"},signal(),{download:page(Buffer.from([0xff]),"text/plain; charset=utf-8")}),code("UNSUPPORTED_CHARSET"));
});

test("plain text charset/BOM and intermediate Unicode limits remain explicit, not a complete article claim",async()=>{
  const latin=await read({url:"https://example.org/"},signal(),{download:page(Buffer.from([0x63,0x61,0x66,0xe9]),"text/plain; charset=windows-1252")});
  assert.equal(latin.content,"café");
  const bom=await read({url:"https://example.org/"},signal(),{download:page(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from("Evidence","utf16le")]),"text/plain; charset=utf-8")});
  assert.equal(bom.content,"Evidence");
  const empty=await read({url:"https://example.org/"},signal(),{download:page(" \n ")});assert.equal(empty.status,"partial");assert.match(empty.warnings.join("\n"),/INSUFFICIENT_CONTENT/);
  const large=await read({url:"https://example.org/"},signal(),{download:page("😀漢字".repeat(20_000))});
  assert.equal(large.status,"partial");assert.equal(large.truncated,true);assert.ok(Buffer.byteLength(large.content)<=32*1024);assert.doesNotMatch(large.content,/\ufffd/);
});

test("real HTML worker produces attributable Markdown; title/navigation-only HTML remains partial",async()=>{
  const result=await read({url:"https://example.org/article"},signal(),{download:page(html,"text/html; charset=utf-8")});
  assert.equal(result.status,"ok");assert.equal(result.extraction,"readability+turndown");assert.match(result.title,/signal reference/);
  assert.match(result.content,/```/);assert.match(result.content,/AbortSignal\.timeout/);assert.match(result.content,/https:\/\/example\.org\/more/);
  assert.doesNotMatch(result.content,/<article|<script|Menu/);
  const nav=await read({url:"https://example.org/app"},signal(),{download:page("<html><head><title>Dynamic app</title></head><body><nav>Home Login Menu</nav><div id='app'></div></body></html>","text/html")});
  assert.equal(nav.status,"partial");assert.match(nav.warnings.join("\n"),/INSUFFICIENT_CONTENT/);
});

test("real parser resolves the checkout worker/dependencies, applies heap/stack bounds and exits before returning",async()=>{
  let actual:Worker|undefined,path:string|undefined,limits:any;
  const result=await extract(Buffer.from(html),"text/html","https://example.org/",signal(),{worker:(url,options)=>{
    path=fileURLToPath(url);limits=options.resourceLimits;actual=new Worker(url,options);return actual;
  }});
  assert.equal(path,realpathSync(fileURLToPath(new URL("../extract-worker.mjs",import.meta.url))));
  assert.deepEqual(limits,PARSER_LIMITS);assert.equal(actual!.threadId,-1);assert.match(result.text,/AbortSignal/);
});

test("preserved development symlinks still resolve the real-checkout parser and root libraries",()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-web-linked-"));
  try{
    const linked=join(root,"web");symlinkSync(dirname(fileURLToPath(new URL("../read.ts",import.meta.url))),linked,process.platform==="win32"?"junction":"dir");
    const script=`const {extract}=await import(process.argv[1]);const data=await extract(Buffer.from(${JSON.stringify(html)}),'text/html','https://example.org/',new AbortController().signal);console.log(JSON.stringify(data));`;
    const child=spawnSync(process.execPath,["--experimental-strip-types","--preserve-symlinks","--input-type=module","-e",script,pathToFileURL(join(linked,"read.ts")).href],{encoding:"utf8",timeout:10000,maxBuffer:64*1024});
    assert.equal(child.status,0,child.stderr);assert.match(JSON.parse(child.stdout).text,/AbortSignal/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("HTML fails closed before parser launch on Bun rather than silently ignoring worker limits",async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(process.versions,"bun");
  Object.defineProperty(process.versions,"bun",{value:"fixture",configurable:true});
  try{await assert.rejects(extract(Buffer.from(html),"text/html","https://example.org/",signal(),{worker:()=>{assert.fail("must not launch without supported resource limits");}}),code("UNSUPPORTED_RUNTIME"));}
  finally{if(descriptor)Object.defineProperty(process.versions,"bun",descriptor);else delete process.versions.bun;}
});

test("cancellation terminates a genuinely running parser thread; already-aborted work never launches",async t=>{
  let worker:Worker|undefined;let online!:()=>void;const started=new Promise<void>(resolve=>{online=resolve;});const controller=new AbortController();
  t.after(async()=>{controller.abort();await worker?.terminate();});
  const pending=extract(Buffer.from(html),"text/html","https://example.org/",controller.signal,{worker:(_url,options)=>{
    worker=new Worker("while (true) {}",{...options,eval:true});worker.once("online",online);return worker;
  }});
  const failure=assert.rejects(pending,code("CANCELLED"));await started;controller.abort();await failure;assert.equal(worker!.threadId,-1);
  const early=new AbortController();early.abort();
  await assert.rejects(extract(Buffer.from(html),"text/html","https://example.org/",early.signal,{worker:()=>{assert.fail("must not launch");}}),code("CANCELLED"));
});

test("one operation deadline includes HTML parser startup/execution and cleanup",async t=>{
  let worker:Worker|undefined; t.after(async()=>{await worker?.terminate();});
  const client=new WebClient({env:{},deadlineMs:40,read:(input,combined)=>read(input,combined,{
    download:page(html,"text/html"),extract:(body,mime,url,parserSignal)=>extract(body,mime,url,parserSignal,{worker:(_path,options)=>{
      assert.equal(parserSignal,combined);worker=new Worker("while (true) {}",{...options,eval:true});return worker;
    }}),
  })});
  await assert.rejects(client.read({url:"https://example.org/"}),code("DEADLINE"));assert.ok(worker);assert.equal(worker.threadId,-1);await client.close();
});
