import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function faroMethod(pi: ExtensionAPI) {
  const methodUrl = new URL("./assets/method.md", import.meta.url);
  const method = readFileSync(methodUrl, "utf8").trim();

  if (method.length === 0) {
    throw new Error("FARO method file is empty");
  }

  pi.on("before_agent_start", (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${method}`,
    };
  });
}
