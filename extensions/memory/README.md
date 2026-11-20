# Brain Memory integration

Local implementation: a primary-only Pi extension, ordinary `ss_memory_read` /
`ss_memory_save` tools, transient owned state, and the existing isolated Brain JSON
client. **Save and observe the actual result BEFORE the final user response**. No Pi fork, post-settlement tool replay, hidden summarizer or
separate finalization model turn.

Brain is StelaShell's only primary durable project memory. The user separately
ordered importing the complete `docs/WORK_STATE.md` content into the selected
Brain Memory, then retiring the repository file. Normal creation returned saved
with confirmed read-back; an explicit read found the same identity/revision with
writes unpaused. The complete literal historical snapshot remains in Brain,
not a required repository-file read, fallback backend or synchronized mirror.
The extension does not automatically migrate/delete/archive/synchronize records,
install Brain, configure a vault/profile or reload an existing SS instance. Use an
operator-controlled reload or fresh session to load changed instructions. If
Brain/tools are unavailable or denied, report memory unavailable/persistence
pending and continue only independent authorized work, without a substitute store.
Source policy is not universal model-compliance or permission enforcement.

The package declares the entry point; loading it authorizes ordinary Memory use. No Memory lookup or Brain
subprocess runs before owned interactive/RPC input or live authenticated PRIMARY
SS work committed by the receiver to the active branch. Arbitrary custom messages
and replayed history cannot initialize it. Helpers are excluded before
tools/hooks/resources. Source installation alone does not create profile links.

The user-authorized Windows route is now configured as
`C:\Users\lmasapanta\.stela-shell\extensions\ss-memory` → this checkout's
`extensions/memory`. Its canonical target and unique loading route are verified;
settings/MCP and the four other junctions are unchanged. No agent reload or Brain
Memory operation was performed. Use operator-controlled `/reload` or a fresh
session to load it; this filesystem setup is not Windows Memory read/save proof
and did not import legacy continuity contents. Other machines need their own route.

## Area naming and existing data

The canonical Brain area is now `05-memorias/<UUID>/`, with the same short
`Memoria.md` / `Historial.md` filenames and qualified `05-memorias/...` links.
Brain's naming-only checkpoint passed101 tests (98 previous+3 area/legacy cases).
SS's path-dependent integration assertions were updated, but have NOT been rerun
against that binary. The human subsequently rejected labs/tests; no further
functional run or fresh-data setup is being performed.

The preceding real-provider trial used the former `Memorias/` layout and its old
binary. Its accepted snapshots/binding remain untouched; no migration was added.
Do not select the new binary against that old binding and treat `not_found` as
proof of actual absence, call `replace_missing`, move only the folder or rewrite
accepted history. A fresh manual test must use a NEW working context/boundary and
NEW vault, without copying the old `.brain.toml`. The compiled new binary is still
a temporary artifact, not a permanent installation or profile activation.

## Configuration and authority

**Loading the Memory extension is the operator's explicit authorization for
ordinary Memory reads/saves. There are no Memory CLI flags or legacy aliases.**
Normal Pi tool controls remain effective; removing/denying a tool is not bypassed.
Exceptional manual acceptance/missing-reference replacement still requires actual
host UI approval for the exact observed/proposed bytes.

The executable is nonblank `BRAIN_BIN`, otherwise `brain` from inherited PATH.
The vault comes from Brain's own existing configuration, set with
`brain config set-vault <path>`; SS neither parses TOML nor selects another vault.
The current working directory is both the working context and its internal
authorized boundary. There is no implicit parent/root search: opening a subfolder
selects that folder, not an automatically discovered enclosing project Memory.

For a separately installed/configured Brain, load this extension and start SS
normally. No repeated vault/boundary/write arguments are needed. An optional
environment override is simply:

```sh
export BRAIN_BIN=/absolute/path/to/brain
```

An executable selection is one absolute path or bare command name, not a shell
alias/argument string. Relative paths containing separators are rejected.
On Windows, drive-relative values such as `C:brain.exe` and root-relative values
such as `\tools\brain.exe` or `/tools/brain.exe` are also rejected: use a full
`C:\tools\brain.exe`/UNC `.exe` path or a bare name searched in PATH. Both
selection and direct resolution validate this rule without launching candidates.
A bad BRAIN_BIN selection does not fall back to another executable. Bare names
are located with metadata checks in PATH order once per owner, then pinned as an
absolute path for direct shell:false execution. PATH relative/empty components
follow cwd; an entirely absent/empty PATH is not guessed. Windows remains native
.exe-only. No candidate is executed as a probe. Missing commands report
**Memoria · Brain no encontrado**; no installer/build/download/repair is invoked.
The unchanged client still receives a minimal child environment without PATH or
BRAIN_BIN; its host explicitly opts into Brain's existing configured-vault mode.

