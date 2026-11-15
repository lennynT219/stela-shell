import assert from 'node:assert/strict';
import test from 'node:test';
import { search, type SearchInput } from '../search.ts';
import { WebError, type download } from '../network.ts';

const input: SearchInput = { query: 'public documentation', objective: 'Find authoritative public references' };
const stamp = '2026-01-02T03:04:05.000Z';
const signal = () => new AbortController().signal;
const jsonResult = (results: unknown[]) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ results }) }] } });
function fixture(value: unknown, contentType = 'application/json'): typeof download {
  return async () => ({ body: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), url: new URL('https://mcp.exa.ai/mcp?tools=web_search_exa'), contentType, redirects: 0 });
}
function rejectsCode(action: () => Promise<unknown>, code: string) {
  return assert.rejects(action, error => error instanceof WebError && (error as WebError & { code: string }).code === code);
}

test('search sends exactly one fixed keyless MCP request including explicit objective', async () => {
  let calls = 0;
  const mock: typeof download = async (url, requestSignal, options) => {
    calls++;
    assert.equal(url.href, 'https://mcp.exa.ai/mcp?tools=web_search_exa');
    assert.equal(requestSignal, currentSignal);
    assert.deepEqual(options, {
      method: 'POST', body: options!.body,
      accept: 'application/json, text/event-stream',
      contentTypes: ['application/json', 'text/event-stream'], redirects: false,
    });
    assert.deepEqual(JSON.parse(options!.body!.toString()), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'web_search_exa', arguments: { ...input, numResults: 5 } },
    });
    return fixture(jsonResult([{ title: 'Reference', url: 'https://example.com/docs', text: 'Useful evidence' }]))(url, requestSignal, options);
  };
  const currentSignal = signal();
  assert.deepEqual(await search(input, currentSignal, { download: mock, now: () => stamp }), {
    provider: 'exa', retrieved_at: stamp,
    results: [{ title: 'Reference', url: 'https://example.com/docs', snippet: 'Useful evidence' }],
    truncated: false, warnings: [],
  });
  assert.equal(calls, 1); // No result-page fetches, discovery, or retries.
});

test('strict inputs reject absent/blank/nonstring/oversized/extra and invalid limits before I/O', async () => {
  const invalid: unknown[] = [null, [], {}, { ...input, query: ' ' }, { ...input, objective: '' },
    { ...input, query: 3 }, { ...input, objective: false }, { ...input, query: 'a'.repeat(4097) },
    { ...input, objective: '😀'.repeat(1025) }, { ...input, query: 'bad\u0000input' }, { ...input, apiKey: 'x' },
    ...[0, -1, 11, 1.5, '5', NaN, null].map(limit => ({ ...input, limit }))];
  for (const item of invalid) {
    await rejectsCode(() => search(item as SearchInput, signal(), { download: async () => { assert.fail('Unexpected I/O'); } }), 'INVALID_INPUT');
  }
});

test('provider result expansion has a finite structural budget before normalization', async () => {
  await rejectsCode(() => search(input, signal(), { download: fixture(jsonResult(Array(150000).fill(null))) }), 'PROVIDER_PROTOCOL');
});

test('obvious credentials in either public-search field are rejected without echo', async () => {
  for (const value of ['api_key=private-value', 'Bearer abc.def.ghi', 'password: hidden', 'https://user:pass@example.com', '-----BEGIN PRIVATE KEY-----', `sk-${'x'.repeat(24)}`]) {
    for (const field of ['query', 'objective']) {
      await rejectsCode(() => search({ ...input, [field]: value }, signal(), { download: async () => { assert.fail('Unexpected I/O'); } }), 'CREDENTIAL_INPUT');
    }
  }
});

test('4096 UTF-8 byte inputs and limit 10 are accepted', async () => {
  const result = await search({ query: '😀'.repeat(1024), objective: 'a'.repeat(4096), limit: 10 }, signal(), { download: fixture(jsonResult([])) });
  assert.deepEqual(result.results, []);
  assert.equal(result.truncated, false);
});

test('proper multiline SSE and notifications are parsed per frame', async () => {
  const body = ': keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":1,"result":{"content":[{"type":"text","text":"{\\"results\\":[]}"}]}}\r\n\r\n';
  const result = await search(input, signal(), { download: fixture(body, 'text/event-stream; charset=utf-8') });
  assert.deepEqual(result.results, []);
});

test('Title/URL/Text and Highlights blocks normalize without treating text metadata as headers', async () => {
  const text = 'Title: First\nPublished: 2026-01-01\nURL: https://example.com/one\nText: evidence\nAuthor: untrusted page text\n---\n\nTitle: Second\nURL: https://example.com/two\nHighlights:\nsecond evidence';
  const result = await search(input, signal(), { download: fixture({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }) });
  assert.deepEqual(result.results, [
    { title: 'First', url: 'https://example.com/one', snippet: 'evidence Author: untrusted page text' },
    { title: 'Second', url: 'https://example.com/two', snippet: 'second evidence' },
  ]);
});

