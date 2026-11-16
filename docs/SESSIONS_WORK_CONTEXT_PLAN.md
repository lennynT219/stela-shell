# Bounded session work contexts — implementation plan

Status: fixed work windows were published in 87fe4d0. The user-approved thread-isolation/efficiency correction AND separately approved late-commit correction are locally implemented and functionally checked: 240 integrated passes /24 Windows-only skips /0 failures (264 total). Neither is deployed to open sessions. A new narrow late-commit review timed out at240s with partial evidence only; it is INCOMPLETE, not a passed audit or pending task. Its concrete admission finding was independently reproduced and corrected with parent regressions. The user separately authorized committing and normally pushing the completed StelaShell delivery; actual HEAD/upstream/remote refs establish publication state. No dependency/native/profile change, live reload or historical-message retry is included.

## Problem and objective

Ordinary automatic conversations inherit a ten-minute expiry, including sends without reply_to. Fixed opt-in work windows solve longer bounded collaboration, not unlimited rounds.

A later diagnosis reproduced a second limitation: one activation-wide sticky work boundary vetoed exact replies to other independently admitted threads. Two local CONTEXT_MISMATCH incidents occurred before IPC while prior work windows were still live. Eight synthetic cases reproduced the live/expired-old-work conflict across ordinary/work roots and same/different peers. Existing passing tests intentionally enforced some blocking, so thread isolation is an approved contract correction, not merely removal of a failing assertion. Older missing-anchor/lifetime incidents and a peer-reported WORK_EXPIRED lack complete runtime attribution; see docs/WORK_STATE.md.

Separate a message's delivery validity from a fixed, bounded **work-context communication window**, without creating a job runner, resetting automatic budgets or extending permissions. The window does not stop remote tools/models, establish a cost/token cap, or prove a task started/completed.

## Implemented behavior

| Context | Behavior |
| --- | --- |
| Ordinary messaging | Preserve the current ten-minute conversation semantics. |
| Explicit work context | Opt in at the beginning of an authorized human-originated workflow; select one non-renewable deadline before admission. |
| Follow-up/result | Carry a fresh message expiry no later than ten minutes from creation AND no later than the original work deadline. Inherit the same work identity/deadline. |
| Work expiry | Stop sends on that work; preserve the expired implicit boundary instead of creating a fresh automatic root. An exact reply to a genuinely independent admitted thread uses that thread's own limits. No renewal or silent downgrade. |

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
- Explicit reply_to selects the EXACT retained inbound anchor from the specified activation, not the latest activity from that peer. Multiple independent threads can involve the same peer. Only the selected thread's work identity, deadline, ordinary expiry and causal hop constrain that reply; unrelated implicit work cannot veto or contaminate it.
- A missing/wrong-peer/pruned anchor returns REPLY_TARGET_NOT_RETAINED without falling back to implicit lineage. It does not prove the exact reason the target is unavailable. Global send/history guards precede selection; after selection, expiry precedes hop exhaustion.
- Without reply_to, automatic sends inherit implicit lineage. A reserved/committed work boundary stays sticky even after expiry; an unrelated commitment or explicit reply cannot replace it. When there is no existing work boundary, committed incoming context (or the first reserved work send) establishes implicit lineage. Ordinary root sends still consume fresh-work eligibility.
- Genuine host input may start a new authorized workflow under normal policy; it resets activation send/receive budgets and implicit selection, not retained anchors/high-water/deadlines. It cannot resurrect an expired ID. Peer/extension input must not impersonate this boundary.
- Every selected thread retains its own maximum causal hop, including earlier anchors/delayed correlated branches; another thread's hop cannot raise or lower it. Correlated branches grow from their own authenticated outbound anchor on receipt, even if out of order. Ordinary expiry cannot grow beyond the selected anchor/retained thread bound; work messages get fresh delivery TTL within the immutable work deadline.
- Independently admitted requests do not reset any global budget, renew an old task, permit a work option on a reply, or authorize forwarding an expired task into new context. A transport receipt still means memory admission only, not committed/read/task-started/completed work.

Use bounded activation-owned memory only. The existing 64-entry history retains work IDs until their fixed deadline, ordinary IDs until expiry, and never evicts live correlation/deduplication IDs. A text-free thread index contains at most one entry per retained thread (<=64), removed with its last history record; only ONE additional text-free implicit expiry sentinel and ONE text-free offered-proposal reservation may survive. The offer holds an ID and the existing indexed Thread reference, not a message body or recreated history ID; admission still rejects changes to that held thread's metadata and reuse of its outstanding message ID. There is no per-peer latest-context substitution, unbounded tombstone set or extra message-body copy. ID/thread/hop lookups and scalar metadata comparisons avoid repeated history scans/JSON serialization. Pruning is gated by the next known expiry and scans only the bounded history/inbox when due; inbox lookup remains bounded by eight. This is structural bounded-work evidence, not a latency/RSS benchmark or universal performance guarantee.

