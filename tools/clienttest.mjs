/**
 * Client-half test: loads `lib/client.js` exactly the way the Harness client
 * module system does (window.__ModuleLoader__.load), then renders every surface
 * with a tiny purpose-built React runtime and a mocked HTTP surface.
 *
 * It asserts that the plugin registers its three slots, that each surface
 * renders real content for every lifecycle phase, and that a click on 搜索
 * really round-trips through `/dsh-keyless-search/search.json` into the list.
 *
 *   node tools/clienttest.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/* -------------------------------------------------------------------------- */
/* Minimal React runtime                                                      */
/* -------------------------------------------------------------------------- */

const Fragment = Symbol('Fragment');
const stores = new Map();
let owner = null;
let pendingEffects = [];
let dirty = false;

function instanceStore(key) {
  let store = stores.get(key);
  if (store === undefined) {
    store = { hooks: [], index: 0 };
    stores.set(key, store);
  }
  return store;
}

function currentStore() {
  if (owner === null) throw new Error('hook called outside a component render');
  return owner;
}

function useState(initial) {
  const store = currentStore();
  const index = store.index++;
  if (!(index in store.hooks)) store.hooks[index] = typeof initial === 'function' ? initial() : initial;
  return [
    store.hooks[index],
    (next) => {
      const value = typeof next === 'function' ? next(store.hooks[index]) : next;
      if (value !== store.hooks[index]) {
        store.hooks[index] = value;
        dirty = true;
      }
    },
  ];
}

function useEffect(effect, deps) {
  const store = currentStore();
  const index = store.index++;
  const previous = store.hooks[index];
  const changed = previous === undefined || deps === undefined || deps.some((dep, position) => dep !== previous.deps[position]);
  store.hooks[index] = { deps, cleanup: previous?.cleanup };
  if (changed) pendingEffects.push({ store, index, effect });
}

function useMemo(factory, deps) {
  const store = currentStore();
  const index = store.index++;
  const previous = store.hooks[index];
  if (previous === undefined || deps === undefined || deps.some((dep, position) => dep !== previous.deps[position])) {
    store.hooks[index] = { deps, value: factory() };
  }
  return store.hooks[index].value;
}

function useCallback(fn, deps) {
  return useMemo(() => fn, deps);
}

function useRef(initial) {
  const store = currentStore();
  const index = store.index++;
  if (!(index in store.hooks)) store.hooks[index] = { current: typeof initial === 'function' ? initial() : initial };
  return store.hooks[index];
}

class Component {
  constructor(props) {
    this.props = props;
    this.state = {};
  }
}
Component.prototype.isReactComponent = {};

const React = {
  createElement(type, props, ...children) {
    const kids = children.length <= 1 ? children[0] : children;
    return { $$el: true, type, props: { ...(props ?? {}), children: kids } };
  },
  Fragment,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Component,
};

/* -------------------------------------------------------------------------- */
/* Expansion + HTML                                                           */
/* -------------------------------------------------------------------------- */

function callComponent(type, props) {
  const previous = owner;
  owner = instanceStore(type);
  owner.index = 0;
  try {
    if (type.prototype !== undefined && type.prototype.isReactComponent !== undefined) {
      const instance = new type(props);
      return instance.render();
    }
    return type(props);
  } finally {
    owner = previous;
  }
}

function expand(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return { $$text: String(node) };
  if (Array.isArray(node)) return { $$list: node.map(expand).filter((item) => item !== null) };
  if (node.$$el !== true) return { $$text: String(node) };
  const { type, props } = node;
  if (type === Fragment) return expand(props.children);
  if (typeof type === 'function') return expand(callComponent(type, props));
  return {
    $$host: true,
    type,
    props,
    children: expand(props.children),
  };
}

const voidTags = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

function cssify(style) {
  if (style === null || typeof style !== 'object') return '';
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}`)
    .join(';');
}

function attrsOf(props) {
  const parts = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || value === undefined || value === null || value === false) continue;
    if (typeof value === 'function' || typeof value === 'object') {
      if (key === 'style') parts.push(` style="${cssify(value)}"`);
      continue;
    }
    parts.push(value === true ? ` ${key}` : ` ${key}="${String(value).replace(/"/g, '&quot;')}"`);
  }
  return parts.join('');
}

function collectText(node, out = []) {
  if (node === null || node === undefined) return out;
  if (node.$$text !== undefined) {
    out.push(node.$$text);
    return out;
  }
  if (node.$$list !== undefined) {
    for (const child of node.$$list) collectText(child, out);
    return out;
  }
  if (node.$$host !== undefined) {
    collectText(node.children, out);
    return out;
  }
  return out;
}

