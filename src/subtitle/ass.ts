import { encodeUtf8, decodeUtf8 } from '../util.js';
import type { SubtitleBlock, SubtitleTrackInfo } from '../types.js';

/**
 * Format milliseconds as ASS timestamp: H:MM:SS.cc (centiseconds)
 */
function formatAssTimestamp(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const hours = Math.floor(totalCs / 360000);
  const minutes = Math.floor((totalCs % 360000) / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const centis = totalCs % 100;

  return (
    String(hours) + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' +
    String(centis).padStart(2, '0')
  );
}

/**
 * Parse an ASS block payload into its component fields.
 * Format: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
 * Text may contain commas, so we split on the first 8 commas only.
 */
function parseAssBlockPayload(text: string): {
  readOrder: number;
  layer: string;
  style: string;
  name: string;
  marginL: string;
  marginR: string;
  marginV: string;
  effect: string;
  dialogueText: string;
} | null {
  const parts: string[] = [];
  let start = 0;

  // Split on first 8 commas
  for (let i = 0; i < 8; i++) {
    const commaIdx = text.indexOf(',', start);
    if (commaIdx === -1) return null;
    parts.push(text.substring(start, commaIdx));
    start = commaIdx + 1;
  }

  // Everything after the 8th comma is the Text field
  const dialogueText = text.substring(start);

  return {
    readOrder: parseInt(parts[0], 10),
    layer: parts[1],
    style: parts[2],
    name: parts[3],
    marginL: parts[4],
    marginR: parts[5],
    marginV: parts[6],
    effect: parts[7],
    dialogueText,
  };
}

/**
 * Assemble ASS/SSA subtitle file from CodecPrivate header + extracted blocks.
 */
export function assembleAss(track: SubtitleTrackInfo, blocks: SubtitleBlock[]): Uint8Array {
  // CodecPrivate contains the header, which may or may not include [Events] section
  const header = track.codecPrivate ? decodeUtf8(track.codecPrivate) : '';

  // Detect line ending style from header
  const lineEnding = header.includes('\r\n') ? '\r\n' : '\n';

  // Check if CodecPrivate already includes [Events] section
  const hasEvents = header.includes('[Events]');

  // Parse and sort blocks by ReadOrder
  const parsedBlocks: Array<{
    parsed: NonNullable<ReturnType<typeof parseAssBlockPayload>>;
    block: SubtitleBlock;
  }> = [];

  for (const block of blocks) {
    const text = decodeUtf8(block.data);
    const parsed = parseAssBlockPayload(text);
    if (parsed) {
      parsedBlocks.push({ parsed, block });
    }
  }

  // Sort by ReadOrder (original muxing order)
  parsedBlocks.sort((a, b) => a.parsed.readOrder - b.parsed.readOrder);

  // Build the output
  const parts: string[] = [];

  if (hasEvents) {
    // CodecPrivate already has [Events] and Format line
    // Trim trailing whitespace and add exactly one line ending
    parts.push(header.trimEnd() + lineEnding);
  } else {
    // Add [Events] section after header
    parts.push(header.trimEnd());
    parts.push(lineEnding + lineEnding);
    parts.push('[Events]' + lineEnding);
    parts.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text' + lineEnding);
  }

  for (const { parsed, block } of parsedBlocks) {
    const start = formatAssTimestamp(block.timestampMs);
    const end = formatAssTimestamp(block.timestampMs + (block.durationMs ?? 0));

    parts.push(
      `Dialogue: ${parsed.layer},${start},${end},${parsed.style},${parsed.name},` +
      `${parsed.marginL},${parsed.marginR},${parsed.marginV},${parsed.effect},${parsed.dialogueText}` +
      lineEnding
    );
  }

  // ASS files end with a trailing blank line
  parts.push(lineEnding);

  return encodeUtf8(parts.join(''));
}
