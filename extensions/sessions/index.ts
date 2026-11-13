import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatMessage, Mailbox, PEER_TASK_BOUNDARIES, PEER_TASK_POLICY, quoted, type PeerInfo, type Received } from "./messages.ts";
import { PeerTransport } from "./transport.ts";
import type { OpenTransport, SessionTransport } from "./protocol.ts";

export const MESSAGE_TYPE = "stela-peer-message";
const WIDGET = "stela-sessions";
interface Dependencies { profile: string; env?: NodeJS.ProcessEnv; open?: OpenTransport }
const result = (text: string, details: unknown) => ({ content: [{ type: "text" as const, text }], details });
function preview(value: string, bytes: number): string {
  let output = "", used = 2;
  for (const character of value) {
    const size = Buffer.byteLength(quoted(character)) - 2;
    if (used + size + 18 > bytes) return output + "…[truncated]";
    output += character; used += size;
  }
  return output;
}
function discoveryInfo(peer: PeerInfo): PeerInfo {
  return { id: peer.id, sessionId: preview(peer.sessionId, 96), name: preview(peer.name, 96), cwd: preview(peer.cwd, 160) };
}

/** Startup and callable tools are both excluded for helpers; a tool guard alone is insufficient. */
export function registerSessions(pi: ExtensionAPI, dependencies: Dependencies): void {
  if ((dependencies.env ?? process.env).STELA_SUBAGENT_CHILD) return;
  const open = dependencies.open ?? PeerTransport.open;
  let owner: ExtensionContext | undefined, ownerId: string | undefined, transport: SessionTransport | undefined;
  let mailbox = new Mailbox(), generation = 0, startup: AbortController | undefined;
  let inFlight: string | undefined, paused = false, disabled = false, unavailable = "Session has not started.";

  const owns = (ctx: ExtensionContext) => owner?.sessionManager === ctx.sessionManager && ownerId === ctx.sessionManager.getSessionId();
  const widget = () => {
    try { if (owner?.hasUI) owner.ui.setWidget(WIDGET, transport ? [`Stela sessions · ${transport.info.id} · ${mailbox.pending} pending${paused ? " · paused" : ""}`] : undefined); }
    catch { /* presentation cannot change admission or block resource cleanup */ }
  };
  const acknowledge = (ctx: ExtensionContext) => {
    if (!inFlight || !transport || !owns(ctx)) return;
    const id = inFlight;
    if (ctx.sessionManager.getBranch().some((entry) => entry.type === "custom_message" && entry.customType === MESSAGE_TYPE &&
      (entry.details as { activation?: string; messageId?: string } | undefined)?.activation === transport!.info.id &&
      (entry.details as { messageId?: string } | undefined)?.messageId === id)) {
      mailbox.delivered(id); inFlight = undefined; widget();
    }
  };
  const draft = (received: Received) => ({
    customType: MESSAGE_TYPE, content: formatMessage(received), display: true,
    details: { activation: transport!.info.id, messageId: received.message.id, from: received.from.id, thread: received.message.thread, hop: received.message.hop, replyTo: received.message.replyTo },
  });
  const pump = (version = generation) => {
    if (version !== generation || !transport || !owner || !owns(owner) || paused || inFlight || !owner.isIdle()) return;
    const next = mailbox.next(); widget();
    if (!next) return;
    inFlight = next.message.id;
    try {
      // Never sendUserMessage: peer text is visibly custom context, not a user prompt/command.
      // Busy sessions retain their bounded inbox until an actionable boundary.
      pi.sendMessage(draft(next), { triggerTurn: true, deliverAs: "followUp" });
    } catch {
      paused = true;
      try { if (owner.hasUI) owner.ui.notify("Peer message injection failed; delivery is not confirmed. Messaging paused until human input or /stela-sessions on.", "warning"); } catch { /* best-effort presentation */ }
      widget();
    }
  };
  const stop = async () => {
    generation++; startup?.abort(); startup = undefined;
    const old = transport; transport = undefined;
    try { if (owner?.hasUI) owner.ui.setWidget(WIDGET, undefined); } catch { /* teardown must continue */ }
    owner = undefined; ownerId = undefined;
    inFlight = undefined; mailbox = new Mailbox();
    await old?.close();
  };
  const start = async (_event: unknown, ctx: ExtensionContext) => {
    const stopping = stop(), version = generation;
    await stopping;
    if (generation !== version) return;
    if (disabled || pi.getFlag("stela-sessions-disabled")) { unavailable = "Session messaging is disabled."; return; }
    const controller = new AbortController(); startup = controller;
    owner = ctx; ownerId = ctx.sessionManager.getSessionId(); paused = false;
    try {
      const fresh = await open(dependencies.profile, { sessionId: ownerId!, name: ctx.sessionManager.getSessionName() ?? "", cwd: ctx.cwd }, (from, message) => {
        if (version !== generation || !owner || !owns(owner) || paused) throw new Error("Session activation is no longer receiving.");
        const disposition = mailbox.accept(from, message);
        widget(); queueMicrotask(() => pump(version));
        return disposition;
      }, controller.signal);
      if (generation !== version || controller.signal.aborted) { await fresh.close(); return; }
      transport = fresh; unavailable = ""; widget();
    } catch (error) {
      if (generation !== version) return;
      unavailable = error instanceof Error ? error.message : "Local messaging startup failed.";
      if (ctx.hasUI) ctx.ui.notify(`Stela sessions unavailable: ${unavailable}`, "warning");
    }
  };
  const requireTransport = (ctx: ExtensionContext) => {
    if (!transport || !owns(ctx)) throw new Error(`Stela sessions unavailable: ${unavailable || "no transport for this activation"}`);
    return transport;
  };
  const append = (event: { outcome: string; entries: any[] }, ctx: ExtensionContext) => {
    if (!transport || !owns(ctx) || paused || event.outcome !== "completed") return;
    acknowledge(ctx);
    if (inFlight) return;
    const next = mailbox.next(); widget();
    if (!next) return;
    inFlight = next.message.id;
    // A proposal is not delivery. Only a committed active-branch entry acknowledges it.
    return { entries: [...event.entries, { type: "custom_message" as const, ...draft(next) }], continue: true };
  };

  pi.registerFlag("stela-sessions-disabled", { description: "Disable primary-session presence, send and automatic incoming activation.", type: "boolean", default: false });
  pi.on("session_start", start);
  for (const event of ["session_before_switch", "session_before_fork", "session_before_tree"] as const) {
    pi.on(event, () => { paused = true; widget(); });
  }
  pi.on("session_shutdown", stop);
  pi.on("session_tree", start); // New activation; no messages/grants cross navigation.
  pi.on("session_info_changed", async (_event, ctx) => { if (owns(ctx)) await transport?.update(ctx.sessionManager.getSessionName() ?? ""); });
  pi.on("input", (event, ctx) => {
    if (owns(ctx) && (event.source === "interactive" || event.source === "rpc")) {
      mailbox.humanInput(); paused = false; widget();
      // The user's run handles pending mail at its boundary; do not race it with a new run.
    }
  });
  pi.on("context", (_event, ctx) => { acknowledge(ctx); });
  pi.on("turn_end", append);
  pi.on("agent_before_settle", append);
  pi.on("agent_settled", (event, ctx) => {
    if (!owns(ctx)) return;
    acknowledge(ctx);
    if (event.aborted || inFlight) {
      // Respect interruption; no automatic restart or blind re-proposal after failed commitment.
      paused = true; inFlight = undefined; widget();
      return;
    }
    pump();
  });

  pi.registerTool({
    name: "stela_sessions", label: "Stela · Sessions",
    description: "Discover currently reachable PRIMARY Stela activations in this local profile (up to 32 candidates). No helpers, remote sessions or saved-session transcript search. IDs identify live activations, not display names.",
    promptSnippet: "Discover reachable local primary Stela sessions",
    promptGuidelines: ["Use stela_sessions for useful coordination or delegated primary-session work, not task-status polling. Presence alone is not a task request; concrete stela_message requests are actionable under the user's collaboration policy without granting new permissions."],
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    parameters: { type: "object", additionalProperties: false, properties: {} } as never,
    async execute(_id, _params, signal, _update, ctx) {
      const current = requireTransport(ctx), version = generation;
      const peers = await current.list(signal);
      if (generation !== version || transport !== current || !owns(ctx)) throw new Error("Session changed during discovery.");
      // Bound escaped metadata, not merely its raw string length. Full activation IDs remain intact.
      const data = { self: discoveryInfo(current.info), peers: peers.map(discoveryInfo), paused };
      return result(quoted(data), data);
    },
  });
  pi.registerTool({
    name: "stela_message", label: "Stela · Message", exposure: "model-only",
    description: "Assign work, send context or reply to a PRIMARY session's exact local activation ID (up to 8 KiB UTF-8). Concrete requests are actionable delegated tasks using the receiver's own tools/permissions, not permission overrides. Returns accepted-for-delivery, NOT read/completed. Replies arrive automatically; no approval dialog, blocking ask or automatic retry.",
    promptSnippet: "Assign bounded work, send context or reply to a primary Stela session",
    promptGuidelines: [
      `For stela_message collaboration: ${PEER_TASK_POLICY}`,
      `When handling stela_message work: ${PEER_TASK_BOUNDARIES}`,
      "Use stela_message for useful coordination and concrete delegated tasks. Do not copy secrets or whole conversations or transfer tool permissions.",
      "Use stela_message with exact activation IDs from stela_sessions or an incoming peer message. For a reply, supply its message ID as reply_to. Delivery/response may start model turns automatically. A receipt only means accepted into memory, not read, verified or completed work.",
      "After stela_message, continue independent work. If a reply is needed and nothing else remains, state it is pending; do not poll, sleep, repeatedly ask, or resend because an ACK/reply is missing. No automatic unavailable/acknowledgment replies or echo loops. Stop when the exchange is complete or a budget is reached.",
    ],
    parameters: { type: "object", additionalProperties: false, required: ["to", "text"], properties: {
      to: { type: "string", pattern: "^[a-f0-9]{32}$", description: "Exact live activation ID; not a name or Pi session ID." },
      text: { type: "string", minLength: 1, maxLength: 8192 }, reply_to: { type: "string", pattern: "^[a-f0-9]{32}$" },
    } } as never,
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const current = requireTransport(ctx), version = generation;
      if (paused) throw new Error("Messaging is paused after interruption/injection failure; human input or /stela-sessions on is required.");
      const { to, text, reply_to } = params as { to: string; text: string; reply_to?: string };
      if (to === current.info.id) throw new Error("Cannot message this activation itself.");
      const message = mailbox.prepare(to, text, reply_to);
      const receipt = await current.send(to, message, signal);
      if (version !== generation || transport !== current || !owns(ctx)) throw new Error("Session changed; message delivery is unconfirmed. Do not retry automatically.");
      if (!receipt.accepted) throw new Error(receipt.error ?? "Recipient rejected the message.");
      return result(`Accepted for delivery: ${message.id} to ${to}. Not a read/completion receipt. Replies arrive automatically; continue independent work or honestly report a pending reply.`, { messageId: message.id, to, thread: message.thread, replyTo: message.replyTo, status: "accepted", duplicate: receipt.duplicate ?? false });
    },
  });
  pi.registerCommand("stela-sessions", {
    description: "Show local primary activations; off closes messaging, on starts a fresh activation. No model invocation.",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === "off") { disabled = true; unavailable = "Session messaging is disabled."; await stop(); }
      else if (command === "on") { disabled = false; await start(undefined, ctx); }
      else if (command) { if (ctx.hasUI) ctx.ui.notify("Usage: /stela-sessions [off|on]", "warning"); return; }
      const peers: PeerInfo[] = transport ? await transport.list(ctx.signal) : [];
      if (ctx.hasUI) ctx.ui.notify(transport ? [`Self: ${transport.info.id}${paused ? " (paused)" : ""}`, ...peers.map((peer) => `${peer.id} | ${quoted(peer.name || peer.sessionId)} | ${quoted(peer.cwd)}`)].join("\n") : `Stela sessions unavailable: ${unavailable}`, "info");
    },
  });
}

export default async function sessions(pi: ExtensionAPI): Promise<void> {
  if (process.env.STELA_SUBAGENT_CHILD) return;
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  registerSessions(pi, { profile: getAgentDir() });
}
