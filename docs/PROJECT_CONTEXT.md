# StelaShell: Project Context and Continuation Brief

Use this document to resume development in a new StelaShell session without access to the previous chat or its Engram database. It consolidates project decisions, evidence, boundaries, and pending work; it is not another system prompt or an additional method to inject on every turn.

Read [WORK_STATE.md](WORK_STATE.md) for the latest local work record and [the FARO method](../extensions/method/assets/method.md) for its operational rules. Inspect the current files before acting: this document is a checkpoint, not proof that a future machine has the same configuration.

## 1. Objective and working relationship

Build a personalized environment around Pi, progressively selecting useful capabilities from the reference projects instead of copying an entire distribution.

- Pi remains the agent and host. Do not replace its conversation loop, sessions, or model infrastructure with a Rust reimplementation.
- Rust is intended for selected executable tools, a launcher, and installation responsibilities when these become necessary. This does not authorize rewriting every upstream tool.
- Use small TypeScript/JavaScript extensions for Pi's lifecycle, prompt, tool, and UI integration. A Rust component needs an integration boundary; no universal bridge has been selected.
- Keep capabilities independently understandable and maintainable. Add a component for a concrete need, not merely to demonstrate an architecture.
- The user works with Fish and Neovim and also uses LazyGit. Explain concepts and tradeoffs before implementation, with practical examples and diagrams when useful.
- Communicate with the user in Spanish. Repository code, identifiers, and agent-facing documentation are in English unless the user requests otherwise or an existing file has another convention.
- The user sometimes writes the code personally. A request for code to copy or an explanation does not authorize writing files. Distinguish approval of a design from approval to implement it.
- Work through the agreed themes incrementally. Do not turn this context into authorization to implement the entire roadmap.

## 2. Current checkpoint and evidence levels

The user most recently reported that the first StelaShell version is configured. Accept that as a user report, not as independently observed loading, alias, symlink, or model-compliance evidence.

At preparation time:

- This repository was on `main`, tracking `origin/main`, with a clean worktree before this documentation change. The recorded canonical project remote is `git@github.com:lennynT219/stela-shell.git`; inspect the actual current remote before publication.
- The initial checkpoint `05b22f8` was committed and successfully pushed without force. It contained FARO, the user-written extension, the package manifest, and the README.
- Later local history contains `475320b` (`feat(method): add first version of project continuity`), `268f53b` (`docs: record blocked publication of continuity v1`), and current checkpoint `6d264b4` (`doc: Add memory`). Do not mistake the initial checkpoint for the current implementation.
- `docs/WORK_STATE.md` is the tracked primary continuity record. It documents acceptance and manual publication of continuity v1; the earlier SSH publication blocker is recorded as resolved. Local `main` and its tracking reference are aligned, but this handoff did not contact the remote server again.
- The current extension is larger than the original adapter: it adds hidden continuity reminders after session start, compaction, navigation, or interruption. It points the agent to WORK_STATE rather than reading or writing that file itself. No `agent_before_settle` continuation is registered in the inspected source.
- WORK_STATE records a later Node smoke check and whitespace check for the continuity changes. Those are recorded results, not checks rerun during this handoff. The user accepted v1 with live adherence as an observational limitation, not an unfinished publication gate.
- A prior Node.js 26.8.1 probe passed five checks against the original extension entry point using a registration stub: manifest entry, nonempty standalone method, hook registration, preservation of the incoming prompt, and no extension-local prompt accumulation.
- Those five checks were not a live Pi integration test and do not establish correctness of later continuity changes. Do not relabel historical results as current test runs.
- The previously observed Pi executable version was 1.5.0. Public documentation may describe a different version; confirm the target API before implementing an integration.
- The subagent core and its separately authorized Windows Rust process controller are described in section 5 and WORK_STATE. The controller is not a general launcher, installer or replacement agent, and is separate from accepted FARO/continuity v1.

Keep four categories distinct: agreed requirements, source-code observations, user-reported configuration, and successfully exercised behavior. A tool declaration, package version, or model's self-description is not runtime proof.

## 3. Source layout and local profile

The agreed source layout has one directory per extension:

```text
stela-shell/
├── package.json
├── README.md
├── docs/
│   ├── WORK_STATE.md
│   └── PROJECT_CONTEXT.md
├── native/windows-job/   # Windows-only controller; Cargo.toml, Cargo.lock, src/
└── extensions/
    ├── method/
    │   ├── index.ts
    │   └── assets/method.md
    ├── subagents/
    │   ├── index.ts
    │   ├── runner.ts
    │   ├── processes.ts
    │   ├── posix-supervisor.mjs
    │   ├── tasks.ts
    │   ├── assets/helper.md
    │   └── tests/
    └── sessions/
        ├── index.ts
        ├── messages.ts
        ├── transport.ts
        ├── README.md
        └── tests/
```

Keep relevant tests organized by the capability they verify. Do not create empty placeholder tests or assume an untracked empty directory will be preserved by Git.

The profile is separate from source. Its root is selected by `PI_CODING_AGENT_DIR`. The verified Windows development root is `~/.stela-shell`; the earlier Fish snippets below use `~/.stela-shell/agent`. Do not create a second profile merely to match an old example.

```text
<PI_CODING_AGENT_DIR>/
└── extensions/
    ├── method -> <checkout>/extensions/method/
    └── subagents -> <checkout>/extensions/subagents/
```

On the current Windows setup these are directory links; the subagent junction was created and checked under the user's activation authorization. The local helper remains in the checkout's ignored build directory, not in the profile or Git.

Development uses one symlink per extension. A real installed distribution can later use versioned installed files. Do not activate an empty entry point or load the same extension through both a development link and a separate package registration.

The root `package.json` was approved. Its `pi.extensions` field declares the entry point; this does not prove that an arbitrary running Pi session has loaded the package. `private: true` prevents accidental npm publication, not public visibility on GitHub.

The supplied Fish launch command is:

```fish
env PI_CODING_AGENT_DIR="$HOME/.stela-shell/agent" pi
```

The supplied persistent alias is:

```fish
alias --save stela 'env PI_CODING_AGENT_DIR="$HOME/.stela-shell/agent" pi'
```

The alias is for that user's Fish sessions, not all users, shells, or computers. It forwards arguments, such as `stela --continue`, and does not change `pi` itself. Do not recreate or overwrite it merely because this document shows it.

A profile is configuration separation, not an OS sandbox. Do not copy credentials, personal session histories, or unrelated settings into the source repository. Git does not transfer the external profile, symlink, alias, or Engram database to another computer.

## 4. FARO decisions: settled, not questions to reopen

FARO means **Flujo Adaptativo con Resultados Observables**. Its agent-facing document is standalone: do not add names, comparisons, copied instructions, or dependencies on other development methods to that document.

The canonical rules are in `extensions/method/assets/method.md`. The following is a decision summary for continuity, not a second independently maintained rules file:

1. Cover all activities, adapting to the actual deliverable. A software repository does not make every request a software implementation task.
2. Infer learning versus delivery from the request. Ask only when ambiguity materially changes the approach or result.
3. Infer and briefly state the minimum completion criteria grounded in the request and existing behavior. Do not invent extra features.
4. For multiple outcomes, show a brief division and dependencies, then proceed within authorized scope. Ask about real scope or product decisions, not routine transitions.
5. Track useful outcomes rather than edits or tool calls. Code, relevant checks, and documentation belong to the same outcome.
6. Show an early version that works for the main case. Its form depends on the deliverable; explicitly distinguish it from full completion.
7. Organize verification by functionality, deliverable, request, or a justified project boundary. The agent decides whether an automated test adds value and when the unit is ready; do not test mechanically after every edit or wait until the entire project ends.
8. Do not impose a prerequisite of writing and running a failing test before implementation. Applicable verification still needs honest evidence.
9. Avoid repeated checks without relevant changes, duplicate reviews without a distinct purpose, unjustified full suites, and reopening completed work without invalidating evidence.
10. Skip no-value tests. The cleanup permission applies only to useless tests newly added by the current task; it does not authorize changing or deleting pre-existing tests or removing useful coverage.
11. Continue corrections while concrete causes or hypotheses produce evidence-based progress within scope, permissions, and applicable limits. Stop blind retries and consult when stuck, scope must expand, or a limit is reached.
12. When an out-of-scope improvement appears, pause and consult before continuing even if the improvement is nonblocking. This is a deliberate user choice, not merely a request to mention it later.
13. A technical blocker is different: explain it and continue independent, safe, already-authorized work without retry loops.
14. Require a durable work record when the request and current changes alone are insufficient to reconstruct and resume the work. Specific storage mechanisms must serve continuity, not impose ceremony.
15. Communicate at useful milestones: objective and approach, early results, decisions, blockers, and closure. Do not narrate every tool.
16. Close when agreed criteria are satisfied and checked. Final human approval is required only where it was part of the agreement.
17. Explain the need and alternatives and obtain approval before changing or installing project dependencies. This does not grant global installation permission.
18. Timing collection and benchmarking are outside the method. Earlier timing experiments were the user's investigation, not a requested FARO capability.

