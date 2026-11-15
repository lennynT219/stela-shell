# Brain project-memory contract — proposal

Status: product vision, initial access boundary, shared project-collection ownership and revision-based logical updates are confirmed by the user. Concrete schema/API/storage details remain a design proposal, not an implementation or complete technical approval. No installation, service activation, data capture or connector implementation follows from this document.

## Confirmed intent and access boundary

Brain is the user's general second brain: projects, personal notes and other knowledge. Project memory is one capability within Brain, not a separate StelaShell-owned knowledge store.

The user wants durable project memories that can be created, found/read and edited/updated. Initial StelaShell policy:

- Automatically manage the agent's own memories within the active project.
- Require explicit user direction to access/modify personal notes or consult other projects.
- Do not interpret this as permission to capture entire conversations, copy secrets, overwrite human edits or treat recalled text as instructions/authorization.

A direction to read one personal note or another project's item is not permission to edit it, search the entire vault, follow all its source links or reclassify it as agent-owned.

## Responsibilities

- **Brain:** durable knowledge, memory identity, storage, source attribution, scoped retrieval and safe memory changes.
- **StelaShell:** trusted project binding, permission-aware tool integration, bounded context delivery and FARO/session/helper lifecycles.
- **WORK_STATE.md:** the canonical compact operational snapshot; see [the current record](WORK_STATE.md). Historical memories do not silently replace current decisions or active task state.
- **Git, original sources and tests:** authoritative artifacts/evidence in their own domains; a memory is not a substitute for them.

Do not expand the read-only helper role or add a second memory database merely to implement this connector.

## Domain model and trusted binding

A managed Brain Note with a project-memory role is the recommended starting point, not a new top-level Memory type by default. In the inspected Brain baseline, Note has common metadata only; project linkage belongs to Task. Project/role/owner/memory fields on Note would be schema extensions requiring a deliberate compatibility decision.

Before an automatic operation, trusted host state must bind:

1. The explicitly selected vault.
2. A verified existing Brain Project UUID.
3. The approved logical agent owner/collection.
4. The allowed operations and their scope.

The repository-to-project association must be confirmed. A global active-vault pointer, current directory, path, frontmatter marker or caller-selected UUID does not grant authorization. Missing or ambiguous binding fails closed. The model must not choose broader scope through ordinary tool arguments.

**Logical ownership is confirmed by the user:** one StelaShell-managed memory collection per project, shared across authorized sessions using the same confirmed binding. Session identity is provenance, not private ownership or the lifetime of the memory. A new session can reuse the collection without inheriting broader permissions. Concrete owner identifiers, schema encoding and binding configuration remain technical design choices; shared ownership does not grant access to personal notes or other projects.

## Proposed operations

Exact command names, wire fields, schema versions and numeric limits are not selected yet. The following are domain semantics, not available commands.

| Operation | Required behavior |
| --- | --- |
| Create | Accept title/body, claim kind and provenance in the bound collection; allocate a stable memory UUID and content revision. An operation/request key should prevent duplicate creation after repeated delivery, without introducing automatic retries. |
| Find | Start with lexical retrieval filtered to the bound project/owner. Return bounded snippets, IDs and sources, never an implicit whole-vault search or transcript dump. |
| Read | Resolve a memory ID inside the authorized scope; return bounded content, revision, sources and an explicit truncation indicator. |
| Update | Require memory ID, expected content revision and an explicit logical change. Preserve human material, unknown properties, sources and untouched content. The publication mechanism is pending the strategy decision below; do not change project/owner as a side effect. |

No automatic deletion is requested. Supersession, where used, retains links to earlier claims and evidence rather than silently erasing history. No semantic/vector backend is necessary to establish the first useful workflow.

## Proposed result and evidence semantics

A result should expose enough structured metadata to interpret it without repeating the full content:

- Contract version and stable project/memory identity.
- Logical owner/role and title.
- Bounded content or snippet, with explicit truncation.
- Content revision and update time; current/superseded state where applicable.
- Claim kind distinguishing source observations, recorded user decisions and agent inferences.
- Provenance: source identifiers/locators and source revision or observation time when known.
- Explicit unavailable, stale, partial or error states rather than invented certainty.

Attribution is not verification. Unknown evidence stays unknown; do not generate unsupported confidence scores. Recalled historical user decisions are not fresh approval for protected actions.

