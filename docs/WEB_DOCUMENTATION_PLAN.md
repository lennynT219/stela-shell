# Web and technical documentation: first capability

## Status and authority

The design is complete and the user selected implementation of the local public-URL reader first, then explicitly approved adding `htmlparser2` and its transitives. The reader is now implemented in `extensions/web/`, with exact dependency/lockfile, focused checks and a production public-source smoke. It is not web search or an approved search-provider selection, and the separately authorized Windows `stela-web` profile junction is now created and verified, without an agent-initiated reload. See the [reader README](../extensions/web/README.md) and WORK_STATE for actual runtime evidence and limits.
The user accepted advancing to documentation/web tools and defining their behavior before choosing services or installing anything. The requirements below translate that intent into a proposed first increment; detailed defaults and implementation choices are proposals, not previously agreed product decisions.

The initial work authorized local project documentation and focused inspection of relevant Pi interfaces; the subsequent user decision also authorizes implementing the local reader with Pi TypeScript/Node integration, without a new Rust component. The subsequent dependency approval covers local `htmlparser2` 12.0.0 and normal transitives, not model downloads, other packages, credential/profile changes, paid-service activation, agent-initiated reload, a new real-provider evaluation, commits or publication. A later direct user request authorized the single Windows profile link for manual testing, not settings changes or an agent-initiated reload. Existing helpers remain read-only over authorized existing references; this plan does not give them web access.

## 1. User outcome

Given a technical question, Stela should find appropriate public sources, read the relevant material, and answer with verifiable references and explicit version limitations.

The first useful case is:

> Explain how to cancel a request in the project's library version, using that version's official documentation. Identify any discrepancy with current documentation.

Success means a supported answer, not just a list of search hits or an HTTP 200 response. If search is unavailable but the user supplies a public documentation URL, reading that URL remains independently useful. That is partial capability, not working web search.

### Included in the proposed first increment

- Public technical documentation and ordinary text-based web pages.
- Search by question/topic, with preference for official documentation and release notes.
- Reading a supplied URL without first performing a search.
- Bounded excerpts, source attribution, version comparison and explicit uncertainty.
- Normal Pi tool permission/cancellation behavior and cross-platform TypeScript integration.

### Excluded

- Browser automation, executing page JavaScript, login sessions, cookies or private/intranet services.
- CAPTCHA/paywall bypass, authenticated repository access, bulk crawling or indexing.
- PDF/OCR, multimedia, generated images/audio/video and persistent memory.
- Changes to the session transport, Rust controllers, helper tools or their permissions.
- General profile/model audits or installation of an entire reference distribution.

## 2. Grounded Pi findings

Inspected target: the locally installed **Pi 1.5.2** package, not an assumed current upstream API.

| Observation | What it establishes | What it does not establish |
| --- | --- | --- |
| `dist/core/tools/index.js` exports local file/search/shell tools; its `allToolNames` contains no dedicated web search or URL-reading tool. | The inspected native tool catalog does not supply this web capability. | Whether extensions, connected MCP servers or another profile supply it. |
| `docs/sdk.md` and `examples/sdk/05-tools.ts` document tool selection and extension boundaries. | Pi can host additional tools; there is no need to replace its agent/session loop. | A specific web backend is already installed or working. |
| `docs/codemode.md` provides orchestration, discovery and output filtering. Its sandbox has no network or Node APIs. | Codemode can compose already available tools and reduce their outputs. | A `fetch()` call inside codemode is a web implementation, or codemode itself is a search engine. |
| `docs/mcp.md` documents built-in stdio/HTTP MCP support and tool/resource exposure. | A compatible service can be connected without writing a second MCP client. | Any particular service, pricing, authentication or content-safety behavior is validated. |
| Targeted `searchTools()` queries for web search/documentation and URL content returned only unrelated matches. | No usable web candidate was identified by this session's targeted discovery. No provider operation was exercised. | An exhaustive inventory or proof of absence across profiles, inactive/hidden tools or future connections. |

