# StelaShell

StelaShell is a personalized environment built around Pi. The current implementation includes the standalone FARO method, project-continuity reminders, and a first read-only subagent core. The user accepted and published continuity v1 and reports the first version configured; this is not a guarantee of model adherence.

For a new development session, read [Project context](docs/PROJECT_CONTEXT.md) for the consolidated decisions and roadmap, then [Work state](docs/WORK_STATE.md) for current outcomes and open questions. These documents are usable without access to the previous chat or Engram database.

## Current implementation

| File | Purpose |
| --- | --- |
| `extensions/method/assets/method.md` | FARO's agent-facing instructions, in English. |
| `extensions/method/index.ts` | Loads FARO, appends it to the incoming system prompt, and provides lifecycle-based reminders to consult the project's work state. |
| `extensions/subagents/index.ts` | Registers delegation/cancellation, child read restrictions and session-bound result delivery. |
| `extensions/subagents/runner.ts` | Runs a child Pi process, parses bounded JSON events and handles termination. |
| `extensions/subagents/tasks.ts` | Owns the in-memory queue, deduplication and concurrency limit. |
| `extensions/subagents/assets/helper.md` | The single reusable `stela-helper` instruction contract. |
| `extensions/subagents/tests/` | Node tests and opt-in native Pi integration with a deterministic local provider. |
| `package.json` | Declares both extension entry points and the test command. No dependencies are added. |

The method extension supplies instructions; it does not enforce permissions, Git restrictions, or agent behavior. Changes to the Markdown require reloading the extension. The user's configuration report and source checks remain distinct from independently observed live behavior.

## Subagent core

StelaShell delegates **bounded evidence questions**, not mandatory explore/implement/verify stages. The parent should use tools directly for simple retrieval and delegate only when isolated reasoning has a concrete benefit, preferably alongside useful independent work.

- `stela_delegate` accepts `label`, `objective`, existing authorized `references`, optional `context` and `constraints`, and `done_when`. It returns a task ID immediately, not a completed answer. Each reference is a file or directory that bounds the child's reader paths.
- `stela_cancel` accepts `task_id`. Queued cancellation prevents launch; running cancellation holds its concurrency slot until the process finishes cleanup.
- There is one helper definition, `stela-helper`, instantiated on demand. **Five concurrent children is both the default and the maximum**, not a target. `--stela-subagent-concurrency 1` through `5` can lower that limit for a launch. At most eight assignments may remain outstanding, including queued tasks and unintegrated results.
- Children inherit the model and thinking level at admission. They receive the bounded assignment, not the parent's conversation. They do not delegate, edit, run shell commands, create indexes or maintain WORK_STATE.
- Eligible tools are the parent's active, unmodified built-in `read`, `grep`, `find` and `ls`. With Pi's usual default tools, only `read` is eligible. Inactive or overridden readers are not silently replaced or enabled.
- Exact active duplicates reuse their ID, even if their labels differ. This does not detect differently worded but semantically equivalent questions; avoiding those is the parent's responsibility.
- Results join the parent at turn boundaries. If independent work ends first, the pre-settlement hook waits on completion events without model polling and requests one integration continuation when results arrive. This does not buffer the parent's already streamed text: an interim response must identify pending work rather than claim final completion.
- Interruptions cancel owned tasks. Reload, shutdown, session replacement and tree navigation cancel and discard the old queue; old tasks are never resumed or replayed into a different session/branch. Compaction alone does not restart work.
- A compact widget shows each outstanding helper's label and state. `/stela-tasks` lists retained tasks; `/stela-tasks <task-id>` shows the objective, bounded tool trace, diagnostics and answer without adding this inspection to model context.

Each assignment is limited to 16 KiB, 12 model turns, 32 reader calls and a 120-second execution deadline. A child answer is capped at 8 KiB with an explicit truncation notice. The parser also bounds individual JSON frames and total streamed bytes. These are execution/resource safeguards, not performance instrumentation or promises of lower latency. The extension never relaunches a failed child automatically; Pi's own recovery behavior remains subject to the child's deadline.

