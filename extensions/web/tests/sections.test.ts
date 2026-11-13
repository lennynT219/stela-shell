import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "../reader.ts";
const signal=()=>new AbortController().signal;
test("duplicate heading titles use recorded structural boundaries, not the first flattened text match",async()=>{
  const html='<main><pre>## Install\nFake earlier marker</pre><h2 id="old">Install</h2>Old instructions<h2 id="current">Install</h2>Current instructions<pre>\n## Fake terminator\nKeep this code</pre><h3>Details</h3>Keep details<h2>Next</h2>NOT_CURRENT</main>';
  const v=await extract(Buffer.from(html),"text/html","current",signal());
  assert.equal(v.matched,true);assert.equal(v.selected?.id,"current");
  assert.match(v.text,/Current instructions/);assert.match(v.text,/Keep this code/);assert.match(v.text,/Keep details/);
  assert.doesNotMatch(v.text,/Old instructions|Fake earlier marker|NOT_CURRENT/);
});
test("exact heading IDs take priority over titles and preserve case-sensitive source identity",async()=>{
  const html='<main><h2 id="old">Current</h2>Old instructions<h2 id="Current">Case-sensitive ID</h2>Uppercase instructions<h2 id="current">Install</h2>Correct instructions<h2>Next</h2>Not selected</main>';
  const lower=await extract(Buffer.from(html),"text/html","current",signal());
  assert.equal(lower.selected?.id,"current");assert.match(lower.text,/Correct instructions/);assert.doesNotMatch(lower.text,/Old instructions|Uppercase instructions/);
  const upper=await extract(Buffer.from(html),"text/html","Current",signal());
  assert.equal(upper.selected?.id,"Current");assert.match(upper.text,/Uppercase instructions/);
});
test("worker truncation never splits a decoded Unicode scalar and cancellation terminates the worker",async()=>{
  const text="a".repeat(16383)+"🙂"+"b".repeat(100);
  const result=await extract(Buffer.from(text),"text/plain",undefined,signal());
  assert.equal(result.truncated,true);assert.equal(result.text,"a".repeat(16383));
  const controller=new AbortController();
  const pending=extract(Buffer.alloc(2**21,65),"text/plain",undefined,controller.signal);
  controller.abort();await assert.rejects(pending,(e:any)=>e.code==="CANCELLED");
});
test("a truncated long heading label is not treated as an exact title match",async()=>{
  const prefix="a".repeat(200);
  const v=await extract(Buffer.from('<h2 id="long">'+prefix+'extra</h2>Evidence'),"text/html",prefix,signal());
  assert.equal(v.matched,false);assert.equal(v.text,"");
});
test("Markdown code fences do not create or terminate section boundaries",async()=>{
  const input='# Docs\n\n~~~\n## Install\nFake earlier marker\n~~~\n\n## Install\nReal instructions\n\n```js\n## Fake terminator\nKeep code\n```\n\n## Next\nNOT_SELECTED';
  const v=await extract(Buffer.from(input),"text/markdown","Install",signal());
  assert.equal(v.matched,true);assert.match(v.text,/Real instructions/);assert.match(v.text,/Keep code/);
  assert.doesNotMatch(v.text,/Fake earlier marker|NOT_SELECTED/);
});
