# Stela Web

**Superseded scaffold, not the current target.** The user chose a single internal extension distributed with StelaShell, not a separately installed/versioned package. This directory remains unchanged in structure from checkpoint 486e166 and has no runtime. Proposed implementation/dependencies belong in extensions/web and StelaShell's root manifest; no migration or installation is performed by documenting this decision.

The following notes preserve the inspected source basis and extraction proposal; consult the [current extension proposal](../../docs/WEB_DOCUMENTATION_PLAN.md) for architecture and approval scope.

## Status

**Preparation only — no runtime extension or tools are implemented/registered yet.** The manifest intentionally has an empty `pi.extensions` array. No new dependencies are declared/installed, no loading route is created, and this is not a working replacement. The user authorized retiring the old `extensions/web` and the native Exa MCP profile entry; those are not fallback paths for this package.

Initial scope: search and public HTML/plain-text/Markdown page reading. FARO, subagents, sessions and their permission boundaries are unchanged; helpers do not gain web access. Package/tool branding is owned here, while exact tool identifiers remain proposals until implementation.

## Reuse and planned differences

- Base: inspected `pi-web-access@0.47.0`, MIT, from `https://github.com/nicobailon/pi-web-access`, registry Git head `322e44fafc1aaa691779cdf2116584e67edd7645`. This is not a Gentle Shell-pinned companion release.
- Adapt its Exa request/result handling and ordinary HTML extraction path; do not import the full integration graph or silently register unrelated features.
- Account for the observed Exa schema (`query` and `objective` required). The reviewed upstream basic-call builder only passes `query` and `numResults`; old arguments cannot be assumed compatible with the current server.
- Keep backend/credentials explicit: initial proposed backend is previously exercised keyless Exa, without auth reuse, automatic provider fallback or sign-in.
- No implicit page fetch through search, summary/curator inference, session-result publication, persistent page cache, browser cookies, PDF/media/GitHub integration or helper grants in the first version.
- Preserve source attribution, untrusted-evidence treatment and version uncertainty. Network controls, limits and cancellation must be implemented/tested before any guarantees are claimed; upstream preflight DNS is not connection pinning and its broader HTTP/proxy paths are not the removed reader's policy.

## Installation decision — pending approval

Proposed local runtime dependencies for the adapted single-page HTML path, using exact versions found within upstream's declared ranges:

| Dependency | Version | Purpose | Registry license |
| --- | --- | --- | --- |
| `linkedom` | `0.16.11` | DOM construction | ISC |
| `@mozilla/readability` | `0.6.0` | Main article extraction | Apache-2.0 |
| `turndown` | `7.2.5` | HTML-to-Markdown conversion | MIT |

Transitive dependencies would be locked during an approved local install with lifecycle scripts disabled. Registry metadata was read, not installed; this is not a dependency security audit or a complete transitive-graph review. Pi supplies SDK/TUI/typebox packages; do not install duplicate host copies as runtime dependencies. Node built-ins cover the proposed narrow Exa transport; no MCP SDK is demonstrated necessary for adapting upstream's direct request path.

Alternatives: use the whole upstream dependency/feature graph (larger scope), retain optional Defuddle fallback (additional dependency, not proposed initially), or write a new extractor (contrary to the reuse objective). Omitting Defuddle and optional extraction modes reduces coverage relative to the full upstream package and must not be called equivalent.

Approval to install these libraries is required before adding/installing them. Implementation, deterministic tests, actual Pi registration/permission/helper checks and an authorized public-source smoke remain to be done. This folder is not linked into the habitual profile. No publication is authorized.

See [replacement plan](../../docs/WEB_DOCUMENTATION_PLAN.md), [work state](../../docs/WORK_STATE.md) and [upstream attribution](THIRD_PARTY_NOTICES.md).
