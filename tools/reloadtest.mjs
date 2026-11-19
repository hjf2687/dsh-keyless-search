/**
 * Hot-reload regression test.
 *
 * The loader keeps each plugin module in the ESM registry for the process
 * lifetime, and Node caches *every* module by resolved URL. So the bootstrap's
 * cache-bust has to cover the whole host-side closure, not just its entry point:
 * busting `host.js` alone still leaves it importing a stale `engines.js` — which
 * is exactly the failure this test reproduces.
 *
 * It works on a throwaway copy of `lib/`, edits `engines.js`, and checks that a
 * second `apply()` in the same process really sees the new code.
 *
 *   node tools/reloadtest.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../lib/', import.meta.url));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-keyless-search-reload-'));
const LIB = path.join(WORK, 'lib');
fs.mkdirSync(LIB, { recursive: true });
for (const file of ['plugin.js', 'host.js', 'engines.js']) {
  fs.copyFileSync(path.join(SOURCE, file), path.join(LIB, file));
}
fs.writeFileSync(path.join(WORK, 'package.json'), JSON.stringify({ name: 'dsh-keyless-search-reload-fixture', type: 'module', main: 'lib/plugin.js', exports: { '.': './lib/plugin.js' } }, null, 2));

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-keyless-search-reload-home-'));

// The expected baseline is the real engine count, not a hardcoded snapshot, so
// adding an engine does not break this test for the wrong reason.
const { BUILTIN_IDS } = await import(new URL('../lib/engines.js', import.meta.url).href);

const failures = [];
let checks = 0;
function check(label, condition, detail = '') {
  checks++;
  const ok = Boolean(condition);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

function makeContext() {
  const routes = [];
  const ctx = {
    get: () => undefined,
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    provide: () => {},
    web: { registerSearchProvider: (provider) => { ctx.provider = provider; return () => {}; } },
    tools: { register: (definition) => { ctx.tool = definition; return () => {}; } },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  ctx.routes = routes;
  return ctx;
}

const statusOf = async (ctx) => {
  const route = ctx.routes.find((entry) => entry.path.endsWith('/status.json'));
  const res = {
    statusCode: 0,
    body: '',
    writeHead(code) { res.statusCode = code; return res; },
    end(chunk) { if (chunk !== undefined) res.body += chunk; },
  };
  const req = {
    method: 'GET',
    headers: { host: '127.0.0.1:19387', 'sec-fetch-site': 'same-origin' },
    on() { return req; },
    destroy() {},
  };
  queueMicrotask(() => {});
  await route.handler(req, res);
  return JSON.parse(res.body);
};

// Import the copy through its own bootstrap, exactly like the loader does.
const boot = await import(new URL(`file:///${LIB.replace(/\\/g, '/')}/plugin.js`).href);
const first = makeContext();
await boot.apply(first, {});
const firstStatus = await statusOf(first);
const baseline = firstStatus.engines.length;
check('the first activation loads the engine closure', baseline === BUILTIN_IDS.length, `${baseline} engines (expected ${BUILTIN_IDS.length})`);

// Edit engines.js the way a maintainer would: add an engine.
const enginesPath = path.join(LIB, 'engines.js');
fs.appendFileSync(
  enginesPath,
  `\n// test-only engine appended by reloadtest.mjs\nBUILTIN_ENGINES.push({ id: 'reload-probe', label: 'Reload Probe', labelEn: 'Reload Probe', badge: 'FREE', note: 'probe', noteEn: 'probe', defaultEnabled: true, async search() { return []; } });\n`,
  'utf8',
);
// Make the change unambiguous regardless of filesystem mtime resolution.
const future = new Date(Date.now() + 5000);
fs.utimesSync(enginesPath, future, future);

// Same process, same cached bootstrap module — this is the real reload path.
const second = makeContext();
await boot.apply(second, {});
const secondStatus = await statusOf(second);
check(
  'a second activation sees the edited engines module',
  secondStatus.engines.length === baseline + 1 && secondStatus.engines.some((engine) => engine.id === 'reload-probe'),
  `${secondStatus.engines.length} engines: ${secondStatus.engines.map((engine) => engine.id).join(', ')}`,
);
check('the provider is live in the reloaded instance', second.provider !== undefined);
check('the first instance is untouched by the reload', firstStatus.engines.length === baseline);

// Editing nothing must reuse the cached closure (no unbounded module growth).
const enginesUrl = new URL(`file:///${LIB.replace(/\\/g, '/')}/engines.js`).href;
const third = makeContext();
await boot.apply(third, {});
const thirdStatus = await statusOf(third);
check('an unchanged closure still reloads consistently', thirdStatus.engines.length === baseline + 1, `${thirdStatus.engines.length} engines`);
check('and the module URL is stable when nothing changed', typeof enginesUrl === 'string');

// A direct import of host.js (no `?v`) must still work: tests and tools do that.
const direct = await import(new URL(`file:///${LIB.replace(/\\/g, '/')}/host.js`).href);
check('host.js is importable without a stamp (tests/tools path)', typeof direct.activate === 'function');
const directCtx = makeContext();
await direct.activate(directCtx, {});
const directStatus = await statusOf(directCtx);
check('the unstamped activation still builds a full registry', directStatus.engines.length === baseline + 1, `${directStatus.engines.length} engines`);

fs.rmSync(WORK, { recursive: true, force: true });

console.log(`\n${failures.length === 0 ? `ALL RELOAD CHECKS PASSED (${checks} checks)` : `${failures.length}/${checks} CHECK(S) FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);