# Brain Memory integration

Local implementation: a primary-only Pi extension, ordinary `ss_memory_read` /
`ss_memory_save` tools, transient owned state, and the existing isolated Brain JSON
client. **Save and observe the actual result BEFORE the final user response**, just
like WORK_STATE. No Pi fork, post-settlement tool replay, hidden summarizer or
separate finalization model turn.

This does not automatically/permanently activate a real vault/profile, install
Brain or migrate continuity. A separately authorized bounded real-provider trial
has now passed in the Brain repository; details are in WORK_STATE below.
`docs/WORK_STATE.md` remains the current primary record. The package declares the
entry point; loading it authorizes ordinary Memory use. No Memory lookup or Brain
subprocess runs before genuine interactive/RPC input. Helpers are excluded before
tools/hooks/resources. This source change does not create the missing profile link.

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
A bad BRAIN_BIN selection does not fall back to another executable. Bare names
are located with metadata checks in PATH order once per owner, then pinned as an
absolute path for direct shell:false execution. PATH relative/empty components
follow cwd; an entirely absent/empty PATH is not guessed. Windows remains native
.exe-only. No candidate is executed as a probe. Missing commands report
**Memoria · Brain no encontrado**; no installer/build/download/repair is invoked.
The unchanged client still receives a minimal child environment without PATH or
BRAIN_BIN; its host explicitly opts into Brain's existing configured-vault mode.

SS freezes that child environment and checks current executable/environment
authority. On the first genuine read, a host guard lazily captures only metadata
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
2. First genuine interactive/RPC input enables read-only resolution before work.
   Extension-generated messages cannot manufacture first-use human eligibility.
3. Complete accepted Markdown is injected as **untrusted ephemeral project data**,
   not overriding instructions, permission or another persisted Memory copy.
4. The primary decides whether useful durable state changed, as with WORK_STATE.
   It calls `ss_memory_save` through the normal tool pipeline BEFORE its final
   reply. No explicit save call means no guessed update or automatic greeting save.
5. The host revalidates the selected binding and exact accepted revision/bytes,
   publishes once through Brain, then attempts read-back of the returned identity
   and revision. Report actual saved/unchanged/failed/pending/unconfirmed status.
6. Completion hooks never publish. A later cancelled/failed response does not undo
   a publication whose receipt was already confirmed.

Ordinary input/steering, compaction, navigation and shutdown invalidate stale
snapshots and cancel owned work. New navigation/session owners require genuine
input again. Continuations use the same authorized Memory, not a new identity per
model iteration. Failed automatic lookup is not retried by every context hook;
use an explicit read or a new meaningful input/lifecycle boundary. No polling or
operation queue is added. Known writer coordination may use existing session tools;
conflict/busy is not authority for automatic merge, repeated writes or lock stealing.

### Tools

- **`ss_memory_read` / Leer memoria** — no arguments; explicitly refresh the
  selected context. Its normal tool receipt contains metadata only; complete
  accepted Markdown arrives through the next ephemeral context hook, never as an
  extra full-Memory tool-result copy. Never traverse links or search other notes.
- **`ss_memory_save` / Guardar memoria** — `reason` explains the durable outcome;
  it is not a permission grant. New unbound context: `title` plus exactly five
  `sections` in WORK_STATE order. Existing Memory: complete successor `body`,
  without YAML frontmatter, retaining the five top-level H2s, accepted human
  material and genuine history/optional Project relations. Brain alone parses it.
- Exceptional `action: "accept_manual"` asks actual host UI approval for the exact
  observed and approval-candidate bytes. No proposed model body is substituted.
- Exceptional `action: "replace_missing"` needs creation fields and actual UI
  approval of the exact old marker/identity/location and proposed new context.
  Raw marker bytes come from Brain's read-only `inspect_recovery`, not an SS file
  read/parser. Artifact/partial/pending states do not qualify. Brain rechecks real
  absence and allocates the new identity; no silent marker replacement.

Without dialog-capable UI, exceptional approval stays pending. UI denial, changed
bytes/binding, input or permission revocation prevents the mutation. Partial/corrupt
state requires explicit diagnosis/recovery outside this automatic flow, not repair.
Content usefulness and final-answer discipline are primary-agent policy; there is
no hidden natural-language classifier or guarantee against every model mistake.

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
missing/incompatible binaries fail, without fallback. Current observed results and
receipts are in [WORK_STATE](../../docs/WORK_STATE.md). The new runtime review
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
WORK_STATE replacement, optional installer, stable executable placement and
permanent activation remain separate authorized outcomes.
