import type { CustomEditor, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { FLOAT_FRAMES } from "./mascot-icon.ts";

// Linger at the ends of the float. Only one trough in two includes a short blink.
const FLOAT: readonly [frame:number, holdMs:number][] = [
  [2,200], [1,260], [0,520], [1,260], [2,200], [3,260], [4,520], [3,260],
  [2,200], [1,260], [0,520], [1,260], [2,200], [3,260], [4,180], [5,140], [4,200], [3,260],
];

type Paint = Pick<typeof import("@earendil-works/pi-tui"), "Image" | "getCapabilities" | "getCellDimensions" | "truncateToWidth">;

/** Add only the Panel hit target. The same editor owns the draft, cursor and history in both layouts. */
export function registerPanelEditor(pi: ExtensionAPI, Base: typeof CustomEditor, draw: Paint, toggle: () => void) {
  let stop: (() => void) | undefined;
  pi.on("session_shutdown", () => { stop?.(); stop = undefined; });
  pi.on("session_start", (_event, ctx) => {
    // Don't displace an independently installed editor; the shortcut and command remain available.
    if (ctx.mode !== "tui" || ctx.ui.getEditorComponent()) return;
    const imagesEnabled = pi.getSettings().terminal?.showImages !== false;
    ctx.ui.setEditorComponent((tui, theme, kb) => {
      stop?.();
      let live = true, step = 0, timer: ReturnType<typeof setTimeout> | undefined;
      const pause = () => { clearTimeout(timer); timer = undefined; };
      stop = () => { live = false; pause(); };
      return new class extends Base {
        private icons = FLOAT_FRAMES.map(png => new draw.Image(png,"image/png",{fallbackColor:s=>s},{maxWidthCells:6,maxHeightCells:3},{widthPx:52,heightPx:52}));
        private nextFrame() {
          if (!live || tui.getFocusedComponent() !== this) { pause(); return; }
          if (timer !== undefined) return;
          timer = setTimeout(() => {
            timer = undefined;
            if (!live || tui.getFocusedComponent() !== this) return;
            step = (step + 1) % FLOAT.length;
            tui.requestRender();
          }, FLOAT[step][1]);
          timer.unref();
        }
        private box?: { width:number; x:number; rows:number; inset:number };
        private pressedAt?: number;
        private cells = "";
        render(width:number) {
          this.box = undefined;
          if (width < 10) { pause(); return super.render(width); }
          if (imagesEnabled && draw.getCapabilities().images === "kitty" && width >= 20) {
            const dims = draw.getCellDimensions(), cells = `${dims.widthPx}:${dims.heightPx}`;
            if (cells !== this.cells) { this.cells = cells; for (const icon of this.icons) icon.invalidate(); }
            this.nextFrame();
            const tile = this.icons[FLOAT[step][0]].render(8), inset = 8, x = width - inset;
            const lines = [...super.render(x)];
            // Leave the actual text/cursor untouched; reserve three editor rows on the right.
            this.box = {width,x,rows:Math.max(1,tile.length),inset};
            lines[0] += ` ${tile[0]}${" ".repeat(inset-1)}`;
            return lines;
          }
          pause();
          const lines = [...super.render(width)], x = width-10;
          lines[0] = draw.truncateToWidth(lines[0],x,"") + ctx.ui.theme.fg("accent"," [Panel] ") + this.borderColor("─");
          this.box = {width,x,rows:1,inset:0};
          return lines;
        }
        handleMouse(e:TuiMouseEvent) {
          const box = this.box;
          if (box && box.width === e.width && e.x >= box.x && e.y >= 0 && e.y < box.rows && e.button === "left") {
            if (e.type === "press") this.pressedAt = e.width;
            else if (e.type === "click") { const same = this.pressedAt === e.width; this.pressedAt = undefined; if (same) toggle(); }
            return {handled:true};
          }
          if (e.type === "press" || e.type === "click") this.pressedAt = undefined;
          return super.handleMouse(box?.inset ? {...e,width:e.width-box.inset} : e);
        }
      }(tui,theme,kb,{embedWorkingStatus:true});
    });
  });
}
