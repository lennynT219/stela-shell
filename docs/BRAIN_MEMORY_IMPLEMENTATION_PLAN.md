# Brain Memory technical plan

Status: Brain R1/R2/R3 CLOSED within reviewed scope on final .N9bkmy/dd9da947... (98 logged tests, four matching-BIN oracles, parent8/8 exact-byte CLI replay). No code/result/helper pending. Acceptance reply to6690... failed CONTEXT_MISMATCH, not delivered/retried; not a code-proof blocker. Core remains local/uncommitted, Cargo frozen, Brain sole writer. SS pre-final runtime/tools exist locally with isolated checks and a separately authorized actual-provider/public-RPC trial in the Brain repository: normal profile/default model, create/fresh-session recall/same-identity update passed, with a later ordinary provenance correction. No integration code fix was needed. Permanent activation/cutover/installer and Brain-repository Git remain separate. Earlier documentation delivery is fulfilled; the human now explicitly authorizes SS Memory commit/push, without Brain Git, installation/activation or new functional runs. Contract: [BRAIN_MEMORY_CONTRACT.md](BRAIN_MEMORY_CONTRACT.md); continuity: [WORK_STATE.md](WORK_STATE.md).

**Historical SS checkpoint, before 05 naming and executable discovery:**41 focused Memory passes; final integrated281pass/24Windows-only-skip/0fail/305total. Includes15 deterministic actual Pi+accepted-Brain cases. New runtime is implemented locally and its bounded normal-profile/real-model trial passed; it is not permanently activated/migrated. Both client/runtime independent source reviews timed out without an answer and remain incomplete. Current receipt and limits: [WORK_STATE](WORK_STATE.md).

## SS Memory activation — no startup flags

The human explicitly removed every Memory flag and selected extension loading as
authorization for ordinary read/save use. Executable selection is nonblank
BRAIN_BIN or brain from PATH. Brain's own existing configuration selects the vault;
the host opts into that backend mode instead of parsing TOML or requiring a
duplicate vault parameter. The opened cwd is the internal boundary; no enclosing
project/parent/root is implicitly searched. Normal Pi tool controls remain, and
exceptional manual acceptance/replacement still needs actual exact-byte UI approval.

The executable/environment are owned per context. A lazy metadata-only guard
observes Brain's platform-specific config pathname before/after access and rejects
observed drift for the old owner. It does not parse/read config content or create
it. If drift is observed after a saved receipt, publication remains acknowledged,
read-back is unavailable and future writes are fenced across owners until explicit
complete read reconciliation. No retry, rollback, automatic initialization,
installer/profile activation or WORK_STATE cutover follows from extension loading.

Backend source helper359a9021 returned PARTIAL evidence: exact config/env rules and
the client's existing allowConfiguredVault opt-in are established, but store-level
vault-identity payloads were outside its references. No atomic vault pinning is
claimed: transient edits, metadata collisions, symlink/ancestor retargeting and
config-load races remain limitations. Narrow source reviewc15aca89 completed and found detected config drift during
read-back could escape the shared fence. Parent corrected state.ts to apply scope
annotation/fencing both before and after read-back without losing the acknowledged
receipt or retrying writes. The final correction has parent source inspection and
prepared regression source only, not executed or independently reassessed. Old review02b11c79
covered the superseded CLI-override source only; broader client/runtime reviews
remain incomplete. Adapted/new regression sources are prepared but NOT executed.
User still forbids assistant-run labs/tests/Brain/Pi/provider runs. Brain source,
profile links, installed binary/configuration and dependencies are unchanged.
See [configuration and limits](../extensions/memory/README.md).

## Canonical area rename — code complete, no further trial authorized

The later human-requested spelling is `05-memorias/`, not `Memorias/`. Brain's
naming-only source/tests/docs unit is complete in
`/tmp/brain-memory-05-rename.b3CiQN`, binary SHA256
`466420652fcdc28b09fb4530018a2c0ba084d78ce1ab8c66a12e54728ed0060b`.
Observed checks:101 tests (independently expected98+3), clippy/fmt/build offline;
parent verified30 manifest entries,20 preserved old inputs and7 inverse hashes
establishing existing Rust changes are name/format-only. No repeated parent suite
or external old-name oracles. SS's two path-dependent test files/docs now use the
new spelling, with production client/state/entry point unchanged at that naming
checkpoint; the later SS-only executable-selection change is separate above.
No subsequent SS functional suite or live-model run was launched. The human
subsequently rejected labs/tests, superseding the earlier manual-trial plan.

