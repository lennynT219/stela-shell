# StelaShell

StelaShell is a personalized environment built around Pi. The current implementation includes the standalone FARO method, project-continuity reminders, and a first read-only subagent core. The user accepted and published continuity v1 and reports the first version configured; this is not a guarantee of model adherence.

For a new development session, read [Project context](docs/PROJECT_CONTEXT.md) for the consolidated decisions and roadmap, then [Work state](docs/WORK_STATE.md) for current outcomes and open questions. These documents are usable without access to the previous chat or Engram database.

## Current implementation

| File | Purpose |
| --- | --- |
| `extensions/method/assets/method.md` | FARO's agent-facing instructions, in English. |
| `extensions/method/index.ts` | Loads FARO, appends it to the incoming system prompt, and provides lifecycle-based reminders to consult the project's work state. |
| `extensions/subagents/index.ts` | Registers delegation/cancellation, child read restrictions and session-bound result delivery. |
| `extensions/subagents/runner.ts` | Shared child protocol, bounded JSON parsing, deadlines and result handling. |
| `extensions/subagents/processes.ts` | Platform-specific launch and cancellation: POSIX supervision or the Windows Job controller. |
| `extensions/subagents/posix-supervisor.mjs` | Local owner-lifetime supervision and process-group cleanup; never runs a model. |
| `native/windows-job/` | Windows-only Rust controller, dependency lockfile and argv-encoding tests. |
| `extensions/subagents/tasks.ts` | Owns the in-memory queue, deduplication and concurrency limit. |
| `extensions/subagents/assets/helper.md` | The single reusable `stela-helper` instruction contract. |
| `extensions/subagents/tests/` | Node tests and opt-in native Pi integration with a deterministic local provider. |
| `package.json` | Declares both extension entry points and explicit test/helper-build commands. No npm dependencies are added. |

The method extension supplies instructions; it does not enforce permissions, Git restrictions, or agent behavior. Changes to the Markdown require reloading the extension. The user's configuration report and source checks remain distinct from independently observed live behavior.

## Subagent core

StelaShell delegates **bounded evidence questions**, not mandatory explore/implement/verify stages. FARO instructs the parent to initiate useful delegation within the authorized task without waiting for the user to mention subagents. Routine delegation within that scope needs no separate approval unless the user or an applicable policy requires it. The parent should use tools directly for simple retrieval and delegate only when isolated reasoning has a concrete benefit, preferably alongside useful independent work.

The roles are distinct: `stela_delegate` dispatches work; `stela-helper` answers one read-only evidence question and cannot orchestrate or delegate again. The parent retains implementation, command execution where authorized, continuity and integration. This is model-guided initiative within a user task, not an automatic background scheduler or a guarantee that every model will choose delegation correctly. FARO defines the decision policy; the registered tool guidelines define asynchronous use, and the helper contract bounds the child's role.

- `stela_delegate` accepts `label`, `objective`, existing authorized `references`, optional `context`, `constraints` and `timeout_seconds`, and `done_when`. It returns a task ID immediately, not a completed answer. The receipt reports the admitted execution budget. Each reference is a file or directory that bounds the child's reader paths.
- `stela_cancel` accepts `task_id`. Queued cancellation prevents launch; running cancellation holds its concurrency slot until the process finishes cleanup.
- There is one helper definition, `stela-helper`, instantiated on demand. **Five concurrent children is both the default and the maximum**, not a target. `--stela-subagent-concurrency 1` through `5` can lower that limit for a launch. At most eight assignments may remain outstanding, including queued tasks and unintegrated results.
- Children inherit the model and thinking level at admission. They receive the bounded assignment, not the parent's conversation. They do not delegate, edit, run shell commands, create indexes or maintain WORK_STATE.
- Eligible tools are the parent's active, unmodified built-in `read`, `grep`, `find` and `ls`. With Pi's usual default tools, only `read` is eligible. Inactive or overridden readers are not silently replaced or enabled.
- Exact active duplicates reuse their ID and original budget, even if labels or requested budgets differ: changing `timeout_seconds` cannot extend or restart an active question. This does not detect differently worded but semantically equivalent questions; avoiding those is the parent's responsibility.
- Results join the parent at turn boundaries. If independent work ends first, the pre-settlement hook waits on completion events without model polling and requests one integration continuation when results arrive. This does not buffer the parent's already streamed text: an interim response must identify pending work rather than claim final completion.
- Interruptions cancel owned tasks. Reload, shutdown, session replacement and tree navigation cancel and discard the old queue; old tasks are never resumed or replayed into a different session/branch. Compaction alone does not restart work.
- A compact widget shows each outstanding helper's label and state. `/stela-tasks` lists retained tasks; `/stela-tasks <task-id>` shows the objective, admitted budget, bounded tool trace, diagnostics and answer without adding this inspection to model context. Read traces include numeric `offset`/`limit` when supplied, not file contents or unrelated arguments; each trace entry remains bounded.

Each assignment is limited to 16 KiB, 12 model turns and 32 reader calls. The hard execution deadline defaults to **120 seconds**; the parent may choose an integer `timeout_seconds` from **120 to 300** before launch when justified. It includes startup/provider waits, not queue time, and is never extended by activity or an active duplicate. Parent and child receive the selected budget, and timeout errors name the actual applied deadline. The parser also bounds individual JSON frames and total streamed bytes. These are resource safeguards, not performance instrumentation or promises of lower latency. The extension never relaunches a failed child automatically; Pi's own recovery behavior remains subject to the same deadline.

