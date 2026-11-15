# StelaShell web extension: approved design and implementation

## Status and authority

After the completed ss migration, the user explicitly confirmed implementing the approved web plan. Both tools are now implemented under `extensions/web`, registered in the root manifest and checked in isolated Node/Pi fixtures. The three approved exact extraction libraries are installed locally at the root with lifecycle scripts disabled; there is no independent web package/install/version. Final integrated Linux/Node evidence: 181 passed, 24 Windows-only skipped, zero failed (205 total). This does not activate a running profile or establish live Exa availability. See the [web README](../extensions/web/README.md) for operation and limitations.

The old reader/native Exa MCP route remains retired. Its source/history and passing tests do not establish replacement behavior. FARO, subagents, sessions, unrelated settings and Git history stay outside this implementation scope. The original implementation scope did not authorize helper web grants, credentials, profile activation, agent reload, paid/model evaluation, commit or push. The user subsequently authorized the current Linux web development link, then one bounded public search→read smoke through another primary; both are completed and recorded in WORK_STATE. No additional profile/settings change, agent-triggered reload, repeated/paid experiment or publication is implied.

The scope, provider, budgets and delivery sequence below are the approved implementation baseline, not immutable FARO rules or universal guarantees. Tools are `ss_web_search` / `ss_web_read`, visible **Buscar web** / **Leer página**, following [project naming](NAMING.md). Existing permission controls remain binding. The separate automatic pre-compaction helper proposal is deferred; it is not part of web.

## 1. Smallest useful outcome

Two explicit operations:

1. Search for public sources and return attributable URLs/snippets.
2. Read one deliberately selected public URL into useful text/Markdown.

Search must not fetch result pages implicitly. Reading must not invoke a model to summarize or repair extraction. The main agent selects sources and reasons over the returned evidence using its existing context; there is no additional model call hidden inside either tool.

Initial reading covers static HTML, plain text and Markdown. Exclude browser rendering, authenticated/paywalled access, cookies, PDF/media extraction, repository cloning, batch jobs, persistent caches and result-history services. A public GitHub page or raw Markdown URL may be read as an ordinary page; no special repository integration is implied.

## 2. Tool contracts

| Tool | Input | Output |
| --- | --- | --- |
| `ss_web_search` | Required `query` and `objective`; optional `limit` | Provider, retrieval time, source titles/URLs/snippets, truncation and explicit errors |
| `ss_web_read` | One required `url` | Requested/final source URL, retrieval time, title, content type, extracted text/Markdown, extraction method and partial/truncated/error state |

`objective` is supplied explicitly by the main agent from the user's task. The observed Exa schema requires it; do not omit it, invent intent inside the adapter or add another inference call to generate it. Both query and objective go to the provider: send only the minimal public-search context, not private project details, credentials or copied conversations.

Use a small common result envelope with `status`, source/provenance, `truncated`, warnings and a stable error code when applicable. A short source is not necessarily partial; a failed extraction is not a successful article. Unknown document version must remain unknown rather than being inferred from the retrieval date.

Return normal Pi tool content/details with a concise normal renderer, not a separate dashboard or tracking system. Return extracted content once; details must not duplicate the full body. Bound the final serialized model-visible output, including metadata. Do not clip source URLs into invalid references or dump raw HTML/provider responses into model context. Normal Pi transcripts may still retain tool arguments/results.

Do not add section selectors, pagination/session handles or a heading-query engine to this first cut. For fragment URLs, report page-level extraction explicitly unless the requested fragment was actually resolved; never imply a requested section was extracted merely because the URL contained an anchor.

## 3. Minimal implementation shape

Recommended initial split, without a general framework:

```text
extensions/web/
├── index.ts              # Two Pi tools, validation, lifecycle and helper exclusion
├── search.ts             # Narrow Exa adapter and normalized search results
├── network.ts            # Shared bounded public-HTTP transport/policy
├── read.ts               # Content-type handling, provenance and extraction lifecycle
├── extract-worker.mjs    # HTML parsing only; no model or network calls
├── tests/
├── README.md
└── THIRD_PARTY_NOTICES.md
```

Keep small helpers local; do not add provider registries, generic MCP clients, configuration frameworks, caches, queues, daemons or a separate package manifest. Use Pi's existing tool execution, permission pipeline, cancellation signals and presentation conventions. Do not change the active tool set or copy another instruction stack.