No migration was added/applied. The previous revision3 Memory/binding/history
remain at the old path, paired with the old binary. Pure directory/header moves
cannot safely convert accepted snapshots; `not_found` from the new layout does
not establish absence under the old area. Do not invoke `replace_missing`, rewrite
accepted history, delete old data or copy that binding into a new context.
No new context/vault, global setup, migration or publication is authorized.

## Completion boundary and ownership

Completed Brain R1 unit covers source/tests/docs and isolated synthetic checks, preserving scoped R2/R3/Note/Project/Task/init/config. Parent's narrow human-approved Cargo/lock/necessary-cache exception is finished; no current dependency gate or new protected permission. Brain remains sole application writer; parent reviewed source/provenance and temporary CLI behavior, not live vault/SS/cutover or publication.

- **Brain primary:** sole application-code/test/docs writer; authorized R1 correction returned as6690... and passed scoped parent acceptance. No additional correction assigned. Parent acceptance notice itself was refused CONTEXT_MISMATCH, so receipt/status alignment there is unconfirmed; do not use another route automatically. Existing unrelated local work, Cargo/features/lock and source ownership remain preserved.
- **Parent:** owns SS design/continuity docs and read-only Brain review. Actual human-approved Cargo exception finished: appended exact manifest entry, inspected accepted lock/cache and verified offline. No parent Brain application/test/docs edits; sole code ownership stays with Brain.

## Fixed product requirements

- A fourth `Memory` model represents persistent work context, not an individual fact/message. Project association is optional; preserve Note/Project/Task semantics and existing init/config.
- Working-folder `.brain.toml`: `binding_version = 1`, `memory_id`, optional explicit relative `memory_subfolders`. No vault path, content/history, Project, executable or permissions in the marker.
- Vault layout: `05-memorias/<memory-uuid>/Memoria.md` and `Historial.md`; marker UUID, directory UUID and current `brain_id` must agree. No catalog, ordinary index Note, task index or automatic Project. UUID is identity/locator, not authority.
- Only an own marker or explicit parent declaration creates an independent child context. Materialize that child's marker upon actual creation; do not eagerly create declared children. Copies/moves keep the same Memory identity.
- Resolve/read existing Memory at the first genuine human prompt, before work. Create a new Memory and marker only for useful authorized work, through an ordinary save tool with actual confirmation BEFORE the final user reply, following the explicitly adopted Gentle/WORK_STATE order. Startup, greetings and empty interactions do not create Memory automatically; cancellation before submission creates nothing. Later response failure/cancellation does not undo a confirmed save. Subsequent meaningful changes update the same Memory.
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

## Isolated SS client — resumed first unit

The human resumed Memory after communication publication/manual refresh. The first local unit implements extensions/memory/{client,protocol}.ts and deterministic/opt-in real-Brain tests:11 focused passes; integrated251pass/24Windows-only-skip/0fail (275total). That checkpoint established only the client, without a Pi entry point/tool/hook/registration; the later bounded pre-final runtime below adds those, not automatic/permanent activation or cutover. A subsequent separately authorized bounded actual-provider/RPC trial is recorded in the current status above. Independent client review dac6c276 timed out180s without an answer, INCOMPLETE/not pending/not retried; parent tests do not replace it. Parent owns these SS files; Brain remains read-only and its accepted core/Cargo is not reopened. Current checks/review state and limitations: docs/WORK_STATE.md; actual interface: extensions/memory/README.md.

Direct absolute trusted executable, one child/no queue, explicit selected vault (or host opt-in to existing configuration), minimal env, bounded EOF stdio and monotonic10s deadline; no probe/init/build/download/retry. Full u64 values use source-aware JSON plus rawJSON rather than rounded JavaScript numbers. Mutation transport ambiguity is save_unconfirmed, never assumed saved or rolled back. Exact response schemas were checked against the imported store/binding types after the transport helper identified missing-reference limitations. No live Memory access, runtime persistence, installer/profile change, authority migration or new commit/push is included. The human has now authorized the next SS-owned lifecycle/permission/manual-approval/status unit with isolated Pi tests, excluding real-vault/profile activation, installer work and WORK_STATE cutover. The human replaced the blocked post-response design with pre-final normal-tool publication; the owned runtime unit below now implements it without a Pi patch. The transport library alone is not the permission/lifecycle layer.

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
- Startup registers tool declarations and configured transient lifecycle state only; no process/lookup/Memory/marker creation. Unconfigured tools refuse execution. On first eligible human prompt, resolve read-only before task work and deliver the selected current state as recalled project data, not overriding instructions or authorization.
- Keep scope in trusted host state. An ordinary model call must not supply executable, vault, arbitrary folder, personal-note path or another Memory ID.
- After compaction/relevant navigation, invalidate stale cached context and refresh the same authorized binding before using it. Navigation/reload/shutdown discards owner-bound pending candidates/approvals and cancels owned subprocesses; it does not delete or revert Brain state.
- Peer-triggered work can use the receiver's authorized capabilities, but cannot manufacture first-use human eligibility or human manual-edit approval. Later update integration must retain the same storage conflict guards.
- Do not turn one helper result, model/tool iteration, retry or peer message into an independent Memory. An empty or failed persistence attempt is not a successful durable update.

