import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

type Result = { ok: boolean; title?: string; text?: string; method?: string; truncated?: boolean; insufficient?: boolean; code?: string };
const workerURL = new URL('../extract-worker.mjs', import.meta.url);
const paragraph = 'This reference explains how to configure a reliable documentation service. Each option has a clear purpose, and the examples describe the expected behaviour without requiring a browser or executing scripts. ';
function page(content: string, head = '') {
  return `<!doctype html><html><head><title>Reference guide</title>${head}</head><body><article><h1>Reference guide</h1>${content}</article></body></html>`;
}
function article(extra = '') {
  return page(`<p>${paragraph.repeat(4)}</p>${extra}<p>${paragraph.repeat(3)}</p>`);
}
function run(body: string | Uint8Array, contentType = 'text/html; charset=utf-8', url = 'https://example.com/docs/start'): Promise<Result> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerURL, {
      workerData: { body: typeof body === 'string' ? new TextEncoder().encode(body) : body, contentType, url },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
    });
    const messages: Result[] = [];
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Extraction worker deadline')); }, 15000);
    worker.on('message', (result) => messages.push(result));
    worker.on('error', reject);
    worker.on('exit', (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0);
        assert.equal(messages.length, 1, 'exactly one result and clean exit');
        resolve(messages[0]);
      } catch (error) { reject(error); }
    });
  });
}

test('real worker extracts an article with ATX headings, links and fenced code', async () => {
  const result = await run(article('<h2>Installation</h2><p>Read the <a href="../guide">guide</a>.</p><pre><code class="language-js">const answer = 42;\nconsole.log(answer);</code></pre>'));
  assert.equal(result.ok, true);
  assert.equal(result.method, 'readability+turndown');
  assert.equal(result.insufficient, false);
  assert.equal(result.truncated, false);
  assert.match(result.title!, /Reference guide/);
  assert.match(result.text!, /## Installation/);
  assert.match(result.text!, /\[guide\]\(https:\/\/example\.com\/guide\)/);
  assert.match(result.text!, /```(?:js)?\nconst answer = 42;/);
  assert.doesNotMatch(result.text!, /<article|<script/);
});

test('code-heavy static documentation remains useful without a fallback engine', async () => {
  const commands = Array.from({ length: 20 }, (_, index) => `export function option${index}() { return ${index}; }`).join('\n');
  const result = await run(page(`<p>${paragraph.repeat(2)}</p><h2>API examples</h2><pre><code class="language-typescript">${commands}</code></pre><p>${paragraph}</p>`));
  assert.equal(result.ok, true);
  assert.equal(result.insufficient, false);
  assert.match(result.text!, /```typescript/);
  assert.match(result.text!, /option19/);
});

test('resolves relative links/images against selected URL, ignores base, strips active schemes', async () => {
  const html = article('<p><a href="next">Next page</a> <a href="/root">Root page</a> <a href="javascript:alert(1)">unsafe link</a> <a href="data:text/html,evil">data link</a> <a href="https://user:secret@example.com/">credentials</a></p><img src="../diagram.png" alt="Architecture"><script>throw new Error("must not execute")</script>').replace('<head>', '<head><base href="https://attacker.invalid/">');
  const result = await run(html);
  assert.equal(result.ok, true);
  assert.match(result.text!, /https:\/\/example\.com\/docs\/next/);
  assert.match(result.text!, /https:\/\/example\.com\/root/);
  assert.match(result.text!, /!\[Architecture\]\(https:\/\/example\.com\/diagram\.png\)/);
  assert.doesNotMatch(result.text!, /javascript:|data:text|user:secret|attacker\.invalid|must not execute/);
});

test('title-only, navigation and dynamic placeholders are explicitly insufficient', async () => {
  for (const html of [
    '<html><head><title>Only a title</title></head><body></body></html>',
    `<html><head><title>Menu</title></head><body><nav>${'<a href="/next">Navigation entry</a>'.repeat(100)}</nav></body></html>`,
    '<html><head><title>Application</title></head><body><main>Loading…</main><script>document.body.innerHTML = "secret";</script></body></html>',
  ]) {
    const result = await run(html);
    assert.equal(result.ok, true);
    assert.equal(result.insufficient, true);
    assert.doesNotMatch(result.text!, /document\.body|secret/);
  }
});

test('declared charset, BOM and HTML meta support non-UTF8 without silent replacement', async () => {
  const latin = Buffer.from(article('<p>El café está aquí.</p>'), 'latin1');
  const declared = await run(latin, 'text/html; charset="windows-1252"');
  assert.equal(declared.ok, true);
  assert.match(declared.text!, /café está aquí/);
  const meta = await run(Buffer.from(article('<p>El café está aquí.</p>').replace('<head>', '<head><meta charset="windows-1252">'), 'latin1'), 'text/html');
  assert.equal(meta.ok, true);
  assert.match(meta.text!, /café está aquí/);
  const bom = await run(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(article('<p>Unicode café 世界</p>'), 'utf16le')]), 'text/html; charset=invalid-header');
  assert.equal(bom.ok, true);
  assert.match(bom.text!, /Unicode café 世界/);
});

test('malformed bytes and unsupported or empty charset fail explicitly', async () => {
  for (const [body, type] of [
    [article(), 'text/html; charset=does-not-exist'],
    [article(), 'text/html; charset=""'],
    [new Uint8Array([0xc3, 0x28]), 'text/html; charset=utf-8'],
  ] as const) {
    const result = await run(body, type);
    assert.deepEqual(result, { ok: false, code: 'UNSUPPORTED_CHARSET' });
  }
});

test('Unicode output truncates within the byte budget without broken code points', async () => {
  const result = await run(article(`<p>${'世界🌍 meaningful text '.repeat(3000)}</p>`));
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.insufficient, false);
  assert.ok(Buffer.byteLength(result.text!, 'utf8') <= 32 * 1024);
  assert.ok(Buffer.byteLength(result.title!, 'utf8') <= 1024);
  assert.doesNotMatch(result.text!, /\ufffd/);
  // Decode independently with fatal mode: a clipped output remains valid UTF-8.
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(result.text!)), result.text);
});

test('body and markup complexity limits fail before expensive extraction', async () => {
  assert.deepEqual(await run(new Uint8Array(2 * 1024 * 1024 + 1)), { ok: false, code: 'BODY_TOO_LARGE' });
  assert.deepEqual(await run('<div>'.repeat(120) + 'nested' + '</div>'.repeat(120)), { ok: false, code: 'HTML_COMPLEXITY_LIMIT' });
  assert.deepEqual(await run('<br>'.repeat(12001)), { ok: false, code: 'HTML_COMPLEXITY_LIMIT' });
});
