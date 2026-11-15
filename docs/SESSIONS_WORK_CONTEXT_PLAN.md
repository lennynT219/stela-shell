# Bounded session work contexts — implementation plan

Status: the user-approved TypeScript implementation and isolated functional checks are complete, with a 30-minute default and 60-minute maximum. The independent implementation review is incomplete after its 240-second timeout without an answer. The user subsequently reported manually reloading Brain and this parent and explicitly resumed H1; a NEW work-root assignment was accepted for delivery. That is narrow live admission evidence, not a completed H1 task or security/native assessment. No agent-triggered reload, expired-handoff migration, native build or publication follows.

## Problem and objective

Current automatic conversations inherit one ten-minute expiry, including sends without reply_to. This is intentional and covered by a focused existing test; source and an isolated in-memory probe reproduced both expiry and missing-retained-reply errors. The actual rejected handoff's expiresAt/clock was not captured, so its exact runtime timing remains unproven.

The design limitation is broader than that incident: accepted work may take longer than a message/conversation window, preventing a useful result or next step. Passing the current tests confirms the current rule, not its suitability for long collaboration.

Separate a message's delivery validity from a fixed, bounded **work-context communication window**, without creating a job runner, resetting automatic budgets or extending permissions. The window does not stop remote tools/models, establish a cost/token cap, or prove a task started/completed.

## Implemented behavior

| Context | Behavior |
| --- | --- |
| Ordinary messaging | Preserve the current ten-minute conversation semantics. |
| Explicit work context | Opt in at the beginning of an authorized human-originated workflow; select one non-renewable deadline before admission. |
| Follow-up/result | Carry a fresh message expiry no later than ten minutes from creation AND no later than the original work deadline. Inherit the same work identity/deadline. |
| Work expiry | Stop automatic sends; retain an expired marker rather than clearing active lineage into a fresh root. No silent downgrade or renewal. |

Approved values: default work window **30 minutes (1800 seconds)**, allowed **10–60 minutes (600–3600 seconds)**. These are control values, not benchmark results or a promise every task finishes within them. Time begins at initial host admission and includes queueing/processing; it does not restart when a receiver finally reads the message.

The existing limits remain: eight hops, sixteen automatic sends and sixteen automatic receives between genuine inputs, inbox eight, history/correlation sixty-four, current connection/frame/presence bounds and I/O deadlines. Opening a work context does not reset any counter. This change addresses waiting time, not unlimited rounds or tasks.

## Tool and state semantics

Keep ss_sessions_send and its model-only exposure; no new task/orchestrator tools or legacy aliases. An illustrative root call is:

```text
ss_sessions_send {
  "to": "<exact activation ID>",
  "text": "<bounded concrete assignment>",
  "work": { "timeout_seconds": 1800 }
}
```

Implemented rules (not activated in real sessions):

- The work option is explicit at a new eligible root; an empty work object uses the approved default. The host generates identity/deadline; the model does not provide arbitrary work IDs, absolute deadlines or human-input flags.
- Ordinary automatic context cannot upgrade itself into a longer work context. An expired context cannot open a fresh root. Repeated work options cannot renew an existing context.
- Once work context is active, subsequent sends inherit it even if work/reply_to is omitted. Omitting fields never downgrades the message to escape a limit.
- Genuine host input may start a new authorized workflow under normal policy; it does not resurrect an expired work ID or extend its old deadline. Peer/extension input must not impersonate this boundary.
- Reply correlation still binds peer activation, thread/work identity, message ID and monotonic hop. Replying to an older context cannot lower the current causal hop or extend the active context's deadline.
- A committed context entry activates incoming lineage without replacing an existing fixed work boundary. A delayed correlated branch result remains admissible relative to its own retained anchor; commitment/sending preserves the maximum causal hop. Unrelated entries cannot replace even an expired work marker. A transport receipt still means memory admission only, not committed/read/accepted-as-an-executable-task/completed work.

Use bounded activation-owned memory only. Correlation metadata for work messages may outlive individual message delivery expiry, but never the fixed work deadline or existing capacity. Expired bodies need not remain merely to correlate replies; do not evict live deduplication/correlation IDs to admit new work. The implementation uses the existing 64-entry history, retaining bounded work records until their fixed deadline; it adds no second context map.

Queued messages still expire individually and must not be injected after their delivery validity. Correlation retention is not permission to deliver an expired message. Off/shutdown/navigation revoke the activation-owned contexts; interruption preserves the existing pause behavior. No persistence, recovery daemon, automatic restart, status polling, keepalive or remote cancellation guarantee is added.

## Clear errors without weakening guards

