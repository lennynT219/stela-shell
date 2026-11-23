import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Color, OkhslChannels } from "@earendil-works/pi-tui";
import { FAMILIES, type Family } from "./families.ts";

export type ColorTools = Pick<typeof import("@earendil-works/pi-tui"), "colorToOkhsl" | "okhslColor" | "colorToRgb" | "foregroundAnsi">;
interface CardPalette {
  families: Record<Family, { fg: Color; bg: Color }>;
  text: Color; warning: Color; error: Color;
}
// Pi replaces theme.colors on a theme or terminal-palette change. Do not cache ANSI strings by theme name.
const cache = new WeakMap<Theme["colors"], CardPalette>();

/** Keep the family's hue; use the lightness and saturation of Pi's tool panel, not a brand swatch. */
export function cardPalette(theme: Theme, ui: ColorTools): CardPalette {
  const colors = theme.colors;
  const previous = cache.get(colors);
  if (previous) return previous;
  const light = theme.appearance === "light", mode = theme.getColorMode();
  // SGR 49 means the terminal's own background, not a known RGB panel. Use the tonal bands of Pi's
  // bundled light/dark themes in that case. In particular don't turn an unknown background into black or white.
  const unspecified = theme.getBgAnsi("toolSuccessBg") === "\x1b[49m";
  const panel = unspecified ? (light ? {s:.21,l:.91} : {s:.46,l:.25}) : ui.colorToOkhsl(colors.toolSuccessBg);
  const accent = unspecified ? (light ? {s:.60,l:.46} : {s:.50,l:.67}) : ui.colorToOkhsl(colors.accent);
  const roles = Object.keys(FAMILIES) as Family[];
  const chroma = (f: Family) => f === "files" ? .55 : f === "other" ? .12 : 1;
  // Even a neutral tool panel keeps a slight family tint; don't increase chroma just to fill the terminal.
  const strength = Math.max(.12,panel.s);
  const surfaces = Object.fromEntries(roles.map(f => [f,ui.okhslColor(FAMILIES[f][1],strength*chroma(f),panel.l)])) as Record<Family, Color>;

  // Adjust lettering only when necessary, without brightening the panels. In indexed mode measure Pi's
  // actual quantized xterm color (not the requested RGB). A terminal can still redefine its palette.
  const displayed = (c: Color) => {
    const index = mode === "256color" ? /^\x1b\[38;5;(\d+)m$/.exec(ui.foregroundAnsi(c,mode)) : null;
    return ui.colorToRgb(index ? {kind:"indexed",index:Number(index[1])} : c);
  };
  if (mode === "256color") {
    const {r,g,b} = displayed(surfaces.code);
    if (Math.min(r,g) <= b) {
      // Pale amber can round to gray or pink. Pick a muted olive/cream near Pi's *displayed* panel tone.
      const native = unspecified ? ui.okhslColor(158,panel.s,panel.l) : colors.toolSuccessBg;
      const target = ui.colorToOkhsl({kind:"rgb",...displayed(native)}).l;
      const distance = (index: number) => {
        return Math.abs(ui.colorToOkhsl({kind:"indexed",index}).l-target);
      };
      surfaces.code = {kind:"indexed",index:[58,101,144,187,230].reduce((a,b) => distance(a)<=distance(b)?a:b)};
    }
  }
  const luminance = (c: Color) => {
    const {r,g,b} = displayed(c);
    const linear = (v: number) => { const n = v/255; return n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4; };
    return .2126*linear(r) + .7152*linear(g) + .0722*linear(b);
  };
  const bases = Object.fromEntries(roles.map(f => [f,luminance(surfaces[f])])) as Record<Family,number>;
  const readable = (seed: OkhslChannels, on: number[]) => {
    let {h,s,l} = seed;
    // Choose the better endpoint even for a custom theme with a middle-gray panel.
    const end = (1.05/(Math.max(...on)+.05) >= (Math.min(...on)+.05)/.05) ? 1 : 0;
    for (;;) {
      const color = ui.okhslColor(h,s,l), ink = luminance(color);
      if (l === end || on.every(bg => (Math.max(ink,bg)+.05)/(Math.min(ink,bg)+.05) >= 4.5)) return color;
      l = end === 1 ? Math.min(1,l+.015) : Math.max(0,l-.015);
    }
  };
  const families = Object.fromEntries(roles.map(f => [f,{
    bg: surfaces[f], fg: readable({...accent,h:FAMILIES[f][1],s:accent.s*chroma(f)},[bases[f],bases.code]),
  }])) as CardPalette["families"];
  const all = Object.values(bases);
  const ink = (token: "toolOutput" | "warning" | "error", fallback: OkhslChannels) => readable(unspecified ? fallback : ui.colorToOkhsl(colors[token]),all);
  const result = { families, text: ink("toolOutput",{h:229,s:.06,l:accent.l}),
    warning: ink("warning",{h:83,s:.85,l:accent.l}), error: ink("error",{h:20,s:.72,l:accent.l}) };
  cache.set(colors,result);
  return result;
}
