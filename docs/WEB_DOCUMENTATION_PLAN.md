# StelaShell web extension: proposal

## Status and authority

The user confirmed retiring the previous reader/native-MCP web layer and has now explicitly chosen **one internal extension distributed with StelaShell**, not a separately installed/versioned package. Reuse useful pi-web-access code for search and ordinary page reading. FARO, subagents, sessions, unrelated settings/work and Git history remain outside the change scope. The user now authorizes a local checkpoint of this proposal and associated documentation before starting. This does not approve dependency installation or profile loading; implementation/dependency approval remains pending.

Retirement is complete in source/profile configuration. The old reader's dedicated tests and parser dependency were removed with the retired feature; the remaining session package-contract assertion was updated without removing coverage. The root package retains three extensions and no runtime dependencies. The previous reader delivery remains recoverable from Git commit `bdcfdc6`; no history was rewritten. The user subsequently authorized a local checkpoint of this retirement/preparation before replacement implementation; push is not authorized.

Checkpoint 486e166 contains retirement and an inactive packages/web scaffold. Its separate-package architecture is superseded; the files remain in place until implementation is authorized. No replacement tools/libraries/loading route exist. The current local proposal checkpoint commit is authorized. New dependency installation, credentials, paid/model evaluations, profile activation, agent reload, further commits, push and publication are not authorized. Running sessions can retain stale tool registrations until a user-controlled reload/restart; do not invoke them as fallback.

## First-version outcome

- Search public web sources and return attributable source URLs/highlights.
- Read an explicitly selected public HTML/plain-text/Markdown URL into useful text/Markdown.
- Own Stela's tool naming/presentation separately from the provider; prior `stela_web_search` / `stela_web_read` identifiers remain proposals, not a selected public contract.
- Keep Pi as host, preserve its permission pipeline and existing helper exclusion; do not replace FARO/session/subagent behavior.
- Start from useful upstream code, retaining licenses/provenance and documenting changed behavior rather than claiming full upstream equivalence.

Do not automatically include PDF/media/GitHub cloning, browser-cookie/auth fetching, summaries/curator/model calls, multiple providers/fallback chains, implicit page fetching during search, session-result publication or persistent page caches. Those are separate potential capabilities, not first-version authorization.

## Proposed architecture and behavior

Target structure (not created yet):

```text
extensions/web/
  index.ts       # Pi tool registration, presentation and helper exclusion
  search.ts      # attributed/adapted upstream Exa handling
  read.ts        # explicit public-page reading and source metadata
  extract.ts     # adapted readable-content/Markdown extraction
  network.ts     # tested public-network, body and cancellation controls
  tests/
```

StelaShell's root manifest would declare the single entry point and its root dependencies/lockfile would supply the extraction libraries. Distribute/version with StelaShell, with one loading route and no independent npm package, SDK copy, background daemon or additional agent. Exa's MCP endpoint can remain an internal provider transport, but the profile would not directly import its provider-named tools.

Proposed tools: `stela_web_search` and `stela_web_read`, with concise Stela-branded call/result rendering. Search accepts a public query/objective and bounded result count and returns source URLs/highlights; it does not implicitly read pages. Read accepts an explicit URL and returns title, final URL, retrieval time, useful text/Markdown and partial/truncated/version limitations. Distinguish discovered snippets from actually read page evidence. Detect/report insufficient JavaScript-rendered content rather than pretending to be a browser.

Candidate starting defaults, NOT agreed requirements or existing enforcement: three search results by default, at most five locally exposed; one URL per read; 2 MiB encoded/decoded page body; 16 KiB UTF-8 complete model-visible result; 20-second total local operation deadline; two redirects and two active operations/no queue. Revisit if real needs justify it. Only claim limits after checks, including synchronous extraction cancellation/worker handling where necessary. Public HTTPS, credential/destination/redirect checks and no proxy/TLS/auth/provider workaround are proposed controls, not inherited upstream guarantees.

## Reuse boundary

Inspected basis: `pi-web-access@0.47.0`, MIT, registry Git head `322e44fafc1aaa691779cdf2116584e67edd7645`. This is an independently inspected release, not a companion version pinned by Gentle Shell. Archive provenance and the original license are recorded in [package notices](../packages/web/THIRD_PARTY_NOTICES.md).

### Search

Adapt upstream Exa request/response/error/result parsing (`exa.ts`), keeping initial keyless Exa explicit instead of importing automatic credential/provider selection. The proposed transport can use Node built-ins and upstream's direct request structure; a new generic MCP client or dependency is not demonstrated necessary.

