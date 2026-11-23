import type { CustomEditor, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { PANEL_ICON } from "./mascot-icon.ts";

type Paint = Pick<typeof import("@earendil-works/pi-tui"), "Image" | "getCapabilities" | "getCellDimensions" | "truncateToWidth">;

/** Add only the Panel hit target. The same editor owns the draft, cursor and history in both layouts. */
export function registerPanelEditor(pi: ExtensionAPI, Base: typeof CustomEditor, draw: Paint, toggle: () => void) {
  pi.on("session_start", (_event, ctx) => {
    // Don't displace an independently installed editor; the shortcut and command remain available.
    if (ctx.mode !== "tui" || ctx.ui.getEditorComponent()) return;
    const imagesEnabled = pi.getSettings().terminal?.showImages !== false;
    ctx.ui.setEditorComponent((tui, theme, kb) => new class extends Base {
      private icon = new draw.Image(PANEL_ICON,"image/png",{fallbackColor:s=>s},{maxWidthCells:6,maxHeightCells:3},{widthPx:48,heightPx:48});
      private box?: { width:number; x:number; rows:number; inset:number };
      private pressedAt?: number;
      private cells = "";
      render(width:number) {
        this.box = undefined;
        if (width < 10) return super.render(width);
        if (imagesEnabled && draw.getCapabilities().images === "kitty" && width >= 20) {
          const dims = draw.getCellDimensions(), cells = `${dims.widthPx}:${dims.heightPx}`;
          if (cells !== this.cells) { this.cells = cells; this.icon.invalidate(); }
          const tile = this.icon.render(8), inset = 8, x = width - inset;
          const lines = [...super.render(x)];
          // Leave the actual text/cursor untouched; reserve three editor rows on the right.
          this.box = {width,x,rows:Math.max(1,tile.length),inset};
          lines[0] += ` ${tile[0]}${" ".repeat(inset-1)}`;
          return lines;
        }
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
    }(tui,theme,kb,{embedWorkingStatus:true}));
  });
}
