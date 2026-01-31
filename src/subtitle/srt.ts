import { encodeUtf8, decodeUtf8 } from '../util.js';
import type { SubtitleBlock } from '../types.js';

/**
 * Format milliseconds as SRT timestamp: HH:MM:SS,mmm
 */
function formatSrtTimestamp(ms: number): string {
  const totalMs = Math.round(ms);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;

  return (
    String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + ',' +
    String(millis).padStart(3, '0')
  );
}

/**
 * Assemble SRT subtitle file from extracted blocks.
 */
export function assembleSrt(blocks: SubtitleBlock[]): Uint8Array {
  // Sort by timestamp
  const sorted = [...blocks].sort((a, b) => a.timestampMs - b.timestampMs);

  const lines: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i];
    const index = i + 1;
    const start = formatSrtTimestamp(block.timestampMs);
    const end = formatSrtTimestamp(block.timestampMs + (block.durationMs ?? 0));
    const text = decodeUtf8(block.data);

    lines.push(`${index}`);
    lines.push(`${start} --> ${end}`);
    lines.push(text);
    lines.push('');
  }

  return encodeUtf8(lines.join('\n'));
}
