# Brain Memory technical plan

Status: Brain R1/R2/R3 CLOSED within reviewed scope on final .N9bkmy/dd9da947... (98 logged tests, four matching-BIN oracles, parent8/8 exact-byte CLI replay). No code/result/helper pending. Acceptance reply to6690... failed CONTEXT_MISMATCH, not delivered/retried; not a code-proof blocker. Core remains local/uncommitted, Cargo frozen, Brain sole writer. SS runtime/cutover/installer/live activation and Brain-repository Git are separate proposals. The user separately authorized this StelaShell documentation's commit/push, not Brain-source publication or SS adapter implementation. Contract: [BRAIN_MEMORY_CONTRACT.md](BRAIN_MEMORY_CONTRACT.md); continuity: [WORK_STATE.md](WORK_STATE.md).

## Completion boundary and ownership

Completed Brain R1 unit covers source/tests/docs and isolated synthetic checks, preserving scoped R2/R3/Note/Project/Task/init/config. Parent's narrow human-approved Cargo/lock/necessary-cache exception is finished; no current dependency gate or new protected permission. Brain remains sole application writer; parent reviewed source/provenance and temporary CLI behavior, not live vault/SS/cutover or publication.

- **Brain primary:** sole application-code/test/docs writer; authorized R1 correction returned as6690... and passed scoped parent acceptance. No additional correction assigned. Parent acceptance notice itself was refused CONTEXT_MISMATCH, so receipt/status alignment there is unconfirmed; do not use another route automatically. Existing unrelated local work, Cargo/features/lock and source ownership remain preserved.
- **Parent:** owns SS design/continuity docs and read-only Brain review. Actual human-approved Cargo exception finished: appended exact manifest entry, inspected accepted lock/cache and verified offline. No parent Brain application/test/docs edits; sole code ownership stays with Brain.

## Fixed product requirements

- A fourth `Memory` model represents persistent work context, not an individual fact/message. Project association is optional; preserve Note/Project/Task semantics and existing init/config.
- Working-folder `.brain.toml`: `binding_version = 1`, `memory_id`, optional explicit relative `memory_subfolders`. No vault path, content/history, Project, executable or permissions in the marker.
- Vault layout: `Memorias/<memory-uuid>/Memoria.md` and `Historial.md`; marker UUID, directory UUID and current `brain_id` must agree. No catalog, ordinary index Note, task index or automatic Project. UUID is identity/locator, not authority.
- Only an own marker or explicit parent declaration creates an independent child context. Materialize that child's marker upon actual creation; do not eagerly create declared children. Copies/moves keep the same Memory identity.
- Resolve/read existing Memory at the first genuine human prompt, before work. Create a new Memory and marker only after the first useful successfully completed turn, after the response has finished; SS then reports actual save success/failure itself. Startup, greetings, empty, failed and cancelled turns create nothing. Subsequent meaningful changes update the same Memory.
- Current body has exactly the five WORK_STATE sections, in their existing order. Keep current Markdown and separate history; retain complete accepted document versions, including exact last-accepted bytes. Do not capture prompts, drafts or full transcripts.
- Preserve unknown/manual Markdown material and observed bytes; human approval is required before accepting external edits. Missing history, incomplete publication and genuinely missing Memory are different states. No silent overwrite, merge, repair, identity replacement or retry.
- Cooperating writers coordinate publication and validate expected revision and accepted bytes. Session messages agree order, not locks or permissions. No reasoning-turn lock, automatic stale-lock stealing, universal CAS, multi-file transaction or power-loss guarantee.
- Qualified Markdown/wikilinks provide actual navigation/graph relations. No Obsidian graph layout/filter claim or settings change. Project association does not move Memory or broaden access.
- No proactive condensation, 8–16 KiB content target, archival/rotation/deletion or synthetic growth experiment. Finite technical safety failures must be explicit, never silent historical loss.
- Brain remains optional. Actual WORK_STATE cutover and optional installer/download/setup are separate future outcomes, not implied authorization.

## Brain core and CLI — delivered acceptance criteria

The replacement now exists in the local working tree on main@1e6c2aa. It is normal Markdown/history, not removed H1/BMR. The following criteria guided implementation; actual contract, evidence and remaining gaps are recorded below. They are not another request for schema/naming approval:

1. Exact fourth-model fields/validation and compatibility with the existing three variants; optional Project identity and real note links.
2. A Memory-specific frontmatter reader/editor that is not lossy typed Serde round-tripping. Specify preservation of unknown properties, body bytes, newline styles and manual changes; a maintained YAML parser still needs approval and does not by itself guarantee lossless rewriting.
3. UUID creation separately from UUID parsing; identify the exact existing/new API/features rather than assuming transitive randomness is usable.
4. Readable full-snapshot history framing that preserves arbitrary Markdown fences and final-newline distinctions. Define candidate versus accepted records and how the last accepted current bytes are obtained without silently regenerating current.
5. Per-Memory cooperating-writer lock, bounded busy response, revision/byte checks, publication sequence and explicit partial/recovery outcomes. Evaluate standard OS locks/toolchain floor before considering create-exclusive locks with stale-lock problems.
6. Read-only marker resolution, lazy create, concurrent marker recheck and partial-creation handling. A failed response must not cause duplicate new IDs or automatic retries.
7. Exact CLI invocation/request/result schema and finite I/O limits. Normal content is Markdown, not a resurrected binary archive or per-revision projection set.
8. Record minimal paths, dependencies/features with concrete reasons and alternatives, and temporary/synthetic acceptance/regression cases. Run the authorized isolated checks offline with already approved dependencies; missing artifacts are a blocker, not install/fetch permission. Do not weaken preservation or hand-roll a general YAML parser merely to avoid an approval gate.


## Verified Brain handoff and review gates

Brain delivered local uncommitted changes on main@1e6c2aa91e1d38007779ac4deda319afec10fb34. Parent directly inspected the fourth model, library/CLI wiring, binding, Memory-specific Markdown preservation and JSON adapter; an independent helper reviewed store/history/manual-approval/recovery invariants. The actual API/format reference is Brain's `docs/MEMORY.md`, not removed H1.

Implemented paths: modified `Cargo.toml`, `Cargo.lock`, `src/{document,lib,main,cli}.rs`, `src/commands/mod.rs`, own continuity; new `src/commands/memory.rs`, `src/memory/{mod,binding,history,markdown,store}.rs`, four Memory test suites and `docs/MEMORY.md`. Existing init/config/vault source and their two integration tests have no diff. Main now delegates to the library rather than compiling those modules twice.

### Actual machine interface

Launch a trusted compiled executable directly: `brain memory`. One UTF-8 JSON request to stdin EOF; one JSON+LF response. Request: `{protocol_version:1, request_id:<nonnil UUID>, operation, vault?:<authorized existing vault>, arguments:{...}}`; response echoes version/ID/operation and contains `result`. Default input/output each `4 * 1024 * 1024 = 4194304` bytes, configurable1KiB..1GiB; these are transport ceilings, not content/retention targets. Logical outcomes use exit0, so the client must validate structured status as well as process exit.

Operations (9, protocol v1): `capabilities`, `resolve`, `read`, `create`, `replace_missing`, `update`, `accept_external`, `inspect_recovery`, `recover`. Update uses host-held ID/exact expected revision+accepted_markdown/complete body. create chooses a new UUID from five sections. replace_missing takes `{context,binding_directory,expected_memory_id,expected_marker,human_approved,title,sections,project?}`; after exact authorized binding and actual old-directory absence checks, saved receipt includes new memory_id/revision1 plus replaced_memory_id. Not generic create-overwrite. Inspection adds optional history_bytes/reassociation and history_corrupt; non-UTF8 bytes are exact integer arrays, never lossy text. human_approved is trusted-host assertion, not model authority. Lost receipt is save_unconfirmed, never automatic retry/rollback/new UUID. cargo run is development usage, not SS autobuild/install.

Brain reports direct human approval in its own session for serde-saphyr2.1.1 (defaults=false, deserialize+serialize), serde_json1.0.154 and uuid1.28.0 serde+v4, followed separately by download/transitive approval. This is attributed historical authorization, not permission transfer. Parent verified all65 previous lock entries remain and19 were added. Declared Rust minimum1.89 uses standard try_locks; runtime evidence is Rust1.100/Linux only.

### Initial core baseline evidence (before corrections below)

