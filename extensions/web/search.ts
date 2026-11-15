/**
 * Narrow adaptation of callExaMcp / parseMcpResults in pi-web-access@0.47.0,
 * Copyright (c) 2025 Nico Bailon, MIT (see THIRD_PARTY_NOTICES.md).
 * Local changes: fixed keyless endpoint, explicit objective, strict framing,
 * bounded normalized output, safe transport injection, no discovery/fallback.
 */
import { WebError, download, safeURL, checkAbort } from './network.ts';

export interface SearchInput { query: string; objective: string; limit?: number }
export interface SearchData {
  provider: 'exa';
  retrieved_at: string;
  results: Array<{ title: string; url: string; snippet: string }>;
  truncated: boolean;
  warnings: string[];
}

const ENDPOINT = 'https://mcp.exa.ai/mcp?tools=web_search_exa';
const INPUT_BYTES = 4096;
const TITLE_BYTES = 256;
const SNIPPET_BYTES = 1000;
const URL_BYTES = 4096;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const protocol = (): never => { throw new WebError('PROVIDER_PROTOCOL'); };

function credential(value: string): boolean {
  return /\b(?:bearer\s+[\w.\-]+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*\S+)|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})|https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(value);
}

function inputText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > INPUT_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new WebError('INVALID_INPUT');
  }
  if (credential(value)) throw new WebError('CREDENTIAL_INPUT');
  return value.trim();
}

function clip(value: string, max: number): { value: string; clipped: boolean } {
  if (Buffer.byteLength(value) <= max) return { value, clipped: false };
  let result = '';
  let bytes = 0;
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > max) break;
    result += char;
  }
  return { value: result, clipped: true };
}

function parseJSON(value: string): unknown {
  try { return JSON.parse(value); } catch { return protocol(); }
}

/** SSE data fields are joined per event, never parsed as independent lines. */
function rpcResponse(body: string, contentType: string): RecordValue {
  let messages: unknown[];
  if (contentType.split(';', 1)[0].trim().toLowerCase() === 'text/event-stream') {
    const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const frames = normalized.split('\n\n');
    // A data event must be terminated by an empty line, including the last one.
    const tail = frames.pop()!;
    if (tail.split('\n').some(line => line && !line.startsWith(':'))) protocol();
    messages = [];
    for (const frame of frames) {
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
      }
      if (data.length) messages.push(parseJSON(data.join('\n')));
    }
  } else if (contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json') {
    messages = [parseJSON(body)];
  } else return protocol();

  let response: RecordValue | undefined;
  for (const message of messages) {
    if (!record(message) || message.jsonrpc !== '2.0') protocol();
    if (!Object.hasOwn(message, 'id')) {
      if (typeof message.method !== 'string' || Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) protocol();
      continue; // Framed MCP notifications, not answers to this request.
    }
    if (message.id !== 1 || response || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) protocol();
    response = message;
  }
  if (!response) return protocol();
  return response;
}