No settings, authentication files or global model catalog were inspected for this design. `pi mcp list` was not run: the installed documentation says it connects to every enabled server, which is unnecessary for this narrow question.

## 3. Proposed behavior

1. **Understand the question.** Identify the library/product, topic and requested version. Read a relevant local manifest only within the user's authorized workspace. Distinguish an exact installed/locked version from a manifest range; ask only if the ambiguity materially changes the answer.
2. **Use a supplied official URL directly when appropriate.** Do not add a search call merely as ceremony.
3. **Find sources when necessary.** Send a minimal public query, not source code, stack traces, credentials, internal hostnames or repository contents. Prefer official/versioned docs, then official release notes; label community sources as secondary.
4. **Read the evidence.** Search snippets alone are discovery evidence, not proof of API behavior. Read the page/section supporting a material claim. Do not recursively follow every link.
5. **Check version applicability.** Report separately the requested/project version and the version identified by the document. Never silently present `latest` as documentation for an older version. If no match is available, explain the limitation or ask to widen the scope.
6. **Answer with references.** Connect important claims to source IDs and real URLs. Separate quotations, observed behavior and inference. Preserve limitations and contradictions rather than inventing agreement.

### Expected answer shape

- Direct answer and a short example when supported by the source.
- Version applicability: exact, range-compatible, different/latest or unknown, with the evidence for that label.
- Sources: title, canonical/final URL, relevant section and retrieval time in UTC.
- Limitations: unavailable page, partial/truncated content, uncertain version, secondary source or unresolved conflict.

Retrieval time is not publication time. A recent download does not prove the source is current; a search snippet's date is not a verified release date. Section links and citations must come from observed source metadata/content, not guessed anchors. If a safe public final URL cannot be retained, report that limitation instead of emitting a sensitive link.

## 4. Minimal provider-neutral contract

These are logical operations, not registered tools or a commitment to new tool names. Reuse suitable existing tool schemas instead of wrapping them just to impose Stela branding.

| Operation | Inputs | Required evidence/output |
| --- | --- | --- |
| Search sources | Public query; optional library/version/domain preference; bounded result count. | Source ID, title, URL, snippet, backend identity and retrieval time. State which filters were actually enforced and distinguish a soft preference from a hard restriction. |
| Read source | Public URL; optional requested section/topic and version context. | Requested and final URL, title, source ID, content type, retrieval time, bounded source excerpt, version evidence, truncation/partial flags and a clear error when unavailable. |

Do not present generated summaries as verbatim source text. If a backend supplies only snippets or a generated answer, mark that limitation; it does not satisfy the read operation. Unsupported filters must be reported, not silently ignored. Preserve original source URLs even when a service proxies or reformats content.

### Initial budgets

The local reader now enforces the read/body/output/deadline/redirect/concurrency bounds below. Search and unselected remote-backend budgets remain proposals, not runtime guarantees. Extraction complexity and supported-format details are in the reader README.

- Search: at most **5 results per call**.
- Read: one URL per call; start a normal question with **1–3 relevant pages**, not an autonomous crawl. Larger user requests can justify a larger explicit research scope.
- Retrieved response: at most **2 MiB of decoded body per page**, enforced while streaming; do not trust `Content-Length` alone. Bound encoded input/decompression resources as appropriate for the chosen backend.
- Model-visible result: at most **16 KiB UTF-8 per operation**, including metadata; select useful excerpts before reaching that cap and reserve space for provenance/errors. This is below Pi's documented 20 KB MCP text threshold, but an external service does not automatically honor it. Use an explicit bounded normalizer/codemode reduction when required, before model exposure. Mark truncation; no silent middle removal of a material claim.
- Local operation: **20-second total deadline**, including redirects/body work, at most **2 redirects**, at most **2 concurrent operations**, with cancellation propagated to the actual request.
- No Stela-added retry loop or automatic switch to a different/paid backend. Document transport-level retry behavior separately: Pi describes two transient HTTP retries, one resource-read/list retry and no replay at the tool-call layer. Do not combine these into an unverified total-attempt guarantee or promise one network request per MCP call.

