import type { ExtensionAPI, ExtensionContext, MessageRenderer } from "@earendil-works/pi-coding-agent";
import { callRenderer, messageRenderer, type MakeText } from "../presentation.ts";
import { DEFAULT_WORK_SECONDS, formatMessage, Mailbox, MAX_HOPS, MAX_WORK_SECONDS, MIN_WORK_SECONDS, PEER_TASK_BOUNDARIES, PEER_TASK_POLICY, quoted, sendContext, SessionError, type Envelope, type PeerInfo, type Received, type WorkOptions } from "./messages.ts";
import { PeerTransport } from "./transport.ts";
import { readCodexQuota, readPiQuota } from "./codex-quota.ts";
import { registerSpeed } from "./codex-speed.ts";
import { registerUsageFooter } from "./usage-footer.ts";
import { registerCommandSearch } from "./command-search.ts";
import { registerTurnHint } from "./turn-hint.ts";
import { registerWriteScope } from "./write-scope.ts";
import type { OpenTransport, SessionTransport } from "./protocol.ts";
import { openPrimaryActivity, type ActivityOwner } from "../primary-activity.ts";

export const MESSAGE_TYPE = "stela-peer-message";
const WIDGET = "ss-sessions";
interface Dependencies { profile: string; env?: NodeJS.ProcessEnv; open?: OpenTransport; text?: MakeText; incomingRenderer?: MessageRenderer; panel?: ReturnType<typeof import("./activity.ts").registerActivity> }
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
  const incoming = dependencies.incomingRenderer ?? (dependencies.text && messageRenderer("Mensaje",dependencies.text));
  if (incoming) pi.registerMessageRenderer(MESSAGE_TYPE,incoming);
  const open = dependencies.open ?? PeerTransport.open;
  let owner: ExtensionContext | undefined, ownerId: string | undefined, transport: SessionTransport | undefined;
  let mailbox = new Mailbox(), generation = 0, startup: AbortController | undefined;
  let inFlight: string | undefined, inFlightReceived: Received | undefined, paused = false, disabled = false, unavailable = "Session has not started.";
  let activity: ReturnType<typeof openPrimaryActivity> | undefined;
  let ackMiss: { generation: number; activation: string; messageId: string; leafId: string | null } | undefined;
  const flight = (received?: Received) => { inFlight = received?.message.id; inFlightReceived = received; ackMiss = undefined; if (!received) mailbox.withdraw(); };

  const owns = (ctx: ExtensionContext) => owner?.sessionManager === ctx.sessionManager && ownerId === ctx.sessionManager.getSessionId();
  const widget = () => {
    try { if (owner?.hasUI && !dependencies.panel?.active(owner)) owner.ui.setWidget(WIDGET, transport ? [`Sesiones · ${transport.info.id} · ${mailbox.pending} pendientes${paused ? " · pausado" : ""}`] : undefined); }
    catch { /* presentation cannot change admission or block resource cleanup */ }
  };
  const acknowledge = (ctx: ExtensionContext) => {
    if (!inFlight || !inFlightReceived || !transport || !owns(ctx)) return;
    const received = inFlightReceived, content = formatMessage(received);
    const id = inFlight, activation = transport.info.id, leafId = ctx.sessionManager.getLeafId();
    if (ackMiss?.generation === generation && ackMiss.activation === activation && ackMiss.messageId === id && ackMiss.leafId === leafId) return;
    const matches = (entry: ReturnType<typeof ctx.sessionManager.getLeafEntry>) => entry?.type === "custom_message" && entry.customType === MESSAGE_TYPE &&
      (entry.details as { activation?: string; messageId?: string } | undefined)?.activation === activation &&
      (entry.details as { messageId?: string } | undefined)?.messageId === id && entry.content === content;
    // Only stored active-branch evidence counts. No public committed-entry event/receipt is assumed.
    if (matches(ctx.sessionManager.getLeafEntry()) || ctx.sessionManager.getBranch().some(matches)) {
      const committed = mailbox.delivered(id); flight();
      if (!committed) {
        paused = true; // A correlation failure must never silently open a new automatic root.
        try { if (ctx.hasUI) ctx.ui.notify("No se pudo confirmar el contexto del mensaje. Sesiones en pausa hasta intervención del usuario.", "warning"); } catch { /* best-effort presentation */ }
      }
      // Late commitment can preserve messaging lineage, but cannot mint Memory
      // activity from an expired body. Keep the authenticated Received witness.
      if (committed && received.state === "delivered" && received.message.expiresAt > Date.now()) {
        activity?.committed(received.message.work?.deadline ?? received.message.expiresAt, () =>
          matches(ctx.sessionManager.getLeafEntry()) || ctx.sessionManager.getBranch().some(matches));
      }
      widget();
    } else ackMiss = { generation, activation, messageId: id, leafId }; // One bounded negative-cache slot.
  };
  const draft = (received: Received) => ({
    customType: MESSAGE_TYPE, content: formatMessage(received), display: true,
    details: { activation: transport!.info.id, messageId: received.message.id, from: received.from.id, fromName: received.from.name, thread: received.message.thread, hop: received.message.hop, replyTo: received.message.replyTo,
      ...(received.message.work ? { work: received.message.work } : {}) },
  });
  const pump = (version = generation) => {
    if (version !== generation || !transport || !owner || !owns(owner) || paused || inFlight || !owner.isIdle()) return;
    const next = mailbox.offer(); widget();
    if (!next) return;
    flight(next);
    try {
      // Never sendUserMessage: peer text is visibly custom context, not a user prompt/command.
      // Busy sessions retain their bounded inbox until an actionable boundary.
      pi.sendMessage(draft(next), { triggerTurn: true, deliverAs: "followUp" });
    } catch {
      paused = true;
      try { if (owner.hasUI) owner.ui.notify("Peer message injection failed; delivery is not confirmed. Messaging paused until human input or /ss-sessions on.", "warning"); } catch { /* best-effort presentation */ }
      widget();
    }
  };
  const stop = async () => {
    generation++; startup?.abort(); startup = undefined;
    try { dependencies.panel?.unbind(); } catch { /* the monitor cannot prevent transport teardown */ }
    activity?.close(); activity = undefined;
    const old = transport; transport = undefined;
    try { if (owner?.hasUI) owner.ui.setWidget(WIDGET, undefined); } catch { /* teardown must continue */ }
    owner = undefined; ownerId = undefined;
    flight(); mailbox = new Mailbox();
    await old?.close();
  };
  const start = async (_event: unknown, ctx: ExtensionContext) => {
    const stopping = stop(), version = generation;
    await stopping;
    if (generation !== version) return;
    if (disabled || pi.getFlag("ss-sessions-disabled")) { unavailable = "Session messaging is disabled."; return; }
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
      try {
        activity = openPrimaryActivity(ctx,
          () => version === generation && transport === fresh && owns(ctx) && !paused,
          (candidate: ActivityOwner) => acknowledge(candidate as ExtensionContext));
      } catch (error) { await fresh.close(); throw error; }
      transport = fresh; unavailable = ""; widget();
      try { dependencies.panel?.bind(ctx, fresh); } catch { /* messaging remains available without the monitor */ }
    } catch (error) {
      if (generation !== version) return;
      unavailable = error instanceof Error ? error.message : "Local messaging startup failed.";
      if (ctx.hasUI) ctx.ui.notify(`Sesiones no disponibles: ${unavailable}`, "warning");
    }
  };
  const requireTransport = (ctx: ExtensionContext) => {
    if (!transport || !owns(ctx)) throw new Error(`stela-shell sessions unavailable: ${unavailable || "no transport for this activation"}`);
    return transport;
  };
  const append = (event: { outcome: string; entries: any[] }, ctx: ExtensionContext) => {
    if (!transport || !owns(ctx) || paused || event.outcome !== "completed") return;
    acknowledge(ctx);
    if (paused || inFlight) return;
    const next = mailbox.offer(); widget();
    if (!next) return;
    flight(next);
    // A proposal is not delivery. Only a committed active-branch entry acknowledges it.
    return { entries: [...event.entries, { type: "custom_message" as const, ...draft(next) }], continue: true };
  };

  pi.registerFlag("ss-sessions-disabled", { description: "Disable primary-session presence, send and automatic incoming activation.", type: "boolean", default: false });
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
      paused = true; flight(); widget();
      return;
    }
    pump();
  });

  pi.registerTool({
    name: "ss_sessions_list", label: "Sesiones",
    renderCall: callRenderer("ss_sessions_list", "Sesiones", dependencies.text),
    description: "Discover currently reachable PRIMARY stela-shell activations in this local profile (up to 32 peers; on POSIX the cap applies to candidates). No helpers, remote sessions or saved-session transcript search. IDs identify live activations, not display names.",
    promptSnippet: "Discover reachable local primary stela-shell sessions",
    promptGuidelines: ["Use ss_sessions_list for useful coordination or delegated primary-session work, not task-status polling. Presence alone is not a task request; concrete ss_sessions_send requests are actionable under the user's collaboration policy without granting new permissions."],
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
    name: "ss_sessions_send", label: "Enviar mensaje", exposure: "model-only",
    renderCall: callRenderer("ss_sessions_send", "Enviar mensaje", dependencies.text),
    description: "Assign work, send context or reply to a PRIMARY session's exact local activation ID (up to 8 KiB UTF-8). Optional work at a fresh human-originated root selects a fixed 30-minute communication window (600–3600 seconds); ordinary conversations remain 10 minutes. Concrete requests use the receiver's own permissions, not permission overrides. Returns accepted-for-delivery, NOT read/completed. Replies arrive automatically; no approval dialog, blocking ask or automatic retry.",
    promptSnippet: "Assign bounded work, send context or reply to a primary stela-shell session",
    promptGuidelines: [
      `For ss_sessions_send collaboration: ${PEER_TASK_POLICY}`,
      `When handling ss_sessions_send work: ${PEER_TASK_BOUNDARIES}`,
      "Use ss_sessions_send for useful coordination and concrete delegated tasks. Do not copy secrets or whole conversations or transfer tool permissions.",
      "Use ss_sessions_send with exact activation IDs from ss_sessions_list or an incoming peer message. For a reply, supply its exact message ID as reply_to; it selects that thread's deadline and hop, not the implicit context or latest activity from that peer. Missing/expired targets never fall back. Omitted reply_to keeps implicit lineage; an unrelated reply cannot renew or replace it. Delivery/response may start model turns automatically. A receipt only means accepted into memory, not read, verified or completed work.",
      "For ss_sessions_send, select work:{} (30 minutes) or work:{timeout_seconds:600..3600} only at a fresh human-originated root when a longer bounded communication window is useful. Replies inherit work automatically: omit work. Each message still expires within 10 minutes. No renewal, automatic upgrade/downgrade, expired-thread migration, task-runtime/cost guarantee or budget reset. Unsupported peers receive no assignment text and there is no fallback.",
      "After ss_sessions_send, continue independent work. If a reply is needed and nothing else remains, state it is pending; do not poll, sleep, repeatedly ask, or resend because an ACK/reply is missing. No automatic unavailable/acknowledgment replies or echo loops. Stop when the exchange is complete or a budget is reached.",
    ],
    parameters: { type: "object", additionalProperties: false, required: ["to", "text"], properties: {
      to: { type: "string", pattern: "^[a-f0-9]{32}$", description: "Exact live activation ID; not a name or Pi session ID." },
      text: { type: "string", minLength: 1, maxLength: 8192 }, reply_to: { type: "string", pattern: "^[a-f0-9]{32}$" },
      work: { type: "object", additionalProperties: false, description: "Opt in only at a new human-originated root; fixed, non-renewable communication window. Omit on replies.", properties: {
        timeout_seconds: { type: "integer", minimum: MIN_WORK_SECONDS, maximum: MAX_WORK_SECONDS, description: `Work window in seconds; default ${DEFAULT_WORK_SECONDS}. Queueing/processing counts.` },
      } },
    } } as never,
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const current = requireTransport(ctx), version = generation;
      if (paused) throw new Error("Messaging is paused after interruption/injection failure; human input or /ss-sessions on is required.");
      const { to, text, reply_to, work } = params as { to: string; text: string; reply_to?: string; work?: WorkOptions };
      if (to === current.info.id) throw new Error("Cannot message this activation itself.");
      let message: Envelope | undefined, peerName: string | undefined;
      try {
        message = mailbox.prepare(to, text, reply_to, work);
        const receipt = await current.send(to, message, signal, name => {
          peerName = name;
          if (ctx.mode === "tui") _update?.({ content: [], details: { peerName } });
        });
        if (version !== generation || transport !== current || !owns(ctx)) throw new SessionError("DELIVERY_UNCONFIRMED", "Session changed; message delivery is unconfirmed. Do not retry automatically.");
        if (!receipt.accepted) {
          if (receipt.code) throw new SessionError(receipt.code, receipt.error ?? "Recipient rejected the message.");
          throw new Error(receipt.error ?? "Recipient rejected the message.");
        }
        const context = sendContext(message, reply_to !== undefined ? "reply_to" : message.hop === 0 ? "root" : "implicit");
        return result(`Accepted for delivery: ${message.id} to ${to}. Thread: ${message.thread}; hop: ${message.hop + 1}/${MAX_HOPS}; message expiry (Unix ms): ${message.expiresAt}${message.work ? `; fixed work deadline: ${message.work.deadline}` : ""}. Not a read/completion receipt. Replies arrive automatically; continue independent work or honestly report a pending reply.`,
          { messageId: message.id, to, ...(peerName !== undefined ? { peerName } : {}), ...context, replyTo: message.replyTo, status: "accepted", duplicate: receipt.duplicate ?? false });
      } catch (error) {
        if (!(error instanceof SessionError)) throw error;
        const context = error.context ?? (message ? sendContext(message, reply_to !== undefined ? "reply_to" : message.hop === 0 ? "root" : "implicit") : undefined);
        return { ...result(error.message, { code: error.code, status: "error", ...(peerName !== undefined ? { peerName } : {}), stage: message ? "transport" : "admission", ...(context ? { context } : {}) }), isError: true };
      }
    },
  });
  pi.registerCommand("ss-sessions", {
    description: "Ver sesiones locales; off desconecta y on inicia una activación nueva.",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (command === "off") { disabled = true; unavailable = "Session messaging is disabled."; await stop(); }
      else if (command === "on") { disabled = false; await start(undefined, ctx); }
      else if (command) { if (ctx.hasUI) ctx.ui.notify("Usage: /ss-sessions [off|on]", "warning"); return; }
      const peers: PeerInfo[] = transport ? await transport.list(ctx.signal) : [];
      if (ctx.hasUI) ctx.ui.notify(transport ? [`Self: ${transport.info.id}${paused ? " (paused)" : ""}`, ...peers.map((peer) => `${peer.id} | ${quoted(peer.name || peer.sessionId)} | ${quoted(peer.cwd)}`)].join("\n") : `Sesiones no disponibles: ${unavailable}`, "info");
    },
  });
}