function resultItems(text: string): unknown[] {
  const clean = text.trim();
  if (clean.startsWith('{') || clean.startsWith('[')) {
    const value = parseJSON(clean);
    if (record(value) && Array.isArray(value.results)) return value.results;
    return protocol();
  }
  if (/^No (?:search )?results(?: found)?\.?$/i.test(clean)) return [];
  const blocks = clean.split(/(?=^Title:[ \t])/m).filter(block => block.trim());
  if (!blocks.length || !blocks.every(block => /^Title:[ \t]/.test(block))) return protocol();
  return blocks.map(block => {
    const contentStart = block.search(/^Text:|^Highlights:/m);
    const header = contentStart < 0 ? block : block.slice(0, contentStart);
    const title = header.match(/^Title:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
    const url = header.match(/^URL:[ \t]*(.*)$/m)?.[1]?.trim() ?? '';
    const text = contentStart < 0 ? '' : block.slice(contentStart).replace(/^(?:Text|Highlights):[ \t]*\n?/, '').replace(/\n---\s*$/, '').trim();
    return { title, url, text };
  });
}

function contentItems(response: RecordValue): unknown[] {
  if (Object.hasOwn(response, 'error')) {
    if (!record(response.error) || !Number.isInteger(response.error.code) || typeof response.error.message !== 'string') protocol();
    throw new WebError(response.error.code === 429 || response.error.code === -32029 ? 'RATE_LIMITED' : 'PROVIDER_FAILED');
  }
  const result = response.result;
  if (!record(result)) return protocol();
  if (record(result._meta) && result._meta['ai.exa/rateLimited'] === true) throw new WebError('RATE_LIMITED');
  if (result.isError === true) throw new WebError('PROVIDER_FAILED');
  if (result.isError !== undefined && typeof result.isError !== 'boolean') protocol();
  if (!Array.isArray(result.content) || !result.content.length) return protocol();
  const items: unknown[] = [];
  for (const part of result.content) {
    if (!record(part) || part.type !== 'text' || typeof part.text !== 'string' || !part.text.trim()) return protocol();
    const parsed = resultItems(part.text);
    // Bound structural expansion before spread/normalization, not only response bytes.
    if (parsed.length > 1024 - items.length) return protocol();
    items.push(...parsed);
  }
  return items;
}

export async function search(
  input: SearchInput,
  signal: AbortSignal,
  deps: { download?: typeof download; now?: () => string } = {},
): Promise<SearchData> {
  checkAbort(signal);
  if (!record(input) || Object.keys(input).some(key => !['query', 'objective', 'limit'].includes(key))) throw new WebError('INVALID_INPUT');
  const query = inputText(input.query);
  const objective = inputText(input.objective);
  const limit = input.limit === undefined ? 5 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new WebError('INVALID_INPUT');
  const body = Buffer.from(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'web_search_exa', arguments: { query, objective, numResults: limit } },
  }));
  let response;
  try {
    response = await (deps.download ?? download)(new URL(ENDPOINT), signal, {
      method: 'POST', body, accept: 'application/json, text/event-stream',
      contentTypes: ['application/json', 'text/event-stream'], redirects: false,
    });
  } catch (error) {
    checkAbort(signal);
    if (error instanceof WebError) throw error;
    throw new WebError('PROVIDER_FAILED');
  }
  checkAbort(signal);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(response.body); } catch { return protocol(); }
  const items = contentItems(rpcResponse(text, response.contentType));
  const results: SearchData['results'] = [];
  const warnings = new Set<string>();
  const seen = new Set<string>();
  let truncated = false;
  for (const item of items) {
    checkAbort(signal);
    let url: URL;
    try {
      if (!record(item) || typeof item.url !== 'string' || Buffer.byteLength(item.url) > URL_BYTES) throw new Error();
      url = safeURL(item.url); // Syntactic public-HTTPS policy only; never DNS-probe results.
    } catch {
      warnings.add('RESULTS_FILTERED');
      truncated = true;
      continue;
    }
    if (seen.has(url.href)) { warnings.add('RESULTS_FILTERED'); truncated = true; continue; }
    seen.add(url.href);
    if (results.length >= limit) { warnings.add('RESULT_LIMIT'); truncated = true; continue; }
    // item was checked before URL validation; never forward arbitrary provider fields.
    const row = item as RecordValue;
    const title = clip(typeof row.title === 'string' && row.title.trim() ? row.title.trim() : url.hostname, TITLE_BYTES);
    const highlights = Array.isArray(row.highlights) ? row.highlights.filter((value): value is string => typeof value === 'string').join(' ') : '';
    const source = typeof row.snippet === 'string' ? row.snippet : highlights || (typeof row.text === 'string' ? row.text : '');
    const snippet = clip(source.replace(/\s+/g, ' ').trim(), SNIPPET_BYTES);
    if (title.clipped || snippet.clipped) { warnings.add('TEXT_TRUNCATED'); truncated = true; }
    results.push({ title: title.value, url: url.href, snippet: snippet.value });
  }
  return { provider: 'exa', retrieved_at: (deps.now ?? (() => new Date().toISOString()))(), results, truncated, warnings: [...warnings] };
}
