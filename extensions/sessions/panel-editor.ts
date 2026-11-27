import type { CustomEditor, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { EditorCaption } from "./usage-footer.ts";
import { FLOAT_FRAMES } from "./mascot-icon.ts";

// Linger at the ends of the float. Only one trough in two includes a short blink.
const FLOAT: readonly [frame:number, holdMs:number][] = [
  [2,200], [1,260], [0,520], [1,260], [2,200], [3,260], [4,520], [3,260],
  [2,200], [1,260], [0,520], [1,260], [2,200], [3,260], [4,180], [5,140], [4,200], [3,260],
];

type Paint = Pick<typeof import("@earendil-works/pi-tui"), "Image" | "getCapabilities" | "getCellDimensions" | "colorToOkhsl" | "okhslColor" | "backgroundAnsi" | "stripTerminalSequences" | "visibleWidth" | "CURSOR_MARKER" | "renderFakeCursor">;

type EditorHost = TUI & { getFocusedComponent?(): Component | null; hasActiveSelection?(): boolean };

// Adopt the lightness of Pi's neutral panel, not the accent or the mascot's colors. Theme.colors
// changes with the palette, including late terminal replies. Never send a second color query.
const surfaces = new WeakMap<Theme["colors"], string>();
function surfaceInk(theme: Theme, draw: Paint) {
  const colors = theme.colors;
  let ink = surfaces.get(colors);
  if (ink === undefined) {
    const mode = theme.getColorMode();
    const l = theme.getBgAnsi("toolPendingBg") === "\x1b[49m" ? (theme.appearance === "light" ? .92 : .244) : draw.colorToOkhsl(colors.toolPendingBg).l;
    // In indexed color a slightly bluish gray can round up to a much brighter color cube entry.
    const bg = draw.okhslColor(273, mode === "256color" ? 0 : theme.appearance === "light" ? .08 : .14, l);
    ink = draw.backgroundAnsi(bg, mode);
    surfaces.set(colors, ink);
  }
  return ink;
}

const SPRITE_COLUMNS = 8; // Six Kitty cells with one cell of margin on each side.
const PANEL_LABEL = " [Panel] ";
type Control = { graphic: boolean; rows: number; cells: string };
type Hit = { x: number; y: number; rows: number };
type Layout = { width: number; hit?: Hit; draftY: number; count: number; menuY: number; nativeHeight: number };

// The margins belong to the text, not to the sprite. Reserve a second row on BOTH sides
// only if the native last line can't safely share the corner. Never rewrap or clip the draft.
function draftSurface(body: string[], width: number, control: Control | undefined,
  safeImageRow: (line: string) => boolean, selecting: boolean) {
  const gutter = PANEL_LABEL.length, blank = " ".repeat(width), last = body[body.length - 1];
  const graphic = control?.graphic, rows = control?.rows ?? 0, spill = graphic && rows > 1 ? 1 : 0;
  const room = last?.endsWith(" ".repeat(gutter));
  const pad = graphic && (!room || !safeImageRow(last)) ? Math.max(1, rows - spill) : 1;
  const lines = [...Array<string>(pad).fill(blank), ...body, ...Array<string>(pad + spill).fill(blank)];
  let hit: Hit | undefined;
  if (control) {
    const y = graphic ? lines.length - rows : pad + body.length - (room ? 1 : 0);
    // Pi does not highlight a selection on a Kitty anchor line. Yield that line while
    // selecting or showing an overlay, keeping the exact text, cursor and row positions.
    if (!(graphic && selecting && y < pad + body.length)) {
      lines[y] = lines[y].slice(0, -gutter) + control.cells;
      hit = { x: width - gutter, y, rows };
    }
  }
  return { lines, hit, pad, spill };
}

/** Add only the Panel hit target. The same editor owns the draft, cursor and history in both layouts. */
export function registerPanelEditor(pi: ExtensionAPI, Base: typeof CustomEditor, draw: Paint, toggle: () => void, caption?: EditorCaption) {
  let stop: (() => void) | undefined;
  pi.on("session_shutdown", () => { stop?.(); stop = undefined; });
  pi.on("session_start", (_event, ctx) => {
    // Don't displace an independently installed editor; the shortcut and command remain available.
    if (ctx.mode !== "tui" || ctx.ui.getEditorComponent()) return;
    const imagesEnabled = pi.getSettings().terminal?.showImages !== false;
    const useSurface = !process.env.NO_COLOR && process.env.TERM !== "dumb";
    ctx.ui.setEditorComponent((tui: EditorHost, theme, kb) => {
      stop?.();
      let live = true, step = 0, timer: ReturnType<typeof setTimeout> | undefined;
      const pause = () => { clearTimeout(timer); timer = undefined; };
      stop = () => { live = false; pause(); };
      const [cursorOpen, cursorClose] = draw.renderFakeCursor("\0").split("\0");
      // Image lines bypass Pi's terminal normalization. Keep tabs, Thai/Lao AM and
      // any non-editor control sequence on an ordinary text line.
      const safeImageRow = (line: string) => !/[\p{Cc}\u0e33\u0eb3]/u.test(
        line.replace(draw.CURSOR_MARKER, "").replace(cursorOpen, "").replace(cursorClose, ""));
      const editor = new class extends Base {
        private icons = FLOAT_FRAMES.map(png => new draw.Image(png,"image/png",{fallbackColor:s=>s},{maxWidthCells:6,maxHeightCells:3}));
        private nextFrame() {
          if (!live || tui.getFocusedComponent?.() !== this) { pause(); return; }
          if (timer !== undefined) return;
          timer = setTimeout(() => {
            timer = undefined;
            if (!live || tui.getFocusedComponent?.() !== this) return;
            step = (step + 1) % FLOAT.length;
            tui.requestRender();
          }, FLOAT[step][1]);
          timer.unref();
        }
        private layout?: Layout;
        private pressedAt?: Hit;
        private bottom = "";
        protected renderBottomBorder(width:number, hidden:number) {
          this.bottom = super.renderBottomBorder(width, hidden);
          // In Editor.render every draft row is padded, even when empty. This placeholder
          // marks the native border before any completions; never match user-typed dashes.
          return "";
        }
        private nativeRows(width:number) {
          // Pi paints the two rules with borderColor, separately from the working indicator,
          // draft and completions. Blank only the strokes here; retain any row with actual status.
          const color = this.borderColor;
          this.borderColor = text => color(text.replaceAll("─", " "));
          try { return [...super.render(width)]; }
          finally { this.borderColor = color; }
        }
        private cells = "";
        render(width:number) {
          this.layout = undefined;
          const native = this.nativeRows(width), border = native.indexOf("", 1);
          const usage = caption?.line(this, width);
          if (border < 0) { pause(); return usage === undefined ? native : [...native, usage]; }
          const visible = (line: string) => !!draw.stripTerminalSequences(line).trim();
          const head = visible(native[0]) ? [native[0]] : [], tail = visible(this.bottom) ? [this.bottom] : [];
          const draft = native.slice(1, border), menu = native.slice(border + 1);
          const ink = useSurface ? surfaceInk(ctx.ui.theme, draw) : "";
          let control: Control | undefined;
          if (imagesEnabled && width >= 20 && draw.getCapabilities().images === "kitty") {
            const dims = draw.getCellDimensions(), cells = `${dims.widthPx}:${dims.heightPx}`;
            if (cells !== this.cells) { this.cells = cells; for (const icon of this.icons) icon.invalidate(); }
            this.nextFrame();
            const tile = this.icons[FLOAT[step][0]].render(SPRITE_COLUMNS);
            control = { graphic: true, rows: tile.length, cells: "  " + tile[0] + " ".repeat(SPRITE_COLUMNS - 1) };
          } else {
            pause();
            if (width >= 10) control = { graphic: false, rows: 1, cells: ctx.ui.theme.fg("accent", PANEL_LABEL) };
          }
          const surface = draftSurface(draft, width, control, safeImageRow, !!tui.hasActiveSelection?.() || tui.hasOverlay());
          const body = surface.lines.map((line, i) => ink && i < surface.lines.length - surface.spill ? `${ink}${line}\x1b[49m` : line);
          let below: string[] = [];
          if (usage !== undefined) {
            // Same full-width footer string; don't truncate it again to make the mascot fit.
            if (surface.spill && !tail.length && !menu.length && draw.visibleWidth(usage) <= width - PANEL_LABEL.length)
              body[body.length - 1] = usage;
            else below = [usage];
          }
          this.layout = { width, hit: surface.hit && { ...surface.hit, y: head.length + surface.hit.y },
            draftY: head.length + surface.pad, count: draft.length, menuY: head.length + body.length + tail.length, nativeHeight: native.length };
          return [...head, ...body, ...tail, ...menu, ...below];
        }
        handleMouse(e:TuiMouseEvent) {
          const layout = this.layout, press = this.pressedAt;
          if (e.type === "press" || e.type === "click") this.pressedAt = undefined;
          if (!layout || layout.width !== e.width) return super.handleMouse(e);
          const { hit, draftY, count, menuY, nativeHeight } = layout;
          if (hit && e.button === "left" && e.x >= hit.x && e.x < layout.width && e.y >= hit.y && e.y < hit.y + hit.rows) {
            if (e.type === "press") this.pressedAt = hit;
            if (e.type === "click" && press?.x === hit.x && press.y === hit.y && press.rows === hit.rows) toggle();
            return { handled: true };
          }
          // Pi expects a top rule before the draft and two rules before the suggestion list.
          const y = e.y >= menuY ? count + 2 + e.y - menuY : e.y - draftY + 1;
          if ((e.y >= draftY && e.y < draftY + count) || (e.y >= menuY && y < nativeHeight))
            return super.handleMouse({ ...e, y, height: nativeHeight });
          return e.type === "click" && e.button === "left" ? { handled: true, focus: true } : undefined;
        }
      }(tui,theme,kb,{embedWorkingStatus:true});
      caption?.attach(editor, () => imagesEnabled && draw.getCapabilities().images === "kitty" && !tui.hasOverlay() && !editor.isShowingAutocomplete());
      return editor;
    });
  });
}
