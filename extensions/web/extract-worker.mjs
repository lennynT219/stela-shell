// Adapted selectively from pi-web-access@0.47.0 extract.ts (MIT, Nico Bailon):
// readTextResponseWithLimit charset detection, extractViaHttp's LinkeDOM/Readability
// pipeline, and loadTurndown's ATX/fenced options. See THIRD_PARTY_NOTICES.md.
// Local changes: fatal decoding, bounded input/DOM/output, no fallback extractors,
// URL sanitization and explicit insufficient-content state. No network or scripts.
import { parentPort, workerData } from 'node:worker_threads';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_TEXT = 32 * 1024;
const MAX_TITLE = 1024;
const MAX_NODES = 12000;
const MAX_DEPTH = 96;
const MIN_USEFUL = 200; // Conservative heuristic, not a completeness guarantee.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function fail(code) { throw Object.assign(new Error(code), { code }); }
function clip(value, bytes) {
  const buffer = Buffer.from(value);
  if (buffer.length <= bytes) return { value, truncated: false };
  let end = bytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return { value: buffer.subarray(0, end).toString('utf8'), truncated: true };
}
function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
function decode(body, contentType) {
  let charset;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) charset = 'utf-8';
  else if (body[0] === 0xff && body[1] === 0xfe) charset = 'utf-16le';
  else if (body[0] === 0xfe && body[1] === 0xff) charset = 'utf-16be';
  else {
    const declared = contentType.match(/\bcharset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i);
    if (declared) charset = declared[1] ?? declared[2] ?? declared[3];
    else {
      const prefix = Buffer.from(body.subarray(0, 1024)).toString('latin1');
      // Only a meta tag may declare the fallback encoding (not page prose).
      const metas = prefix.match(/<meta\b[^>]*>/gi) ?? [];
      for (const meta of metas) {
        const match = meta.match(/\bcharset\s*=\s*["']?([^\s"';/>]+)/i);
        if (match) { charset = match[1]; break; }
      }
    }
  }
  try {
    if (charset !== undefined && !charset.trim()) fail('UNSUPPORTED_CHARSET');
    return new TextDecoder(charset ?? 'utf-8', { fatal: true }).decode(body);
  } catch { fail('UNSUPPORTED_CHARSET'); }
}
function checkMarkup(html) {
  // Conservative preflight, NOT an HTML parser. Bounds even malformed tag-heavy
  // input before allocating a DOM. Some unusual/invalid documents may be rejected.
  let count = 0, depth = 0, offset = 0;
  while (true) {
    const start = html.indexOf('<', offset);
    if (start < 0) break;
    if (++count > MAX_NODES) fail('HTML_COMPLEXITY_LIMIT');
    const end = html.indexOf('>', start + 1);
    if (end < 0) break;
    const tag = html.slice(start, Math.min(end + 1, start + 128));
    const match = /^<(\/?)([a-z][\w:-]*)\b/i.exec(tag);
    if (match) {
      if (match[1]) depth = Math.max(0, depth - 1);
      else if (!VOID.has(match[2].toLowerCase()) && html[end - 1] !== '/') {
        if (++depth > MAX_DEPTH) fail('HTML_COMPLEXITY_LIMIT');
      }
    }
    offset = end + 1;
  }
}
function checkTree(document) {
  const queue = [[document, 0]];
  let count = 0;
  while (queue.length) {
    const [node, depth] = queue.pop();
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail('HTML_COMPLEXITY_LIMIT');
    for (let child = node.firstChild; child; child = child.nextSibling) queue.push([child, depth + 1]);
  }
}
function safeURL(value, base) {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function prepare(document, url) {
  for (const node of document.querySelectorAll('script,style,noscript,template,iframe,object,embed,svg,math,form,input,button,select,textarea,base,nav,header,footer,[role="navigation"]')) node.remove();
  for (const node of document.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || ['style', 'srcset', 'srcdoc', 'xlink:href', 'action', 'formaction'].includes(name)) node.removeAttribute(attr.name);
    }
    for (const attr of ['href', 'src', 'poster']) {
      if (!node.hasAttribute(attr)) continue;
      const resolved = safeURL(node.getAttribute(attr), url);
      if (resolved) node.setAttribute(attr, resolved);
      else node.removeAttribute(attr);
    }
  }
}
async function extract(data) {
  if (!data || !(data.body instanceof Uint8Array) || typeof data.contentType !== 'string' || typeof data.url !== 'string') fail('INVALID_INPUT');
  if (data.body.byteLength > MAX_BODY) fail('BODY_TOO_LARGE');
  if (!safeURL(data.url, data.url)) fail('INVALID_URL');
  const html = decode(data.body, data.contentType);
  checkMarkup(html);
  const [{ parseHTML }, { Readability }, { default: TurndownService }] = await Promise.all([
    import('linkedom'), import('@mozilla/readability'), import('turndown'),
  ]);
  const { document } = parseHTML(html);
  checkTree(document);
  const originalTitle = document.title?.trim() ?? '';
  prepare(document, data.url);
  const article = new Readability(document, { maxElemsToParse: MAX_NODES, charThreshold: MIN_USEFUL, keepClasses: true }).parse();
  const title = clip(clean(article?.title || originalTitle), MAX_TITLE);
  if (!article || typeof article.content !== 'string') {
    return { ok: true, title: title.value, text: '', method: 'readability+turndown', truncated: title.truncated, insufficient: true };
  }
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  // Readability returns a string; convert that string with the library, not a
  // hand-written Markdown engine. All URLs were normalized before extraction.
  const markdown = clean(converter.turndown(article.content)).trim();
  const visible = clean(article.textContent).replace(/\s+/g, ' ').trim();
  const text = clip(markdown, MAX_TEXT);
  return {
    ok: true, title: title.value, text: text.value, method: 'readability+turndown',
    truncated: title.truncated || text.truncated,
    insufficient: visible.length < MIN_USEFUL || markdown.length < MIN_USEFUL,
  };
}

try {
  const result = await extract(workerData);
  parentPort?.postMessage(result);
} catch (error) {
  const allowed = new Set(['INVALID_INPUT', 'INVALID_URL', 'BODY_TOO_LARGE', 'UNSUPPORTED_CHARSET', 'HTML_COMPLEXITY_LIMIT']);
  parentPort?.postMessage({ ok: false, code: allowed.has(error?.code) ? error.code : 'EXTRACTION_FAILED' });
} finally {
  parentPort?.close();
}
