import assert from "node:assert/strict";
import { test } from "node:test";
import { ProtocolError, stringify, type Value } from "../protocol.ts";

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
