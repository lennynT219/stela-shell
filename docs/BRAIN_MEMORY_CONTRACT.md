# Brain project-memory contract

**Current authority — Brain only; legacy import completed:** Brain is SS's sole primary project-memory authority. The user separately authorized importing the complete legacy WORK_STATE into the selected Brain Memory, then retiring the repository file. Normal creation, confirmed read-back and an explicit same-ID/revision read established the import before retirement. The complete literal snapshot is retained in Brain, not a repository-file backend or synchronized mirror. This completed import grants no automatic migration or deletion authority for other records. Brain unavailable or denied means memory unavailable/persistence pending while independent authorized work remains possible, never a substitute store. Updated source must be loaded by an operator-controlled reload or fresh session; no reload/setup is performed implicitly.

The implementation/design checkpoints below preserve historical evidence and older decisions, not current permission or a competing memory policy. In particular, former optional-file-backend/cutover gates are superseded by the decision above.

Historical status: Brain R1/R2/R3 CLOSED within reviewed scope on .N9bkmy/dd9da947... (98 logged tests, four matching-BIN oracles and parent8/8 byte-exact CLI replay). No code/result/helper pending; acceptance notice to Brain failed CONTEXT_MISMATCH, not delivered/retried. Core local/uncommitted, Cargo frozen, sole Brain source ownership. SS pre-final Memory tools exist locally with isolated tests and a separately authorized normal-profile/actual-model public-RPC trial in the Brain repository. Creation, empty-chat recall and same-identity update passed; ordinary save also corrected evidence attribution. Permanent activation/cutover/installer and Brain-repository Git remain separate. Earlier documentation delivery is fulfilled; the human now explicitly authorizes SS Memory commit/push. Brain publication, permanent activation/cutover and new functional runs remain separate. Detail: [implementation plan](BRAIN_MEMORY_IMPLEMENTATION_PLAN.md).

## SS Memory activation — no startup flags

The human explicitly removed every Memory flag and selected extension loading as
authorization for ordinary read/save use. Executable selection is nonblank
BRAIN_BIN or brain from PATH. Brain's own existing configuration selects the vault;
the host opts into that backend mode instead of parsing TOML or requiring a
duplicate vault parameter. The opened cwd is the internal boundary; no enclosing
project/parent/root is implicitly searched. Normal Pi tool controls remain, and
exceptional manual acceptance/replacement still needs actual exact-byte UI approval.

The human also explicitly authorizes readiness from owned interactive/RPC input OR
live authenticated local PRIMARY SS work, without mandatory human priming after
reload. Sessions must prove actual admitted-message commitment to the active
branch before its TTL expires. Custom/history/event payloads alone grant nothing;
peer eligibility remains live/revocable and never becomes human readiness or UI
approval. Original deadlines, owner/cwd/activation, tool/configuration controls and
publication-uncertainty fences remain. The shared weak in-process handoff is not
a same-process extension sandbox. Source reviews/regressions are prepared, not
functional verification; runtime details and fixed local guard diagnostics are in
[Memory operation](../extensions/memory/README.md). Brain is primary; the separately authorized legacy import and repository-file retirement are complete.

The executable/environment are owned per context. A lazy metadata-only guard
observes Brain's platform-specific config pathname before/after access and rejects
observed drift for the old owner. It does not parse/read config content or create
it. If drift is observed after a saved receipt, publication remains acknowledged,
read-back is unavailable and future writes are fenced across owners until explicit
complete read reconciliation. No retry, rollback, automatic initialization,
installer/profile activation or legacy-content import follows from extension loading. Brain-only authority is an explicit user decision, not an inferred data migration.

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

## Canonical area naming after the real trial

The human requested `05-memorias/` to match Brain's numbered lower-case areas,
superseding the former `Memorias/` name without changing UUIDs or note basenames.
Brain's source/tests/docs naming unit is complete, with101 observed tests
(98 previous+3 targeted canonical/legacy cases). SS path-dependent test references
are updated; no new SS/runtime test was executed. The human subsequently rejected
labs/tests, superseding the previous manual-test handoff. The existing trial
Memory stays untouched with its old binary; no migration, legacy alias/fallback,
new identity for that binding or accepted-snapshot rewriting is authorized.
Do not select the new binary against the incompatible old root binding. See
the WORK_STATE snapshot imported into Brain for historical paths and limits, not a second authority.

## Confirmed folder-first Memory direction

The user confirmed a fourth domain model, user-facing Memoria: a persistent work context, not each message or individual remembered fact. A Project can group multiple Memories; each Memory may have zero or one Project. SS must not require creating a Project merely to preserve context for a working folder. A Memory has stable identity independent of the path used to locate it, and moving the folder must not lose its related memory/history.

The user accepted .brain.toml inside the associated folder, traveling with it on moves, using TOML binding_version=1 and memory_id. The marker contains no memory/history, vault paths, permissions or optional Project association; those remain in Brain/trusted host state. This is not authorization to create files/config or implement code; explicit reassociation can be recovery. The user chose copied folders/other locations to share the SAME Memory identity, not automatically fork a new one. Location is a locator/provenance, not private ownership; the identifier still never grants authority. Memory data stays in Brain; moving a working folder does not itself transfer/synchronize the Brain store.