### Accepted project-continuity v1

The newer implementation makes the continuity mechanism concrete; do not leave this part described as an undecided storage proposal:

- `docs/WORK_STATE.md` is the primary active-state record. Read it when starting or resuming relevant project work; re-read after compaction or navigation when its relevant contents are unavailable or may have changed. Unrelated conversation does not require file access.
- Keep a consolidated snapshot, not a transcript or a section per request. Persist only information that changes future decisions, constraints, outcome states, blockers, next actions, or evidence needed to resume the objective.
- When continuity maintenance is authorized, explicit consequential decisions belong in the current work cycle, creating the record if absent. Incorporate later confirmations into the existing entry without promoting unconfirmed information to verified fact.
- If relevance is uncertain, retain it in conversation context and reconsider later. Two or three exchanges are an opportunity to observe relevance, not a waiting rule, counter, or automatic save trigger. Do not create candidate-record files or artificial pending items.
- Apply permissions per resource: read-only external access does not by itself prohibit separately authorized local record updates; local persistence never grants external write permission. Explicit bans on file changes or persistence remain binding.
- Maintain exactly these five level-two sections, in order: `Objective and scope`, `Current decisions`, `Outcome status`, `Relevant evidence`, and `Next actions and open questions`. Each has a purpose description in the method's template. Consolidate by project outcome.
- Complete required and authorized persistence before the final response; report failures or unavailable persistence honestly. This is guidance to the agent, not a mechanism that intercepts streamed replies.
- Do not reopen accepted v1 implementation or publication merely because its behavior can be observed further. If the obsolete post-response review reminder persists after reload, its emitting extension or instance is an unresolved diagnostic question outside that completed scope.
- This broader context file complements WORK_STATE; it does not replace its authority as the current work record or create another prompt-injection mechanism.

### Git policy

- Inspect the repository, current branch, and existing changes; preserve unrelated work.
- Prefer the current branch when appropriate. No branch per task, file, adjustment, or arbitrary size threshold.
- Propose a branch only for useful isolation, such as separately reviewed work, an experiment, or independent parallel development. Explain why and obtain authorization for that objective.
- Commit coherent, reviewable outcomes only on request or under prior authorization for the concrete objective. Do not commit mechanically after every edit.
- Keep relevant code, tests, and docs together. Commit permission does not include push, publication, PR creation, merge, or destructive Git operations.
- Earlier one-off commit and push approvals are completed actions, not standing authorization for future publication.

## 5. Subagents: outcome-oriented core

The user approved and authorized a core based on bounded evidence questions rather than a fixed catalog or sequence of specialists. One reusable definition, `stela-helper`, receives a concrete objective, minimal context, authorized references, constraints and a completion criterion. The useful result, not a role name, determines delegation. Exploration/implementation/verification remain possible kinds of work, not required agent definitions.

These earlier functional agreements remain relevant with that refinement:

| ID | Agreement |
| --- | --- |
| SA1 | Exploration, implementation, and verification are useful core roles, not a mandatory three-agent sequence. |
| SA2 | Do not bring Judgment Day into StelaShell. The earlier removal request concerned this project's distribution, not global installations or sibling repositories. Preserve useful verification and any separately retained native-review requirements. |
| SA3 | Delegate automatically within authorized scope when there is a clear benefit. Show the role, objective, and result; required consent remains separate. |
| SA4 | Keep the habitual catalog limited to supported roles relevant to the project. Hiding catalog entries is not permission to delete external files. |
| SA5 | Parallelize independent work when useful, within configured limits and without overlapping writers. No universal concurrency number was approved. |
| SA6 | Use bounded handoffs with objectives, limits, criteria, files or references, and current findings. Expand context only when needed. |
| SA7 | Show role, objective, state, and a concise summary; provide technical activity detail on request. |

The read-only comparison is complete. StelaShell implements its own extension using Pi's public API and one-shot JSON subprocesses, with Pi's official subagent example as a technical reference, not an installed dependency. Gentle Agents and its workflow instructions are not imported. Do not repeat the original questionnaire or restart that comparison without new evidence.

