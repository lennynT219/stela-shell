import assert from "node:assert/strict";
import { test } from "node:test";
import { ProtocolError, decode, stringify, type Request, type Value } from "../protocol.ts";

test("validation reason uses the existing failure envelope without a new protocol field",()=>{
  const request:Request={protocol_version:1,request_id:"550e8400-e29b-41d4-a716-446655440001",operation:"create",arguments:{}};
  const envelope=(result:unknown)=>new TextEncoder().encode(JSON.stringify({protocol_version:1,request_id:request.request_id,operation:request.operation,result})+"\n");
  for(const reason of ["UNCLOSED_HTML",undefined]) {
    const result={status:"invalid",message:"Untrusted backend text",...(reason?{reason}:{})};
    assert.deepEqual(decode(envelope(result),request,1024,1024).result,result);
  }
  assert.throws(()=>decode(envelope({status:"invalid",message:"Untrusted",code:"UNCLOSED_HTML"}),request,1024,1024),ProtocolError,"v1 does not silently accept a new backend field");
});

test("a correlated fragment receipt must confirm exactly one revision or the original no-op revision",()=>{
  const request_id="550e8400-e29b-41d4-a716-446655440001",memory_id="550e8400-e29b-41d4-a716-446655440002",base=9007199254740993n;
  const operation="update_sections",request:Request={protocol_version:1,request_id,operation,arguments:{memory_id,
    expected:{revision:base,accepted_markdown:"original"},edits:[{section:"Outcome status",oldText:"a",newText:"b"}],summary:"test"}};
  const decodeAt=(status:string,revision:bigint)=>decode(Buffer.from(stringify({protocol_version:1,request_id,operation,
    result:{status,request_id,memory_id,revision}},4096)+"\n"),request,4096,4096);
  assert.equal(decodeAt("saved",base+1n).result.status,"saved");
  assert.equal(decodeAt("unchanged",base).result.status,"unchanged");
  for(const delta of [-1n,0n,2n])assert.throws(()=>decodeAt("saved",base+delta),ProtocolError);
  assert.throws(()=>decodeAt("unchanged",base+1n),ProtocolError);
});

test("bounded serialization counts actual dense array contents and never runs custom serialization",()=>{
  const input={list:Array.from({length:300},()=>0)},expected=JSON.stringify(input);
  // Independently expected 2*N+10 bytes: 300 zeros,299 commas and11 wrapper bytes.
  assert.equal(Buffer.byteLength(expected),2*300+10);assert.ok(Buffer.byteLength(expected)<1024);
  assert.equal(stringify(input,1024),expected,"array index names are not serialized JSON keys");
  assert.throws(()=>stringify({list:new Array(100)},1024),ProtocolError,"sparse arrays are not plain JSON input");
  assert.throws(()=>stringify({list:new Array(1024)},1024),ProtocolError);
  let calls=0;
  for(const serializer of [
    {value:()=>{calls++;return "unexpected";}},
    {get(){calls++;return ()=>"unexpected";}},
  ]){
    const value={plain:"data"};Object.defineProperty(value,"toJSON",serializer);
    assert.throws(()=>stringify(value,1024),ProtocolError);assert.equal(calls,0);
  }
  const decorated=Object.assign([0,1],{extra:"ignored by JSON"});
  assert.throws(()=>stringify(decorated as Value,1024),ProtocolError);
  assert.equal(stringify({toJSON:"ordinary data"},1024),'{"toJSON":"ordinary data"}');
});