The user now defines independent subfolder Memories only under either condition: the child has its own .brain.toml OR the parent .brain.toml explicitly declares that child for Memory creation. No blanket Memory creation for every subdirectory. An existing child's identity must not be overwritten/duplicated merely because the parent lists it. The user accepted the optional memory_subfolders list of explicit relative paths and materializing each child's own marker when creating its Memory, preserving portable identity. The user approved existing-context lookup at owned interactive/RPC input (subsequently extended to timely committed live authenticated PRIMARY SS work) and explicitly adopted Gentle/WORK_STATE timing: useful authorized state is saved through normal tools and confirmed BEFORE the final user response, never on startup. Existing Memory is consulted before work. Empty/greeting interactions do not automatically create Memory; cancellation before submission creates nothing, while a later response failure/cancellation cannot undo an already confirmed save. Later durable changes publish revisions of the same Memory rather than creating one per prompt. Cooperating Brain writers use lock/expected-state checks and SS revalidates before mutation; automatic live-writer detection/coordination is not delivered. Listed children are not all created on the parent's first prompt. In the absence of a separate context, the proposed default is the enclosing authorized Memory, not a new one.

These confirmed semantics have a Brain core/schema/binding implementation and a local SS pre-final lifecycle/permission integration with isolated tests plus a bounded actual-provider/RPC trial; permanent activation and continuity cutover remain separate. Historical H1 required a supplied Project and is removed from the reported restored base. The earlier managed-Note recommendation and mandatory-Project prerequisite are superseded for future integration; revision safety, shared authorized context and personal/other-context access boundaries remain. No code, marker, migration or connector is authorized by this design discussion.

## Confirmed intent and access boundary

Brain is the user's general second brain: projects, personal notes and other knowledge. Project memory is one capability within Brain, not a separate StelaShell-owned knowledge store.

The user wants durable project memories that can be created, found/read and edited/updated. Initial StelaShell policy:

- Automatically manage the agent's own Memory within the confirmed active working context; a Project is optional. Exact folder identity and grant encoding remain to be designed.
- Require explicit user direction to access/modify personal notes or consult other contexts/projects. Grouping Memories under one Project does not itself expand that authority.
- Do not interpret this as permission to capture entire conversations, copy secrets, overwrite human edits or treat recalled text as instructions/authorization.

A direction to read one personal note or another project's item is not permission to edit it, search the entire vault, follow all its source links or reclassify it as agent-owned.

## Responsibilities

- **Brain:** durable knowledge, memory identity, storage, source attribution, scoped retrieval and safe memory changes.
- **StelaShell:** trusted working-context-to-Memory binding, permission-aware tool integration, bounded context delivery and FARO/session/helper lifecycles.
- **WORK_STATE.md:** removed from the current repository after its complete content was imported into the selected Brain Memory and the user separately authorized retirement. The literal historical snapshot remains in Brain; it is not another operational-memory authority, required file read or fallback. Historical claims of file authority do not override Brain-only policy. Other imports/deletions still require their own authorization.
- **Git, original sources and tests:** authoritative artifacts/evidence in their own domains; a memory is not a substitute for them.

Do not expand the read-only helper role or add a second memory database merely to implement this connector.

## Domain model and trusted binding

The user selected a distinct Memory domain model rather than requiring every work context to be a Project or treating all agent context as an ordinary Note. The delivered DocumentMetadata now includes Memory alongside the three existing types, with positive memory_revision and optional Project UUID/link pair. Parent inspected the additive model and CLI/library wiring; no source edits here. Existing Task-to-Project semantics are not changed by this decision.

Before an automatic operation, trusted host state must bind:

1. The explicitly selected vault.
2. A stable Memory identity and its confirmed working-context association; resolve/validate a Project separately only when associated.
3. The approved logical agent owner/collection.
4. The allowed operations and their scope.

The working-context-to-Memory association must be confirmed. A global active-vault pointer, current directory, path, frontmatter marker or caller-selected UUID does not grant authorization. Missing or ambiguous binding fails closed. The model must not choose broader scope through ordinary tool arguments.

**Logical ownership:** Memory belongs to its stable work context, not a particular session; authorized sessions reuse the same confirmed binding. Project grouping is optional organization, not ownership transfer or broader permission. Historical H1 used one stela-shell collection per supplied Project and was removed; the new folder-first implementation now supports optional Project, not an H1 adaptation or permission expansion. Session identity remains provenance. Subfolder declaration/first-use trigger and shared-copy semantics are confirmed; host-selected scope validation is implemented locally, while live-session writer coordination is not delivered; shared context grants no personal/other-context access.

## Visible Markdown relationships

The user confirmed relationships are represented by actual links in Markdown notes, enabling Obsidian's graph to show connections. UUID metadata is stable identity, not a substitute for a visible note link. Links/navigation are not permission grants or automatic formal Project reassignment.

The user accepts the explained Obsidian-compatible wikilink convention, for example [[05-memorias/<memory-uuid>/Memoria|Memoria]] and [[05-memorias/<memory-uuid>/Historial|Historial]], with qualified paths distinguishing repeated short basenames. Brain now writes these relation strings, with accepted scoped R1 validation below; no actual Obsidian graph/runtime output or change to existing Task semantics is verified. Relationships must exist in the notes, not only internal IDs; do not re-ask the naming/identity/Project/link choices.

