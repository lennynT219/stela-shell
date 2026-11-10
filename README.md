# StelaShell

StelaShell is a personalized environment built around Pi. The current checkpoint contains the standalone FARO method and its minimal TypeScript extension. It is not yet an installed or fully validated distribution.

## Current implementation

| File | Purpose |
| --- | --- |
| `extensions/method/assets/method.md` | FARO's agent-facing instructions, in English. |
| `extensions/method/index.ts` | Reads the method when the extension loads, rejects empty content, and appends it to the incoming system prompt through `before_agent_start`. |
| `package.json` | Declares the extension entry point. No dependencies or scripts are configured. |

The extension supplies instructions; it does not enforce permissions, Git restrictions, or agent behavior. Changes to the Markdown require reloading the extension. Runtime activation has not been verified.

## Resume on another computer

1. Transfer this Git history through an authorized remote or another backup mechanism. A local commit alone is not a remote backup.
2. Read the FARO document and the extension entry point before continuing development.
3. Prepare Pi separately. The previously observed development installation was Pi 1.5.0; compatibility still needs a live integration check on the target computer.
4. Keep the StelaShell profile separate, using `~/.stela-shell/agent` rather than an unrelated agent profile. Configure credentials locally; do not commit or copy authentication files into this repository.
5. Validate extension loading and prompt composition in that profile before enabling it for normal work. Use one loading route only to avoid duplicate registration.

The agreed development approach is one symlink per extension. Creating that link and activating the extension remain pending. The manifest declaration alone does not establish that Pi has loaded the extension.

## Verification at this checkpoint

A local Node.js 26.8.1 probe imported the actual TypeScript entry point and used a minimal registration stub. Five checks passed:

- The manifest declares the expected extension.
- The FARO document is nonempty and self-contained.
- The entry point registers `before_agent_start` once.
- The handler preserves the incoming prompt and appends FARO without mutating the event.
- Repeated calls do not accumulate extension-local prompt state.

These checks do not validate the live Pi loader, reload behavior, error reporting, or model compliance. There is no committed automated test suite or test command yet.

## Next work

- Verify the integration with the target Pi version and isolated profile.
- Set up the development link and confirm loading and reloading.
- Continue the remaining design and implementation topics: subagents, tools, memory, integrations, and controls.

Pi remains the agent. Rust is intended for selected tools, a launcher, and installation responsibilities when needed; no Rust component has been implemented. Subagent orchestration and memory integrations are not implemented in this repository.

## Working agreements

- Keep FARO's document independent of other methods and frameworks.
- Explain the need and alternatives before adding or installing dependencies, and obtain approval.
- Use the current branch when appropriate; new branches need a concrete purpose and authorization.
- Commits require explicit authorization. Pushes, publication, pull requests, and merges require their corresponding authorization separately.
- Keep personal settings, credentials, and session histories outside the source repository. The current `.gitignore` is an empty scaffold, not a protection against accidental staging; review paths explicitly.
