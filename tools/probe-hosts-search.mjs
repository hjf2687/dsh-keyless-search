/**
 * The two `web/deepseek-search-llm-request` events: what were they, and what
 * tool call was in flight at the time?
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

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
  walk(path.join(os.homedir(), '.dsh', 'sessions'), 0);
  found.sort((left, right) => right.at - left.at);
  return found[0]?.full;
}

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
      /* expected at frame boundaries */
    }
  }
  return Buffer.concat(parts).toString('utf8');
}

const entries = decodeAllFrames(fs.readFileSync(newestLog()))
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

const clock = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '--');

/** Tool calls / results in the same neighbourhood as one event. */
function context(seq) {
  const near = entries.filter((entry) => Math.abs((entry.seq ?? 0) - seq) <= 6);
  console.log(`  --- events within ±6 seq of ${seq} ---`);
  for (const entry of near) {
    const type = String(entry.type ?? '');
    let detail = '';
    if (type === 'tool/call') detail = `${entry.data?.name} ${String(entry.data?.arguments).slice(0, 120)}`;
    else if (type === 'tool/result') detail = `callId=${entry.data?.message?.source?.callId ?? '-'}`;
    else if (type.startsWith('web/')) detail = JSON.stringify(entry.data).slice(0, 160);
    console.log(`    seq=${String(entry.seq).padStart(5)} ${clock(entry.time)} ${type.padEnd(24)} ${detail}`);
  }
}

const webEvents = entries.filter((entry) => String(entry.type ?? '').startsWith('web/'));
for (const entry of webEvents) {
  console.log(`=== ${entry.type} at ${clock(entry.time)} (seq ${entry.seq}) ===`);
  const data = entry.data ?? {};
  console.log(`  endpoint   : ${data.endpoint}`);
  console.log(`  apiVersion : ${data.apiVersion}`);
  console.log(`  body       : ${JSON.stringify(data.body).slice(0, 300)}`);
  context(entry.seq ?? 0);
  console.log('');
}

const toolNames = new Map();
for (const entry of entries) {
  if (entry.type === 'tool/call') {
    const name = entry.data?.name ?? '?';
    toolNames.set(name, (toolNames.get(name) ?? 0) + 1);
  }
}
console.log('=== tool call counts this session ===');
for (const [name, count] of [...toolNames].sort((left, right) => right[1] - left[1])) console.log(`  ${String(count).padStart(4)}  ${name}`);