import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerTurnHint } from "../turn-hint.ts";

test("the hint reads only the active chat editor and does not invent unbound shortcuts", () => {
  let start!: Function, render!: (width: number) => string[];
  class Editor {
    getText() { return "texto"; }
    isShowingAutocomplete() { return false; }
  }
  let focus: object = new Editor();
  const ctx = { mode:"rpc", isIdle: () => false, ui:{ setWidget(_: string, factory: Function) {
    render = factory({ getFocusedComponent: () => focus }, { fg: (_c: string, s: string) => s }).render;
  } } };
  registerTurnHint({ on(_: string, cb: Function) { start = cb; } } as any, Editor as any,
    action => action === "tui.input.submit" ? ["ctrl+return"] : [], s => s);
  start({}, ctx); assert.equal(render, undefined);
  ctx.mode = "tui"; start({}, ctx); assert.deepEqual(render(38), ["Ctrl+Intro: ahora"]);
  focus = { getText() { throw Error("private dialog must not be read"); } }; assert.deepEqual(render(38), []);
  focus = Object.assign(new Editor(), { isShowingAutocomplete: () => true }); assert.deepEqual(render(38), []);
});

const cli = process.env.SS_TEST_PI_CLI;
test("busy Pi editor: show the effective keys; submit, enqueue and return from the external editor natively", {
  skip: !cli || process.platform !== "linux", timeout: 60000,
}, async () => {
  const { stdout } = await promisify(execFile)("python3", ["-B", fileURLToPath(new URL("./fixtures/turn-hint-tui.py", import.meta.url)), process.execPath, cli!], {timeout: 55000});
  assert.match(stdout, /both queue modes and rebound shortcut verified/);
});