A real Project document connects only when associated, outside 05-memorias; no forced Project or extra index Note. An unassociated Memory can link to its own history without inventing a central context node. Brain should keep link targets consistent with its managed operations; moving a working folder does not move the vault Memory. History/reference links can use existing body sections rather than adding a sixth operational section. No actual notes, links or Obsidian configuration are changed in this design phase.

## Current context and history policy

The user approved one logical Memory with two separate parts: current work context and retained revision history. One Memory is not an ever-growing file containing every previous state. The current Memory retains the five canonical sections: Objective and scope; Current decisions; Outcome status; Relevant evidence; Next actions and open questions. Brain alone now owns project continuity; the legacy operational file is neither required nor a permanent canonical copy. The user ordered the policy change first and deferred import of that file's contents to a later explicit order. No automatic migration, deletion or synchronized mirror is authorized.

The user declined proactive condensation and automatic history segmentation/archive/rotation for now, preferring observation of normal growth. The proposed8–16KiB current-content target is not adopted. Normal work updates affected state and publishes a revision only for meaningful durable changes; no artificial append-every-prompt log, extra cleanup pass or automatic historical deletion. The user confirmed 05-memorias/<memory-uuid>/{Memoria.md,Historial.md} and complete accepted-version Markdown snapshots in Historial.md, including the last accepted document bytes. History contains accepted states, not every prompt or draft. Brain now implements lossless framing and guarded publication/explicit recovery, within the bounded evidence below, not universal filesystem CAS/power-loss protection. Preserve observed manual edits and require human approval; do not impose H1's immutable view/base1 architecture as a user requirement.

Growth observation is a future normal-use activity, not permission for synthetic volume generation, paid/live trials or extra instrumentation now. Historical H1 used128-revision/8MiB graph limits, but it is removed in the restored base; these are not selected limits for a replacement. Any future safety bound must surface a blocked save honestly, not discard history or promise indefinite capacity. Broader Markdown schema/integration and future retention/archive policy remain separate work.

## Rejected representation and fresh consultation

The user explicitly rejected result a0cebb2ee9e8e2c15aa7bcc13bcf52e5: canonical BMR history plus Memoria-rN.md projections/new store contract was not aligned with the intended Memory experience. Do not treat that layout, schema, immutable-current-view mechanism or H1 reuse as an approved design. Preserve only the confirmed current-context/separate-history/manual-approval semantics, not its physical implementation.

The user replaced the Brain session and supplied activation1fc7ec5782d33521146aecc673e2237c. Fresh discovery verified its Brain workspace; new read-only consultationb463bd841ff96c853d9cae84f84b89b6 asks for actual restored-source findings and ONE minimal Markdown-native Memory model/layout/history proposal aligned with all confirmed decisions. No rollback/Git/source/test/build/dependency actions are authorized by that assignment; no old thread is renewed.

Peer milestone587579e0a28ef552a2b488bc21bcd221 reports main@1e6c2aa91e1d38007779ac4deda319afec10fb34 (`restore standalone Brain base`), clean status twice, lib exporting only document and experimental memory module/tests/format absent. Note/Project/Task and init/config are preserved. This is peer-observed stable rollback evidence, not parent execution or proof against every external writer. No builds/tests/changes by the new consultation. Its final two-part proposal038b45f17f36293478b57b853e56a106/b11bd1395771656da3d7b6c58e1ad317 is now complete; source/manifest findings and remaining decisions are below, without new runtime verification.

Favor a clear current Memory Markdown document consistent with Brain's domain; exact path/metadata/history publication remain proposals to evaluate, not a hidden decision to overwrite human edits or a guarantee of filesystem CAS. Re-evaluate parser/UUID/dependency needs against the restored base; no automatic H1 migration/version2 requirement or copied old numeric limits.

## Confirmed Markdown layout; technical mechanics proposed

The user accepted a normal readable/editable current Memory document and ONE separate Markdown history file, not a generated projection or BMR store. The earlier02-areas/99-sistema placement is superseded by the chosen 05-memorias area. UUID-only filenames remain rejected: readable Obsidian graph node names are a core product requirement. Keep UUID in frontmatter/marker/directory, decoupled from display filename. Optional Project is metadata/navigation, never required path/identity; moves/copies retain UUID and trusted configuration selects vault.

The user approved a distinct 05-memorias area and short nonrepeated names, but explicitly rejected the proposed StelaShell.md/ordinary Note index and task index inside it. This area contains only Memories and history, not a substitute Project/context-index entity.

The user now accepts UUIDs as directory names, not visible document filenames. Chosen convention:

```text
<selected-vault>/05-memorias/<memory-uuid>/
  Memoria.md      # current Memory, five agreed sections
  Historial.md    # separate history
```

The directory UUID, working marker memory_id and Memory frontmatter brain_id identify the same Memory. UUID stays in the path/metadata, not the document basename/normal graph label. This directory is not a Project or graph node. Memory can exist unassociated indefinitely. Only when assigned to a real Project does that Project's own Markdown document (in the Project area, not 05-memorias) provide the central StelaShell node and links to related Memory/history/tasks. Reuse the actual Project model; do not fabricate an ordinary Note index, force Project creation, move the Memory or change its UUID merely to establish that association. Current Task-to-Project semantics are unchanged; no automatic task documents.

Native Obsidian graph is notes+links, not folders. Before Project association, no central StelaShell note exists solely because the Memory folder has that name. The graph's placement is not a guaranteed tree. Qualified links and UUID identity disambiguate same short filenames across context folders; exact graph/navigation implementation remains untested and no settings are changed.