### Pre-final publication — adopted and implemented locally

The human explicitly chose Gentle/WORK_STATE order: prepare useful authorized state, publish and observe the actual result through ordinary Memory tools, THEN send the final user response. This replaces the former post-response settlement proposal and resolves that design blocker without modifying Pi. No hidden summarizer, extra finalization model turn, delayed mutation or completed-tool-context replay.

Local implementation: extensions/memory/index.ts + state.ts register ss_memory_read (Leer memoria) and ss_memory_save (Guardar memoria), with normal Pi tool hooks. Extension loading authorizes ordinary use with no startup flags. BRAIN_BIN or brain from PATH resolves once per owner; Brain's existing configuration owns vault selection, and cwd is the internal boundary. Startup may inspect executable metadata, never run Brain or create Memory; config metadata is captured lazily on first genuine read. Genuine interactive/RPC input enables scoped read-only resolve before work; helper exclusion precedes tools/lifecycle/resources. Recalled complete accepted Markdown is ephemeral untrusted provider context, not another canonical store. Models cannot supply scope, identity, expected revision/bytes or approval booleans.

The primary, as with WORK_STATE, decides whether meaningful durable state changed; there is no hidden semantic classifier. An ordinary save revalidates the same binding and exact baseline, publishes once through Brain and attempts identity/revision read-back. Existing updates take a complete body without YAML; Brain owns all Markdown/frontmatter/history interpretation. Changed bindings/manual bytes require explicit refresh/review, never baseline substitution, merge or identity allocation. No lifecycle hook creates or saves Memory.

Manual acceptance requires actual UI approval of exact observed/candidate bytes and revalidation after the dialog. Missing-reference replacement obtains raw marker bytes from Brain inspect_recovery, verifies no partial artifacts, displays the exact old identity/marker/proposed context for actual UI approval, rechecks, then invokes replace_missing. No SS marker parser/file manipulation; without UI approval these operations stay pending.

Input/steering, compaction and navigation cancel/invalidate stale state; new owners require genuine input. Failed automatic lookup is not repeatedly retried by context hooks. Denied tools/default read-only mode/pre-submission cancellation create nothing. A lost mutation receipt is save_unconfirmed and fences writes across owner changes; automatic reads do not clear it. Only an explicit read of a complete found binding can reconcile current state for future work, not retroactively confirm the old receipt. Once a valid receipt exists, later read-back/response cancellation cannot undo or relabel that save.

Current observed new evidence:15 state/extension tests and15 deterministic actual Pi+accepted-Brain cases pass. Native cases cover pre-final create/update/no-op, greeting/startup, deny/read-only/disabled/helper/abort, stale manual change, actual yes/no UI approval for edits/missing references, new session, continuation, steering, abort after saved and actual receipt loss. Compaction invalidation is fake-host evidence, not an actual compaction/provider-overflow matrix. Integrated suite/closure counts are recorded in WORK_STATE after verification.

New runtime review task-9f7256c6-d393-4c22-abfe-31a692b161cd FAILED180s without an answer; no approval, finding or retry. All four refs matched the frozen snapshot through timeout; later parent-only feedback/state/receipt/cache/owner corrections and tests are not independently assessed. Prior client review remains separately incomplete. Initial lookup generic-error retry and a native fixture's incorrect rejection of nonblocking setStatus events were corrected without weakening write guards. Parent then reproduced two stale-input regressions: late cancellation/confirmed-receipt completion could overwrite the next input's required lookup state. Final guards preserve newer state while retaining a confirmed receipt or activation-wide uncertainty fence. Parent also reproduced cached-data delivery after reader/configuration revocation and overlapping navigation bypassing an outstanding close; final guards recheck delivery authority, capture configuration and share the close barrier. Explicit read receipts now contain only metadata, with full Markdown delivered ephemerally. These corrections have parent regression evidence, not a completed independent assessment.