### Authorized first core

- `stela_delegate` admits a bounded read-only assignment and returns an ID without waiting; `stela_cancel` cancels it. Children cannot delegate, write, run shell commands, create indexes or maintain project continuity.
- **Five simultaneous children is the user-selected default and maximum**, replacing the earlier proposal of two. A launch may reduce it with `--stela-subagent-concurrency`; useful independent work determines actual usage.
- Children inherit the parent's model and thinking level at admission. Specialized model profiles, provider-specific cost choices and fallback chains are not selected.
- FARO section 3 instructs the parent to initiate beneficial delegation inside the authorized task without waiting for the user to mention subagents, while resolving simple retrieval directly. The tool guidelines follow that policy; the helper applies FARO only within its bounded read-only role. This is model-guided initiative, not a background scheduler or a guarantee of delegation on every task. Instruction checks and observed spontaneous model choice are distinct; see WORK_STATE.
- The parent retains integration and continuity responsibility. FARO's handoff rule now asks for one coherent objective, splitting oversized work only at independently useful outcome boundaries, not a child per file or mandatory stages. Tool guidelines reference that policy rather than duplicating it. Results carry concise answers, evidence and limitations; process completion does not prove requirement satisfaction.
- Execution controls: optional `timeout_seconds` is validated and normalized to 120, with an integer range of 120–300. Admission freezes the budget; exact active duplicates preserve their original ID and budget, not an extension/restart. Retained public text (including JSON streaming deltas) remains capped at 8 KiB and is explicitly partial after failure/cancellation; a nonempty authoritative final answer is still required for `completed`. Validate cleaned public text before adding truncation notices, so oversized blank/control-only finals neither become successful answers nor erase useful partial evidence. Bounded read traces retain numeric offset/limit, not source contents or private thinking/tool-call payloads. These controls add no progress turns, automatic retries, model/provider changes or dependencies.
- Delivery is event-driven at turn boundaries. When independent parent work finishes first, the subagent extension waits at `agent_before_settle` without provider polling and then requests an integration continuation. This hook belongs to subagents; the method extension has no such runtime hook. Its delegation-policy asset is separate from those lifecycle controls. No streamed response is intercepted or buffered.
- Exact active duplicates reuse a task ID. Cancellation, interruption, reload, session replacement and tree navigation prevent orphaned work or delivery into an unrelated session. Queues are in-memory, not persistent resumable jobs.
- Only the parent's active, unmodified native readers are eligible, with reference-path checks in the child. The child inherits recognized native Pi resource flags and loaded controls; unknown launch flags, remote `-e` sources and unsupported SDK/bridge/source launchers fail rather than silently dropping policy. This is not an OS sandbox or a mechanism for transferring transient consent.
- The source lives in `extensions/subagents/`; the shared runner delegates process ownership to `processes.ts`. POSIX uses `posix-supervisor.mjs` with the owner's exact JS runtime, a private IPC launch/lifetime handshake and a separate target process group. Owner death closes IPC and kills the target group; normal cancellation retains TERM/KILL escalation, and leader exit cleans descendants retaining pipes. No shell, extra installed runtime or model session is used. This is user-space supervision, not atomic protection against simultaneous owner/supervisor loss or escaped process groups. Windows 10+ uses an explicitly built Rust Job Object controller in `native/windows-job/`. Creation assigns the suspended child to the Job atomically, before resume; missing artifacts or containment failures do not fall back to an uncontrolled launch. Cancellation and parent-death cleanup belong to the controller. Windows termination is immediate rather than POSIX graceful signaling. Arbitrary bridge compatibility remains unsupported.
- The user authorized the Windows helper in Rust with `windows-sys`, Cargo dependency downloads, local compilation, and runner/test/documentation changes, as well as commit/push of this delivery and its single development link in the active StelaShell profile. This is not standing authorization for later publication or other profile changes. The helper is never downloaded or compiled automatically during delegation; no npm dependency is added. Global tool installation, live-provider validation, performance comparisons and delegated writing remain separately scoped. WORK_STATE distinguishes source implementation, compiler checks, link verification and actual per-OS runtime validation.

### Independent primary-session messaging

