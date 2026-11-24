import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { FAMILIES, field, short, type Family, type Line, type Tool } from "./families.ts";
import type { BatchLine } from "./batches.ts";
import { literal, padCard, type Drawing } from "./paint.ts";
import { cardPalette } from "./palette.ts";

interface Band { text: string; role?: "title" | "label" | "warn" | "error" | "added"; family?: Family; tail?: string; inset?: boolean; language?: string }
interface DisplayResult { content: readonly { type: string; text?: string }[]; details?: unknown }
const safe = (s: string) => literal(s.replace(/\r\n/g,"\n")).replace(/\t/g,"   ");
const duration = (ms: unknown) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms/1000).toFixed(1)} s`) : "";
const price = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0 ? `$${n >= .01 ? n.toFixed(2) : n.toPrecision(2)}` : "";
const joined = (parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");
const title = (r: Line) => [FAMILIES[r.family][0],r.verb].filter(Boolean).join(" ");
const flag = (r: Line) => r.level === "error" ? "✗" : r.level === "warn" ? "!" : r.level === "pending" ? "…" : "";

/** Human view of canonical JSON from a structured tool, not a new result. Leave source code, clipped JSON,
 * duplicate keys and non-round-tripping representations (e.g. large numeric IDs) exactly as supplied. */
function readableJSON(line: string): string {
  if (line.length > 65536 || !/^(?:\{.*\}|\[.*\])$/u.test(line)) return line;
  try {
    const v = JSON.parse(line);
    if (JSON.stringify(v) !== line) return line;
    // Bound indentation growth before asking JSON.stringify for a pretty representation.
    let depth = 0;
    for (const [t] of line.matchAll(/"(?:\\.|[^"\\])*"|[[\]{}]/gu)) {
      if (t === "[" || t === "{") { if (++depth > 16) return line; } else if (t === "]" || t === "}") depth--;
    }
    return JSON.stringify(v,null,2).split("\n").map(l => {
      // Decode only newline escapes in a string VALUE, never an escaped backslash-n or a key. Keep its boundary.
      if (!l.includes("\\n")) return l;
      const m = /^( *)(?:("(?:\\.|[^"\\])*": ))?("(?:\\.|[^"\\])*")(,?)$/u.exec(l);
      return m ? m[1]+(m[2]??"")+m[3].replace(/\\./gu,s => s === "\\n" ? "\n"+m[1]+"  " : s)+m[4] : l;
    }).join("\n");
  } catch { return line; }
}

/** One surface owns every text cell, including wrapped continuations and trailing padding. Pi draws actual
 * image attachments separately. No tool, file lookup, permission prompt or timer belongs in this component. */
function sheet(draw: Drawing, theme: Theme, family: Family, pad: number, grouped: () => boolean, bands: Band[]): Component {
  let cache: { width: number; fill: Family; colors: Theme["colors"]; lines: string[] } | undefined;
  return { invalidate() { cache=undefined; }, render(width) {
    if (width < 1) return [];
    const fill = grouped() ? "code" : family, colors = theme.colors;
    if (cache && cache.width === width && cache.fill === fill && cache.colors === colors) return cache.lines;
    const p=cardPalette(theme,draw), bg=p.families[fill].bg, lines: string[]=[];
    for (const band of bands) {
      const margin=Math.min(4,Math.max(0,pad),Math.floor(width/12));
      const n=margin+(band.inset ? Math.min(2,Math.floor((width-margin)/8)) : 0);
      const room=width-n, inset=" ".repeat(n);
      const ink = band.role === "error" ? p.error : band.role === "warn" ? p.warning : band.role === "added" ? p.families.sessions.fg : band.family ? p.families[band.family].fg : p.text;
      const clean=safe(band.text);
      const content=band.language && draw.highlightCode ? draw.highlightCode(clean,band.language) : clean.split("\n");
      for (const s of content) {
        const main=theme.style(s,{fg:ink,bold:band.role === "title" || band.role === "label"});
        const styled=main+(band.tail?theme.style(" · "+safe(band.tail),{fg:p.text}):"");
        const wrapped=draw.visibleWidth(styled)<=room ? [styled] : draw.wrapTextWithAnsi(styled,room);
        for (const line of wrapped) {
          // Any SGR here is from Pi's formatter, never from the payload. A syntax reset must not clear the panel.
          const fit=draw.truncateToWidth(line,room,"…").replace(/\x1b\[(?:0|49)?m/gu,"\x1b[22;23;24;39m");
          lines.push(theme.style(inset+fit+" ".repeat(Math.max(0,room-draw.visibleWidth(fit))),{bg}));
        }
      }
    }
    const framed=padCard(theme,bg,width,lines);
    cache={width,fill,colors,lines:framed}; return framed;
  } };
}
function section(bands: Band[], label: string, value: string, extra: Partial<Band> = {}) {
  if (!value) return;
  bands.push({text:label,role:"label"},{text:value,inset:true,...extra});
}
function heading(row: Line, identity?: string, suffix?: string): Band {
  return {text:title(row),role:"title",family:row.family,tail:joined([row.verb!==identity?identity:"",suffix])};
}
function status(bands: Band[], row: Line, subject: string, notice=row.notice) {
  const text=joined([subject,[flag(row),notice].filter(Boolean).join(" ")]);
  if (text) bands.push({text,role:row.level === "error" || row.level === "warn" ? row.level : undefined});
}
function input(bands: Band[], name: Tool, args: Record<string,unknown>, draw: Drawing) {
  const key = name === "bash" ? "command" : name === "codemode" ? "code" : name === "write" ? "content" : undefined;
  const payload=key && args[key];
  const rest=typeof payload === "string" ? Object.fromEntries(Object.entries(args).filter(([k])=>k!==key)) : args;
  if (Object.keys(rest).length) section(bands,"Entrada",JSON.stringify(rest,null,2));
  if (typeof payload === "string") section(bands,name==="bash"?"Comando":name==="codemode"?"Código":"Contenido",payload,
    {language:name==="codemode"?"javascript":name==="write" && typeof args.path==="string" ? draw.getLanguageFromPath?.(args.path) : undefined});
}
function batchDetails(bands: Band[], children: readonly BatchLine[]) {
  let cost=0, priced=0;
  for (const child of children) {
    const c=child.record; if (!c) continue;
    const args=typeof c.args === "string" ? c.args : "";
    const diagnostic=typeof c.error === "string" ? c.error : "";
    const subject=child.subject && !(args && (child.family==="files" || child.family==="terminal") && args.includes(child.subject)) ? child.subject : "";
    const notice=child.notice && child.notice!==short(diagnostic,100) ? child.notice : "";
    const receipt=[flag(child) || (child.level==="ok"?"✓":""),notice].filter(Boolean).join(" ");
    bands.push(heading(child,short(c.name),joined([subject,receipt,duration(c.durationMs),price(c.cost)])));
    if (args && args!=="{}") bands.push({text:"Argumentos registrados: "+args,inset:true});
    if (diagnostic) bands.push({text:diagnostic,role:"error",inset:true});
    if (price(c.cost)) { priced++; cost+=c.cost!; }
  }
  if (priced>1) bands.push({text:`Coste de modelos: ${price(cost)}`});
}
interface ToolDetail {
  name: Tool; row: Line; args: unknown; result?: DisplayResult; children?: BatchLine[];
  partial: boolean; failed?: boolean; durationMs?: number; pad: number; grouped: () => boolean;
}
export function expandedTool(draw: Drawing, theme: Theme, v: ToolDetail): Component {
  const {name,row,result}=v, args=field(v.args), d=field(result?.details);
  const bands: Band[]=[heading(row,name,v.partial ? "" : duration(v.durationMs))];
  // Don't repeat a shell command (possibly a whole script) or path preview above its input.
  const isInput = [args.path,args.file_path,args.command,args.query,args.title,args.label].some(s=>typeof s === "string" && (row.subject === short(s) || row.subject === short(s,90)));
  status(bands,row,isInput ? "" : row.subject);
  if (v.children) batchDetails(bands,v.children);
  input(bands,name,args,draw);
  if (result) {
    const chunks=result.content.filter(b=>b.type==="text" && typeof b.text==="string").map(b=>b.text!);
    // Drop only Pi's dedicated Codemode envelope, never matching prose from inside the script's output.
    if (name==="codemode" && result.content[0]?.type==="text" && /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/u.test(chunks[0]??"")) chunks.shift();
    const structured = name === "codemode" || name.startsWith("ss_");
    const output=chunks.map(s=>structured ? s.split("\n").map(readableJSON).join("\n") : s).join("\n");
    section(bands,name === "bash" || name === "codemode" ? "Salida" : "Resultado",output,
      {role:v.failed?"error":undefined,language:name==="read" && !v.failed && typeof args.path==="string" ? draw.getLanguageFromPath?.(args.path) : undefined});
    if (name==="edit" && !v.partial && !v.failed && typeof d.diff === "string" && d.diff) {
      bands.push({text:"Cambios aplicados",role:"label"});
      for (const text of d.diff.split("\n")) bands.push({text,inset:true,role:text.startsWith("+")?"added":text.startsWith("-")?"error":undefined});
    }
    if (name==="read" && typeof d.imageUnsupportedByModel === "string") bands.push({text:`! ${d.imageUnsupportedByModel} recibió un marcador en vez de la imagen.`,role:"warn"});
    const cut=field(d.truncation);
    if (cut.truncated) {
      const count=Number.isSafeInteger(cut.outputLines) && Number.isSafeInteger(cut.totalLines) ? ` · ${cut.outputLines} de ${cut.totalLines} líneas` : "";
      const limit=cut.truncatedBy === "lines" && Number.isSafeInteger(cut.maxLines) ? ` · límite ${cut.maxLines} líneas` : Number.isSafeInteger(cut.maxBytes) ? ` · límite ${cut.maxBytes} bytes` : "";
      bands.push({text:`! ${cut.firstLineExceedsLimit?"La primera línea supera el límite":"Salida parcial"}${count}${limit}`,role:"warn"});
    }
    if (typeof d.fullOutputPath === "string" && !output.includes(d.fullOutputPath)) section(bands,"Salida completa (ruta devuelta)",d.fullOutputPath);
  }
  return sheet(draw,theme,row.family,v.pad,v.grouped,bands);
}
export function expandedMessage(draw: Drawing,theme: Theme,row: Line,pad: number,body: string): Component {
  const bands=[heading(row)]; status(bands,row,row.subject); section(bands,row.family==="sessions"?"Mensaje":"Detalle",body);
  return sheet(draw,theme,row.family,pad,()=>false,bands);
}