`brain_version` describes schema compatibility, not content freshness. Task status is not truth/confidence. Content revisions must identify the represented original bytes/snapshots; editable-view changes need separate divergence detection rather than silently inheriting an accepted revision. Timestamps alone are not concurrency tokens. Source applicability/freshness must be checked where possible or marked stale/unverified.

Candidate error categories: unbound/ambiguous, denied/out-of-scope, not found without unauthorized-existence leaks, unsupported schema, invalid input/provenance, revision conflict, needs review, and preservation/I/O failure. Exact serialization remains a proposal.

## Safe updates are a prerequisite, not an assumed property

The user selected option B; option A remains below only to explain its restrictions. This is design reasoning, not a verified implementation. Neither strategy promises to retain arbitrary edits Brain never observed. Metadata structs are not a preservation codec; source snapshots must retain authorized original bytes, unknown properties and human text.

### Option A: in-place patches

A preservation-aware patcher, expected revision and per-memory lock can coordinate cooperating Brain writers. Hash-check followed by temporary-file rename is **not compare-and-swap** against a noncooperating Obsidian editor; backups/rechecks narrow but do not close that race.

Known manual drift or an unsafe merge requires review. If the guarantee is never overwriting an unseen external edit, automatic in-place update remains unavailable unless an exclusive edit window or editor cooperation is established. Lack of detected drift is not proof of exclusivity.

### Selected option B: logical updates through new revisions

The user accepted revision-based logical updates with a separate human-editable view. The mechanism introduces storage/schema behavior not supplied by the current metadata or reader research; concrete implementation and guarantees are not yet established.

- Keep stable memory/project/collection identity. Each write-once successor has a revision ID/digest, parent revision(s), content, original-byte snapshot references and source/session provenance.
- Publish unique records without replacing existing files. Coordinate Brain writers, compare the expected logical head and reject stale updates. Derive heads from validated parent links or an equally coordinated selection record, not filename, modification time or session order.
- Multiple heads are a conflict: retain the branches and return needs_review, never silently select a winner. Explicit reconciliation may produce a successor citing both parents. Current means a resolved logical head; superseded retains history, not proof the earlier claim was false.
- Keep a human-editable source/working view separate and untouched by automatic publication. Divergence from its recorded base must be reported rather than silently treating a successor as reconciled with human edits. Accepting manual edits into revisions needs an explicit policy; do not capture unrelated notes.
- All participating revision-store writers must respect write-once records. A same-user filesystem convention is not tamper protection. Arbitrary editors must use the separate editable view/copy; if they rewrite/delete revision records too, immutability cannot be promised.

Append-only publication prevents Brain from overwriting source notes through that path; it does not by itself solve head selection, semantic conflicts, human-edit capture or arbitrary-editor interference. The chosen behavior is revision-based logical update with a separate editable view. Automatic same-note replacement is not the selected first design; adding it would require a separate decision and the necessary cooperation/exclusive-window guarantees.

The requested create/read/update capability must not be reported complete while the chosen safe-update behavior is missing.

## Integration recommendation and implementation prerequisites

Prefer a small, versioned JSON CLI interface consumed by a StelaShell connector whose scope comes from trusted host state. Conditional structured output aligns with Brain's reported CLI design, but it is not implemented as a memory interface today.

No daemon, model, vector database, framework or second StelaShell memory store is currently justified. Any new dependency would still require its applicable approval; this proposal is not a dependency decision.

The inspected Brain baseline provides init/config commands and metadata validation, not content operations or retrieval. Prerequisites are:

1. Preservation-aware Markdown/frontmatter reading and schema compatibility rules.
2. Verified project resolution, repository binding and logical ownership.
3. Safe creation and the selected update strategy: preservation-aware coordinated patches or unique revision publication/parent validation, with evidenced conflict and human-edit behavior.
4. Scoped lexical retrieval with finite count/text/I/O bounds and explicit result/error states.
5. A structured interface, then a permission-preserving StelaShell connector.

A read/create-only early delivery can be useful, but would remain incomplete against the requested update behavior. No runtime or profile loading route is changed by this plan.

