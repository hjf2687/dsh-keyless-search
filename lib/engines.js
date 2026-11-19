/**
 * dsh-keyless-search · engine layer
 *
 * Two kinds of engine live here:
 *
 *  - **Keyless** engines read a public search surface (HTML, RSS or a documented
 *    JSON endpoint) with an ordinary browser user agent — no key, no account.
 *  - **Keyed** engines call a real API with your own key (`tavily`). They are
 *    skipped automatically while no key is configured, so the default chain never
 *    fails from a missing key.
 *
 * On top of the built-ins, `createEngineRegistry()` can compile **custom engines**
 * declared from the settings page: a URL template plus JSON paths (or RSS /
 * SearXNG shapes). That is how an internal search service, a self-hosted SearXNG
 * or any third-party search API joins the same chain.
 *
 * Design rules
 * ---------------------------------------------------------------------------
 * - `search()` either returns a non-empty array of `{url,title,snippet,...}` or
 *   throws. The caller (the chain in `lib/host.js`) owns fallback, caching and
 *   circuit breaking, so an engine never masks a failure as an empty result.
 * - A parse that finds zero results is a *failure* (`ENGINE_EMPTY`), because in
 *   practice that always means the shape changed or a captcha was served.
 * - Region/language are per-engine arguments, not globals, so mixed chains work.
 * - Engines are pure functions plus metadata, so they can be tested outside the
 *   Harness (`node tools/selftest.mjs`, `node tools/hosttest.mjs`).
 *
 * Legal note: the keyless engines read the same public surfaces every keyless
 * search tool reads. Bing's RSS endpoint states that its results are for
 * personal, non-commercial aggregation; that is how this plugin uses them (a
 * personal development tool). Prefer the HTML engines (`baidu`, `so360`) or your
 * own keyed/custom engine when you want to avoid that caveat.
 */

/** Browser-like UA: several engines serve a challenge page to unknown agents. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Request headers shared by the HTML engines. */
function htmlHeaders(lang) {
  return {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
  };
}

/** JSON/API headers. */
function apiHeaders() {
  return { 'user-agent': USER_AGENT, accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' };
}

/**
 * Turn a transport error into something actionable.
 *
 * `fetch` reports every network-level problem as the same `TypeError: fetch
 * failed`, hiding the real reason in `cause` (ENOTFOUND / ECONNREFUSED /
 * CERT_HAS_EXPIRED / an invalid header value …). Custom engines live or die by
 * that detail, so it is always included, along with the host that failed.
 */
function describeTransportError(error, url) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep the raw string */
  }
  const cause = error?.cause;
  const detail = cause === undefined ? '' : ` (${String(cause?.code ?? cause?.name ?? cause)}${cause?.message ? `: ${String(cause.message).slice(0, 120)}` : ''})`;
  return `${host}: ${String(error?.message ?? error).slice(0, 120)}${detail}`;
}

/**
 * One HTTP request with a hard deadline.
 *
 * A *transport* failure (DNS blip, TLS hiccup, connection reset) is retried once
 * after a short pause: public search surfaces and API endpoints both drop a
 * request now and then, and a single dropped connection otherwise costs an
 * engine a cooldown. HTTP status codes are never retried — they are results.
 *
 * @param {string} url
 * @param {{headers?:Record<string,string>,timeoutMs?:number,signal?:AbortSignal,method?:string,body?:string,retry?:boolean}} [opts]
 * @returns {Promise<{status:number,text:string,finalUrl:string}>}
 */
export async function fetchText(url, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : 12000;
  const outer = opts.signal;
  const attempts = opts.retry === false ? 1 : 2;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => controller.abort(outer.reason);
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        body: opts.body,
        redirect: 'follow',
        signal: controller.signal,
        headers: { ...(opts.headers ?? {}) },
      });
      const text = await res.text();
      return { status: res.status, text, finalUrl: res.url || url };
    } catch (error) {
      const aborted = outer?.aborted === true || controller.signal.aborted === true;
      const wrapped = new Error(`request failed: ${aborted ? (outer?.aborted ? 'aborted' : 'timeout') : describeTransportError(error, url)}`);
      wrapped.cause = error;
      lastError = wrapped;
      // Our own cancellation is final; a transport error is worth one retry.
      if (aborted || attempt === attempts - 1) throw wrapped;
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (outer?.aborted) throw wrapped;
    } finally {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onAbort);
    }
  }
  throw lastError ?? new Error('request failed');
}

