import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Batches, batchLines } from "../../blocks/batches.ts";
import { FAMILIES, type Tool } from "../../blocks/families.ts";
import { cardPalette } from "../../blocks/palette.ts";
import { expandedTool } from "../../blocks/expanded.ts";
import { ReadGroups } from "../../blocks/groups.ts";
import { familyMessage, registerBlocks } from "../../blocks/index.ts";
import { literal, paint } from "../../blocks/paint.ts";
import { action, outcome } from "../../blocks/summary.ts";
import { formatMessage } from "../messages.ts";

const text = (s: string) => ({ type: "text", text: s });
const png = { type: "image", data: "synthetic", mimeType: "image/png" };
const result = (name: Tool, args = {}, details = {}, content = [text("")], error = false) => outcome(name,action(name,args),{ details,content },false,error);
const draw: any = { Text: class { constructor(publicText: string) { this.value = publicText; } value: string; render() { return this.value.split("\n"); } invalidate() {} }, visibleWidth: (s: string) => [...s].length, truncateToWidth: (s: string, w: number) => [...s].length <= w ? s : [...s].slice(0,Math.max(0,w-1)).join("") + (w ? "…" : ""), wrapTextWithAnsi: (s: string, w: number) => s.match(new RegExp(`.{1,${w}}`, "gu")) ?? [] };
// Text-only layout tests do not need Pi installed; color assertions below use its real OKHSL and ANSI tools.
Object.assign(draw,{ okhslColor: (_h:number,_s:number,l:number)=>({kind:"rgb",r:l*255,g:l*255,b:l*255}), colorToRgb: (c:unknown)=>c });
const theme: any = { style: (s: string) => s, colors:{}, appearance:"dark", getColorMode:()=>"truecolor", getBgAnsi:()=>"\x1b[49m" };
const cli=process.env.SS_TEST_PI_CLI ?? process.env.STELA_TEST_PI_CLI;

test("family identity remains independent of theme, outcome and grouping", () => {
  assert.equal(FAMILIES.code[0],"");
  assert.notEqual(action("extension_unknown",{}).family,"code");
  assert.equal(result("read",{path:"fuente"},{},[text("missing")],true).family,"files");
});

