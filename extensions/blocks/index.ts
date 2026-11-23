import type { ExtensionAPI, ExtensionContext, MessageRenderer, ToolDefinition, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Batches, batchLines, type BatchLine } from "./batches.ts";
import { expandedTool, expandedMessage } from "./expanded.ts";
import { field, foldable, known, short, type Line, type Tool } from "./families.ts";
import { ReadGroups } from "./groups.ts";
import { empty, lineBlock, paint, type Drawing } from "./paint.ts";
import { action, imageOutput, outcome, peerName } from "./summary.ts";

const STATE = Symbol("ss block render state");
type Context = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
interface Local { hasResult?: boolean }
const local = (c: Context): Local => c.state[STATE] ??= {};
const actionCount = (n: number) => `${n} ${n === 1 ? "acción" : "acciones"}`;
function toolView(name: Tool, draw: Drawing, groups: ReadGroups, batches: Batches): ToolRenderers {
  const layout = name === "codemode" ? "group" : "individual";
  return { renderShell: "self",
    renderCall(args, theme, c) {
      const state = local(c), base = action(name,args);
      groups.bind(c.toolCallId,name,c.expanded,c.invalidate);
      if (!c.isPartial || state.hasResult) return empty;
      const row: Line={...base,level:"pending",notice:"Pendiente"};
      const pending = c.expanded ? expandedTool(draw,theme,{name,args,row,partial:true,pad:c.outputPad,grouped:()=>name==="codemode"})
        : {render:(w:number)=>paint(draw,theme,row,w,c.outputPad,layout),invalidate(){}};
      // Pi mounts both slots. Once the first partial/final result arrives, it owns the entire card.
      return {render:w=>state.hasResult?[]:pending.render(w), invalidate:()=>pending.invalidate()};
    },
    renderResult(result, opts, theme, c) {
      const state = local(c); state.hasResult = true;
      const base = action(name,c.args), row = outcome(name,base,result,opts.isPartial,c.isError);
      const hasImage = imageOutput(result);
      if (hasImage) {
        if (!c.showImages || draw.getCapabilities?.().images === null) row.notice = [row.notice,"Imagen adjunta · no visible aquí"].filter(Boolean).join(" · ");
        else row.notice ||= "Imagen adjunta";
      }
      const canGroup = foldable(name) && !opts.isPartial && row.level === "ok" && !hasImage;
      groups.mark(c.toolCallId,name,canGroup);
      let children: BatchLine[] | undefined;
      if (name === "codemode") {
        const d = field(result.details);
        if (Array.isArray(d.calls)) row.verb = actionCount(d.calls.length);
        children = batchLines(d,batches.facts(c.toolCallId),c.expanded,opts.isPartial ? undefined : hasImage);
        if (c.isError && Array.isArray(d.calls)) row.notice = "Falló la ejecución";
        else if (!opts.isPartial && children.some(s => s.level === "error" || s.level === "warn")) { row.level = "warn"; row.notice = "Revisar resultados"; }
        const texts = result.content.filter(p => p.type === "text");
        if (d.fullOutputPath || texts.some(p => /(?:^|\n)Warning: truncated output \(original token count:/.test(p.text))) {
          row.level = row.level === "error" ? "error" : "warn"; row.notice = [row.notice,"Salida parcial"].filter(Boolean).join(" · ");
        }
        if (texts.some(p => p.text.includes("that the script did not show. Show each image block"))) {
          row.level = row.level === "error" ? "error" : "warn"; row.notice = [row.notice,"Imagen no mostrada"].filter(Boolean).join(" · ");
        }
      }
      const grouped=()=>name==="codemode" || (canGroup && groups.grouped(c.toolCallId));
      if (c.expanded) return expandedTool(draw,theme,{name,args:c.args,row,result,children,partial:opts.isPartial,failed:c.isError,durationMs:c.durationMs,pad:c.outputPad,grouped});
      const rows=children?[row,...children]:[row];
      const summary: Component = { render(w) {
        const count = canGroup && !c.expanded ? groups.count(c.toolCallId) : 1;
        if (!count) return [];
        if (count > 1) return paint(draw,theme,{ ...row, subject: `×${count}`, notice: "" },w,c.outputPad,"group");
        return rows.flatMap(r => paint(draw,theme,r,w,c.outputPad,grouped()?"group":layout));
      }, invalidate() {} };
      return summary;
    },
  };
}

/** Single registration on the primary Sessions UI entry. Never override or activate an executable tool. */
export function registerBlocks(pi: ExtensionAPI, draw: Drawing) {
  if (!pi.registerToolRenderer) return;
  const groups = new ReadGroups(), batches = new Batches();
  let owner: ExtensionContext["sessionManager"] | undefined, session = "";
  const owns = (ctx: ExtensionContext) => owner === ctx.sessionManager && session === ctx.sessionManager.getSessionId();
  const reset = () => { groups.reset(); batches.reset(); owner = undefined; session = ""; };
  const start = (_: unknown, ctx: ExtensionContext) => {
    reset(); owner = ctx.sessionManager; session = owner.getSessionId();
    if (ctx.mode === "tui") for (const e of owner.getBranch().slice(-2048)) {
      if (e.type === "message" && e.message.role === "assistant") groups.assistant(e.message.content);
    }
  };
  pi.on("session_start",start); pi.on("session_tree",start); pi.on("session_shutdown",reset);
  pi.on("message_end",(e,ctx) => { if (owns(ctx) && ctx.mode === "tui" && e.message.role === "assistant") groups.assistant(e.message.content); });
  pi.on("tool_execution_start",(e,ctx) => { if (owns(ctx)) batches.start(e.toolCallId,e.toolName,e.args,e.parentToolCallId); });
  pi.on("tool_execution_end",(e,ctx) => { if (owns(ctx)) batches.end(e.toolCallId,e.toolName,e.result,e.isError,e.parentToolCallId); });
  pi.on("tool_result",(e,ctx) => {
    if (!owns(ctx) || e.toolName !== "codemode" || e.parentToolCallId) return;
    const facts = batches.facts(e.toolCallId);
    // Keep only compact child facts for replay, in the parent's existing UI details. Never replace content,
    // structuredContent, the error flag, a child's result, the native call record or permission evidence.
    if (facts.length && Array.isArray(field(e.details).calls)) return { details: { ...field(e.details), ssBlocks: { v: 1, facts } } };
  });
  pi.registerToolRenderer((name,next) => known(name) ? toolView(name,draw,groups,batches) : next());
}

/** Incoming events are not extra tool calls. Keep the protocol text, IDs and details for expansion only. */
export function familyMessage(kind: "sessions" | "tasks", draw: Drawing): MessageRenderer {
  return (message, opts, theme) => {
    const d = field(message.details), body = typeof message.content === "string" ? message.content : message.content.filter(p => p.type === "text").map(p => p.text).join("\n");
    let row: Line;
    if (kind === "sessions") {
      // Earlier SS messages had no display field. Match only their fixed metadata paragraph and exact activation.
      let source = d.fromName;
      if (source === undefined && typeof d.from === "string" && /^[a-f0-9]{32}$/.test(d.from) && body.startsWith("stela-shell peer message —")) {
        const meta = body.split("\n\n",5)[4]?.match(/^From activation: ([a-f0-9]{32}); session: "(?:[^"\\]|\\.)*"; name: ("(?:[^"\\]|\\.)*"); workspace: /u);
        if (meta?.[1] === d.from) try { source = JSON.parse(meta[2]); } catch { /* Unrecognized legacy metadata. */ }
      }
      row = { family: kind, verb: "Recibido de", subject: peerName(source), notice: "", level: "ok" };
    }
    else {
      const state = short(d.state,32);
      const success = state === "completed";
      const notice = [success ? "Terminado" : state === "cancelled" ? "Cancelado" : state === "failed" ? "Falló" : "Estado no disponible", d.truncated || d.partialEvidence ? "Parcial" : "", d.sourcesMayHaveChanged ? "Revisar fuentes" : "", d.noAnswer ? "Sin respuesta" : ""].filter(Boolean).join(" · ");
      row = { family: kind, verb: "Resultado", subject: short(d.label), notice, level: success && !d.truncated && !d.sourcesMayHaveChanged && !d.noAnswer ? "ok" : state === "failed" ? "error" : "warn" };
    }
    return opts.expanded ? expandedMessage(draw,theme,row,opts.outputPad,body) : lineBlock(draw,theme,row,opts.outputPad);
  };
}
