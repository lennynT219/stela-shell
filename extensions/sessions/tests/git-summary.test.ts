import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readGitSummary } from "../git-summary.ts";

test('local branch divergence and net tracked text lines, including unborn, detached and lost upstream', async () => {
  const dir=mkdtempSync(join(tmpdir(),'ss-rail-')), child=join(dir,'sub'); mkdirSync(child);
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=test@example.invalid','-c','commit.gpgSign=false',...args],{cwd:dir,encoding:'utf8'}).trim();
  const put=(file:string,content:string)=>writeFileSync(join(dir,file),content);
  const sample=()=>readGitSummary(child,new AbortController().signal);
  try {
    assert.equal(await sample(),undefined); git('init','-q','-b','main');
    put('tracked','one\ntwo\nthree\n'); git('add','tracked'); put('ignored-by-counter','not staged\n');
    assert.deepEqual(await sample(),{branch:'main',ahead:undefined,behind:undefined,added:'3',removed:'0'});
    put('binary','\0original'); git('add','binary');
    git('commit','-qm','base'); git('branch','upstream'); git('branch','--set-upstream-to=upstream'); put('binary','\0changed\n');
    assert.deepEqual(await sample(),{branch:'main',ahead:'0',behind:'0',added:'0',removed:'0'});
    git('switch','-q','upstream'); git('commit','--allow-empty','-qm','one upstream');
    git('switch','-q','main'); git('branch','--set-upstream-to=upstream');
    git('commit','--allow-empty','-qm','one local'); git('commit','--allow-empty','-qm','two local');
    put('tracked','one\nintermediate\nthree\n'); git('add','tracked'); put('tracked','one\nthree\nA\nB\nC\n');
    const index=join(dir,'.git','index'), before=readFileSync(index);
    // Against the base: remove "two", add A/B/C. The staged intermediate line is neither.
    assert.deepEqual(await sample(),{branch:'main',ahead:'2',behind:'1',added:'3',removed:'1'});
    assert.deepEqual(readFileSync(index),before);
    git('update-ref','-d','refs/heads/upstream'); assert.equal((await sample())?.ahead,undefined);
    git('checkout','--detach','-q'); assert.equal((await sample())?.branch,`HEAD@${git('rev-parse','HEAD').slice(0,7)}`);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

const cli=process.env.SS_TEST_PI_CLI;
test('Pi TUI: a single colored Git row in the open panel; no notice or repo setup elsewhere', {skip:!cli||process.platform!=='linux',timeout:45000}, async()=>{
  const {stdout}=await promisify(execFile)('python3',['-B',fileURLToPath(new URL('./fixtures/git-summary-tui.py',import.meta.url)),process.execPath,cli!],{timeout:40000});
  assert.match(stdout,/Git rail verified/);
});
