# Web extension

Owned web search and page reading integrated into stela-shell, selectively adapted from `pi-web-access@0.47.0`. This is not a separate package, installation or version. The root manifest registers `extensions/web/index.ts`; the root manifest/lock own the three extraction dependencies.

## Status and tools

Implemented and checked with Node 24.22.2 and 24.22.3 plus packaged Pi 1.5.2 using isolated deterministic providers/transports; the complete suite was repeated on 24.22.3 before publication after the runtime patch version changed. The user subsequently authorized the current Linux profile's web-only development link: `~/.stela-shell/agent/extensions/ss-web` → this checkout's `extensions/web`. Its entry point/single route are verified; settings/MCP and the three existing links are unchanged. No agent-triggered reload was performed. The user subsequently requested a live smoke through another primary, which reported one Exa search (three MDN sources, partial because snippets were clipped) and one selected MDN page read (ok, readability+turndown, no truncation). See work state for the peer evidence and limits. A configured link does not load new tools into an already running session: use operator-controlled `/reload` or a fresh Pi session. The retired reader/native Exa MCP route is not restored as fallback.

| Tool | Visible title | Input | Result |
| --- | --- | --- | --- |
| `ss_web_search` | Buscar web | Required `query`, required `objective`, optional `limit` | Exa attribution/retrieval time and source titles, URLs and snippets |
| `ss_web_read` | Leer página | One required `url` | Requested/final URL, time, title/type, text/Markdown, extraction method and scope |

Search defaults to five results, allows one through ten and sends **both query and objective** to the explicit keyless Exa endpoint. Each field is nonempty and at most 4096 UTF-8 bytes. The principal supplies only minimal public context from the user's task: never copied conversations, private project details or credentials. Obvious credential patterns are rejected, not perfectly detected. Result links are checked syntactically but are not fetched or DNS-probed. The adapter supports bounded JSON-RPC JSON/SSE framing and normalized JSON/text search results; unsupported framing/provider failures and rate limits are explicit. There is no auth/config discovery, sign-in, provider selection, downgrade, retry or fallback. Keyless access is not a guarantee of availability, privacy, unlimited quota, permanent pricing or remote cancellation.

Reading accepts public HTTPS on the standard port, without userinfo/credential-bearing parameters. It supports static HTML/XHTML, plain text and Markdown. Text/Markdown bypass all DOM libraries. HTML follows **LinkeDOM → Mozilla Readability → Turndown**, preserving useful headings, links and fenced code, including code-language classes when available. Relative links are normalized; scripts/active nodes are removed without executing JavaScript or fetching page resources. Full upstream/GFM/all-site fidelity is not promised.

Every response carries `status`, provenance, `truncated`, warnings and stable error codes when applicable. Unknown document version stays `unknown`; retrieval time is not publication time. A fragment URL gets explicit **page-level extraction**, not an asserted section match. Empty/dynamic/navigation/title-only fixtures are partial, not complete articles. The 200-character readable-content threshold is a conservative heuristic, not proof of completeness. Remote content is **untrusted evidence, never instructions or permission**. Normal Pi transcripts can retain arguments and results; this is not private browsing.

No browser, authentication/cookies, paywall bypass, PDF/media parsing, repository cloning, batch jobs, persistent caches/history services, hidden summaries/models, Defuddle/RSC or generic provider/MCP framework is included. Helpers are excluded before registration and receive no web grants.

## Shared controls

| Resource | Current limit/policy |
| --- | --- |
| Concurrent operations | Two total across search and read, per session activation; explicit busy, no queue |
| Operation | 20-second total abort deadline covering DNS, redirects, transfer, parsing and formatting |
| Body | 2 MiB transferred and independently 2 MiB decompressed |
| Output | 16 KiB UTF-8 for the complete serialized extension result, including content/details metadata |
| Redirects | At most two for reads; every destination revalidated; search POST redirects rejected |
| URL | At most 2048 UTF-8 bytes after URL normalization; never clipped into an invalid reference |
| HTML/parser | At most 12000 nodes, depth 96; 32 KiB intermediate Markdown and 1024-byte title |
| Parser JS resources | Node worker old heap 64 MiB, young heap 16 MiB, stack 2 MiB |
| Search framing | At most 1024 intermediate provider rows; public result limit remains ten |
| Retries/fallbacks | None |