Queued messages expire before NEW selection for injection. Mailbox.offer() records the one eligible proposal before handing it to Pi, without acknowledging delivery, resetting counters or extending TTL. Pi can persist that already-proposed entry after its delivery TTL; on actual matching active-branch commitment, delivered() consumes the reservation and establishes ONLY its original live/expired lineage. It does not re-offer a body or restore pruned anchors/IDs. A live work window still permits a fresh bounded continuation; expired work/ordinary context remains expired. The indexed causal high-water survives through the shared text-free Thread reference, even if history was pruned.

Only actual branch evidence acknowledges a proposal. If correlation unexpectedly cannot be resolved, the host pauses admission/sending rather than silently clearing into a fresh root; append rechecks that pause. Explicit cancellation withdraws the reservation; off/shutdown/navigation revoke it with the activation, and interruption keeps the existing pause/no-automatic-reproposal behavior. Genuine input remains a legitimate new workflow boundary, not resurrection of an old deadline. No persistence, recovery daemon, automatic restart, status polling, keepalive or remote cancellation guarantee is added.

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

Local known failures include safe details.code and stage (admission or transport); selected-context errors can report only selection source, thread, hop, delivery expiry and fixed work metadata. Successful receipts expose those same routing bounds. Transport-stage uncertainty is not proof the receiver rejected or read a message. No text, capability, endpoint path or raw wire data is added. Recipient wire codes/schemas remain unchanged.

Committed host acknowledgment uses a matching current-leaf fast path and ONE generation/activation/message/leaf-scoped negative-cache slot; unchanged-leaf misses do not rescan the branch. Changed-leaf misses retain the supported getBranch fallback. No public entry_appended hook or acknowledgment from proposals/message notifications is invented. This reduces redundant work but does not establish constant-time host acknowledgment for growing branches.

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
3. Omitted options, earlier same-thread anchors, repeated root options and altered IDs/deadlines cannot renew/escape the selected or implicit boundary or reset budgets. An exact independently admitted thread is replyable without changing the old implicit work boundary.
4. A fresh message may correlate to retained work metadata after the parent message's delivery expiry, but an expired queued message is never newly offered. A proposal offered while valid may commit late; its reserved original lineage must survive without body redelivery or restoration of pruned anchors.
5. Wrong peer/activation/thread/hop, conflicting metadata and replay remain rejected; live deduplication entries are not evicted when capacity is full.
6. Unsupported/unknown-version peers receive no work text; no silent fallback. Ordinary compatibility is preserved deliberately, not assumed.
7. Off/navigation/interruption/abort retain current ownership and cleanup guarantees. Work expiry does not pretend the remote task was stopped.
8. Maximum escaped message/frame/correlation limits and negotiation deadlines are checked without increasing them by accident.
9. Local deterministic Pi fixtures cover root creation, long-work continuation and denial without paid inference, live profile changes or resetting genuine-input controls.

10. Interleaved live/expired old work and independent ordinary/work roots, same/different peers: exact old/new targets and omitted replies retain the appropriate per-thread limits, global budgets and genuine-input rules.
11. Thread index/reference counts remain bounded and prune with history; hot lookups avoid history scans before expiry. Host cache cannot acknowledge uncommitted/foreign-activation entries and invalidates with leaf/in-flight/generation changes.
12. Idle/boundary late commitment preserves live-work deadline/hop or expired-work/ordinary refusal; the single offer is cancelled on the existing lifecycle paths, not time-renewed. Unknown commit correlation pauses. Offered metadata and ID consistency remain checked after history pruning; independent exact replies remain valid.

## Evidence and pending decisions

Current combined correction on Linux/Node24.22.3/packaged Pi1.5.2:

- Final integrated suite: **240 passed /24 Windows-only skipped /0 failed /264 total**. Independently expected247 +6 late-route +2 host-failure/cancellation +4 mailbox-reservation +2 offered-admission +3 Pi =264;223+17=240 passes, unchanged24 skips. The initial68 focused checks passed before the final offered-metadata regressions were added; the final integrated run covers all current tests.
- Fourteen deterministic Pi session cases pass. Three new cases register a later asynchronous turn_end handler AFTER sessions, advance only the captured fixture admission clock, then let real Pi validate/persist the proposal and a correlated custom evidence entry. They verify live work retains its original identity/deadline/hop with omitted reply_to, expired work/ordinary sends fail before transport, one committed body, no additional human receiver input, and no capability leakage. This establishes the supported ordering under controlled clocks, not a naturally observed ten-minute delay in a live profile.
- One constant-sized offered reservation preserves lineage/high-water through inbox/history pruning, never copies a body or revives an anchor. New parent regressions reject reused offered-thread metadata, downgrade and outstanding message-ID collision after pruning, while independently admitted exact replies remain available. No limit increase, growing tombstone set or extra scan was added.
- Evidence: /tmp/ss-late-commit-xqix_2y_/{baseline.json,before-tests.log,focused-tests.log,offer-admission-before.log,late-pi-tests.log,final-integrated-tests.log,verification.json}. 65 unrelated protected hashes match. Initial idle-harness entries lacked the stored custom_message type; the harness was corrected, not the commitment predicate. Initial Pi assertions wrongly compared new Date() entry timestamps against the Date.now fixture clock; replaced with actual persisted admission-clock evidence after the proposed message. Final checks pass; neither codec nor guard was relaxed.
- **Independent late-commit review INCOMPLETE:** task-b9b2814c-7745-4a71-8f8c-97f4f6942d03 exceeded240s, no retry. Retained text is partial source evidence, not a completed review/approval. Four project refs stayed hash-identical through timeout; parent then independently reproduced its conditional peer-envelope renewal counterexample and added offered-thread consistency/ID guards and tests. Normal tools were not shown to generate that forged reuse; the final guard has parent runtime regression evidence, not a completed independent assessment. Host ordering in partial text is also exercised by the actual Pi fixtures, not silently substituted for a full failed review. No helper remains pending, and no full security/performance/native/real-provider certification is claimed.

Prior isolated thread-isolation checkpoint (still relevant where unchanged):

- Initial messages/work-context/extension checks: **56 passed / 0 failed**. A strict-fixture error initially supplied an explicit work:undefined field to an ordinary envelope; corrected the synthetic fixture by omitting the field, without relaxing the codec.
- Integrated suite: **223 passed / 24 Windows-only skipped / 0 failed / 247 total**. Expected counts independently calculated as prior231 +8 matrix +4 mailbox +2 host +2 Pi =247; prior207 +16 =223 passes, unchanged24 skips. Eleven deterministic Pi session cases include same-peer live-old-work/new-ordinary and expired-old-work/new-work flows; exact replies keep the new thread, and an omitted reply after the latter still returns WORK_EXPIRED on the old thread before transport. Profiles/clocks/providers are isolated; no live or paid inference.
- Thread/index/refcount/expiry and host committed-leaf/cache operation counts pass without timing benchmarks. 65 unrelated tracked/current-doc hashes remain unchanged, including protocol/transports/native/Cargo, package/lock, helper/web/method and pre-existing Memory docs. Logs/provenance: /tmp/ss-thread-isolation-5ykkjya6/{baseline.json,focused-tests.log,integrated-tests.log,verification.json,review-frozen.sha256}.
- Completed source-only host-API helper task-866ae462-50fc-459b-8f53-292970772d6c supported only leaf fast path/negative caching with a scan fallback. index.ts was unchanged while it ran. Completed focused invariant helper task-cb9217da-46f7-455f-817b-58843fa23583 found no exact-target/index counterexample; all five refs remained hash-identical through that review and parent probes. This is bounded source review, not the missing historical general-security audit or independent test execution. Coverage limitations include no direct shared-thread partial-prune refcount test or duplicate-at-every-full-budget boundary matrix. No new runtime/native/latency/security certification.
- The pre-existing late-commit edge was reproduced in BOTH published4d3538f source and the pre-correction candidate at601000ms after admission1000ms, while work deadline1801000ms remained live (late-commit-probe.mts/json). The user subsequently explicitly approved its correction, now covered above. The old synthetic artifact remains diagnostic baseline, not a current failure or pending scope decision; it was not established as the cause of historical CONTEXT_MISMATCH incidents.

No live-session activation, historical acceptance resend, dependency/profile/native/Git change occurred. No helper/result remains pending.

Previous published work-window baseline, NOT evidence for the new isolation correction, completed on Linux, Node24.22.3 and packaged Pi1.5.2:

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
