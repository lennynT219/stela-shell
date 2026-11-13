# Public URL reader

`stela_read_url` reads a **known public HTTPS URL**. It is not a search engine, browser, authenticated client or helper tool. It does not need a search provider, MCP server, API key or Rust executable.

## Use

Example tool arguments:

```json
{
  "url": "https://developer.mozilla.org/en-US/docs/Web/API/AbortController",
  "section": "Examples",
  "version_context": "the version used by my project"
}
```

`section` is optional: an exact HTML heading ID (case-sensitive), otherwise a case-insensitive exact heading title. A URL fragment supplies the selector when `section` is absent. Markdown ATX headings are supported; headings inside fenced code do not create section boundaries. Setext headings and arbitrary CSS selectors are not implemented. A missing selector returns an explicit partial result with no substitute excerpt. Repeated titles can be disambiguated by an actual heading ID.

`version_context` is only the caller's requested/project version. The reader returns `document_version: "unknown"`; the agent must inspect actual source evidence before asserting version compatibility. Retrieval time in UTC is not publication time.

The JSON text result includes source ID, requested/final URL, retrieval time, content type, title, section selection, partial/truncated state and an excerpt. Cite the observed URL and section. HTML text is normalized, not raw page markup. No links, scripts, styles, images or embedded resources are loaded. A page requiring JavaScript/login can yield little or no useful text, not a fabricated answer.

## Installation and loading

The user approved local `htmlparser2` and its normal transitive dependencies. It is pinned to `12.0.0`; `package-lock.json` fixes the resolved dependency tree and integrity values. Runtime dependencies retain their distributed MIT/BSD license notices in `node_modules`. No third-party source is vendored.

When preparing this checkout under an installation authorization:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

The root manifest declares this fourth extension; declaration alone is not profile activation. The user separately authorized a Windows development junction, now created and checked:

```text
C:\Users\lmasapanta\.stela-shell\extensions\stela-web
  -> C:\Users\lmasapanta\Documents\Proyectos\StelaShell\extensions\web
```

No settings were edited or Pi reload invoked. Run `/reload` or restart Pi to discover the new link, then manually test `stela_read_url`. Linked registration and HTML worker/dependency resolution passed without fetching a page. This link is local to this machine, not transferred by Git.

For another profile without this link or another package route, an explicitly requested one-invocation development load can instead use:

```sh
pi -e ./extensions/web/index.ts
```

Do not combine that with another loading route for the same extension. On another machine, profile link creation needs its own authorization; `/reload` alone will not add an unconfigured module. This extension never installs dependencies or accesses the network during registration/startup.

## Limits and safety boundary

| Boundary | Behavior |
| --- | --- |
| Network | HTTPS, port 443, one URL per call; public destinations only under a conservative IPv4/IPv6 policy. |
| DNS/TLS | Scoped cancellable DNS; reject mixed private/public answers; pin a validated numeric address. Preserve original hostname for SNI, Host and normal TLS certificate/hostname checks. Verify connected peer before giving the socket to HTTP. |
| Redirects | At most two followed redirects (three HTTP responses); validate each destination, reject loops/downgrades/recognized credentials. Never forward credentials or cookies. |
| Proxy/insecure TLS | Fail closed when proxy variables or insecure TLS settings are detected. No direct-network fallback around that configuration. No proxy implementation is supplied. |
| Body | Separate 2 MiB encoded and decoded streaming caps. gzip/deflate/Brotli supported. Oversized or malformed/incomplete bodies fail rather than supplying a misleading excerpt. |
| Content | HTML/XHTML, plain text and Markdown. Charset decoding must succeed. PDF, JSON/binary media and missing content types are rejected. HTML mode is forgiving extraction, not full HTML5/browser rendering. |
| Output | At most 16 KiB UTF-8 for the complete JSON text payload, including metadata and JSON escaping; visible `truncated` flag. No full-page file/cache is written. This is not a model-token or total-session cap. |
| Lifecycle | 20-second total deadline across DNS/network/decoding/extraction; two active calls, no queue; no added retries, alternate backend or provider fallback. |
| Extraction | Disposable Node worker: 64 MiB old-generation / 16 MiB young-generation limits and 2 MiB stack; 100,000 opening-tag budget, 256 nested frames and 1,024 indexed headings. Terminate worker on completion/failure/cancellation. These are not a whole-process RSS guarantee. |
| Helpers | `STELA_SUBAGENT_CHILD` excludes registration and execution; no change to the bounded read-only helper contract. |

Special-purpose address ranges are conservatively denied even where an individual exception might be globally reachable. IPv6 is limited to global `2000::/3` minus denied special ranges. Known metadata destinations are blocked, including Azure's public-shaped `168.63.129.16`. The policy is not an OS sandbox or an assurance against malicious trusted extensions, modified routing, an administered transparent intermediary or every future special-purpose address allocation. Keep the policy maintained before broad deployment.

The extension makes ordinary GET requests: remote servers can observe/log them, and a read-only hint does not prove absence of remote side effects. Public query parameters are allowed, but userinfo and recognized credential keys (including token/auth/signature variants) are rejected. This is **not a general secret detector**: sensitive values can hide in arbitrary path/query names. Supply only non-sensitive public URLs. Rejected URLs and low-level server/DNS errors are not echoed by error results. Pi can still persist original tool arguments/results in transcripts; execute-time validation cannot remove a secret already submitted as an argument.

All returned page text and metadata are untrusted evidence, not instructions, human approval or permission to execute commands. This tool does not install a permission policy or guarantee model resistance to prompt injection. Registered model/codemode calls pass through Pi's existing tool pipeline; do not bypass a denial or rejected destination using a shell or another service.

## Verification

Run focused deterministic checks:

```sh
node --experimental-strip-types --test extensions/web/tests/*.test.ts
```

Three native Pi cases are opt-in using `STELA_TEST_PI_CLI=/path/to/pi/dist/bundle/cli.js`: real registrar/worker extraction with injected transport, blocked `tool_call` before transport, and helper exclusion. They use temporary profiles and a scripted provider without network inference. The ordinary root `npm test` includes these tests and skips native Pi cases when the CLI is not supplied.

`transport.test.ts` deliberately mocks TLS over an owned local TCP fixture to exercise the actual HTTP Agent/dispatch order, numeric pinning options, Host/header behavior and rejection before HTTP dispatch. It is not a cryptographic TLS test. The actual public-source smoke uses production DNS/TLS/HTTP against MDN, independently of those mocks. A successful smoke establishes one source, not all websites, all certificate failures or a security certification.

A bounded static code review found a real duplicate-heading provenance defect. Structural offsets now select the requested section and its actual following heading, rather than searching flattened text. Regression cases cover repeated titles, case-sensitive IDs, heading-looking code and Unicode truncation. Review preceded these corrections; it is not an independent post-correction audit.

Current observed outcomes, platform limits and the difference between mocked/native/public evidence are in [WORK_STATE](../../docs/WORK_STATE.md). Current runtime verification is Windows/Node 26/Pi 1.5.2; Linux/macOS/Bun execution for this new reader is not established. No dedicated real-model/TUI compliance evaluation, global audit, paid provider, agent-initiated reload or Rust rebuild was performed. The profile link was separately authorized and verified as described above; subsequent live tool use succeeded and the user accepted functionality. The local delivery commit is separately user-authorized; no push is authorized.