Known policy failures return safe machine-readable reasons plus concise actionable text, without capabilities, paths or raw wire data. Implemented categories:

- CONVERSATION_EXPIRED: ordinary automatic context ended.
- WORK_EXPIRED: fixed work deadline ended.
- REPLY_TARGET_NOT_RETAINED: reference is unavailable; do not claim it necessarily expired if that is not known.
- MESSAGE_EXPIRED / INVALID_LIFETIME: distinguish past delivery validity from malformed or excessive future validity.
- HOP_LIMIT / SEND_BUDGET / RECEIVE_BUDGET / STATE_FULL: retain actual limits and do not reset them.
- UNSUPPORTED_WORK_CONTEXT: compatible support was not established; no downgrade.
- DELIVERY_UNCONFIRMED: preserve the current no-automatic-retry semantics.
- INVALID_WORK_CONTEXT / CONTEXT_MISMATCH / MESSAGE_CONFLICT: invalid root/window selection, conflicting lineage and retained-ID conflicts.

Even with clearer errors, models must not manufacture operator input, restart sessions or retry through another recipient/tool to evade a rejection.

## Compatibility recommendation

Work context needs explicit protocol support: current envelope, payload, presence and receipt schemas reject unknown fields and require their current versions. Do not add work fields to ordinary envelopes/pings/ACKs and assume old clients accept them.

Recommended opt-in negotiation:

1. Keep ordinary v1 message/ping/receipt, private presence v1 and native bridge framing unchanged.
2. Before transmitting any work text, send a distinct versioned capability/control query without the assignment body. Require an affirmative response authenticated and bound to the exact request/activation and supported work version. Do not append capabilities to the unchanged ordinary ACK schema.
3. Use a distinct versioned work-message payload with strict context fields around the message. Keep each message's delivery TTL; validate immutable work identity/deadline and bounded correlation separately.
4. Old peers, unknown versions or unconfirmed negotiation fail closed with unsupported/unconfirmed support. No assignment text, silent metadata stripping, ordinary-mode fallback or automatic retry follows.

Capability negotiation plus sending must share the existing absolute operation/cancellation budget rather than accidentally doubling it. Discovery can keep its ordinary ping behavior. Any optional capability cache must be bounded and tied to exact activation/generation, never display name/session ID; there is no persistent cache or daemon. A fresh activation requires fresh support evidence.

Independent static findings: shared TypeScript performs message/presence/receipt validation; the inspected Windows native bridge/storage carry bounded opaque bytes. No native API/source change is evidenced as necessary for metadata inside the encrypted payload while framing and bounds remain unchanged. The intended first implementation therefore changes TypeScript only, not Rust or Cargo.

This is not demonstrated backward compatibility or execution of an unchanged Windows binary. Native pipes/framing internals were outside the delegated references. Verify the applicable bounds/codecs and report any additional native/wire scope before implementation; never silently expand it, restore an unprotected fallback or rebuild/reload automatically. Work-mode support requires compatible extensions at both ends. Do not migrate an expired ordinary conversation or the rejected Brain handoff into a work lease.

## Implementation boundary

Approved TypeScript implementation surfaces under the negotiated-support design:

- extensions/sessions/messages.ts: work-context admission, fixed deadline, bounded correlation and explicit errors.
- extensions/sessions/index.ts: optional root argument, guidance/presentation and existing lifecycle ownership.
- extensions/sessions/protocol.ts: strict work/control payloads and request-bound authenticated capability responses.
- extensions/sessions/transport.ts and transport-windows.ts: bounded negotiation/dispatch; preserve their protection/deadline/cancellation behavior.
- Relevant messages/protocol/transport/extension/Pi-fixture tests and extensions/sessions/README.md; continuity stays in docs/WORK_STATE.md.

No Brain memory source, web/helper behavior, SDK/runtime installation, dependency, profile/link/settings/credentials, native build or live provider experiment is included. No branch/switch/commit/push or publication is authorized. Clearer diagnostics do not renew a context or authorize a retry; the opt-in semantic extension is separate from ordinary v1 behavior.

## Implemented wire representation

Internal messages may carry `work: { version: 1, id, startedAt, deadline }`, with `thread === work.id`. Ordinary `envelope()` rejects that field. The encrypted packet, presence and native framing remain v1. Work uses distinct strict payloads `{ kind: "work_support", version: 1 }` and `{ kind: "work_message", version: 1, work, message }`; the latter's nested message remains a plain envelope. Support responses and work receipts use a separate v2 schema bound to the exact request and activation; support also requires `workVersion: 1` and `supported: true`. Ordinary ACKs accept no extra work fields. No capability cache is used.

