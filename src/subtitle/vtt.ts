import { encodeUtf8, decodeUtf8 } from '../util.js';
import type { SubtitleBlock, SubtitleTrackInfo } from '../types.js';

/**
 * Format milliseconds as WebVTT timestamp: HH:MM:SS.mmm
 */
function formatVttTimestamp(ms: number): string {
  const totalMs = Math.round(ms);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;

  return (
    String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' +
    String(millis).padStart(3, '0')
  );
}

/**
 * Parse BlockAdditions for WebVTT cue metadata.
 * BlockAdditions (BlockAddID=1) contains:
 *   - Line 1: Cue identifier (optional)
 *   - Line 2: Cue settings (optional)
 *   - Remaining lines: Comments preceding the cue (optional)
 */
function parseVttAdditions(additions: Uint8Array | null): {
  cueId: string;
  cueSettings: string;
  comments: string;
} {
  if (!additions || additions.length === 0) {
    return { cueId: '', cueSettings: '', comments: '' };
  }

  const text = decodeUtf8(additions);
  const lines = text.split('\n');

  return {
    cueId: lines[0] || '',
    cueSettings: lines[1] || '',
    comments: lines.slice(2).join('\n'),
  };
}

/**
 * Assemble WebVTT subtitle file from CodecPrivate header + extracted blocks.
 */
export function assembleVtt(track: SubtitleTrackInfo, blocks: SubtitleBlock[]): Uint8Array {
  // CodecPrivate contains the WEBVTT header + optional STYLE/REGION blocks
  const header = track.codecPrivate ? decodeUtf8(track.codecPrivate) : 'WEBVTT';

  // Sort blocks by timestamp
  const sorted = [...blocks].sort((a, b) => a.timestampMs - b.timestampMs);

  const lines: string[] = [];

  // Add header
  lines.push(header.trimEnd());
  lines.push('');

  for (const block of sorted) {
    const { cueId, cueSettings, comments } = parseVttAdditions(block.additions);

    // Add preceding comments if any
    if (comments) {
      lines.push(comments);
      lines.push('');
    }

    // Cue identifier
    if (cueId) {
      lines.push(cueId);
    }

    // Timestamp line
    const start = formatVttTimestamp(block.timestampMs);
    const end = formatVttTimestamp(block.timestampMs + (block.durationMs ?? 0));
    const timeLine = cueSettings
      ? `${start} --> ${end} ${cueSettings}`
      : `${start} --> ${end}`;
    lines.push(timeLine);

    // Cue text
    const text = decodeUtf8(block.data);
    lines.push(text);
    lines.push('');
  }

  return encodeUtf8(lines.join('\n'));
}
