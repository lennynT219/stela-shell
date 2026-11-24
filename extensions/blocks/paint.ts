import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Color, Component } from "@earendil-works/pi-tui";
import { FAMILIES, type Line } from "./families.ts";
import { cardPalette, type ColorTools } from "./palette.ts";

export interface Drawing extends ColorTools {
  visibleWidth(text: string): number;
  truncateToWidth(text: string, width: number, ellipsis?: string): string;
  wrapTextWithAnsi(text: string, width: number): string[];
  getCapabilities?(): { images: string | null };
  highlightCode?(code: string, language?: string): string[];
  getLanguageFromPath?(path: string): string | undefined;
}
export const empty: Component = { render: () => [], invalidate() {} };
export type CardLayout = "individual" | "group";
const SEP = " · ";
// Short forms of display labels only. Never truncate an outcome into its opposite (e.g. “Guardada” alone).
const brief = new Map(Object.entries({
  "Guardado sin confirmar": "Sin confirmar", "relectura no confirmada": "no verif.",
  "Ámbito cambiado": "ámb. camb.", "Escritura pausada": "pausa", "Aceptado para entrega": "Para entrega",
  "Cancelación solicitada": "Cancel. solicitada", "Cancelación en curso": "Cancel. en curso",
  "Sin detalle del resultado": "Sin detalle", "Resultado no confirmado": "Sin confirmar",
}));

/** Folded content has two lines per card or one per group member. Only expansion can wrap. */
export function paint(draw: Drawing, theme: Theme, row: Line, width: number, pad = 0, layout: CardLayout = "individual", expanded = false): string[] {
  if (width < 1) return [];
  const palette = cardPalette(theme,draw);
  const { fg } = palette.families[row.family], [icon] = FAMILIES[row.family];
  const bg = palette.families[layout === "group" ? "code" : row.family].bg;
  const inset = " ".repeat(Math.min(4, Math.max(0,pad), Math.floor(width/12)));
  const room = width - inset.length, size = draw.visibleWidth;
  const clip = (s: string, n: number) => n > 0 ? draw.truncateToWidth(s,n,"…") : "";
  const frame = (s: string) => {
    const line = clip(s,room);
    return theme.style(inset + line + " ".repeat(Math.max(0,room-size(line))), { bg });
  };
  const title = [icon,row.verb].filter(Boolean).join(" ");
  const join = row.verb.endsWith(" de") || /^[→×]/u.test(row.subject) ? " " : SEP;
  const mark = row.level === "error" ? "✗" : row.level === "warn" ? "!" : row.level === "pending" ? "…" : "";
  const marked = (s: string) => [mark,s].filter(Boolean).join(" ");
  const notice = marked(row.notice);
  const statusInk = row.level === "error" ? palette.error : row.level === "warn" ? palette.warning : palette.text;
  const compose = (heading: string, subject: string, status: string) => [
    heading && theme.style(heading,{ fg, bold: true }),
    subject && theme.style((heading ? join : "") + subject,{ fg: palette.text }),
    status && ((heading || subject ? theme.style(SEP,{ fg: palette.text }) : "") + theme.style(status,{ fg: statusInk })),
  ].join("");
  const single = layout === "individual";
  const heading = single ? "" : title;
  const details = row.subject || (!heading && !notice ? "Sin detalle" : "");
  const full = compose(heading,details,notice);
  const top = single ? [frame(compose(title,"",""))] : [];
  if (size(full) <= room) return [...top,frame(full)];
  if (expanded) return [...top,...draw.wrapTextWithAnsi(full,room).map(frame)];
  // Keep Codemode and its count together at narrow widths, without hiding failure/warning text.
  if (row.family === "code" && notice) return [frame(compose(title,details,"")),frame(compose("","",notice))];
  if (!notice) return [...top,frame(full)];

  // In a cramped individual card the path/name can share the title line, leaving the whole second line for status.
  if (single && details) top[0] = frame(compose(title,details,""));
  let label = heading;
  const parts = row.notice.split(SEP);
  const candidates = [notice, marked(parts.map(part => brief.get(part) ?? part).join("/"))];
  if (row.family === "memory" && ["Guardada","Sin cambios"].includes(parts[0]) && parts.includes("relectura no confirmada") && parts.length > 2) {
    // Retain the receipt AND its missing verification; the ellipsis points to other details on expansion.
    candidates.push(marked(`${parts[0]} no verif.${parts.includes("Escritura pausada") ? "/pausa" : ""}…`));
  }
  if (parts.length > 1 && parts.includes("Escritura pausada")) candidates.push(marked("Escritura pausada…"));
  const fits = (head: string, status: string) => size(head) + (head ? SEP.length : 0) + size(status) <= room;
  // Prefer a complete notice (long or short form) over preserving every letter of the action name.
  let status = candidates.slice(0,2).find(s => fits(label,s)) ?? candidates.find(s => fits(label ? "…" : "",s));
  if (!status) {
    const hint = row.level === "error" ? "Ver error" : row.level === "warn" ? "Ver aviso" : row.level === "pending" ? "En curso" : "Ver resultado";
    status = size(marked(hint)) <= room ? marked(hint) : mark || "…";
  }
  const titleRoom = room - size(status) - SEP.length;
  if (size(label) > titleRoom) label = label && size(row.verb) <= titleRoom ? row.verb : clip(label,titleRoom);
  const spare = room - size(label) - (label ? size(join) : 0) - SEP.length - size(status);
  const subject = !single && spare >= 2 ? clip(details,spare) : "";
  return [...top,frame(compose(label,subject,status))];
}
/** Like a sent message in Pi: one painted row at either edge of a visible card, not of each member. */
export function padCard(theme: Theme, bg: Color, width: number, lines: string[]): string[] {
  if (width < 1 || !lines.length) return lines;
  const edge = theme.style(" ".repeat(width), { bg });
  return [edge, ...lines, edge];
}

export function paintCard(draw: Drawing, theme: Theme, rows: readonly Line[], width: number, pad: number,
  layout: CardLayout = "individual", expanded = false): string[] {
  if (width < 1 || !rows.length) return [];
  const bg = cardPalette(theme,draw).families[layout === "group" ? "code" : rows[0].family].bg;
  return padCard(theme,bg,width,rows.flatMap(row => paint(draw,theme,row,width,pad,layout,expanded)));
}

export const lineBlock = (draw: Drawing, theme: Theme, row: Line, pad = 0, expanded = false): Component => ({ render: w => paintCard(draw,theme,[row],w,pad,"individual",expanded), invalidate() {} });
// Bidi/control bytes in persisted messages/results are not terminal instructions. Keep paragraph structure in expanded text.
export function literal(s: string) { return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu,c => [...c].map(k => `\\u{${k.codePointAt(0)!.toString(16)}}`).join("")); }
