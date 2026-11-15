// Selected, reworked public-address/pinned-TLS utilities from stela-shell bdcfdc6.
// New shared search/read transport: no ambient auth, proxy, fallback or automatic retry.
import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, request as httpsRequest } from "node:https";
import { checkServerIdentity, connect as connectTLS, type TLSSocket } from "node:tls";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import type { IncomingMessage } from "node:http";

export const MAX_BODY = 2 * 1024 * 1024;
export const MAX_URL = 2048;
export class WebError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = "WebError"; this.code = code; }
}
export const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new WebError("CANCELLED"); };
const credentialKey = /token|secret|password|passwd|authorization|credential|signature|api.?key|^auth$|^bearer$|^jwt$|^sid$|^key$|^sig$|^code$|^session|^x-amz-|^x-goog-/i;
export function obviousCredential(value: string): boolean {
  return /(?:\bBearer\s+[\w.+\/-]{8,}|\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,})|(?:api[_-]?key|access[_-]?token|password|authorization)\s*[:=]\s*\S+)/i.test(value);
}

// Conservative special-use deny policy, not a complete reachability/security oracle.
const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0",8], ["10.0.0.0",8], ["100.64.0.0",10], ["127.0.0.0",8],
  ["169.254.0.0",16], ["172.16.0.0",12], ["192.0.0.0",24], ["192.0.2.0",24],
  ["192.31.196.0",24], ["192.52.193.0",24], ["192.88.99.0",24], ["192.168.0.0",16],
  ["192.175.48.0",24], ["198.18.0.0",15], ["198.51.100.0",24], ["203.0.113.0",24],
  ["224.0.0.0",4], ["240.0.0.0",4], ["168.63.129.16",32],
] as const) denied.addSubnet(address, prefix, "ipv4");
const global6 = new BlockList(); global6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::",23], ["2001:db8::",32], ["2002::",16], ["3fff::",20],
] as const) denied.addSubnet(address, prefix, "ipv6");
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  if (family === 6) return global6.check(address, "ipv6") && !denied.check(address, "ipv6");
  return false;
}
export function safeURL(value: string): URL {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_URL || /[\x00-\x20\x7f\\]/.test(value))
    throw new WebError("INVALID_URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new WebError("INVALID_URL"); }
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password)
    throw new WebError("UNSAFE_URL");
  if (Buffer.byteLength(url.href) > MAX_URL) throw new WebError("INVALID_URL");
  // Rejected URLs/redirects and low-level diagnostics must never be echoed in errors.
  if (obviousCredential(value) || [...url.searchParams.keys()].some(key => credentialKey.test(key)) ||
      [...new URLSearchParams(url.hash.slice(1)).keys()].some(key => credentialKey.test(key)))
    throw new WebError("CREDENTIAL_URL");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) { if (!isPublicAddress(host)) throw new WebError("PRIVATE_DESTINATION"); }
  else if (!host.includes(".") || /(^|\.)(localhost|local|internal|invalid|test|onion)$|\.home\.arpa$/i.test(host))
    throw new WebError("PRIVATE_DESTINATION");
  return url;
}
export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new WebError("UNSAFE_TLS_ENV");
  if (Object.entries(env).some(([key,value]) => value && (/^(https?|all)_proxy$/i.test(key) || /^global_agent_.*proxy$/i.test(key))) || env.NODE_USE_ENV_PROXY === "1")
    throw new WebError("PROXY_UNSUPPORTED");
}
export async function resolvePublic(host: string, signal: AbortSignal): Promise<string[]> {
  checkAbort(signal);
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new WebError("PRIVATE_DESTINATION");
    return [host];
  }
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const abort = () => resolver.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    checkAbort(signal);
    const addresses: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") addresses.push(...result.value);
      else if (!["ENODATA", "ENOTFOUND"].includes(result.reason?.code)) throw new WebError("DNS_FAILED");
    }
    if (!addresses.length || addresses.length > 32) throw new WebError("DNS_FAILED");
    if (addresses.some(address => !isPublicAddress(address))) throw new WebError("PRIVATE_DESTINATION");
    return addresses;
  } finally { signal.removeEventListener("abort", abort); resolver.cancel(); }
}
export interface RequestOptions {
  method?: "GET" | "POST"; body?: Buffer; accept?: string;
  contentTypes?: readonly string[]; redirects?: boolean;
}
export interface Hop { response: IncomingMessage; close(): void }
export type Open = (url: URL, address: string, signal: AbortSignal, options?: RequestOptions) => Promise<Hop>;
export interface Download { body: Buffer; url: URL; contentType: string; redirects: number }
export interface NetworkDependencies { resolve?: typeof resolvePublic; open?: Open }