PARA Areas represent ongoing responsibilities, not every arbitrary work context; the accepted distinct Memory area avoids forcing that category. System history placement was only a convention, never automatic graph exclusion. The user includes a history relation in the desired graph: do not silently exclude it. Any future graph filtering/setting change needs explicit design/verification; nothing in Obsidian is changed now.

Resolve authorized memory_id directly to 05-memorias/<memory-uuid>/Memoria.md, then validate its brain_id against marker/directory identity. No filename scan, whole-vault personal-note read or added catalog is needed for this convention. Working-folder moves/copies still select the same Memory; optional Project association never relocates it. Short Memoria.md/Historial.md repeat safely in distinct UUID directories with qualified links. UUID path/metadata is a selector, not permission; no automatic overwrite or replacement identity if a resource is missing.

Delivered frontmatter: brain_type=memory, brain_version=1, brain_id, title, positive-u64 memory_revision, optional paired brain_project/project_link. The fourth variant reuses CommonMetadata, preserving Note/Project/Task semantics. Body requires the five canonical sections; absent Project is omitted. Actual managed YAML bytes are preserved across normal body/revision updates; active-relation/canonical-H2 validation is now scoped verified by the accepted R1 evidence below, not a general renderer/Obsidian certification.

Confirmed history content: retain every durable accepted full Markdown document version in ONE Historial.md, including the latest accepted snapshot. The user approved full versions, not lossy diffs, rejected drafts or prompt transcripts. Delivered Brain history framing preserves full accepted Markdown bytes, including fences/newline variants; SS consumes Brain-owned history rather than inventing a second format. This duplicates text and may grow faster than diffs, intentionally subject to normal-use observation; no pruning/condensation/archive/rotation target is proposed. Current is the working document, not automatically reconstructed from history.

Before an update, compare expected revision AND exact accepted current bytes under a per-Memory cooperating-writer lock. Difference can mean manual edit OR partial publication; preserve current, notify SS/human and require approval/recovery. Missing/corrupt history is not a missing Memory or authority to adopt/overwrite; report unavailable baseline. Approval still requires fresh revision/base checks. Session communication agrees order, not storage authority; lock does not span the entire reasoning turn.

Delivered publication stages an exact before/next .pending.json intent, publishes current then history with same-directory temporaries, publishes the creation marker without clobbering, verifies bytes, clears the creation receipt, and removes intent last before saved. Creation first reserves UUID/request in .brain.pending.toml. These are separate writes, NOT a transaction/CAS; incomplete intent/receipt is partial and never auto-adopted/rolled back. Pre-intent reservations may lack recoverable content; explicit human-directed reconciliation remains necessary. Parent's independent store review found no concrete destructive publication/recovery violation within scope, not universal proof.

Delivered locks use standard File::try_lock, immediate busy/no waiting and short cooperating-writer critical sections; stable lock sidecars have no owner metadata and are not stolen by PID/age/session. Cargo declares Rust>=1.89, but observed execution is Linux/Rust1.100 only. No cross-platform/MSRV/power-loss certification follows.

Current source findings: fourth Memory model, strict binding resolver, byte-preserving canonical Markdown/full-snapshot history, exact manual approval/recovery and brain memory JSON v1 are implemented locally. Initial72-test core exposed R1/R2/R3; all three are now CLOSED within the bounded reviews below. Final98-test packet preserves scoped R2/R3 and actual parent CLI/source evidence. Existing serde-saphyr/serde_json/uuid dependency approval is implementer-attributed; exact additional defaults-off pulldown-cmark/unicase setup was separately human-approved and independently prepared/verified HERE, no protected approval transfer. Brain core acceptance does NOT implement/enable SS lifecycle, installer or continuity migration.

## Confirmed exceptional-case behavior

- Manual changes: Memories primarily serve agents, but if a human edits one, notify the human in the SS session and require approval before accepting/importing the changed state. Never silently overwrite or discard edited bytes; Brain's exact accept_external primitive exists; SS's actual-human approval/permission UX remains unimplemented.
- Missing referenced Memory: report the missing resource and offer creating a NEW Memory; do not silently regenerate the old ID/replace the marker or block ordinary SS use. Distinguish a confirmed missing record from unavailable storage/access/I/O errors.
- Concurrent sessions: use authenticated session communication to agree who updates first. This is coordination, not a substitute for Brain locking/expected-revision checks. Discovering the live editing session and handling unavailable peers within existing bounded messaging remain implementation details; no unbounded waits, retry/renewal or fabricated ownership.
- Brain unavailable/disabled: installation and configuration retain their own consent boundary; this policy adds no download/setup authority. SS remains usable for independent authorized work and reports memory unavailable or persistence pending. Never reinstate WORK_STATE or another file as a backend, silently create a substitute store, claim a save or auto-merge/synchronize records.

## Proposed operations

Future command names and wire fields are not selected. H1's removed API/format/limits are historical below, not prerequisites. Initial Memory lookup resolves the confirmed marker/UUID directly; broad lexical/vector/search features are not part of this first technical plan. The following are domain requirements, not available CLI commands or a delivered connector.

