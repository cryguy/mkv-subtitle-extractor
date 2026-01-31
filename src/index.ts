import { RangeReader } from './io/range-reader.js';
import { parseSegment } from './mkv/segment.js';
import { parseTracks } from './mkv/tracks.js';
import { parseAttachments } from './mkv/attachments.js';
import { parseCues } from './mkv/cues.js';
import { scanClusters, readTargetedBlocks } from './mkv/clusters.js';
import { assembleSubtitle, getSubtitleFormat } from './subtitle/assembler.js';
import * as IDs from './ebml/ids.js';
import { MkvParseError } from './errors.js';
import type { TrackResult, FontFile, ExtractOptions, SubtitleBlock } from './types.js';

// Re-export public types
export type { TrackResult, FontFile, ExtractOptions, SubtitleFormat } from './types.js';
export { RangeNotSupportedError, MkvParseError } from './errors.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Extract subtitle tracks and embedded fonts from an MKV file at the given URL.
 *
 * Uses HTTP Range requests to download only the bytes needed (~97% bandwidth savings).
 * Works in browsers and Node.js 18+.
 *
 * @param url - URL pointing to an MKV file (HTTP/HTTPS with Range support)
 * @param options - Extraction options
 * @returns Array of extracted subtitle track results
 */
export async function extractSubtitles(
  url: string,
  options?: ExtractOptions,
): Promise<TrackResult[]> {
  const verbose = options?.verbose ?? false;
  const log = verbose ? console.log.bind(console) : () => {};

  // 1. Initialize RangeReader
  const reader = new RangeReader(url, {
    allowFullDownload: options?.allowFullDownload,
    fetch: options?.fetch,
    headers: options?.headers,
  });
  await reader.init();

  log(`[mkv-extract] File size: ${formatBytes(reader.size)}`);
  log(`[mkv-extract] Downloaded after init: ${formatBytes(reader.bytesDownloaded)}`);

  // 2. Parse segment (EBML header, SeekHead, Info)
  const { segmentDataOffset, segmentDataSize, seekEntries, info } =
    await parseSegment(reader);

  log(`[mkv-extract] Parsed segment — ${seekEntries.length} SeekHead entries, TimestampScale=${info.timestampScale}`);
  log(`[mkv-extract] Downloaded after segment parse: ${formatBytes(reader.bytesDownloaded)}`);

  // 3. Find element positions from SeekHead
  const tracksEntry = seekEntries.find(e => e.id === IDs.TRACKS);
  const attachmentsEntry = seekEntries.find(e => e.id === IDs.ATTACHMENTS);
  const cuesEntry = seekEntries.find(e => e.id === IDs.CUES);
  const clusterEntry = seekEntries.find(e => e.id === IDs.CLUSTER);

  if (!tracksEntry) {
    throw new MkvParseError('No Tracks element found in SeekHead');
  }

  // 4. Parse Tracks — find subtitle tracks
  const subtitleTracks = await parseTracks(reader, segmentDataOffset, tracksEntry.position);

  log(`[mkv-extract] Found ${subtitleTracks.length} subtitle track(s):`);
  for (const t of subtitleTracks) {
    log(`[mkv-extract]   Track #${t.trackNumber}: ${t.codecId} lang=${t.language ?? 'und'} name=${t.trackName ?? '(none)'}`);
  }
  log(`[mkv-extract] Downloaded after tracks parse: ${formatBytes(reader.bytesDownloaded)}`);

  if (subtitleTracks.length === 0) return [];

  // 5. Filter by language if requested
  let filteredTracks = subtitleTracks;
  if (options?.languages?.length) {
    const langs = new Set(options.languages.map(l => l.toLowerCase()));
    filteredTracks = subtitleTracks.filter(
      t => t.language && langs.has(t.language.toLowerCase())
    );
    log(`[mkv-extract] After language filter (${options.languages.join(', ')}): ${filteredTracks.length} track(s)`);
  }

  if (filteredTracks.length === 0) return [];

  // 6. Parse Attachments (fonts) if present
  let fonts: FontFile[] = [];
  if (attachmentsEntry) {
    fonts = await parseAttachments(reader, segmentDataOffset, attachmentsEntry.position);
    log(`[mkv-extract] Extracted ${fonts.length} font(s): ${fonts.map(f => f.name).join(', ')}`);
    log(`[mkv-extract] Downloaded after attachments: ${formatBytes(reader.bytesDownloaded)}`);
  } else {
    log(`[mkv-extract] No attachments found`);
  }

  // 7. Get subtitle blocks — use Cues index if available, otherwise linear scan
  const trackNumbers = new Set(filteredTracks.map(t => t.trackNumber));
  let blocks: SubtitleBlock[];

  if (cuesEntry) {
    // Download and parse the Cues index
    log(`[mkv-extract] Downloading Cues index...`);
    const allCues = await parseCues(reader, segmentDataOffset, cuesEntry.position);
    log(`[mkv-extract] Parsed ${allCues.length} total Cue entries`);
    log(`[mkv-extract] Downloaded after Cues parse: ${formatBytes(reader.bytesDownloaded)}`);

    // Filter to only subtitle track entries
    const subtitleCues = allCues.filter(c => trackNumbers.has(c.track));
    log(`[mkv-extract] ${subtitleCues.length} Cue entries for subtitle tracks`);

    if (subtitleCues.length > 0) {
      const hasRelPos = subtitleCues.some(e => e.relativePosition !== undefined);
      log(`[mkv-extract] CueRelativePosition available: ${hasRelPos}`);
      log(`[mkv-extract] Reading targeted blocks from ${new Set(subtitleCues.map(c => c.clusterPosition)).size} cluster(s)...`);

      blocks = await readTargetedBlocks(
        reader, segmentDataOffset, subtitleCues,
        trackNumbers, info.timestampScale,
        options?.concurrency, log,
      );
    } else {
      // Cues exist but no subtitle entries — fall back to linear scan
      log(`[mkv-extract] No subtitle entries in Cues, falling back to linear cluster scan...`);
      blocks = await linearScan(reader, segmentDataOffset, segmentDataSize, clusterEntry, trackNumbers, info.timestampScale);
    }
  } else {
    // No Cues element — fall back to linear scan
    log(`[mkv-extract] No Cues element found, falling back to linear cluster scan...`);
    blocks = await linearScan(reader, segmentDataOffset, segmentDataSize, clusterEntry, trackNumbers, info.timestampScale);
  }

  log(`[mkv-extract] Found ${blocks.length} subtitle block(s)`);
  log(`[mkv-extract] Downloaded after block extraction: ${formatBytes(reader.bytesDownloaded)}`);

  // 8. Assemble subtitle files
  const results: TrackResult[] = [];

  for (const track of filteredTracks) {
    const trackBlocks = blocks.filter(b => b.trackNumber === track.trackNumber);
    const subtitle = assembleSubtitle(track, trackBlocks);
    const needsFonts = track.codecId === 'S_TEXT/ASS' || track.codecId === 'S_TEXT/SSA';

    log(`[mkv-extract] Assembled track #${track.trackNumber}: ${trackBlocks.length} blocks → ${formatBytes(subtitle.length)} ${getSubtitleFormat(track.codecId).toUpperCase()}`);

    results.push({
      type: getSubtitleFormat(track.codecId),
      metadata: {
        trackNumber: track.trackNumber,
        language: track.language,
        trackName: track.trackName,
      },
      output: {
        fonts: needsFonts ? fonts : null,
        subtitle,
      },
    });
  }

  log(`[mkv-extract] Done — ${reader.requestCount} requests, ${formatBytes(reader.bytesDownloaded)} downloaded / ${formatBytes(reader.size)} file size (${((reader.bytesDownloaded / reader.size) * 100).toFixed(1)}% of file)`);

  return results;
}

/** Fall back to scanning all clusters linearly when Cues are unavailable */
async function linearScan(
  reader: RangeReader,
  segmentDataOffset: number,
  segmentDataSize: number,
  clusterEntry: { position: number } | undefined,
  trackNumbers: Set<number>,
  timestampScale: number,
): Promise<SubtitleBlock[]> {
  const segmentEnd = segmentDataOffset + segmentDataSize;
  const scanStart = clusterEntry
    ? segmentDataOffset + clusterEntry.position
    : segmentDataOffset;

  return scanClusters(reader, scanStart, segmentEnd, trackNumbers, timestampScale);
}
