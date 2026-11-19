/**
 * dsh-keyless-search · loader bootstrap
 *
 * The Harness loader imports one module per plugin entry and keeps that module
 * in the ESM registry for the lifetime of the process. That is fine while the
 * plugin is stable, but it means an edited host half would keep running the
 * *old* code until the whole app restarts — including through the plugin
 * manager's own enable/disable cycle.
 *
 * This file is therefore a thin, deliberately boring bootstrap:
 *
 *  - `name` and `inject` are plain constants here, so the loader can read the
 *    plugin's identity without executing anything else.
 *  - `apply()` re-imports `./host.js` with a cache-busting query derived from the
 *    mtimes of the whole host-side closure (`host.js` + `engines.js`).
 *    Unchanged files → the same URL → the cached modules (no leak); an edited
 *    file → a new URL → fresh code, live, without an app restart.
 *
 * The stamp must cover the *closure*, not just the entry: Node caches modules by
 * resolved URL, so busting `host.js` alone would still leave it importing a stale
 * `engines.js`. `host.js` therefore reads this stamp back off its own URL
 * (`?v=…`) and appends the same value when it imports `engines.js` — which is
 * also why editing `engines.js` alone is enough to trigger a reload.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-keyless-search';
export const inject = ['web', 'tools', 'webServer'];

const HOST_URL = new URL('./host.js', import.meta.url);
/** Every host-side module whose content must invalidate the cached closure. */
const CLOSURE = ['host.js', 'engines.js'];
let lastStamp = '';

/** `mtimeMs-size` of each closure file, joined; a missing file contributes 0. */
function closureStamp() {
  const parts = [];
  for (const relative of CLOSURE) {
    try {
      const stat = fs.statSync(fileURLToPath(new URL(`./${relative}`, import.meta.url)));
      parts.push(`${relative}:${Math.round(stat.mtimeMs)}:${stat.size}`);
    } catch {
      parts.push(`${relative}:missing`);
    }
  }
  return parts.join('|');
}

export async function apply(ctx, config) {
  const stamp = closureStamp();
  const target = new URL(HOST_URL.href);
  target.searchParams.set('v', encodeURIComponent(stamp));
  if (stamp !== lastStamp) {
    lastStamp = stamp;
    console.log('[keyless-search] host closure changed — reloading it from disk');
  }
  const host = await import(target.href);
  if (typeof host.activate !== 'function') {
    throw new Error('keyless-search: lib/host.js did not export activate()');
  }
  return host.activate(ctx, config);
}