| Operation | Required behavior |
| --- | --- |
| Create | Accept title/body, claim kind and provenance in the bound collection; allocate a stable memory UUID and content revision. An operation/request key should prevent duplicate creation after repeated delivery, without introducing automatic retries. |
| Find | Initially resolve the authorized working marker/UUID directly to its Memory; no catalog or whole-vault search. Broader lexical/Project-wide retrieval remains separate scope and requires its own authority. |
| Read | Resolve a memory ID inside the authorized scope; return bounded content, revision, sources and an explicit truncation indicator. |
| Update | Require memory ID, expected content revision and an explicit logical change. Preserve human material, unknown properties, sources and untouched content. Use the delivered expected-revision/accepted-byte and intent-based publication mechanism; do not change project/owner as a side effect. |

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

## Update invariants; physical mechanism reopened

The user retains stable Memory identity, a current work context and separate retained history. Rejecting H1's representation means its fixed-base/editable-view/BMR architecture must not be silently imposed on the replacement. The new proposal must explain how normal meaningful updates preserve accepted prior states and how the current Markdown remains understandable, without automatic historical deletion or extra compaction.

Observed manual edits require notification and human approval before acceptance; preserve their bytes, do not silently merge/retag/reinterpret them. Concurrent sessions negotiate update order and storage must reject stale conflicting updates. Project association cannot change as an implicit content-update side effect. No newest-file/session-wins or fabricated success after partial I/O.

Metadata structs alone are not a Markdown preservation codec. Locks/expected revisions coordinate cooperating writers; hash checks plus rename are not universal CAS against a noncooperating editor. Neither design can promise to capture edits never observed. State real failure/atomicity limits plainly rather than expanding into another unapproved archive architecture. Exact current-file/history mechanism is still the new proposal's subject.

## Integration recommendation and implementation prerequisites

Parent recommends a small local versioned JSON CLI consumed by an SS memory adapter with trusted host scope. Brain already has an executable/CLI, so this reuses that boundary without introducing an initial daemon, TCP/HTTP service or MCP server. Exact commands/protocol are proposals, not existing memory CLI functionality.

Implemented SS flow (initial isolated checkpoint used genuine user input; later authorized source also accepts live authenticated PRIMARY commitment): authorized activity -> adapter selects the authorized working context and invokes the configured trusted Brain executable directly (no shell command string) -> Brain resolves/validates the marker read-only using its existing TOML capability -> adapter validates structured finite output and delivers current context to the agent. Marker parsing belongs in Brain rather than introducing a second parser/dependency in SS; initial resolution must not create Memory/marker files. During useful authorized work the agent prepares complete five-section state and calls the normal ss_memory_save tool BEFORE composing its final reply. This explicitly supersedes the prior post-response design. Brain validates/publishes against the host-owned exact accepted state; SS observes the actual saved/unchanged/failed/pending/unconfirmed result. Preparation is not saved. Startup/greeting/empty interactions do not automatically publish; a pre-submission cancellation/denial creates nothing, but later response failure/cancellation does not undo confirmed persistence. No full transcript capture, hidden secondary model, blind retry or permission inference from UUIDs. The local client/runtime implements bounded cancellable versioned calls; its actual limits and verification boundary are in extensions/memory/README.md. No automatic live-data/profile setup or legacy-content import follows from the tool declaration. Sole Brain authority does not itself authorize data migration; the now-completed legacy import was separately ordered. The historical explicitly authorized bounded actual-provider/RPC trial passed in the Brain test repository; its actual effects and limits are preserved in the WORK_STATE snapshot imported into Brain. That trial grants no broader/private-data access or permanent activation.

The former installer choice between Brain and WORK_STATE backends is superseded. Installation/version/source/integrity/configuration work remains separately scoped, not performed by this policy change. Brain is the only memory backend; when absent, disabled or failing, SS reports memory unavailable/save pending and continues only independent authorized work. It never invents persistence, creates a substitute file/identity, dual-writes or synchronizes backends. Existing explicit-read uncertainty reconciliation remains, not an alternate-store fallback. Importing legacy contents requires the later human order.

Prior consultation390d66695fdefbf4e6e81af54f08ec06 completed but its representation was rejected. Replacement consultationb463bd841ff96c853d9cae84f84b89b6 completed in two parts on the new Brain session, with restored baseline and ordinary-Markdown recommendation reported above. No proposal receipt/completion is implementation/dependency approval.

No daemon, model, vector database, framework or second StelaShell memory store is currently justified. Any new dependency would still require its applicable approval; this proposal is not a dependency decision.

The delivered core now provides Memory operations as well as init/config; broader general-note retrieval is not included. SS integration must reuse the existing core while resolving the review findings, not reimplement these capabilities:

1. Preservation-aware Markdown/frontmatter reading and schema compatibility rules.
2. Confirmed working-context-to-Memory binding, scoped authority and optional Project resolution.
3. Safe creation and the selected update strategy: preservation-aware coordinated patches or unique revision publication/parent validation, with evidenced conflict and human-edit behavior.
4. Direct marker/UUID lookup and bounded structured results with explicit complete/partial/error states; broader lexical retrieval is separate future scope.
5. A structured interface, then a permission-preserving StelaShell connector.

A read/create-only early delivery can be useful, but would remain incomplete against the requested update behavior. No runtime or profile loading route is changed by this plan.

## Delivered Brain core/CLI; review findings precede SS integration