Return before registration/resource initialization for `STELA_SUBAGENT_CHILD`. Create no network activity or parser worker at startup. Load the HTML libraries only when reading HTML; plain text/Markdown bypass DOM parsing and conversion.

A short-lived worker makes synchronous HTML parsing separately terminable without blocking the primary event loop. It is a local parser worker, not a model agent or OS sandbox. Use bounded resources and owned cleanup; do not introduce a reusable worker pool before a demonstrated need. Verify worker/dependency resolution through the extension's real checkout when development links are used.

## 4. Reuse instead of rebuilding

Source basis: inspected `pi-web-access@0.47.0`, MIT, registry Git head `322e44fafc1aaa691779cdf2116584e67edd7645`. Preserve [upstream notices](../extensions/web/THIRD_PARTY_NOTICES.md), identify copied symbols and record local changes. This is not a Gentle Shell-pinned companion release or a complete upstream security audit.

### Search

Implemented backend: the previously exercised keyless Exa service, called from the extension over HTTPS using the adapted upstream request/result/error path. Its replacement adapter has deterministic framing/request evidence, not a new live-service smoke. This does not restore the retired native MCP profile entry or expose the backend's MCP tool name as Stela's public identifier.

Adapt the observed `query` + `objective` contract. Reuse only the narrow response framing/parsing needed for this service, including supported JSON/event-stream responses; avoid importing the complete optional dependency graph. Node built-ins should cover the transport; no new generic MCP SDK is justified for this cut.

No ambient key discovery, sign-in, automatic provider selection, advanced-filter downgrade, retry chain or result-page fetching. If the service is unavailable/rate-limited, return that limitation. Keyless access is not a guarantee of unlimited availability, privacy, permanent pricing or remote cancellation.

### Reading

Use one HTML path: LinkeDOM → Mozilla Readability → Turndown. Adapt the relevant upstream HTTP/title/charset/extraction helpers rather than importing `extract.ts` unchanged with all its optional integrations.

Defer Defuddle and optional RSC extraction. Do not silently label navigation/title-only output as a complete article or accumulate fallback engines to hide extraction failure. Report unsupported/dynamic/insufficient content clearly; this deliberately has less coverage than full upstream.

Selected public-address, pinning, size-limit and worker-lifecycle utilities from `bdcfdc6` were adapted and newly tested in the shared transport/orchestration. This does not restore the old tool, profile route or reader architecture and does not inherit its previous guarantees.

## 5. Implemented starting budgets

These current defaults are covered by deterministic Node checks, not universal OS/resource/security guarantees:

| Resource | Current value |
| --- | --- |
| Search results | 5 by default, at most 10 |
| Read scope | One explicit URL per invocation |
| Model-visible output | At most 16 KiB UTF-8 per complete serialized result |
| Response body | At most 2 MiB transferred and 2 MiB after decompression, for search and reading |
| Operation deadline | 20 seconds total across DNS, redirects, download, parsing and formatting |
| Redirects | At most 2; validate every destination |
| Concurrent web operations | At most 2 per primary session; explicit busy result, no background queue |
| Automatic retries/provider fallbacks | None |

The same operation abort deadline covers all stages; it is not a fresh timeout for each hop or a hard real-time scheduling promise. Owned I/O/parser cleanup is awaited; cancellation cannot prove remote processing/billing stopped. HTML uses a one-shot Node worker with reported limits checked against old heap 64 MiB, young heap 16 MiB and stack 2 MiB. These are JS limits, not a universal RSS cap or OS sandbox. Bun 1.4.4 omitted resource-limit reporting in a local probe, so HTML is explicitly rejected on Bun rather than silently parsing unbounded. Complexity limits are 12000 nodes/depth96, intermediate output 32 KiB/title1024 bytes; insufficient content uses a conservative 200-character heuristic.

For the first version, recommend public HTTPS on the standard port only, no userinfo, ambient credentials/cookies, proxy/TLS workarounds or private/local/reserved destinations. Validate DNS answers and pin the connection to a validated address while preserving hostname/TLS validation; repeat validation on redirects. DNS preflight alone is insufficient. Search-result links are not fetched or DNS-probed merely to produce a result list; the reading policy applies when a URL is selected.

