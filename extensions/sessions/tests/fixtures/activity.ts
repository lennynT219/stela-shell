// Offline two-terminal fixture. Exercise the real task queue; only the helper's execution is synthetic.
import { writeFileSync, renameSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerSubagents } from "../../../subagents/index.ts";
import type { RunResult } from "../../../subagents/runner.ts";

export default function fixture(pi: ExtensionAPI) {
  let screen: any, delegate: any, pending: ((value: RunResult) => void)[] = [], serial = 0;
  const reports: ((action:string) => void)[] = [];
  const finish = () => { for (const done of pending.splice(0)) done({status:"completed",output:"fixture evidence",error:"",diagnostics:"",trace:[],truncated:false}); reports.length=0; };
  const out = `${process.env.SS_FIXTURE_SCREEN}`;
  registerSubagents(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return (tool: any) => { if (tool.name === "ss_tasks_delegate") delegate = tool; return pi.registerTool(tool); };
    return Reflect.get(target, key);
  } }), process.env.SS_FIXTURE_REAL_CHILD ? {} : { run: ({ signal,onAction }) => new Promise(resolve => { if(onAction) reports.push(onAction); pending.push(resolve); signal.addEventListener("abort", () => resolve({ status: "cancelled", output: "", error: "", diagnostics: "", trace: [], truncated: false }), { once: true }); }) });
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.setWidget("fixture-screen", (tui) => { screen = tui; return { render: () => [], invalidate() {} }; });
    ctx.ui.onTerminalInput(data => {
      if (process.env.SS_TEST_TASK_DETAIL && data === "\x1bOS") { reports.forEach((report,i)=>report(`Leer · fuente-${i+1}.ts`)); return {consume:true}; }
      if (process.env.SS_TEST_TASK_DETAIL && data === "\x1b[17~") { finish(); return {consume:true}; }
      if (process.env.SS_TEST_PANEL_DIALOG && screen?.isOverlayFocused() && data === "\x1b[21~") {
        void ask(ctx); return {consume:true};
      }
      if (data !== "\x1b[19~" || !screen) return;
      snapshot(ctx); return {consume:true};
    });
  });
  const snapshot = (ctx:ExtensionContext) => {
    const lines = screen.mode === "regular" ? screen.captureRenderState().previousLines.slice(-screen.terminal.rows) : screen.getScreenLines();
    writeFileSync(out + ".tmp", JSON.stringify({ lines, draft: ctx.ui.getEditorText() })); renameSync(out + ".tmp", out);
  };
  pi.registerShortcut("f8", { description:"Read synthetic fixture frame", handler: async ctx => snapshot(ctx) });
  pi.registerShortcut("f5", { description: "Start synthetic task", handler: async ctx => {
    const n = ++serial;
    await delegate.execute("fixture", { label: `Revisión ${n}`, objective: `Fixture ${n}`, references: ["sample.txt"], done_when: "done" }, undefined, undefined, ctx);
  } });
  pi.registerShortcut("f6", { description: "Complete tasks", handler: async () => finish() });
  const ask = async (ctx: ExtensionContext) => {
    const yes = await ctx.ui.confirm("Pregunta de prueba", "¿Conservar el borrador sintético?");
    writeFileSync(out + ".answer", JSON.stringify(yes));
  };
  pi.registerCommand("fixture-question", { description: "Hold a real question open", handler: async (_a, ctx) => ask(ctx) });
  let closeHidden: (() => void) | undefined;
  pi.registerShortcut("f7", { description: "Open question, followed by a hidden custom overlay", handler: async ctx => {
    await ask(ctx);
    await ctx.ui.custom<void>((_t, _theme, _keys, done) => {
      closeHidden = () => done(); return { render: () => [], invalidate() {} };
    }, { overlay: true, blocked: { kind: "question", message: "Fixture hidden" }, onHandle: h => h.setHidden(true) });
  } });
  pi.registerShortcut("f9", { description: "Dispose the fixture overlay", handler: async () => closeHidden?.() });
}