The user authorized H1 implementation and isolated synthetic tests; both planning results are received and the required preimplementation scope/files/structure summary has been SHOWN. The first code handoff was rejected with `Message expired or has an invalid lifetime`; it was not retried or migrated. The subsequent isolated diagnosis reproduced the ordinary ten-minute lineage restriction, but did not capture the failed envelope's actual clock/expiry. The separately approved [sessions work context](SESSIONS_WORK_CONTEXT_PLAN.md) is now implemented and functionally checked, with its independent review still incomplete. The user then reported manually reloading Brain and this parent and explicitly requested resuming implementation. A NEW work-root H1 assignment to Brain's freshly discovered activation was accepted for delivery with a fixed 60-minute communication window. This is not a commitment/start/completion receipt, task-runtime/cost guarantee or renewal of the expired thread. Brain must verify current source/permissions before writing and remains the sole Brain writer. All H1 restrictions below remain; dependencies/new scope/protected actions require their own authorization. Brain now reports a working main lifecycle and passing focused lifecycle/divergence/branch/bounds/process-contention tests, with offline dependencies available on the expected baseline. Final publication-failure/uncertain-I/O evidence, docs/regressions and review readiness remain pending. This is peer-reported intermediate progress, not parent-verified H1 completion.

### Concrete H1 plan from Brain

This is a library-only bound archive primitive, not the general Markdown/YAML reader or a working StelaShell integration. It receives a trusted supplied `DocumentMetadata::Project` and caller-supplied UUIDs; it validates metadata/membership but does not prove repository mapping, consent or real-vault project existence. The separately blocked file-model reader block 2 is not resumed by H1.

Approved Brain file boundary (current existence/ownership must be checked by the Brain writer before changes):

```text
src/lib.rs                         modify: retain document, export memory
src/memory/mod.rs                  new: binding, IDs, API/results/errors
src/memory/store.rs                new: framing, locking, publication/heads
tests/memory_store.rs              new: isolated lifecycle/conflict/process tests
docs/PROJECT_MEMORY_STORE.md       new: provisional API/format/limits
docs/WORK_STATE.md                 new: Brain continuity for the authorized unit
```

No changes are planned to `document.rs`, main/CLI/config/vault, Cargo manifests/lock/features, existing tests, odd/, the Brain/ vault or .codegraph. Existing tracked/untracked work must be preserved. Brain is the sole source writer; parent owns these StelaShell docs, with separate read-only review when concrete implementation is available.

Proposed API: `create_from_view`, `read_revision`, `read_current`, `publish_successor`. The caller creates the agent-memory view first; creation snapshots it and publication never rewrites it. H1 does not generate IDs or author/generalize Markdown.

```text
<root>/<project-uuid>/stela-shell/
  .writer.lock
  <memory-uuid>/
    view.md
    revisions/<positive-number>.bmr
```

The provisional single-file record has a magic marker, checked header length, versioned TOML header and exact raw payload. Numeric revisions are allocated/validated under the cooperating-writer lock, not cryptographic digests or timestamps. Original-byte comparisons support editable-view/base checks; there is no history-authenticity/tamper-proof claim. Validate rooted parent graphs and retained competing heads; unique no-clobber publication must distinguish pre-commit, committed and uncertain I/O outcomes. Document finite bounds and duplicate-memory-ID behavior without claiming exactly-once creation.

A clean but old editable view may be view_stale after a successor, while manual changes relative to its OWN base require needs_review. Manual import/reconciliation, full search, CLI/skill/connector, real-vault activation and profile/service changes are excluded. A trusted stable parent directory is a precondition, not a malicious-same-user sandbox.

Brain reports Rust/cargo 1.100.0 and existing std/direct-crate primitives sufficient for this plan: std file locks require Rust >=1.89; current serde/toml/tempfile/uuid are used without generation/features/dependency changes. This is inspection evidence, not an offline-cache/build verification. The 800–1100 authored-line forecast includes code/tests/docs and is not permission to expand the separately blocked reader scope or override restrictions.

Approved offline checks, awaiting the implementer's observed results:

```sh
cargo test --locked --offline --test memory_store
cargo test --locked --offline --lib
cargo test --locked --offline --test cli_init --test cli_config
# Scoped rustfmt --check for the touched Rust files.
```

Missing offline artifacts are a blocker, not download permission. All fixtures must be temporary/synthetic; no source-note overwrite, automatic import, real-vault write, new dependency, external/model trial, branch/commit or publication is authorized. H1 includes logical update but is not the complete memory feature.

## H1 planning checklist and isolated acceptance

The independent StelaShell review examined the contract/continuity only, not Brain source or runtime behavior. The following are acceptance expectations, not evidence of executed tests. Find/search, manual import/reconciliation and the connector remain outside H1.

Before code, the current-source plan must explain:

- Trusted synthetic binding representation and minimal record/view/base-snapshot layout, including compatibility with existing Brain metadata.
- The exact record framing/raw-byte domain, any implemented integrity checks, head/parent validation, writer coordination and divergence check points. Numeric revision identity does not imply a cryptographic digest or tamper protection.
- Finite read limits, explicit result/error states and whether historical revisions remain readable with an explicit non-current/conflicted state.
- The publication commit point, collision/failure cleanup and treatment of durable valid orphans; no implied multi-file transaction or crash durability.
- Minimal creation request-key/idempotency behavior or its explicit deferral. Do not imply exactly-once creation.

| Case | Independently expected outcome |
| --- | --- |
| Binding and identity | Missing/ambiguous binding denies without reads/writes. Forged project/owner/path or project-B ID cannot broaden access or disclose unauthorized existence. Authorized sessions share collection identity but retain distinct provenance. |
| Logical update | Create R0, then R1 with expected R0: stable memory/project/collection; distinct revisions; validated R1→R0 parent; R0 remains readable and the editable view stays unchanged. |
| Stale/cooperating writers | After R1, expected R0 conflicts without implicit rebasing. Two synchronized cooperating writers from R0 permit at most one current success; the other conflicts. |
| Competing branches | Separately seeded valid competing heads remain retained and return needs_review, not a filename/time/session-based winner. Coordination need not create branches for a rejected stale writer. |
| Manual divergence | Change body and unknown frontmatter in the editable view: report needs_review without importing/overwriting it. Compare the view to its OWN recorded base, not the latest generated body; an unchanged view based on R0 need not match R1. |
| Byte preservation | Original comments, unknown keys and line endings match the authorized input snapshots byte-for-byte. Existing revisions, branches and editable source survive success and rejection. Metadata equivalence is insufficient. |
| Invalid records | Invalid/dangling/cross-memory parents or corrupted revisions yield explicit error/review and are never accepted as a resolved current head. |
| Publication failures | Inject collision and failures before/after publication: never overwrite existing records/view, claim false success, accept partial records or delete another writer's branch. Clean or isolate owned temporary artifacts; document valid orphan handling. |
| Bounded/history reads | Return finite content with revision, state and truncation. Historical reads during conflict/divergence must be explicitly historical, never falsely current. |

Divergence noticed only after publication does not justify a fabricated rollback or an atomicity claim: retain the valid record, flag review and report the actual publication state. Locks coordinate participants only; append-only publication is not linearizable head selection, tamper protection or capture of unseen edits.

Later interface acceptance must also verify that a directed personal/other-project read grants only that read, not editing, broader search or ownership changes. H1 does not implement general personal-note access.

## Decisions still open

- Select the trusted repository-to-Project binding and explicit-grant lifetime.
- Approve Note schema extensions/compatibility and minimum memory granularity/provenance.
- Define how manual edits become accepted revisions and conflicts are reconciled. The initial behavior can report divergence/needs_review without auto-importing human edits; implement and evidence the selected logical-revision strategy before enabling automatic update.
- Select exact interface/result limits and serialization; external processing, automatic deletion and transcript capture are not included.

The product vision, initial automatic-own-project versus explicit-personal/cross-project boundary, shared project collection and revision-based logical updates with a separate editable view are confirmed and should not be asked again.

## Evidence and limitations

This proposal integrates Brain primary-session briefing `b293be4fb8a338c4c25733b9290f6722`, contract recommendation `2031aa04d8ed6f695fda576e7baa3e99` and safe-update recommendation `c34adb3142003ab20755784ec2d88bef`. They are peer-reported source/design inspection and reasoning, not verified implementations or a new parent runtime audit. The safe-update recommendation reused src/document.rs, src/config.rs::save_config_to and the file-model research; no files, new audit or runtime checks were produced.

Brain repository: `../../Brain/` relative to the StelaShell repository root. Source references below are relative to Brain, not this document:

- `src/document.rs`: CommonMetadata, DocumentMetadata and validate; explicitly not a preservation codec.
- `src/cli.rs`: implemented command surface in the inspected baseline.
- `src/config.rs`: save_config_to and its concurrency disclaimer.
- `odd/tasks/brain-file-model.md`: milestones and Block 2 research outcome, with no writer yet.
- `Brain/03-recursos/desarrollo/Diseño de CLI.md`: result communication and tool/agent design.

The reported baseline was a working tree with modified/untracked material, not a released API. Re-read relevant current Brain source before any later implementation. No Brain files, services, vault contents or runtime settings were changed to produce this proposal.
