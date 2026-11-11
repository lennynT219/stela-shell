# Work state

## Objective and scope

The first StelaShell subagent core is implemented: one reusable `stela-helper`, bounded read-only assignments, non-blocking execution, cancellation and concise evidence delivery. The user explicitly authorized committing and pushing this delivery, including its tests and documentation, on the current `main` branch to `origin`. Profile activation, dependency installation and new branches remain unauthorized. Accepted FARO/continuity v1 remains unchanged.

The first version of project continuity in StelaShell is accepted and published. The user completed the authorized push manually; the publication objective is complete. Instructions and the template belong in `extensions/method/assets/method.md`; project state belongs in `docs/WORK_STATE.md`. Further implementation, commits, or publication are not implied by this completed objective.

The portable-context deliverable is prepared in `docs/PROJECT_CONTEXT.md` so a new StelaShell session can recover the objective, approved decisions, source references, and pending work without the previous chat or Engram. Its scope is documentation, not additional feature implementation or publication.

## Current decisions

- Subagents resolve bounded evidence questions, not a fixed explore/implement/verify pipeline. The parent retains integration and continuity ownership; children cannot delegate or modify project files.
- The user set **five simultaneous children as both the default and maximum**, replacing the initial proposal of two. A lower limit may be selected; five is a ceiling, not a target. Independent useful work determines actual delegation.
- `stela_delegate` admits an assignment and returns an ID; `stela_cancel` requests cancellation. Delivery is event-driven, not model polling. The helper inherits the parent model and thinking level for this first implementation.
- Commit and push authorization covers this subagent delivery and its documentation only; it is not standing permission for future publication. Git history and remote synchronization are the source of actual delivery status.

- The user accepted the current design as StelaShell's first version of project continuity. Future changes should remain consolidated in the existing method structure, not accumulate per-request exceptions.
- Persist only information needed to resume the project, not every completed request or query result. When continuity maintenance is authorized, record explicit decisions governing future work in the current cycle, even if the record must be created; incorporate subsequent confirmations into the same state without presenting pending facts as verified.
- When relevance is uncertain, leave the information in conversation context and reconsider if later exchanges establish its usefulness. Two or three exchanges are an observation opportunity, not a counter or save trigger. Do not defer explicit consequential decisions or create a candidate-record file.
- Apply permissions per resource: read-only access to an external system does not itself prohibit separately authorized local continuity updates, and local record maintenance never authorizes external writes. Explicit bans on file changes or persistence remain binding.
- Use the five fixed sections shown here, each with a brief purpose description in FARO's template. Consolidate entries by project outcome instead of appending a section per prompt.
- Complete required and authorized persistence before the final response. These instructions guide the model; they do not buffer or intercept its streamed responses.
- Use `docs/PROJECT_CONTEXT.md` for the broader settled decisions and roadmap, while this file remains the primary active-state record. The context document is not another method to inject on every turn. Historical proposals and completed approvals do not authorize future changes.

## Outcome status

- Implemented and deterministically verified: `extensions/subagents/` contains the entry point, JSON-process runner, session-owned queue, helper instructions and tests. Five is the default and maximum concurrency; a sixth independent task queues. Exact active duplicates reuse IDs. Cancellation, bounded outputs and session/branch lifecycle handling are covered.
- Implemented: native reader selection and reference-path guard, no recursive delegation or model-issued writing/shell operations, recognized parent resource inheritance, and rejection of unsupported launches instead of dropping policy options. Existing permission hooks are not replaced. This is not an OS sandbox; README records limitations.
- Documented: README covers operation, bounds, native POSIX support, tests and activation. PROJECT_CONTEXT incorporates the approved outcome-oriented design and supersedes the earlier two-child proposal. The accepted method extension is unchanged.
- Pending separately authorized operation: activation in the user's profile and observation with the real provider/TUI. No dependencies, profile settings/links or branches were changed for this implementation. Commit and push are now explicitly authorized; consult Git for the delivered revision and synchronization status.