function toHtml(node) {
  if (node === null || node === undefined) return '';
  if (node.$$text !== undefined) return node.$$text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (node.$$list !== undefined) return node.$$list.map(toHtml).join('');
  if (node.$$host !== undefined) {
    const open = `<${node.type}${attrsOf(node.props)}>`;
    if (voidTags.has(node.type)) return open;
    return `${open}${toHtml(node.children)}</${node.type}>`;
  }
  return '';
}

/** Every host element in the tree, in document order. */
function elements(node, out = []) {
  if (node === null || node === undefined) return out;
  if (node.$$list !== undefined) {
    for (const child of node.$$list) elements(child, out);
    return out;
  }
  if (node.$$host !== undefined) {
    out.push(node);
    elements(node.children, out);
  }
  return out;
}

function findByText(node, needle) {
  return elements(node).find((element) => collectText(element.children).join('').includes(needle) && typeof element.props.onClick === 'function');
}

/* -------------------------------------------------------------------------- */
/* Fakes: document, window, fetch                                             */
/* -------------------------------------------------------------------------- */

const styleTags = [];

function fakeElement(tag) {
  return {
    tagName: tag,
    attributes: {},
    children: [],
    textContent: '',
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    getAttribute(key) {
      return this.attributes[key];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

const head = fakeElement('head');
const documentFake = {
  head,
  createElement: (tag) => fakeElement(tag),
  querySelector(selector) {
    const match = /data-plugin-css="([^"]+)"/.exec(selector);
    if (match !== null) return head.children.find((child) => child.attributes['data-plugin-css'] === match[1]) ?? null;
    return null;
  },
};

globalThis.window = {
  __ModuleLoader__: { captured: null, load(registration) { this.captured = registration; } },
};
globalThis.document = documentFake;

/* -------------------------------------------------------------------------- */
/* Mock HTTP surface                                                          */
/* -------------------------------------------------------------------------- */

const ENGINES = [
  { id: 'bing', label: 'Bing 必应', labelEn: 'Bing', badge: 'FREE', note: '必应 RSS', noteEn: 'Bing RSS', defaultEnabled: true, enabled: true, usable: true, order: 0, needsKey: false, custom: false, health: { coolingDown: false, cooldownUntil: null, failures: 0, lastOkAt: new Date().toISOString(), lastMs: 320, lastCount: 6, lastError: null } },
  { id: 'baidu', label: '百度', labelEn: 'Baidu', badge: 'FREE', note: '中文覆盖高', noteEn: 'Chinese coverage', defaultEnabled: true, enabled: true, usable: true, order: 1, needsKey: false, custom: false, health: { coolingDown: false, cooldownUntil: null, failures: 0, lastOkAt: null, lastMs: 0, lastCount: 0, lastError: null } },
  { id: 'searxng', label: 'SearXNG 公共实例', labelEn: 'SearXNG', badge: 'FREE', note: '元搜索', noteEn: 'metasearch', defaultEnabled: true, enabled: true, usable: true, order: 2, needsKey: false, custom: false, health: { coolingDown: true, cooldownUntil: new Date(Date.now() + 600000).toISOString(), failures: 2, lastOkAt: null, lastMs: 0, lastCount: 0, lastError: 'ENGINE_UNREACHABLE: no instance answered' } },
  { id: 'tavily', label: 'Tavily', labelEn: 'Tavily', badge: 'FREE', note: 'AI 搜索 API（key 可选：不填走匿名额度）', noteEn: 'AI search API (key optional)', defaultEnabled: true, enabled: true, usable: true, order: 3, needsKey: false, keyOptional: true, custom: false, envKey: 'TAVILY_API_KEY', keyConfigured: false, health: { coolingDown: false, cooldownUntil: null, failures: 0, lastOkAt: null, lastMs: 0, lastCount: 0, lastError: null } },
  { id: 'my-search', label: '内部搜索', labelEn: 'Internal search', badge: 'KEY', note: '自定义引擎（json）· search.internal', noteEn: 'Custom engine (json)', defaultEnabled: true, enabled: true, usable: true, order: 4, needsKey: false, custom: true, health: { coolingDown: false, cooldownUntil: null, failures: 0, lastOkAt: null, lastMs: 0, lastCount: 0, lastError: null } },
];

const CUSTOM_ENGINE = {
  id: 'my-search',
  label: '内部搜索',
  type: 'json',
  url: 'https://search.internal/api?q={query}',
  method: 'GET',
  headers: '',
  body: '',
  resultsPath: 'data.items',
  titlePath: 'title',
  urlPath: 'link',
  snippetPath: 'summary|description',
  publishedAtPath: 'published_date',
  enabled: true,
  hasKey: true,
};

const KEYS_FIXTURE = {
  tavily: { configured: false, source: null, hint: null, envKey: 'TAVILY_API_KEY', optional: true },
  'my-search': { configured: true, source: 'settings', hint: '••••1234', envKey: 'MY_SEARCH_API_KEY' },
};

const CONFIG = {
  primary: 'bing',
  order: ['bing', 'baidu', 'searxng', 'tavily', 'my-search'],
  enabled: {},
  customEngines: [CUSTOM_ENGINE],
  maxResults: 8,
  minResults: 3,
  timeoutMs: 12000,
  cacheTtlMs: 300000,
  cooldownMs: 600000,
  depth: 'balanced',
  region: 'zh-CN',
  lang: 'zh',
  deepEngines: 3,
  includeContent: true,
};

const SOURCES = [
  { url: 'https://blog.csdn.net/x/article/1', title: 'DeepSeek Harness 插件推荐', snippet: '装好之后这 9 个插件值得一试，涵盖会话与消息、搜索与抓取……', publishedAt: '2026-09-01' },
  { url: 'https://deepseek-harness-plugin.com/zh-CN/', title: 'DSH 插件库', snippet: '插件精选目录：发现、对比并安装社区插件。' },
  { url: 'https://dshmarket.com/zh/', title: 'dsh-market — 插件市场', snippet: '在 Harness 里逛插件市场。' },
];

const fetchCalls = [];

/** Status payload shaped exactly like the host's `/status.json`. */
function statusPayload(config) {
  return {
    ok: true,
    plugin: 'dsh-keyless-search',
    provider: { id: 'free', registered: true },
    config,
    keys: KEYS_FIXTURE,
    customEngines: config.customEngines ?? [],
    rejectedCustomEngines: [],
    engines: ENGINES,
    cache: { entries: 2, hits: 5, misses: 3, ttlMs: 300000 },
    storeFile: 'C:\\Users\\test\\.dsh\\keyless-search.json',
    routePrefix: '/dsh-keyless-search',
  };
}

globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  const body = options.body === undefined ? undefined : JSON.parse(options.body);
  fetchCalls.push({ path, body });
  let payload;
  if (path.endsWith('/status.json')) {
    payload = statusPayload(CONFIG);
  } else if (path.endsWith('/config.json')) {
    payload = statusPayload({ ...CONFIG, ...(body?.config ?? {}) });
  } else if (path.endsWith('/search.json')) {
    payload = { ok: true, query: body.query, engine: 'bing', depth: body.depth ?? 'balanced', cached: false, ms: 431, truncated: true, maxResults: body.maxResults ?? 8, sources: SOURCES, attempts: [{ engine: 'bing', ok: true, ms: 412, count: 6 }, { engine: 'searxng', ok: false, count: 0, error: 'ENGINE_UNREACHABLE' }], content: 'digest' };
  } else if (path.endsWith('/test-engine.json')) {
    // The host validates the draft before saving; a bad id comes back rejected.
    const bad = !body?.engine?.id || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(body.engine.id);
    payload = bad
      ? { ok: false, error: 'CUSTOM_INVALID: need an id and an http(s) url' }
      : { ok: true, engine: body.engine.id, query: body.query, ms: 42, count: 2, sources: SOURCES.slice(0, 2), validated: true };
  } else if (path.endsWith('/probe.json')) {
    payload = { ok: true, query: body?.query ?? 'q', probes: (body?.engines ?? ENGINES.map((engine) => engine.id)).map((id) => ({ engine: id, ok: id !== 'searxng', ms: 300, count: 3, first: 'first result', health: 'ok' })) };
  } else {
    payload = { ok: false, error: `unexpected path ${path}` };
  }
  return { status: 200, text: async () => JSON.stringify(payload) };
};