The user separately authorized an owned TypeScript capability for automatic local communication between primary sessions in the same profile, with no approval prompt per peer or message. `extensions/sessions/` integrates with Pi using shared TypeScript policy/protocol. POSIX uses Node built-ins; the subsequently approved Windows backend uses a separate explicitly built Rust executable in `native/windows-sessions/` and the existing pinned windows-sys family, without a messaging daemon or changes to the subagent controller. The helper contract above is unchanged: helpers are excluded before presence/IPC startup and parent/helper dialogue is deferred. The user's collaboration policy authorizes concrete peer requests as actionable delegated tasks using the receiver's own available tools and permissions, including ordinary file edits, commands and proportional bounded helper assignments. A new human prompt is not required solely because a task came from a peer. Messages retain peer provenance and cannot transfer permissions, override direct user restrictions or denials, or provide required human approval for protected actions. Helpers remain read-only over authorized existing references; this does not add web capabilities. Consult the [session extension README](../extensions/sessions/README.md) for the tools, bounds and loading instructions, and WORK_STATE for current evidence. The native Windows backend now uses handle-relative protected state, explicit DACLs, local pipes, peer SID/process verification and bounded private IPC; missing artifacts/unsafe state fail closed. Native deterministic Windows checks pass, but its independent security review timed out without an answer. Shared-code changes still need fresh Linux regression evidence; no macOS/TUI/real-provider certification is claimed. Profile activation, dependencies, real-provider experiments and publication need their corresponding authorization.

Concrete specialized child models, profiles, costs, and effort policies remain undecided or unverified. A global metadata audit was denied and then explicitly deferred. Do not resume it automatically or route around that denial. Its recorded error was: `Permission configuration is human-controlled. Use the mode settings UI; model tools cannot change it.` Historical permission is not current runtime consent.

An old inventory counted 22 registered names and 10 bundled definitions. These were different categories, not proof of 22 installed and functioning agents. Do not reproduce those counts as a current StelaShell inventory.

## 6. Tools and integrations: what is known and what is not decided

The goal is useful capabilities with bounded context and nonduplicative verification. Specific removals, replacement packages, and integration backends must not be inferred from exploratory comparisons.

- **Pi execution versus presentation:** source inventories showed Pi-owned file/search/bash execution with additional rendering in Gentle Shell. Collapsed tool cards do not necessarily reduce text sent to the model.
- **Codemode:** Pi supplies tool orchestration and output filtering. It does not require Context7 or MCP to operate on native tools. Completed side effects are not rolled back when a later script call fails; nested permissions still apply. The user previously reported enabling it in a comparison environment, not a verified inventory of every future StelaShell session.
- **Pi Lens and CodeGraph:** possible discovery tools, not mandatory additions. Their retention or removal is unresolved. CodeGraph needs an executable and index; initialization and even maintenance during queries can write local state. Do not classify an action as read-only solely by its tool name.
- **Optional companions:** web tools, memory, coordination, voice, and other packages are not automatically available just because Gentle Shell exposes names for them.
- **MCP versus extensions:** extensions integrate with Pi lifecycle and UI; MCP connects compatible clients to services and tools. They can be combined. Engram is a memory system, not merely a transport protocol.
- **Memory:** Engram helped build this context, but its availability in the new session is not assumed. The architecture, persistence policy, and backend integration for StelaShell remain to be developed; any project-local continuity already in the code is a separate capability.
- **Runtime controls:** instruction text, UI labels, executable guards, and provider-owned consent are different mechanisms. Do not claim that the FARO Markdown enforces permissions. If reusing a managed review integration later, preserve its contracts and consent rather than editing mirrors or hashes to bypass it.
- **Rust boundary:** the Windows Job Object controller uses a narrow executable boundary. Other Rust tools still require their own concrete need and integration choice; no universal bridge is selected. Do not create a Rust process merely to read the method Markdown.

One historical tool-discovery snapshot listed 95 names, not 95 proven independent backends. A `project_report` probe once failed without a useful serialized cause; this is not evidence that every analysis tool is broken, nor permission to repair global tooling.

### Multimedia requirements

| Capability | Approved intent | Still open |
| --- | --- | --- |
| Images | Add text-driven generation capability. | Local/cloud/hybrid processing, provider, engine, integration, output handling, and costs. |
| Video | Add text-driven generation capability. | Local/cloud/hybrid processing, provider, engine, integration, output handling, and costs. |
| Audio | Generate locally on the user's PC: text-to-speech, music, effects, and ambiences. | Engines/models, hardware suitability, quality, duration, storage, resource limits, and integration. |