- **Implementer-reported, reused:**72 passing tests (41 previous+31 Memory), locked/offline Cargo test, clippy with warnings denied, fmt and whitespace checks. Brain confirmed no subsequent source edits. Group arithmetic and31 new test declarations independently checked; parent did NOT rerun the full suite/clippy. No durable stdout log exists; temporary target `/tmp/brain-memory-check.vZnzug` is not an immutable archive.
- **Parent-observed:** existing frozen-handoff binary exercised through host-style JSON in disposable synthetic folders. Capabilities/correlation/default limits had no filesystem effects; resolve created no Memory/marker; create/read preserved exact current and retained snapshot; update advanced1→2; stale baseline returned conflict. No source/build/profile/personal-vault change, live model or SS activation.
- **Independent static review:** helper `task-4bcf5087-3a31-4e30-85d7-45d2a31a0b3b` found no concrete accepted-history loss, exact-approval bypass, stale overwrite or destructive recovery in its inspected cooperating-writer scope, plus R3 below. Parent checked19 source/manifest/test/doc hashes unchanged across the review, including all helper references; its generic mutation warning concerned temp-fixture activity, not a source change.
- **Owner clarification:** fresh read-only handoff584a632aeb09a323d1e9abbd0232c3db returned5b21aea3d4f499c1e17727dd2cf111d6. Clarificationd3af5baa84de4e5eb6392f86b7b49362 confirms R1/R2 and qualifies the previous no-known-defect claim. Old implementation communication expired without automatic retry; the human's new review is a separate objective.

### R1–R3 correction review — CLOSED within Brain scope

1. **R1 — CLOSED within scope.** Final .N9bkmy maintained-parser implementation permits ordinary lists/quotes/nesting/continuations and genuine relations, retains five canonical top-level H2s and excludes code/comments/escapes/destinations/images/attributes. Earliest-comment masking+reparse resolves chained-comment context without banning valid content, normalization or history rewrites. Parent source/hash review,8-case CLI replay and matching-BIN negative/boundary/legacy/Project tests support closure; limits below remain. The old91test blanket-ban candidate is diagnostic/rejected, never accepted policy.
2. **R2 — CLOSED within scope.** Store::replace_missing / JSON replace_missing provides explicit approved NEW-Memory reassociation; ordinary create still refuses markers. Parent observed approval/stale/ID/target/unknown-field rejection with no allocation; approved new revision1; preserved outside-value CRLF/comments/declarations/copy bytes; exact old/new `.reassociation.json` provenance and stale-repeat conflict. Found/partial/unavailable/empty old directories reject unchanged. Helper task-0dd5271d-571a-4e0a-aa38-af7ea84ddac0 found no concrete R2 admission/publication/recovery defect in four explicit refs; regression assertions cover concurrency, six interruption phases, exact recovery, old reappearance and changed/deleted/third-party markers. Immutable approval boolean is checked before locking, not authentication. Not arbitrary-editor/power-loss certification.
3. **R3 — CLOSED within scope.** Parent actual read/update/inspect/recover on byte0xff and truncated0xe2,0x82 history now yields partial/history_corrupt with exact observation.history_bytes and no repair/lossy decoding. Valid-UTF8 malformed history remains corrupt; missing history stays partial/history_missing; real filesystem/type failure unavailable. Current/history/marker bytes and no-new-intent state preserved, even approved recovery refuses corruption. Finite transport bounds still fail honestly rather than truncate.

This is not an exhaustive security/OS/Obsidian certification. Memory Markdown is canonical rather than a general renderer (e.g. dash-only/Setext separators are rejected); history work grows with retained bytes, and pre-intent creation reservations can lack recovery content. No arbitrary-editor CAS, openat sandbox, transaction, authenticated history or power-loss guarantee.

