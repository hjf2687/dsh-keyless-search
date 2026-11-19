/**
 * Live engine self-test: runs every engine that can run right now and prints the
 * parsed results. Keyed engines (tavily) are reported as skipped unless a key is
 * configured — pass `--key=<value>` or set `TAVILY_API_KEY`, or use
 * `--custom=<file.json>` to load custom-engine definitions from a file.
 *
 *   node tools/selftest.mjs                     # all usable engines, default query
 *   node tools/selftest.mjs "查询词" bing baidu   # selected engines
 *   node tools/selftest.mjs --key=tvly-xxx      # include keyed engines
 *   node tools/selftest.mjs --custom=engines.json
 */
import fs from 'node:fs';
import { createEngineRegistry, envKeyName, runEngine } from '../lib/engines.js';

const args = process.argv.slice(2);
const keyArg = args.find((arg) => arg.startsWith('--key='))?.slice(6);
const customArg = args.find((arg) => arg.startsWith('--custom='))?.slice(9);
const positional = args.filter((arg) => !arg.startsWith('--'));

let customDefinitions = [];
if (customArg !== undefined) {
  customDefinitions = JSON.parse(fs.readFileSync(customArg, 'utf8'));
  if (!Array.isArray(customDefinitions)) customDefinitions = [customDefinitions];
}

const registry = createEngineRegistry(customDefinitions);
const query = positional[0] ?? 'DeepSeek Harness 插件';
const only = positional.filter((arg) => registry.has(arg));
const targets = only.length > 0 ? only : registry.ids;

/** Resolve one engine's key: --key, then the engine's own env var. */
function keyFor(id) {
  const engine = registry.get(id);
  // `keyOptional` engines (tavily, exa) work without a key but accept one.
  if (engine?.needsKey !== true && engine?.keyOptional !== true) return undefined;
  if (keyArg !== undefined && keyArg !== '') return keyArg;
  const fromEnv = process.env[envKeyName(engine)];
  return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : undefined;
}

console.log(`query:   ${query}`);
console.log(`engines: ${targets.join(', ')}`);
console.log(`custom:  ${customDefinitions.length === 0 ? '(none)' : customDefinitions.map((entry) => entry.id).join(', ')}\n`);

const rows = await Promise.all(
  targets.map(async (id) => {
    const engine = registry.get(id);
    const started = Date.now();
    const key = keyFor(id);
    if (engine?.needsKey === true && key === undefined) {
      return { id, ok: false, skipped: true, ms: 0, error: `needs a key (${envKeyName(engine)} or --key=...)`, label: engine.label };
    }
    try {
      const { sources, ms } = await runEngine(registry, id, { query, maxResults: 6, region: 'zh-CN', lang: 'zh', timeoutMs: 15000, key });
      return { id, ok: true, ms, sources, label: engine?.label ?? id };
    } catch (error) {
      return { id, ok: false, ms: Date.now() - started, error: `${error?.code ?? 'ERR'}: ${error?.message}`, label: engine?.label ?? id };
    }
  }),
);

let pass = 0;
let skipped = 0;
for (const row of rows) {
  if (row.ok) {
    pass++;
    console.log(`OK   ${row.id.padEnd(12)} ${String(row.ms).padStart(6)}ms  ${row.sources.length} sources`);
    for (const source of row.sources.slice(0, 3)) {
      const date = source.publishedAt ? ` [${source.publishedAt}]` : '';
      console.log(`       · ${String(source.title ?? '(no title)').slice(0, 78)}${date}`);
      console.log(`         ${source.url.slice(0, 110)}`);
      if (source.snippet) console.log(`         ${source.snippet.slice(0, 110)}`);
    }
  } else if (row.skipped === true) {
    skipped++;
    console.log(`SKIP ${row.id.padEnd(12)} ${row.error}`);
  } else {
    console.log(`FAIL ${row.id.padEnd(12)} ${String(row.ms).padStart(6)}ms  ${row.error}`);
  }
}
console.log(`\n${pass}/${rows.length} engines returned usable results${skipped > 0 ? ` (${skipped} skipped: key required)` : ''}`);
process.exit(pass === 0 ? 1 : 0);