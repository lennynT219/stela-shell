// Offline two-terminal fixture. Exercise the real task queue; only the helper's execution is synthetic.
import { writeFileSync, renameSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerSubagents } from "../../../subagents/index.ts";
import type { RunResult } from "../../../subagents/runner.ts";

export default function fixture(pi: ExtensionAPI) {
  let screen: any, delegate: any, pending: ((value: RunResult) => void)[] = [], serial = 0;
  const out = `${process.env.SS_FIXTURE_SCREEN}`;
  registerSubagents(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return (tool: any) => { if (tool.name === "ss_tasks_delegate") delegate = tool; return pi.registerTool(tool); };
    return Reflect.get(target, key);
  } }), { run: ({ signal }) => new Promise(resolve => { pending.push(resolve); signal.addEventListener("abort", () => resolve({ status: "cancelled", output: "", error: "", diagnostics: "", trace: [], truncated: false }), { once: true }); }) });
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.setWidget("fixture-screen", (tui) => { screen = tui; return { render: () => [], invalidate() {} }; });
  });
  pi.registerShortcut("f8", { description: "Read synthetic fixture frame", handler: async ctx => {
    writeFileSync(out + ".tmp", JSON.stringify({ lines: screen.getScreenLines(), draft: ctx.ui.getEditorText() })); renameSync(out + ".tmp", out);
  } });
  pi.registerShortcut("f5", { description: "Start synthetic task", handler: async ctx => {
    const n = ++serial;
    await delegate.execute("fixture", { label: `Revisión ${n}`, objective: `Fixture ${n}`, references: ["sample.txt"], done_when: "done" }, undefined, undefined, ctx);
  } });
  pi.registerShortcut("f6", { description: "Complete tasks", handler: async () => { for (const done of pending.splice(0)) done({ status: "completed", output: "fixture evidence", error: "", diagnostics: "", trace: [], truncated: false }); } });
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