The queue and technical details are memory-only (up to 32 recent tasks). Pi records the concise delivered answer and task metadata in the parent's ordinary session, but StelaShell does not save child transcripts or raw diagnostic logs. `completed` means a settled, successful process produced an answer; it does **not** establish that the answer satisfies the assignment. The helper separately reports answered/partial/blocked with evidence and limitations. Child usage is not aggregated into the parent's usage totals by this core.

### Runtime and permission boundary

The first runner targets **native packaged Pi on POSIX**, exercised on Linux with Pi 1.5.2 and Node 24.22.2. It preserves the parent's profile/environment and recognized explicit extension/prompt resource flags, then adds an explicit tool allowlist and the child guard. Existing permission hooks remain loaded; the guard adds restrictions rather than replacing them. Unknown parent CLI flags, remote `-e` package sources, SDK/bridge/source launchers and Windows are rejected rather than silently switching to another Pi executable or dropping a policy option. Runtime-only grants or changes in another extension are not serialized as new consent.

Children run with Pi's offline management mode to avoid automatic package/tool downloads and catalog updates; that mode still permits the selected model's inference requests. Built-in MCP support is disabled for children. There is no installation, new dependency, credential copying, profile rewrite or automatic index setup in this extension.

Read-only here is a restriction on model-issued tools, **not an OS sandbox**: trusted loaded extensions and the provider still execute with the account's permissions and may have their own startup/authentication effects. Reference checks canonicalize paths (including symlinks), but do not protect against hostile filesystem races or trusted extensions that rewrite calls after the guard. Do not use this core to bypass another integration's permissions. The workspace is live, not a snapshot. Potential parent mutations mark outstanding evidence as possibly stale; external changes and arbitrary extension side effects are not exhaustively detected.

This is a StelaShell implementation using Pi's public API and JSON process protocol. Pi's official `examples/extensions/subagent/` was a technical reference; Gentle Agents and its workflow instructions are not imported or installed.

### Activation and checks

The package manifest declares the extension; this does not activate it in an already configured profile. No profile link or setting was changed during implementation. When activation is authorized, use the agreed single development link for `extensions/subagents/`, or load the package through one route only. Do not duplicate it with an additional package registration.

Run local tests with Node's built-in runner (Node 22.19+):

```sh
npm test
```

Native Pi integration is opt-in and uses a temporary isolated profile and deterministic provider: no real credentials, network model requests or paid generation. Set the path to an existing packaged Pi CLI, for example:

```sh
STELA_TEST_PI_CLI=/absolute/path/to/pi-coding-agent/dist/bundle/cli.js npm test
```

Without that variable, native integration tests are explicitly skipped. Temporary test state is cleaned up. Live behavior with the user's provider/profile, terminal presentation, and any speed/context benefit still require their own observation; the deterministic integration is not proof of model adherence or improved performance.

## Resume on another computer

1. Transfer this Git history through an authorized remote or another backup mechanism. A local commit alone is not a remote backup.
2. Read the FARO document and the extension entry point before continuing development.
3. Prepare Pi separately. The previously observed development installation was Pi 1.5.0; compatibility still needs a live integration check on the target computer.
4. Keep the StelaShell profile separate, using `~/.stela-shell/agent` rather than an unrelated agent profile. Configure credentials locally; do not commit or copy authentication files into this repository.
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
- Activate and observe the subagent core in the user's profile only with authorization. Delegated writing, additional integrations and other roadmap capabilities remain outside this first core.
- Check integration when the target environment changes or a concrete issue requires it, rather than repeating an unrelated full-environment audit.

Pi remains the agent. Rust is intended for selected tools, a launcher, and installation responsibilities when needed; no Rust component has been implemented. The read-only subagent core is implemented; memory integrations and delegated writing are not.

## Working agreements

- Keep FARO's document independent of other methods and frameworks.
- Explain the need and alternatives before adding or installing dependencies, and obtain approval.
- Use the current branch when appropriate; new branches need a concrete purpose and authorization.
- Commits require explicit authorization. Pushes, publication, pull requests, and merges require their corresponding authorization separately.
- Keep personal settings, credentials, and session histories outside the source repository. Review `.gitignore` and staged paths explicitly rather than assuming all private state is excluded.
