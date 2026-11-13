import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { URLReader, MAX_OUTPUT, DEADLINE_MS, extract, errorResult } from "../reader.ts";
import { MAX_BODY, ReadError, safeURL, isPublicAddress, checkEnvironment, download, collect } from "../network.ts";
import type { IncomingMessage } from "node:http";

const signal = () => new AbortController().signal;
const url = "https://docs.example.org/guide";
function response(body: Buffer | string, headers: Record<string,string> = {}, statusCode = 200) {
  const stream = new PassThrough() as unknown as IncomingMessage;
  stream.statusCode = statusCode; stream.headers = { "content-type": "text/html; charset=utf-8", ...headers };
  stream.end(body); return stream;
}
const fixture = (html: string, deps = {}) => new URLReader({ env: {},
  download: async () => ({ body: Buffer.from(html), url: new URL(url), contentType: "text/html", redirects: 0 }), ...deps });
const parse = (result: any) => JSON.parse(result.content[0].text);
const code = (value: string) => (error: any) => error instanceof ReadError && error.code === value;

test("public address policy rejects special IPv4, alternate literal encodings, IPv6 transitions and metadata", () => {
  for (const ip of ["0.0.0.0","10.2.3.4","100.100.100.200","127.1.2.3","169.254.169.254","172.31.255.255",
    "192.168.255.1","192.0.0.9","192.0.2.1","198.18.1.1","198.51.100.1","203.0.113.4","224.0.0.1","255.255.255.255",
    "168.63.129.16","::","::1","::ffff:8.8.8.8","64:ff9b::0808:0808","fc00::1","fe80::1",
    "2001:db8::1","2001::1","2002:0808:0808::1","3fff::1"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1","8.8.8.8","2606:4700:4700::1111","2001:4860:4860::8888"]) assert.equal(isPublicAddress(ip),true,ip);
  for (const value of ["https://2130706433","https://0177.0.0.1","https://0x7f000001","https://[::ffff:127.0.0.1]"])
    assert.throws(() => safeURL(value),code("PRIVATE_DESTINATION"));
});
test("URL and environment validation are strict and never echo secrets", async () => {
  for (const value of ["http://docs.example.org","file:///tmp/a","https://user:password@docs.example.org","https://docs.example.org:8443"])
    assert.throws(() => safeURL(value),code("UNSAFE_URL"));
  for (const value of ["https://localhost.","https://metadata.google.internal","https://a.local","https://x.home.arpa"])
    assert.throws(() => safeURL(value),code("PRIVATE_DESTINATION"));
  for (const value of ["https://docs.example.org/?access_token=PRIVATE_SENTINEL","https://docs.example.org/?X-Amz-Signature=PRIVATE_SENTINEL"])
    assert.throws(() => safeURL(value),code("CREDENTIAL_URL"));
  assert.throws(() => safeURL("https://docs.example.org/\nfoo"),code("INVALID_URL"));
  assert.throws(() => safeURL("https://docs.example.org/"+"🙂".repeat(1000)),code("INVALID_URL"));
  assert.equal(safeURL(url+"?lang=es").search,"?lang=es");
  assert.throws(() => checkEnvironment({ HTTPS_PROXY: "PRIVATE_SENTINEL" }),code("PROXY_UNSUPPORTED"));
  assert.throws(() => checkEnvironment({ https_proxy: "PRIVATE_SENTINEL" }),code("PROXY_UNSUPPORTED"));
  assert.throws(() => checkEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }),code("UNSAFE_TLS_ENV"));
  let calls = 0; const reader = fixture("",{env:{ALL_PROXY:"PRIVATE_SENTINEL"},download:async()=>{calls++;throw Error();}});
  await assert.rejects(reader.read({url}),code("PROXY_UNSUPPORTED")); assert.equal(calls,0);
  assert.doesNotMatch(JSON.stringify(errorResult(new Error("PRIVATE_SENTINEL"))),/PRIVATE_SENTINEL/);
});
test("numeric budgets independently match the intended binary-byte and deadline requirements", () => {
  assert.equal(MAX_BODY, 2 ** 21); assert.equal(MAX_OUTPUT, 2 ** 14); assert.equal(DEADLINE_MS, 20 * 1000);
});
test("HTML entities, main selection, code whitespace, title and actual heading IDs survive extraction; no scripts execute", async () => {
  const r = fixture('<html><head><title>API &amp; docs</title><script>throw Error("NOT_RUN")</script></head><body><nav>NO_NAV</nav><svg><title>NO_ICON_TITLE</title></svg><main><h1>v2 Docs</h1><h2 id="cancel">Cancel &amp; stop</h2><p>Use <code>AbortController</code>.</p><pre>if (ok) {\n  abort();\n}</pre><h2>Next</h2><p>NOT_SELECTED</p></main></body></html>');
  const value = parse(await r.read({url,section:"cancel",version_context:"1.0"}));
  assert.equal(value.title,"API & docs"); assert.equal(value.section.matched,true);
  assert.equal(value.section.observed.id,"cancel"); assert.match(value.excerpt,/Cancel & stop/);
  assert.match(value.excerpt,/\n  abort\(\);/); assert.doesNotMatch(value.excerpt,/NOT_SELECTED|NO_NAV|NOT_RUN/);
  assert.equal(value.version_context,"1.0"); assert.equal(value.document_version,"unknown");
  assert.match(value.warning,/UNTRUSTED/); assert.ok(!Number.isNaN(Date.parse(value.retrieved_at)));
  assert.equal(value.requested_url,url); assert.equal(value.final_url,url); assert.match(value.source_id,/^url_[a-f0-9]{16}$/);
  await r.close();
});
test("missing sections and empty pages are explicit partial results; fragments select real headings", async () => {
  const r = fixture("<main><h1 id='start'>Start</h1><p>Evidence</p></main>");
  let v = parse(await r.read({url,section:"Missing"})); assert.equal(v.status,"partial"); assert.equal(v.excerpt,""); assert.equal(v.section.matched,false);
  v = parse(await r.read({url:url+"#start"})); assert.equal(v.section.matched,true); assert.match(v.excerpt,/Evidence/);
  await r.close();
  const empty = fixture("<script>no readable page</script>");
  v = parse(await empty.read({url})); assert.equal(v.status,"partial"); assert.equal(v.excerpt,""); await empty.close();
});
test("plain text is not HTML-decoded; Markdown headings and non-UTF8 charset labels are explicit", async () => {
  const plain = await extract(Buffer.from("<script>&amp;</script>"),"text/plain",undefined,signal());
  assert.equal(plain.text,"<script>&amp;</script>");
  const md = await extract(Buffer.from("# Docs\n\n## Cancel\nStop here\n\n## Next\nOther"),"text/markdown","Cancel",signal());
  assert.match(md.text,/Stop here/); assert.doesNotMatch(md.text,/Other/);
  const latin = await extract(Buffer.from([0x6e,0x69,0xf1,0x6f]),"text/plain; charset=iso-8859-1",undefined,signal());
  assert.equal(latin.text,"niño");
  await assert.rejects(extract(Buffer.from([0xff]),"text/plain; charset=utf-8",undefined,signal()),code("UNSUPPORTED_CHARSET"));
  await assert.rejects(extract(Buffer.from("x"),"text/plain; charset=made-up",undefined,signal()),code("UNSUPPORTED_CHARSET"));
});
test("complete JSON output preserves provenance under Unicode, escaped text and truncation", async () => {
  const r = fixture("<main><h1>Docs</h1><p>"+('🙂"\\'.repeat(20000))+"</p></main>");
  const result = await r.read({url}); const v = parse(result);
  assert.ok(Buffer.byteLength(result.content[0].text) <= 2 ** 14);
  assert.equal(v.truncated,true); assert.match(v.source_id,/url_/); assert.equal(v.final_url,url);
  assert.doesNotMatch(v.excerpt,/\uFFFD/); assert.equal(v.excerpt.includes("🙂"),true); await r.close();
});
test("request DNS is checked once per hop, pinned numerically, and private/mixed answers never open", async () => {
  let opened = 0, resolved = 0;
  const result = await download(safeURL(url),signal(),{
    resolve:async()=>{resolved++;return ["1.1.1.1"];},
    open:async(u,address)=>{opened++;assert.equal(address,"1.1.1.1");assert.equal(u.hostname,"docs.example.org");const r=response("Evidence");return {response:r,close:()=>r.destroy()};},
  });
  assert.equal(result.body.toString(),"Evidence"); assert.equal(opened,1); assert.equal(resolved,1);
  for(const addresses of [["127.0.0.1"],["1.1.1.1","10.0.0.1"]]){
    await assert.rejects(download(safeURL(url),signal(),{resolve:async()=>addresses,open:async()=>{opened++;throw Error();}}),code("PRIVATE_DESTINATION"));
  }
  assert.equal(opened,1);
});
test("every redirect is revalidated; closure, loop detection, downgrade, credentials and max hops", async () => {
  let opened=0,closed=0;
  const run=(location:string,status=302)=>download(safeURL(url),signal(),{
    resolve:async()=>["1.1.1.1"],open:async()=>{opened++;const r=response("",{location},status);return {response:r,close:()=>{closed++;r.destroy();}};},
  });
  for(const location of ["https://127.0.0.1/","http://docs.example.org/","https://u:p@docs.example.org/","https://docs.example.org/?token=secret"])
    await assert.rejects(run(location),ReadError);
  assert.equal(opened,4); assert.equal(closed,4);
  await assert.rejects(run(url),code("REDIRECT_LOOP"));
  let n=0;
  await assert.rejects(download(safeURL(url),signal(),{resolve:async()=>["1.1.1.1"],open:async()=>{
    n++;const r=response("",{location:"/step"+n},302);return {response:r,close:()=>r.destroy()};}}),code("REDIRECT_LIMIT"));
  assert.equal(n,3); // Two followed redirects permit exactly three HTTP responses.
});
test("encoded and decoded streaming caps are enforced independently, with compression and dishonest lengths", async () => {
  const text=Buffer.from("é".repeat(1000));
  for(const [encoding,body] of [["gzip",gzipSync(text)],["deflate",deflateSync(text)],["br",brotliCompressSync(text)]] as const){
    assert.deepEqual(await collect(response(body,{"content-encoding":encoding}),signal()),text);
  }
  await assert.rejects(collect(response(Buffer.alloc(2**21+1)),signal()),code("BODY_TOO_LARGE"));
  await assert.rejects(collect(response(gzipSync(Buffer.alloc(2**21+1)),{"content-encoding":"gzip"}),signal()),code("BODY_TOO_LARGE"));
  await assert.rejects(collect(response("",{"content-length":String(2**21+1)}),signal()),code("BODY_TOO_LARGE"));
  await assert.rejects(collect(response("bad",{"content-encoding":"gzip"}),signal()),code("BODY_FAILED"));
  await assert.rejects(collect(response("x",{"content-encoding":"zstd"}),signal()),code("UNSUPPORTED_ENCODING"));
});
test("unsupported media and HTTP errors close without extraction or fake content", async () => {
  for(const [status,type,expected] of [[404,"text/html","HTTP_FAILED"],[200,"application/pdf","UNSUPPORTED_CONTENT"],[200,"","UNSUPPORTED_CONTENT"]] as const){
    let closed=false;
    await assert.rejects(download(safeURL(url),signal(),{resolve:async()=>["1.1.1.1"],open:async()=>{
      const r=response("PRIVATE_SENTINEL",{"content-type":type},status);return {response:r,close:()=>{closed=true;r.destroy();}};
    }}),code(expected)); assert.equal(closed,true);
  }
});
test("cancellation destroys a live stream; deadline does not reset with progress; parser complexity fails closed", async () => {
  const c=new AbortController(); const r=response("");
  // A separate still-open stream makes cancellation observable without a sleep.
  const streaming=new PassThrough() as unknown as IncomingMessage; streaming.headers={};
  const pending=collect(streaming,c.signal); streaming.write("first"); c.abort();
  await assert.rejects(pending,code("CANCELLED")); assert.equal(streaming.destroyed,true); r.destroy();
  let progress=0, streamClosed=false;
  const reader=fixture("",{deadlineMs:35,download:async(u:URL,s:AbortSignal)=>download(u,s,{
    resolve:async()=>["1.1.1.1"],open:async()=>{
      const body=new PassThrough() as unknown as IncomingMessage;
      body.statusCode=200;body.headers={"content-type":"text/plain"};body.write("initial progress");progress++;
      const timer=setInterval(()=>{progress++;body.write("more progress");},5);
      return {response:body,close:()=>{clearInterval(timer);body.destroy();streamClosed=true;}};
    },
  })});
  await assert.rejects(reader.read({url}),code("DEADLINE")); assert.ok(progress>0);assert.equal(streamClosed,true); await reader.close();
  await assert.rejects(extract(Buffer.from("<div>".repeat(257)),"text/html",undefined,signal()),code("DOCUMENT_COMPLEXITY"));
});
test("two operations maximum, no queue; pre-cancel/invalid inputs and shutdown leave no work", async () => {
  let admitted=0; let ready!:()=>void; const both=new Promise<void>(resolve=>{ready=resolve;});
  const reader=fixture("",{download:async(_u:any,s:AbortSignal)=>{if(++admitted===2)ready();return await new Promise((_r,reject)=>{
    s.addEventListener("abort",()=>reject(new ReadError("CANCELLED")),{once:true});
  });}});
  const a=reader.read({url}), b=reader.read({url}); const settled=Promise.allSettled([a,b]); await both;
  await assert.rejects(reader.read({url}),code("BUSY")); assert.equal(admitted,2);
  await reader.close(); for(const r of await settled){assert.equal(r.status,"rejected");}
  await assert.rejects(reader.read({url}),code("CLOSED"));
  const fresh=fixture(""); const c=new AbortController();c.abort();
  await assert.rejects(fresh.read({url},c.signal),code("CANCELLED"));
  await assert.rejects(fresh.read({url,section:1} as any),code("INVALID_INPUT")); await fresh.close();
});
