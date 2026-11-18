import assert from "node:assert/strict";
import { test } from "node:test";
import { openPrimaryActivity, primaryActivity } from "../../primary-activity.ts";

function owner() {
  let sessionId="owned";
  const ctx={cwd:"/workspace",sessionManager:{getSessionId:()=>sessionId}};
  return {ctx,changeSession:(value:string)=>{sessionId=value;}};
}

test("only a live owned source with commitment proof exposes activity",()=>{
  const {ctx,changeSession}=owner();let live=true,proof=true,observed=0;
  assert.equal(primaryActivity(ctx),undefined);
  const source=openPrimaryActivity(ctx,()=>live,()=>{observed++;});
  try {
    assert.equal(primaryActivity(ctx),undefined,"registration/observation alone grants nothing");
    source.committed(Date.now()+60_000,()=>proof);
    const activity=primaryActivity(ctx);assert.ok(activity);assert.equal(observed,2);
    assert.equal(primaryActivity(ctx),activity,"observation cannot mint a new grant or renew it");
    assert.equal(primaryActivity({...ctx,cwd:"/other"}),undefined);
    assert.equal(primaryActivity({...ctx,sessionManager:{getSessionId:()=>"owned"}}),undefined);
    proof=false;assert.equal(activity.valid(),false);proof=true;
    live=false;assert.equal(activity.valid(),false);live=true;
    changeSession("replaced");assert.equal(activity.valid(),false);changeSession("owned");
    ctx.cwd="/other";assert.equal(activity.valid(),false);ctx.cwd="/workspace";
    source.close();assert.equal(activity.valid(),false);assert.equal(primaryActivity(ctx),undefined);
  } finally {source.close();}
});

test("deadlines and stale cleanup cannot revive or revoke a different source",(t)=>{
  const {ctx}=owner();let now=100_000;t.mock.method(Date,"now",()=>now);
  let live=true;const old=openPrimaryActivity(ctx,()=>live,()=>{});
  old.committed(now-1,()=>true);assert.equal(primaryActivity(ctx),undefined);
  old.committed(now+10,()=>true);const activity=primaryActivity(ctx);assert.ok(activity);
  now+=10;assert.equal(activity.valid(),false);
  live=false;const next=openPrimaryActivity(ctx,()=>true,()=>{});
  try {
    next.committed(now+100,()=>true);const current=primaryActivity(ctx);assert.ok(current);
    old.close();assert.equal(primaryActivity(ctx),current,"stale owner cleanup must not revoke the replacement");
  } finally {old.close();next.close();}
});

test("separate module evaluations share the weak host registry",async()=>{
  // Pi uses jiti moduleCache:false; a plain per-module registry would split them.
  const another=await import(new URL("../../primary-activity.ts?separate-module",import.meta.url).href) as typeof import("../../primary-activity.ts");
  const {ctx}=owner(),source=openPrimaryActivity(ctx,()=>true,()=>{});
  try {source.committed(Date.now()+60_000,()=>true);assert.equal(another.primaryActivity(ctx),primaryActivity(ctx));}
  finally {source.close();}
});
