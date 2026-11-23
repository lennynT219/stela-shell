# StelaShell

StelaShell is a personalized environment built around Pi. The current implementation includes standalone FARO, project-continuity reminders, bounded read-only helpers, local primary-session messaging, integrated public search/page reading, an explicitly configured Brain Memory adapter and Codex-backed image previews with approval-based project saving. Web selectively adapts attributed pi-web-access source with root-owned dependencies; the retired reader/native Exa MCP route remains removed. The ss naming migration is complete. Current continuity belongs only to the selected Brain Memory; the complete legacy WORK_STATE snapshot is preserved in Brain after its separately authorized import and repository-file retirement; source/fixture success is not a guarantee of model adherence or live-service availability.

**Stela** is the company; **stela-shell** is the product (display spelling: **StelaShell**). Product tools use `ss_<area>_<action>` and short Spanish titles. For canonical names and compatibility, consult **Naming conventions** in the StelaShell Brain Project.

For a new development session, consult the host-selected Brain Memory for current outcomes, decisions and open questions. Durable references, including **Arquitectura y hoja de ruta de StelaShell**, are in [Brain Knowledge](extensions/knowledge/README.md#stelashell-project-notes), not a second operational Memory. Brain is the only primary project-memory authority; the complete legacy `docs/WORK_STATE.md` content was imported into Brain and the original retired by explicit user order. It is not a required read, fallback backend or synchronized mirror.

## Current implementation

| File | Purpose |
| --- | --- |
| `extensions/method/assets/method.md` | FARO's agent-facing instructions, in English. |
| `extensions/method/index.ts` | Loads FARO, appends it to the incoming system prompt, and provides lifecycle-based reminders to consult the selected Brain Memory, without file fallback or automatic import. |
| `extensions/presentation.ts` | Short Spanish headings for the standalone extensions. |
| `extensions/blocks/` | TUI tool cards, loaded by the primary Sessions entry: family tints in the tone of Pi's native panels, two lines for a single action, one per action in a muted yellow group, family-colored titles and a single same-color card for expanded input and output (`Ctrl+O`). See [tool rows and Codemode](extensions/sessions/README.md#compact-tool-rows). |
| `extensions/subagents/index.ts` | Registers delegation/cancellation, child read restrictions and session-bound result delivery. |
| `extensions/subagents/runner.ts` | Shared child protocol, bounded JSON parsing, deadlines and result handling. |
| `extensions/subagents/processes.ts` | Platform-specific launch and cancellation: POSIX supervision or the Windows Job controller. |
| `extensions/subagents/posix-supervisor.mjs` | Local owner-lifetime supervision and process-group cleanup; never runs a model. |
| `native/windows-job/` | Windows-only Rust controller, dependency lockfile and argv-encoding tests. |
| `native/windows-sessions/` | Separately built Windows session IPC/state protection; no daemon or changes to the Job controller. |
| `extensions/subagents/tasks.ts` | Owns the in-memory queue, deduplication and concurrency limit. |
| `extensions/subagents/assets/helper.md` | The single reusable `ss-helper` instruction contract. |
| `extensions/subagents/tests/` | Node tests and opt-in native Pi integration with a deterministic local provider. |
| `extensions/sessions/` | Primary-session discovery, authenticated local messaging, bounded automatic replies and a manual Git/activity panel (tap Stela on the editor border or use `Alt+A` / `/ss-activity`; `Alt+J` for a pending question). See its [operation, limits and platform status](extensions/sessions/README.md). |
| `extensions/web/` | Integrated `ss_web_search` / `ss_web_read`, bounded shared transport, one Node HTML parser and deterministic/Pi checks. See [scope, limits and activation](extensions/web/README.md). |
| `extensions/memory/` | Primary-only `ss_memory_read` / `ss_memory_save`, scoped Brain client and pre-final persistence. See [configuration and limits](extensions/memory/README.md); Brain-only project-memory policy, with the user-authorized legacy import completed and the repository file retired. Historical trials and scoped Windows cross-session normal use are distinguished from unexecuted regressions. |
| `extensions/knowledge/` | On-demand Brain project notes and the `/ss-project` and `/ss-knowledge` menus with a compatible Brain build. The principal's write permission is separate from Pi tool activation; additional sources are read-only. See [activation and limits](extensions/knowledge/README.md). |
| `extensions/images/` | Use natural requests to generate from text, create with 1–3 PNG references, edit a photo, or correct a preview in the same chat. Sending an image with an image operation authorizes the transfer to OpenAI via Codex, without a second prompt. Save only the approved preview to `media/images/`, including after resuming the same session. See [usage, login and limits](extensions/images/README.md). |
| `package.json` / `package-lock.json` | Seven extension entry points, test/helper-build commands, exact root HTML dependencies and the pinned Codex SDK runtime. |

The method extension supplies instructions; it does not enforce permissions, Git restrictions, or agent behavior. Changes to the Markdown require reloading the extension. The user's configuration report and source checks remain distinct from independently observed live behavior.

## Integrated web extension

The previous reader, its Windows loading junction and habitual native Exa MCP entry remain retired. The owned replacement is implemented under `extensions/web/`, without an independent package or restoring that profile route. FARO, helpers, session/native runtime, unrelated settings and Git history remain preserved; only the existing manifest-contract test changed to cover the approved new root registration/dependencies.

The replacement exposes `ss_web_search(query, objective, limit?)` (**Buscar web**) and `ss_web_read(url)` (**Leer página**). Search returns attributable sources without fetching result pages; reading supports static HTML/text/Markdown with LinkeDOM → Readability → Turndown and no hidden inference. Root exact dependencies are linkedom 0.16.11, @mozilla/readability 0.6.0 and turndown 7.2.5, installed with scripts disabled. Shared controls include public pinned HTTPS, two operations, a total 20-second abort deadline, independent encoded/decoded 2-MiB limits and a 16-KiB serialized result budget. HTML requires bounded Node workers; Bun is explicitly rejected for HTML rather than silently ignoring heap limits. See [web operation and limitations](extensions/web/README.md) and the **Diseño de búsqueda web y lectura pública** note in Brain.

At the web-delivery checkpoint, the Linux/Node integrated check passed 181, skipped 24 Windows-only and failed zero (205 total), including the search→selected URL→real HTML parser flow in isolated Pi. The current Linux web-only profile link was subsequently authorized and created; settings/MCP and existing extension links are unchanged. The user-requested live smoke in another primary then reported three Exa/MDN results (partial due to clipped snippets) and a successful selected-page HTML read without truncation. No agent-triggered reload was performed. Other instances can use operator-controlled /reload or a fresh session if the tools are absent; route and peer evidence are preserved in the legacy WORK_STATE snapshot imported into Brain. The independent web-control review timed out without an answer and remains incomplete. Operator-controlled activation must use one loading route; do not invoke stale tools or restore retired routes as fallback.

## Brain Memory — scoped integration

`ss_memory_read` (**Leer memoria**) and `ss_memory_save` (**Guardar memoria**) use the selected trusted Brain executable directly, with no added package or Pi patch. The primary must save useful authorized state and observe the real result **before the final reply**; completion hooks never publish. Manual edits and missing-reference replacement require actual UI approval and fresh validation. Unknown mutation outcomes stay `save_unconfirmed`, with no blind retry/new identity; a confirmed save survives later response cancellation.

The canonical Brain storage area is `05-memorias/<UUID>/`, retaining `Memoria.md` and `Historial.md`. Existing trial data under the former `Memorias/` spelling has NOT been migrated; use a fresh context/vault for the next human-run trial, not its old binding. See the [area-naming boundary](extensions/memory/README.md#area-naming-and-existing-data).

Loading the Memory extension explicitly authorizes ordinary reads/saves, still subject to normal tool controls. There are no Memory CLI flags: nonblank `BRAIN_BIN` or `brain` from PATH selects the executable, Brain uses its own existing configured vault, and the opened working directory is the internal context/boundary. SS resolves a bare command once per owner and launches it directly, never through Bash. Observed config-metadata changes stop the old owner; SS never parses TOML, initializes or silently adopts another vault. No startup/greeting creation, auto-initialization, whole-vault scan, installer/profile change or hidden model. The user has now selected Brain as the sole primary memory. An unavailable/disabled Brain leaves SS usable for independent authorized work with memory unavailable or persistence pending; it never activates a file backend. No content is imported from legacy records, and none is deleted or synchronized automatically. Operator-controlled reload or a fresh session is needed to load changed instructions; source changes do not reload an existing instance. A prior separately authorized trial using the former `Memorias/` layout in the actual Brain repository, normal profile and configured real model passed create, fresh-session recall and same-identity update through public RPC. Later bounded Windows normal use recovered the same `05-memorias/` Memory in another session, performed one useful update from revision 1 to 2 with a writer-reported confirmed read-back, and independently read revision 2 from the coordinator. That is not execution of the new regression/exceptional matrix or proof of exclusively agentic initialization; assistant-run labs/tests remain restricted. The prior run was not permanent activation or interactive-TUI certification. For configuration, bounds and verification limits, see the [Memory README](extensions/memory/README.md); for the design contract and provenance of earlier plans, consult **Contrato de continuidad con Brain** in Knowledge. Old artifact paths in the WORK_STATE snapshot imported into Brain remain historical evidence, not an active continuity instruction.

## Subagent core

StelaShell delegates **bounded evidence questions**, not mandatory explore/implement/verify stages. FARO instructs the parent to initiate useful delegation within the authorized task without waiting for the user to mention subagents. Routine delegation within that scope needs no separate approval unless the user or an applicable policy requires it. The parent should use tools directly for simple retrieval and delegate only when isolated reasoning has a concrete benefit, preferably alongside useful independent work.

The roles are distinct: `ss_tasks_delegate` dispatches work; `ss-helper` answers one read-only evidence question and cannot orchestrate or delegate again. The parent retains implementation, command execution where authorized, continuity and integration. This is model-guided initiative within a user task, not an automatic background scheduler or a guarantee that every model will choose delegation correctly. FARO defines the decision policy; the registered tool guidelines define asynchronous use, and the helper contract bounds the child's role.

- `ss_tasks_delegate` accepts `label`, `objective`, existing authorized `references`, optional `context`, `constraints` and `timeout_seconds`, and `done_when`. It returns a task ID immediately, not a completed answer. The receipt reports the admitted execution budget. Each reference is a file or directory that bounds the child's reader paths.
- `ss_tasks_cancel` accepts `task_id`. Queued cancellation prevents launch; running cancellation holds its concurrency slot until the process finishes cleanup.
- There is one helper definition, `ss-helper`, instantiated on demand. **Five concurrent children is both the default and the maximum**, not a target. `--ss-tasks-concurrency 1` through `5` can lower that limit for a launch. At most eight assignments may remain outstanding, including queued tasks and unintegrated results.
- Children inherit the model and thinking level at admission. They receive the bounded assignment, not the parent's conversation. They do not delegate, edit, run shell commands, create indexes or maintain Brain Memory/other project-continuity records.
- Eligible tools are the parent's active, unmodified built-in `read`, `grep`, `find` and `ls`. With Pi's usual default tools, only `read` is eligible. Inactive or overridden readers are not silently replaced or enabled.
- Exact active duplicates reuse their ID and original budget, even if labels or requested budgets differ: changing `timeout_seconds` cannot extend or restart an active question. This does not detect differently worded but semantically equivalent questions; avoiding those is the parent's responsibility.
- Results join the parent at turn boundaries. If independent work ends first, the pre-settlement hook waits on completion events without model polling and requests one integration continuation when results arrive. This does not buffer the parent's already streamed text: an interim response must identify pending work rather than claim final completion.
- Interruptions cancel owned tasks. Reload, shutdown, session replacement and tree navigation cancel and discard the old queue; old tasks are never resumed or replayed into a different session/branch. Compaction alone does not restart work.
- With Sessions loaded in the TUI, one notice above the editor counts active helpers. Click **Ver actividad** or press `Alt+A` for their labels and states. Without the activity panel, the standalone helpers keep their compact widget. `/ss-tasks` lists retained tasks; `/ss-tasks <task-id>` shows the objective, admitted budget, bounded tool trace, diagnostics and answer without adding this inspection to model context. Read traces include numeric `offset`/`limit` when supplied, not file contents or unrelated arguments; each trace entry remains bounded.

Each assignment is limited to 16 KiB, 12 model turns and 32 reader calls. The hard execution deadline defaults to **120 seconds**; the parent may choose an integer `timeout_seconds` from **120 to 300** before launch when justified. It includes startup/provider waits, not queue time, and is never extended by activity or an active duplicate. Parent and child receive the selected budget, and timeout errors name the actual applied deadline. The parser also bounds individual JSON frames and total streamed bytes. These are resource safeguards, not performance instrumentation or promises of lower latency. The extension never relaunches a failed child automatically; Pi's own recovery behavior remains subject to the same deadline.

The latest nonempty public assistant text is retained up to **8 KiB**, including text already emitted in streaming updates. Final messages replace the streaming reconstruction; empty/tool-only messages cannot erase retained evidence or turn it into a successful answer. Meaningful text is checked after control-character cleanup but before truncation: even oversized whitespace-only finals cannot manufacture an answer from the truncation notice or overwrite useful partial evidence. On failure/cancellation, retained text is explicitly marked **partial** in delivered results and `/ss-tasks`; thinking and tool-call payloads are not recovered. No extra progress turns are requested. If no public text was emitted, no answer can be recovered. Truncation is explicit.

The queue and technical details are memory-only (up to 32 recent tasks). Pi records the concise delivered answer and task metadata in the parent's ordinary session, but StelaShell does not save child transcripts or raw diagnostic logs. `completed` requires a settled, successful process with a nonempty final assistant answer; it does **not** establish that the answer satisfies the assignment. The helper separately reports answered/partial/blocked with evidence and limitations. Child usage is not aggregated into the parent's usage totals by this core.

### Runtime and permission boundary

The shared runner targets **native packaged Pi**, preserving the parent's executable, profile/environment and recognized explicit extension/prompt resource flags. It adds an explicit tool allowlist and the child guard without replacing existing permission hooks. Unknown parent CLI flags, remote `-e` sources and unsupported SDK/bridge/source launchers fail instead of selecting another executable or dropping policy options. Runtime-only grants or changes in another extension are not serialized as new consent.

Process ownership is platform-specific; the assignment, protocol and read-only limits are shared:

- **Linux/POSIX:** one small JavaScript supervisor per assignment reuses the owner's exact runtime, without another Pi session or model call. A private IPC handshake authorizes launch; loss of the owner closes that channel and triggers immediate `SIGKILL` of the target's process group. The channel is not inherited by the target, and closing assignment stdin is not a lifetime signal. Normal cancellation uses `SIGTERM`, with independent supervisor escalation to `SIGKILL` after one second or an earlier owner force request. Leader exit also cleans descendants before waiting for inherited pipes to close. The owner has a fallback for supervisor signal death while it remains alive. Node and Bun use the same source; compiled Bun Pi reuses its embedded runtime via a supervisor-only `BUN_BE_BUN=1`, restoring the original environment for the target. No Rust executable, shell or additional installed runtime is required.
- **Windows 10+:** a locally built Rust controller uses `windows-sys`. It creates the child suspended with atomic Job assignment via `PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies containment and only then resumes it. Only the three stdio handles are inherited; the Job handle is not. The controller waits on the parent/child handles and observes an empty Job after normal leader completion. Cancelling the controller closes its `KILL_ON_JOB_CLOSE` Job, terminating descendants; abrupt parent death also triggers cleanup. Windows termination is immediate, not emulated POSIX graceful signaling.

POSIX supervision is a user-space lifecycle control, not atomic kernel containment: simultaneous abrupt loss of owner and supervisor, or descendants that deliberately leave the owned process group, are not covered. The supervisor adds a local process, not a model conversation; no latency improvement is claimed.

If the Windows helper is missing or Job setup fails (including incompatible surrounding Job restrictions), delegation fails closed. There is no shell-based launch, `taskkill` fallback, automatic compilation or download. Runtime support must be established by execution on the target platform; a successful `cargo check` alone is not a linked executable or a runtime test. Windows native controller and isolated Pi integration checks have been exercised; historical checkpoint evidence and remaining platform limits are preserved in the WORK_STATE snapshot imported into Brain; consult the selected Memory for current continuity.

Children use Pi's offline management mode to avoid automatic package/tool downloads and catalog updates; selected-model inference requests remain permitted. Built-in MCP support is disabled. Runtime delegation does not install dependencies, copy credentials, rewrite profiles or create indexes. Cargo dependencies are downloaded only during an explicitly requested build.

Read-only here is a restriction on model-issued tools, **not an OS sandbox**: trusted loaded extensions and the provider still execute with the account's permissions and may have their own startup/authentication effects. Reference checks canonicalize paths (including symlinks), but do not protect against hostile filesystem races or trusted extensions that rewrite calls after the guard. Do not use this core to bypass another integration's permissions. The workspace is live, not a snapshot. Potential parent mutations mark outstanding evidence as possibly stale; external changes and arbitrary extension side effects are not exhaustively detected.

This is a StelaShell implementation using Pi's public API and JSON process protocol. Pi's official `examples/extensions/subagent/` was a technical reference; Gentle Agents and its workflow instructions are not imported or installed.

### Activation and checks

The package manifest declares the extension; this does not activate it in an already configured profile. Use one development link for `extensions/subagents/`, or load the package through one route only. Do not duplicate it with an additional package registration.

The current Windows development setup uses `PI_CODING_AGENT_DIR=$HOME/.stela-shell` with a directory junction at `$HOME/.stela-shell/extensions/subagents` pointing to this checkout's `extensions/subagents/`. It sits beside the existing method link; no settings entry is needed. This link is machine-local and is not transferred by Git. Use the actual configured profile root on each machine rather than automatically appending `/agent`; reload Pi after adding the link.

On Windows, first prepare the controller explicitly from the repository root. Prerequisites are Rust 1.85+ with the MSVC target, the Visual Studio C++ Build Tools and Windows SDK. Use a Developer PowerShell/Command Prompt with the Microsoft linker available, not Git/MSYS `link.exe`:

```powershell
npm run build:windows-helper
npm run test:windows-helper
```

These commands run Cargo with `native/windows-job/Cargo.lock`. The runner expects `native/windows-job/target/release/stela-job.exe` for the local machine; rebuild it after changing Rust source and do not redirect Cargo's output elsewhere. Build artifacts are ignored by Git. An extension development link resolves back to its real checkout before locating this helper. Linux/POSIX does not need this build. No global tool installation is performed by these scripts.

Run local tests with Node's built-in runner (Node 22.19+):

```sh
npm test
```

The shared JSON-runner fixtures require the helper on Windows; absence is a setup error, not evidence that those scenarios passed. The dedicated native Job tests explicitly skip when the artifact is absent or the OS is not Windows. They cover argv/Unicode, normal leader exit with live descendants, cancellation, forced controller termination, parent death and fail-closed startup. Native POSIX checks cover argv/stdin/environment, normal exit with descendants retaining pipes, graceful/forced cancellation, supervisor signal death, owner `SIGKILL`, and owner death or cancellation before readiness. The owner-death check tracks the supervisor and all target processes. The Linux-specific runner check also covers leader-exit descendant cleanup; changing a platform selector in a unit test is not real execution on that OS.

Native Pi integration is opt-in and uses a temporary isolated profile and deterministic provider: no real credentials, network model requests or paid generation. Windows also requires the compiled helper. Set the path to an existing packaged Pi CLI, for example:

```sh
SS_TEST_PI_CLI=/absolute/path/to/pi-coding-agent/dist/bundle/cli.js npm test
```

Without that variable, native integration tests are explicitly skipped. Temporary test state is cleaned up. Live behavior with the user's provider/profile, terminal presentation, and any speed/context benefit still require their own observation; the deterministic integration is not proof of model adherence or improved performance.

## Primary-session communication

The owned [session extension](extensions/sessions/README.md) provides `ss_sessions_list` and `ss_sessions_send` for live primary activations in the same canonical profile. Incoming messages and replies can activate a model automatically **without a per-peer/message approval dialog**. Under the user's collaboration policy, concrete peer requests are actionable delegated tasks: the receiver can use its own tools for file edits, commands and bounded helper assignments without asking for a fresh human prompt solely because the request came from a peer. Messages keep their peer provenance, do not transfer permissions or satisfy human-only approval requirements, and cannot override direct user restrictions or denials. Busy delivery waits for completed tool/turn boundaries. Helpers are excluded before resource startup.

The transport is direct local IPC, with private presence/capabilities, authenticated encrypted payloads, bounded inbox/history/conversation limits, and no daemon or automatic retries. Acceptance is not proof of reading/completion. `/ss-sessions` shows peers; `off` closes the activation and `on` starts a fresh one. `--ss-sessions-disabled` disables presence and delivery for an invocation.

Platform selection is automatic: POSIX uses Node; Windows uses a separately built Rust executable for handle-relative state, explicit DACLs and local named pipes with peer identity checks. Policy, crypto and admission stay in TypeScript. Missing artifacts/unsafe state fail closed, without downloads, compilation, ACL repair or unprotected fallback. Windows compatibility is exercised with actual native IPC and isolated deterministic Pi RPC; no new real-provider/TUI certification or completed independent security audit is claimed. A fresh Linux check exposed and then verified the repair of a missing POSIX `envelope` import. The current focused session checks pass, including deterministic Pi flows; see the historical WORK_STATE snapshot imported into Brain for checkpoint results and retained Windows evidence, not another memory authority.

On Windows, use the same Rust/MSVC/Windows SDK prerequisites as the Job controller and build explicitly:

```powershell
npm run build:windows-sessions
npm run test:windows-sessions
```

The artifact is `native/windows-sessions/target/release/stela-sessions.exe`, located through the extension's real checkout even when linked. It is independent of `stela-job.exe` and ignored by Git. End users can use a compatible prebuilt executable without installing Rust; no binary distribution/signing/update mechanism is added here. The manifest does not add a profile link or reload an existing instance. See the extension README for loading instructions and the WORK_STATE snapshot imported into Brain for historical evidence and incomplete-review/platform limits; Brain owns current continuity.

## Resume on another computer

1. Transfer this Git history through an authorized remote or another backup mechanism. A local commit alone is not a remote backup.
2. Read the FARO document and the extension entry point before continuing development.
3. Prepare Pi separately. The previously observed development installation was Pi 1.5.0; compatibility still needs a live integration check on the target computer.
4. Keep the StelaShell profile separate, using the directory selected by `PI_CODING_AGENT_DIR` rather than an unrelated agent profile. The current Windows setup uses `~/.stela-shell`; earlier Fish examples use `~/.stela-shell/agent`. These are different profile roots, not two steps to apply together. Configure credentials locally; do not commit or copy authentication files into this repository.
5. Validate extension loading and prompt composition in that profile before enabling it for normal work. Use one loading route only to avoid duplicate registration.

The agreed development approach is one symlink per extension. The user reports setup complete on the development machine; recreate machine-local links as needed on another computer rather than treating the original setup as unfinished. The manifest declaration alone does not establish that a given Pi instance has loaded the extension.

## Verification at this checkpoint

At initial checkpoint `05b22f8`, a local Node.js 26.8.1 probe imported the then-current TypeScript entry point and used a minimal registration stub. Five checks passed:

- The manifest declares the expected extension.
- The FARO document is nonempty and self-contained.
- The entry point registers `before_agent_start` once.
- The handler preserves the incoming prompt and appends FARO without mutating the event.
- Repeated calls do not accumulate extension-local prompt state.

Those historical checks do not validate later changes, the live Pi loader, reload behavior, error reporting, or model compliance. The later continuity smoke check and its limitations are preserved in the WORK_STATE snapshot imported into Brain; they were not rerun for this documentation handoff. The new subagent tests are separate from those historical checks; see the commands and limitations above. They do not reopen accepted FARO/continuity v1.

## Next work

- Resume from the selected Brain Memory; consult project documentation for the immediate task without reopening historical completed publication. The legacy WORK_STATE import is complete; do not repeat it or migrate other records without a separate human order.
- Reload the active profile after creating its development link. Live-provider/TUI observation requires its corresponding authorization and is not established by the isolated integration checks. Delegated writing, additional integrations and other roadmap capabilities remain outside this core.
- Check integration when the target environment changes or a concrete issue requires it, rather than repeating an unrelated full-environment audit.

Pi remains the agent. Rust is limited to the Windows process and session-IPC controllers; the URL reader uses TypeScript/Node. No general Rust launcher or installer is provided. The read-only subagent core and Brain Memory adapter are implemented; delegated writing remains outside this delivery.

## Working agreements

- Keep FARO's document independent of other methods and frameworks.
- Explain the need and alternatives before adding or installing dependencies, and obtain approval.
- Use the current branch when appropriate; new branches need a concrete purpose and authorization.
- Commits require explicit authorization. Pushes, publication, pull requests, and merges require their corresponding authorization separately.
- Keep personal settings, credentials, and session histories outside the source repository. Review `.gitignore` and staged paths explicitly rather than assuming all private state is excluded.