SS freezes that child environment and checks current executable/environment
authority. On the first authorized read, a host guard lazily captures only metadata
of Brain's config pathname (HOME/.config/brain/config.toml on Unix,
USERPROFILE\\.config\\brain\\config.toml on Windows), including leaf/target identity,
size and modification/change timestamps. It never reads configuration contents.
Observed metadata changes permanently deny that owner; a new owner is needed
after intentional reconfiguration. Missing/invalid config remains unavailable
through Brain; SS does not initialize it or silently adopt a later-created file.

These are bounded change detectors, not atomic vault pinning, inode/hash locking
or an OS sandbox: temporary external edits, metadata collisions, ancestor/target
retargeting between checks and config-load races are not excluded. Effective
executable/environment input differences also deny access while different; that
equality gate alone is not permanent revocation. No per-operation PATH lookup,
whole-vault scan, capability probe, backend fallback or second store is introduced.
Models never choose executable, vault, cwd/boundary, UUID, baseline or approval.

Automatic lookup is a host-owned read authorized by extension loading and current
reader availability, not a synthetic tool-call event. Explicit tools, including
every save, still pass through ordinary Pi tool validation/hooks. No general
hook-based internal-read revocation or security certification is claimed.

## Runtime flow

1. Startup registers tools/state and may resolve the configured executable's PATH
   entry. No Brain process, Memory or marker is created.
2. Owned interactive/RPC input OR authenticated local PRIMARY activity enables
   read-only resolution before work. The latter requires the live receiver's
   actual admitted message to be committed to the active branch before expiry;
   it never manufactures human input or enables fresh human-originated work roots.
3. Complete accepted Markdown is injected as **untrusted ephemeral project data**,
   not overriding instructions, permission or another persisted Memory copy.
4. The primary decides whether useful durable state changed in the selected Memory.
   It calls `ss_memory_save` through the normal tool pipeline BEFORE its final
   reply. No explicit save call means no guessed update or automatic greeting save.
5. The host revalidates the selected binding and exact accepted revision/bytes,
   publishes once through Brain, then attempts read-back of the returned identity
   and revision. Report actual saved/unchanged/failed/pending/unconfirmed status.
6. Completion hooks never publish. A later cancelled/failed response does not undo
   a publication whose receipt was already confirmed.

Ordinary input/steering, compaction, navigation and shutdown invalidate stale
snapshots and cancel owned work. New navigation/session owners require their own
owned human/RPC or live authenticated PRIMARY activity. Continuations use the same
authorized Memory, not a new identity per model iteration. Failed automatic lookup is not retried by every context hook;
use an explicit read or a new meaningful input/lifecycle boundary. No polling or
operation queue is added. Known writer coordination may use existing session tools;
conflict/busy is not authority for automatic merge, repeated writes or lock stealing.

### Authenticated PRIMARY activity and local diagnostics

`extensions/primary-activity.ts` exposes only an ephemeral, host-owned live proof,
not message/Memory payloads or persisted grants. Receiver-owned closures remain
private host state. Sessions alone
publishes it after matching activation/message ID and exact formatted content on
the active branch, successful mailbox commitment, a still-delivered `Received`
and unexpired message TTL. A late commitment can retain the existing messaging
lineage but cannot initialize Memory. A timely commitment uses only its original
work deadline (or ordinary message expiry); observation never renews it.

The source is bound to session-manager identity, session ID, cwd and activation.
Memory can ask its live commitment observer before hooks/tool checks, avoiding a
Sessions-first hook-order assumption. Source replacement, stop/reload/navigation,
pause/interruption, lost branch proof and expiry revoke peer eligibility. Human
readiness remains separate: a peer token never latches the human boolean, resets
message budgets or approves exceptional saves. Tools, configuration/environment,
exact baseline and publication-uncertainty checks still apply before/after work.
No startup/empty save, synthetic `sendUserMessage`, automatic retry or helper grant
is added. The weak registry is shared across extension module caches, not across
processes. It is not a sandbox against malicious same-process extension code.

Fixed local codes replace ambiguous readiness/access failures:

