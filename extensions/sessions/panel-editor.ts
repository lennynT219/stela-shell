import type { CustomEditor, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { EditorCaption } from "./usage-footer.ts";
import { FLOAT_BANDS, FLOAT_FRAMES } from "./mascot-icon.ts";

import { GESTURE_ART } from "./mascot-gesture-art.ts";
import { mascotMotion, registerMascotRuns, type Pose } from "./mascot-motion.ts";

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

const COMPACT_COLS = 6, LARGE_COLS = 8, LARGE_ROWS = 4;
const PANEL_LABEL = " [Panel] ";
// Both sizes stay inside the same nine-column slot, one column in from the right edge.
function stamp(mark: string, cols: number) {
  const left = LARGE_COLS - cols;
  return " ".repeat(left) + mark + " ".repeat(PANEL_LABEL.length - left);
}
type Tile = { rows: number; cells: string; bands?: () => string[] };
type Control = Tile & { graphic: boolean; large?: Tile };
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
  let hit: Hit | undefined, bandOnSpill = false;
  if (control) {
    let tile: Tile = control, y = graphic ? lines.length - rows : pad + body.length - (room ? 1 : 0);
    const large = control.large;
    if (large) {
      // Grow UP into existing rows, never by adding padding or moving the footer. Every
      // covered row must have room, not just the one holding the placement or the cursor.
      const top = lines.length - large.rows;
      if (top >= 0 && (large.rows > 1) === !!spill && lines.slice(top).every((s, i) =>
        s.endsWith(" ".repeat(gutter)) && ((!large.bands && i > 0) || safeImageRow(s)))) {
        tile = large; y = top;
      }
    }
    // Image anchors bypass Pi's selection highlighting. Yield without changing any row positions.
    if (!(graphic && selecting && y < pad + body.length)) {
      const marks = tile.bands?.() ?? [tile.cells];
      marks.forEach((mark, i) => { lines[y + i] = lines[y + i].slice(0, -gutter) + mark; });
      bandOnSpill = !!(spill && tile.bands);
      hit = { x: width - gutter, y, rows: tile.rows };
    }
  }
  return { lines, hit, pad, spill, bandOnSpill };
}