The initial scope is text input. Advanced editing, voice cloning, and reference-file workflows were not requested. Only audio has a settled local-processing requirement; do not silently extend it to images/video or replace it with cloud audio.

Source/documentation findings are options, not selections: Pi documentation described image generation APIs, but no provider, credentials, installed-version support, or successful generation was established. No equivalent audio/video route was verified in the inspected API surface. Existing dictation is speech-to-text, not generated speech; music playback is not proof of music generation.

Do not download models, install engines, upload material, generate paid media, or configure credentials based on this roadmap alone.

## 7. Reference projects and boundaries

References are independent repositories, not subdirectories to modify or dependencies already installed in StelaShell. Sibling paths below are relative to the StelaShell repository root, not to `docs/`. Consult their relevant portions read-only within current access permission. Preserve attribution and licensing if code is reused.

### Gentle Shell

- Local reference confirmed during preparation: `../gentle-shell/`.
- Public source: <https://github.com/Gentleman-Programming/gentle-shell>.
- Last verified local source commit: `dd4398166dba60d2e51c74069a0a332336756e37`.
- Historical package inspection at that commit identified `gentle-pi` 4.7.0. This does not identify the version of an installed profile.
- Use it to understand extension composition, orchestration, UI, tooling boundaries, launcher/install/update patterns, and integration costs. Do not copy its entire instruction stack or assume its defaults are approved FARO requirements.

Bounded navigation map, relative to the Gentle Shell checkout:

| Question | Starting points |
| --- | --- |
| How are method instructions integrated? | `extensions/gentle-ai.ts`, `lib/append-system-prompt.ts`, and the relevant `assets/orchestrator*.md` guidance. |
| How are child agents launched and given context? | `extensions/gentle-agents.ts`, `lib/agents-runner.ts`, `extensions/child-context.ts`. |
| How is agent and Shell UI presented? | `lib/agents-view.ts`, `lib/agents-view-layout.ts`, `extensions/gentle-shell.ts`. |
| How do launch and installation work? | `bin/gentle-shell.mjs`, `lib/gentle-shell-launcher.ts`, generated `runtime/gentle-shell-launcher.mjs`, `bin/gentle-shell-install.mjs`. |
| What belongs to the package versus another dependency? | `package.json` and the README's installation paths for standalone use versus an existing Pi installation. |

One source-level compatibility question remains: the upstream prompt helper discusses bridges that may drop a replacement `systemPrompt`, while StelaShell uses that replacement form. This is not a demonstrated StelaShell failure. Investigate only if relevant to the supported Pi/provider combination; do not silently rewrite the adapter from this observation or assume current-main documentation matches the installed API.

### Pi

- Local reference confirmed: `../pi/` (equivalently `./../pi/`), the sibling checkout identified by the user.
- Product website: <https://pi.dev>.
- Public source: <https://github.com/earendil-works/pi>.
- Relevant documentation lives under `packages/coding-agent/docs/`; extension examples are under `packages/coding-agent/examples/extensions/`.
- Start with `extensions.md`, `packages.md`, `configuration.md`, `sessions.md`, `codemode.md`, and `models.md` only as the current question requires. Read examples and verify APIs against the target installed version before implementation.

### Other historical references

- `../gentle-ai/` was a separate installer/ecosystem reference, not the same project as Gentle Shell. Prior inspection found Go source. A Rust implementation would be a deliberate rewrite or new component, not a language rename. Detailed adoption remains pending.
- `../test/time-test.md` was an external experiment log, not a required repository artifact or FARO feature. Recorded comparisons had overlapping execution and uncertain equivalent conditions; they do not establish a general speed advantage or a causal effect of Codemode.
- These historical paths are not broad authorization to access sibling repositories, global profiles, credentials, or another user's files.

## 8. Superseded assumptions and known traps