| Code | Local cause |
| --- | --- |
| `ACTIVITY_REQUIRED` | No owned human/RPC or committed live PRIMARY activity |
| `AGENTIC_ACTIVITY_EXPIRED` | Previously accepted peer proof is no longer live |
| `ACTIVITY_CHECK_FAILED` | Live receiver activity could not be verified |
| `OWNER_CLOSED` / `OWNER_CHANGED` / `INPUT_CHANGED` | Closed/replaced owner or invalidated operation |
| `READ_DISABLED` / `WRITE_DISABLED` | Current reader/writer access denies the operation |
| `ENVIRONMENT_CHANGED` / `SCOPE_CHANGED` | Executable/environment or injected host scope changed |
| `CONFIGURATION_CHANGED` / `SCOPE_CHECK_FAILED` | Config metadata drift or failed scope verification |

Messages/footer labels come from a local allowlist, not raw backend diagnostics,
configuration values or private paths. `CANCELLED` remains distinct. An activation
waiting for authorized activity is shown as pending, not as a successful load.
These codes describe the current guard, not a reconstructed unique cause for the
historical `AUTHORITY_CHANGED` incident. The operator reports its earlier stale
session `EXECUTABLE_NOT_FOUND` resolved; no PATH/config repair was added.

Implementation/design source reviews completed within their explicit references;
regressions for live/spoofed/expired/cross-owner activity, commitment ordering,
module-cache sharing, revocation, human compatibility, disabled access and manual
approval are prepared, **not executed**. No build/reload/functional/native proof
or legacy-content import is claimed by that source-review operation. The
WORK_STATE snapshot subsequently imported into Brain retains historical review
limits; Brain alone owns current project continuity.

### Tools

- **`ss_memory_read` / Leer memoria** — no arguments; explicitly refresh the
  selected context. Its normal tool receipt contains metadata only; complete
  accepted Markdown arrives through the next ephemeral context hook, never as an
  extra full-Memory tool-result copy. Never traverse links or search other notes.
- **`ss_memory_save` / Guardar memoria** — give one concise line in `reason`
  describing what changed and why; it is not a permission grant. New unbound
  context: `title` plus exactly five `sections` in canonical Memory order.
  For an existing Memory, use **one** of these forms:
  - `edits`: for localized updates, including several fragments across sections.
    If `Outcome status` contains both `Portada: pendiente.` and `Índice: pendiente.`,
    `pendiente.` alone is ambiguous. To update only the index, include its label:
    ```json
    {"reason":"El índice ya está listo.","edits":[{"section":"Outcome status","oldText":"Índice: pendiente.","newText":"Índice: listo."}]}
    ```
    Each nonempty `oldText` must occur exactly once inside the named canonical
    section's content (not its H2). Matching is literal, including line endings.
    To insert after an anchor, include the anchor followed by the addition in
    `newText`; to delete the match, send an empty string. Up to 32 edits form one
    batch; all match the original accepted version, never each other's output.
    A missing, ambiguous, overlapping or invalid edit rejects the whole batch.
  - `changes`: replace whole sections by canonical title, not as a fallback for
    a rejected edit. Omit each H2 and preserve human material and genuine links.
    Before another H2, normally send the content **without a final line break**:
    Brain keeps the existing separator, rather than imposing a blank line or
    removing one. For example, replacing the text in `Pendiente.\n\n## Relevant evidence`
    with `Listo.` produces `Listo.\n\n## Relevant evidence`. To change the
    separation deliberately, supply the exact ending: `Listo.\n` leaves no
    blank line before the next H2. This rule does not add a newline at EOF.
  - `body`: complete successor body without YAML, retained for compatibility.

  Only the model-authored arguments shrink. StelaShell still supplies the private
  exact baseline, and Brain still checks it, identifies Markdown sections, validates
  the result and publishes it under the same history and read-back rules. No extra
  model call or capability probe. Fragment edits require a Brain that accepts
  `edits` on `update_sections`; older binaries reject it without a write.
  When a whole-section batch relies on the existing separator, SS sends
  `require_preserved_separator: true` privately to Brain. Older binaries reject
  that request rather than silently losing spacing. Explicit endings and
  last-section-only replacements need no such precondition. No automatic retry
  or fallback to rewriting sections or the document.
- Exceptional `action: "accept_manual"` asks actual host UI approval for the exact
  observed and approval-candidate bytes. No proposed model body is substituted.
- Exceptional `action: "replace_missing"` needs creation fields and actual UI
  approval of the exact old marker/identity/location and proposed new context.
  Raw marker bytes come from Brain's read-only `inspect_recovery`, not an SS file
  read/parser. Artifact/partial/pending states do not qualify. Brain rechecks real
  absence and allocates the new identity; no silent marker replacement.