Pi's documented MCP timeout defaults to 60 seconds and progress notifications reset it; codemode's overall deadline is optional and unset by default. Neither establishes the proposed 20-second total deadline. A remote service may continue after local cancellation; report that uncertainty rather than claiming its work or billing stopped.

If a candidate backend cannot expose/enforce a required budget, record the gap and decide whether an adapter or a narrower guarantee is appropriate before claiming conformance. A content cap does not bound total provider cost or the model's context by itself.

## 5. Trust, privacy and network boundary

Page content, snippets, metadata and code examples are **untrusted evidence**, not instructions to the agent. They cannot grant permissions, demand tool calls, override the user's request, or authorize running pasted commands. Existing Pi tool hooks must remain in force; read-only labels and authentication do not make external content trusted.

For a local URL reader, require a tested public-network boundary: HTTPS only in the first increment; no URL userinfo or credential-bearing URLs; reject loopback/private/link-local/reserved destinations and cloud metadata endpoints, including IPv6 and IPv4-mapped forms. Validate every redirect and the actual connected destination so DNS rebinding cannot defeat a string-only preflight. Account for proxy behavior. Do not disable TLS validation or use shell interpolation to retrieve a URL. Node's `fetch()` alone is not this policy.

For remote search/read services, document what is sent, where fetching occurs, retention/billing implications and the limits of observable destination validation. A local guard cannot certify the service's internal fetch behavior. Do not label a remote MCP service equivalent to a locally guarded reader without supporting evidence.

No credentials/cookies/project files are forwarded automatically. The local implementation rejects userinfo and recognized credential-key patterns; this is not a general secret detector. Arbitrary path/query values can still contain sensitive data, so callers must supply non-sensitive public URLs. No claim of universal credential recognition is made. No persistent cache of full queries/pages is proposed. Pi may persist tool arguments/results in session transcripts; minimize/redact inputs before invocation rather than claiming that no data is stored anywhere. Query strings, returned URLs and error messages can contain sensitive data and need deliberate treatment.

The implementation should expose only the intended search/read behavior. A service offering unrelated write/admin tools must not be accepted wholesale under a read-only design. MCP annotations such as `readOnlyHint` are hints, not enforcement. Codemode filtering reduces model-visible data; it is not a sandbox, privacy filter or rollback mechanism.

## 6. Integration choices and recommendation

| Route | Benefit | Cost/limit | Current recommendation |
| --- | --- | --- | --- |
| Reuse a suitable already available tool | Avoids new components/configuration. | Must first establish availability, permissions, provenance and actual behavior. | First preference if a concrete candidate is identified; none was found by the targeted discovery. |
| Pi's built-in MCP client + selected documentation/search service | Reuses Pi's lifecycle, exposure and tool permission pipeline. | Provider choice, data handling, credential/cost approval and service conformance are still required. A stdio launcher can download software; do not use an automatic `npx -y` setup as a harmless probe. | Prefer for a suitable existing MCP service; no custom MCP client or parallel replacement extension. |
| Narrow TypeScript URL reader | Can retrieve a known public URL without a search API and without replacing Pi. | Not a search engine; safe networking and useful HTML extraction are real implementation work. Parser/dependency choices need approval if new libraries are required. | Smallest provider-independent increment to consider first, if the local-reader requirements are accepted. |
| Custom search-service adapter | Can normalize a chosen REST API when no suitable tool exists. | Adds maintenance, auth, billing and tool-contract responsibilities. | Only if concrete service requirements justify it. |

**Proposed rollout:** agree on this first-increment contract, then choose how to supply URL reading. Separately choose a search/documentation backend after examining its official API, licensing, data handling, costs and version coverage. Reuse Pi MCP if it fits. Do not build a search-engine scraper or add Rust merely for this feature. A working reader alone must remain labelled partial delivery until search is supplied or deliberately excluded by a later user decision.

No provider is selected. Context7 or any general search service is a candidate category, not an approved dependency, configured service or verified source of version-matched documentation. No pricing or service-availability claim has been made.