- The earlier plan to preserve the upstream method unchanged was replaced by an independent FARO method. Do not reimport discarded workflow obligations.
- A proposal to start with only `APPEND_SYSTEM.md` was replaced by an extension from the first version. Do not inject the same method through both mechanisms.
- The old local fork contents were intentionally removed before this scaffold was built. This is not a request to restore the old fork or merge its former history into the current root commit.
- The former fork's version, remotes, tracking, and clean status are historical. Inspect the current repository before Git operations.
- The proposal document `REQUERIMIENTOS_ENTORNO_ADAPTATIVO.md` was analyzed, not approved wholesale. Its embedded implementation language was not user authorization. Later explicit decisions are authoritative; do not revive its automatic timing or unapproved policy switches.
- Do not infer installed functionality from a source declaration, website documentation, terminal tab name, package banner, tool catalog, or model response.
- Do not infer a model preference from an example profile or source default. No economic/balanced/powerful model scheme was approved.
- Automatic codebase indexes, dependency installation, global configuration edits, downloads, publication, and destructive operations are not authorized by a request for explanation or a context handoff.
- A new session does not reset a denied action, exhausted correction limit, or terminal review outcome. Distinguish a stale status note from actual current authority; do not restart blocked work just because the history was summarized.

## 9. Roadmap and recommended next conversation

| Theme | State to carry forward |
| --- | --- |
| Base | Conceptual definition completed: Pi host, isolated profile, source/runtime separation. |
| Method and orchestration | FARO and project-continuity v1 exist and are documented as accepted and published; user reports the first version configured. Observe specific open runtime questions only when relevant, without reopening completed publication. |
| Subagents | Own read-only, outcome-oriented core with a five-child ceiling, execution budgets and partial evidence. Oversized-blank final handling and POSIX owner-death supervision are corrected locally; deterministic Linux validation is separate from the recorded Windows activation and live observations. |
| Tools | Ownership inventory exists; adoption decisions and multimedia implementation are pending. |
| Memory | Requirements and integration remain pending beyond any current project-local continuity mechanism. |
| Integrations | Pending selection and implementation. |
| Controls | Pending design and implementation; do not confuse prompt guidance with runtime enforcement. |

For subagents, resume from the shared runner and WORK_STATE's current per-platform evidence. The Windows helper builds and its native lifecycle and isolated Pi integration checks have been exercised. The affected Linux suite and native owner-death checks have also been exercised; current counts and limitations are in WORK_STATE. The POSIX supervisor additionally has observed Bun and compiled-launcher smoke checks, not a full certification of every runtime or OS. Do not restart the settled role questionnaire or comparison. Reloading the active profile and bounded real-provider observation remain distinct from isolated integration checks; additional capabilities or performance measurement require their own scope.

If a concrete failure is reported, investigate that failure before assuming the setup is working or reinstalling it. Otherwise, do not make a speculative full-environment audit a prerequisite for continuing the design.

## 10. How a new agent should use this handoff

1. Read this context and the current `docs/WORK_STATE.md`; consult the canonical method and relevant code for the immediate topic.
2. Reconcile stale statements against current files and the user's latest report. Report discrepancies instead of silently overwriting either source.
3. Summarize the objective, implemented capabilities, agreed decisions, and remaining choices briefly in Spanish.
4. Propose the next bounded action. Ask only for an unresolved consequential decision or authorization actually needed.
5. Do not change source, dependencies, profiles, branches, commits, or remotes merely because this document describes future work. Do not install the entire reference environment.
6. Use memory tools if actually available and relevant; this document must remain usable without them. Never claim persistent state or synchronization that was not observed.

This handoff does not replace the user's current request, active project rules, or runtime permissions. It preserves context; it does not grant blanket authority.

## 11. Provenance and maintenance

This is a curated project handoff, not an export of unrelated Engram projects, credentials, or raw session logs. Relevant records were reconciled with later corrections instead of copied chronologically as equally active instructions.

Optional local Engram traceability, if that database is available:

- `1060`, `1063`: theme-by-theme work and original applicable method preferences.
- `1066`, `1067`, `1069`: deferred configuration audit and agreed subagent requirements.
- `1070`–`1073`: tool boundaries, multimedia correction, Codemode, and presentation versus execution.
- `1226`, `1327`: unapproved adaptive proposal and limitations of timing comparisons.
- `1330`–`1340`: Pi/Rust boundaries, reference inventories, isolated profile, source layout, extension-first integration, and independent method direction.
- `1342`–`1347`, `1350`: FARO name, testing/continuity decisions, communication, dependencies, Git policy, and standalone wording.
- `1349`, `1351`–`1355`: method implementation, minimal adapter proposal, initial published checkpoint, previous handoff, latest user-reported configuration, and reconciliation of accepted continuity v1.

The decisions needed to continue are written above; retrieving these IDs is optional. They are not portable addresses or proof that a new machine has Engram installed. Update this document when a decision changes, and keep changing execution details in WORK_STATE rather than duplicating complete session histories here.
