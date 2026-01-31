import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractSubtitles } from '../dist/index.js';

const OUTPUT_DIR = resolve(import.meta.dirname, 'output');

// ── Args ──

const url = process.argv[2];
const concurrency = parseInt(process.env.CONCURRENCY || process.argv[3] || '1', 10);

if (!url) {
  console.error('Usage: node test.js <mkv-url> [concurrency]');
  console.error('  env: CONCURRENCY=8 node test.js <url>');
  process.exit(1);
}

// ── Timed logger ──
// Patches console.log so every verbose line from the library gets an elapsed timestamp.

const t0 = performance.now();
const originalLog = console.log;
const originalError = console.error;

function elapsed() {
  return `+${((performance.now() - t0) / 1000).toFixed(3)}s`;
}

console.log = (...args) => originalLog(`[${elapsed()}]`, ...args);
console.error = (...args) => originalError(`[${elapsed()}]`, ...args);

// ── Main ──

try {
  console.log(`URL: ${url}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log('');

  const extractStart = performance.now();
  const results = await extractSubtitles(url, { verbose: true, concurrency });
  const extractMs = performance.now() - extractStart;

  console.log('');

  // ── Write output ──
  const writeStart = performance.now();
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const track of results) {
    const ext = track.type;
    const name = track.metadata.trackName || `track${track.metadata.trackNumber}`;
    const subFile = `${name}.${ext}`;
    await writeFile(join(OUTPUT_DIR, subFile), track.output.subtitle);
    console.log(`Wrote ${subFile} (${formatBytes(track.output.subtitle.length)})`);

    if (track.output.fonts) {
      for (const font of track.output.fonts) {
        await writeFile(join(OUTPUT_DIR, font.name), font.data);
      }
      console.log(`Wrote ${track.output.fonts.length} font(s)`);
    }
  }
  const writeMs = performance.now() - writeStart;

  // ── Summary ──
  console.log('');
  console.log('=============================');
  console.log(`Tracks extracted: ${results.length}`);
  for (const track of results) {
    const blocks = track.type.toUpperCase();
    const lang = track.metadata.language ?? 'und';
    const name = track.metadata.trackName ?? '(none)';
    console.log(`  #${track.metadata.trackNumber}: ${blocks} lang=${lang} name=${name} (${formatBytes(track.output.subtitle.length)})`);
  }
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log('');
  console.log(`Extraction: ${(extractMs / 1000).toFixed(3)}s`);
  console.log(`File write: ${(writeMs / 1000).toFixed(3)}s`);
  console.log(`Total:      ${((performance.now() - t0) / 1000).toFixed(3)}s`);
  console.log('=============================');
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
