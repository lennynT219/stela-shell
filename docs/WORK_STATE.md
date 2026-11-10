# Work state

## Objective and scope

Deliver the user-accepted first version of project continuity in StelaShell. The user explicitly authorized committing and pushing this outcome on the current branch. This authorization covers the continuity extension, FARO instructions, and project work-state record, not unrelated changes or additional features. Instructions and the template belong in `extensions/method/assets/method.md`; project state belongs in `docs/WORK_STATE.md`.

## Current decisions

- The user accepted the current design as StelaShell's first version of project continuity. Future changes should remain consolidated in the existing method structure, not accumulate per-request exceptions.
- Persist only information needed to resume the project, not every completed request or query result. When continuity maintenance is authorized, record explicit decisions governing future work in the current cycle, even if the record must be created; incorporate subsequent confirmations into the same state without presenting pending facts as verified.
- When relevance is uncertain, leave the information in conversation context and reconsider if later exchanges establish its usefulness. Two or three exchanges are an observation opportunity, not a counter or save trigger. Do not defer explicit consequential decisions or create a candidate-record file.
- Apply permissions per resource: read-only access to an external system does not itself prohibit separately authorized local continuity updates, and local record maintenance never authorizes external writes. Explicit bans on file changes or persistence remain binding.
- Use the five fixed sections shown here, each with a brief purpose description in FARO's template. Consolidate entries by project outcome instead of appending a section per prompt.
- Complete required and authorized persistence before the final response. These instructions guide the model; they do not buffer or intercept its streamed responses.

## Outcome status

- Completed: `method.md` consolidates resource-specific authority in section 1 and continuity selection, immediate recording of explicit decisions, the described five-section template, and maintenance and delivery rules in section 7. The duplicate save-confirmation instruction was merged into the pre-final delivery rule.
- Completed: the current `index.ts` loads FARO and provides recovery reminders without an `agent_before_settle` continuation. It was not changed for the structure update.
- Accepted: the user approved this implementation as version 1. Live model adherence to selective persistence remains an observational limitation, not an automated guarantee or a blocker to the authorized publication.
- Publication blocked: the version 1 commit exists locally, but GitHub rejected the push to `origin/main` with `Permission denied (publickey)`. No alternate transport, credential changes, or additional push attempts were made.

## Relevant evidence

- A Node smoke check loaded the actual extension and confirmed that its injected prompt contains resource-specific permissions, immediate decision recording even when the file is absent, treatment of unconfirmed details, the uncertainty and pre-final delivery rules, and one five-section template in order. No `agent_before_settle` handler is registered.
- `git diff --check` passed for the instruction changes.
- These checks establish loading and instruction presence, not that every model response will comply. The old continuity-review reminder has appeared repeatedly in this conversation; its runtime source remains unverified despite its absence from the current extension source.

## Next actions and open questions

- No additional implementation is required for the accepted first version. Restore authorized SSH access to the configured GitHub remote before retrying publication. The denied push action is stopped; do not bypass the restriction with another transport or identity. Git history and the remote branch are the source of commit and synchronization status.
- Future validation may observe selective persistence, confirmation updates, and resource-specific permissions in live interactions. Further implementation changes require their own authorized scope.
- If the obsolete post-response review reminder persists after reload, its emitting extension or instance remains an open diagnostic question; investigation is outside the accepted version's implementation scope.