New ordinary creations use the upgraded Brain's concise dated history. Existing
full-snapshot histories keep their format; no data is migrated. Brain retains one
exact accepted baseline for conflict checks. Unchanged section saves do not
add entries. A concise log is not a restorable archive of earlier contents.

Without dialog-capable UI, exceptional approval stays pending. UI denial, changed
bytes/binding, input or permission revocation prevents the mutation. Partial/corrupt
state requires explicit diagnosis/recovery outside this automatic flow, not repair.
Content usefulness and final-answer discipline are primary-agent policy; there is
no hidden natural-language classifier or guarantee against every model mistake.

## Markdown authoring and validation diagnostics

When authoring new Memory content, represent literal placeholder paths/templates
as inline code, e.g. `05-memorias/<UUID>/` and `ss_<area>_<action>`, or escape their
angle brackets. Raw placeholders can be interpreted as unclosed HTML, not plain
examples. H3 subsections are supported; they do not replace the five canonical
H2s. This guidance is included in the agent policy and save-parameter descriptions.
SS does not parse or automatically rewrite the Markdown, omit useful content,
normalize accepted bytes or weaken Brain's validation to make a save pass.

Brain may return `status: invalid` with the existing v1 failure field
`reason: UNCLOSED_HTML`. For fragment edits, `EDIT_NOT_FOUND`, `EDIT_AMBIGUOUS`
and `EDITS_OVERLAP` also have fixed local Spanish diagnostics on `invalid`.
For `UNCLOSED_HTML`, SS returns a fixed local Spanish explanation with advice to
use inline code or escapes. The status line reads
`Memoria · contenido inválido · HTML sin cerrar`; the tool still reports an error,
not a saved receipt. Raw backend messages, document fragments, paths and unknown
reasons are never echoed. No automatic retry or post-rejection read-back is added.
Older binaries without the reason and other rejections remain generic; the
footer now identifies `invalid` as `contenido inválido`, not `pendiente`.

The operator reports completing the Brain rebuild and manual SS reload after
this source update. No assistant build/reload was performed, and that report is
not independent binary-provenance, runtime or successful-publication evidence.
Regression source covers typed-reason transport, create/update presentation,
unknown/legacy errors, byte preservation and no retry; it has NOT been executed
under the current no-assistant-tests restriction. The invalid candidate was not
automatically retried and its lock sidecar is untouched. A later separately
user-requested corrected save returned saved, revision 1 and read_back confirmed;
see the WORK_STATE snapshot imported into Brain for the historical identity/receipt.
That normal-use result does not
establish the broader Windows regression or exceptional/security matrix.

A subsequent human-directed cross-session normal-use check recovered the same
Memory at revision 1 and answered five content/restriction questions from complete
matching host Memory context, not project-file reads. That host context preceded
the explicit metadata read; no new post-tool insertion attestation is claimed.
The designated sole writer reports one normal saved receipt at revision 2 with
read_back confirmed. The coordinator independently directly read found at the
same ID/revision 2, writes not paused, matching the expected 1 + 1 = 2. Matching
complete revision-2 host context includes the useful publication/readiness update
and preserves the five-section/history/constraint material. An initial messaging
DELIVERY_UNCONFIRMED delayed the writer's receipt report; its human-requested
resend was not a repeated Memory save or Memory save_unconfirmed. Core normal-use
recovery/update/cross-session reading therefore have scoped evidence. Exclusive
agentic initialization without prior human/RPC input, pristine chat, and broader
regressions/native/SDK/security remain
unestablished. The user subsequently selected the two-phase change: Brain-only
runtime/agent policy first, then a separately ordered legacy-content import. That import is
now complete: a fresh unbound context received the full WORK_STATE snapshot plus
a current five-section synthesis, with a saved/read-back-confirmed receipt and an
explicit same-ID/revision found read. The user then separately authorized removal
of the repository file. The original source's 90,519 bytes were preserved in the
literal snapshot and its SHA-256 matched before/after import. This normal-use
migration is not execution of new regressions or a broader runtime certification;
existing source/normal-use evidence remains scoped as above.

## Transport bounds and result semantics

`client.ts` launches one absolute trusted executable directly, explicit argv and
stdin EOF, one active child/no queue. `protocol.ts` validates strict v1 UTF-8/LF
framing, duplicate/unknown fields, operation/request correlation, typed identities
and lossless full-u64 revisions. Logical errors can exit0: exit status is not saved.

| Control | Ceiling |
| --- | --- |
| Complete escaped request / complete stdout | 4 MiB each |
| Complete delivered Memory JSON | 4 MiB, no clipping |
| Stderr | 16 KiB count-only, never retained/logged |
| Monotonic total operation | 10 seconds |
| Structural depth | 64 arrays/objects |