## Acceptance criteria

Covered by the isolated checks below, with native/real-provider and independent-review limits explicitly retained:

1. Ordinary ten-minute behavior remains unchanged, including expired automatic sends without reply_to.
2. A declared thirty-minute work root can exchange a new result after minute ten, provided each message is fresh and the original work deadline/hop/budgets remain valid. At the exact work deadline it fails closed.
3. Omitted options, older-thread replies, repeated root options, altered IDs/deadlines and cross-context routing cannot renew/escape the active boundary or reset budgets.
4. A fresh message may correlate to retained work metadata after the parent message's delivery expiry, but an expired queued message is never delivered.
5. Wrong peer/activation/thread/hop, conflicting metadata and replay remain rejected; live deduplication entries are not evicted when capacity is full.
6. Unsupported/unknown-version peers receive no work text; no silent fallback. Ordinary compatibility is preserved deliberately, not assumed.
7. Off/navigation/interruption/abort retain current ownership and cleanup guarantees. Work expiry does not pretend the remote task was stopped.
8. Maximum escaped message/frame/correlation limits and negotiation deadlines are checked without increasing them by accident.
9. Local deterministic Pi fixtures cover root creation, long-work continuation and denial without paid inference, live profile changes or resetting genuine-input controls.

## Evidence and pending decisions

Completed on Linux, Node24.22.3 and packaged Pi1.5.2:

- Sessions suite: **63 passed, 18 Windows-only skipped, zero failed (81 total)**.
- Integrated `SS_TEST_PI_CLI=.../dist/bundle/cli.js npm test`: **207 passed, 24 Windows-only skipped, zero failed (231 total)**; log `/tmp/ss-work-integrated-kl3U3p.log`. This adds 26 cases to the published 205-case baseline without removing existing tests.
- `tests/work-context.test.ts` covers fixed/default/min/max timing, exact expiry, retained anchors/expired queues, metadata/peer/thread/hop binding, delayed branch results, no budget reset/ID eviction, strict codecs/ACKs, unchanged v1 fields, escaped encrypted/native framing, unsupported no-text behavior and shared operation cancellation/deadline/uncertainty.
- Extension and POSIX cases cover root reservation before I/O, safe tool errors, committed context/lifecycle, fresh replies after minute ten, and a controlled legacy-only rejection with no assignment text/fallback/retry. This is not execution of an old release binary.
- Two added actual Pi RPC fixtures cover a fresh result after eleven simulated minutes and a receiver-side write denial. Only temporary child-process clocks advance; commands do not reset input hooks. Nine Pi session cases pass in total, with no network/paid inference or real-profile change.
- Git whitespace checks and 59 protected-file hashes pass, including native/Cargo files, manifest/lock, web/helper/method and the pre-existing Brain contract. No branch/commit/push, native build or live activation occurred.

Independent work-guard assignment `task-7a2f0139-3763-4539-b491-4a18dd0f222e` exceeded its selected 240-second deadline with **no answer or partial assessment**. No retry/substitute independent review was launched and no result is pending. Functional checks do not complete that missing review. Fresh native Windows/macOS work-mode execution, interactive/real-provider behavior and a completed independent security assessment remain unverified.

The prior focused expiry test/clock probe and lifecycle review describe the ordinary baseline, not work-mode implementation evidence.

Independent compatibility assignment task-c98e89e3-564e-46f8-8d0a-cf1295d7e04f completed using only messages.ts, protocol.ts, transport-windows.ts and native/windows-sessions/src/{bridge,state,main}.rs. It performed no edits/tests/sends/runtime checks. All six references matched baseline HEAD87fb915 after its generic mutating-tool warning at that preimplementation checkpoint. The shared TypeScript files have now changed; this remains baseline design evidence, not review of the new code. Key baseline findings: strict schemas at messages.ts:28–50 and protocol.ts:12–46,69–98; TypeScript Windows validation at transport-windows.ts:138–197; opaque byte bridge/storage with separate version-1 handshake at bridge.rs:43–114 and state.rs:253–319. No result is pending; native execution, uninspected internals and operational backward compatibility remain unverified.

The user explicitly approved implementation, time bounds and negotiated compatibility scope, then personally reloaded Brain/parent and requested H1 continuation. Fresh activation discovery and admission of a new fixed60min work-root assignment succeeded; no extended-duration/lifecycle/native/security proof is inferred. Broader live trials, agent-triggered reload, native builds and publication still require their applicable authorization. Brain's confirmed product decisions and H1 restrictions remain unchanged.
