// Test-only event witness in the disposable PTY workspace. No messages, prompts or tool results.
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function witness(pi: ExtensionAPI) {
  const note = (value: unknown) => appendFileSync(`${process.env.SS_FIXTURE_SCREEN}.events`, JSON.stringify(value) + "\n");
  pi.on("agent_start", () => note({ type: "start" }));
  pi.on("agent_end", () => note({ type: "end" }));
  pi.on("tool_execution_end", e => note({ type: "tool", error: e.isError }));
  pi.on("agent_settled", e => note({ type: "settled", aborted: e.aborted }));
}
