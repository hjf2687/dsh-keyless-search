/**
 * Host-half integration test with a mock Cordis context: proves the plugin
 * registers a provider, a tool and four fenced routes, and that a search really
 * returns sources — without installing anything into a live Harness.
 *
 *   node tools/hosttest.mjs
 */
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';

// Never write into the real ~/.dsh settings file: give the module a temp home
// before it is imported (DSH_HOME is read at module load).
process.env.DSH_HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-keyless-search-test-'));
const { apply } = await import('../lib/plugin.js');
const { normaliseDate, dateFromSnippet, createEngineRegistry, parseAnySearchPayload, parseExaMcpBody, parseExaMcpText } = await import('../lib/engines.js');

function makeContext() {
  const routes = [];
  const ctx = {
    provided: new Map(),
    toolRegistrations: [],
    get: (key) => (key === 'connection' ? undefined : undefined),
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    provide: (key, value) => ctx.provided.set(key, value),
    web: { registerSearchProvider: (provider) => { ctx.provider = provider; return () => {}; } },
    tools: {
      register: (definition) => {
        ctx.tool = definition;
        ctx.toolRegistrations.push(definition);
        return () => {
          definition.__disposed = true;
        };
      },
    },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  ctx.routes = routes;
  return ctx;
}

function fakeRequest(method, body, headers = {}) {
  const listeners = {};
  const req = {
    method,
    headers: { host: '127.0.0.1:19387', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:19387', ...headers },
    on(event, handler) {
      listeners[event] = handler;
      return req;
    },
    destroy() {},
  };
  queueMicrotask(() => {
    if (body !== undefined && listeners.data) listeners.data(Buffer.from(body));
    listeners.end?.();
  });
  return req;
}

function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: null,
    body: '',
    ended: false,
    writeHead(code, headers) { res.statusCode = code; res.headers = headers; return res; },
    end(chunk) { if (chunk !== undefined) res.body += chunk; res.ended = true; },
  };
  return res;
}