These are finite safety limits, not desired Memory size, token-window guarantees,
truncation or growth/retention policy. Oversized operations fail without silently
injecting/saving a prefix. The model's available context may impose a tighter limit;
this layer does not claim an exact provider-token preflight. Client ceilings may
be lowered, not silently increased. Node source-aware JSON.parse/JSON.rawJSON are
required; unsupported runtimes fail closed without a new JSON library.

Only HOME/USERPROFILE/HOMEDRIVE/HOMEPATH/SYSTEMROOT and temporary-directory variables
are copied. No provider keys, PATH, NODE_OPTIONS, LD_PRELOAD, proxies or arbitrary
host entries. Returned paths/text/UUIDs and approval booleans remain data.

A mutation submitted without a valid timely receipt is **`save_unconfirmed`**.
Do not retry, roll back, change backend or allocate another identity. Writes pause
across owner changes in this activation; automatic reads do not clear that fence.
An explicit read of a complete found binding can reconcile current state for
future work, not retrospectively confirm the lost receipt. A valid saved receipt
remains saved if subsequent read-back or the later response is cancelled; read-back
status is separate and is not a claim of arbitrary-editor CAS or power-loss safety.

Cancellation hard-stops the directly owned trusted Brain and observes close. If
cleanup cannot be confirmed, the client keeps its sole slot reserved until actual
close. No descendant-tree, owner-death, malicious-executable or OS sandbox claim.

## Flag-free integration verification status

The new entry point has no Memory flags: BRAIN_BIN/PATH select the executable,
Brain owns the configured vault, cwd is the internal boundary and extension
loading grants ordinary use. Regression sources were adapted for that contract;
new config-metadata and publication-drift cases are prepared, NOT executed.
No lab, Brain/Pi/provider run, build, installation or profile change was performed.

Read-only task359a9021 established backend configuration/environment rules and
the existing client's opt-in support. Its answer was PARTIAL: the authorized
command/config/client references did not establish store-level vault identity
payloads. No such identity/atomic-pinning guarantee is claimed. Narrow source reviewc15aca89 completed on four frozen production refs and found
one defect: config drift detected during read-back was not fencing later writes.
The parent corrected state.ts to apply the same scope/fence handling before and
after read-back, preserving acknowledged publication; regression source covers
new-owner/explicit-read reconciliation. This final correction has parent source
inspection only, not execution or another independent assessment. Prior executable review02b11c79 concerned the
superseded CLI-override implementation, not this new source. Older client/runtime
review failures remain incomplete, not retried or substituted. Earlier functional
results below predate these changes.

## Verification boundary

Tests run with temporary synthetic HOME/vault/work/profile and a deterministic
local Pi provider. Opt in to existing, trusted binaries; none is installed/built:

```sh
SS_TEST_BRAIN_EXE=/absolute/path/to/brain \
SS_TEST_PI_CLI=/absolute/path/to/pi/dist/bundle/cli.js npm test
```

Absent optional binaries skip corresponding integration cases; explicitly selected
missing/incompatible binaries fail, without fallback. Current outcomes belong to
the selected Brain Memory; historical results and receipts are preserved in the
WORK_STATE snapshot imported there. The new runtime review
9f7256c6 exceeded180s without an answer and remains INCOMPLETE, like the separate
prior client review; neither is approval or a pending/retried assignment. Later
parent regressions preserve new-input lookup state when old cancellation/receipts
finish, keep uncertainty activation-wide, revoke cached context when reader/scope
changes, and make concurrent navigation wait for the outstanding client close.
Those guards have no completed independent assessment.

A separately authorized actual-provider run used the real Brain repository,
normal SS profile/default openai/gpt-6.1-sol, three fresh processes/four inputs and
public RPC—not a synthetic provider. Create, empty-chat recall without re-reading
project docs and same-identity update passed; a subsequent normal save corrected
human-versus-controller evidence attribution. Saved/read-back receipts preceded
final replies; revisions1→2→3 retained the identity/history. No integration code
fix was required; model narration was checked against actual receipts/files.
Profile settings/links and Brain application sources/global configuration stayed
unchanged; actual test Memory/binding/locks and native session histories remain.

This bounded real-provider/RPC evidence is not interactive-TUI, native
Windows/macOS/Bun, performance/security or universal model-compliance certification.
Legacy-content import and repository-file retirement are complete within their
explicitly authorized scope. Optional installer, stable executable placement and
machine-specific activation remain separate authorized outcomes. Brain-only
policy does not provide a file backend while waiting for any of them.