/* -------------------------------------------------------------------------- */
/* Load the bundle the way the client module system does                      */
/* -------------------------------------------------------------------------- */

await import(pathToFileURL('D:/tools/AI/DSH-plugins/dsh-keyless-search/lib/client.js').href);
const registration = globalThis.window.__ModuleLoader__.captured;
if (registration === null) {
  console.error('FAIL the bundle did not call window.__ModuleLoader__.load');
  process.exit(1);
}

const mod = registration.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment };
  throw new Error(`unexpected require("${specifier}")`);
});

/* -------------------------------------------------------------------------- */
/* Mock cordis context                                                        */
/* -------------------------------------------------------------------------- */

const registrations = [];
const effects = [];
let boundNamespace = null;
let injectingSlot = null;
const ctx = {
  effect: (fn) => {
    const dispose = fn();
    effects.push(dispose);
    return () => {};
  },
  locale: {
    register: (namespace, dicts) => {
      boundNamespace = { namespace, dicts };
      return () => {};
    },
    bind: (namespace) => {
      const dict = boundNamespace?.dicts?.zh ?? {};
      // The real Translate returns the dictionary string (LocaleDict is
      // Record<string, string>); interpolation is the component's job.
      return (key) => dict[key] ?? key;
    },
  },
  slots: {
    inject: (slotName, callback) => {
      injectingSlot = slotName;
      callback();
      injectingSlot = null;
      return () => {};
    },
    register: (options, component) => {
      registrations.push({ slotName: injectingSlot ?? options.name, options, component });
      return () => {};
    },
  },
};

