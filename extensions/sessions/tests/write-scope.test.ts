import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, linkSync, symlinkSync, unlinkSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerWriteScope, targetOf } from "../write-scope.ts";

const linux = { skip: process.platform !== 'linux' };
function fixture(run: (f: { root:string, project:string, profile:string, outside:string })=>Promise<void>) {
  const root=mkdtempSync(join(tmpdir(),'ss-write-check-'));
  const [project,profile,outside]=['work','profile','work-other'].map(f=>join(root,f));
  for (const d of [project,profile,outside]) mkdirSync(d);
  return run({root,project,profile,outside}).finally(()=>rmSync(root,{force:true,recursive:true}));
}
function harness(cwd:string, profile:string) {
  const hooks=new Map<string, Function>(); let revoke!:Function;
  registerWriteScope({ on:(s:string,fn:Function)=>hooks.set(s,fn),registerCommand:(_s:string,c:any)=>revoke=c.handler } as any,()=>profile);
  const answers:(string|undefined)[] = [], titles:string[]=[]; let beforeAnswer: undefined|(()=>void);
  const ctx={mode:'tui',hasUI:true,cwd,ui:{ select:async(title:string, opts:string[])=>{
    titles.push(title); const a=answers.shift(); beforeAnswer?.(); beforeAnswer=undefined;
    assert.equal(opts[0],'Cancelar'); assert.ok(a===undefined||opts.includes(a)); return a;
  },notify(){} }};
  return {ctx,answers,titles, change:(fn:()=>void)=>beforeAnswer=fn, revoke:()=>revoke('',ctx),
    async permit(path:string, toolName='write') { const event={toolName,input:{path}}; const result=await hooks.get('tool_call')!(event,ctx);
      return result?.block ? undefined : event.input.path; } };
}

test('inside, sibling, linked directories, new leaves and alternate Pi spellings resolve to the actual destination',linux,()=>fixture(async({project,profile,outside})=>{
  const h=harness(project,profile), f=join(outside,'test.fish'); symlinkSync(outside,join(project,'ref'));
  assert.equal(await h.permit('src/new.ts'),join(project,'src/new.ts')); assert.deepEqual(h.titles,[]);
  assert.equal(await h.permit('ref/test.fish'),undefined); assert.match(h.titles.at(-1)!,/work-other\/test.fish/);
  assert.equal(targetOf(project,'@'+pathToFileURL(f)),f); assert.equal(await h.permit('../work-other/test.fish'),undefined);
  h.answers.push('Permitir una vez'); assert.equal(await h.permit('ref/test.fish'),f); assert.equal(await h.permit('ref/test.fish'),undefined);
  symlinkSync(join(outside,'missing'),join(project,'dangling')); assert.equal(await h.permit('dangling'),undefined);
  writeFileSync(f,'unchanged'); linkSync(f,join(project,'double')); assert.equal(await h.permit('double'),undefined);
  assert.equal(readFileSync(f,'utf8'),'unchanged'); assert.ok(!existsSync(join(profile,'ss-write-rules')));
}));

test('remember exact or nonrecursive suffix only after explicit selection, reread on restart and revoke across sessions',linux,()=>fixture(async({root,project,profile,outside})=>{
  const h=harness(project,profile), f=join(outside,'config.fish'), other=join(outside,'other.fish');
  h.answers.push('Permitir y recordar',undefined); assert.equal(await h.permit(f),undefined);
  h.answers.push('Permitir y recordar',`Archivo: ${f}`); assert.equal(await h.permit(f),f);
  const next=harness(project,profile); assert.equal(await next.permit(f,'edit'),f); assert.deepEqual(next.titles,[]);
  assert.equal(await next.permit(other),undefined); const d=join(root,'separate'); mkdirSync(d);
  assert.equal(await harness(d,profile).permit(f),undefined); assert.equal(await harness(project,d).permit(f),undefined);
  h.answers.push(`Archivo: ${f}`); await h.revoke(); assert.equal(await next.permit(f),undefined);
  next.answers.push('Permitir y recordar',`Patrón: ${join(outside,'*.fish')}`); assert.equal(await next.permit(other),other);
  assert.equal(await h.permit(f),f); assert.equal(await h.permit(join(outside,'sub','a.fish')),undefined);
  assert.equal(await h.permit(join(outside,'other.js')),undefined);
  assert.equal(await h.permit(join(profile,'ss-write-rules','new')),undefined);
  h.answers.push(`Patrón: ${join(outside,'*.fish')}`); await h.revoke(); assert.equal(await next.permit(other),undefined);
}));

test('no unattended new grants and no reuse if a selected target changes while the prompt is open',linux,()=>fixture(async({project,profile,outside})=>{
  const h=harness(project,profile), ref=join(project,'ref'); symlinkSync(outside,ref);
  h.ctx.mode='rpc'; assert.equal(await h.permit('ref/one'),undefined); assert.deepEqual(h.titles,[]);
  h.ctx.mode='tui'; h.answers.push('Permitir una vez'); h.change(()=>{unlinkSync(ref);symlinkSync(profile,ref)});
  assert.equal(await h.permit('ref/one'),undefined); assert.ok(!existsSync(join(profile,'one')));
}));

const cli=process.env.SS_TEST_PI_CLI;
test('Pi TUI: inspect, cancel, broaden explicitly, remember after restart, revoke; Codemode uses the native gate',
  {skip: linux.skip || !cli, timeout:60000}, async()=>{
    const {stdout}=await promisify(execFile)('python3',['-B',fileURLToPath(new URL('./fixtures/write-scope-tui.py',import.meta.url)),process.execPath,cli!],{timeout:55000});
    assert.match(stdout,/permissions verified in two Pi processes/);
  });
