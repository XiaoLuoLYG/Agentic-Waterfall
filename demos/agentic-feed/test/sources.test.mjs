import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSourceConfig, sourceCatalog, acquireSource } from '../sources.mjs';

const config = () => ({ providers: {}, composio: {}, allowed: {} });
const action = (source, mode = 'search', modality = 'text') => ({ source, query: 'nature', mode, modality });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('configuration is server-only and factory capabilities match xuanji', t => {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-sources-')); t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ providers: { ZHIHU_API_KEY: 'private-test-key' }, composio: {}, runtime: { waterfall: { sources: { bilibili: { allowed: false } }, rssFeeds: [] } } }));
  const c = loadSourceConfig(path), catalog = sourceCatalog(c);
  assert.equal(c.providers.ZHIHU_API_KEY, 'private-test-key');
  assert.equal(JSON.stringify(catalog).includes('private-test-key'), false);
  assert.equal(catalog.find(s => s.id === 'zhihu').configured, true);
  assert.equal(catalog.find(s => s.id === 'youtube').configured, false);
  assert.equal(catalog.find(s => s.id === 'bilibili').status, 'disabled');
  assert.deepEqual(catalog.find(s => s.id === 'cnnews').modes, ['explore']);
  assert.deepEqual(catalog.find(s => s.id === 'bilibili').modalities, ['video']);
  assert.equal(catalog.some(s => ['xiaohongshu', 'toutiao', 'gnews'].includes(s.id)), false);
  assert.throws(() => loadSourceConfig(join(dir, 'missing')), /source_config_unreadable/);
});

test('unknown endpoints, disabled sources and invalid modes never fetch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  for (const a of [action('https://127.0.0.1/admin'), action('bilibili', 'explore', 'video'), action('cnnews'), action('github', 'search', 'image'), { ...action('github'), query: '' }]) {
    const result = await acquireSource(a, config()); assert.equal(result.status, 'failed'); assert.deepEqual(result.items, []);
  }
  const c = config(); c.allowed.github = { allowed: false };
  assert.equal((await acquireSource(action('github'), c)).error, 'source_disabled');
  assert.equal((await acquireSource(action('youtube', 'search', 'video'), config())).error, 'source_unconfigured');
  assert.equal(fetch.mock.callCount(), 0);
});

test('GitHub normalization uses stable item identity, strips markup and unsafe URLs', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ items: [
    { id: 7, full_name: 'nature/<b>project</b>', description: '<script>bad()</script>A &amp; B', html_url: 'https://github.com/nature/project', owner: { login: 'nature' }, updated_at: '2026-10-27' },
    { id: 8, full_name: 'Bad link', html_url: 'javascript:alert(1)' },
    { id: 9, full_name: 'Private link', html_url: 'http://127.0.0.1/private' }
  ] }));
  const c = config(), first = await acquireSource(action('github'), c), second = await acquireSource({ ...action('github'), query: 'different retrieval query' }, c);
  assert.equal(first.status, 'ok'); assert.equal(first.items.length, 1);
  assert.equal(first.items[0].summary, 'A & B'); assert.equal(first.items[0].origin, 'live');
  assert.equal(first.items[0].id, second.items[0].id); assert.equal(first.items[0].content_hash, second.items[0].content_hash);
  assert.equal(sourceCatalog(c).find(s => s.id === 'github').last_check.count, 1);
});

test('request refuses redirects and sanitizes network errors', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_, options) => { assert.equal(options.redirect, 'manual'); return new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } }); });
  assert.equal((await acquireSource(action('github'), config())).error, 'http_302'); assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => { throw new Error('https://provider.invalid?api-key=private-test-key'); });
  const result = await acquireSource(action('github'), config());
  assert.equal(result.error, 'source_network_error'); assert.equal(JSON.stringify(result).includes('private-test-key'), false);
});

test('large and non-JSON responses are bounded failures', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)));
  assert.equal((await acquireSource(action('github'), config())).error, 'response_too_large');
  fetch.mock.mockImplementation(async () => new Response('<html>blocked</html>'));
  assert.equal((await acquireSource(action('github'), config())).error, 'invalid_source_json');
});

test('Composio only executes fixed public source tools using an ACTIVE account', async t => {
  const c = config(); c.composio = { apiKey: 'private-test-key', userId: 'test-user', baseUrl: 'https://backend.composio.dev/api/v3.1' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const u = new URL(address); calls.push(u);
    assert.equal(options.headers['x-api-key'], 'private-test-key');
    if (u.pathname.endsWith('/connected_accounts')) return json({ items: [{ id: 'account-test', status: 'ACTIVE', toolkit: { slug: 'reddit' } }] });
    assert.equal(u.pathname, '/api/v3.1/tools/execute/REDDIT_SEARCH_ACROSS_SUBREDDITS');
    assert.equal(JSON.parse(options.body).arguments.search_query, 'nature');
    return json({ successful: true, data: { posts: [{ id: 'abc', title: 'A public post', permalink: 'https://www.reddit.com/r/nature/comments/abc/example/', author: 'public-author' }] } });
  });
  const result = await acquireSource(action('reddit'), c);
  assert.equal(result.status, 'ok'); assert.equal(result.items[0].url, 'https://www.reddit.com/r/nature/comments/abc/example/');
  assert.equal(JSON.stringify(result).includes('private-test-key'), false); assert.equal(calls.length, 2);
});