### Retired post-response dispatch question — not a current blocker

Pi1.5.2 agent_end is not final, agent_before_settle may continue, and agent_settled is notification-only and lacks a completed/error outcome. Source helper def624ea correctly established that captured executeTool is not a documented post-parent-lifetime executor and loses normal parent recording/cancellation semantics. That finding still applies to the retired design, but no longer requires a product decision or a Pi host patch. Current writes are normal awaited tools before the final reply. Keep Pi source/installed SDK unmodified.

#### Gentle reference and evidence limits

Clean local gentle-pi4.7.0 main@3c2773a4d451b4162d3049fe4135f22041449fb5 uses the optional gentle-engram companion. Helper5ad5be58 provided PARTIAL policy/test evidence: local progress first, Engram mirror on meaningful transitions/changes and at close; no independent final-order/runtime proof from those four refs. Parent read the public [provider protocol](https://raw.githubusercontent.com/Gentleman-Programming/engram/main/plugin/pi/index.ts), whose DELIVERY GUARANTEE explicitly requires memory work before composing the completed-task reply, with no later tool calls. Eligible non-Engram outputs may yield structured passive learnings; final assistant responses are explicitly not automatically captured. The [manifest](https://raw.githubusercontent.com/Gentleman-Programming/engram/main/plugin/pi/package.json) self-declares0.8.0 on mutable main; published/loaded version is unknown. Extraction was partial, but cited paragraphs were complete; no Gentle live session/store was exercised. The human adopted the pre-final ordering, not Engram, a permanent local/Memory mirror or a host fork.

### Exceptional states and user-visible behavior

- Missing referenced Memory: notify and offer creating a **new** Memory; do not silently replace the ID/marker. Denial, unavailable vault and I/O failure are not `not_found`.
- Manual edits: preserve bytes, show that acceptance is pending, and obtain actual human approval for those exact bytes. If approval is unavailable in a noninteractive mode, remain pending; no auto-accept boolean from the model.
- Conflict/busy: preserve the candidate only in bounded owner-scoped transient state, communicate with a known live writer when useful, and request a fresh read/review as appropriate. No polling, indefinite lock waits, fabricated live ownership or automatic merge/retry.
- Partial/unconfirmed publication: report what is known and unknown; leave normal SS usable. A failed Brain call must not silently synchronize into WORK_STATE or create another canonical record.
- Saved: show the actual returned identity/revision only after confirmed acceptance. Use short Spanish product headings and English protocol/agent text, reusing `extensions/presentation.ts`.

## SS file scope and remaining boundaries

| Path | Responsibility |
| --- | --- |
| `extensions/memory/index.ts` (implemented locally) | Primary-only flag-free tools/lifecycle, extension-load authorization/current tool controls, cwd context and short Spanish status. |
| `extensions/memory/client.ts` (isolated unit implemented) | Direct executable launch, bounded/cancellable stdio; no Memory-file reads/writes or Pi registration. |
| `extensions/memory/protocol.ts` (isolated unit implemented) | Strict framing/version/correlation/typed results, lossless full u64 and bounded plain-JSON serialization; no Markdown/marker interpretation. |
| `extensions/memory/state.ts` (implemented locally) | Human-root/generation/binding/baseline/actual-approval state and uncertainty fence; ordinary pre-final writes, never a second store. |
| `extensions/memory/README.md` (updated) | Actual runtime/client configuration, scopes, limits, approval, pre-final outcomes and verification limitations. |
| `extensions/memory/tests/` (extended) | Client/codec, executable resolution, state/entry-point and actual Pi/Brain regression sources. Observed old-layout checks and later unexecuted additions are distinguished above; opt-in binaries/disposable data only, no fixed count target. |
| `package.json` (updated) | Retains the four existing entries and adds Memory; test script covers its suites. Dependencies unchanged. Existing manifest expectation extended without weakening its dependency/session/web checks. |
| `extensions/method/index.ts`, `extensions/method/assets/method.md` (separate cutover scope) | Select one continuity authority/recovery path only after Brain integration and implementation/verification of the approved pre-final Memory policy; preserve WORK_STATE behavior when Brain is declined/disabled. No duplicate FARO method or permanent dual writing. |
| `README.md`, product contract and work state (relevant stage only) | Reflect implemented behavior and remaining limitations, not merely planned capabilities. |

Reuse presentation without changing helpers, sessions, web, native controllers, existing profiles or loading routes. New profile links/installer changes need separate applicable authorization, not a registration side effect. Keep the approved timing policy distinct from unapproved staging-tool/hook mechanics; implementation still needs its own authorized scope.

## Proposed checks and useful delivery outcomes

Brain core, isolated client and the new bounded pre-final runtime have observed checks recorded above/in WORK_STATE. Cutover/installer and broader lifecycle matrices remain acceptance plans, NOT activation or comprehensive certification.

1. **Brain core/CLI:** temporary synthetic vault/folder fixtures covering the fourth model, parser preservation, full history and acceptance framing, lock/revision/byte checks, manual approval, child bindings/copies, concurrent creation, missing versus unavailable storage, and injected failures at publication boundaries. Preserve init/config/Note/Project/Task regressions. Initial file list, attributed dependency approval and reported commands are recorded in the verified handoff above; R1–R3 require focused follow-up coverage, not another generic planning round.
2. **SS connector in isolation:** deterministic child executables for valid/invalid/version-mismatched JSON, wrong ID/correlation, missing binary, timeout, cancellation, oversized/truncated output, nonzero exit, safe diagnostics and uncertain saves. Verify no shell, implicit install/build/network, whole-vault access or retry.
3. **Lifecycle and permissions integration:** deterministic Pi fixtures for first-human lookup before work, no automatic startup/greeting/empty creation, no eager children, pre-submission cancellation/denial, owner/generation invalidation, compaction recovery, continuation ordering, helper exclusion and write denial. Confirmed publication must survive later response cancellation. Show that a denied candidate cannot later publish. Test reported save success separately from preparation. No paid-model/live-profile trial is implied.
4. **One-authority cutover:** a separate authorized outcome selecting Brain versus WORK_STATE, pre/post-compaction recovery and explicit unavailable-backend behavior. Only after functional proof and a deliberate migration may Brain replace the real operational record. Do not delete WORK_STATE or keep permanent synchronized canonical copies by default.
5. **Optional installer:** later, separately authorized opt-in download/setup/version/integrity/selected-vault/loading-route flow; opt-out retains WORK_STATE. No current installer/dependency/profile permission.

Use coherent behavior boundaries rather than one task per file or a mandatory full suite after every edit. Cross-repository temporary integration, OS-lock portability and Obsidian graph behavior require their own observed evidence; none is established by a source-only plan. Independent reviews complement tests, and historical H1 checks do not verify its replacement.

## Source evidence and open decisions

Original planning checkpoint: parent inspected SS `main` with only design/continuity documents modified; no source/package change existed THEN. The later isolated client/source and test-script changes are recorded above. Original planning references (line numbers may predate the communication correction):

- `extensions/sessions/index.ts:24–26,120–143,212–216`: helper exclusion, owned genuine-input handling, actionable versus final lifecycle and custom peer injection.
- `extensions/method/index.ts:22–42,63–75`: FARO injection, recovery after compaction/navigation, pre-final continuity-save requirement and no post-response work.
- `package.json` at original planning: four extensions and no Memory entry/Brain dependency. It now includes the fifth Memory entry and tests; no dependency was added.
- Installed Pi package `@earendil-works/pi-coding-agent@1.5.2`, `docs/extensions.md:311–424,615–750,1112–1158,1231–1257` and `dist/core/extensions/types.d.ts:740–859`: lifecycle, origins, continuation/abort/result fields and signal limitations. These are selected planning excerpts, not an implementation-time full-doc/example review or runtime exercise.

Pending outside completed Brain correction: no further Brain code/result/helper is outstanding. Acceptance notice was not delivered because CONTEXT_MISMATCH; no automatic retry/renewal/alternate channel. The isolated SS client remains functionally checked with its independent-review timeout explicitly incomplete. The SS lifecycle/permission/manual-approval/status unit is implemented locally and the separately authorized normal-profile/actual-provider RPC trial passed in the Brain test repository; keep Pi unmodified. Runtime source review9f7256c6 timed out180s without an answer and is incomplete, not pending/retried. The human explicitly selected pre-final normal-tool publication; that runtime exists and the earlier post-response executor question is retired. The bounded trial preserved one UUID through revisions1→2→3, including ordinary correction of controller-versus-human evidence attribution, with no integration code fix. Installer, permanent activation, private-data access and single-authority migration remain separate. Helper def624ea completed source evidence, not runtime verification; no helper is pending. Existing approved Cargo and normal-Markdown decisions remain settled; no further package/toolchain/live/Git action follows from completion.
