import { Worker, type WorkerOptions } from "node:worker_threads";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebError, MAX_BODY, checkAbort, download, safeURL } from "./network.ts";

export interface ReadInput { url: string }
export interface Extraction {
  title: string; text: string; method: "readability+turndown";
  truncated: boolean; insufficient: boolean;
}
export interface ReadData {
  status: "ok" | "partial"; requested_url: string; final_url: string; retrieved_at: string;
  title: string; content_type: string; extraction: string; scope: "page"; document_version: "unknown";
  content: string; redirects: number; truncated: boolean; warnings: string[];
}
export interface Dependencies { download?: typeof download; extract?: typeof extract; now?: () => string }
const MAX_TEXT = 32 * 1024;
export const PARSER_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 });
const parserErrors = new Set(["INVALID_INPUT","INVALID_URL","BODY_TOO_LARGE","UNSUPPORTED_CHARSET","HTML_COMPLEXITY_LIMIT","EXTRACTION_FAILED"]);

/** Owned, one-shot HTML parser. Resource limits constrain JS heap/stack, not universal process RSS. */
export async function extract(body: Buffer, contentType: string, url: string, signal: AbortSignal,
  dependencies: { worker?: (path: URL, options: WorkerOptions) => Worker } = {}): Promise<Extraction> {
  checkAbort(signal);
  // Bun 1.4.4 exposes Worker but omits resourceLimits; never silently run unbounded HTML parsing.
  if (process.versions.bun) throw new WebError("UNSUPPORTED_RUNTIME");
  const path = pathToFileURL(realpathSync(fileURLToPath(new URL("./extract-worker.mjs", import.meta.url))));
  const options: WorkerOptions = { workerData: { body, contentType, url }, resourceLimits: { ...PARSER_LIMITS }, execArgv: [] };
  const worker = dependencies.worker ? dependencies.worker(path, options) : new Worker(path, options);
  try {
    for (const [key, limit] of Object.entries(PARSER_LIMITS)) {
      const actual = worker.resourceLimits?.[key as keyof typeof PARSER_LIMITS];
      if (typeof actual !== "number" || actual <= 0 || actual > limit) throw new WebError("UNSUPPORTED_RUNTIME");
    }
    return await new Promise<Extraction>((resolve, reject) => {
      let settled = false;
      const abort = () => finish(new WebError("CANCELLED"));
      const finish = (error?: Error, value?: Extraction) => {
        if (settled) return; settled = true; signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value!);
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.once("message", message => {
        if (message?.ok !== true) { finish(new WebError(parserErrors.has(message?.code) ? message.code : "EXTRACTION_FAILED")); return; }
        if (typeof message.title !== "string" || Buffer.byteLength(message.title) > 1024 ||
            typeof message.text !== "string" || Buffer.byteLength(message.text) > MAX_TEXT ||
            message.method !== "readability+turndown" || typeof message.truncated !== "boolean" || typeof message.insufficient !== "boolean") {
          finish(new WebError("EXTRACTION_FAILED")); return;
        }
        const { title, text, method, truncated, insufficient } = message;
        finish(undefined, { title, text, method, truncated, insufficient });
      });
      worker.once("error", () => finish(new WebError("EXTRACTION_FAILED")));
      worker.once("exit", () => finish(new WebError("EXTRACTION_FAILED")));
      if (signal.aborted) abort();
    });
  } finally { await worker.terminate(); }
}
function clip(text: string, max: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text);
  if (bytes.length <= max) return { text, truncated: false };
  let end = max; while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0,end).toString("utf8"), truncated: true };
}
/** Narrow charset handling adapted from pi-web-access readTextResponseWithLimit; fatal decoding is local. */
function decode(body: Buffer, contentType: string): string {
  let charset: string | undefined;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) charset = "utf-8";
  else if (body[0] === 0xff && body[1] === 0xfe) charset = "utf-16le";
  else if (body[0] === 0xfe && body[1] === 0xff) charset = "utf-16be";
  else {
    const match = contentType.match(/\bcharset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i);
    if (match) charset = match[1] ?? match[2] ?? match[3];
  }
  try {
    if (charset !== undefined && !charset.trim()) throw new Error();
    return new TextDecoder(charset ?? "utf-8", { fatal: true }).decode(body);
  } catch { throw new WebError("UNSUPPORTED_CHARSET"); }
}
export async function read(input: ReadInput, signal: AbortSignal, dependencies: Dependencies = {}): Promise<ReadData> {
  checkAbort(signal);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "url") || typeof input.url !== "string")
    throw new WebError("INVALID_INPUT");
  const requested = safeURL(input.url);
  const page = await (dependencies.download ?? download)(requested, signal);
  checkAbort(signal);
  if (page.body.length > MAX_BODY) throw new WebError("BODY_TOO_LARGE");
  const final = safeURL(page.url.href), mime = page.contentType.split(";",1)[0].trim().toLowerCase();
  let title: string, content: string, extraction: string, truncated: boolean, insufficient: boolean;
  const warnings: string[] = [];
  if (["text/html","application/xhtml+xml"].includes(mime)) {
    const data = await (dependencies.extract ?? extract)(page.body, page.contentType, final.href, signal);
    ({ title, truncated, insufficient } = data); content = data.text; extraction = data.method;
  } else if (["text/plain","text/markdown","text/x-markdown"].includes(mime)) {
    const decoded = decode(page.body, page.contentType).replace(/\r\n?/g,"\n").trim();
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(decoded) || decoded.startsWith("%PDF-")) throw new WebError("UNSUPPORTED_CONTENT");
    const text = clip(decoded,MAX_TEXT), heading = clip(decoded.split("\n").find(line => line.trim())?.replace(/^#{1,6}\s+/,"").trim() ?? "",1024);
    title = heading.text; content = text.text; extraction = mime === "text/plain" ? "plain-text" : "markdown";
    truncated = text.truncated || heading.truncated; insufficient = !decoded;
  } else throw new WebError("UNSUPPORTED_CONTENT");
  checkAbort(signal);
  if (requested.hash || final.hash) warnings.push("FRAGMENT_NOT_RESOLVED: page-level extraction only; no fragment/section resolution was performed.");
  if (insufficient) warnings.push("INSUFFICIENT_CONTENT: a complete readable static article was not established; no browser, authentication or fallback extractor was used.");
  if (truncated) warnings.push("EXTRACTION_TRUNCATED: text/title exceeded the intermediate extraction budget.");
  return {
    status: insufficient || truncated ? "partial" : "ok", requested_url: requested.href, final_url: final.href,
    retrieved_at: (dependencies.now ?? (() => new Date().toISOString()))(), title, content_type: page.contentType,
    extraction, scope: "page", document_version: "unknown", content, redirects: page.redirects, truncated, warnings,
  };
}