test("Pi color math: inherit panel tone, preserve amber and readable titles on both surfaces when the theme changes", {skip:!cli}, async () => {
  const ui = await import(pathToFileURL(createRequire(cli!).resolve("@earendil-works/pi-tui")).href);
  type RGB = {r:number;g:number;b:number};
  const lum = (c: RGB) => [c.r,c.g,c.b].map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  for (const mode of ["truecolor","256color"]) {
    const host = { ...theme, getColorMode:()=>mode, getBgAnsi:()=>"native panel" };
    for (const [s,l] of [[.46,.25],[.21,.91],[.35,.20]]) {
      // Change the resolved palette on the SAME host object, just like terminal palette updates.
      host.appearance = l>.5 ? "light" : "dark";
      const letter = l>.5 ? .46 : .67;
      host.colors = { toolSuccessBg:ui.okhslColor(158,s,l), accent:ui.okhslColor(295,.50,letter),
        toolOutput:ui.okhslColor(229,.06,letter), warning:ui.okhslColor(83,.88,letter), error:ui.okhslColor(20,.72,letter) };
      const p = cardPalette(host,ui), yellow = p.families.code.bg, amber = ui.colorToOkhsl(yellow);
      if (mode === "truecolor") assert.ok(amber.h>90 && amber.h<101 && Math.abs(amber.l-l)<.01 && Math.abs(amber.s-s)<.045);
      const actual = (c: unknown) => {
        if (mode==="truecolor") return ui.colorToRgb(c);
        const match = /^\x1b\[38;5;(\d+)m$/.exec(ui.foregroundAnsi(c,mode)); assert.ok(match);
        const n=Number(match[1]); assert.ok(n>=16 && n<=255);
        if (n>=232) { const v=8+10*(n-232); return {r:v,g:v,b:v}; }
        const cube=[0,95,135,175,215,255], i=n-16;
        return {r:cube[Math.floor(i/36)],g:cube[Math.floor(i/6)%6],b:cube[i%6]};
      };
      const groupRGB=actual(yellow); assert.ok(Math.min(groupRGB.r,groupRGB.g)>groupRGB.b, "group must still look yellow after quantization");
      if (mode === "256color") {
        const tone = (c: unknown) => ui.colorToOkhsl({kind:"rgb",...actual(c)}).l;
        assert.ok(Math.abs(tone(yellow)-tone(host.colors.toolSuccessBg)) < .1, "stay within one xterm shade of the native panel");
      }
      for (const [family,{fg,bg}] of Object.entries(p.families)) {
        if (bg.kind !== "indexed") assert.ok(Math.abs(ui.colorToOkhsl(bg).l-l)<.01, `${family}: not at native panel lightness`);
        for (const surface of [bg,yellow]) for (const ink of [fg,p.text,p.error,p.warning]) {
          const [a,b]=[lum(actual(ink)),lum(actual(surface))].sort((x,y)=>x-y);
          assert.ok((b+.05)/(a+.05)>=4.5,`${family}: insufficient ${mode} contrast`);
        }
      }
      assert.equal(p,cardPalette(host,ui));
    }
    for(const appearance of ["dark","light"]) {
      const t={...theme,appearance,colors:{},getColorMode:()=>mode}; // Native SGR 49: no reported surface, never sample a made-up black or white.
      const panel=ui.colorToOkhsl(cardPalette(t,ui).families.code.bg);
      assert.ok(Math.abs(panel.l-(appearance==="dark"?.25:.91))<(mode==="truecolor"?.01:.1));
    }
  }
});

test("summary uses receipts, not guesses about counts, note titles, delivery, cancellation or saving", () => {
  assert.equal(result("ss_knowledge_list",{},{status:"listed"},[text('{"notes":[]}')]).subject,"0 notas");
  assert.equal(result("ss_knowledge_list",{},{status:"busy"},[],true).subject,"");
  assert.equal(result("ss_knowledge_read",{note_id:"123"},{},[text('{"title":"Niñez"}')]).subject,"Niñez");
  assert.match(result("ss_knowledge_update",{note_id:"123"},{status:"read_required"},[],true).subject,/título no disponible/);
  assert.equal(result("ss_knowledge_create",{title:"Diseño"},{status:"created",title:"Diseño"}).notice,"Creada");
  assert.equal(result("ss_sessions_send",{to:"f".repeat(32)},{status:"accepted",peerName:"Diseño"}).subject,"→ Diseño");
  assert.equal(result("ss_sessions_send",{},{status:"accepted"}).notice,"Aceptado para entrega");
  assert.doesNotMatch(result("ss_sessions_send",{},{peerName:"f".repeat(32)}).subject,/[a-f0-9]{32}/);
  assert.equal(result("ss_tasks_delegate",{label:"Índice"},{state:"queued"}).notice,"En cola");
  assert.equal(result("ss_tasks_cancel",{},{state:"cancelled",requested:true}).notice,"Cancelación solicitada");
  assert.equal(result("ss_tasks_cancel",{},{state:"cancelled",requested:false}).notice,"Cancelada");
  assert.equal(result("ss_images_generate",{},{status:"preview"},[text("Vista 3 · PNG: /tmp/example.png")]).level,"warn");
  assert.equal(result("ss_images_save",{},{status:"already_saved", relative:"media/images/sol.png"}).notice,"Ya guardada");
  const receipt = result("ss_memory_save",{},{status:"saved"},[text('{"read_back":"unavailable","scope_changed":true,"write_paused":true}')]);
  assert.equal(receipt.level,"warn"); assert.match(receipt.notice,/Guardada.*relectura no confirmada.*Ámbito cambiado.*Escritura pausada/);
  assert.match(result("ss_memory_save",{},{status:"save_unconfirmed"},[],true).notice,/sin confirmar/);
});

test("partials, warnings and error exit codes are distinct from successful reads", () => {
  assert.equal(result("read",{path:"a"},{},[text("x\n\n[13 more lines in file. Use offset=2 to continue.]")]).level,"warn");
  assert.equal(result("read",{path:"a"},{truncation:{truncated:true}}).level,"warn");
  assert.equal(result("ss_web_read",{url:"https://example.org/#a"},{status:"ok"},[text('{"warnings":["FRAGMENT_NOT_RESOLVED: page only"]}')]).notice,"Fragmento no comprobado");
  assert.match(result("bash",{command:"false"},{truncation:{truncated:true}},[text("salida\nCommand exited with code 2")],true).notice,/Salida 2 · Parcial/);
});

test("direct groups follow adjacency in one response, not event order; expanding reveals every member", () => {
  const groups = new ReadGroups(), call = (id: string, name="read") => ({type:"toolCall", id, name});
  groups.assistant([call("a"),call("b"),call("c"),call("d"),call("e","write"),call("f")]);
  groups.assistant([call("g"), call("h")]);
  for (const id of ["d","b","a","h","f","g"]) groups.mark(id,"read",true);
  const counts=() => [..."abcdefgh"].map(id=>groups.count(id));
  assert.deepEqual(counts(),[2,0,1,1,1,1,2,0]);
  groups.mark("c","read",true); assert.deepEqual(counts().slice(0,4),[4,0,0,0]);
  groups.bind("a","read",true,()=>{}); assert.deepEqual(counts().slice(0,4),[1,1,1,1]);
  assert.deepEqual([..."abcdef"].map(id=>groups.grouped(id)),[true,true,true,true,false,false]);
  groups.reset(); assert.deepEqual(counts(),Array(8).fill(1));
});

test("batch children are matched by final IDs, not source text, preview order, shared provisional IDs or parent success", () => {
  const b = new Batches(), parent="batch";
  b.start(parent,"codemode",{code:"tools.ss_images_generate({}) /* not executed */"});
  const items=[{id:"1",name:"read",status:"ok",args:'{"path":"a"}'},{id:"2",name:"read",status:"ok",args:'{"path":"b"}'},
    {id:"3",name:"write",status:"ok",args:'{"path":"out"}'},{id:"4",name:"read",status:"error",args:'{"path":"z"}',error:"Permiso denegado"}];
  for (const i of items) b.start(i.id,i.name,JSON.parse(i.args),parent);
  for (const i of items.toReversed()) b.end(i.id,i.name,{content:[text(i.error??"raw output, do not persist")],details:{}},i.status==="error",parent);
  const facts=b.facts(parent); assert.doesNotMatch(JSON.stringify(facts),/raw output|not executed/);
  const rows=batchLines({calls:items},facts,false);
  assert.deepEqual(rows.map(r=>[r.verb,r.subject,r.level]),[["Leer","×2","ok"],["Escribir","out","ok"],["Leer","z","error"]]);
  assert.equal(rows[1].notice,"Escrito"); assert.match(rows[2].notice,/Permiso denegado/);
  b.end(parent,"codemode",{},false); assert.equal(b.facts(parent).length,0);
  assert.deepEqual(batchLines({calls:items,ssBlocks:{v:1,facts}},[],false),rows);
  assert.equal(batchLines({calls:items},facts,true).length,4);
  const old=batchLines({calls:[...Array.from({length:10},(_,n)=>({id:`old${n}`,name:"ss_knowledge_read",status:"ok",args:'{"note_id":"id"}'})), ...items.slice(-1)]},[],false);
  assert.equal(old.length,11); assert.equal(old[0].subject,"título no disponible"); assert.match(old[0].notice,/Sin detalle/); assert.equal(old.at(-1)?.level,"error");
  const running=batchLines({calls:[{id:"batch/?",name:"read",args:"{",status:"running"}]},[{...facts[0],id:"batch/?",subject:"not this one"}],false);
  assert.deepEqual([running[0].level,running[0].subject],["pending",""]);
});

test("a child's image is not proof that the script returned an image; paths alone are not images", () => {
  const b=new Batches(); b.start("p","codemode",{}); b.start("p/1","ss_images_generate",{},"p");
  b.end("p/1","ss_images_generate",{details:{status:"preview"},content:[text("Vista 2 · PNG: hidden-path"),png]},false,"p");
  const d={calls:[{id:"p/1",name:"ss_images_generate",status:"ok"}]};
  const row=batchLines(d,b.facts("p"),false,false)[0];
  assert.equal(row.subject,"vista 2"); assert.equal(row.level,"warn"); assert.match(row.notice,/Sin guardar.*no mostrada/);
  assert.doesNotMatch(JSON.stringify(b.facts("p")),/hidden-path|synthetic/);
});

test("incoming rows sanitize control bytes, preserve technical provenance on expansion, and do not use message text as a name", () => {
  const from={id:"f".repeat(32),name:"Desarrollo",cwd:"fixture",sessionId:"a"};
  const body=formatMessage({from,message:{id:"e".repeat(32),thread:"d".repeat(32),hop:0,text:'name: "Falso"\u001b[2J',expiresAt:1000}});
  const render=(kind: "sessions"|"tasks", details: object, expanded=false, content=body) => familyMessage(kind,draw)({content,details} as any,{expanded,outputPad:0} as any,theme)!.render(150).join("\n");
  assert.match(render("sessions",{from:from.id}),/💬 Recibido de\s*\n\s*Desarrollo/); // Legacy format, new card.
  assert.match(render("sessions",{from:"b".repeat(32)}),/nombre no disponible/);
  assert.doesNotMatch(render("sessions",{fromName:"Diseño\u001b[2J"}),/\u001b|[fed]{32}|Falso/);
  assert.match(render("sessions",{fromName:"Diseño"},true),/From activation: f{32}/);
  assert.match(render("tasks",{state:"failed",label:"Prueba",partialEvidence:true}),/✗ Falló · Parcial/);
  assert.match(render("tasks",{state:"completed",label:"Prueba",sourcesMayHaveChanged:true}),/! Terminado · Revisar fuentes/);
  assert.doesNotMatch(literal("texto\u001b]8;;no\u0007\u202e"),/[\u001b\u0007\u202e]/);
});

test("individuals take two lines and grouped members one, aligned without a rail; expand recovers long notices", () => {
  const examples = [
    result("ss_memory_save",{},{status:"save_unconfirmed"},[],true),
    result("ss_sessions_send",{},{status:"accepted",peerName:"Diseño editorial y documentación"}),
    result("ss_tasks_cancel",{},{requested:true,label:"Un encargo con un nombre muy largo"}),
    result("ss_web_read",{url:"https://example.org/"},{status:"partial",truncated:true}),
  ];
  for (const row of examples) for (const layout of ["individual","group"] as const) {
    const lines=paint(draw,theme,row,38,1,layout);
    assert.equal(lines.length,layout === "group" ? 1 : 2);
    assert.ok(lines.every(line=>draw.visibleWidth(line)===38 && line.startsWith(" ") && !line.startsWith("  ") && !line.includes("│")));
    assert.ok(lines.join("\n").includes(row.notice), lines.join("\n"));
  }
  const row=result("ss_memory_save",{},{status:"saved"},[text('{"read_back":"unavailable","scope_changed":true,"write_paused":true}')]);
  for (const layout of ["individual","group"] as const) {
    const visible=paint(draw,theme,row,38,1,layout).join("\n");
    assert.match(visible,/Guardada/); assert.match(visible,/no verif\./); assert.match(visible,/pausa/);
  }
  for (const cols of [1,7,22]) {
    const [line]=paint(draw,theme,row,cols,0,"group");
    assert.equal(draw.visibleWidth(line),cols); assert.match(line,/!/); assert.doesNotMatch(line,/Guardada\s*(?:…|$)/);
  }
  assert.match(paint(draw,theme,row,140,0,"group",true)[0],/Guardada · relectura no confirmada · Ámbito cambiado · Escritura pausada/);
  const note=result("ss_knowledge_read",{},{title:"Arquitectura",status:"found"});
  assert.deepEqual(paint(draw,theme,note,80,1).map(s=>s.trimEnd()),[" 📚 Leer"," Arquitectura"]);
  assert.deepEqual(paint(draw,theme,note,80,1,"group").map(s=>s.trimEnd()),[" 📚 Leer · Arquitectura"]);
});

test("registers presentation only, preserving unknown renderers and the executable surface", () => {
  let resolve: Function | undefined;
  registerBlocks({on:()=>{},registerToolRenderer: (r:Function)=>{resolve=r;}} as any,draw);
  const original={renderShell:"default"}; assert.equal(resolve!("fixture_unknown",()=>original),original);
  const renderer=resolve!("read",()=>undefined), args=Object.freeze({path:"estación"});
  const ctx={args,toolCallId:"x",state:{},isPartial:true,isError:false,expanded:false,showImages:true,outputPad:1};
  const pending=renderer.renderCall(args,theme,ctx);
  assert.deepEqual(pending.render(40).map((s:string)=>s.trim()),["📄 Leer","estación · … Pendiente"]);
  const out=Object.freeze({content:[text("detalles privados de la prueba")],details:{}});
  assert.doesNotMatch(renderer.renderResult(out,{isPartial:false},theme,{...ctx,isPartial:false}).render(40).join(""),/privados/);
  assert.match(renderer.renderResult(out,{isPartial:true},theme,{...ctx,expanded:true}).render(80).join(""),/detalles privados/);
});

test("expansion has one title before input and output, not a second native card or a repeated command", () => {
  let resolve: Function = ()=>{};
  registerBlocks({on(){},registerToolRenderer(r:Function){resolve=r;}} as any,draw);
  const native=()=>new draw.Text("SEGUNDA CABECERA",0,0);
  for (const [name,args,data,first,section,output] of [
    ["bash",{command:"printf muestra",timeout:3},[text("salida de ejemplo")],">_ Ejecutar","Comando","salida de ejemplo"],
    ["ss_memory_save",{reason:"motivo de ejemplo"},[text('{"status":"save_unconfirmed"}')],"🧠 Guardar","Entrada","save_unconfirmed"],
  ] as const) {
    const tool=resolve(name,()=>({renderCall:native,renderResult:native}));
    const ctx={args,toolCallId:"current",state:{},isPartial:false,isError:false,expanded:true,showImages:true,outputPad:1};
    const call=tool.renderCall(args,theme,ctx);
    const result=tool.renderResult({content:data,details:{}},{expanded:true,isPartial:false},theme,ctx);
    const lines=[...call.render(86),...result.render(86)].map(s=>s.trim());
    assert.ok(lines[0].startsWith(first) && lines[0].includes(name),lines.join("\n"));
    assert.ok(!lines.includes("SEGUNDA CABECERA"));
    assert.equal(lines.filter(l=>l.startsWith(first)).length,1);
    const entry=lines.indexOf(section), end=lines.findIndex(l=>l==="Salida" || l==="Resultado");
    assert.ok(entry>0 && end>entry && lines.slice(end+1).join(" ").includes(output),lines.join("\n"));
    if(name==="bash") assert.equal(lines.join("\n").split("printf muestra").length,2);
  }
});

test("expanded output uses only display evidence: exact argument previews, recorded diagnostics, safe text and image/truncation notices", () => {
  const raw='{\"id\":9007199254740993,\"id\":9007199254740995}';
  const details={fullOutputPath:"fixture/salida.txt",calls:[{id:"p/1",name:"read",args:'{\"path\":\"línea…',status:"error",durationMs:12,cost:.25,error:"fallo registrado\nsegunda línea"}],privateMarker:"NO_ES_RESULTADO"};
  const body={content:[text("Script failed\nWall time 0.1 seconds\nOutput:\n"),text(raw+"\n"+JSON.stringify(["literales: \\n", "uno\ndos"])),text("control \u001b[2J")],details};
  const children=batchLines(details,[],true,false);
  const render=(r: ReturnType<typeof expandedTool>)=>r.render(160).map(l=>l.trim()).join("\n");
  const seen=render(expandedTool(draw,theme,{name:"codemode",row:action("codemode",{}),args:{code:"text(valor)"},result:body,children,partial:false,failed:true,pad:1,grouped:()=>true}));
  for (const s of [raw,'Argumentos registrados: {"path":"línea…',"12 ms","$0.25","fallo registrado\nsegunda línea","fixture/salida.txt","uno\ndos",'literales: \\\\n',"\\u{1b}"]) assert.ok(seen.includes(s),s+"\n"+seen);
  assert.doesNotMatch(seen,/NO_ES_RESULTADO|Script failed|\u001b/u);
  const read=render(expandedTool(draw,theme,{name:"read",row:action("read",{path:"foto.png"}),args:{path:"foto.png"},result:{content:[png,text("[Use offset=7 to continue.]")],details:{imageUnsupportedByModel:"fixture-model",truncation:{truncated:true,outputLines:6,totalLines:17,truncatedBy:"lines",maxLines:6}}},partial:false,pad:1,grouped:()=>false}));
  assert.match(read,/fixture-model recibió un marcador/); assert.match(read,/6 de 17 líneas/); assert.match(read,/offset=7/);
  assert.doesNotMatch(read,/synthetic/); // Image bytes are never text; Pi owns the attachment.
});

test("real Pi: direct and nested rows, names, native permission and PNG, narrow draft, Ctrl+O and replay without execution", {skip:!cli || process.platform!=="linux", timeout:90_000},async()=>{
  const {stdout}=await promisify(execFile)("python3",["-B",fileURLToPath(new URL("./fixtures/blocks-tui.py",import.meta.url)),process.execPath,cli!],{timeout:80_000,maxBuffer:512*1024});
  assert.match(stdout,/folded\/expanded rows and session replay verified/); assert.match(stdout,/Named sender and receiver, requested list/);
});