test('configured Composio URL cannot turn the adapter into an arbitrary HTTP client', async t => {
  const c = config(); c.composio = { apiKey: 'private-test-key', userId: 'test-user', baseUrl: 'https://127.0.0.1/api/v3.1' };
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  assert.equal((await acquireSource(action('reddit'), c)).error, 'composio_endpoint_not_allowed');
  assert.equal(fetch.mock.callCount(), 0);
});

test('provider credit failure is visible without leaking the provider body', async t => {
  const c = config(); c.composio = { apiKey: 'private-test-key', userId: 'test-user', baseUrl: 'https://backend.composio.dev/api/v3.1' };
  t.mock.method(globalThis, 'fetch', async address => new URL(address).pathname.endsWith('/connected_accounts') ? json({ items: [{ id: 'test-account', status: 'ACTIVE', toolkit: { slug: 'twitter' } }] }) : json({ successful: false, error: 'private-test-key API credits depleted', data: { status_code: 402 } }));
  const result = await acquireSource(action('x'), c);
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'provider_http_402'); assert.equal(result.items.length, 0);
  assert.equal(JSON.stringify(result).includes('private-test-key'), false);
});

test('YouTube keeps successful search and failed popular checks separate', async t => {
  const c = config(); c.composio = { apiKey: 'private-test-key', userId: 'test-user', baseUrl: 'https://backend.composio.dev/api/v3.1' };
  t.mock.method(globalThis, 'fetch', async address => {
    const path = new URL(address).pathname;
    if (path.endsWith('/connected_accounts')) return json({ items: [{ id: 'test-account', status: 'ACTIVE', toolkit: { slug: 'youtube' } }] });
    if (path.endsWith('/YOUTUBE_LIST_MOST_POPULAR_VIDEOS')) return json({ successful: false, data: { status_code: 403 }, error: 'Not available' });
    return json({ successful: true, data: { items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Nature', description: 'A public video', thumbnails: { medium: { url: 'http://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } } } }] } });
  });
  const search = await acquireSource(action('youtube', 'search', 'video'), c);
  assert.equal(search.status, 'ok'); assert.ok(search.items[0].image_url.startsWith('https:'));
  assert.equal((await acquireSource(action('youtube', 'explore', 'video'), c)).error, 'provider_http_403');
  const source = sourceCatalog(c).find(s => s.id === 'youtube');
  assert.equal(source.status, 'partial'); assert.equal(source.mode_checks.search.status, 'ok'); assert.equal(source.mode_checks.explore.status, 'failed');
});

test('Bilibili search response carries actual video link, cover and duration', async t => {
  t.mock.method(globalThis, 'fetch', async address => { assert.equal(new URL(address).hostname, 'api.bilibili.com'); return json({ code: 0, data: { result: [{ result_type: 'video', data: [{ bvid: 'BV1234567890', title: '<em>Nature</em>', description: 'A public video', pic: '//i0.hdslb.com/bfs/example.jpg', duration: '03:45', pubdate: 1700000000 }] }] } }); });
  const result = await acquireSource(action('bilibili', 'search', 'video'), config());
  assert.equal(result.status, 'ok'); assert.equal(result.items[0].modality, 'video'); assert.equal(result.items[0].duration, '03:45');
  assert.equal(result.items[0].image_url, 'https://i0.hdslb.com/bfs/example.jpg');
});

test('Bilibili skips malformed video identifiers instead of creating broken links', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ code: 0, data: { result: [{ result_type: 'video', data: [
    { bvid: 'BV123', title: 'bad short id' },
    { bvid: 'BV123456789_', title: 'bad character' },
    { bvid: 'BV14fnQ6jEGZ', title: 'valid video' }
  ] }] } }));
  const result = await acquireSource(action('bilibili', 'search', 'video'), config());
  assert.deepEqual(result.items.map(item => item.url), ['https://www.bilibili.com/video/BV14fnQ6jEGZ']);
});

