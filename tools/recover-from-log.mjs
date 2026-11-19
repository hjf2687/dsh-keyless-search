/**
 * Recover a file by replaying a session log.
 *
 * The Harness session log records every tool call, so a file damaged by a bad
 * script can be rebuilt deterministically: replay its `write` payload, then every
 * `edit` in order. This is what saved `lib/client.js` after a line-number-based
 * strip deleted the wrong span — script-driven edits are invisible to the log, so
 * a recovered file may still need post-processing by hand (the panel removal in
 * that incident had been done by a script).
 *
 *   node tools/recover-from-log.mjs --target client.js
 *   node tools/recover-from-log.mjs --target client.js --log "<path>" --out out.js
 *
 * Logs are multi-frame zstd (one frame per append), which is why the frame
 * splitting below exists: a plain decompress only yields the first frame (the
 * session header).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const target = argOf('target', 'client.js');
const out = argOf('out', `recovered-${path.basename(target)}`);

/** Newest `session.v4.jsonl.zstd` under the DSH home, when no log is given. */
function newestLog() {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith('.jsonl.zstd')) found.push({ full, at: fs.statSync(full).mtimeMs });
    }
  };
  walk(path.join(DSH_HOME, 'sessions'), 0);
  found.sort((left, right) => right.at - left.at);
  return found[0]?.full;
}

const LOG = argOf('log', newestLog());
if (LOG === undefined || !fs.existsSync(LOG)) {
  console.error('no session log found; pass --log <path to session.v4.jsonl.zstd>');
  process.exit(1);
}
console.log(`log    : ${LOG}`);
console.log(`target : ${target}`);

function decodeAllFrames(buffer) {
  const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
  const starts = [];
  for (let index = 0; index + 4 <= buffer.length; index++) {
    if (buffer[index] === MAGIC[0] && buffer[index + 1] === MAGIC[1] && buffer[index + 2] === MAGIC[2] && buffer[index + 3] === MAGIC[3]) {
      starts.push(index);
      index += 3;
    }
  }
  const parts = [];
  for (let frame = 0; frame < starts.length; frame++) {
    const end = frame + 1 < starts.length ? starts[frame + 1] : buffer.length;
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(starts[frame], end)));
    } catch {
      /* a frame carrying the next append's leading bytes is expected */
    }
  }
  return Buffer.concat(parts).toString('utf8');
}

const entries = decodeAllFrames(fs.readFileSync(LOG))
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));

const calls = [];
for (const entry of entries) {
  if (entry.type !== 'tool/call') continue;
  const call = entry.data ?? {};
  const name = call.name ?? call.toolName;
  let callArgs = call.arguments ?? call.input ?? call.args;
  if (typeof callArgs === 'string') {
    try {
      callArgs = JSON.parse(callArgs);
    } catch {
      continue;
    }
  }
  if (typeof name !== 'string' || callArgs === null || typeof callArgs !== 'object' || Array.isArray(callArgs)) continue;
  const file = String(callArgs.file_path ?? callArgs.path ?? '');
  if (!file.includes(target)) continue;
  if (name !== 'write' && name !== 'edit') continue;
  calls.push({ name, args: callArgs, seq: entry.seq ?? 0 });
}

console.log(`operations: ${calls.length} (${calls.filter((call) => call.name === 'write').length} write, ${calls.filter((call) => call.name === 'edit').length} edit)`);
let content = null;
let applied = 0;
let mismatched = 0;
for (const call of calls) {
  if (call.name === 'write') {
    content = String(call.args.content ?? '');
    applied++;
    continue;
  }
  if (content === null) continue;
  const oldString = String(call.args.old_string ?? '');
  const newString = String(call.args.new_string ?? '');
  if (oldString === '') continue;
  if (!content.includes(oldString)) {
    mismatched++;
    // The file may have been changed by a script (invisible to the log) between
    // this edit and the next, so a mismatch is reported rather than fatal.
    console.log(`  WARN seq=${call.seq}: edit did not match (${oldString.slice(0, 50).replace(/\n/g, '⏎')}…)`);
    continue;
  }
  content = call.args.replace_all === true ? content.split(oldString).join(newString) : content.replace(oldString, newString);
  applied++;
}

if (content === null) {
  console.error('no write payload found for this target');
  process.exit(1);
}
fs.writeFileSync(out, content, 'utf8');
console.log(`\napplied ${applied}/${calls.length} ops (${mismatched} mismatched)`);
console.log(`wrote ${out}: ${content.length} bytes, ${content.split('\n').length} lines`);
if (mismatched > 0) {
  console.log('\nNOTE: mismatches usually mean a script changed the file mid-history;');
  console.log('      diff the result against the live file before trusting it.');
}