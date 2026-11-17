import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutableError, selectExecutable, resolveExecutable } from "../executable.ts";

const filename = process.platform === "win32" ? "brain.exe" : "brain";
const missing = (error: unknown) => error instanceof ExecutableError && error.code === "EXECUTABLE_NOT_FOUND";
const invalid = (error: unknown) => error instanceof ExecutableError && error.code === "INVALID_EXECUTABLE";

test("executable precedence is nonblank BRAIN_BIN then brain, with no CLI flags or shell interpretation", () => {
  const absolute = join(tmpdir(),filename), path = join(tmpdir(),"bin");
  assert.deepEqual(selectExecutable({BRAIN_BIN:absolute,PATH:path}),{command:absolute,path:""});
  assert.deepEqual(selectExecutable({BRAIN_BIN:"other",PATH:path}),{command:"other",path});
  assert.deepEqual(selectExecutable({BRAIN_BIN:" \t",PATH:path}),{command:"brain",path});
  assert.deepEqual(selectExecutable({PATH:path}),{command:"brain",path});
  assert.throws(() => selectExecutable({BRAIN_BIN:"./brain",PATH:path}),invalid);
  assert.throws(() => selectExecutable({BRAIN_BIN:"bad\0selection",PATH:path}),invalid);
  assert.throws(() => selectExecutable({PATH:"bad\0path"}),invalid);
  // This remains ONE filename, not executable plus shell arguments.
  assert.equal(selectExecutable({BRAIN_BIN:"brain --help",PATH:path}).command,"brain --help");
});

test("absolute selection is retained without probing, fallback or requiring PATH", () => {
  const absolute = join(tmpdir(),"not-probed",filename);
  assert.equal(resolveExecutable(selectExecutable({BRAIN_BIN:absolute}),tmpdir()),absolute);
  assert.throws(() => resolveExecutable(selectExecutable({}),tmpdir()),missing);
});

test("PATH metadata selection honors order, spaces and executable files without launching candidates", () => {
  const root=mkdtempSync(join(tmpdir(),"ss-memory-executable-"));
  const first=join(root,"first with spaces"),second=join(root,"second");mkdirSync(first);mkdirSync(second);
  const a=join(first,filename),b=join(second,filename),cwd=join(root,"work");mkdirSync(cwd);
  try {
    // Deliberately not an actual Brain program. A resolver must never run it.
    writeFileSync(a,"NOT AN EXECUTABLE PROGRAM\n");writeFileSync(b,"NOT AN EXECUTABLE PROGRAM\n");
    chmodSync(a,0o700);chmodSync(b,0o700);
    const selected=selectExecutable({PATH:[first,second].join(delimiter)});
    assert.equal(resolveExecutable(selected,cwd),a);
    rmSync(a);assert.equal(resolveExecutable(selected,cwd),b);
    rmSync(b);assert.throws(() => resolveExecutable(selected,cwd),missing);
    mkdirSync(a);assert.throws(() => resolveExecutable(selected,cwd),missing,"directories are not executable candidates");
    if(process.platform==="win32") {
      rmSync(a,{recursive:true});writeFileSync(b,"NOT EXECUTED\n");
      assert.equal(resolveExecutable(selectExecutable({Path:`"${second}"`}),cwd),b);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("POSIX PATH skips nonexecutable files and preserves relative/empty entry semantics",{skip:process.platform==="win32"},()=>{
  const root=mkdtempSync(join(tmpdir(),"ss-memory-executable-"));
  const one=join(root,"one"),two=join(root,"two");mkdirSync(one);mkdirSync(two);
  try {
    writeFileSync(join(one,"brain"),"not executed\n",{mode:0o600});writeFileSync(join(two,"brain"),"not executed\n",{mode:0o700});
    assert.equal(resolveExecutable(selectExecutable({PATH:[one,two].join(delimiter)}),root),join(two,"brain"));
    assert.equal(resolveExecutable(selectExecutable({PATH:"two"}),root),join(two,"brain"));
    assert.equal(resolveExecutable(selectExecutable({PATH:`${delimiter}${two}`}),one),join(two,"brain"));
  }finally{rmSync(root,{recursive:true,force:true});}
});