test('RSS collection parses CDATA, interleaves feeds and preserves partial failures', async t => {
  t.mock.method(globalThis, 'fetch', async address => {
    const u = new URL(address); if (u.hostname === 'www.ifanr.com') return new Response('', { status: 503 });
    return new Response(`<rss><channel><item><guid>${u.hostname}</guid><title><![CDATA[News &amp; science]]></title><link>https://${u.hostname}/article/1</link><description><![CDATA[<p>A useful article</p><img src="https://${u.hostname}/cover.jpg">]]></description></item></channel></rss>`);
  });
  const result = await acquireSource(action('cnnews', 'explore'), config());
  assert.equal(result.status, 'ok'); assert.equal(result.items.length, 3);
  assert.equal(result.items[0].title, 'News & science'); assert.equal(result.items[0].summary, 'A useful article');
  assert.ok(result.items.every(x => x.image_url?.endsWith('/cover.jpg'))); assert.deepEqual(result.warnings, ['http_503']);
});

test('empty provider result is distinguished from request failure', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ items: [] }));
  const result = await acquireSource(action('github'), config());
  assert.equal(result.status, 'empty'); assert.equal(result.error, undefined); assert.deepEqual(result.items, []);
});

test('temporary failures become retryable after five minutes while retaining their last error', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ items: [] }));
  for (const cause of ['network', 'timeout', 429, 503, 402, 403]) {
    const c = config(), temporary = ![402, 403].includes(cause);
    fetch.mock.mockImplementation(async () => {
      if (typeof cause === 'number') return json({}, cause);
      throw Object.assign(new Error('temporary failure'), { name: cause === 'timeout' ? 'TimeoutError' : 'TypeError' });
    });
    const failed = await acquireSource(action('github'), c);
    now += 299999;
    assert.equal(sourceCatalog(c).find(s => s.id === 'github').mode_checks.search.status, 'failed');
    now++;
    const source = sourceCatalog(c).find(s => s.id === 'github');
    assert.equal(source.status, temporary ? 'unverified' : 'failed');
    assert.equal(source.mode_checks.search.status, temporary ? 'unverified' : 'failed');
    assert.equal(source.last_check.status, 'failed'); assert.equal(source.last_check.error, failed.error);
    if (temporary) {
      fetch.mock.mockImplementation(async () => json({ items: [] }));
      await acquireSource(action('github'), c);
      const recovered = sourceCatalog(c).find(s => s.id === 'github');
      assert.equal(recovered.status, 'empty'); assert.equal(recovered.last_check.error, undefined); assert.equal(recovered.mode_checks.search.retry_after, undefined);
    }
  }
});

test('Composio provider 429/5xx recover eligibility but 402/403 remain failed', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}));
  for (const code of [429, 503, 402, 403]) {
    const c = config(); c.composio = { apiKey: 'fixture', userId: 'fixture', baseUrl: 'https://backend.composio.dev/api/v3.1' };
    fetch.mock.mockImplementation(async address => new URL(address).pathname.endsWith('/connected_accounts') ? json({ items: [{ id: 'fixture', status: 'ACTIVE', toolkit: { slug: 'twitter' } }] }) : json({ successful: false, error: 'Provider unavailable', data: { status_code: code } }));
    await acquireSource(action('x'), c); now += 300000;
    const source = sourceCatalog(c).find(s => s.id === 'x');
    assert.equal(source.status, [402, 403].includes(code) ? 'failed' : 'unverified');
    assert.equal(source.last_check.error, `provider_http_${code}`);
  }
});

test('aggregate failures retain retry eligibility when at least one provider can recover', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}, 403));
  for (const temporary of [false, true]) {
    const c = config();
    fetch.mock.mockImplementation(async address => json({}, temporary && new URL(address).hostname === 'www.ithome.com' ? 503 : 403));
    const failed = await acquireSource(action('cnnews', 'explore'), c); now += 300000;
    assert.equal(failed.error, 'all_provider_requests_failed');
    const source = sourceCatalog(c).find(s => s.id === 'cnnews');
    assert.equal(source.status, temporary ? 'unverified' : 'failed'); assert.equal(source.mode_checks.explore.status, source.status);
    assert.equal(source.last_check.status, 'failed');
  }
});

test('Bilibili uses the requested page and skips already displayed items before its six-item limit', async t => {
  const calls=[];
  t.mock.method(globalThis, 'fetch', async address => {
    calls.push(new URL(address).searchParams.get('page'));
    const data=Array.from({length:8}, (_,i)=>({bvid:`BV${String(i).padStart(10,'0')}`,title:`Video ${i}`}));
    return json({code:0,data:{result:[{result_type:'video',data}]}});
  });
  const first=await acquireSource(action('bilibili','search','video'),config());
  const second=await acquireSource(action('bilibili','search','video'),config(),{page:2,excludedIds:first.items.map(item=>item.id)});
  assert.deepEqual(calls,['1','2']);
  assert.equal(second.items.length,2);
  assert.ok(second.items.every(item=>!first.items.some(previous=>previous.id===item.id)));
  assert.equal(second.page,2);
});