## 7. Verification plan for implementation

This is the acceptance matrix for the broader capability. The local-reader subset has focused deterministic/native-Pi checks and a public MDN smoke, recorded in WORK_STATE; search/service cases remain future work. Do not infer all-platform or all-provider coverage from that subset.

| Case | Evidence required |
| --- | --- |
| Known documentation URL | Relevant source passage and real attribution; no unnecessary search operation. |
| Version mismatch | Requested version and document version remain distinct; no invented compatibility. |
| Search then read | The final API claim is backed by fetched material, not only a snippet or model-generated answer. |
| Missing/contradictory sources | Honest partial answer, secondary-source label or explicit unresolved conflict. |
| Long page, escaped text and Unicode | Byte/decompression/output caps respected; complete provenance and visible partial markers survive. |
| Page attempts prompt injection | Content remains data; no permission escalation, secret access or execution of embedded commands. Review complements these examples; a fixture does not prove universal resistance. |
| Unsafe URL/redirect/DNS response | Rejected before private-network access, including destination changes, mapped IPv6 and proxy handling. Remote services report their different trust boundary. |
| Deadline/cancel/permission denial | Actual operation stops or its unconfirmed state is reported; no bypass/fallback or hidden continuing local request. |
| Service/auth/rate-limit failure | Useful redacted error; no fake results, automatic install/sign-in or unapproved provider switch. |
| Cross-platform integration | The selected first increment behaves under actual supported Windows and Linux runtimes; do not transfer evidence from one platform to another. |

Use deterministic fixtures for local parsing, provenance, budgets, cancellation and permission integration. Add a narrowly authorized public-source smoke check only when a concrete backend exists; paid/provider evaluations need their own applicable authorization. Do not download engines or invoke paid services to validate this document.

## 8. Design evidence and next decision

Design-stage evidence: source inspection of Pi's installed tool catalog, SDK/codemode/MCP documentation and scoped tool discovery; no backend was executed during that design stage. Subsequent authorized implementation added the local reader and actual MDN retrieval. Runtime evidence is recorded separately in WORK_STATE; this plan is not a security/provider-compatibility certification.

Bounded helper `task-85021ed0-8810-4e8f-bb5d-256badf58f53` completed a source-anchored static check of Pi's MCP/codemode documentation and project constraints. Its findings are incorporated: hooks are integration points rather than an installed policy, transport/resource/tool retries differ, progress can extend the MCP timeout, large MCP text may lose its middle, and network/privacy guarantees belong to the selected backend. This is not a review of a completed implementation, a provider test or a security audit. Its conservative parent-mutation warning concerns creation of this separate plan; none of the three reviewed references was edited while it ran.

The user selected the local public-URL reader and approved `htmlparser2`/transitives; that dependency decision is fulfilled locally. A bounded static code review found a structural section-selection defect, now corrected with regression cases; this is not an independent post-correction audit. The separately authorized Windows profile junction is verified; next is user-controlled reload/testing, with later search/documentation-service selection still independent. Subsequent live use succeeded and the user accepted the reader and explicitly authorized its local delivery commit. Credentials/paid usage and push remain separate authorizations. Existing Rust controllers are unchanged.

### Source references

- [Project context: tools and integrations](PROJECT_CONTEXT.md#6-tools-and-integrations-what-is-known-and-what-is-not-decided).
- [Project continuity and evidence](WORK_STATE.md).
- Installed Pi 1.5.2: `dist/core/tools/index.js` (`allToolNames`, `createCodingTools`); `examples/sdk/05-tools.ts`.
- Installed Pi 1.5.2: `docs/sdk.md` (Configuring a session / Codemode and MCP); `docs/codemode.md` (Scripts, Call tools, Limits); `docs/mcp.md` (Control tool exposure, Permissions, Diagnose connection problems, Use resources).
- Public upstream documentation for navigation only: [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Codemode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md), [MCP](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md). These `main` links are not a Pi 1.5.2 version pin and were not fetched as evidence in this task.