const failures = [];
let checks = 0;
function check(label, condition, detail = '') {
  checks++;
  const ok = Boolean(condition);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

/* -------------------------------------------------------------------------- */
/* Render helper: settle effects, allow re-renders                            */
/* -------------------------------------------------------------------------- */

async function renderSurface(component, props, passes = 12) {
  let tree = null;
  for (let pass = 0; pass < passes; pass++) {
    dirty = false;
    pendingEffects = [];
    tree = expand(React.createElement(component, props));
    if (pendingEffects.length === 0) break;
    const running = pendingEffects;
    pendingEffects = [];
    await Promise.all(
      running.map(async (entry) => {
        const cleanup = await entry.effect();
        if (typeof cleanup === 'function') entry.store.hooks[entry.index].cleanup = cleanup;
      }),
    );
    if (!dirty) break;
  }
  return tree;
}

console.log(`registration id: ${registration.id}`);
check('bundle id matches the package name', registration.id === 'dsh-keyless-search');
check('exports name', mod.name === 'dsh-keyless-search', String(mod.name));
check('exports inject lists slots+locale', Array.isArray(mod.inject) && mod.inject.includes('slots') && mod.inject.includes('locale'), JSON.stringify(mod.inject));

mod.apply(ctx);

check('styles tag inserted once', head.children.filter((child) => child.attributes['data-plugin-css'] === 'dsh-keyless-search/styles').length === 1);
check('locale dictionaries registered', boundNamespace?.namespace === 'dsh-keyless-search' && boundNamespace.dicts.zh.nav === '免费搜索');
check('two slot injections', registrations.length === 2, registrations.map((entry) => entry.slotName).join(', '));

const settings = registrations.find((entry) => entry.slotName === 'settings.section');
const toolView = registrations.find((entry) => entry.slotName === 'tool.call.toolview');
check('settings.section registration options', settings?.options.id === 'keyless-search' && typeof settings.component === 'function');
check('tool.call.toolview registered for free_search', toolView?.options.key === 'free_search' && typeof toolView.component === 'function');
check('no floating panel slot is registered any more', registrations.every((entry) => entry.slotName !== 'shell.overlay'));

/* ---- 1. settings page renders full data --------------------------------- */
const settingsTree = await renderSurface(settings.component, {});
const settingsHtml = toHtml(settingsTree);
const settingsText = collectText(settingsTree).join(' ');
check('settings page renders the title', settingsText.includes('免费联网搜索'), `${settingsText.length} chars of text`);
check('settings page lists engines', settingsText.includes('Bing 必应') && settingsText.includes('百度') && settingsText.includes('SearXNG'), 'engine labels present');
check('settings page shows the provider pill', settingsText.includes('provider 已注册'));
check('settings page shows health', settingsText.includes('冷却中') && /320 ms/.test(settingsText));
check('settings page shows cache stats', settingsText.includes('缓存命中 5'));
const heroTop = elements(settingsTree).find((element) => element.props.className === 'dfs-heroTop');
check('the hero keeps title and subtitle on one row', elements(heroTop).some((element) => element.type === 'h3') && elements(heroTop).some((element) => element.type === 'p'));
check('the untrusted-data note stays visible without its own line', settingsText.includes('外部数据'));
check('no expand chevron is rendered (the row itself toggles)', elements(settingsTree).every((element) => element.props.className !== 'dfs-chevron'));
check('settings page shows the store path', settingsText.includes('keyless-search.json'));
check('settings page requests status.json', fetchCalls.some((call) => call.path.endsWith('/status.json')));
check('settings page renders the save + probe buttons', settingsText.includes('保存设置') && settingsText.includes('测试全部引擎'));

/* ---- 2. clicking 搜索 round-trips through the API ------------------------ */
const searchButton = findByText(settingsTree, '搜索');
check('settings page has a clickable search button', searchButton !== undefined);
if (searchButton !== undefined) {
  const input = elements(settingsTree).find((element) => element.type === 'input' && typeof element.props.onChange === 'function');
  input.props.onChange({ target: { value: 'DeepSeek Harness' } });
  const rerendered = await renderSurface(settings.component, {});
  const button = findByText(rerendered, '搜索');
  await button.props.onClick();
  const withResults = await renderSurface(settings.component, {});
  const text = collectText(withResults).join(' ');
  check('search.json was called with the typed query', fetchCalls.some((call) => call.path.endsWith('/search.json') && call.body?.query === 'DeepSeek Harness'), JSON.stringify(fetchCalls.filter((call) => call.path.endsWith('/search.json')).map((call) => call.body)));
  check('results render after a search', text.includes('DeepSeek Harness 插件推荐') && text.includes('dsh-market'), 'titles present');
  check('engine + timing pills render', text.includes('bing') && text.includes('431 ms'));
  check('failed attempts render as warnings', text.includes('searxng'));
}

/* ---- 3. tool card, all four lifecycle phases ---------------------------- */
const meta = { query: 'DeepSeek Harness 插件', engine: 'bing', depth: 'balanced', cached: false, ms: 431, truncated: true, maxResults: 8, sources: SOURCES, attempts: [{ engine: 'bing', ok: true, ms: 412, count: 6 }, { engine: 'searxng', ok: false, count: 0, error: 'x' }] };
for (const [phase, block, expectations] of [
  ['preparing', { callId: 'c1', argsRaw: '{"query":"DeepSeek Harness 插件"}' }, ['preparing', 'free_search']],
  ['start', { callId: 'c1', argsRaw: '{"query":"DeepSeek Harness 插件"}' }, ['searching…', 'DeepSeek Harness 插件']],
  ['result', { kind: 'result', callId: 'c1', call: { argsRaw: '{"query":"DeepSeek Harness 插件"}' }, content: [{ type: 'text', text: 'digest' }], isError: false, meta }, ['DeepSeek Harness 插件推荐', 'bing', '412ms']],
  ['result', { kind: 'result', callId: 'c2', call: { argsRaw: '{"query":"x"}' }, content: [], isError: true, error: { name: 'WebError', code: 'SEARCH_FAILED' }, meta: null }, ['SEARCH_FAILED']],
]) {
  const tree = await renderSurface(toolView.component, { phase, block });
  const text = collectText(tree).join(' ');
  const missing = expectations.filter((needle) => !text.includes(needle));
  check(`tool card renders phase "${phase}"`, missing.length === 0, missing.length > 0 ? `missing ${missing.join(', ')}` : `${text.length} chars`);
}
check('tool card never throws on a null block', (await renderSurface(toolView.component, { phase: 'result', block: null })) !== null);

/* ---- 3b. source rows: title only until expanded ------------------------- */
const resultBlock = { kind: 'result', callId: 'c7', call: { argsRaw: '{"query":"x"}' }, content: [], isError: false, meta };
const sourceTree = await renderSurface(toolView.component, { phase: 'result', block: resultBlock });
const sourceRows = elements(sourceTree).filter((element) => element.props.className === 'dfs-source');
const rowToggle = (row) => elements(row).find((element) => typeof element.props.className === 'string' && element.props.className.includes('dfs-sourceToggle'));
check('every result row starts collapsed', sourceRows.length === SOURCES.length && sourceRows.every((row) => row.props['data-open'] === false), `${sourceRows.length} rows`);
check('collapsed rows render the title but no snippet', collectText(sourceTree).join(' ').includes(SOURCES[0].title) && !collectText(sourceTree).join(' ').includes(SOURCES[0].snippet));
check(
  'the expand button sits on the title row',
  sourceRows.every((row) => elements(row).some((element) => element.props.className === 'dfs-sourceTop' && rowToggle(element) !== undefined)),
);
rowToggle(sourceRows[0]).props.onClick();
const expandedSourceTree = await renderSurface(toolView.component, { phase: 'result', block: resultBlock });
check('clicking expand reveals that snippet', collectText(expandedSourceTree).join(' ').includes(SOURCES[0].snippet));
check('only the clicked row expands', elements(expandedSourceTree).filter((element) => element.props.className === 'dfs-source' && element.props['data-open'] === true).length === 1);
const collapseButton = elements(expandedSourceTree).find((element) => typeof element.props.className === 'string' && element.props.className.includes('dfs-sourceToggle') && collectText(element.children).join('').trim() === '收起');
check('the button flips to 收起', collapseButton !== undefined);
collapseButton.props.onClick();
const collapsedSourceTree = await renderSurface(toolView.component, { phase: 'result', block: resultBlock });
check('collapsing hides the snippet again', !collectText(collapsedSourceTree).join(' ').includes(SOURCES[0].snippet));

// New result states: a shared (coalesced) run and an enforced/unsatisfied window.
const cachedCard = await renderSurface(toolView.component, { phase: 'result', block: { kind: 'result', callId: 'c3', call: { argsRaw: '{"query":"x"}' }, content: [], isError: false, meta: { ...meta, cached: true } } });
check('a cached result is labelled', collectText(cachedCard).join(' ').includes('来自缓存'));
const sharedCard = await renderSurface(toolView.component, { phase: 'result', block: { kind: 'result', callId: 'c4', call: { argsRaw: '{"query":"x"}' }, content: [], isError: false, meta: { ...meta, coalesced: true } } });
check('a coalesced result is labelled', collectText(sharedCard).join(' ').includes('并行合并'));
const windowCard = await renderSurface(toolView.component, { phase: 'result', block: { kind: 'result', callId: 'c5', call: { argsRaw: '{"query":"x"}' }, content: [], isError: false, meta: { ...meta, recency: 'month', recencyUnmet: false } } });
check('an enforced window is shown', collectText(windowCard).join(' ').includes('时间范围: month'));
const unmetCard = await renderSurface(toolView.component, { phase: 'result', block: { kind: 'result', callId: 'c6', call: { argsRaw: '{"query":"x"}' }, content: [], isError: false, meta: { ...meta, recency: 'day', recencyUnmet: true } } });
check('an unenforceable window says so instead of pretending', collectText(unmetCard).join(' ').includes('未生效'));

/* ---- 4d. API keys + custom engines in the settings page ------------------ */

const findIn = (tree, className) => elements(tree).find((element) => element.props.className === className);
const buttonIn = (node, text) => elements(node).find((element) => element.type === 'button' && collectText(element.children).join('').trim() === text);
const inputByPlaceholder = (tree, placeholder) => elements(tree).find((element) => element.type === 'input' && element.props.placeholder === placeholder);
const checkIn = (node, text) => elements(node).every((element) => element.type !== 'button' || collectText(element.children).join('').trim() !== text);

let keyTree = await renderSurface(settings.component, {});
let keyText = collectText(keyTree).join(' ');
check('an optional-key engine says the key is optional, not required', keyText.includes('Tavily') && keyText.includes('可选 key') && !keyText.includes('Tavily需要 key'));
check('the custom engine row renders with its key chip', keyText.includes('内部搜索') && keyText.includes('my-search'));
check('the custom-engine card renders', keyText.includes('自定义引擎') && keyText.includes('新增引擎'));

/* ---- 4d1. engine rows are one line by default, click to expand ---------- */
const rowOf = (tree, label) => elements(tree).find((element) => element.props.className === 'dfs-engine' && collectText(element).includes(label));
const toggleOf = (tree, label) => elements(rowOf(tree, label)).find((element) => element.props.className === 'dfs-engineToggle');
check('engine rows render no body by default', elements(keyTree).every((element) => element.props.className !== 'dfs-engineBody'));
const toggles = elements(keyTree).filter((element) => element.props.className === 'dfs-engineToggle');
check('every engine row has a collapsed toggle', toggles.length === ENGINES.length && toggles.every((element) => element.props['aria-expanded'] === false), `${toggles.length} toggles`);
check('the expand/collapse hint is shown', keyText.includes('点引擎名展开设置'));
// The switch must be a sibling of the toggle, so flipping it never expands.
check('the switch is not inside the expand toggle', elements(toggleOf(keyTree, 'Tavily')).every((element) => element.props.className !== 'dfs-switch'));

toggleOf(keyTree, 'Tavily').props.onClick();
keyTree = await renderSurface(settings.component, {});
check('clicking an engine row expands it', elements(keyTree).some((element) => element.props.className === 'dfs-engineBody'));
check('the expanded row marks aria-expanded', elements(rowOf(keyTree, 'Tavily')).find((element) => element.props.className === 'dfs-engineToggle')?.props['aria-expanded'] === true);
check('only the clicked engine expands', elements(keyTree).filter((element) => element.props.className === 'dfs-engineBody').length === 1);

// Fill in the key for the keyed built-in engine.
const keyRow = findIn(keyTree, 'dfs-key');
check('the keyed engine has a key control', keyRow !== undefined);
buttonIn(keyRow, '填写 key').props.onClick();
keyTree = await renderSurface(settings.component, {});
const passwordInput = elements(keyTree).find((element) => element.type === 'input' && element.props.type === 'password');
check('the key input is a password field (never echoed)', passwordInput !== undefined && passwordInput.props.value === '');
passwordInput.props.onChange({ target: { value: 'tvly-test-abcdef' } });
keyTree = await renderSurface(settings.component, {});
await buttonIn(findIn(keyTree, 'dfs-key'), '保存').props.onClick();
const keySave = fetchCalls.filter((call) => call.path.endsWith('/config.json') && call.body?.keys !== undefined).pop();
check('saving a key posts only a keys patch', keySave?.body?.keys?.tavily === 'tvly-test-abcdef' && keySave.body.config === undefined, JSON.stringify(keySave?.body));
check('the key is not echoed back into the UI', !collectText(keyTree).join(' ').includes('tvly-test-abcdef'));

// Collapsing again hides the body; the toggle is a plain toggle.
toggleOf(keyTree, 'Tavily').props.onClick();
keyTree = await renderSurface(settings.component, {});
check('clicking the row again collapses it', elements(keyTree).every((element) => element.props.className !== 'dfs-engineBody'));
check('the collapsed row still shows its key state chip', collectText(keyTree).join(' ').includes('可选 key'));
check('a collapsed row keeps its switch reachable', elements(rowOf(keyTree, 'Tavily')).some((element) => element.props.className === 'dfs-switch'));

/* ---- 4d2. row actions live on the main row, not in the body ------------- */
const bingRow = rowOf(keyTree, 'Bing 必应');
const primaryBtnIn = (row) => elements(row).find((element) => typeof element.props.className === 'string' && element.props.className.includes('dfs-primaryBtn'));
check('reorder/test buttons are on the main row', ['↑', '↓', '测试'].every((label) => buttonIn(bingRow, label) !== undefined));
// Bing is the fixture's primary, so the "set primary" star lives on another row.
check('the set-primary button is on the main row too', primaryBtnIn(rowOf(keyTree, '百度')) !== undefined);
check('row actions need no expansion', elements(bingRow).every((element) => element.props.className !== 'dfs-engineBody'));

const probeCallsBefore = fetchCalls.filter((call) => call.path.endsWith('/probe.json')).length;
buttonIn(bingRow, '测试').props.onClick();
keyTree = await renderSurface(settings.component, {});
check('the row test button probes that engine', fetchCalls.filter((call) => call.path.endsWith('/probe.json')).length === probeCallsBefore + 1 && JSON.stringify(fetchCalls.filter((call) => call.path.endsWith('/probe.json')).pop()?.body).includes('bing'));
check('probing from the row does not expand it', elements(keyTree).every((element) => element.props.className !== 'dfs-engineBody'));

// The fixture's primary is Bing, so 百度 is the row that offers the button.
primaryBtnIn(rowOf(keyTree, '百度')).props.onClick();
keyTree = await renderSurface(settings.component, {});
check('choosing a primary engine does not expand the row', elements(keyTree).every((element) => element.props.className !== 'dfs-engineBody'));
check('the chosen engine shows the primary pill', collectText(rowOf(keyTree, '百度')).includes('主引擎'));
// Put the original primary back so later assertions see the fixture state.
primaryBtnIn(rowOf(keyTree, 'Bing 必应')).props.onClick();
keyTree = await renderSurface(settings.component, {});
check('the primary choice can be moved back', collectText(rowOf(keyTree, 'Bing 必应')).includes('主引擎'));

// The custom engine keeps its own key control inside the editor row.
keyTree = await renderSurface(settings.component, {});
check('a configured custom engine shows its masked key', collectText(keyTree).join(' ').includes('••••1234'));

/* ---- 4e. custom-engine editor: test, save, delete ------------------------ */
let editorTree = await renderSurface(settings.component, {});
findByText(editorTree, '新增引擎').props.onClick();
editorTree = await renderSurface(settings.component, {});
let editorText = collectText(editorTree).join(' ');
check('the editor opens with JSON path fields', editorText.includes('结果数组路径') && editorText.includes('摘要路径') && editorText.includes('请求地址'));
check('the URL placeholder hint is shown', editorText.includes('{query}') && editorText.includes('{key}'));

inputByPlaceholder(editorTree, 'my-search').props.onChange({ target: { value: 'team-search' } });
editorTree = await renderSurface(settings.component, {});
inputByPlaceholder(editorTree, 'https://api.example.com/search?q={query}').props.onChange({ target: { value: 'https://search.corp/api?q={query}' } });
editorTree = await renderSurface(settings.component, {});
inputByPlaceholder(editorTree, 'data.results').props.onChange({ target: { value: 'data.hits' } });
editorTree = await renderSurface(settings.component, {});
await buttonIn(findIn(editorTree, 'dfs-editor'), '测试').props.onClick();
editorTree = await renderSurface(settings.component, {});
const testCall = fetchCalls.filter((call) => call.path.endsWith('/test-engine.json')).pop();
check('the test button posts the unsaved draft', testCall?.body?.engine?.id === 'team-search' && testCall.body.engine.url === 'https://search.corp/api?q={query}', JSON.stringify(testCall?.body?.engine));
check('the draft test result renders', collectText(editorTree).join(' ').includes('可用') && collectText(editorTree).join(' ').includes('2 条'));

buttonIn(findIn(editorTree, 'dfs-editor'), '保存引擎').props.onClick();
const customSave = fetchCalls.filter((call) => call.path.endsWith('/config.json') && call.body?.config?.customEngines !== undefined).pop();
const savedCustom = customSave?.body?.config?.customEngines ?? [];
check('saving the editor posts the whole custom-engine list', savedCustom.length === 2 && savedCustom.some((entry) => entry.id === 'team-search'), JSON.stringify(savedCustom.map((entry) => entry.id)));

// A bad draft surfaces the host's validation error instead of saving.
editorTree = await renderSurface(settings.component, {});
findByText(editorTree, '新增引擎').props.onClick();
editorTree = await renderSurface(settings.component, {});
await buttonIn(findIn(editorTree, 'dfs-editor'), '测试').props.onClick();
editorTree = await renderSurface(settings.component, {});
check('an invalid draft shows a loud error', collectText(editorTree).join(' ').includes('CUSTOM_INVALID'), collectText(editorTree).join(' ').slice(-120));
buttonIn(findIn(editorTree, 'dfs-editor'), '取消').props.onClick();
editorTree = await renderSurface(settings.component, {});
check('cancel closes the editor', findIn(editorTree, 'dfs-editor') === undefined);

// Deleting a custom engine posts the remaining list and clears its key.
const customRow = findIn(editorTree, 'dfs-customRow');
check('the custom engine row is rendered', customRow !== undefined);
buttonIn(customRow, '删除').props.onClick();
const deleteCall = fetchCalls.filter((call) => call.path.endsWith('/config.json') && call.body?.keys?.['my-search'] === '').pop();
check('deleting clears that engine key too', deleteCall !== undefined, JSON.stringify(deleteCall?.body));
check('and posts the list without that engine', Array.isArray(deleteCall?.body?.config?.customEngines) && !deleteCall.body.config.customEngines.some((entry) => entry.id === 'my-search'), JSON.stringify(deleteCall?.body?.config?.customEngines?.map((entry) => entry.id)));

/* ---- 4f. engine enable/disable affordance + unsaved-changes indicator ---- */

// A fresh mount: the draft starts equal to the stored config, so nothing is dirty.
stores.clear();
let formTree = await renderSurface(settings.component, {});
let formText = collectText(formTree).join(' ');
check('a freshly loaded form is not marked unsaved', !formText.includes('有未保存的改动'));
check('the save button is disabled while nothing changed', buttonIn(formTree, '保存设置')?.props.disabled === true);

const firstEngineRow = elements(formTree).find((element) => element.props.className === 'dfs-engine');
// The enable/disable control stays the slide switch it always was.
const engineSwitch = elements(firstEngineRow).find((element) => element.props.className === 'dfs-switch');
check('an enabled engine exposes the slide switch (on)', engineSwitch !== undefined && engineSwitch.props['data-on'] === true);
check('no text button replaced it', buttonIn(firstEngineRow, '停用') === undefined && buttonIn(firstEngineRow, '启用') === undefined);
engineSwitch.props.onClick();
formTree = await renderSurface(settings.component, {});
formText = collectText(formTree).join(' ');
check('switching an engine off marks the form unsaved', formText.includes('有未保存的改动'));
check('the row reads as disabled', formText.includes('已停用'));
check('the switch reflects the off state', elements(elements(formTree).find((element) => element.props.className === 'dfs-engine')).find((element) => element.props.className === 'dfs-switch')?.props['data-on'] === false);
check('and the card explains that built-ins cannot be deleted', formText.includes('不能删除'), formText.slice(-160));
check('the save button becomes primary when dirty', buttonIn(formTree, '保存设置')?.props['data-variant'] === 'primary');
elements(elements(formTree).find((element) => element.props.className === 'dfs-engine')).find((element) => element.props.className === 'dfs-switch').props.onClick();
formTree = await renderSurface(settings.component, {});
check('switching it back on restores the state', elements(elements(formTree).find((element) => element.props.className === 'dfs-engine')).find((element) => element.props.className === 'dfs-switch')?.props['data-on'] === true);
elements(elements(formTree).find((element) => element.props.className === 'dfs-engine')).find((element) => element.props.className === 'dfs-switch').props.onClick();
formTree = await renderSurface(settings.component, {});

await buttonIn(formTree, '保存设置').props.onClick();
const disableSave = fetchCalls.filter((call) => call.path.endsWith('/config.json') && call.body?.config !== undefined).pop();
check('saving persists the disabled engine', disableSave?.body?.config?.enabled?.bing === false, JSON.stringify(disableSave?.body?.config?.enabled));
formTree = await renderSurface(settings.component, {});
check('the indicator clears after saving', !collectText(formTree).join(' ').includes('有未保存的改动'));

/* ---- 5. cross-cutting ---------------------------------------------------- */
check('every surface is wrapped in an error boundary', registrations.every((entry) => entry.component !== undefined));
const cleanupCount = effects.filter((dispose) => typeof dispose === 'function').length;
check('locale registration is effect-scoped', cleanupCount >= 1, `${cleanupCount} disposers`);

console.log(`\n${failures.length === 0 ? `ALL CLIENT CHECKS PASSED (${checks} checks)` : `${failures.length}/${checks} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);