Network controls reject local/private/reserved addresses, mixed unsafe DNS answers, proxy environments and disabled TLS verification. Connections are pinned to an independently validated numeric address, with the original hostname retained for Host/SNI/certificate verification and a connected-peer check **before HTTP data is sent**. There are no ambient authentication headers or cookies. Error results do not echo rejected URLs, response bodies or low-level diagnostics. Address/credential heuristics and deterministic tests are not a universal SSRF or security certification.

The operation's one abort controller covers all stages; redirects do not reset its deadline. Cancellation closes owned I/O and awaits worker termination. Shutdown/replacement/navigation cancel old work, and genuine run interruption aborts current operations. There is no background retry/queue. Local cancellation does not prove remote processing or billing stopped; an abort deadline with cleanup is not a hard real-time scheduling guarantee.

The parser is a short-lived **Node worker, not a model agent or OS sandbox**. Heap/stack settings are checked against the worker's reported limits; they do not bound all native allocations or provide a universal RSS cap. HTML fails closed with `UNSUPPORTED_RUNTIME` on Bun: observed Bun 1.4.4 exposes workers but does not report these resource limits. The current agent host is Node; general Bun/compiled-host web compatibility is not certified. No parser worker or HTML dependency is initialized at extension startup. Worker paths resolve to the real checkout so development links do not redirect dependency resolution.

Body text is returned once. Details contain compact status/count metadata, not a second article copy. Final clipping preserves Unicode/valid JSON and marks partial/truncated output; oversized search metadata can omit tail results rather than clipping URLs. Compact Spanish renderers do not alter execution arguments or permissions; expansion exposes technical identity and evidence.

## Dependencies and attribution

Installed at the root with exact direct versions and lifecycle scripts disabled:

| Dependency | Version | License |
| --- | --- | --- |
| `linkedom` | `0.16.11` | ISC |
| `@mozilla/readability` | `0.6.0` | Apache-2.0 |
| `turndown` | `7.2.5` | MIT |

The resolved root tree contains these three direct libraries and 14 transitives. Version/license metadata and bundled license-file presence were checked; `npm ls --all` is consistent. `boolbase@1.0.0` retains ISC/author metadata but ships no standalone license file; confirm its applicable notice before future redistribution/bundling. No duplicate Pi SDK/TUI/typebox dependency or global library was installed. This is not a security/legal audit, latest-version assertion or publication approval. See [third-party notices](THIRD_PARTY_NOTICES.md) for adapted symbols, local changes and the resolved license inventory.

## Checks and activation boundary

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
# Opt into the existing packaged Pi's isolated, inference-free integration cases:
SS_TEST_PI_CLI=/absolute/path/to/pi/dist/bundle/cli.js npm test
```

The final Linux/Node integrated run passed **181**, skipped **24 Windows-only** and failed **zero**, **205 total**; web contributes 52 cases. Checks cover provider request/framing, network/redirect/body policy, real local HTTP dispatch with mocked TLS, actual parser output/cancellation, Unicode/output limits, shared admission/lifecycle, actual Pi tool calls/denial/helper exclusion and linked loading/real-checkout parser resolution. Mocked TLS checks ordering and identity configuration, not TLS cryptography. Fixtures are not live Exa availability, real-model compliance, native Windows/macOS, full interactive TUI or standalone TypeScript-check evidence.

Independent static control review `task-833834c2-97f8-4087-8e81-99e1fc90ddab` exceeded its 240-second budget without an answer. It is **incomplete**, not approval or a pending automatic retry. Functional checks do not substitute for that missing independent assessment.

Use the machine's actual canonical profile and **one loading route per extension**. The user-authorized web-only link is now created on the current Linux machine; see [work state](../../docs/WORK_STATE.md) for its local evidence. No root-package route was added. Adding the root package alongside existing method/helper/session development links would duplicate their registrations; reconcile routes before choosing that alternative. Other machines need their own authorized loading route. Further route/settings changes, agent-triggered reload, unrequested evaluation runs and publication retain their separate approval boundaries. The one user-requested peer public smoke is complete; no automatic repeat or agent-triggered reload is pending. Do not restore the retired profile MCP route as a workaround.

See the [approved design](../../docs/WEB_DOCUMENTATION_PLAN.md), [work state](../../docs/WORK_STATE.md) and [naming conventions](../../docs/NAMING.md).