The latest nonempty public assistant text is retained up to **8 KiB**, including text already emitted in streaming updates. Final messages replace the streaming reconstruction; empty/tool-only messages cannot erase retained evidence or turn it into a successful answer. Meaningful text is checked after control-character cleanup but before truncation: even oversized whitespace-only finals cannot manufacture an answer from the truncation notice or overwrite useful partial evidence. On failure/cancellation, retained text is explicitly marked **partial** in delivered results and `/stela-tasks`; thinking and tool-call payloads are not recovered. No extra progress turns are requested. If no public text was emitted, no answer can be recovered. Truncation is explicit.

The queue and technical details are memory-only (up to 32 recent tasks). Pi records the concise delivered answer and task metadata in the parent's ordinary session, but StelaShell does not save child transcripts or raw diagnostic logs. `completed` requires a settled, successful process with a nonempty final assistant answer; it does **not** establish that the answer satisfies the assignment. The helper separately reports answered/partial/blocked with evidence and limitations. Child usage is not aggregated into the parent's usage totals by this core.

### Runtime and permission boundary

The shared runner targets **native packaged Pi**, preserving the parent's executable, profile/environment and recognized explicit extension/prompt resource flags. It adds an explicit tool allowlist and the child guard without replacing existing permission hooks. Unknown parent CLI flags, remote `-e` sources and unsupported SDK/bridge/source launchers fail instead of selecting another executable or dropping policy options. Runtime-only grants or changes in another extension are not serialized as new consent.

Process ownership is platform-specific; the assignment, protocol and read-only limits are shared:

- **Linux/POSIX:** one small JavaScript supervisor per assignment reuses the owner's exact runtime, without another Pi session or model call. A private IPC handshake authorizes launch; loss of the owner closes that channel and triggers immediate `SIGKILL` of the target's process group. The channel is not inherited by the target, and closing assignment stdin is not a lifetime signal. Normal cancellation uses `SIGTERM`, with independent supervisor escalation to `SIGKILL` after one second or an earlier owner force request. Leader exit also cleans descendants before waiting for inherited pipes to close. The owner has a fallback for supervisor signal death while it remains alive. Node and Bun use the same source; compiled Bun Pi reuses its embedded runtime via a supervisor-only `BUN_BE_BUN=1`, restoring the original environment for the target. No Rust executable, shell or additional installed runtime is required.
- **Windows 10+:** a locally built Rust controller uses `windows-sys`. It creates the child suspended with atomic Job assignment via `PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies containment and only then resumes it. Only the three stdio handles are inherited; the Job handle is not. The controller waits on the parent/child handles and observes an empty Job after normal leader completion. Cancelling the controller closes its `KILL_ON_JOB_CLOSE` Job, terminating descendants; abrupt parent death also triggers cleanup. Windows termination is immediate, not emulated POSIX graceful signaling.

POSIX supervision is a user-space lifecycle control, not atomic kernel containment: simultaneous abrupt loss of owner and supervisor, or descendants that deliberately leave the owned process group, are not covered. The supervisor adds a local process, not a model conversation; no latency improvement is claimed.

If the Windows helper is missing or Job setup fails (including incompatible surrounding Job restrictions), delegation fails closed. There is no shell-based launch, `taskkill` fallback, automatic compilation or download. Runtime support must be established by execution on the target platform; a successful `cargo check` alone is not a linked executable or a runtime test. Windows native controller and isolated Pi integration checks have been exercised; current evidence and remaining platform limits are in [Work state](docs/WORK_STATE.md).

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
STELA_TEST_PI_CLI=/absolute/path/to/pi-coding-agent/dist/bundle/cli.js npm test
```

Without that variable, native integration tests are explicitly skipped. Temporary test state is cleaned up. Live behavior with the user's provider/profile, terminal presentation, and any speed/context benefit still require their own observation; the deterministic integration is not proof of model adherence or improved performance.

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

Those historical checks do not validate later changes, the live Pi loader, reload behavior, error reporting, or model compliance. The later continuity smoke check and its limitations are recorded in [Work state](docs/WORK_STATE.md); they were not rerun for this documentation handoff. The new subagent tests are separate from those historical checks; see the commands and limitations above. They do not reopen accepted FARO/continuity v1.

## Next work

- Resume from the project context and work state without reopening the accepted first version's completed publication.
- Reload the active profile after creating its development link. Live-provider/TUI observation requires its corresponding authorization and is not established by the isolated integration checks. Delegated writing, additional integrations and other roadmap capabilities remain outside this core.
- Check integration when the target environment changes or a concrete issue requires it, rather than repeating an unrelated full-environment audit.

Pi remains the agent. Rust is used only for the Windows process controller in this implementation; no general Rust launcher or installer is provided. The read-only subagent core is implemented; memory integrations and delegated writing are not.

## Working agreements

- Keep FARO's document independent of other methods and frameworks.
- Explain the need and alternatives before adding or installing dependencies, and obtain approval.
- Use the current branch when appropriate; new branches need a concrete purpose and authorization.
- Commits require explicit authorization. Pushes, publication, pull requests, and merges require their corresponding authorization separately.
- Keep personal settings, credentials, and session histories outside the source repository. Review `.gitignore` and staged paths explicitly rather than assuming all private state is excluded.
