import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { WebError, MAX_BODY, safeURL, isPublicAddress, checkEnvironment, collect, download, type Hop } from "../network.ts";

const signal = () => new AbortController().signal;
const code = (expected: string) => (error: any) => error instanceof WebError && error.code === expected;
function response(body: Buffer | string, headers: Record<string,string> = {}, status = 200): Hop {
  const incoming: any = Readable.from([Buffer.from(body)]);
  incoming.headers = { "content-type": "text/plain; charset=utf-8", ...headers }; incoming.statusCode = status;
  return { response: incoming, close() { incoming.destroy(); } };
}

test("public address/URL policy rejects local, mapped, reserved, credentials and unsafe schemes", () => {
  for (const address of ["1.1.1.1","8.8.8.8","2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  for (const address of ["127.0.0.1","10.1.2.3","100.64.1.2","169.254.169.254","168.63.129.16","192.0.2.8","198.18.1.1","240.0.0.1","::1","::ffff:8.8.8.8","64:ff9b::a00:1","2001:db8::1","2002:0808:0808::1","invalid"])
    assert.equal(isPublicAddress(address), false, address);
  for (const value of ["http://example.org/","https://user:password@example.org/","https://example.org:444/","https://localhost/","https://a.local/","https://a.test/","https://127.1/","https://2130706433/","https://[::ffff:127.0.0.1]/","https://example.org/?%61pi_key=DO_NOT_ECHO","https://example.org/#access_token=DO_NOT_ECHO","https://example.org/\\secret","https://example.org/\n","https://example.org/"+"a".repeat(2048)]) {
    assert.throws(() => safeURL(value), WebError);
  }
  assert.equal(safeURL("https://example.org:443/guide#intro").href, "https://example.org/guide#intro");
  assert.throws(() => safeURL("https://example.org/?token=DO_NOT_ECHO"), error => !String(error).includes("DO_NOT_ECHO"));
  checkEnvironment({});
  for (const env of [{ HTTPS_PROXY: "https://proxy.example.org/" },{ http_proxy: "http://proxy.example.org/" },{ NODE_USE_ENV_PROXY: "1" },{ NODE_TLS_REJECT_UNAUTHORIZED: "0" }]) assert.throws(() => checkEnvironment(env), WebError);
});

test("download pins validated DNS answers and revalidates each redirect without forwarding POST data", async () => {
  const visits: any[] = [], resolved: string[] = []; let closed = 0;
  const page = await download(safeURL("https://first.example.org/start"), signal(), {}, {
    resolve: async host => { resolved.push(host); return ["1.1.1.1"]; },
    open: async (url, address) => {
      visits.push([url.href,address]);
      const hop = visits.length === 1 ? response("",{ location: "https://next.example.org/final" },302) : response("Evidence");
      return { ...hop, close() { closed++; hop.close(); } };
    },
  });
  assert.equal(page.body.toString(), "Evidence"); assert.equal(page.redirects,1);
  assert.deepEqual(resolved,["first.example.org","next.example.org"]); assert.equal(closed,2);
  assert.deepEqual(visits.map(row=>row[1]),["1.1.1.1","1.1.1.1"]);
  await assert.rejects(download(safeURL("https://example.org/"),signal(),{}, {
    resolve: async()=>["1.1.1.1","10.0.0.1"], open: async()=>{throw new Error("must not connect");},
  }),code("PRIVATE_DESTINATION"));
  let sent = 0;
  await assert.rejects(download(safeURL("https://mcp.exa.ai/mcp"),signal(),{ method:"POST",body:Buffer.from("private objective"),redirects:false }, {
    resolve: async()=>["1.1.1.1"],open: async()=>{ sent++;return response("",{location:"https://other.example.org/"},307); },
  }),code("REDIRECT_UNSUPPORTED")); assert.equal(sent,1);
});

test("redirect loops, private targets, excess hops, status and unsupported MIME fail explicitly", async () => {
  const run = (headers: Record<string,string>,status=302) => download(safeURL("https://example.org/"),signal(),{}, {
    resolve: async()=>["1.1.1.1"],open: async()=>response("DO_NOT_ECHO",headers,status),
  });
  await assert.rejects(run({location:"/#different"}),code("REDIRECT_LOOP"));
  await assert.rejects(run({location:"https://10.0.0.1/secret"}),code("PRIVATE_DESTINATION"));
  await assert.rejects(run({location:"https://example.org/?token=DO_NOT_ECHO"}),code("CREDENTIAL_URL"));
  await assert.rejects(run({}),code("INVALID_REDIRECT"));
  await assert.rejects(run({},429),code("RATE_LIMITED"));
  await assert.rejects(run({},503),code("HTTP_FAILED"));
  await assert.rejects(run({"content-type":"application/pdf"},200),code("UNSUPPORTED_CONTENT"));
  let hops = 0;
  await assert.rejects(download(safeURL("https://example.org/"),signal(),{}, {
    resolve:async()=>["1.1.1.1"],open:async()=>response("",{location:`/next-${++hops}`},302),
  }),code("REDIRECT_LIMIT")); assert.equal(hops,3);
});

test("search JSON MIME is explicit and decoded/encoded byte caps include compressed responses", async () => {
  let options: any;
  const data = await download(safeURL("https://mcp.exa.ai/mcp"),signal(), {method:"POST",body:Buffer.from("{}"),contentTypes:["application/json"]}, {
    resolve:async()=>["1.1.1.1"],open:async(_url,_address,_signal,request)=>{ options=request; return response('{"ok":true}',{"content-type":"application/json"}); },
  });
  assert.equal(options.method,"POST"); assert.equal(data.contentType,"application/json");
  for (const [encoding,compress] of [["gzip",gzipSync],["deflate",deflateSync],["br",brotliCompressSync]] as const) {
    const small = response(compress(Buffer.from("Evidence 😀")),{"content-encoding":encoding});
    assert.equal((await collect(small.response,signal())).toString(),"Evidence 😀");
  }
  const bomb = response(gzipSync(Buffer.alloc(MAX_BODY+1,97)),{"content-encoding":"gzip"});
  await assert.rejects(collect(bomb.response,signal()),code("BODY_TOO_LARGE"));
  for (const hop of [response(Buffer.alloc(MAX_BODY+1)),response("x",{"content-length":String(MAX_BODY+1)})]) {
    await assert.rejects(collect(hop.response,signal()),code("BODY_TOO_LARGE")); hop.close();
  }
  await assert.rejects(collect(response("x",{"content-encoding":"zstd"}).response,signal()),code("UNSUPPORTED_ENCODING"));
  await assert.rejects(collect(response("not gzip",{"content-encoding":"gzip"}).response,signal()),code("BODY_FAILED"));
});

test("cancelled body collection closes the actual stream and never returns partial success", async () => {
  const body: any = new Readable({ read() {} }); body.headers={};
  const controller=new AbortController(), pending=collect(body,controller.signal);
  body.push(Buffer.from("partial")); controller.abort();
  await assert.rejects(pending,code("CANCELLED")); assert.equal(body.destroyed,true);
});