export default async function sessions(pi: ExtensionAPI): Promise<void> {
  if (process.env.STELA_SUBAGENT_CHILD) return;
  const { getAgentDir, readStoredCredential, CustomEditor, ExtensionSelectorComponent, ExtensionInputComponent, ExtensionEditorComponent, highlightCode, getLanguageFromPath } = await import("@earendil-works/pi-coding-agent");
  const drawing = await import("@earendil-works/pi-tui");
  const { HStack, Text, truncateToWidth } = drawing;
  const { registerBlocks, familyMessage } = await import("../blocks/index.ts");
  registerBlocks(pi,{ ...drawing, highlightCode, getLanguageFromPath });
  registerWriteScope(pi, getAgentDir);
  const caption = registerUsageFooter(pi, truncateToWidth, registerSpeed(pi, readStoredCredential));
  registerCommandSearch(pi);
  registerTurnHint(pi, CustomEditor, action => drawing.getKeybindings().getKeys(action), truncateToWidth);
  const { registerActivity } = await import("./activity.ts");
  const panel = registerActivity(pi, { HStack, truncateToWidth, matchesKey: drawing.matchesKey, wrap: drawing.wrapTextWithAnsi },
    c => c instanceof ExtensionSelectorComponent || c instanceof ExtensionInputComponent || c instanceof ExtensionEditorComponent,
    undefined, (signal, ctx) => ctx.model?.provider === "openai-codex" ? readPiQuota(ctx, readStoredCredential, signal) : readCodexQuota(signal));
  const { registerPanelEditor } = await import("./panel-editor.ts");
  registerPanelEditor(pi, CustomEditor, drawing, panel.toggle, caption, panel);
  registerSessions(pi, { profile: getAgentDir(), text: (content) => new Text(content, 0, 0), incomingRenderer: familyMessage("sessions",drawing), panel });
}