test('unsafe, oversized, malformed, and duplicate result URLs are filtered without DNS or URL clipping', async () => {
  const bad = ['http://example.com/', 'https://127.0.0.1/', 'https://localhost/', 'https://192.168.1.1/', 'https://[::1]/', 'https://user:pass@example.com/', 'https://example.com:444/', 'not a URL', `https://example.com/${'x'.repeat(4096)}`];
  const result = await search(input, signal(), { download: fixture(jsonResult([
    ...bad.map(url => ({ url })), null, { url: 1 },
    { url: 'https://example.com/valid', title: 'Good' }, { url: 'https://example.com/valid' },
  ])) });
  assert.deepEqual(result.results, [{ title: 'Good', url: 'https://example.com/valid', snippet: '' }]);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.warnings, ['RESULTS_FILTERED']);
});

test('result counts and UTF-8 text are bounded, with attribution preserved', async () => {
  const url = `https://example.com/${'path'.repeat(200)}`;
  const result = await search({ ...input, limit: 1 }, signal(), { download: fixture(jsonResult([
    { title: '😀'.repeat(100), url, text: '😀'.repeat(500) }, { url: 'https://example.org/' },
  ])) });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, url);
  assert.equal(result.results[0].title, '😀'.repeat(64));
  assert.equal(result.results[0].snippet, '😀'.repeat(250));
  assert.equal(result.truncated, true);
  assert.deepEqual(result.warnings, ['TEXT_TRUNCATED', 'RESULT_LIMIT']);
});

test('JSON highlights and title fallback normalize only approved fields', async () => {
  const result = await search(input, signal(), { download: fixture(jsonResult([{ url: 'https://example.com', highlights: ['one', 42, 'two'], secretProviderField: 'never return' }])) });
  assert.deepEqual(result.results, [{ title: 'example.com', url: 'https://example.com/', snippet: 'one two' }]);
});

test('strict JSON-RPC framing rejects corrupt, missing, mismatched, duplicated, and ambiguous answers', async () => {
  const bad: unknown[] = ['', '{oops', [], { id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} },
    { jsonrpc: '2.0', id: '1', result: {} }, { jsonrpc: '2.0', id: 1 },
    { jsonrpc: '2.0', id: 1, result: {}, error: {} },
    { jsonrpc: '2.0', method: 'notification' },
    { jsonrpc: '2.0', id: 1, error: { code: 'bad', message: 'secret' } },
    { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'raw private provider dump' }] } },
    { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{broken' }] } },
    { jsonrpc: '2.0', id: 1, result: { content: [] } },
    { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'image', data: 'x' }] } },
  ];
  for (const value of bad) await rejectsCode(() => search(input, signal(), { download: fixture(value) }), 'PROVIDER_PROTOCOL');
  const answer = JSON.stringify(jsonResult([]));
  for (const body of [`data: ${answer}`, `data: ${answer}\n\ndata: ${answer}\n\n`, 'data: [DONE]\n\n']) {
    await rejectsCode(() => search(input, signal(), { download: fixture(body, 'text/event-stream') }), 'PROVIDER_PROTOCOL');
  }
  await rejectsCode(() => search(input, signal(), { download: fixture(answer, 'text/plain') }), 'PROVIDER_PROTOCOL');
});

test('provider error and HTTP-200 meta rate limit become stable errors, never raw dumps', async () => {
  const cases: Array<[unknown, string]> = [
    [{ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'private raw dump' } }, 'RATE_LIMITED'],
    [{ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'private raw dump' } }, 'PROVIDER_FAILED'],
    [{ jsonrpc: '2.0', id: 1, result: { _meta: { 'ai.exa/rateLimited': true } } }, 'RATE_LIMITED'],
    [{ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'private raw dump' }] } }, 'PROVIDER_FAILED'],
  ];
  for (const [value, code] of cases) {
    await rejectsCode(() => search(input, signal(), { download: fixture(value) }), code);
  }
});

test('transport failures propagate safe codes or redact unknown errors, with no retry', async () => {
  let calls = 0;
  await rejectsCode(() => search(input, signal(), { download: async () => { calls++; throw new Error('private raw dump'); } }), 'PROVIDER_FAILED');
  assert.equal(calls, 1);
  await rejectsCode(() => search(input, signal(), { download: async () => { throw new WebError('RATE_LIMITED'); } }), 'RATE_LIMITED');
});

test('cancellation is checked before and after owned download', async () => {
  const early = new AbortController();
  early.abort();
  await assert.rejects(() => search(input, early.signal, { download: async () => { assert.fail('Unexpected I/O'); } }));
  const late = new AbortController();
  await assert.rejects(() => search(input, late.signal, { download: async (url, requestSignal, options) => {
    late.abort();
    return fixture(jsonResult([]))(url, requestSignal, options);
  } }));
});