Rejected R1 checkpoint7759e25bbe6ee49894fb2aca57b63725 at /tmp/brain-memory-r1-containers.K9KEeB remains diagnostic only:91tests=87+4 and the old literal/R2/R3 harness passed, but independent probes found ordinary lists/quotes rejected and genuine-link old histories reported partial/history_document_invalid. Human rejected that blanket restriction. Normal Markdown/old valid snapshots are required, with no rewriting of content/history.

Accepted R1 handoff66900544b2316581b4eb874be9de55c5, received threadbe5d4ca79a0dd1a2759daf79ec564b15: /tmp/brain-memory-comment-chain.N9bkmy/debug/brain SHA256 dd9da947238e6d59df767f8d58f330aa7f1acfed2708c0cd1224345bb5d49ddf; syntax692511fa870ba858d0178c323fb36064a999d73739eb3ac58e916c1b2b062973; manifest6dd7d6f7a70c25a266dbc2b566de94dae13d3ca4e931630e88297e4862c96483. Parent matched all29 entries before/after its own CLI probes,25 prior entries incl oldd2 BIN preserved; only syntax/containers/MEMORY/WORK_STATE differ. Removing ONLY the two added tests+opaque_comment helper reconstructs exact prior9-test SHAac0f2cc17f3643b01d875963727729728f8824fccf9fbd539dca7fa94b38cf32, proving old assertions unchanged; adjudicated corrections fixture also unchanged. Frozen Cargo82c71f.../4549f87..., storage/binding/history/markdown/CLI/four initial suites unchanged; config/init/vault+tests match HEAD.

R1 CLOSED within reviewed Brain scope: comment_view masks ONLY the earliest currently Html-event-eligible comment through its source-level closer, then next_comment reparses before selecting later openers. Fake code inside a comment cannot hide subsequent real comments or cause stale eligibility in later real code. Each round removes at least one visible opener without creating any, preserving byte/newline/UTF8 positions; no pass cap, persisted normalization, container ban or history rewrite. Canonical five top-level H2s and genuinely active history/optional Project relations are preserved. Existing genuinely valid list/quote snapshots stay byte-identical; literal-only unsound baselines remain partial/preserved, not repaired.

Integrated98=87 preserved other tests+11 container declarations,0fail independently reconciled from checks.log; targeted29=11+15+3 reported. Clippy finish/preservation log inspected; clippy all-targets -D warnings, fmt/diff checks reported, no duplicate parent Cargo suite. All FOUR matching-BIN reports pass: masking8/8, boundary28/28, negative5R1/10R2/5R3, positive3legacy/create saved/8forms. Parent actually reran unmodified masking-interactions.py against final BIN: independently expected2openers*4forms=8, observed8/8 saved revision2 with exact expected bytes, including both former false rejections. Both new regression bodies inspected: chains/fake backtick+tilde, real-code/inline/escaped/attribute neighbors, both relations/real H2s, LF/CRLF/CR, unknown YAML/raw/latest snapshots and rejecting rediscovered comment-only links unchanged.

Evidence /tmp/ss-brain-chain-review-qm3lmtfq/{source-review.json,masking-interactions.parent.json,review-conclusion.json}; prior .1X1wnx8-case6pass/2fail artifact is now resolved negative history, not a blocker. Reparse can cost comment-count*document-length; no performance bound/benchmark claimed. Linux/Rust1.100/debug only; no MSRV runtime/other-OS/Obsidian/release/SS/security/exhaustiveness/CAS/power-loss proof. Additional074d source-only review is implementer-reported, not parent helper evidence; oldb172 timeout stays incomplete/not relaunched. No required code/result/helper outstanding. No parent Brain application/build/Cargo/network/real-vault/profile/Git/cutover changes.

Communication limitation, NOT a code blocker: Brain reports root32f4... reply returned WORK_EXPIRED; actual handoff6690... arrived after its own human-requested resend in newbe5d... thread. Parent attempted a substantive acceptance reply to incoming6690... WITHOUT work override; observed CONTEXT_MISMATCH: Reply cannot replace, upgrade or downgrade the active work context. It was NOT delivered and was NOT retried/renewed/migrated or routed through another anchor/session/helper/file channel. Brain receipt of parent acceptance is unconfirmed; parent scoped technical closure/evidence remains valid. Any further communication must respect a legitimately available authorized context, not automatic workaround. No new protected approval follows from peer messages.

## Historical H1 context — removed, not the new design baseline

The following H1 plan/results describe the old9b4a959 tree only. New Brain reports restoration to standalone main1e6c2aa and removal of the experimental module/tests/format. These historical paths/limits/approvals are not current implementation instructions, migration authority or evidence for the replacement.

The user authorized H1 implementation and isolated synthetic tests; both planning results are received and the required preimplementation scope/files/structure summary has been SHOWN. The first code handoff was rejected with `Message expired or has an invalid lifetime`; it was not retried or migrated. The subsequent isolated diagnosis reproduced the ordinary ten-minute lineage restriction, but did not capture the failed envelope's actual clock/expiry. The separately approved [sessions work context](SESSIONS_WORK_CONTEXT_PLAN.md) is now implemented and functionally checked, with its independent review still incomplete. The user then reported manually reloading Brain and this parent and explicitly requested resuming implementation. A NEW work-root H1 assignment to Brain's freshly discovered activation was accepted for delivery with a fixed 60-minute communication window. This is not a commitment/start/completion receipt, task-runtime/cost guarantee or renewal of the expired thread. Brain remained the sole source writer and delivered the scoped implementation. Its later handoff reports direct human clarification that the untracked odd/ records were intentionally deleted and must remain absent, plus separate authorization in Brain for one local commit of its existing base and H1. Parent observed commit9b4a959 and independently verified all41 remaining protected baseline files unchanged, with only the permitted library export changed and exactly5 odd records absent. The deletion's intent and Brain-session Git permission are reported from that session, not independently attributed or transferred to this parent. No restore, source edit or Brain publication was performed here. H1 implementation/review evidence is below; no full memory-product or operational connector completion is claimed.

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