Reject evident credential-bearing inputs and redact errors, but do not claim infallible secret detection. Remote content is untrusted evidence, never instructions or approval. Oversized/binary/unsupported bodies fail explicitly rather than being silently passed to the parser; output clipping remains visible and preserves Unicode/valid serialization.

## 6. Dependencies and alternatives

Only HTML extraction loads these installed root direct dependencies:

| Library | Exact installed version | Purpose | License |
| --- | --- | --- | --- |
| `linkedom` | `0.16.11` | HTML DOM | ISC |
| `@mozilla/readability` | `0.6.0` | Main readable article | Apache-2.0 |
| `turndown` | `7.2.5` | Markdown conversion | MIT |

The root lock was resolved/reviewed before `npm ci --ignore-scripts --no-audit --no-fund`. It contains the three exact direct libraries and 14 transitives, with ISC/MIT/BSD-2-Clause/Apache-2.0 metadata; installed versions and `npm ls --all` are consistent. This is not a latest-version, security or complete legal audit. Bundled notices and the boolbase metadata-only license gap are documented in [third-party notices](../extensions/web/THIRD_PARTY_NOTICES.md). No global library or duplicate Pi SDK/TUI/typebox package was installed.

Keep Turndown for basic headings, links and code-block structure useful to documentation reading, rather than adding a custom converter. A two-library HTML-to-plain-text variant is possible, but sacrifices that structure; it is a narrower alternative, not an equivalent implementation. Full upstream rendering/GFM fidelity is not promised.

The search slice was implemented and checked before extraction-library installation. Text/Markdown still bypass these libraries. Alternatives remain a deliberately narrower text/Markdown reader, a separately reviewed extractor or the broader upstream graph; each changes coverage/scope. Do not silently add libraries or a custom HTML converter.

## 7. Delivery and acceptance

### Delivery A: working search

Implemented first without extraction dependencies: narrow Exa adapter, shared network/output/lifecycle controls and a functional Pi entry point, followed by root registration. Deterministic request/framing/result/error/limit/cancellation checks and isolated actual Pi tool/denial/helper/linked-load cases passed. No empty stub or live-provider smoke was used.

### Delivery B: working page reading and search-to-read flow

Implemented after the already approved root installation: HTML extraction, direct text/Markdown, explicit provenance and bounded owned worker cleanup. The final 52 web cases cover representative article/code/non-article fixtures, charset/unsupported/oversized responses, redirects/address pinning, output clipping/cancellation, actual Pi registration/tool calls/denial/helper exclusion, linked loading and real-checkout parser/dependency resolution.

The integrated search → selected URL → real HTML parser → readable evidence flow passes in isolated scripted Pi. The separately authorized Linux development link is created. A subsequent user-requested peer live smoke reports three Exa/MDN sources (partial due to clipped snippets), then an ok/untruncated selected MDN HTML read using readability+turndown. This is one receiver-reported live flow, not all-site/platform/TUI quality or an independent safety assessment. Further profile changes, agent-triggered reload and unrequested evaluations retain their own scope/approval boundaries.

Keep functional checks and docs with each delivery; no fixed agent pipeline, arbitrary test quota or routine benchmark. Reuse still-valid tests, add checks for changed behavior and run affected session/core integration at the final registration boundary. Do not reopen unchanged Windows/native implementation or retry failed security reviews automatically.

## 8. Decision to proceed

The ss prerequisite and local web implementation/installation are completed. The user subsequently requested the current Linux web-only development link, now created and verified without altering settings/MCP or existing links. One subsequent user-requested live Exa→MDN smoke through another primary is complete with its partial/ok states recorded. No root-package loading route, agent-triggered reload or separate paid-model experiment was performed. The user subsequently accepted this result and authorized Git commit/push of the accepted POSIX/ss/web delivery; actual Git HEAD/upstream refs establish publication state. Further scope, package releases/bundles and other protected actions retain their separate approval boundaries.

Independent static control review `task-833834c2-97f8-4087-8e81-99e1fc90ddab` exceeded 240 seconds without an answer and remains incomplete; no automatic retry was started. Functional results do not replace it or constitute security certification. Current outcomes and limitations are in [WORK_STATE](WORK_STATE.md); earlier source/design reviews do not certify this runtime.