- Completed: `method.md` consolidates resource-specific authority in section 1 and continuity selection, immediate recording of explicit decisions, the described five-section template, and maintenance and delivery rules in section 7. The duplicate save-confirmation instruction was merged into the pre-final delivery rule.
- Completed: `extensions/method/index.ts` loads FARO and provides recovery reminders without an `agent_before_settle` continuation. It is unchanged; the new subagent extension's settlement handling is a separate capability.
- Accepted: the user approved this implementation as version 1. Live model adherence to selective persistence remains an observational limitation, not an automated guarantee or a blocker to the authorized publication.
- Published: the user confirmed completing the push manually. Local `main` and the remote-tracking reference `origin/main` point to the same commit; the SSH publication blocker is resolved. No additional push was attempted by the agent.
- Prepared: the portable project context consolidates FARO, accepted continuity v1, subagent agreements, tool and media boundaries, permissions, and reference-project navigation. README links to it. The earlier documentation handoff did not change runtime code, create a commit, or push; the later subagent implementation is described above. Inspect Git for current publication status.

## Relevant evidence

- Subagent validation: 43 tests passed on Node 24.22.2, including opt-in integration with the installed native Pi 1.5.2 CLI. The integration uses an isolated temporary profile and a deterministic local provider, not credentials or paid/network model requests. It exercises real parent/child Pi loading, read access, rejected writing, an inherited permission denial and exactly one committed result/integration response.
- Local coverage includes five concurrent children and queued overflow, deduplication, source-path/symlink restrictions, malformed/oversized streams, partial/error exits, deadlines, cancellation escalation and POSIX descendant cleanup. Lifecycle probes cover interruption, reload/shutdown/navigation ownership, uncommitted delivery proposals, and reader availability changes before queued launch.
- Run `npm test` for local checks. Set `STELA_TEST_PI_CLI` to an existing packaged Pi `dist/bundle/cli.js` for the native integration checks; those checks are explicitly skipped without it. Tests live in `extensions/subagents/tests/`. These results do not establish real-model adherence, actual terminal presentation, arbitrary provider/bridge compatibility, speed improvements or reduced total cost.

- Historical continuity evidence: a Node smoke check loaded the method extension and confirmed that its injected prompt contains resource-specific permissions, immediate decision recording even when the file is absent, treatment of unconfirmed details, the uncertainty and pre-final delivery rules, and one five-section template in order. No `agent_before_settle` handler is registered by the method extension.
- `git diff --check` passed for the instruction changes.
- These checks establish loading and instruction presence, not that every model response will comply. The old continuity-review reminder appeared repeatedly in the earlier continuity session; its runtime source remains unverified despite its absence from the current extension source.
- The documentation handoff passed coverage-presence, local-link, code-fence, five-section structure, and whitespace checks. These are documentation checks, not new Pi runtime tests. The sibling reference checkouts are `../gentle-shell/` and `../pi/`. The user clarified the Pi path, and its directory and Git root were verified; `pi.dev` refers to the product website.

## Next actions and open questions

- No implementation or publication actions remain for the accepted first version. Git history and the remote branch are the source of commit and synchronization status.
- The authorized source implementation and deterministic validation are complete. Beyond the explicitly authorized commit/push delivery, the next proposed step is separately authorized activation using the agreed single development-link/package route, followed by a bounded real-provider/TUI observation. Do not activate the profile or reopen the deferred global configuration audit automatically. Performance measurement, delegated writing, other roadmap work and subsequent publication need their corresponding scope/approval.
- Future validation may observe selective persistence, confirmation updates, and resource-specific permissions in live interactions. Further implementation changes require their own authorized scope.
- If the obsolete post-response review reminder persists after reload, its emitting extension or instance remains an open diagnostic question; investigation is outside the accepted version's implementation scope.