Delivered provisional H1 API: `create_from_view`, `read_revision`, `read_current`, `publish_successor`. The caller creates the agent-memory view first; creation snapshots it and publication never rewrites it. H1 does not generate IDs or author/generalize Markdown.

```text
<root>/<project-uuid>/stela-shell/
  .writer.lock
  <memory-uuid>/
    view.md
    revisions/<positive-number>.bmr
```

The provisional single-file record has a magic marker, checked header length, versioned TOML header and exact raw payload. Numeric revisions are allocated/validated under the cooperating-writer lock, not cryptographic digests or timestamps. Original-byte comparisons support editable-view/base checks; there is no history-authenticity/tamper-proof claim. Validate rooted parent graphs and retained competing heads; unique no-clobber publication must distinguish pre-commit, committed and uncertain I/O outcomes. Document finite bounds and duplicate-memory-ID behavior without claiming exactly-once creation.

A clean but old editable view may be view_stale after a successor, while manual changes relative to its OWN base require needs_review. Manual import/reconciliation, full search, CLI/skill/connector, real-vault activation and profile/service changes are excluded. A trusted stable parent directory is a precondition, not a malicious-same-user sandbox.

Brain reports Linux x86_64/rustc+cargo1.100.0 and successful locked offline checks using existing std/serde/toml/tempfile/uuid, with no H1 dependency/feature changes. Std file locks require Rust >=1.89. The parent counted1576 formatted lines across the six H1 paths, exceeding the original800–1100 forecast without changing the approved file/feature boundary; the forecast was guidance, not permission to expand the separately blocked reader scope.

The implementer reports these approved offline checks passed; the parent did not rerun unchanged checks merely to duplicate the writer's evidence:

```sh
cargo test --locked --offline --test memory_store
cargo test --locked --offline --lib
cargo test --locked --offline --test cli_init --test cli_config
# Scoped rustfmt --check for the touched Rust files.
```

Missing offline artifacts are a blocker, not download permission. All fixtures must be temporary/synthetic. H1 itself authorizes no source-note overwrite, automatic import, real-vault write, new dependency, external/model trial or parent Brain Git/publication action; Brain's separate reported local-commit decision is distinguished above. H1 includes logical update but is not the complete memory feature.

## Historical H1 primitive and bounded review

Concrete Brain baseline: `feat/brain-file-model@9b4a95933002028ce8c16f02c278038545810ae7` includes the pre-existing Brain base and H1, not just this unit. Parent confirmed20 committed paths, no personal Brain/ vault or .codegraph/ in that commit, and only those two directories untracked at the review checkpoint. Local commit authorization was reported from Brain's direct human exchange; it is not parent permission to stage/commit/push there. No Brain push was observed or performed by parent.

Public types include `Binding`, `Metadata`, `Header`, `ReadResult`, `Publication` and explicit errors. A typed Project/UUID/root validates structure, not consent or repository mapping. Fixed collection is `stela-shell`; caller supplies UUIDs and the pre-existing view. Header provenance records claim kind, source references, session and observation milliseconds as inert attribution, not verified truth or authority.

- Record: `BRAINMR1` + little-endian u32 header length + versioned TOML header + exact raw payload. Numeric revisions are positive and bounded by `i64::MAX`, not hashes or timestamps. `store_version=1` is separate from document `brain_version`.
- View/base: original revision1 remains the editable view's own base. `Base`, `Stale` and `Diverged` are explicit; generated successors never rewrite the view or prior revisions. Read states are `Current`, `Historical` and `Unresolved`. Multiple heads remain retained and require review.
- Coordination/publication: persistent nonblocking collection lock, expected-head validation and checked allocation precede tempfile no-clobber namespace publication. `Busy`, stale conflict, collision, `PublicationUncertain`, `AfterPublication` and published-with-review are distinct. Existing final records are not rolled back; isolated pending remnants are bounded/ignored, never adopted/deleted.
- Bounds: header16KiB, payload/view1MiB, whole graph8MiB/128 revisions/144 directory entries, returned body64KiB, metadata32 sources with supplied strings/title/session bounded to2048 bytes. Total length/truncation are explicit; invalid graph/scope/version/framing cannot advertise a clean partial head.
- Limitations: even historical reads currently require a present/safe/readable view; ordinary divergence and competing-head history are supported. General request-key/exactly-once behavior, ID generation, manual import/reconciliation, general YAML reading, search/CLI/connector and real-vault project verification are absent. No hostile-filesystem CAS, arbitrary-editor tamper protection, multi-file transaction or power-loss guarantee.

