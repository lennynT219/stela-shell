# Work state

## Objective and scope

Deliver cross-platform subagent process ownership: keep POSIX process groups and add a Windows Rust Job Object controller. The user authorized the helper, `windows-sys`, Cargo downloads, local compilation, runner/tests/documentation, and now commit/push of this delivery plus its development link in the active StelaShell profile. Global installations, unrelated settings changes and new branches are not authorized. Work remains on `main`; Git history and tracking references are the source of publication status.

Accepted FARO/continuity v1 and the first bounded read-only subagent core remain the baseline. The broader design and roadmap are in `docs/PROJECT_CONTEXT.md`. The current delivery authorization does not cover unrelated roadmap work, future publication or real-provider requests.

## Current decisions

- Keep a shared TypeScript runner for assignment input, bounded JSON parsing, deadlines and results. `processes.ts` owns platform-specific launch and termination. Do not replace Pi or reimplement its conversation loop.
- POSIX retains a separate process group and SIGTERM/SIGKILL escalation. Cleanup also runs on leader exit so inherited pipes cannot indefinitely prevent close. No Rust executable is required on POSIX.
- Windows 10+ uses the Rust controller in `native/windows-job/` with locked `windows-sys` dependencies. Create the process suspended with atomic Job assignment, verify containment before resume, inherit only stdio, and never expose the Job handle to children. Missing helper or failed Job setup must fail closed, not fall back to taskkill or an uncontrolled process.
- Windows cancellation terminates the controller and closes its KILL_ON_JOB_CLOSE Job; it does not emulate graceful POSIX signals. Normal completion waits for an empty Job, and the controller monitors abrupt parent death.
- Build the Windows artifact explicitly with `npm run build:windows-helper`. The runner resolves it from the extension's real checkout, including when a development link is used. Runtime delegation must never install, download or compile it. Build artifacts are ignored; Cargo.lock remains source-controlled input.
- Preserve bounded read-only assignments, the default/maximum of five children, queue ownership and inherited permission hooks. Children cannot delegate or modify project files. No npm dependencies were added.
- Existing continuity decisions remain in FARO: fixed five-section work state, selective persistence rather than prompt history, immediate recording of relevant explicit decisions within authorization, and required persistence before the final response.

## Outcome status

- Implemented: `processes.ts` selects POSIX groups or the Windows controller; `runner.ts` uses it without the old blanket Windows rejection. The Rust helper includes UTF-16 argv encoding, restricted handle inheritance, atomic Job setup, parent/child waits and bounded cleanup.
- Verified on Windows: the release helper builds with the installed Microsoft C++ tools; Rust argv tests, shared JSON-runner fixtures, native Job lifecycle tests and isolated deterministic Pi integration all pass. The prior linker blocker is resolved.
- Documentation and explicit build/test scripts updated in README, PROJECT_CONTEXT and package.json. The method extension is unchanged. The local release artifact remains ignored by Git.
- Development link created: the active Windows profile is `$HOME/.stela-shell`, not the earlier example `$HOME/.stela-shell/agent`. Its `extensions/subagents` junction points to this checkout beside the existing method link. No settings were edited and no duplicate package/extension registration was found in that profile.
- Implementation committed locally; publication is blocked because GitHub rejected this session's push with `Permission denied (publickey)`. No credential, transport or remote changes were attempted. Git history and tracking status identify the pending commits.
- Pending: affected Linux runtime regression checks. No Linux/WSL environment is available here; source portability and process-plan tests are not equivalent to native Linux execution. Live-provider/TUI observation and profile activation are not part of the current verification.

## Relevant evidence

- `npm run build:windows-helper` succeeded in a process-local Visual Studio Developer PowerShell environment. `npm run test:windows-helper` passed all 3 Rust argv tests. The build used only a process-local Developer PowerShell environment; no tools were installed by the agent.
- `npm test` passed 47 Node tests with no failures. Its 5 skips were the 4 opt-in Pi checks and the Linux-only descendant test. All 6 native Windows controller tests ran successfully: Unicode/argv/environment/cwd, leader exit with live descendants, cancellation, force termination, parent death, and fail-closed startup.
- The 4 opt-in checks then passed separately using the installed packaged Pi 1.5.2 `dist/bundle/cli.js` via `STELA_TEST_PI_CLI`: read-only evidence delivery, rejected writing, inherited permission denial, and safe native launch-resource resolution. They use an isolated temporary profile and local deterministic provider, not credentials or paid/network inference. Across these two non-overlapping Node runs, 51 tests passed; the Linux-only test remains unexecuted.
- Shared runner coverage now includes real Windows child execution, bounded/chunked JSON, Unicode, malformed/oversized/incomplete/error outputs, deadlines, cancellation and pre-launch failure. Queue, read-scope and session-lifecycle coverage also passed with this code.
- Cargo formatting and Git whitespace checks passed. Windows runtime evidence does not establish Linux regressions, real-model adherence, OS sandboxing or TUI presentation. Historical validation of the original POSIX core is not proof of the changed process layer.
- A check imported the extension through the new profile junction with symlink preservation, verified delegate/cancel tools and task-command registration, resolved the helper back to the checkout and successfully ran a deterministic child through that linked adapter. This is not a reload of the user's live Pi session or a real-provider test.

## Next actions and open questions

- Run the affected suite in a real Linux environment before declaring cross-platform runtime verification complete. Do not simulate an OS selector and label it native validation. An available Linux environment is the remaining verification prerequisite; none is installed or configured automatically.
- The Windows artifact is ready locally. Rebuild explicitly from Developer PowerShell/Command Prompt after changing Rust source, using the Microsoft linker rather than Git/MSYS `link.exe`; runtime delegation does not build it.
- Complete the authorized publication from a terminal with the permitted SSH key available. The agent's denied push is stopped; do not bypass the restriction with another identity or transport.
- Reload the active Pi session to discover the newly created development link. Real-provider/TUI observation, other profile changes, additional capabilities and subsequent publication need their own authorization; the current commit/push approval is limited to this delivery. The historical obsolete continuity-review reminder, if emitted by another loaded instance, remains outside this runner implementation.
