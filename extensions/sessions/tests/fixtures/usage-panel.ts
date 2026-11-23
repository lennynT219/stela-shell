// Presentation fixture. Counts actual Panel open/abort events, not renderer calls.
import {appendFileSync} from "node:fs";
import {HStack,truncateToWidth,matchesKey,wrapTextWithAnsi} from "@earendil-works/pi-tui";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerActivity} from "../../activity.ts";
import {registerUsageFooter} from "../../usage-footer.ts";
import {decodeQuota} from "../../codex-quota.ts";
export default function usagePanel(pi:ExtensionAPI) {
  let opened=0;
  registerUsageFooter(pi,truncateToWidth);
  registerActivity(pi,{HStack,truncateToWidth,matchesKey,wrap:wrapTextWithAnsi},()=>false,undefined,async signal=>{
    const n=++opened, file=process.env.SS_PANEL_QUOTA_TRACE!;
    appendFileSync(file,`open ${n}\n`);
    if (n===2) await new Promise<void>(resolve=>signal.addEventListener("abort",()=>{appendFileSync(file,"abort 2\n"); resolve();},{once:true}));
    return decodeQuota({rateLimits:{primary:{usedPercent:n===2?99:64,windowDurationMins:300},secondary:{usedPercent:28,windowDurationMins:10080}}});
  });
}
