import type { ToolDefinition, MessageRenderer } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/** The host supplies Text; standalone contract tests need no installed Pi packages. */
export type MakeText = (content: string) => Component;

function displayText(content: string): string {
  return content.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => character.split("").map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""));
}

/** Short title only replaces presentation; arguments, results and permissions stay intact. */
export function callRenderer(name: string, label: string, makeText?: MakeText): ToolDefinition["renderCall"] {
  if (!makeText) return undefined;
  return (args, theme, context) => {
    const title = theme.fg("toolTitle", theme.bold(label));
    const identity = context.expanded ? ` ${theme.fg("dim", name)}` : "";
    const argumentsText = JSON.stringify(args ?? {}, null, 2);
    return makeText(title + identity + (argumentsText !== "{}" ? `\n${theme.fg("muted", displayText(argumentsText))}` : ""));
  };
}

/** Persisted custom types remain compatible while their visible headings become short. */
export function messageRenderer(label: string, makeText: MakeText): MessageRenderer {
  return (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : message.content
      .filter((part) => part.type === "text").map((part) => part.text).join("\n");
    return makeText(`${theme.fg("accent", theme.bold(label))}\n${displayText(content)}`);
  };
}