**Rejected no-container checkpoint evidence:** R1 handoff7759e25bbe6ee49894fb2aca57b63725, target `/tmp/brain-memory-r1-containers.K9KEeB`, binary SHA25698f0ace4b40756df2a1993ec474998cf32c6546089b3e18770750c81164052b8, syntax SHA25663ccb04b3633a4f694722d77bee34d89e6e515f8f4d944a569e2fca9acb7b8ef. Parent matched29 source/binary entries and the supplied manifest hash8396e4b8bbfae70381a718658d90c8f9e26f0a3263591d0ecf5e2a4aa2b5a148, plus12 preserved-baseline paths. checks.log shows91passed/0failed, reconciled as87+4 new test declarations. Brain ran the unchanged parent review harness with the new binary; parent-review.json records all5 R1/10 R2/5 R3 scenarios passing. Parent reused that applicable result instead of duplicating it, then independently exercised the ordinary-Markdown compatibility cases. Cargo/R2/R3 implementation/prior suites remain unchanged; no parent Cargo rerun. Brain reports clippy all-targets -D warnings, fmt/diff checks passing. No new API/protocol/history version. Prior binary remains SHA e6b6165b67135db9c15d262822e79f9d355b8355eb4d7b872870cf9fb54d4471. Targets/logs are temporary evidence, not immutable archives.

Independent positive oracle `/tmp/ss-brain-markdown-compat-7a41010c/review.py` was established against pre-regression .048, then executed unchanged against accepted final .N9bkmy: three legacy snapshots found byte-exact, mixed normal creation saved and eight genuine container/continuation forms saved. Matching final-BIN evidence is now integrated with literal/boundary/chain checks, not a pending-fix claim or exhaustive parser/Obsidian proof.

**Confirmed decision and completed correction:** ordinary lists/quotes/active relations/valid legacy snapshots remain required, never a blanket ban/history rewrite. Exact defaults-off parser and required packages were human-approved/prepared; scoped source/runtime R1 evidence is now established below. No repeated product/library approval or automatic additional implementation.

### Parser dependency — approved and prepared

Direct human 'si' HERE approved exact defaults-off parser/necessary packages; preparation remains COMPLETE/frozen. A later genuine human 'si' authorized root32f4... for chained-comment repair; final packet6690... arrived in a new incoming thread after Brain reported old response expiry. Neither peer resend nor closure grants protected authority or renews an old context. Current accepted source/BIN evidence follows.

Exact approved manifest entry only; SHA82c71f168b8c5dfc2a389dd2440fad7a9666a30ae71caff1646b51ffcccfbdec. Lock SHA4549f87ee524849f4763b4b3a2005d1b01401b5a65c78790e5147b9ff1be13eb:84 baseline +2 expected =86 actual, new parser0.13.6 +unicase2.10.0 only. All83 existing nonroot entries identical; root only adds parser dependency. Both archives checksum-match lock; actual Cargo nodes enable [] optional features for each. `cargo metadata --locked --offline --format-version 1 --filter-platform x86_64-unknown-linux-gnu` exited0; manifest/lock unchanged during check,25 protected source/test/docs paths unchanged at setup boundary; Brain diff --check passed. Details and exact before files: /tmp/ss-brain-parser-deps-5f9zt5tu/setup-verified.json and baseline.json.