/** Add only the Panel hit target. The same editor owns the draft, cursor and history in both layouts. */
export function registerPanelEditor(pi: ExtensionAPI, Base: typeof CustomEditor, draw: Paint, toggle: () => void,
  caption?: EditorCaption, peerNeedsAnswer: () => boolean = () => false) {
  let stop: (() => void) | undefined, repaint: (() => void) | undefined;
  const run = registerMascotRuns(pi, () => repaint?.());
  pi.on("session_shutdown", () => { stop?.(); stop = undefined; });
  pi.on("session_start", (_event, ctx) => {
    // Don't displace an independently installed editor; the shortcut and command remain available.
    if (ctx.mode !== "tui" || ctx.ui.getEditorComponent()) return;
    const imagesEnabled = pi.getSettings().terminal?.showImages !== false;
    const useSurface = !process.env.NO_COLOR && process.env.TERM !== "dumb";
    ctx.ui.setEditorComponent((tui: EditorHost, theme, kb) => {
      stop?.();
      let live = true, until: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const pause = () => { clearTimeout(timer); timer = undefined; until = undefined; };
      repaint = () => { if (live) tui.requestRender(); };
      stop = () => { live = false; pause(); repaint = undefined; };
      const [cursorOpen, cursorClose] = draw.renderFakeCursor("\0").split("\0");
      // Image lines bypass Pi's terminal normalization. Keep tabs, Thai/Lao AM and
      // any non-editor control sequence on an ordinary text line.
      const safeImageRow = (line: string) => !/[\p{Cc}\u0e33\u0eb3]/u.test(
        line.replace(draw.CURSOR_MARKER, "").replace(cursorOpen, "").replace(cursorClose, ""));
      const icon = (png: string, cols: number, rows: number) => new draw.Image(png, "image/png", { fallbackColor: s => s }, { maxWidthCells: cols, maxHeightCells: rows });
      type Images = { compact: ReturnType<typeof icon>; large: ReturnType<typeof icon>; strips?: ReturnType<typeof icon>[] };
      const editor = new class extends Base {
        private motion = mascotMotion();
        private shown: Pose = "sleep";
        private art = new Map<Pose, Images>();
        private tile(frame: Pose) {
          let tile = this.art.get(frame);
          if (!tile) {
            const png = typeof frame === "number" ? FLOAT_FRAMES[frame] : GESTURE_ART[frame][0];
            tile = { compact: icon(png, COMPACT_COLS, 3), large: icon(png, LARGE_COLS, LARGE_ROWS) };
            this.art.set(frame, tile);
          }
          return tile;
        }
        private bandMarks(frame: Pose, tile: Images) {
          tile.strips ??= (typeof frame === "number" ? FLOAT_BANDS[frame] : GESTURE_ART[frame].slice(1)).map(png => icon(png, LARGE_COLS, 1));
          return tile.strips.map(part => stamp(part.render(LARGE_COLS + 2)[0], LARGE_COLS));
        }
        private nextFrame() {
          if (!live || tui.getFocusedComponent?.() !== this) { pause(); return this.shown; }
          const { pose, next } = this.motion.frame(run, peerNeedsAnswer());
          if (next !== until) {
            pause();
            if (next !== undefined) {
              until = next;
              timer = setTimeout(() => {
                timer = undefined; until = undefined;
                if (live && tui.getFocusedComponent?.() === this) tui.requestRender();
              }, Math.max(1, Math.ceil(next - performance.now())));
              timer.unref();
            }
          }
          return this.shown = pose;
        }
        private editing = false;
        private observeDraft(typed: boolean) {
          if (!live || !imagesEnabled) return;
          const pos = this.getCursor();
          this.motion.draft(pos.col > 0 || pos.line > 0 || this.getText().length > 0, typed);
        }
        handleInput(data: string) {
          this.editing = true;
          try { super.handleInput(data); } // Pi handles shortcuts, paste, submission and editing without interception.
          finally { this.editing = false; this.observeDraft(true); }
        }
        setText(text: string) { super.setText(text); if (!this.editing) this.observeDraft(false); }
        insertTextAtCursor(text: string) { super.insertTextAtCursor(text); if (!this.editing) this.observeDraft(false); }
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
            if (cells !== this.cells) {
              this.cells = cells;
              for (const { compact, large, strips } of this.art.values()) {
                compact.invalidate(); large.invalidate(); strips?.forEach(part => part.invalidate());
              }
            }
            const frame = this.nextFrame(), tile = this.tile(frame);
            // Pi's Image.render reserves two columns from the supplied width.
            const small = tile.compact.render(COMPACT_COLS + 2), big = tile.large.render(LARGE_COLS + 2);
            control = { graphic: true, rows: small.length, cells: stamp(small[0], COMPACT_COLS) };
            const regular = tui.mode === "regular";
            // Regular Pi writes top-to-bottom; a later text row can erase a multi-row Kitty
            // placement. Draw independent one-row slices there, never over a sibling component.
            if (!regular || (big.length === LARGE_ROWS && (usage === undefined || safeImageRow(draw.stripTerminalSequences(usage)))))
              control.large = { rows: big.length, cells: stamp(big[0], LARGE_COLS), bands: regular ? () => this.bandMarks(frame, tile) : undefined };
          } else {
            pause();
            if (width >= 10) control = { graphic: false, rows: 1, cells: ctx.ui.theme.fg("accent", PANEL_LABEL) };
          }
          const surface = draftSurface(draft, width, control, safeImageRow, !!tui.hasActiveSelection?.() || tui.hasOverlay());
          const body = surface.lines.map((line, i) => ink && i < surface.lines.length - surface.spill ? `${ink}${line}\x1b[49m` : line);
          let below: string[] = [];
          if (usage !== undefined) {
            // Same full-width footer string; don't truncate it again to make the mascot fit.
            const n = draw.visibleWidth(usage);
            if (surface.spill && !tail.length && !menu.length && n <= width - PANEL_LABEL.length) {
              const end = body.length - 1;
              body[end] = surface.bandOnSpill ? usage + body[end].slice(n) : usage;
            } else below = [usage];
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