The observed live Exa schema requires `query` and `objective`. Upstream's reviewed basic request builder only passes `query` and `numResults`; adapt it to the observed contract and test validation/error handling. Do not copy its advanced-filter-to-query-text fallback as a hard filtering guarantee, or reuse ambient API keys/authentication automatically.

### Reading

The bounded helper review identified an adapted HTTP-only cut of `extractViaHttp`, HTML/title/charset/response helpers, and the LinkeDOM → Mozilla Readability → Turndown path. There is no standalone exported readable-HTML parser to import unchanged; `extract.ts` imports a broad optional feature graph. A dependency-free RSC fallback can be reused where useful. Omitting optional Defuddle reduces fallback coverage and is not full upstream equivalence.

Unreviewed imported integrations/link-discovery/sanitization helpers and third-party transitives prevent claiming a complete extraction graph or security audit. Exclude optional integrations from the cut; review any newly necessary imported source before copying it. Do not import upstream's broad settings/auth/proxy/cache discovery just to reuse a small extractor.

## Pending dependency decision

Proposed exact local dependencies, observed through npm registry metadata within upstream's declared ranges:

| Library | Exact version | Reason | License |
| --- | --- | --- | --- |
| `linkedom` | `0.16.11` | HTML DOM | ISC |
| `@mozilla/readability` | `0.6.0` | Main readable article | Apache-2.0 |
| `turndown` | `7.2.5` | Markdown conversion | MIT |

Alternative: bring the full upstream graph and features (larger dependency/control scope), add Defuddle for more fallback coverage (another dependency), or write a new extractor (against the reuse objective). The initial recommendation is the three-library cut, with its coverage limits stated honestly.

**Obtain approval before declaring/installing new dependencies.** The proposed install would now be in StelaShell's root manifest/node_modules, exact versions plus the root lockfile, lifecycle scripts disabled, no global install. This supersedes the earlier separate-package install location. Registry metadata inspection is not installation or a vulnerability audit. Respect dependency licenses and review the resolved tree. Use Pi-provided SDK/TUI/typebox peer dependencies rather than duplicate runtime copies.

## Network, privacy and evidence requirements

- Public non-sensitive targets/queries only; no ambient credentials, cookies, automatic provider switch or proxy/TLS/routing workaround.
- Treat page/provider output as untrusted evidence, not instructions/approval. Preserve final source URL, retrieval provenance, truncation/partial states and unknown version when not established; retrieval is not publication.
- Upstream accepts HTTP/HTTPS, configurable ports/redirect/proxy exceptions and DNS preflight without connection pinning. Its normal response/timeout behavior is not the retired reader's HTTPS/443, 2 MiB, 16 KiB, 20-second-total contract. Do not silently inherit those broader paths or claim old guarantees for new code.
- Before live use, implement and check the actual selected network, body/output, timeout/concurrency and cancellation behavior. Synchronous HTML parsing is not automatically interruptible. A remote request's local cancellation does not prove remote work/billing stopped.
- Avoid implicit session/disk result stores and hidden inference in the first version. Normal Pi transcripts may retain submitted arguments/results; no no-storage claim.

## Verification and remaining work

Retirement verification: protected source/settings hashes unchanged during removal; profile junction removed without following its target; empty `mcpServers` object retained; package/lock no longer contain the old parser or web entry. The updated remaining Windows suite passed **129 tests, 17 POSIX-only skipped, 0 failed (146 total)**, including native deterministic Pi/session/Job checks. This is regression evidence for retained functionality, not tests of the proposed replacement extension.

Next: approval for the three proposed local libraries, then implement/test the reused search/read paths and Pi registration. Use deterministic injected responses/documents for result parsing, errors/limits/cancellation, extraction and provenance; actual Pi checks for permission pipeline/helper exclusion; a narrowly authorized public smoke for the completed main flow. Do not claim all-source/all-platform/TUI/model compliance from those checks. No new runtime, live search/page read, credentials, package activation or publication has occurred for the replacement. The user-requested checkpoint commit covers only the existing retirement/preparation, not a working replacement or approval to install dependencies. The user subsequently chose an internal extension; structural migration is proposed, not executed.

The read-only helper `task-78aa68f1-835f-4589-8089-fe371de73251` completed the extraction-boundary evidence question with explicit missing-import/security limitations. Parent changes were outside its upstream reference files. See [superseded scaffold notes](../packages/web/README.md) and [WORK_STATE](WORK_STATE.md) for actual current files, scope and approval gate.