Parent explicitly read untruncated public [parser manifest](https://docs.rs/crate/pulldown-cmark/0.13.6/source/Cargo.toml.orig), [build script](https://docs.rs/crate/pulldown-cmark/0.13.6/source/build.rs), [unicase manifest](https://docs.rs/crate/unicase/2.10.0/source/Cargo.toml.orig) and [RustSec advisory](https://raw.githubusercontent.com/RustSec/advisory-db/main/crates/pulldown-cmark/RUSTSEC-2026-0433.md). Extractor version is unknown; manifests self-declare these versions. Parser declares Rust1.71.1 versus Brain1.89; gen-tests-disabled build branch is empty. Advisory marks0.13.x before0.13.6 affected by quadratic wikilink parsing and patched>=0.13.6. This is metadata/source evidence, not downloaded-artifact/API completeness/build/MSRV/security certification.

Alternative: full custom container/list/lazy/inline scanning, with demonstrated bypass/compatibility risk and maintenance burden; not recommended. No claim another parser was evaluated. Blanket banning remains rejected. Integration still requires exact-source/top-level-H2/active-versus-literal/old-history functional checks.

Lock and both archives appeared before parent Cargo updating/fetch commands; initial guard stopped BEFORE dry-run launch. Origin UNKNOWN; active rust-analyzer was observed, not causally attributed. Brain reconfirmed no-writes/no-Cargo hold. Parent accepted only the exact authorized delta after independent inspection/checksum and locked/offline graph verification; no lock regeneration/rollback/redundant download, LSP/process/config change, Cargo update/fetch/build or code mutation. This verifies bounded prepared state, not arbitrary-writer CAS/security or compile/Rust1.89/functional R1 proof.

### R1 parser candidate — CLOSED within reviewed scope

Accepted R1 handoff66900544b2316581b4eb874be9de55c5, received threadbe5d4ca79a0dd1a2759daf79ec564b15: /tmp/brain-memory-comment-chain.N9bkmy/debug/brain SHA256 dd9da947238e6d59df767f8d58f330aa7f1acfed2708c0cd1224345bb5d49ddf; syntax692511fa870ba858d0178c323fb36064a999d73739eb3ac58e916c1b2b062973; manifest6dd7d6f7a70c25a266dbc2b566de94dae13d3ca4e931630e88297e4862c96483. Parent matched all29 entries before/after its own CLI probes,25 prior entries incl oldd2 BIN preserved; only syntax/containers/MEMORY/WORK_STATE differ. Removing ONLY the two added tests+opaque_comment helper reconstructs exact prior9-test SHAac0f2cc17f3643b01d875963727729728f8824fccf9fbd539dca7fa94b38cf32, proving old assertions unchanged; adjudicated corrections fixture also unchanged. Frozen Cargo82c71f.../4549f87..., storage/binding/history/markdown/CLI/four initial suites unchanged; config/init/vault+tests match HEAD.

R1 CLOSED within reviewed Brain scope: comment_view masks ONLY the earliest currently Html-event-eligible comment through its source-level closer, then next_comment reparses before selecting later openers. Fake code inside a comment cannot hide subsequent real comments or cause stale eligibility in later real code. Each round removes at least one visible opener without creating any, preserving byte/newline/UTF8 positions; no pass cap, persisted normalization, container ban or history rewrite. Canonical five top-level H2s and genuinely active history/optional Project relations are preserved. Existing genuinely valid list/quote snapshots stay byte-identical; literal-only unsound baselines remain partial/preserved, not repaired.

Integrated98=87 preserved other tests+11 container declarations,0fail independently reconciled from checks.log; targeted29=11+15+3 reported. Clippy finish/preservation log inspected; clippy all-targets -D warnings, fmt/diff checks reported, no duplicate parent Cargo suite. All FOUR matching-BIN reports pass: masking8/8, boundary28/28, negative5R1/10R2/5R3, positive3legacy/create saved/8forms. Parent actually reran unmodified masking-interactions.py against final BIN: independently expected2openers*4forms=8, observed8/8 saved revision2 with exact expected bytes, including both former false rejections. Both new regression bodies inspected: chains/fake backtick+tilde, real-code/inline/escaped/attribute neighbors, both relations/real H2s, LF/CRLF/CR, unknown YAML/raw/latest snapshots and rejecting rediscovered comment-only links unchanged.

Evidence /tmp/ss-brain-chain-review-qm3lmtfq/{source-review.json,masking-interactions.parent.json,review-conclusion.json}; prior .1X1wnx8-case6pass/2fail artifact is now resolved negative history, not a blocker. Reparse can cost comment-count*document-length; no performance bound/benchmark claimed. Linux/Rust1.100/debug only; no MSRV runtime/other-OS/Obsidian/release/SS/security/exhaustiveness/CAS/power-loss proof. Additional074d source-only review is implementer-reported, not parent helper evidence; oldb172 timeout stays incomplete/not relaunched. No required code/result/helper outstanding. No parent Brain application/build/Cargo/network/real-vault/profile/Git/cutover changes.

Communication limitation, NOT a code blocker: Brain reports root32f4... reply returned WORK_EXPIRED; actual handoff6690... arrived after its own human-requested resend in newbe5d... thread. Parent attempted a substantive acceptance reply to incoming6690... WITHOUT work override; observed CONTEXT_MISMATCH: Reply cannot replace, upgrade or downgrade the active work context. It was NOT delivered and was NOT retried/renewed/migrated or routed through another anchor/session/helper/file channel. Brain receipt of parent acceptance is unconfirmed; parent scoped technical closure/evidence remains valid. Any further communication must respect a legitimately available authorized context, not automatic workaround. No new protected approval follows from peer messages.

## Proposed SS adapter boundary

Use a trusted, explicitly configured compatible Brain executable, launched directly with argument arrays and `shell: false`. Brain parses TOML and owns Memory/history interpretation and publication. SS owns host authority, selected context, model exposure, lifecycle and presentation. No initial daemon, HTTP/TCP server, MCP server, secondary model, direct vault manipulation or duplicate TOML/YAML parser in SS.

No new npm library is currently proposed: Node built-ins can supply child-process I/O, cancellation and JSON handling; use the installed Pi SDK/TUI rather than adding another host copy. This is a design assessment, not executed compatibility evidence. Brain dependency decisions remain separate.

### Machine contract requirements

Actual argv/envelope/operation names are recorded above and in Brain docs/MEMORY.md. Future SS must use explicit replace_missing for the approved offer, never marker-internal edits. These logical outcomes remain client responsibilities:

| Operation | Required result |
| --- | --- |
| Capabilities/version | Supported protocol/schema/operations and explicit safety ceilings, without initializing a Memory or changing configuration. |
| Resolve/read current | Read-only lookup inside the authorized working-root boundary and explicitly selected vault. Return selected binding, identity/revision and complete accepted current state, or an honest exceptional state. No whole-vault scan or implicit source-link traversal. |
| Create | At the eligible completion boundary only, with expected marker state rechecked. Return actual current/history/marker publication state and Memory ID. No automatic replacement of an existing marker or duplicate identity on uncertainty. |
| Replace genuinely missing reference | Use explicit replace_missing only after actual human approval of the exact authorized old marker/identity/location and proposed new context. Require real old-directory absence; preserve other copies/declarations, return actual new ID/replaced old ID, and retain uncertainty evidence without retry. |
| Publish successor | Use the host-bound Memory and expected accepted revision/bytes; return saved/conflict/busy/manual-review/partial/unavailable explicitly. Model-supplied content cannot change the binding, scope or Project as a side effect. |
| Accept reviewed external state | Require explicit human approval bound to the exact observed bytes/identity/revision; revalidate before accepting. A model argument, peer claim or old recalled decision is not approval. |
| Inspect/recover partial state | Read-only diagnosis first; any mutation needs explicit direction and must preserve evidence. No implicit reconstruction from history. |

Every request/response needs version, operation and request correlation; validate strict types, identities and state-specific required fields. Do not accept a partial or mismatched response as a successful save. Expose at least `unbound`, `found`, `not_found`, `unavailable`, `unsupported`, `busy`, `conflict`, `manual_review`, `partial`, `saved` and `save_unconfirmed` semantics, even if Brain selects different wire names.

Bound stdin, stdout, stderr and elapsed execution; perform strict UTF-8/JSON decoding, terminate/cancel owned processes, and avoid raw content/secret diagnostics. Define the minimal environment Brain needs without forwarding provider credentials. A version probe is read-only and never authorizes downloading/building/replacing an executable.

A deadline/disconnection after mutation may mean publication happened: report `save_unconfirmed`, do not retry, roll back, switch backend or allocate a fresh identity. Future read-only reconciliation may inspect actual state. A technical size ceiling must report the affected operation/size; it is not a desired Memory content size or permission to truncate saved state. Do not silently inject only part of current context and call it complete. Brain's transport ceilings are specified above; SS-owned bounds/deadlines still need a concrete client decision. No ranged-read operation is delivered and no implicit partial read is authorized.

### Human origin, ownership and context delivery

Use an owned session/generation and actual input origin, not merely `messageType: "user"`. Current sessions code recognizes owned `input` sources `interactive`/`rpc`; extension-generated user messages, helpers and visibly custom peer messages are not fresh human roots. Apply the same distinction without changing sessions transport or budgets.

- Exclude helpers before any Memory startup, context lookup, tools, marker creation or process launch. Their reference-scoped readers remain unchanged.
- Startup only registers inactive lifecycle state; no Memory/marker creation. On first eligible human prompt, resolve read-only before task work and deliver the selected current state as recalled project data, not overriding instructions or authorization.
- Keep scope in trusted host state. An ordinary model call must not supply executable, vault, arbitrary folder, personal-note path or another Memory ID.
- After compaction/relevant navigation, invalidate stale cached context and refresh the same authorized binding before using it. Navigation/reload/shutdown discards owner-bound pending candidates/approvals and cancels owned subprocesses; it does not delete or revert Brain state.
- Peer-triggered work can use the receiver's authorized capabilities, but cannot manufacture first-use human eligibility or human manual-edit approval. Later update integration must retain the same storage conflict guards.
- Do not turn one helper result, model/tool iteration, retry or peer message into an independent Memory. An empty or failed persistence attempt is not a successful durable update.

### Successful-turn persistence: confirmed policy, proposed mechanism

Pi 1.5.2's documented `agent_end` is a low-level-run boundary; retries, recovery, compaction or queued continuations can follow. `agent_before_settle` is actionable but may still request continuation and can be interrupted. `agent_settled` is final and carries `aborted`, but does not itself carry `completed` versus `error`; a non-aborted event alone is insufficient success evidence.

A possible design is an explicitly write-authorized, owner-bound in-memory candidate prepared by the existing primary agent, then a bounded host publication only after successful final settlement. An illustrative tool name is `ss_memory_stage` (visible label `Preparar memoria`); it would mean **prepared, not saved**, not persist a draft to history and not call a hidden summarizing model. The admission must pass write permission/tool hooks; denied or revoked work must never be committed later through an out-of-band subprocess. No staged candidate means no guessed update or extra model call. Exact tool/command registration is not selected yet.

**Confirmed future policy:** the user approved Memory-only publication after successful response completion, followed by an SS-owned visible saved/failed/pending result. The agent may prepare an authorized candidate during the turn, but must not claim preparation is a confirmed save. Failed/aborted/empty/greeting interactions create no new Memory; `aborted: false` alone is not success evidence. A useful completed interaction may report a task blocker: interaction completion is distinct from every requested task/check succeeding.

This narrow future Memory policy does not change the actual WORK_STATE workflow or authorize post-response work in this session. Existing FARO/method pre-final-save rules remain in force until the separately authorized implementation/cutover explicitly encodes the Memory-only distinction. Hook composition, success evidence, permissions and actual confirmation still require implementation and isolated verification; the approved policy is not a claim that a hook already solves those mechanics. No source/dependency/profile/migration authorization is inferred.

The eventual design must also handle multiple human inputs/steering, continuations proposed by other extensions, late cancellation, lifecycle generation changes and failures after publication. Do not introduce another provider request merely to finalize Memory. All this requires isolated lifecycle evidence before real activation.

### Exceptional states and user-visible behavior

- Missing referenced Memory: notify and offer creating a **new** Memory; do not silently replace the ID/marker. Denial, unavailable vault and I/O failure are not `not_found`.
- Manual edits: preserve bytes, show that acceptance is pending, and obtain actual human approval for those exact bytes. If approval is unavailable in a noninteractive mode, remain pending; no auto-accept boolean from the model.
- Conflict/busy: preserve the candidate only in bounded owner-scoped transient state, communicate with a known live writer when useful, and request a fresh read/review as appropriate. No polling, indefinite lock waits, fabricated live ownership or automatic merge/retry.
- Partial/unconfirmed publication: report what is known and unknown; leave normal SS usable. A failed Brain call must not silently synchronize into WORK_STATE or create another canonical record.
- Saved: show the actual returned identity/revision only after confirmed acceptance. Use short Spanish product headings and English protocol/agent text, reusing `extensions/presentation.ts`.

## Proposed SS file scope — not authorization to edit

| Path | Responsibility |
| --- | --- |
| `extensions/memory/index.ts` (new) | Primary-only registration, owned lifecycle, permissions, selected context delivery, short Spanish status/tool/command presentation. |
| `extensions/memory/client.ts` (new) | Direct executable launch, bounded/cancellable stdio, strict version/correlation/result validation; no Memory-file reads/writes. |
| `extensions/memory/state.ts` (new if separation is useful) | Human-root/generation/binding/candidate/approval state machine; never a second durable store. May stay in index if small. |
| `extensions/memory/README.md` (new) | Actual interface, consent/trust/lifecycle, outcomes and non-guarantees alongside implementation. |
| `extensions/memory/tests/` (new) | Client/state/registration tests and deterministic temporary CLI/Pi fixtures. Exact coherent suites follow the finalized contract; no fixed test-count target. |
| `package.json` (later modify) | Register the owned extension and its meaningful tests under existing Node/Pi tooling; no new npm dependency currently proposed. |
| `extensions/method/index.ts`, `extensions/method/assets/method.md` (separate cutover scope) | Select one continuity authority/recovery path only after Brain integration and implementation/verification of the approved Memory-only settlement policy; preserve WORK_STATE behavior when Brain is declined/disabled. No duplicate FARO method or permanent dual writing. |
| `README.md`, product contract and work state (relevant stage only) | Reflect implemented behavior and remaining limitations, not merely planned capabilities. |

Reuse presentation without changing helpers, sessions, web, native controllers, existing profiles or loading routes. New profile links/installer changes need separate applicable authorization, not a registration side effect. Keep the approved timing policy distinct from unapproved staging-tool/hook mechanics; implementation still needs its own authorized scope.

## Proposed checks and useful delivery outcomes

These are acceptance plans, NOT checks run by this work.

1. **Brain core/CLI:** temporary synthetic vault/folder fixtures covering the fourth model, parser preservation, full history and acceptance framing, lock/revision/byte checks, manual approval, child bindings/copies, concurrent creation, missing versus unavailable storage, and injected failures at publication boundaries. Preserve init/config/Note/Project/Task regressions. Initial file list, attributed dependency approval and reported commands are recorded in the verified handoff above; R1–R3 require focused follow-up coverage, not another generic planning round.
2. **SS connector in isolation:** deterministic child executables for valid/invalid/version-mismatched JSON, wrong ID/correlation, missing binary, timeout, cancellation, oversized/truncated output, nonzero exit, safe diagnostics and uncertain saves. Verify no shell, implicit install/build/network, whole-vault access or retry.
3. **Lifecycle and permissions integration:** deterministic Pi fixtures for first-human lookup before work, no startup/greeting/empty/failed/cancelled creation, no eager children, owner/generation invalidation, compaction recovery, retries versus true settlement, continuation ordering, helper exclusion and receiver write denial. Show that a denied candidate cannot later publish. Test reported save success separately from preparation. No paid-model/live-profile trial is implied.
4. **One-authority cutover:** a separate authorized outcome selecting Brain versus WORK_STATE, pre/post-compaction recovery and explicit unavailable-backend behavior. Only after functional proof and a deliberate migration may Brain replace the real operational record. Do not delete WORK_STATE or keep permanent synchronized canonical copies by default.
5. **Optional installer:** later, separately authorized opt-in download/setup/version/integrity/selected-vault/loading-route flow; opt-out retains WORK_STATE. No current installer/dependency/profile permission.

Use coherent behavior boundaries rather than one task per file or a mandatory full suite after every edit. Cross-repository temporary integration, OS-lock portability and Obsidian graph behavior require their own observed evidence; none is established by a source-only plan. Independent reviews complement tests, and historical H1 checks do not verify its replacement.

## Source evidence and open decisions

Parent inspected the current SS `main` with only design/continuity documents modified before this new plan; no source/package change was made. Relevant planning references:

- `extensions/sessions/index.ts:24–26,120–143,212–216`: helper exclusion, owned genuine-input handling, actionable versus final lifecycle and custom peer injection.
- `extensions/method/index.ts:22–42,63–75`: FARO injection, recovery after compaction/navigation, pre-final continuity-save requirement and no post-response work.
- `package.json`: four current extensions, existing test runner and no Memory extension/Brain dependency.
- Installed Pi package `@earendil-works/pi-coding-agent@1.5.2`, `docs/extensions.md:311–424,615–750,1112–1158,1231–1257` and `dist/core/extensions/types.d.ts:740–859`: lifecycle, origins, continuation/abort/result fields and signal limitations. These are selected planning excerpts, not an implementation-time full-doc/example review or runtime exercise.

Pending outside completed Brain correction: no further code/result/helper is outstanding. Acceptance notice was not delivered because CONTEXT_MISMATCH; no automatic retry/renewal/alternate channel. SS client/lifecycle/host permission/manual approval/status, optional installer and single-authority migration remain separate proposals requiring applicable scope/authority. Existing approved Cargo and normal-Markdown decisions remain settled; no new package/toolchain/live/Git action.
