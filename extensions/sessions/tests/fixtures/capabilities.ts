import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

export default function fixture(pi: ExtensionAPI) {
  for (const name of ["ss_web_search", "ss_web_read", "ss_memory_read", "ss_memory_save"]) {
    pi.registerTool({ name, label: name, description: "Synthetic availability fixture", defaultActive: false,
      parameters: { type: "object", properties: {} } as never,
      async execute() {
        appendFileSync(process.env.SS_PANEL_QUOTA_TRACE!, "unexpected tool execution\n");
        throw Error("Browsing capacities must not execute a tool");
      },
    });
  }
  pi.on("session_start", (_event, ctx) => {
    pi.setActiveTools(["read", "ss_web_search", "ss_web_read", "ss_memory_read"]);
    ctx.ui.onTerminalInput(data => {
      // Fixture-only input, even while the Panel owns keyboard focus.
      if (data !== "\x1b[21~") return;
      pi.setActiveTools(["read", "ss_web_search", "ss_memory_read", "ss_memory_save"]);
      ctx.ui.setStatus("fixture-loadout", "updated");
      return {consume:true};
    });
  });
}
