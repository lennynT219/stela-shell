// Loaded AFTER the sessions extension in isolated deterministic Pi fixtures only.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function lateCommit(pi: ExtensionAPI) {
  const action = process.env.SS_SESSION_FIXTURE_ACTION;
  if (process.env.SS_SESSION_FIXTURE_ROLE !== "receiver" || !["work-late-live", "work-late-expired", "work-late-ordinary"].includes(action ?? "")) return;
  let advanced = false;
  pi.on("turn_end", async (event) => {
    if (advanced || event.outcome !== "completed" || !event.entries.some((entry) => entry.type === "custom_message" && entry.customType === "stela-peer-message")) return;
    advanced = true;
    const proposal = event.entries.find((entry) => entry.type === "custom_message" && entry.customType === "stela-peer-message")!;
    // This runs after the actual session proposal, but before Pi validates/persists it.
    // Update the original fixture clock closure captured by Mailbox, not a replacement
    // Date.now function. No wall-clock wait, fake human input, retry or live profile.
    await Promise.resolve();
    pi.events.emit("ss-session-fixture:advance", action === "work-late-expired" ? 1_830_000 : 660_000);
    // Pi entry timestamps use new Date(), independent of our Date.now fixture clock.
    // Persist the relevant admission clock evidence after the proposed message instead.
    return { entries: [...event.entries, { type: "custom" as const, customType: "ss-session-fixture-late", data: {
      messageId: (proposal as { details?: { messageId?: string } }).details?.messageId, advancedAt: Date.now(),
    } }] };
  });
}