/** Numeric TCP target pins DNS; original hostname is retained for TLS verification/SNI and Host. */
export const openPinned: Open = async (url, address, signal, options = {}) => {
  checkAbort(signal);
  if (!isPublicAddress(address)) throw new WebError("PRIVATE_DESTINATION");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const agent = new Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} } as any);
  let connecting: TLSSocket | undefined;
  const expected = new BlockList(); expected.addAddress(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  agent.createConnection = (_options: any, callback: any): any => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      if (error) { connecting?.destroy(); callback(error); } else callback(null, connecting);
    };
    connecting = connectTLS({ host: address, port: 443, signal,
      servername: isIP(hostname) ? "" : hostname, rejectUnauthorized: true,
      checkServerIdentity: (_name, cert) => checkServerIdentity(hostname, cert),
    }, () => {
      const remote = connecting?.remoteAddress;
      if (!remote || !isPublicAddress(remote) || !expected.check(remote, isIP(remote) === 4 ? "ipv4" : "ipv6")) finish(new WebError("PEER_MISMATCH"));
      else finish();
    });
    connecting.once("error", () => finish(new WebError(signal.aborted ? "CANCELLED" : "NETWORK_FAILED")));
  };
  return await new Promise<Hop>((resolve, reject) => {
    let response: IncomingMessage | undefined;
    const close = () => { response?.destroy(); req.destroy(); connecting?.destroy(); agent.destroy(); };
    const req = httpsRequest({
      hostname: address, family: isIP(address), port: 443, method: options.method ?? "GET",
      path: url.pathname + url.search, agent, signal,
      servername: isIP(hostname) ? "" : hostname, rejectUnauthorized: true,
      checkServerIdentity: (_name, cert) => checkServerIdentity(hostname, cert), maxHeaderSize: 16 * 1024,
      headers: { Host: url.host, "User-Agent": "stela-shell-web/1",
        Accept: options.accept ?? "text/html, text/plain, text/markdown, application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate, br",
        ...(options.body ? { "Content-Type": "application/json", "Content-Length": String(options.body.length) } : {}),
      },
    }, incoming => {
      response = incoming;
      const remote = incoming.socket.remoteAddress;
      if (!remote || !isPublicAddress(remote) || !expected.check(remote, isIP(remote) === 4 ? "ipv4" : "ipv6")) {
        close(); reject(new WebError("PEER_MISMATCH")); return;
      }
      resolve({ response: incoming, close });
    });
    req.once("error", () => { close(); reject(new WebError(signal.aborted ? "CANCELLED" : "NETWORK_FAILED")); });
    req.end(options.body);
  });
};

/** Independently bound wire and decoded bytes; pipeline destroys every owned stage on abort/failure. */
export async function collect(response: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  const length = response.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new WebError("BODY_TOO_LARGE");
  const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase().trim();
  const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : undefined;
  if (encoding !== "identity" && !decoder) throw new WebError("UNSUPPORTED_ENCODING");
  const limiter = () => {
    let size = 0;
    return new Transform({ transform(chunk, _encoding, done) {
      size += chunk.length; done(size > MAX_BODY ? new WebError("BODY_TOO_LARGE") : null, chunk);
    } });
  };
  const chunks: Buffer[] = [];
  const sink = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  try {
    await pipeline([response, limiter(), ...(decoder ? [decoder] : []), limiter(), sink], { signal });
    checkAbort(signal); return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof WebError) throw error;
    throw new WebError(signal.aborted ? "CANCELLED" : "BODY_FAILED");
  }
}
export async function download(input: URL, signal: AbortSignal, options: RequestOptions = {},
  deps: NetworkDependencies = {}): Promise<Download> {
  let url = input;
  const seen = new Set<string>();
  for (let redirects = 0; ; redirects++) {
    checkAbort(signal); url = safeURL(url.href);
    const key = new URL(url); key.hash = "";
    if (seen.has(key.href)) throw new WebError("REDIRECT_LOOP");
    seen.add(key.href);
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const addresses = await (deps.resolve ?? resolvePublic)(host, signal);
    checkAbort(signal);
    if (!addresses.length || addresses.length > 32 || addresses.some(a => !isPublicAddress(a))) throw new WebError("PRIVATE_DESTINATION");
    const hop = await (deps.open ?? openPinned)(url, addresses[0], signal, options);
    try {
      const status = hop.response.statusCode ?? 0;
      if ([301,302,303,307,308].includes(status)) {
        if (options.redirects === false || options.method === "POST") throw new WebError("REDIRECT_UNSUPPORTED");
        if (redirects >= 2) throw new WebError("REDIRECT_LIMIT");
        const location = hop.response.headers.location;
        if (!location || Buffer.byteLength(location) > MAX_URL) throw new WebError("INVALID_REDIRECT");
        try { url = safeURL(new URL(location, url).href); } catch (error) {
          if (error instanceof WebError) throw error; throw new WebError("INVALID_REDIRECT");
        }
        continue;
      }
      if (status === 429) throw new WebError("RATE_LIMITED");
      if (status < 200 || status >= 300) throw new WebError("HTTP_FAILED");
      const contentType = hop.response.headers["content-type"] ?? "";
      const mime = contentType.split(";", 1)[0].trim().toLowerCase();
      if (contentType.length > 256 || !(options.contentTypes ?? ["text/html","text/plain","text/markdown","text/x-markdown","application/xhtml+xml"]).includes(mime))
        throw new WebError("UNSUPPORTED_CONTENT");
      return { body: await collect(hop.response, signal), url, contentType, redirects };
    } finally { hop.close(); }
  }
}
