# Live delegation observation

This is an opt-in behavioral experiment, not part of ordinary model-free `npm test` execution. The principal uses its real provider/model, existing Stela profile, production FARO and helper instructions. The deterministic integration provider cannot establish initiative because it requests delegation programmatically.

## Scope and cases

One preparation produces three independent workspaces and prompts:

1. A localized configuration query: direct retrieval is normally appropriate.
2. A broader application review with independent pricing, validation and access questions.
3. The same broader prompt in another fresh session, as an approved repetition, not an automatic retry.

Prompts never mention agents, delegation or parallelism. The synthetic application contains seven source-verifiable issues; the private oracle remains outside each authorized workspace. It is a review aid, not an exhaustive list of every possible issue. Finding a problem that is not in the oracle is not automatically a false positive.

The experiment does not change production instructions, activate extensions, install dependencies, copy credentials, or alter the profile. It uses existing authentication normally; trusted providers/extensions retain their usual account permissions and authentication effects. It is not an OS sandbox. Inputs are synthetic; the principal is instructed to inspect only its current workspace and not modify files. Workspace hashes detect violations rather than preventing them.

MCP is disabled per invocation to exclude unrelated external tools. Other profile resources and default tools remain loaded. No role template or added system prompt is used. JSON mode exercises the same Pi agent loop but does not certify TUI presentation or interactive permission dialogs.

## Prepare without inference

Use the actual packaged CLI and configured profile. The current preparation checks that the existing `stela-method` and `stela-subagents` profile links point to this checkout and that the CLI registers the production subagent flag. It refuses to activate or repair a profile.

```sh
node --experimental-strip-types extensions/subagents/tests/behavior/observe.mjs prepare \
  --out /absolute/private/path/to/a-new-experiment \
  --cli /absolute/path/to/pi-coding-agent/dist/bundle/cli.js \
  --profile /absolute/path/to/the-existing-agent-profile \
  --model openai/gpt-6.1-sol
```

Artifacts must be outside source control. Do not use a directory containing unrelated work. Preparation writes a manifest, the source/input hashes, the private oracle and workspace copies, without making model requests. Default thinking is not overridden; the manifest records the profile selection rather than assuming the current interactive session's transient setting.

## Run only with explicit live-provider authorization

```sh
node --experimental-strip-types extensions/subagents/tests/behavior/observe.mjs run \
  --out /absolute/private/path/to/the-prepared-experiment
```

A private hc terminal can keep the plain runner visible without supplying instructions to the observed principal:

```sh
hc run --bg --no-notify --name stela-observation --cwd /absolute/path/to/stela-shell -- \
  /usr/bin/node --experimental-strip-types extensions/subagents/tests/behavior/observe.mjs run \
  --out /absolute/private/path/to/the-prepared-experiment
hc wait stela-observation
hc read stela-observation --lines 60
```

Do not use an agent-role template: it could add instructions and contaminate the selection experiment. Operate only the terminal you created; do not restart the user's hc core. `hc wait` check-ins are not grounds to duplicate a running experiment.

The three cases run sequentially, with new in-memory Pi sessions and unchanged input copies. Each case is bounded to 600 seconds, 20 principal turns and an observation limit of five distinct accepted assignments. A bound hit is **inconclusive**, not proof of a behavioral defect. It triggers cancellation, not a changed prompt or retry. Production concurrency and child budgets remain unchanged. Provider/run errors, profile drift or workspace changes stop the remaining cases. The exclusive `started.json` marker prevents automatic replay.

## Evidence and evaluation

The artifacts include:

- `manifest.json`: selected model, CLI/source revisions and hashes, profile metadata, launch options, limits, prompts and input hashes; never credentials.
- `oracle.json`: source locations and reproducible synthetic issues, outside the principal's workspace.
- `<case>/events.jsonl`: sequential public parent events. Streaming snapshots, thinking blocks, `agent_end` conversation copies and raw child diagnostics are excluded. Obvious credential patterns are redacted defensively; inspect before sharing.
- `<case>/summary.json` and `answer.md`: admissions, bounded assignments, committed results, principal work before delivery, final answer, termination and mutation checks.
- `summary.json`: completed cases and cases not attempted after a blocker.
- `report.md`: the integrating agent's evidence-linked assessment, written after reviewing actual outputs.

The automated summaries are observations, not a score. Manually assess:

- Was delegation proportional to the actual task, and was direct retrieval preferred for the simple question?
- Were assignments coherent, independent, appropriately scoped and given observable completion criteria?
- Did the principal do useful independent work before integration, without blindly duplicating a helper?
- Were results delivered once and incorporated with their limitations?
- Were incomplete/failed results represented honestly, without claiming missing evidence was verified?
- Did the final answer identify real issues with useful references and an integrated recommendation?

No delegation in one broader run does not prove a defect. Assess the task, public plan, retrieved evidence and correctness before recommending instruction changes. Do not tune the experiment until a helper appears. Event order proves work before result delivery, **not actual concurrent execution**, elapsed-time improvements, private model rationale or total cost. Child usage is not aggregated by the production core.

Offline tests for filtering, event correlation, fixture identity and oracle reproduction are in `../observation.test.ts` and included in `npm test`. Live inference is never an implicit part of that command.
