import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configuredVaultGuard } from "../configuration.ts";

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"ss-memory-configuration-")),directory=join(root,".config","brain"),path=join(directory,"config.toml");
  const environment={HOME:root,USERPROFILE:root};
  return{root,directory,path,environment,close:()=>rmSync(root,{recursive:true,force:true})};
}

test("configuration guard captures lazily and observes metadata without interpreting TOML",()=>{
  const f=fixture();try {
    const guard=configuredVaultGuard(f.environment);assert.equal(existsSync(f.directory),false);
    mkdirSync(f.directory,{recursive:true});writeFileSync(f.path,"opaque data, deliberately not TOML\n");
    assert.equal(guard(),true);assert.equal(guard(),true,"only Brain interprets validity/content");
  }finally{f.close();}
});

test("configuration replacement invalidates the owner permanently, including same-content replacements",()=>{
  const f=fixture();try {
    mkdirSync(f.directory,{recursive:true});writeFileSync(f.path,"opaque data\n");const guard=configuredVaultGuard(f.environment);assert.equal(guard(),true);
    const old=join(f.directory,"old");renameSync(f.path,old);writeFileSync(f.path,"opaque data\n");assert.equal(guard(),false);
    rmSync(f.path);renameSync(old,f.path);assert.equal(guard(),false,"restoring an old path cannot renew observed authority");
    assert.equal(configuredVaultGuard(f.environment)(),true,"a new owner may observe current configuration");
  }finally{f.close();}
});

test("missing configuration is neither initialized nor silently adopted after first use",()=>{
  const f=fixture();try {
    const guard=configuredVaultGuard(f.environment);assert.equal(guard(),true);assert.equal(existsSync(f.path),false);
    mkdirSync(f.directory,{recursive:true});writeFileSync(f.path,"new configuration\n");assert.equal(guard(),false);
    rmSync(f.path);assert.equal(guard(),false);
  }finally{f.close();}
});

test("configuration guard observes followed-target changes as well as leaf metadata",{skip:process.platform==="win32"},()=>{
  const f=fixture();try {
    mkdirSync(f.directory,{recursive:true});const target=join(f.root,"target");writeFileSync(target,"opaque data\n");symlinkSync(target,f.path);
    const guard=configuredVaultGuard(f.environment);assert.equal(guard(),true);
    renameSync(target,join(f.root,"previous"));writeFileSync(target,"opaque data\n");assert.equal(guard(),false);
  }finally{f.close();}
});