/** Decode the HTML entities the engines actually emit. */
export function decodeEntities(input) {
  return String(input ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ensp;/gi, ' ')
    .replace(/&emsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Drop characters that are not text: undecodable bytes and lone surrogates.
 *
 * Chinese result pages routinely carry emoji that arrives as `U+FFFD` (or as a
 * broken half of a surrogate pair) once the bytes are decoded, which then shows
 * up as `真身曝光!ߔ` in a title. Control characters go too — a newline inside a
 * title breaks the one-line card layout.
 */
export function sanitiseText(input) {
  return String(input ?? '')
    .replace(/\uFFFD+/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // With the `u` flag a *paired* surrogate is one code point above U+FFFF, so
    // this only ever matches an unpaired half.
    .replace(/[\u{D800}-\u{DFFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tags → decode entities → collapse whitespace. Snippet-safe. */
export function text(input) {
  return sanitiseText(
    decodeEntities(
      String(input ?? '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        // Engines slice HTML by character offset, so a tag can arrive cut in
        // half: without these two the raw attribute text ("<div class="cos-row
        // cos-row-c"") ends up in the snippet, which baidu really does.
        .replace(/<[^>]*$/, ' ')
        .replace(/^[^<>]*=[^<>]*>/, ' '),
    ),
  );
}

/** Bing/DDG wrap result links; unwrap the common redirectors. */
export function unwrapUrl(rawUrl, base) {
  let url = decodeEntities(String(rawUrl ?? '').trim());
  if (url.startsWith('//')) url = `https:${url}`;
  if (url.startsWith('/')) {
    try {
      url = new URL(url, base).toString();
    } catch {
      return '';
    }
  }
  try {
    const parsed = new URL(url);
    const target =
      parsed.searchParams.get('uddg') ??
      parsed.searchParams.get('url') ??
      parsed.searchParams.get('u') ??
      parsed.searchParams.get('target');
    if (target && /^https?:\/\//i.test(target)) return target;
    if (parsed.hostname.endsWith('bing.com') && parsed.pathname === '/ck/a') {
      const encoded = parsed.searchParams.get('u');
      if (encoded) {
        const payload = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        try {
          const decoded = Buffer.from(padded, 'base64').toString('utf8');
          if (/^https?:\/\//i.test(decoded)) return decoded;
        } catch {
          /* keep the bing link */
        }
      }
    }
    return url;
  } catch {
    return /^https?:\/\//i.test(url) ? url : '';
  }
}

/** Split an HTML document into result blocks by a marker occurrence. */
function splitBlocks(html, marker, limit) {
  const blocks = [];
  let index = html.indexOf(marker);
  while (index !== -1 && blocks.length < limit) {
    const next = html.indexOf(marker, index + marker.length);
    blocks.push(html.slice(index, next === -1 ? Math.min(html.length, index + 20000) : next));
    index = next;
  }
  return blocks;
}

function trimSnippet(value, max = 420) {
  const clean = text(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * Hosts whose pages are the engine's own result/redirect surfaces rather than a
 * durable source. `baike.baidu.com` and friends stay: they are real articles.
 */
const ENGINE_INTERNAL_HOSTS = /(^|\.)bing\.com$|(^|\.)so\.com$|^www\.baidu\.com$|^m\.baidu\.com$|(^|\.)duckduckgo\.com$/i;

/** Normalise + drop junk (redirectors, engine-internal pages, duplicates). */
function finalize(sources, maxResults) {
  const seen = new Set();
  const out = [];
  for (const source of sources) {
    if (!source || !isHttpUrl(source.url)) continue;
    let host = '';
    try {
      host = new URL(source.url).hostname;
    } catch {
      continue;
    }
    // Drop engine-internal result pages (they are summaries, not durable sources).
    if (ENGINE_INTERNAL_HOSTS.test(host)) continue;
    const key = source.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const title = text(source.title);
    // Tags never belong in a snippet (baidu occasionally hands one back with raw
    // markup in it), and the HTML surfaces put the publish date at the front of
    // the snippet instead of in markup, so both are handled here for every engine.
    const cleaned = text(source.snippet);
    const dated = cleaned === '' ? { snippet: '', publishedAt: undefined } : dateFromSnippet(cleaned);
    const publishedAt = source.publishedAt ?? dated.publishedAt;
    out.push({
      url: source.url,
      ...(title ? { title } : {}),
      ...(dated.snippet ? { snippet: dated.snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
    if (out.length >= maxResults) break;
  }
  return out;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/* -------------------------------------------------------------------------- */
/* Bing — RSS and HTML                                                        */
/* -------------------------------------------------------------------------- */

const BING_MARKETS = {
  'zh-CN': { mkt: 'zh-CN', setlang: 'zh-CN', cc: 'CN' },
  'zh-TW': { mkt: 'zh-TW', setlang: 'zh-TW', cc: 'TW' },
  en: { mkt: 'en-US', setlang: 'en', cc: 'US' },
};

function bingMarket(region, lang) {
  if (region && BING_MARKETS[region]) return BING_MARKETS[region];
  if (lang === 'en') return BING_MARKETS.en;
  return BING_MARKETS['zh-CN'];
}

/** Rewrite Bing's tracking links (`bing.com/ck/a?...&u=a1<base64url>`). */
function bingRssLink(raw) {
  return unwrapUrl(raw, 'https://www.bing.com/');
}

/**
 * Parse Bing's RSS surface. Exported so the parser can be tested offline against
 * a saved fixture — the HTML surfaces change without warning and a live-only
 * test would stay green while production broke.
 */
export function parseBingRss(body, maxResults) {
  const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  if (items.length === 0) {
    if (/captcha|unusual traffic/i.test(body)) fail('ENGINE_BLOCKED', 'bing served a challenge page');
    fail('ENGINE_EMPTY', 'bing rss returned no items');
  }
  const sources = items.map((item) => {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1];
    const link = (item.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1];
    const description = (item.match(/<description>([\s\S]*?)<\/description>/) ?? [])[1];
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1];
    const publishedAt = pubDate ? normaliseDate(pubDate) : undefined;
    return {
      url: bingRssLink((link ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()),
      title: (title ?? '').replace(/<!\[CDATA\[|\]\]>/g, ''),
      snippet: trimSnippet(description),
      ...(publishedAt ? { publishedAt } : {}),
    };
  });
  return finalize(sources, maxResults);
}

const bing = {
  id: 'bing',
  label: 'Bing 必应',
  labelEn: 'Bing',
  badge: 'FREE',
  note: '必应 RSS 结果：最快、最稳，解析几乎不受页面改版影响',
  noteEn: 'Bing RSS: fastest and the most parse-stable surface',
  defaultEnabled: true,
  async search({ query, maxResults, region, lang, timeoutMs, signal }) {
    const market = bingMarket(region, lang);
    // No freshness parameter here on purpose: see the note on `recency` in
    // lib/host.js — Bing ignores every keyless form of it, so date filtering
    // happens on the parsed results instead of being promised to the engine.
    const url =
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss` +
      `&count=${Math.min(Math.max(maxResults * 2, 10), 50)}&mkt=${market.mkt}&setlang=${market.setlang}&cc=${market.cc}`;
    const { status, text: body } = await fetchText(url, { headers: apiHeaders(), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `bing rss http ${status}`);
    return parseBingRss(body, maxResults);
  },
};

/** Parse Bing's HTML surface (exported for offline fixture tests). */
export function parseBingHtml(body, maxResults) {
  const blocks = splitBlocks(body, 'class="b_algo"', maxResults * 3);
  if (blocks.length === 0) {
    if (/captcha|unusual traffic/i.test(body)) fail('ENGINE_BLOCKED', 'bing served a challenge page');
    fail('ENGINE_EMPTY', 'bing html returned no result blocks');
  }
  const sources = [];
  for (const block of blocks) {
    const anchor = block.match(/<h2[^>]*>[\s\S]{0,600}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const snippet =
      (block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ?? [])[1] ??
      (block.match(/<div class="b_caption"[\s\S]{0,400}?<p[^>]*>([\s\S]*?)<\/p>/i) ?? [])[1] ??
      (block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ?? [])[1];
    sources.push({
      url: unwrapUrl(anchor[1], 'https://www.bing.com/'),
      title: anchor[2],
      snippet: trimSnippet(snippet),
    });
  }
  return finalize(sources, maxResults);
}

const bingWeb = {
  id: 'bing-web',
  label: 'Bing 网页版',
  labelEn: 'Bing (HTML)',
  badge: 'FREE',
  note: '必应网页版：摘要更完整，页面改版时可能失效',
  noteEn: 'Bing HTML: richer snippets, breaks when the page changes',
  defaultEnabled: true,
  async search({ query, maxResults, region, lang, timeoutMs, signal }) {
    const market = bingMarket(region, lang);
    const url =
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(maxResults, 10), 30)}` +
      `&mkt=${market.mkt}&setlang=${market.setlang}&cc=${market.cc}`;
    const { status, text: body } = await fetchText(url, { headers: htmlHeaders(lang), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `bing http ${status}`);
    return parseBingHtml(body, maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* Baidu / 360 — China-friendly HTML engines                                  */
/* -------------------------------------------------------------------------- */

/**
 * Parse Baidu's HTML surface (exported for offline fixture tests).
 *
 * Block detection comes first: Baidu answers a rate-limited client with a
 * `wappass.baidu.com` verification page, and reporting that as "no results"
 * would hide a rate limit from the health tracker.
 */
export function parseBaiduHtml(body, maxResults) {
  const hasResults = /c-container/.test(body);
  if (/wappass\.baidu\.com|安全验证|请输入验证码|timeout-title/.test(body) || (!hasResults && body.length < 4000)) {
    fail('ENGINE_BLOCKED', 'baidu served a verification page (rate limited)');
  }
  const blocks = splitBlocks(body, 'class="result', maxResults * 4).filter((block) => /c-container/.test(block));
  if (blocks.length === 0) fail('ENGINE_EMPTY', 'baidu returned no result blocks');
  const sources = [];
  for (const block of blocks) {
    const anchor = block.match(/<h3[^>]*>[\s\S]{0,400}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const mu = (block.match(/\bmu="(https?:\/\/[^"]+)"/i) ?? [])[1];
    const snippet =
      (block.match(/<div class="c-abstract"[^>]*>([\s\S]*?)<\/div>/i) ?? [])[1] ??
      (block.match(/<span class="content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ?? [])[1] ??
      (block.match(/<div class="c-span-last"[^>]*>([\s\S]*?)<\/div>/i) ?? [])[1] ??
      (block.match(/<span class="c-color-text"[^>]*>([\s\S]*?)<\/span>/i) ?? [])[1] ??
      // Generic fallback: the prose right after the title, minus any trailing widgets.
      text(block.slice(block.indexOf('</h3>') + 5, block.indexOf('</h3>') + 2200));
    sources.push({
      url: mu ? decodeEntities(mu) : unwrapUrl(anchor[1], 'https://www.baidu.com/'),
      title: anchor[2],
      snippet: trimSnippet(snippet),
    });
  }
  return finalize(sources, maxResults);
}

const baidu = {
  id: 'baidu',
  label: '百度',
  labelEn: 'Baidu',
  badge: 'FREE',
  note: '中文结果覆盖率高的 HTML 引擎；触发风控时会自动降级',
  noteEn: 'Strong Chinese coverage; degrades automatically on rate limits',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal }) {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${Math.min(maxResults * 2, 50)}&ie=utf-8`;
    const { status, text: body } = await fetchText(url, { headers: htmlHeaders('zh'), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `baidu http ${status}`);
    return parseBaiduHtml(body, maxResults);
  },
};

/**
 * Parse 360's HTML surface (exported for offline fixture tests).
 *
 * 360 answers an automated client with a tiny `qcaptcha` shell page instead of
 * results; that must be classified as a block, not as "the page has no results".
 */
export function parseSo360Html(body, maxResults) {
  const blocks = splitBlocks(body, 'class="res-list', maxResults * 3);
  if (blocks.length === 0) {
    if (/qcaptcha|antispider|sou\/antispider|captcha/i.test(body)) fail('ENGINE_BLOCKED', 'so360 served an anti-bot page');
    fail('ENGINE_EMPTY', 'so360 returned no result blocks');
  }
  const sources = [];
  for (const block of blocks) {
    const anchor =
      block.match(/<a[^>]*href="([^"]+)"[^>]*data-mdurl="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<a[^>]*data-mdurl="(https?:\/\/[^"]+)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    let url2 = '';
    let title = '';
    if (anchor) {
      const first = anchor[1];
      const second = anchor[2];
      if (/^https?:\/\//i.test(first) && !/so\.com\//i.test(first)) {
        url2 = first;
        title = anchor[3];
      } else if (/^https?:\/\//i.test(second)) {
        url2 = second;
        title = anchor[3];
      } else {
        url2 = unwrapUrl(first, 'https://www.so.com/');
        title = anchor[3];
      }
    }
    if (!url2) {
      const plain = block.match(/<h3[^>]*>[\s\S]{0,300}?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!plain) continue;
      url2 = unwrapUrl(plain[1], 'https://www.so.com/');
      title = plain[2];
    }
    const snippet =
      (block.match(/<p class="res-desc"[^>]*>([\s\S]*?)<\/p>/i) ?? [])[1] ??
      (block.match(/<p class="res-rich[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ?? [])[1] ??
      (block.match(/<div class="res-desc"[^>]*>([\s\S]*?)<\/div>/i) ?? [])[1];
    sources.push({ url: url2, title, snippet: trimSnippet(snippet) });
  }
  return finalize(sources, maxResults);
}

const so360 = {
  id: 'so360',
  label: '360 搜索',
  labelEn: '360 Search',
  badge: 'FREE',
  note: '中文 HTML 引擎，结果直连（data-mdurl 已解开跳转）；有反爬风控',
  noteEn: 'Chinese HTML engine; real URLs come from data-mdurl; anti-bot risk',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal }) {
    const url = `https://www.so.com/s?q=${encodeURIComponent(query)}&pn=1`;
    const { status, text: body } = await fetchText(url, { headers: htmlHeaders('zh'), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `so360 http ${status}`);
    return parseSo360Html(body, maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* DuckDuckGo — excellent outside mainland China                              */
/* -------------------------------------------------------------------------- */

const duckduckgo = {
  id: 'duckduckgo',
  label: 'DuckDuckGo',
  labelEn: 'DuckDuckGo',
  badge: 'FREE',
  note: '隐私友好，无需 key；中国大陆网络通常不可达',
  noteEn: 'Privacy friendly, keyless; usually unreachable from mainland China',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal }) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { status, text: body } = await fetchText(url, { headers: htmlHeaders('en'), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `duckduckgo http ${status}`);
    const blocks = splitBlocks(body, 'class="result results_links', Math.max(maxResults * 2, 12));
    if (blocks.length === 0) fail('ENGINE_EMPTY', 'duckduckgo returned no result blocks');
    const sources = [];
    for (const block of blocks) {
      const anchor = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchor) continue;
      const snippet = (block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ?? [])[1];
      sources.push({
        url: unwrapUrl(anchor[1], 'https://html.duckduckgo.com/'),
        title: anchor[2],
        snippet: trimSnippet(snippet),
      });
    }
    return finalize(sources, maxResults);
  },
};

const ddgLite = {
  id: 'ddg-lite',
  label: 'DuckDuckGo Lite',
  labelEn: 'DuckDuckGo Lite',
  badge: 'FREE',
  note: 'DDG 极简版：体积小、解析简单，适合网络受限环境做兜底',
  noteEn: 'DDG Lite: tiny responses, simple parse, good last-resort',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal }) {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const { status, text: body } = await fetchText(url, { headers: htmlHeaders('en'), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `ddg-lite http ${status}`);
    const anchors = [...body.matchAll(/<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    if (anchors.length === 0) fail('ENGINE_EMPTY', 'ddg-lite returned no results');
    const snippets = [...body.matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const sources = anchors.map((anchor, index) => ({
      url: unwrapUrl(anchor[1], 'https://lite.duckduckgo.com/'),
      title: anchor[2],
      snippet: trimSnippet(snippets[index]),
    }));
    return finalize(sources, maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* SearXNG — public metasearch instances                                      */
/* -------------------------------------------------------------------------- */

/** Public instances that answer the JSON API; one reachable is enough. */
export const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.inetol.net',
  'https://baresearch.org',
  'https://priv.au',
  'https://searxng.site',
];

const searxng = {
  id: 'searxng',
  label: 'SearXNG 公共实例',
  labelEn: 'SearXNG (public)',
  badge: 'FREE',
  note: '元搜索：聚合多家结果；公共实例偶尔限流或禁用 JSON 接口',
  noteEn: 'Metasearch across engines; public instances rate-limit sometimes',
  defaultEnabled: true,
  options: { instances: SEARXNG_INSTANCES },
  async search({ query, maxResults, timeoutMs, signal, options }) {
    const instances = Array.isArray(options?.instances) && options.instances.length > 0 ? options.instances : SEARXNG_INSTANCES;
    // Public instances are frequently slow or blocked, so race them in parallel
    // under one short per-instance deadline instead of walking the list serially.
    const perInstance = Math.min(Math.max(Math.floor(timeoutMs / 2), 2500), 5000);
    const attempt = async (instance) => {
      const url = `${instance.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0`;
      const { status, text: body } = await fetchText(url, { headers: apiHeaders(), timeoutMs: perInstance, signal });
      if (status !== 200) throw new Error(`${instance} http ${status}`);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`${instance} not-json`);
      }
      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      if (results.length === 0) throw new Error(`${instance} empty`);
      const sources = results.slice(0, maxResults * 2).map((item) => ({
        url: item.url,
        title: item.title,
        snippet: trimSnippet(item.content),
        ...(item.publishedDate ? { publishedAt: normaliseDate(item.publishedDate) } : {}),
      }));
      const finalized = finalize(sources, maxResults);
      if (finalized.length === 0) throw new Error(`${instance} filtered-empty`);
      return finalized;
    };
    try {
      return await Promise.any(instances.map((instance) => attempt(instance)));
    } catch (error) {
      const reasons = (error?.errors ?? []).slice(0, 3).map((item) => String(item?.message ?? item));
      fail('ENGINE_UNREACHABLE', `searxng: no instance answered${reasons.length > 0 ? ` (${reasons.join('; ')})` : ''}`);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Wikipedia — factual fallback with a clean API                              */
/* -------------------------------------------------------------------------- */

const wikipedia = {
  id: 'wikipedia',
  label: 'Wikipedia 维基百科',
  labelEn: 'Wikipedia',
  badge: 'FREE',
  note: '事实型查询的好兜底（官方 API，无 key）；中国大陆不可达',
  noteEn: 'Great factual fallback (official API, keyless); blocked in mainland China',
  defaultEnabled: true,
  async search({ query, maxResults, lang, timeoutMs, signal }) {
    const wikiLang = lang === 'en' ? 'en' : 'zh';
    const url =
      `https://${wikiLang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
      `&format=json&utf8=1&srlimit=${Math.min(maxResults * 2, 20)}&srprop=snippet|timestamp`;
    const { status, text: body } = await fetchText(url, { headers: apiHeaders(), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `wikipedia http ${status}`);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      fail('ENGINE_PARSE', 'wikipedia returned a non-JSON body');
    }
    const results = parsed?.query?.search;
    if (!Array.isArray(results) || results.length === 0) fail('ENGINE_EMPTY', 'wikipedia returned no results');
    const sources = results.map((item) => ({
      url: `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(String(item.title).replace(/ /g, '_'))}`,
      title: item.title,
      snippet: trimSnippet(item.snippet),
      ...(item.timestamp ? { publishedAt: normaliseDate(item.timestamp) } : {}),
    }));
    return finalize(sources, maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* Mojeek — independent index                                                 */
/* -------------------------------------------------------------------------- */

const mojeek = {
  id: 'mojeek',
  label: 'Mojeek',
  labelEn: 'Mojeek',
  badge: 'FREE',
  note: '独立索引（不转售 Google/Bing）；有反自动化风控',
  noteEn: 'Independent index; has anti-automation responses',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal }) {
    const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
    const { status, text: body } = await fetchText(url, { headers: htmlHeaders('en'), timeoutMs, signal });
    if (status !== 200) fail('ENGINE_HTTP', `mojeek http ${status}`);
    if (/automated queries|Forbidden/i.test(body) && body.length < 4000) fail('ENGINE_BLOCKED', 'mojeek rejected automated queries');
    const blocks = splitBlocks(body, '<li>\n<h2>', maxResults * 2);
    const usable = blocks.length > 0 ? blocks : splitBlocks(body, 'class="results-standard"', 1);
    if (usable.length === 0) fail('ENGINE_EMPTY', 'mojeek returned no result blocks');
    const sources = [];
    for (const block of usable) {
      const anchor = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchor) continue;
      const snippet = (block.match(/<p class="s"[^>]*>([\s\S]*?)<\/p>/i) ?? [])[1];
      sources.push({
        url: unwrapUrl(anchor[1], 'https://www.mojeek.com/'),
        title: anchor[2],
        snippet: trimSnippet(snippet),
      });
    }
    return finalize(sources, maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* AnySearch / Exa — anonymous JSON APIs                                      */
/* -------------------------------------------------------------------------- */

/**
 * AnySearch's public v1 endpoint serves an anonymous quota: no key, no account,
 * a small per-IP rate limit. Unlike the HTML engines this is a real API, so a
 * page redesign cannot break it — the trade is latency (~1.5-3s vs ~250ms for
 * Bing RSS) and an opaque quota.
 *
 * The envelope carries its own status: HTTP 200 with `code !== 0` is a failure
 * (quota, bad request), not an empty result set, so it must not be reported as
 * "no results" — that would hide a rate limit from the chain's health tracking.
 */
export function parseAnySearchPayload(payload, maxResults) {
  let parsed;
  try {
    parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    fail('ENGINE_PARSE', 'anysearch returned a non-JSON body');
  }
  if (parsed === null || typeof parsed !== 'object') fail('ENGINE_PARSE', 'anysearch returned a non-object body');
  // `code` is the envelope status. Treat a missing/`"0"` code as success (some
  // responses omit it) instead of failing a perfectly good result set.
  const code = parsed.code === undefined || parsed.code === null ? 0 : parsed.code;
  if (Number(code) !== 0) {
    const message = String(parsed.message ?? '').slice(0, 120);
    // The anonymous tier reports its limit inside the envelope, not as HTTP 429,
    // and its wording is not guaranteed to be English.
    if (Number(code) === 429 || /rate|limit|quota|too many|频繁|限流|额度|配额|超出/i.test(message)) {
      fail('ENGINE_BLOCKED', `anysearch anonymous quota: code ${code}${message ? ` (${message})` : ''}`);
    }
    fail('ENGINE_PARSE', `anysearch api code ${code}: ${message}`);
  }
  const results = Array.isArray(parsed?.data?.results) ? parsed.data.results : [];
  if (results.length === 0) fail('ENGINE_EMPTY', 'anysearch returned no results');
  const sources = results.map((item) => {
    const date = item?.published_at ?? item?.publishedAt ?? item?.date;
    return {
      url: item?.url,
      title: item?.title,
      snippet: trimSnippet(item?.snippet),
      ...(date ? { publishedAt: normaliseDate(String(date)) } : {}),
    };
  });
  return finalize(sources, maxResults);
}

const anysearch = {
  id: 'anysearch',
  label: 'AnySearch',
  labelEn: 'AnySearch',
  badge: 'FREE',
  note: 'AnySearch 公开 API 匿名额度：JSON 结果，不受页面改版影响；比 HTML 引擎慢',
  noteEn: 'AnySearch public API, anonymous quota: JSON results immune to page redesigns; slower than HTML',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal }) {
    const { status, text: body } = await fetchText('https://api.anysearch.com/v1/search', {
      method: 'POST',
      headers: { ...apiHeaders(), 'content-type': 'application/json' },
      // The public endpoint hard-caps at 10 results per call.
      body: JSON.stringify({ query, max_results: Math.min(Math.max(maxResults, 1), 10) }),
      timeoutMs,
      signal,
    });
    if (status === 429) fail('ENGINE_BLOCKED', 'anysearch anonymous quota rate limited');
    if (status !== 200) fail('ENGINE_HTTP', `anysearch http ${status}`);
    return parseAnySearchPayload(body, maxResults);
  },
};

/**
 * Exa's public MCP endpoint answers anonymous `tools/call` requests, so the
 * semantic index is usable without a key (a key raises the quota). It speaks
 * JSON-RPC over either a plain JSON body or an SSE stream — both are handled,
 * because the same endpoint has returned each at different times.
 *
 * The tool renders results as text blocks shaped `Title: / URL: / Published: /
 * Highlights:`; there is no JSON field to read, so the blocks are parsed here.
 */
export function parseExaMcpBody(body) {
  const raw = String(body ?? '');
  const frames = [];
  if (/^\s*(event|data):/m.test(raw)) {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '' || payload === '[DONE]') continue;
      try {
        frames.push(JSON.parse(payload));
      } catch {
        /* a non-JSON frame is not the answer frame */
      }
    }
  } else {
    try {
      frames.push(JSON.parse(raw));
    } catch {
      fail('ENGINE_PARSE', 'exa returned a non-JSON body');
    }
  }
  const frame = frames.find((entry) => entry !== null && typeof entry === 'object' && (entry.result !== undefined || entry.error !== undefined)) ?? frames[0];
  if (frame === undefined) fail('ENGINE_PARSE', 'exa returned no JSON-RPC frame');
  if (frame.error !== undefined) fail('ENGINE_PARSE', `exa jsonrpc error: ${String(frame.error?.message ?? JSON.stringify(frame.error)).slice(0, 120)}`);
  // Exa signals an exhausted anonymous quota as HTTP 200 + a *text result*
  // ("You've hit Exa's free MCP rate limit…") and marks it in `_meta`. This is
  // checked *before* `isError`, because a rate-limited call can also arrive with
  // `isError: true` — checking that first would mislabel a quota problem as an
  // empty result and hide the real cause from the caller and the health view.
  if (frame?.result?._meta?.['ai.exa/rateLimited'] === true) {
    fail('ENGINE_BLOCKED', 'exa free MCP quota exhausted (anonymous tier)');
  }
  if (frame?.result?.isError === true) fail('ENGINE_EMPTY', 'exa reported an empty result');
  const content = Array.isArray(frame?.result?.content) ? frame.result.content : [];
  const text = content
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n');
  if (text.trim() === '') fail('ENGINE_EMPTY', 'exa returned no text content');
  if (/free MCP rate limit|rate limit reached|quota exceeded/i.test(text) && !/^Title:/m.test(text)) {
    fail('ENGINE_BLOCKED', 'exa free MCP quota exhausted (anonymous tier)');
  }
  return text;
}

/** One `Field: value` line out of an Exa result block ('' for `N/A`). */
function exaField(block, name) {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(block);
  const value = match === null ? '' : match[1].trim();
  return value === '' || value === 'N/A' ? '' : value;
}

export function parseExaMcpText(text, maxResults) {
  // Split on the block marker and keep only real blocks: the body may start
  // directly with `Title:` (no preamble) or carry one, so dropping the first
  // element blindly would silently lose a result.
  const blocks = String(text ?? '')
    .split(/\n(?=Title:\s*)/)
    .filter((block) => /^Title:\s*/m.test(block));
  if (blocks.length === 0) fail('ENGINE_EMPTY', 'exa returned no result blocks');
  const sources = [];
  for (const block of blocks) {
    const url = exaField(block, 'URL');
    if (!/^https?:\/\//i.test(url)) continue;
    const published = exaField(block, 'Published');
    // `Highlights:` may be on its own line (usual) or inline with the text, so
    // the split must not require the line to end there.
    const highlights = block.split(/^Highlights:\s*/m)[1] ?? '';
    const snippet = highlights
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== 'N/A' && !/^\.{3}$/.test(line) && !/^-{2,}$/.test(line))
      .slice(0, 3)
      .join(' ');
    sources.push({
      url,
      title: exaField(block, 'Title'),
      snippet: trimSnippet(snippet),
      ...(published ? { publishedAt: normaliseDate(published) } : {}),
    });
  }
  if (sources.length === 0) fail('ENGINE_PARSE', 'exa returned blocks without usable URLs');
  return finalize(sources, maxResults);
}

const exa = {
  id: 'exa',
  label: 'Exa',
  labelEn: 'Exa',
  badge: 'FREE',
  // The anonymous MCP tier is rate-limited very tightly; an Exa key raises it
  // (the key travels as `?exaApiKey=` on the same MCP endpoint).
  keyOptional: true,
  envKey: 'EXA_API_KEY',
  note: 'Exa 公开 MCP 匿名额度：语义检索，摘要为高亮片段；额度很紧，填 key 可提额',
  noteEn: 'Exa public MCP, anonymous quota: semantic search with highlight snippets; tight quota, a key raises it',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal, key }) {
    const keyed = typeof key === 'string' && key.trim() !== '';
    const url = keyed ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(key.trim())}` : 'https://mcp.exa.ai/mcp';
    const { status, text: body } = await fetchText(url, {
      method: 'POST',
      headers: { ...apiHeaders(), accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'web_search_exa', arguments: { query, numResults: Math.min(Math.max(maxResults, 1), 20) } },
      }),
      timeoutMs,
      signal,
    });
    if (status === 401 || status === 403) fail('ENGINE_NO_KEY', keyed ? 'exa rejected the API key' : 'exa refused the anonymous tier');
    if (status === 406) fail('ENGINE_HTTP', 'exa needs accept: application/json, text/event-stream');
    if (status === 429) fail('ENGINE_BLOCKED', keyed ? 'exa rate limit reached' : 'exa anonymous quota rate limited');
    if (status !== 200) fail('ENGINE_HTTP', `exa http ${status}`);
    return parseExaMcpText(parseExaMcpBody(body), maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* Tavily — AI search API with an anonymous tier                              */
/* -------------------------------------------------------------------------- */

/**
 * Tavily returns distilled answer-ready snippets, which makes it a strong
 * *complement* to the keyless engines rather than a replacement.
 *
 * It has two tiers on the same endpoint: with a key it runs on the account
 * quota; without one it runs on the `x-tavily-access-mode: keyless` anonymous
 * quota. So `keyOptional` (not `needsKey`) is the right flag — the engine stays
 * in the chain with no key at all, and a key is an upgrade.
 *
 * The key is sent twice on purpose: `api_key` in the body is Tavily's classic
 * shape and `Authorization: Bearer` is the newer one; the service accepts both,
 * and sending both keeps one engine working across account generations.
 */
const tavily = {
  id: 'tavily',
  label: 'Tavily',
  labelEn: 'Tavily',
  badge: 'FREE',
  keyOptional: true,
  envKey: 'TAVILY_API_KEY',
  note: 'AI 搜索 API：不填 key 走匿名额度，填 key 提升额度与稳定性；摘要已提炼',
  noteEn: 'AI search API: anonymous quota without a key, a key raises it; distilled snippets',
  defaultEnabled: true,
  async search({ query, maxResults, timeoutMs, signal, key, depth }) {
    const keyed = typeof key === 'string' && key.trim() !== '';
    // The anonymous tier hard-caps at 10 results; the account tier allows 20.
    const cap = keyed ? 20 : 10;
    const payload = {
      query,
      max_results: Math.min(Math.max(maxResults, 1), cap),
      search_depth: depth === 'deep' ? 'advanced' : 'basic',
      include_answer: false,
      include_raw_content: false,
    };
    const headers = { ...apiHeaders(), 'content-type': 'application/json' };
    if (keyed) {
      payload.api_key = key.trim();
      headers.authorization = `Bearer ${key.trim()}`;
    } else {
      headers['x-tavily-access-mode'] = 'keyless';
    }
    const { status, text: body } = await fetchText('https://api.tavily.com/search', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs,
      signal,
    });
    if (status === 401 || status === 403) {
      fail('ENGINE_NO_KEY', keyed ? 'tavily rejected the API key' : 'tavily refused the keyless tier (quota or IP)');
    }
    if (status === 429) fail('ENGINE_BLOCKED', keyed ? 'tavily rate limit reached' : 'tavily anonymous quota exhausted');
    if (status !== 200) fail('ENGINE_HTTP', `tavily http ${status}`);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      fail('ENGINE_PARSE', 'tavily returned a non-JSON body');
    }
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    if (results.length === 0) fail('ENGINE_EMPTY', 'tavily returned no results');
    const sources = results.map((item) => ({
      url: item?.url,
      title: item?.title,
      snippet: trimSnippet(item?.content),
      ...(item?.published_date ? { publishedAt: normaliseDate(item.published_date) } : {}),
    }));
    return finalize(sources, maxResults);
  },
};

/* -------------------------------------------------------------------------- */
/* Custom engines                                                             */
/* -------------------------------------------------------------------------- */

/** `a.b.c` / `data.items` → the value at that path (undefined when missing). */
function pickPath(value, path) {
  if (typeof path !== 'string' || path.trim() === '') return undefined;
  return path
    .trim()
    .split('.')
    .reduce((current, segment) => {
      if (current === null || current === undefined) return undefined;
      const key = segment.trim();
      if (key === '') return current;
      if (Array.isArray(current)) {
        const index = Number(key);
        return Number.isInteger(index) ? current[index] : undefined;
      }
      return typeof current === 'object' ? current[key] : undefined;
    }, value);
}

/** First non-empty value across a `a|b|c` fallback chain. */
function pickFirst(value, paths) {
  for (const path of String(paths ?? '').split('|')) {
    const found = pickPath(value, path);
    if (found !== undefined && found !== null && found !== '') return found;
  }
  return undefined;
}

/** `{query}` · `{queryRaw}` · `{key}` · `{maxResults}` · `{lang}` · `{region}` */
function fillTemplate(template, values) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, name) => (values[name] !== undefined ? String(values[name]) : match));
}

function parseJsonObject(raw, label) {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    fail('CUSTOM_INVALID', `${label} must be a JSON object`);
  } catch (error) {
    if (error?.code === 'CUSTOM_INVALID') throw error;
    fail('CUSTOM_INVALID', `${label} is not valid JSON: ${String(error?.message ?? error)}`);
  }
}

/** RSS 2.0 `<item>` and Atom `<entry>` — enough for feed-shaped search APIs. */
function parseFeed(body, maxResults) {
  const blocks = [...body.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map((match) => match[0]);
  if (blocks.length === 0) fail('ENGINE_EMPTY', 'custom feed returned no entries');
  const sources = [];
  for (const block of blocks) {
    const link = (block.match(/<link[^>]*href="([^"]+)"/i) ?? block.match(/<link>([\s\S]*?)<\/link>/i) ?? [])[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1];
    const description =
      (block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) ?? [])[1];
    const published = (block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i) ?? [])[1];
    sources.push({
      url: decodeEntities(String(link ?? '').trim()),
      title,
      snippet: trimSnippet(description),
      ...(published ? { publishedAt: normaliseDate(published) } : {}),
    });
    if (sources.length >= maxResults * 2) break;
  }
  return sources;
}

const CUSTOM_TYPES = ['json', 'rss', 'searxng'];
const CUSTOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MAX_CUSTOM_RESULTS = 25;

/**
 * Normalise one user-declared engine definition (shared by compile + status).
 * @returns {{id:string,label:string,type:string,url:string,method:string,headers:string,body:string,resultsPath:string,titlePath:string,urlPath:string,snippetPath:string,publishedAtPath:string,enabled:boolean,hasKey:boolean}|null}
 */
export function normaliseCustomEngine(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim().toLowerCase();
  if (!CUSTOM_ID_PATTERN.test(id)) return null;
  if (BUILTIN_IDS.includes(id)) return null;
  const url = String(raw.url ?? '').trim();
  if (url === '' || !/^https?:\/\//i.test(url)) return null;
  const type = CUSTOM_TYPES.includes(raw.type) ? raw.type : 'json';
  const method = type === 'json' && String(raw.method ?? '').toUpperCase() === 'POST' ? 'POST' : 'GET';
  return {
    id,
    label: String(raw.label ?? id).trim().slice(0, 40) || id,
    type,
    url: url.slice(0, 2000),
    method,
    headers: typeof raw.headers === 'string' ? raw.headers.slice(0, 4000) : '',
    body: method === 'POST' && typeof raw.body === 'string' ? raw.body.slice(0, 8000) : '',
    resultsPath: String(raw.resultsPath ?? '').trim().slice(0, 200),
    titlePath: String(raw.titlePath ?? 'title').trim().slice(0, 200),
    urlPath: String(raw.urlPath ?? 'url').trim().slice(0, 200),
    snippetPath: String(raw.snippetPath ?? 'content|description|snippet').trim().slice(0, 200),
    publishedAtPath: String(raw.publishedAtPath ?? 'published_date|published|date').trim().slice(0, 200),
    enabled: raw.enabled !== false,
  };
}

/**
 * Compile one custom definition into a runnable engine, or null when invalid.
 * The definition is fully declarative: template + paths, no user code runs.
 */
export function compileCustomEngine(raw) {
  const definition = normaliseCustomEngine(raw);
  if (definition === null) return null;
  const engine = {
    id: definition.id,
    label: definition.label,
    labelEn: definition.label,
    badge: 'CUSTOM',
    needsKey: false,
    custom: true,
    definition,
    note: `自定义引擎（${definition.type}）· ${definition.url.replace(/^https?:\/\//, '').split('/')[0]}`,
    noteEn: `Custom engine (${definition.type}) · ${definition.url.replace(/^https?:\/\//, '').split('/')[0]}`,
    defaultEnabled: definition.enabled,
    async search({ query, maxResults, timeoutMs, signal, key, lang, region }) {
      const values = {
        query: encodeURIComponent(query),
        queryRaw: query,
        key: key ?? '',
        maxResults: Math.min(Math.max(maxResults, 1), MAX_CUSTOM_RESULTS),
        lang: lang ?? '',
        region: region ?? '',
      };
      const url = fillTemplate(definition.url, values);
      if (!/^https?:\/\//i.test(url)) fail('CUSTOM_INVALID', `custom engine "${definition.id}" produced a non-http URL`);
      const headers = {};
      for (const [name, value] of Object.entries(parseJsonObject(definition.headers, 'headers'))) {
        if (typeof value === 'string' || typeof value === 'number') headers[name.toLowerCase()] = fillTemplate(String(value), values);
      }
      let body;
      if (definition.method === 'POST') {
        const template = definition.body.trim() === '' ? '{}' : definition.body;
        body = fillTemplate(template, values);
      }
      const { status, text: payload } = await fetchText(url, {
        method: definition.method,
        headers: definition.method === 'POST' ? { ...apiHeaders(), 'content-type': 'application/json', ...headers } : { ...apiHeaders(), ...headers },
        body,
        timeoutMs,
        signal,
      });
      if (status === 401 || status === 403) fail('ENGINE_NO_KEY', `custom engine "${definition.id}" rejected the credentials`);
      if (status === 429) fail('ENGINE_BLOCKED', `custom engine "${definition.id}" rate limit reached`);
      if (status < 200 || status >= 300) fail('ENGINE_HTTP', `custom engine "${definition.id}" http ${status}`);
      if (definition.type === 'rss') return finalize(parseFeed(payload, maxResults), maxResults);
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        fail('ENGINE_PARSE', `custom engine "${definition.id}" returned a non-JSON body (use type "rss" for feeds)`);
      }
      const items = definition.type === 'searxng' ? (parsed?.results ?? []) : (definition.resultsPath === '' ? parsed : pickPath(parsed, definition.resultsPath));
      if (!Array.isArray(items)) fail('ENGINE_PARSE', `custom engine "${definition.id}": results path "${definition.resultsPath || '(root)'}" is not an array`);
      if (items.length === 0) fail('ENGINE_EMPTY', `custom engine "${definition.id}" returned no results`);
      const sources = items.slice(0, maxResults * 2).map((item) => {
        const snippet = definition.type === 'searxng' ? pickFirst(item, 'content|snippet') : pickFirst(item, definition.snippetPath);
        const date = definition.type === 'searxng' ? pickFirst(item, 'publishedDate|published_date') : pickFirst(item, definition.publishedAtPath);
        return {
          url: definition.type === 'searxng' ? pickFirst(item, 'url|link') : pickFirst(item, definition.urlPath),
          title: definition.type === 'searxng' ? pickFirst(item, 'title|name') : pickFirst(item, definition.titlePath),
          snippet: trimSnippet(typeof snippet === 'string' ? snippet : snippet === undefined ? '' : JSON.stringify(snippet)),
          ...(date ? { publishedAt: normaliseDate(String(date)) } : {}),
        };
      });
      return finalize(sources, maxResults);
    },
  };
  return engine;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Built-in engines, in registry order.
 *
 * The anonymous JSON APIs (`anysearch`, `exa`) sit between the HTML engines and
 * the globally-reachable ones: they are China-reachable, do not depend on page
 * markup, and are the natural next fallback when Bing/Baidu get rate-limited.
 */
export const BUILTIN_ENGINES = [
  bing,
  baidu,
  so360,
  bingWeb,
  anysearch,
  exa,
  duckduckgo,
  ddgLite,
  searxng,
  wikipedia,
  mojeek,
  tavily,
];

/** Built-in engine ids. */
export const BUILTIN_IDS = BUILTIN_ENGINES.map((engine) => engine.id);

/**
 * Default chain: the China-reachable engines first (HTML, then the anonymous
 * JSON APIs), then the global keyless ones, and `tavily` last so a configured
 * key *adds* a source instead of taking the chain over. Reorder it from the
 * settings page.
 */
export const DEFAULT_ORDER = [...BUILTIN_IDS];

function describeEngine(engine) {
  return {
    id: engine.id,
    label: engine.label,
    labelEn: engine.labelEn ?? engine.label,
    badge: engine.badge,
    note: engine.note,
    noteEn: engine.noteEn,
    needsKey: engine.needsKey === true,
    // Works keyless on an anonymous quota; a key is an upgrade, not a gate.
    keyOptional: engine.keyOptional === true,
    envKey: engine.envKey ?? null,
    custom: engine.custom === true,
    definition: engine.definition ?? null,
    defaultEnabled: engine.defaultEnabled !== false,
  };
}

/**
 * Build the engine set for one configuration: built-ins plus the compiled
 * custom definitions.
 * @param {Array<object>} [customDefinitions]
 * @param {{hasKey?: (id: string) => boolean}} [options] key presence is owned by
 *   the caller (the config store), so the registry only asks.
 */
export function createEngineRegistry(customDefinitions = [], options = {}) {
  const map = new Map(BUILTIN_ENGINES.map((engine) => [engine.id, engine]));
  const rejected = [];
  for (const raw of Array.isArray(customDefinitions) ? customDefinitions : []) {
    const engine = compileCustomEngine(raw);
    if (engine === null) {
      rejected.push(String(raw?.id ?? '(unnamed)'));
      continue;
    }
    if (typeof options.hasKey === 'function' && options.hasKey(engine.id) === true) engine.badge = 'KEY';
    map.set(engine.id, engine);
  }
  const ids = [...map.keys()];

  /**
   * The configured order, completed with engines added in later versions.
   *
   * A stored `order` is a snapshot of the engine list at save time, so a
   * brand-new built-in would otherwise be appended at the very tail — and in
   * `deep` mode (which only queries the first `deepEngines`) it would never be
   * reached at all. Each missing built-in is therefore slotted in right after
   * the last engine that precedes it in DEFAULT_ORDER, which preserves the
   * user's relative choices while giving new engines their intended position.
   *
   * Kept as a closure (not a method using `this`) so a destructured
   * `const { ordered } = registry` keeps working.
   */
  function mergedOrder(order) {
    const explicit = Array.isArray(order) ? order : DEFAULT_ORDER;
    const list = [];
    for (const id of explicit) {
      if (!map.has(id) || list.includes(id)) continue;
      list.push(id);
    }
    for (let index = 0; index < DEFAULT_ORDER.length; index++) {
      const id = DEFAULT_ORDER[index];
      if (!map.has(id) || list.includes(id)) continue;
      // `at` is the highest position among the *earlier* defaults already in
      // the list, so two new engines arriving together keep their own order.
      let at = -1;
      for (let earlier = index - 1; earlier >= 0; earlier--) {
        const anchor = list.indexOf(DEFAULT_ORDER[earlier]);
        if (anchor !== -1 && anchor + 1 > at) at = anchor + 1;
      }
      if (at === -1) {
        // No earlier default is present (e.g. the stored order only names custom
        // engines). Insert before the first engine that defaults *after* this
        // one; when there is none, append — so a custom-only order keeps its
        // custom engines in front instead of being pushed to the tail.
        at = list.length;
        for (let position = 0; position < list.length; position++) {
          if (DEFAULT_ORDER.indexOf(list[position]) > index) {
            at = position;
            break;
          }
        }
      }
      list.splice(at, 0, id);
    }
    for (const id of ids) if (!list.includes(id)) list.push(id);
    return list;
  }

  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    ids,
    describe: () => [...map.values()].map(describeEngine),
    rejected,
    mergedOrder,
    /** Selected engines only, in configured order, unknown ids dropped. */
    ordered(order, enabled) {
      const list = [];
      for (const id of mergedOrder(order)) {
        if (enabled !== undefined && enabled[id] === false) continue;
        list.push(id);
      }
      return list;
    },
  };
}

/**
 * Run exactly one engine.
 * @param {ReturnType<typeof createEngineRegistry>} registry
 * @param {string} id
 * @param {{query:string,maxResults:number,region?:string,lang?:string,recency?:string,depth?:string,key?:string,timeoutMs?:number,signal?:AbortSignal,options?:Record<string,unknown>}} request
 * @returns {Promise<{sources:Array<{url:string,title?:string,snippet?:string,publishedAt?:string}>,ms:number}>}
 */
export async function runEngine(registry, id, request) {
  const engine = registry.get(id);
  if (engine === undefined) fail('ENGINE_UNKNOWN', `unknown engine "${id}"`);
  if (typeof request.query !== 'string' || request.query.trim() === '') fail('QUERY_EMPTY', 'query must be a non-empty string');
  const started = Date.now();
  const sources = await engine.search({
    query: request.query,
    maxResults: Math.min(Math.max(Number(request.maxResults) || 8, 1), 25),
    region: request.region,
    lang: request.lang,
    recency: request.recency,
    depth: request.depth,
    key: request.key,
    timeoutMs: request.timeoutMs ?? 12000,
    signal: request.signal,
    options: request.options,
  });
  if (!Array.isArray(sources) || sources.length === 0) fail('ENGINE_EMPTY', `${id} returned no usable sources`);
  return { sources, ms: Date.now() - started };
}

/* -------------------------------------------------------------------------- */
/* Date parsing                                                               */
/* -------------------------------------------------------------------------- */

/** English month abbreviations (and the localized numeric forms below). */
const MONTH_NAMES = new Map([
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6],
  ['jul', 7], ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
]);

/** `9月` / `9월` / `Sep` / `September` → 9, or null when it is not a month. */
function monthFromToken(token) {
  const cleaned = String(token ?? '').toLowerCase().replace(/\.$/, '');
  const localized = /^(\d{1,2})\s*(?:月|월)$/.exec(cleaned);
  if (localized !== null) {
    const month = Number(localized[1]);
    return month >= 1 && month <= 12 ? month : null;
  }
  return MONTH_NAMES.get(cleaned.slice(0, 3)) ?? null;
}

/** `GMT`/`UTC`/`Z` → 0, `+0800` → 480, absent → 0 (documented as UTC). */
function offsetMinutesOf(token) {
  const value = String(token ?? '').trim().toUpperCase();
  if (value === '' || value === 'GMT' || value === 'UTC' || value === 'Z') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (match === null) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function isoFromParts(year, month, day, hour, minute, offsetMinutes) {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31) || year < 1970 || year > 3000) return undefined;
  const ms = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/** Relative-time units in milliseconds (Chinese). */
const RELATIVE_UNITS_ZH = new Map([
  ['秒', 1000], ['分钟', 60000], ['分', 60000], ['小时', 3600000],
  ['天', 86400000], ['日', 86400000], ['周', 604800000], ['星期', 604800000],
  // Approximate on purpose: "3个月前" has no exact calendar value, and refusing
  // to parse it would let an 8-month-old page survive a one-week window.
  ['个月', 2592000000], ['月', 2592000000], ['年', 31536000000],
]);
const RELATIVE_UNITS_EN = new Map([
  ['second', 1000], ['minute', 60000], ['hour', 3600000], ['day', 86400000],
  ['week', 604800000], ['month', 2592000000], ['year', 31536000000],
]);

const isoFromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Relative wording → an absolute date, measured from `now`.
 *
 * `now` is a parameter so the result is deterministic under test; production
 * callers omit it. Chinese and English forms are both handled because the same
 * page can appear in either language depending on the market.
 */
function relativeDate(raw, now) {
  const zh = /^(\d{1,4})\s*(个月|分钟|小时|星期|天|日|周|月|年|分|秒)\s*(?:之)?前$/.exec(raw);
  if (zh !== null) return isoFromMs(now - Number(zh[1]) * RELATIVE_UNITS_ZH.get(zh[2]));
  const en = /^(\d{1,4})\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.exec(raw);
  if (en !== null) return isoFromMs(now - Number(en[1]) * RELATIVE_UNITS_EN.get(en[2].toLowerCase().replace(/s$/, '')));
  if (/^(刚刚|刚才|just now)$/i.test(raw)) return isoFromMs(now);
  if (/^(昨天|yesterday)$/i.test(raw)) return isoFromMs(now - 86400000);
  if (/^前天$/.test(raw)) return isoFromMs(now - 2 * 86400000);
  return undefined;
}

/**
 * ISO-8601 (YYYY-MM-DD) from whatever date string an engine produced.
 *
 * Engines return dates in the market's own locale — Bing with `mkt=zh-CN` sends
 * `周日, 27 9月 2026 23:22:00 GMT`, which `new Date()` rejects outright. That
 * used to silently drop *every* `publishedAt` in the default (Chinese) setup, so
 * the localized RFC-822 and `2026年9月27日` forms are parsed explicitly here.
 *
 * Relative wording ("4 天之前") is arithmetic from `now`, not a guess; anything
 * unrecognised still returns `undefined`.
 */
export function normaliseDate(input, now = Date.now()) {
  const raw = String(input ?? '').trim();
  if (raw === '') return undefined;
  const relative = relativeDate(raw, now);
  if (relative !== undefined) return relative;
  // A bare calendar date is taken literally. Letting `new Date()` see it would
  // read it as *local* midnight ("2026/9/27" in UTC+8 becomes 2026-09-26 UTC).
  const calendar = /^(\d{4})\s*[年년/-]\s*(\d{1,2})\s*[月월/-]\s*(\d{1,2})\s*[일日号]?$/.exec(raw);
  if (calendar !== null) return isoFromParts(Number(calendar[1]), Number(calendar[2]), Number(calendar[3]), 0, 0, 0);
  // Full timestamps: ISO-8601 and English RFC-822 are understood natively.
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  // Localized RFC-822: "周日, 27 9月 2026 23:22:00 GMT"
  const rfc = /(\d{1,2})\s+([^\s,]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([A-Za-z]{1,5}|[+-]\d{4})?/.exec(raw);
  if (rfc !== null) {
    const month = monthFromToken(rfc[2]);
    if (month !== null) {
      return isoFromParts(Number(rfc[3]), month, Number(rfc[1]), Number(rfc[4] ?? 0), Number(rfc[5] ?? 0), offsetMinutesOf(rfc[7]));
    }
  }
  // Localized date carrying a time: "2026年9月27日 10:00"
  const localized = /(\d{4})\s*[年년/-]\s*(\d{1,2})\s*[月월/-]\s*(\d{1,2})\s*[일日]?(?:\s+(\d{1,2}):(\d{2}))?/.exec(raw);
  if (localized !== null) {
    return isoFromParts(Number(localized[1]), Number(localized[2]), Number(localized[3]), Number(localized[4] ?? 0), Number(localized[5] ?? 0), 0);
  }
  return undefined;
}

/** A leading date token plus the separator the engines put after it. */
const SNIPPET_DATE = new RegExp(
  '^(' +
    '\\d{4}\\s*[年년/-]\\s*\\d{1,2}\\s*[月월/-]\\s*\\d{1,2}\\s*[일日号]?' +
    '|\\d{1,4}\\s*(?:个月|分钟|小时|星期|天|日|周|月|年|分|秒)\\s*(?:之)?前' +
    '|\\d{1,4}\\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\\s+ago' +
    '|刚刚|刚才|昨天|前天|just now|yesterday' +
  ')\\s*(?:[·•|–—―-]\\s*)?',
  'i',
);

/**
 * Pull a publish date out of the *front of a snippet*, and return the snippet
 * without it.
 *
 * Only the RSS surface labels dates in markup; the HTML surfaces (bing-web,
 * so360, sometimes baidu) put the date at the start of the snippet text —
 * `2025年2月28日 · …`, `4 天之前 · …`, `4天前 - …`. Without this, two thirds of a
 * deep search carried no date at all, so `recency` could not filter them.
 *
 * The date is only stripped when it actually parses; otherwise the snippet is
 * returned untouched.
 */
export function dateFromSnippet(input, now = Date.now()) {
  const snippet = sanitiseText(input);
  if (snippet === '') return { snippet, publishedAt: undefined };
  const match = SNIPPET_DATE.exec(snippet);
  if (match === null) return { snippet, publishedAt: undefined };
  const token = match[1].replace(/\s+$/, '');
  const publishedAt = normaliseDate(token, now);
  if (publishedAt === undefined) return { snippet, publishedAt: undefined };
  const rest = snippet.slice(match[0].length).trim();
  // A snippet that was nothing but a date is not worth emptying out.
  return { snippet: rest === '' ? snippet : rest, publishedAt };
}

/** Environment-variable name that also carries an engine's key. */
export function envKeyName(engine) {
  if (engine?.envKey) return engine.envKey;
  return `${String(engine?.id ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}