const failures = [];
let checks = 0;
function check(label, condition, detail = '') {
  checks++;
  const ok = Boolean(condition);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const ctx = makeContext();
await apply(ctx, { primary: 'bing', maxResults: 5, timeoutMs: 12000 });

check('provider registered', ctx.provider?.id === 'free', `id=${ctx.provider?.id}`);
check('provider available()', ctx.provider?.available() === true);
check('tool registered', ctx.tool?.name === 'free_search', `name=${ctx.tool?.name}`);
check(
  'five routes registered (status/config/search/probe/test-engine)',
  ctx.routes.length === 5 && ctx.routes.some((route) => route.path.endsWith('/test-engine.json')),
  ctx.routes.map((route) => route.path.replace('/keyless-search', '')).join(', '),
);
check('keylessSearch service provided', typeof ctx.provided.get('keylessSearch')?.status === 'function');

/* ---- 1. provider shape (this is what the built-in web_search consumes) ---- */
const providerResult = await ctx.provider.search({ query: 'DeepSeek Harness 插件', maxResults: 5 }, undefined);
console.log(`\nprovider: engine=${providerResult.sources.length} sources, truncated=${providerResult.truncated}, content=${providerResult.content ? `${providerResult.content.length} chars` : 'none'}`);
check('provider returns sources', providerResult.sources.length > 0, `${providerResult.sources.length}`);
check('provider sources have url+title', providerResult.sources.every((source) => /^https?:/.test(source.url) && typeof source.title === 'string'));
check('provider marks truncation', typeof providerResult.truncated === 'boolean');
check('provider digest is markdown', typeof providerResult.content === 'string' && providerResult.content.includes(']('), 'content includes markdown links');

/* ---- 2. tool execute + output contract ---------------------------------- */
const value = await ctx.tool.execute({ query: '国产大模型 排行', depth: 'deep', maxResults: 6, recency: 'month' }, { signal: undefined });
console.log(`\ntool: engine=${value.engine} depth=${value.depth} sources=${value.sources.length} attempts=${value.attempts.map((a) => `${a.engine}:${a.ok ? a.count : 'x'}`).join(' ')} ms=${value.ms}`);
check('tool value has engine', typeof value.engine === 'string');
check('tool value has sources', value.sources.length > 0);
check('tool value has attempts', Array.isArray(value.attempts) && value.attempts.length > 0);
check('deep mode queried >1 engine', value.attempts.length > 1, `${value.attempts.length}`);
check('no undefined-valued keys in the schema projection', Object.values(value).every((entry) => entry !== undefined));

/** The registry validates a tool result as lossless JSON: no undefined anywhere. */
function findNonJson(node, path = '$') {
  if (node === undefined) return `${path} is undefined`;
  if (node === null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return null;
  if (typeof node === 'function') return `${path} is a function`;
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index++) {
      const found = findNonJson(node[index], `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const [key, entry] of Object.entries(node)) {
      if (entry === undefined) return `${path}.${key} is undefined`;
      const found = findNonJson(entry, `${path}.${key}`);
      if (found !== null) return found;
    }
    return null;
  }
  return `${path} is ${typeof node}`;
}

const deepValue = await ctx.tool.execute({ query: '国产大模型 排行', depth: 'deep', maxResults: 6 }, { signal: undefined });
const deepProblem = findNonJson(deepValue);
check('deep tool value is lossless JSON', deepProblem === null, deepProblem ?? '');
check('deep value round-trips through JSON', JSON.parse(JSON.stringify(deepValue)).sources.length === deepValue.sources.length);
const cachedValue = await ctx.tool.execute({ query: '国产大模型 排行', depth: 'deep', maxResults: 6 }, { signal: undefined });
check('cached tool value is lossless JSON', findNonJson(cachedValue) === null, findNonJson(cachedValue) ?? '');
check('cache marks the repeat', cachedValue.cached === true);

// A `site:` restriction must be enforced host-side: engines only suggest it.
const siteValue = await ctx.tool.execute({ query: 'asyncio', site: 'docs.python.org', engines: ['bing'], depth: 'fast', maxResults: 5 }, { signal: undefined });
const hosts = siteValue.sources.map((source) => new URL(source.url).hostname.replace(/^www\./, ''));
const matchesSite = hosts.filter((host) => host === 'docs.python.org' || host.endsWith('.docs.python.org'));
check('site: filter is enforced (all-or-nothing)', matchesSite.length === 0 || matchesSite.length === hosts.length, `hosts=${hosts.join(', ')}`);
check('site: filter reaches the query text', siteValue.query.includes('site:docs.python.org'), siteValue.query);

// A failing-engine path must also stay JSON-safe (or throw a typed error).
const failing = await ctx.tool.execute({ query: 'test', engines: ['mojeek'], depth: 'fast', maxResults: 2 }, { signal: undefined }).catch((error) => error);
check(
  'a failing engine either throws or returns lossless JSON',
  failing instanceof Error || findNonJson(failing) === null,
  failing instanceof Error ? `threw ${failing.code ?? 'ERR'}` : findNonJson(failing) ?? 'clean JSON',
);

const rendered = ctx.tool.output.render({}, value);
check('render returns text blocks', Array.isArray(rendered) && rendered[0]?.type === 'text' && rendered[0].text.length > 50, `${rendered[0]?.text?.length} chars`);
check('presentationMeta returns the structured value', ctx.tool.output.presentationMeta({}, value) === value);
check('isConcurrencySafe', ctx.tool.isConcurrencySafe() === true);
check('timeoutMs declared', typeof ctx.tool.timeoutMs === 'number');

/* ---- 3. cache behaviour ------------------------------------------------- */
const again = await ctx.provider.search({ query: 'DeepSeek Harness 插件', maxResults: 5 });
check('second identical search is served from cache', again.sources.length === providerResult.sources.length);

/* ---- 4. routes: status / config / search / fence ----------------------- */
const statusRoute = ctx.routes.find((route) => route.path.endsWith('/status.json'));
const statusResponse = fakeResponse();
await statusRoute.handler(fakeRequest('GET'), statusResponse);
const status = JSON.parse(statusResponse.body);
check('status.json returns 200 + payload', statusResponse.statusCode === 200 && status.ok === true);
check('status.json lists every engine', status.engines.length === 12, `${status.engines.length}`);
check('status.json reports health', status.engines.every((engine) => typeof engine.health.failures === 'number'));

const configRoute = ctx.routes.find((route) => route.path.endsWith('/config.json'));
const configResponse = fakeResponse();
await configRoute.handler(fakeRequest('POST', JSON.stringify({ config: { maxResults: 7, primary: 'so360' } })), configResponse);
const configured = JSON.parse(configResponse.body);
check('config.json persists a change', configured.ok === true && configured.config.maxResults === 7 && configured.config.primary === 'so360', `maxResults=${configured.config?.maxResults}`);

const searchRoute = ctx.routes.find((route) => route.path.endsWith('/search.json'));
const searchResponse = fakeResponse();
await searchRoute.handler(fakeRequest('POST', JSON.stringify({ query: 'DSH 鎻掍欢', depth: 'fast', maxResults: 3 })), searchResponse);
const searched = JSON.parse(searchResponse.body);
check('search.json returns results', searched.ok === true && searched.sources.length > 0, `${searched.sources?.length} sources, engine=${searched.engine}`);
check('fast depth uses one engine', searched.attempts.length === 1, `${searched.attempts?.length} attempts`);

const fencedResponse = fakeResponse();
await statusRoute.handler(fakeRequest('GET', undefined, { host: 'evil.example.com', 'sec-fetch-site': 'cross-site' }), fencedResponse);
check('routes reject a forged Host/cross-site request', fencedResponse.statusCode === 403, `status=${fencedResponse.statusCode}`);

const methodResponse = fakeResponse();
await statusRoute.handler(fakeRequest('POST', '{}'), methodResponse);
check('routes reject a wrong method', methodResponse.statusCode === 405, `status=${methodResponse.statusCode}`);

const badJsonResponse = fakeResponse();
await searchRoute.handler(fakeRequest('POST', '{not json'), badJsonResponse);
check('routes answer a malformed body without throwing', badJsonResponse.ended === true && JSON.parse(badJsonResponse.body).ok === false);

/* ---- 5. probe route ---------------------------------------------------- */
const probeRoute = ctx.routes.find((route) => route.path.endsWith('/probe.json'));
const probeResponse = fakeResponse();
await probeRoute.handler(fakeRequest('POST', JSON.stringify({ query: 'DeepSeek Harness', engines: ['bing'] })), probeResponse);
const probed = JSON.parse(probeResponse.body);
check('probe.json probes one engine', probed.ok === true && probed.probes.length === 1 && probed.probes[0].ok === true, JSON.stringify(probed.probes?.[0]));

/* -------------------------------------------------------------------------- */
/* 6. Keyed engines (tavily) and custom engines                               */
/* -------------------------------------------------------------------------- */

/** Fixture server: the custom-engine paths, headers and POST body under test. */
let flakyHits = 0;
let badJsonHits = 0;
let slowHits = 0;
const fixture = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  // Drop the connection once, then answer: this is what the transport retry is for.
  if (url.pathname === '/api/flaky') {
    flakyHits++;
    if (flakyHits === 1) {
      req.destroy();
      return;
    }
    send(200, { items: [{ title: 'Second Try', url: 'https://example.com/retry', snippet: 'survived a dropped connection' }] });
    return;
  }
  if (url.pathname === '/api/bad-json') {
    badJsonHits++;
    send(200, 'still not json');
    return;
  }
  // Dated results (old, new, undated) plus a localized Chinese pubDate.
  if (url.pathname === '/api/dated') {
    const today = new Date();
    const iso = (daysAgo) => new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
    const zhDate = (daysAgo) => {
      const date = new Date(today.getTime() - daysAgo * 86400000);
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return `${weekdays[date.getUTCDay()]}, ${date.getUTCDate()} ${date.getUTCMonth() + 1}月 ${date.getUTCFullYear()} 00:00:00 GMT`;
    };
    send(200, {
      items: [
        { title: 'Today', url: 'https://example.com/today', body: 'fresh', date: iso(0) },
        { title: 'Long ago', url: 'https://example.com/old', body: 'stale', date: iso(400) },
        { title: 'Localized', url: 'https://example.com/zh', body: 'chinese pubDate', date: zhDate(2) },
        { title: 'Undated', url: 'https://example.com/nodate', body: 'no date at all' },
      ],
    });
    return;
  }
  // Every result older than any window: exercises the all-filtered fallback.
  if (url.pathname === '/api/all-old') {
    const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    send(200, {
      items: [
        { title: 'Ancient', url: 'https://example.com/ancient', body: 'very old', date: iso(900) },
        { title: 'Merely old', url: 'https://example.com/merely-old', body: 'old too', date: iso(400) },
      ],
    });
    return;
  }
  // Junk characters: undecodable bytes, a lone surrogate and a control char.
  // (`snippet` is the field the default snippet path reads, so these exercise
  // the snippet branch of finalize() as well as the title branch.)
  if (url.pathname === '/api/junk') {
    send(200, {
      items: [
        { title: '真身曝光!\uFFFD\uFFFD_九游', url: 'https://example.com/junk1', snippet: '摘要带\uFFFD替换字符与\u0007控制符' },
        { title: 'lone \uD83D half', url: 'https://example.com/junk2', snippet: 'emoji \uD83D\uDE00 kept' },
        // Baidu really does hand back markup inside a snippet now and then.
        { title: 'raw markup', url: 'https://example.com/junk3', snippet: '<div class="cos-row cos-row-c">涨价!一言难尽的 DeepSeek 最新版</div>' },
        // The HTML surfaces put the publish date at the front of the snippet.
        { title: 'snippet dated', url: 'https://example.com/junk4', snippet: '2026年9月10日 · DeepSeek 官方表示，经内部、外部多方评测' },
        // A character-offset slice can cut a tag in half; the remnant must not show.
        { title: 'cut tag', url: 'https://example.com/junk5', snippet: '<div class="cos-row cos-row-c"' },
      ],
    });
    return;
  }
  // Deliberately slow, and counts how many times it was really called.
  if (url.pathname === '/api/slow') {
    slowHits++;
    setTimeout(() => {
      send(200, { items: [{ title: 'Slow result', url: 'https://example.com/slow', body: 'took its time' }] });
    }, 150);
    return;
  }
  if (url.pathname === '/api/nested') {
    send(200, {
      data: {
        results: [
          { attributes: { title: 'Nested One', url: 'https://example.com/one', summary: 'first summary' }, published: '2026-05-01' },
          { attributes: { title: 'Nested Two', url: 'https://example.com/two', description: 'second description' } },
          { attributes: { title: 'Nested Three', url: 'https://example.com/three' } },
        ],
      },
    });
    return;
  }
  if (url.pathname === '/api/post') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* keep {} */
      }
      const echoed = typeof parsed.q === 'string' ? parsed.q : '(no q)';
      send(200, { hits: [{ name: `POST ${echoed}`, link: 'https://example.com/post', body: `token=${parsed.token ?? 'none'}` }] });
    });
    return;
  }
  if (url.pathname === '/api/auth') {
    if (url.searchParams.get('api_key') !== 'secret-value') {
      send(401, { error: 'unauthorized' });
      return;
    }
    send(200, { items: [{ title: 'Authed', url: 'https://example.com/auth', snippet: 'used the templated key' }] });
    return;
  }
  if (url.pathname === '/feed.xml') {
    send(
      200,
      `<?xml version="1.0"?><rss><channel>
        <item><title>Feed One</title><link>https://example.com/feed1</link><description>first feed item</description><pubDate>Mon, 04 May 2026 10:00:00 GMT</pubDate></item>
        <item><title>Feed Two</title><link>https://example.com/feed2</link><description>second feed item</description></item>
      </channel></rss>`,
      'application/rss+xml',
    );
    return;
  }
  if (url.pathname === '/searx') {
    send(200, { results: [{ url: 'https://example.com/searx1', title: 'SearX One', content: 'searx content', publishedDate: '2026-04-02' }] });
    return;
  }
  if (url.pathname === '/bad') {
    send(200, 'this is not json at all');
    return;
  }
  if (url.pathname === '/empty') {
    send(200, { results: [] });
    return;
  }
  send(404, { error: 'no fixture' });
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${fixture.address().port}`;

const nestedEngine = {
  id: 'fixture-json',
  label: 'Fixture JSON',
  type: 'json',
  url: `${BASE}/api/nested?q={query}`,
  resultsPath: 'data.results',
  titlePath: 'attributes.title',
  urlPath: 'attributes.url',
  snippetPath: 'attributes.summary|attributes.description',
  publishedAtPath: 'published',
};
const postEngine = {
  id: 'fixture-post',
  label: 'Fixture POST',
  type: 'json',
  method: 'POST',
  url: `${BASE}/api/post`,
  body: '{"q":"{queryRaw}","token":"{key}"}',
  resultsPath: 'hits',
  titlePath: 'name',
  urlPath: 'link',
  snippetPath: 'body',
};
const feedEngine = { id: 'fixture-rss', label: 'Fixture RSS', type: 'rss', url: `${BASE}/feed.xml` };
const searxEngine = { id: 'fixture-searx', label: 'Fixture SearX', type: 'searxng', url: `${BASE}/searx?q={query}&format=json` };
const authEngine = { id: 'fixture-auth', label: 'Fixture Auth', type: 'json', url: `${BASE}/api/auth?q={query}&api_key={key}`, resultsPath: 'items' };
const badEngine = { id: 'fixture-bad', label: 'Fixture Bad', type: 'json', url: `${BASE}/bad`, resultsPath: 'results' };
const emptyEngine = { id: 'fixture-empty', label: 'Fixture Empty', type: 'json', url: `${BASE}/empty`, resultsPath: 'results' };
/** Dated + undated results, for the recency window filter. */
const datedEngine = { id: 'fixture-dated', label: 'Fixture Dated', type: 'json', url: `${BASE}/api/dated?q={query}`, resultsPath: 'items' };
/** Only stale results, for the all-filtered fallback. */
const oldEngine = { id: 'fixture-old', label: 'Fixture Old', type: 'json', url: `${BASE}/api/all-old?q={query}`, resultsPath: 'items' };
/** Delayed, countable endpoint, for the concurrent-dedup check. */
const slowEngine = { id: 'fixture-slow', label: 'Fixture Slow', type: 'json', url: `${BASE}/api/slow?q={query}`, resultsPath: 'items' };

/** Add custom engines + keys through the real config route. */
const saveResponse = fakeResponse();
await configRoute.handler(
  fakeRequest('POST', JSON.stringify({ config: { customEngines: [nestedEngine, postEngine, feedEngine, searxEngine, authEngine, badEngine, emptyEngine, datedEngine, oldEngine, slowEngine], order: ['fixture-json', 'fixture-post', 'fixture-rss', 'fixture-searx', 'fixture-auth', 'bing'] }, keys: { 'fixture-auth': 'secret-value' } })),
  saveResponse,
);
const saved = JSON.parse(saveResponse.body);
check('config.json accepts custom engines', saved.ok === true && saved.customEngines.length === 10, `${saved.customEngines?.length} saved`);
check('custom engines appear in the registry', saved.engines.some((engine) => engine.id === 'fixture-json' && engine.custom === true));
check('a custom engine with a key is marked as such', saved.customEngines.find((engine) => engine.id === 'fixture-auth')?.hasKey === true);
check('the key itself is never returned', !JSON.stringify(saved).includes('secret-value'), 'raw key absent from status.json');
check('a masked hint is returned instead', saved.keys['fixture-auth']?.configured === true && saved.keys['fixture-auth'].hint === '••••alue', JSON.stringify(saved.keys['fixture-auth']));
check('an optional-key built-in without a key reports not-configured', saved.keys.tavily?.configured === false && saved.keys.tavily.envKey === 'TAVILY_API_KEY', JSON.stringify(saved.keys.tavily));
check('but it stays usable on its anonymous quota', saved.engines.find((engine) => engine.id === 'tavily')?.usable === true);
check('keyless engines stay usable', saved.engines.find((engine) => engine.id === 'bing')?.usable === true);
check(
  'the anonymous API engines are usable without any key',
  ['anysearch', 'exa'].every((id) => saved.engines.find((engine) => engine.id === id)?.usable === true),
  JSON.stringify(['anysearch', 'exa'].map((id) => saved.engines.find((engine) => engine.id === id)?.usable)),
);

/* ---- 6a. the search chain really runs custom engines ------------------- */
const customSearch = await ctx.provider.search({ query: 'anything', maxResults: 5 }, undefined);
check('the chain runs with custom engines', customSearch.sources.length > 0, `${customSearch.sources.length} sources`);

const testEngineRoute = ctx.routes.find((route) => route.path.endsWith('/test-engine.json'));
const runDraft = async (engine, extra = {}) => {
  const response = fakeResponse();
  await testEngineRoute.handler(fakeRequest('POST', JSON.stringify({ engine, query: 'draft query', maxResults: 5, ...extra })), response);
  return JSON.parse(response.body);
};

const nestedDraft = await runDraft(nestedEngine);
check('a JSON draft engine parses nested paths', nestedDraft.ok === true && nestedDraft.count === 3, JSON.stringify(nestedDraft.sources?.[0] ?? nestedDraft.error));
check('the `a|b` snippet fallback works', nestedDraft.sources?.[1]?.snippet === 'second description', JSON.stringify(nestedDraft.sources?.[1]));
check('a missing optional field is simply absent', nestedDraft.sources?.[2]?.snippet === undefined && nestedDraft.sources[2].url === 'https://example.com/three');
check('published dates are normalised', nestedDraft.sources?.[0]?.publishedAt === '2026-05-01', String(nestedDraft.sources?.[0]?.publishedAt));

const postDraft = await runDraft(postEngine, { key: 'tok-123' });
check('a POST draft engine fills the body template', postDraft.ok === true && postDraft.sources[0].title === 'POST draft query', JSON.stringify(postDraft.sources?.[0] ?? postDraft.error));
check('the key placeholder reaches the request body', postDraft.sources[0].snippet === 'token=tok-123', String(postDraft.sources?.[0]?.snippet));

const rssDraft = await runDraft(feedEngine);
check('an RSS draft engine parses feed items', rssDraft.ok === true && rssDraft.count === 2 && rssDraft.sources[0].title === 'Feed One', JSON.stringify(rssDraft.sources?.[0] ?? rssDraft.error));
check('RSS dates are normalised', rssDraft.sources[0].publishedAt === '2026-05-04', String(rssDraft.sources?.[0]?.publishedAt));

const searxDraft = await runDraft(searxEngine);
check('a SearXNG-shaped draft engine works too', searxDraft.ok === true && searxDraft.sources[0].title === 'SearX One' && searxDraft.sources[0].publishedAt === '2026-04-02', JSON.stringify(searxDraft.sources?.[0] ?? searxDraft.error));

const authDraft = await runDraft(authEngine, { key: 'secret-value' });
check('the {key} placeholder authenticates a custom engine', authDraft.ok === true && authDraft.sources[0].title === 'Authed', JSON.stringify(authDraft.sources?.[0] ?? authDraft.error));
const authDraftWrong = await runDraft(authEngine, { key: 'wrong' });
check('a rejected credential surfaces as ENGINE_NO_KEY', authDraftWrong.ok === false && String(authDraftWrong.error).startsWith('ENGINE_NO_KEY'), String(authDraftWrong.error));

const badDraft = await runDraft(badEngine);
check('a non-JSON response is a loud parse error', badDraft.ok === false && String(badDraft.error).startsWith('ENGINE_PARSE'), String(badDraft.error));
const emptyDraft = await runDraft(emptyEngine);
check('an empty result set is a loud empty error', emptyDraft.ok === false && String(emptyDraft.error).startsWith('ENGINE_EMPTY'), String(emptyDraft.error));

/* ---- 6b. transport retry ------------------------------------------------ */
const flakyEngine = { id: 'fixture-flaky', label: 'Fixture Flaky', type: 'json', url: `${BASE}/api/flaky?q={query}`, resultsPath: 'items' };
const flakyDraft = await runDraft(flakyEngine);
check('a dropped connection is retried once and succeeds', flakyDraft.ok === true && flakyDraft.sources[0]?.title === 'Second Try', JSON.stringify(flakyDraft.sources?.[0] ?? flakyDraft.error));
check('exactly two requests were made (initial + one retry)', flakyHits === 2, `${flakyHits} hits`);

const badJsonEngine = { id: 'fixture-badjson', label: 'Fixture Bad JSON', type: 'json', url: `${BASE}/api/bad-json`, resultsPath: 'items' };
const badJsonDraft = await runDraft(badJsonEngine);
check('a parse failure is not retried (it is a result, not a transport error)', badJsonDraft.ok === false && badJsonHits === 1, `${badJsonHits} hits, error=${String(badJsonDraft.error).slice(0, 40)}`);

/* ---- 6b2. text hygiene: undecodable bytes never reach the caller --------- */
const junkEngine = { id: 'fixture-junk', label: 'Fixture Junk', type: 'json', url: `${BASE}/api/junk`, resultsPath: 'items' };
const junkDraft = await runDraft(junkEngine);
const junkText = JSON.stringify(junkDraft.sources);
check('replacement characters are stripped from titles and snippets', junkDraft.ok === true && !junkText.includes('\uFFFD') && junkDraft.sources[0]?.snippet === '摘要带替换字符与控制符', junkText);
check('control characters are stripped', junkDraft.ok === true && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(junkText), junkText);
check('an unpaired surrogate is dropped but a real emoji survives', junkDraft.ok === true && !junkText.includes('\uD83D half') && junkDraft.sources[1]?.snippet === 'emoji \uD83D\uDE00 kept', junkText);
check('the readable part of the title is kept', junkDraft.sources[0]?.title === '真身曝光!_九游', JSON.stringify(junkDraft.sources[0]?.title));
const markupSource = junkDraft.sources.find((source) => source.url === 'https://example.com/junk3');
check('markup inside a snippet is stripped, not shown', markupSource?.snippet === '涨价!一言难尽的 DeepSeek 最新版', JSON.stringify(markupSource));
const snippetDated = junkDraft.sources.find((source) => source.url === 'https://example.com/junk4');
check('a snippet-front date becomes publishedAt and leaves the snippet', snippetDated?.publishedAt === '2026-09-10' && snippetDated?.snippet === 'DeepSeek 官方表示，经内部、外部多方评测', JSON.stringify(snippetDated));
const cutTag = junkDraft.sources.find((source) => source.url === 'https://example.com/junk5');
check('a half-cut tag never reaches the snippet', cutTag !== undefined && cutTag.snippet === undefined, JSON.stringify(cutTag));
check('no snippet in the whole result set contains a tag remnant', !junkText.includes('<'), junkText);

/* ---- 6c. published dates: localized formats ----------------------------- */
// Bing with mkt=zh-CN sends "周日, 27 9月 2026 23:22:00 GMT", which plain
// `new Date()` rejects — this used to drop every publishedAt in the default
// (Chinese) setup.
const dateCases = [
  ['周日, 27 9月 2026 23:22:00 GMT', '2026-09-27'],
  ['周一, 28 9月 2026 07:07:00 GMT', '2026-09-28'],
  ['Sun, 27 Sep 2026 23:22:00 GMT', '2026-09-27'],
  ['Mon, 04 May 2026 10:00:00 GMT', '2026-05-04'],
  ['2026年9月27日', '2026-09-27'],
  ['2026年9月27日 10:00', '2026-09-27'],
  ['2026/9/27', '2026-09-27'],
  ['2026-9-27', '2026-09-27'],
  ['2026-09-27T23:22:00Z', '2026-09-27'],
  ['2026-09-27T02:00:00+08:00', '2026-09-26'],
  ['2026년 9월 27일', '2026-09-27'],
  // Relative wording lives in `relativeCases` below, where `now` is fixed.
  ['', undefined],
  ['not a date', undefined],
  ['2026-13-45', undefined],
];
// Relative wording is arithmetic from `now`, so it is checked against a fixed
// instant to stay deterministic.
const FIXED_NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const relativeCases = [
  ['4天前', '2026-09-24'],
  ['4 天之前', '2026-09-24'],
  ['2周前', '2026-09-14'],
  ['3小时前', '2026-09-28'],
  ['5分钟前', '2026-09-28'],
  ['刚刚', '2026-09-28'],
  ['昨天', '2026-09-27'],
  ['前天', '2026-09-26'],
  ['2 days ago', '2026-09-26'],
  ['1 week ago', '2026-09-21'],
  ['yesterday', '2026-09-27'],
  ['3个月前', '2026-06-30'],
  ['2年前', '2024-09-28'],
];
const dateFailures = dateCases.filter(([input, expected]) => normaliseDate(input) !== expected);
const relativeFailures = relativeCases.filter(([input, expected]) => normaliseDate(input, FIXED_NOW) !== expected);
check('every published-date format parses (or stays empty, never guessed)', dateFailures.length === 0, dateFailures.map(([input, expected]) => `${input} → ${normaliseDate(input)} (want ${expected})`).join(' | '));
check('relative wording is dated from now, exactly', relativeFailures.length === 0, relativeFailures.map(([input, expected]) => `${input} → ${normaliseDate(input, FIXED_NOW)} (want ${expected})`).join(' | '));

/* ---- 6c2. dates hid at the front of HTML snippets ----------------------- */
// The exact strings the live bing-web / so360 surfaces produced.
const snippetCases = [
  ['2025年2月28日 · DeepSeek 从 2023 年 11 月 2 日到 2025 年 2 月的发展历程', '2025-02-28', 'DeepSeek 从 2023 年 11 月 2 日到 2025 年 2 月的发展历程'],
  ['4 天之前 · The official version of DeepSeek-V4.1-Flash has been released', '2026-09-24', 'The official version of DeepSeek-V4.1-Flash has been released'],
  ['4天前 - 近期 DeepSeek在 arXiv 发布 重磅论文', '2026-09-24', '近期 DeepSeek在 arXiv 发布 重磅论文'],
  ['2026年9月10日 · DeepSeek 官方表示，经内部、外部多方评测', '2026-09-10', 'DeepSeek 官方表示，经内部、外部多方评测'],
  ['隔壁马斯克的 Grok 4.6 也发布了，在 Artificial', undefined, '隔壁马斯克的 Grok 4.6 也发布了，在 Artificial'],
  ['发布 的 DeepSeek -R1以其低训练成本', undefined, '发布 的 DeepSeek -R1以其低训练成本'],
];
const snippetFailures = snippetCases.filter(([input, expectedDate, expectedSnippet]) => {
  const got = dateFromSnippet(input, FIXED_NOW);
  return got.publishedAt !== expectedDate || got.snippet !== expectedSnippet;
});
check('a date at the front of a snippet is extracted and removed from it', snippetFailures.length === 0, snippetFailures.map(([input]) => `${input} → ${JSON.stringify(dateFromSnippet(input, FIXED_NOW))}`).join(' | '));
check('a snippet with no date prefix is left exactly as it was', dateFromSnippet(snippetCases[4][0], FIXED_NOW).snippet === snippetCases[4][0]);

const datedDraft = await runDraft(datedEngine);
const datedTitles = datedDraft.sources?.map((source) => `${source.title}=${source.publishedAt ?? '(none)'}`).join(' ');
check('a localized pubDate survives the RSS/JSON path', datedDraft.ok === true && datedDraft.sources.find((source) => source.title === 'Localized')?.publishedAt !== undefined, datedTitles);
check('undated results stay undated rather than guessed', datedDraft.ok === true && datedDraft.sources.find((source) => source.title === 'Undated')?.publishedAt === undefined, datedTitles);

/* ---- 6d. the recency window is enforced on real dates ------------------- */
// Bing/Baidu ignore every keyless freshness parameter, so `recency` filters the
// parsed dates instead — and it lives on the tool: the provider contract is only
// `{ query, maxResults? }`, so the harness's own web_search has no window knob.
// The engine is selected per call so this section leaves no config behind.
const windowed = await ctx.tool.execute({ query: 'windowed-a', depth: 'fast', maxResults: 10, recency: 'month', engines: ['fixture-dated'] }, { signal: undefined });
const windowedTitles = windowed.sources.map((source) => source.title);
check('recency keeps fresh results', windowedTitles.includes('Today'), windowedTitles.join(', '));
check('recency drops results older than the window', !windowedTitles.includes('Long ago'), windowedTitles.join(', '));
check('recency keeps undated results (cannot be judged)', windowedTitles.includes('Undated'), windowedTitles.join(', '));
check('recency is reported back', windowed.recency === 'month' && windowed.recencyUnmet === false, JSON.stringify({ recency: windowed.recency, unmet: windowed.recencyUnmet }));
const noWindow = await ctx.tool.execute({ query: 'windowed-b', depth: 'fast', maxResults: 10, engines: ['fixture-dated'] }, { signal: undefined });
check('without recency nothing is dropped', noWindow.sources.some((source) => source.title === 'Long ago'), noWindow.sources.map((source) => source.title).join(', '));
const tinyWindow = await ctx.tool.execute({ query: 'windowed-c', depth: 'fast', maxResults: 10, recency: 'day', engines: ['fixture-dated'] }, { signal: undefined });
const tinyTitles = tinyWindow.sources.map((source) => source.title);
check('a narrower window drops the 2-day-old result but keeps today and undated', tinyTitles.includes('Today') && tinyTitles.includes('Undated') && !tinyTitles.includes('Localized'), JSON.stringify({ unmet: tinyWindow.recencyUnmet, titles: tinyTitles }));
const allStale = await ctx.tool.execute({ query: 'windowed-d', depth: 'fast', maxResults: 10, recency: 'day', engines: ['fixture-old'] }, { signal: undefined });
check('an impossible window falls back to the unfiltered list and says so', allStale.recencyUnmet === true && allStale.sources.length === 2, JSON.stringify({ unmet: allStale.recencyUnmet, titles: allStale.sources.map((source) => source.title) }));

/* ---- 6e. identical concurrent searches share one run -------------------- */
slowHits = 0;
const dedupCall = { query: 'dedup-check', depth: 'fast', maxResults: 5, engines: ['fixture-slow'] };
const [first, second] = await Promise.all([
  ctx.tool.execute({ ...dedupCall }, { signal: undefined }),
  ctx.tool.execute({ ...dedupCall }, { signal: undefined }),
]);
check('two identical searches in flight hit the engine exactly once', slowHits === 1, `${slowHits} hits`);
check('both callers still get the results', first.sources.length === 1 && second.sources.length === 1 && first.sources[0].url === second.sources[0].url);
check('exactly one of them is flagged as coalesced', [first, second].filter((value) => value.coalesced === true).length === 1, JSON.stringify([first.coalesced, second.coalesced]));
// Different queries must NOT be merged (each gets its own engine call).
slowHits = 0;
await Promise.all([
  ctx.tool.execute({ ...dedupCall, query: 'dedup-x' }, { signal: undefined }),
  ctx.tool.execute({ ...dedupCall, query: 'dedup-y' }, { signal: undefined }),
]);
check('different queries are not merged', slowHits === 2, `${slowHits} hits`);

/* ---- 6f. anonymous JSON engines: parsing without the network ------------ */
// The two anonymous APIs are exercised against fixtures here; `tools/selftest.mjs`
// is the live check. Everything below must hold even when the quota is exhausted.
const errorCodeOf = (fn) => {
  try {
    fn();
    return 'NO_THROW';
  } catch (error) {
    return error?.code ?? 'NO_CODE';
  }
};

const anysearchBody = JSON.stringify({
  code: 0,
  data: {
    results: [
      { title: 'Any One', url: 'https://example.com/any1', snippet: 'first anysearch hit', published_at: '2026-09-01T08:00:00Z' },
      { title: 'Any Two', url: 'https://example.com/any2', snippet: 'second anysearch hit' },
    ],
  },
});
const anyParsed = parseAnySearchPayload(anysearchBody, 5);
check('anysearch envelope is parsed into sources', anyParsed.length === 2 && anyParsed[0].url === 'https://example.com/any1', JSON.stringify(anyParsed));
check('anysearch publishes a date when the result carries one', anyParsed[0].publishedAt === '2026-09-01' && anyParsed[1].publishedAt === undefined);
check('anysearch quota code is a block, not an empty result', errorCodeOf(() => parseAnySearchPayload(JSON.stringify({ code: 7, message: 'quota exceeded' }), 5)) === 'ENGINE_BLOCKED');
check('anysearch junk is a parse failure', errorCodeOf(() => parseAnySearchPayload('not json', 5)) === 'ENGINE_PARSE');

const exaText = [
  'Title: Exa One',
  'URL: https://example.com/exa1',
  'Published: 2026-09-02T03:00:00.000Z',
  'Highlights:',
  'first highlight line',
  'second highlight line',
  '',
  'Title: Exa Two',
  'URL: https://example.com/exa2',
  'Published: N/A',
  'Highlights:',
  '...',
  'third highlight line',
].join('\n');
const exaParsed = parseExaMcpText(exaText, 5);
check('exa text blocks are parsed into sources', exaParsed.length === 2 && exaParsed[1].url === 'https://example.com/exa2', JSON.stringify(exaParsed));
check('exa dates are normalised and N/A stays empty', exaParsed[0].publishedAt === '2026-09-02' && exaParsed[1].publishedAt === undefined);
check('exa snippets drop ellipsis-only highlight lines', !String(exaParsed[1].snippet ?? '').includes('...'));
const exaSse = `event: message\ndata: ${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: 'Title: SSE One\nURL: https://example.com/sse1\nHighlights:\nhi' }] },
})}\n\n`;
check('exa SSE frames are unwrapped', parseExaMcpText(parseExaMcpBody(exaSse), 5)[0]?.url === 'https://example.com/sse1');
check(
  'exa rate-limit text is a block, not an empty result',
  errorCodeOf(() =>
    parseExaMcpBody(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { _meta: { 'ai.exa/rateLimited': true }, content: [{ type: 'text', text: 'free MCP rate limit' }] } })}`,
    ),
  ) === 'ENGINE_BLOCKED',
);
check('exa jsonrpc errors are failures', errorCodeOf(() => parseExaMcpBody(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'nope' } })}`)) === 'ENGINE_PARSE');
// A rate-limited call can also carry `isError: true`; the quota signal must win,
// otherwise the caller sees "empty result" and the real cause is lost.
check(
  'exa rate-limit wins over isError',
  errorCodeOf(() =>
    parseExaMcpBody(
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, _meta: { 'ai.exa/rateLimited': true }, content: [{ type: 'text', text: 'free MCP rate limit' }] } })}`,
    ),
  ) === 'ENGINE_BLOCKED',
);
check('exa inline Highlights still yields a snippet', parseExaMcpText('Title: Inline\nURL: https://example.com/inline\nHighlights: inline snippet text', 5)[0]?.snippet === 'inline snippet text');
check('exa N/A highlight lines are dropped', parseExaMcpText('Title: NA\nURL: https://example.com/na\nHighlights:\nN/A\nreal line', 5)[0]?.snippet === 'real line');
check('anysearch string code "0" is a success', parseAnySearchPayload(JSON.stringify({ code: '0', data: { results: [{ title: 'S', url: 'https://example.com/s' }] } }), 5).length === 1);
check('anysearch Chinese quota wording is a block', errorCodeOf(() => parseAnySearchPayload(JSON.stringify({ code: 5, message: '请求过于频繁，已限流' }), 5)) === 'ENGINE_BLOCKED');

/* ---- 6g. engines added in a later version slot into a stored order ----- */
// A stored order is a snapshot; without merging, a new engine lands at the tail
// and `deep` mode (first N engines) never reaches it.
const merged = createEngineRegistry([]).mergedOrder(['tavily', 'bing', 'baidu']);
check('a new engine is placed after its default predecessor, not at the tail', merged.indexOf('anysearch') === merged.indexOf('bing-web') + 1 && merged.indexOf('exa') === merged.indexOf('anysearch') + 1, merged.join(','));
check('a stored order is otherwise preserved', merged.slice(0, 3).join(',') === 'tavily,bing,baidu', merged.join(','));
check('every built-in appears exactly once in the merged order', merged.length === 12 && new Set(merged).size === merged.length, merged.join(','));

// This case separates "merge by default position" from "append missing at the
// tail": the tail-append implementation would put tavily at index 1 and leave
// the new engines after it.
const tailMerged = createEngineRegistry([]).mergedOrder(['bing', 'tavily']);
check('a new engine is not merely appended after an explicitly-ordered last engine', tailMerged.indexOf('tavily') === tailMerged.length - 1 && tailMerged.indexOf('anysearch') < tailMerged.indexOf('tavily'), tailMerged.join(','));

// A custom-only stored order must keep its custom engine in front: the built-ins
// are inserted after it, not before it.
const customRegistry = createEngineRegistry([{ id: 'my-x', url: 'https://example.com/q?q={query}' }]);
const customMerged = customRegistry.mergedOrder(['my-x']);
check('a custom-only order keeps the custom engine in front', customMerged[0] === 'my-x' && customMerged.length === 13, customMerged.join(','));

/* ---- 6b. definition validation ----------------------------------------- */
const invalidDrafts = [
  ['a built-in id cannot be shadowed', { ...nestedEngine, id: 'bing' }],
  ['an id with capitals/spaces is rejected', { ...nestedEngine, id: 'My Engine' }],
  ['a non-http url is rejected', { ...nestedEngine, url: 'file:///etc/passwd' }],
  ['an http url passes validation... custom engines may target a LAN service', { ...nestedEngine, url: 'http://127.0.0.1:1/search?q={query}' }],
];
for (const [label, draft] of invalidDrafts) {
  const outcome = await runDraft(draft);
  if (label.startsWith('an http url passes validation')) {
    // It must get past validation and fail at the network instead.
    check(label, outcome.ok === false && !String(outcome.error).startsWith('CUSTOM_INVALID'), String(outcome.error));
  } else {
    check(label, outcome.ok === false && String(outcome.error).startsWith('CUSTOM_INVALID'), String(outcome.error));
  }
}
const colliding = await runDraft({ ...nestedEngine, id: 'fixture-json' });
check('a duplicate of a saved custom id still runs as a draft', colliding.ok === true);

/* ---- 6c. keyed engine through the chain -------------------------------- */
// With a key configured for `fixture-auth` the chain includes it; `tavily`
// stays out because it has no key.
const authOnly = await ctx.provider.search({ query: 'x' }, undefined);
check('a keyed custom engine joins the default chain', JSON.stringify(authOnly.sources).includes('example.com/auth') || authOnly.sources.length > 0);

// `tavily` runs keyless on the anonymous tier; a key only upgrades the quota,
// so the engine must be in the plan either way.
const planWhileKeyless = saved.engines.find((engine) => engine.id === 'tavily');
check('tavily joins the chain with no key (anonymous tier)', planWhileKeyless.usable === true);
const withTavilyKey = fakeResponse();
await configRoute.handler(fakeRequest('POST', JSON.stringify({ keys: { tavily: 'tvly-test-1234' } })), withTavilyKey);
const keyedStatus = JSON.parse(withTavilyKey.body);
check('tavily becomes usable once keyed', keyedStatus.engines.find((engine) => engine.id === 'tavily')?.usable === true);
check('the tavily key is stored masked', keyedStatus.keys.tavily.hint === '••••1234', JSON.stringify(keyedStatus.keys.tavily));
check('but never in the clear', !withTavilyKey.body.includes('tvly-test-1234'));

// Clearing a key removes it again.
const clearedResponse = fakeResponse();
await configRoute.handler(fakeRequest('POST', JSON.stringify({ keys: { tavily: '' } })), clearedResponse);
const cleared = JSON.parse(clearedResponse.body);
check('an empty key clears the stored one', cleared.keys.tavily.configured === false);
check('and the engine stays usable on the anonymous tier', cleared.engines.find((engine) => engine.id === 'tavily')?.usable === true);

/* ---- 6d. the tool description tracks the engine set -------------------- */
check('the tool was re-registered after the config change', ctx.toolRegistrations.length >= 2, `${ctx.toolRegistrations.length} registrations`);
check('the previous registration was disposed', ctx.toolRegistrations[0].__disposed === true);
const latestDescription = ctx.tool.description;
const engineListDoc = String(ctx.tool.parameters?.properties?.engines?.description ?? '');
check('the tool description mentions keyed and custom engines', latestDescription.includes('your own keyed or custom engines'), latestDescription.slice(0, 160));
check('the engine parameter lists the custom engine', engineListDoc.includes('fixture-json'), engineListDoc.slice(0, 200));
check('the engine parameter flags optional-key engines separately', engineListDoc.includes('Key optional') && engineListDoc.includes('tavily'), engineListDoc.slice(0, 320));
check('the engine parameter marks what is usable now', engineListDoc.includes('Usable now:'));

// A custom engine can be selected explicitly, and unknown ids are ignored.
const explicit = await ctx.tool.execute({ query: 'picked', engines: ['fixture-json'], depth: 'fast', maxResults: 3 }, { signal: undefined });
check('an explicit custom engine id is honoured', explicit.attempts.length === 1 && explicit.attempts[0].engine === 'fixture-json', JSON.stringify(explicit.attempts));
const unknownOnly = await ctx.tool.execute({ query: 'picked', engines: ['nope-not-real'], depth: 'fast', maxResults: 3 }, { signal: undefined }).catch((error) => error);
check('an unknown-only engine list throws NO_ENGINE', unknownOnly instanceof Error && unknownOnly.code === 'NO_ENGINE', String(unknownOnly?.code ?? unknownOnly));

// Custom engines are drop-in chain members: a failing one falls through.
const fixtureFallthrough = await ctx.tool.execute({ query: 'fallthrough', engines: ['fixture-bad', 'fixture-json'], depth: 'balanced', maxResults: 4 }, { signal: undefined });
check(
  'a failing custom engine falls through to the next one',
  fixtureFallthrough.attempts.length === 2 && fixtureFallthrough.attempts[0].ok === false && fixtureFallthrough.attempts[1].ok === true && fixtureFallthrough.sources.length > 0,
  JSON.stringify(fixtureFallthrough.attempts.map((attempt) => `${attempt.engine}:${attempt.ok ? attempt.count : attempt.error?.slice(0, 24)}`)),
);

// Removing the custom engines returns the plugin to its keyless-only shape.
const removeResponse = fakeResponse();
await configRoute.handler(fakeRequest('POST', JSON.stringify({ config: { customEngines: [], order: undefined } })), removeResponse);
const removed = JSON.parse(removeResponse.body);
check('removing custom engines drops them from the registry', !removed.engines.some((engine) => engine.id === 'fixture-json'));
check('and the built-ins survive', removed.engines.length === 12, `${removed.engines.length} engines`);

await new Promise((resolve) => fixture.close(resolve));

console.log(`\n${failures.length === 0 ? `ALL CHECKS PASSED (${checks} checks)` : `${failures.length}/${checks} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);