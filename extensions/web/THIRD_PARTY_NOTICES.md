# Third-party notices

## pi-web-access

Source basis: `pi-web-access@0.47.0` by Nico Bailon, repository `https://github.com/nicobailon/pi-web-access`, registry Git head `322e44fafc1aaa691779cdf2116584e67edd7645`.

Inspected npm archive integrity:

```
sha512-Z176wTJjHw9Y+NpZ3WxOmKnh/7Sy3mu4QR05nBS/v6GRd5Cp7g5GnLIzI9LOT1IdR1105qXFS+L3LBUfkOMy8g==
```

Selected upstream source has been adapted, not imported as a runtime dependency:

- `search.ts`: `callExaMcp`, `parseMcpResults` and narrow JSON-result normalization from upstream `exa.ts`. Local changes include required explicit `objective`, fixed keyless backend, shared pinned transport, strict request-bound JSON/SSE framing, finite structural expansion, bounded source fields and stable redacted errors; no discovery, retries, fallback or implicit page fetch.
- `read.ts` / `extract-worker.mjs`: charset/title handling based on `readTextResponseWithLimit`, the LinkeDOM/Readability part of `extractViaHttp` and `loadTurndown`'s ATX/fenced configuration from `extract.ts`. Local changes include fatal decoding, one bounded Node worker with owned cleanup, complexity/output limits, URL/active-node cleanup, preserved code-language classes and explicit insufficient/fragment states. No optional extraction engines or network/model calls are included in the worker.
- `network.ts` and parser-lifecycle orchestration also selectively rework StelaShell's historical `bdcfdc6` utilities. They are adapted and newly tested, not a restoration of the retired reader/API/profile or an inheritance of its guarantees.

Retain the upstream license below with substantial reused code. No endorsement, full upstream feature coverage, runtime identity or security certification is implied.

### Upstream license (verbatim)

MIT License

Copyright (c) 2025 Nico Bailon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Root dependency license inventory

The user-approved direct dependencies are exactly `linkedom@0.16.11`, `@mozilla/readability@0.6.0` and `turndown@7.2.5`. Installation used the root lockfile with lifecycle scripts disabled. The resolved tree has 17 unique installed packages (three direct plus 14 transitive); no independent web package or duplicate Pi host libraries were installed. Lock/version/license metadata, bundled notice-file presence and `npm ls --all` consistency were checked; this is not a complete security or legal audit, latest-version assertion or publication authorization.

| Component | Resolved version | License | Bundled notice file |
| --- | --- | --- | --- |
| `@mixmark-io/domino` | `2.2.0` | BSD-2-Clause | `node_modules/@mixmark-io/domino/LICENSE` |
| `@mozilla/readability` | `0.6.0` | Apache-2.0 | `node_modules/@mozilla/readability/LICENSE.md` |
| `boolbase` | `1.0.0` | ISC | `node_modules/boolbase/package.json` (metadata only; no standalone license file) |
| `css-select` | `5.2.2` | BSD-2-Clause | `node_modules/css-select/LICENSE` |
| `css-what` | `6.2.2` | BSD-2-Clause | `node_modules/css-what/LICENSE` |
| `cssom` | `0.5.0` | MIT | `node_modules/cssom/LICENSE.txt` |
| `dom-serializer` | `2.0.0` | MIT | `node_modules/dom-serializer/LICENSE` |
| `domelementtype` | `2.3.0` | BSD-2-Clause | `node_modules/domelementtype/LICENSE` |
| `domhandler` | `5.0.3` | BSD-2-Clause | `node_modules/domhandler/LICENSE` |
| `domutils` | `3.2.2` | BSD-2-Clause | `node_modules/domutils/LICENSE` |
| `entities` | `4.5.0` | BSD-2-Clause | `node_modules/entities/LICENSE` |
| `html-escaper` | `3.0.3` | MIT | `node_modules/html-escaper/LICENSE.txt` |
| `htmlparser2` | `9.1.0` | MIT | `node_modules/htmlparser2/LICENSE` |
| `linkedom` | `0.16.11` | ISC | `node_modules/linkedom/LICENSE` |
| `nth-check` | `2.1.1` | BSD-2-Clause | `node_modules/nth-check/LICENSE` |
| `turndown` | `7.2.5` | MIT | `node_modules/turndown/LICENSE` |
| `uhyphen` | `0.2.0` | ISC | `node_modules/uhyphen/LICENSE` |

Direct-library copyright notices include Andrea Giammarchi / @WebReflection (LinkeDOM, ISC), Arc90 Inc (Readability's Apache-2.0 notice), and Dom Christie (Turndown, MIT). Their bundled licenses remain installed unmodified; Readability's notice references the Apache-2.0 terms at https://www.apache.org/licenses/LICENSE-2.0.

`boolbase@1.0.0` declares ISC and Felix Boehm in its original package metadata but ships no standalone license file. That original metadata is retained, not replaced with invented copyright/license text. Confirm its applicable notice/terms before any future redistribution or bundling; this is a known limitation of the inventory, not a completed legal review.

Preserve all applicable dependency notices/terms when distributing substantial reused code or a bundled tree. Ordinary `node_modules` are ignored by Git and restored from the root lock. This inventory identifies attached notice/metadata files, not a separate package publication.