| Evidence | Result and provenance |
| --- | --- |
| `memory_store` integration | Brain reports10 passed;1 ignored IPC entry is explicitly executed/checked by its deterministic process test. |
| Library tests | Brain reports12 passed:7 existing metadata +5 private publication/lock tests. |
| Existing init/config regressions | Brain reports10 +5 passed; source/tests matched the pre-H1 snapshot. |
| Formatting/whitespace | Brain reports scoped rustfmt and diff checks passed. |
| Parent acceptance inspection | Public types, format docs, integration assertions and private failure-test assertions inspected; no concrete additional correction identified. Runtime checks were not repeated. |
| Independent source review | `task-fe3bf488-37c9-4a0b-b43e-9caf54847df4` completed: no concrete lock/publication/head-integrity violation found within cooperating-writer/trusted-stable-ancestor assumptions. No tests/platform execution by helper. |
| Review relevance/preservation | Parent hash comparison confirmed reviewed source/tests/docs unchanged and identical to9b4a959 despite the generic mutation warning. Of47 baseline entries,41 protected files match, src/lib.rs only adds memory, and5 odd records are absent; intentional deletion is reported by Brain's direct human exchange, not filesystem attribution. |

The37 passing main tests above are implementer-observed evidence, not a parent runtime audit. No Windows/network-filesystem/full-suite/clippy/power-loss certification. Source/test references: Brain `src/memory/{mod,store}.rs`, `tests/memory_store.rs`, `docs/PROJECT_MEMORY_STORE.md`; original preservation snapshot remains outside Git at `/tmp/brain-h1-baseline.json` and is not a durable repository artifact.

## Historical H1 checklist and isolated acceptance

The earlier planning review covered contract/continuity only; the later concrete source review and implementer-reported checks are distinguished above. The matrix below remains the semantic acceptance reference, not an additional claim of runtime/security verification. In H1, consent/repository grants are trusted-caller preconditions, not a delivered authorization service. Find/search, manual import/reconciliation and connector remain outside H1.

The fulfilled pre-code plan covered:

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

## Historical design questions and current boundaries

- Brain correction has no pending code/result/helper; R1/R2/R3 scoped closed. Acceptance notice is undelivered after observed CONTEXT_MISMATCH, without retry/renewal/alternate route. Any further communication must use applicable legitimate context/authority; no new protected scope follows.
- Define technical shared-copy/concurrent creation and live-session negotiation, plus manual-change approval/import mechanics. Copies share the SAME Memory; human approval before accepting manual edits and nonblocking missing-memory offers are confirmed behavior, not unresolved product choices.
- Implement SS client/lifecycle/permission/manual-approval/status mechanics against delivered brain memory v1 only after scope approval and core findings are resolved/explicitly qualified. Missing-reference new creation must use Brain-owned `replace_missing`, already delivered/scoped verified, with actual host-enforced approval; never direct SS marker writes. Optional installer/cutover remain separate.
- Current boundary: Brain-only policy and the separately ordered legacy-content import are complete; the complete WORK_STATE snapshot remains in Brain after authorized repository-file retirement. No automatic re-import, growth intervention, deletion/archive of other records, external processing or transcript capture.

The general-second-brain vision, Memory-as-work-context model, optional Project grouping, stable identity across folder moves and revision-based logical updates are confirmed. Own-context automation does not authorize personal/other-context access. Do not re-ask settled choices, including .brain.toml/TOML binding_version+memory_id and the explicit subfolder conditions. First-prompt useful-turn persistence and child declaration encoding are accepted. The five-section current-context/separate-history and observe-normal-growth policies are confirmed. Shared-copy identity, manual-approval/missing-memory behavior, peer coordination policy and optional installer modes are confirmed. Brain-core acceptance alone did not resolve SS integration. A separately authorized local SS client/lifecycle/approval/status unit now implements pre-final publication with isolated tests; live-writer coordination/install/activation/migration remain separate, and both client/runtime independent reviews are incomplete; delivered CLI and scoped Markdown validation are not open product questions. No later growth intervention is authorized.

## Evidence and limitations

The original proposal integrates Brain primary-session briefing `b293be4fb8a338c4c25733b9290f6722`, contract recommendation `2031aa04d8ed6f695fda576e7baa3e99` and safe-update recommendation `c34adb3142003ab20755784ec2d88bef`. They are peer-reported source/design inspection and reasoning, not verified implementations or a new parent runtime audit. The safe-update recommendation reused src/document.rs, src/config.rs::save_config_to and the file-model research; no files, new audit or runtime checks were produced.

Brain repository: `../../Brain/` relative to the StelaShell repository root. Source references below are relative to Brain, not this document:

- `src/document.rs`: CommonMetadata, DocumentMetadata and validate; explicitly not a preservation codec.
- `src/cli.rs`: implemented command surface in the inspected baseline.
- `src/config.rs`: save_config_to and its concurrency disclaimer.
- Historical `odd/tasks/brain-file-model.md`: earlier milestones/Block2 research evidence; now absent, with intentional user deletion reported by Brain. Do not restore or treat it as a reachable current reference.
- `Brain/03-recursos/desarrollo/Diseño de CLI.md`: result communication and tool/agent design.

The original baseline was an extensively modified/untracked tree, not a released API. The original proposal changed no Brain files/services/vault/runtime state; later H1 was implemented by Brain and reviewed as distinguished above. Re-read relevant current source before future changes. No broader memory integration, publication or permission follows from this record.
