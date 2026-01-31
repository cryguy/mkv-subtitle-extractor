import { RangeReader } from '../io/range-reader.js';
import { parseElementHeader, iterateChildren, readUint } from '../ebml/parser.js';
import { readTrackNumber } from '../ebml/vint.js';
import * as IDs from '../ebml/ids.js';
import type { SubtitleBlock, EbmlElement } from '../types.js';
import type { CueEntry } from './cues.js';

const HEADER_READ_SIZE = 16; // enough for element ID (up to 4 bytes) + data size (up to 8 bytes)
const MAX_BATCH_GAP = 2 * 1024 * 1024; // 2MB — absolute cap for gap between batched blocks
const BLOCK_SIZE_ESTIMATE = 4096; // generous estimate for a subtitle block element
const READ_AHEAD = 32 * 1024; // matches RangeReader.READ_AHEAD_SIZE

interface BlockTarget {
  absPos: number;
  entry: CueEntry;
}

/**
 * Scan clusters for subtitle blocks, skipping video/audio data.
 *
 * @param reader - RangeReader instance
 * @param startOffset - Absolute file offset to start scanning (first cluster)
 * @param endOffset - Absolute file offset of end of segment
 * @param subtitleTrackNumbers - Set of track numbers that are subtitles
 * @param timestampScale - Nanoseconds per timestamp unit
 */
export async function scanClusters(
  reader: RangeReader,
  startOffset: number,
  endOffset: number,
  subtitleTrackNumbers: Set<number>,
  timestampScale: number,
): Promise<SubtitleBlock[]> {
  const blocks: SubtitleBlock[] = [];
  let offset = startOffset;
  const tsMultiplier = timestampScale / 1_000_000; // convert raw units to milliseconds

  while (offset < endOffset) {
    const remaining = endOffset - offset;
    if (remaining < 4) break;

    const headerBuf = await reader.read(offset, Math.min(HEADER_READ_SIZE, remaining));

    let element: EbmlElement;
    try {
      element = parseElementHeader(headerBuf, 0);
    } catch {
      break;
    }

    const headerSize = element.dataOffset; // bytes consumed by ID + size
    const absDataOffset = offset + headerSize;

    if (element.id === IDs.CLUSTER) {
      // Process cluster contents
      const clusterEnd = element.unknownSize
        ? endOffset
        : absDataOffset + element.dataSize;

      const { clusterBlocks, nextOffset } = await processCluster(
        reader,
        absDataOffset,
        clusterEnd,
        element.unknownSize,
        subtitleTrackNumbers,
        tsMultiplier,
      );
      blocks.push(...clusterBlocks);
      offset = nextOffset;
    } else {
      // Skip non-cluster segment-level elements
      if (element.unknownSize) break;
      offset = absDataOffset + element.dataSize;
    }
  }

  return blocks;
}

interface ClusterResult {
  clusterBlocks: SubtitleBlock[];
  nextOffset: number;
}

async function processCluster(
  reader: RangeReader,
  clusterDataStart: number,
  clusterEnd: number,
  unknownSize: boolean,
  subtitleTrackNumbers: Set<number>,
  tsMultiplier: number,
): Promise<ClusterResult> {
  const blocks: SubtitleBlock[] = [];
  let offset = clusterDataStart;
  let clusterTimestamp = 0;

  while (offset < clusterEnd) {
    const remaining = clusterEnd - offset;
    if (remaining < 4) break;

    const headerBuf = await reader.read(offset, Math.min(HEADER_READ_SIZE, remaining));

    let element: EbmlElement;
    try {
      element = parseElementHeader(headerBuf, 0);
    } catch {
      break;
    }

    const headerSize = element.dataOffset;
    const absDataOffset = offset + headerSize;

    // For unknown-size clusters, detect next segment-level element
    if (unknownSize && IDs.SEGMENT_LEVEL_IDS.has(element.id)) {
      return { clusterBlocks: blocks, nextOffset: offset };
    }

    if (element.id === IDs.CLUSTER_TIMESTAMP) {
      // Read cluster timestamp value
      if (element.dataSize <= headerBuf.length - headerSize) {
        clusterTimestamp = readUint(headerBuf, headerSize, element.dataSize);
      } else {
        const tsData = await reader.read(absDataOffset, element.dataSize);
        clusterTimestamp = readUint(tsData, 0, element.dataSize);
      }
      offset = absDataOffset + element.dataSize;
    } else if (element.id === IDs.SIMPLE_BLOCK) {
      const block = await parseSimpleBlock(
        reader,
        absDataOffset,
        element.dataSize,
        clusterTimestamp,
        tsMultiplier,
        subtitleTrackNumbers,
      );
      if (block) blocks.push(block);
      offset = absDataOffset + element.dataSize;
    } else if (element.id === IDs.BLOCK_GROUP) {
      const groupBlocks = await processBlockGroup(
        reader,
        absDataOffset,
        element.dataSize,
        clusterTimestamp,
        tsMultiplier,
        subtitleTrackNumbers,
      );
      blocks.push(...groupBlocks);
      offset = absDataOffset + element.dataSize;
    } else {
      // Skip unknown elements
      if (element.unknownSize) break;
      offset = absDataOffset + element.dataSize;
    }
  }

  return { clusterBlocks: blocks, nextOffset: clusterEnd };
}

async function parseSimpleBlock(
  reader: RangeReader,
  dataOffset: number,
  dataSize: number,
  clusterTimestamp: number,
  tsMultiplier: number,
  subtitleTrackNumbers: Set<number>,
): Promise<SubtitleBlock | null> {
  // Read enough to peek at track number (1-4 bytes VINT + 2 bytes timestamp + 1 flags)
  const peekSize = Math.min(8, dataSize);
  const peekBuf = await reader.read(dataOffset, peekSize);

  const trackVint = readTrackNumber(peekBuf, 0);
  const trackNum = trackVint.value;

  if (!subtitleTrackNumbers.has(trackNum)) {
    return null; // Skip non-subtitle block entirely
  }

  // It's a subtitle block — read the full payload
  const blockData = await reader.read(dataOffset, dataSize);

  const tsOffset = trackVint.length;
  const relativeTimestamp = (blockData[tsOffset] << 8) | blockData[tsOffset + 1];
  const signedRelTs = relativeTimestamp > 32767 ? relativeTimestamp - 65536 : relativeTimestamp;

  const payloadStart = tsOffset + 3; // track VINT + 2 ts bytes + 1 flags byte
  const payload = blockData.slice(payloadStart);

  const absoluteTimestamp = (clusterTimestamp + signedRelTs) * tsMultiplier;

  return {
    trackNumber: trackNum,
    timestampMs: absoluteTimestamp,
    durationMs: undefined,
    data: payload,
    additions: null,
  };
}

async function processBlockGroup(
  reader: RangeReader,
  groupDataStart: number,
  groupDataSize: number,
  clusterTimestamp: number,
  tsMultiplier: number,
  subtitleTrackNumbers: Set<number>,
): Promise<SubtitleBlock[]> {
  // First, peek at the Block element to check the track number.
  // BlockGroup children: Block, BlockDuration, BlockAdditions, etc.
  // We need to read the group to find the Block and check its track number.
  // For efficiency, read only what we need.

  // Read the first few bytes to peek at the Block element header
  const peekSize = Math.min(32, groupDataSize);
  const peekBuf = await reader.read(groupDataStart, peekSize);

  // Quick scan: find the Block element and check its track number
  let peekOffset = 0;
  let blockTrackNum = -1;
  while (peekOffset < peekBuf.length - 4) {
    try {
      const el = parseElementHeader(peekBuf, peekOffset);
      if (el.id === IDs.BLOCK) {
        // Peek at block track number
        const blockHeaderStart = el.dataOffset;
        if (blockHeaderStart < peekBuf.length) {
          const tv = readTrackNumber(peekBuf, blockHeaderStart);
          blockTrackNum = tv.value;
        }
        break;
      }
      if (el.unknownSize) break;
      peekOffset = el.dataOffset + el.dataSize;
    } catch {
      break;
    }
  }

  if (blockTrackNum < 0 || !subtitleTrackNumbers.has(blockTrackNum)) {
    return []; // Not a subtitle block group — skip
  }

  // It's a subtitle — read the entire BlockGroup
  const groupData = await reader.read(groupDataStart, groupDataSize);

  let blockElement: EbmlElement | null = null;
  let blockDuration: number | undefined;
  let additions: Uint8Array | null = null;

  for (const child of iterateChildren(groupData, 0, groupDataSize)) {
    if (child.id === IDs.BLOCK) {
      blockElement = child;
    } else if (child.id === IDs.BLOCK_DURATION) {
      blockDuration = readUint(groupData, child.dataOffset, child.dataSize);
    } else if (child.id === IDs.BLOCK_ADDITIONS) {
      additions = parseBlockAdditions(groupData, child);
    }
  }

  if (!blockElement) return [];

  const blockData = groupData.subarray(blockElement.dataOffset, blockElement.dataOffset + blockElement.dataSize);
  const trackVint = readTrackNumber(blockData, 0);

  const tsOffset = trackVint.length;
  const relativeTimestamp = (blockData[tsOffset] << 8) | blockData[tsOffset + 1];
  const signedRelTs = relativeTimestamp > 32767 ? relativeTimestamp - 65536 : relativeTimestamp;

  const payloadStart = tsOffset + 3; // track VINT + 2 ts bytes + 1 flags byte
  const payload = blockData.slice(payloadStart);

  const absoluteTimestamp = (clusterTimestamp + signedRelTs) * tsMultiplier;
  const durationMs = blockDuration !== undefined ? blockDuration * tsMultiplier : undefined;

  return [{
    trackNumber: trackVint.value,
    timestampMs: absoluteTimestamp,
    durationMs,
    data: payload,
    additions,
  }];
}

function parseBlockAdditions(data: Uint8Array, additionsEl: EbmlElement): Uint8Array | null {
  for (const blockMore of iterateChildren(data, additionsEl.dataOffset, additionsEl.dataSize)) {
    if (blockMore.id !== IDs.BLOCK_MORE) continue;

    for (const child of iterateChildren(data, blockMore.dataOffset, blockMore.dataSize)) {
      if (child.id === IDs.BLOCK_ADDITIONAL) {
        return data.slice(child.dataOffset, child.dataOffset + child.dataSize);
      }
    }
  }
  return null;
}

/**
 * Read subtitle blocks using Cue index entries, jumping directly to each block
 * instead of linearly scanning the entire file.
 *
 * Uses heuristic batch grouping: blocks that are close together in the file
 * (based on Cue positions) are read in a single larger HTTP request instead of
 * individual small requests. The batch threshold adapts to the file's block
 * distribution — tightly-clustered blocks (short clusters, multiple subtitle
 * tracks) trigger aggressive batching, while widely-spaced blocks use
 * conservative thresholds.
 */
export async function readTargetedBlocks(
  reader: RangeReader,
  segmentDataOffset: number,
  cueEntries: CueEntry[],
  subtitleTrackNumbers: Set<number>,
  timestampScale: number,
  concurrency?: number,
  log?: (msg: string) => void,
): Promise<SubtitleBlock[]> {
  const blocks: SubtitleBlock[] = [];
  const tsMultiplier = timestampScale / 1_000_000;
  const workers = Math.max(1, concurrency ?? 1);

  // Group entries by cluster position
  const clusterGroups = new Map<number, CueEntry[]>();
  for (const entry of cueEntries) {
    const group = clusterGroups.get(entry.clusterPosition);
    if (group) {
      group.push(entry);
    } else {
      clusterGroups.set(entry.clusterPosition, [entry]);
    }
  }

  // Probe one cluster header to learn the header size.
  // All clusters in an MKV file use the same VINT width for the data size,
  // so we can read one and reuse the result for all others.
  const firstClusterPos = cueEntries[0].clusterPosition;
  const probeBuf = await reader.read(segmentDataOffset + firstClusterPos, HEADER_READ_SIZE);
  const clusterHeaderSize = parseElementHeader(probeBuf, 0).dataOffset;

  // Compute absolute file positions for all blocks with CueRelativePosition.
  // Blocks without it fall back to full-cluster scanning.
  const directTargets: BlockTarget[] = [];
  const fallbackClusters: [number, CueEntry[]][] = [];

  for (const [clusterPos, entries] of clusterGroups) {
    if (entries.every(e => e.relativePosition !== undefined)) {
      for (const entry of entries) {
        directTargets.push({
          absPos: segmentDataOffset + clusterPos + clusterHeaderSize + entry.relativePosition!,
          entry,
        });
      }
    } else {
      fallbackClusters.push([clusterPos, entries]);
    }
  }

  // Sort by file position to enable batch optimization
  directTargets.sort((a, b) => a.absPos - b.absPos);

  // ── Heuristic batch grouping ──
  // Analyze gaps between consecutive block positions. When blocks are near
  // each other (same cluster, short-duration clusters, multiple subtitle
  // tracks), a single larger read is cheaper than many individual HTTP
  // round-trips. The threshold adapts to the file's block distribution.
  if (directTargets.length > 0) {
    const batchThreshold = computeBatchThreshold(directTargets);
    const batches = groupIntoBatches(directTargets, batchThreshold);

    log?.(`[mkv-extract] Batch heuristic: ${directTargets.length} blocks → ${batches.length} read(s) (gap threshold: ${formatSize(batchThreshold)})${workers > 1 ? `, concurrency=${workers}` : ''}`);

    /** Process a single batch: one read, then parse all blocks from the buffer */
    async function processBatch(batch: BlockTarget[]): Promise<SubtitleBlock[]> {
      const batchBlocks: SubtitleBlock[] = [];
      const readStart = batch[0].absPos;
      const readEnd = batch[batch.length - 1].absPos + BLOCK_SIZE_ESTIMATE;
      const batchData = await reader.read(readStart, readEnd - readStart);

      for (const target of batch) {
        const localOffset = target.absPos - readStart;
        const remaining = batchData.length - localOffset;
        if (remaining < HEADER_READ_SIZE) continue;

        let elementData: Uint8Array;
        let el: EbmlElement;

        try {
          const headerEl = parseElementHeader(batchData, localOffset);
          const elementEnd = headerEl.dataOffset + headerEl.dataSize;

          if (elementEnd <= batchData.length) {
            // Block fits within batch buffer — zero-copy subarray
            elementData = batchData.subarray(localOffset, elementEnd);
            el = parseElementHeader(elementData, 0);
          } else {
            // Block extends beyond batch — individual read fallback
            const elementSize = headerEl.dataOffset - localOffset + headerEl.dataSize;
            elementData = await reader.read(target.absPos, elementSize);
            el = parseElementHeader(elementData, 0);
          }
        } catch {
          continue;
        }

        const block = parseBlockElement(
          elementData, el, target.entry.time * tsMultiplier,
          subtitleTrackNumbers, tsMultiplier,
        );
        if (block) batchBlocks.push(block);
      }
      return batchBlocks;
    }

    if (workers <= 1) {
      // Sequential — default, gentle on servers
      for (const batch of batches) {
        blocks.push(...await processBatch(batch));
      }
    } else {
      // Parallel with sliding-window concurrency limit
      const results = await mapConcurrent(batches, workers, processBatch);
      for (const batchBlocks of results) {
        blocks.push(...batchBlocks);
      }
    }
  }

  // Handle fallback clusters (no CueRelativePosition) — always sequential
  for (const [clusterPos] of fallbackClusters) {
    const absPos = segmentDataOffset + clusterPos;
    const headerBuf = await reader.read(absPos, HEADER_READ_SIZE);
    const clusterEl = parseElementHeader(headerBuf, 0);

    const clusterDataStart = absPos + clusterEl.dataOffset;
    const clusterEnd = clusterEl.unknownSize
      ? reader.size
      : clusterDataStart + clusterEl.dataSize;

    const { clusterBlocks } = await processCluster(
      reader, clusterDataStart, clusterEnd, clusterEl.unknownSize,
      subtitleTrackNumbers, tsMultiplier,
    );
    blocks.push(...clusterBlocks);
  }

  // Re-sort by timestamp — parallel/batched reads may produce out-of-order results
  blocks.sort((a, b) => a.timestampMs - b.timestampMs);

  return blocks;
}

/**
 * Run an async function over an array with a concurrency limit.
 * Uses a sliding-window worker pool so no worker idles while work remains.
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Analyze gap distribution between sorted block positions and compute an
 * adaptive batch threshold.
 *
 * - Tightly-clustered blocks (median gap < 2MB): threshold = 2× median gap,
 *   capturing most natural block groups without excessive over-read.
 * - Widely-spaced blocks: conservative 128KB threshold that only merges
 *   blocks coincidentally close (e.g., multiple blocks within one cluster).
 *
 * The threshold is always at least READ_AHEAD (32KB) since gaps smaller than
 * that are already free cache hits, and capped at MAX_BATCH_GAP (2MB).
 */
function computeBatchThreshold(targets: BlockTarget[]): number {
  if (targets.length < 2) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < targets.length; i++) {
    gaps.push(targets[i].absPos - targets[i - 1].absPos);
  }
  gaps.sort((a, b) => a - b);

  const medianGap = gaps[Math.floor(gaps.length / 2)];

  if (medianGap < MAX_BATCH_GAP) {
    // Blocks are generally clustered — use 2× median to capture most groups
    return Math.min(Math.max(medianGap * 2, READ_AHEAD), MAX_BATCH_GAP);
  }

  // Widely-spaced blocks — only merge very close ones (within-cluster pairs)
  return 128 * 1024;
}

/**
 * Group sorted block targets into batches where consecutive blocks are
 * within the given gap threshold.
 */
function groupIntoBatches(targets: BlockTarget[], threshold: number): BlockTarget[][] {
  const batches: BlockTarget[][] = [];
  let current: BlockTarget[] = [targets[0]];

  for (let i = 1; i < targets.length; i++) {
    if (targets[i].absPos - targets[i - 1].absPos <= threshold) {
      current.push(targets[i]);
    } else {
      batches.push(current);
      current = [targets[i]];
    }
  }
  batches.push(current);

  return batches;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parse a BlockGroup or SimpleBlock element that we've jumped to directly,
 * using the CueTime as the absolute timestamp.
 */
function parseBlockElement(
  elementData: Uint8Array,
  el: EbmlElement,
  cueTimeMs: number,
  subtitleTrackNumbers: Set<number>,
  tsMultiplier: number,
): SubtitleBlock | null {
  if (el.id === IDs.SIMPLE_BLOCK) {
    const blockData = elementData.subarray(el.dataOffset, el.dataOffset + el.dataSize);
    const trackVint = readTrackNumber(blockData, 0);
    if (!subtitleTrackNumbers.has(trackVint.value)) return null;

    const payloadStart = trackVint.length + 3;
    return {
      trackNumber: trackVint.value,
      timestampMs: cueTimeMs,
      durationMs: undefined,
      data: blockData.slice(payloadStart),
      additions: null,
    };
  }

  if (el.id === IDs.BLOCK_GROUP) {
    let blockPayload: Uint8Array | null = null;
    let trackNum = 0;
    let blockDuration: number | undefined;
    let additions: Uint8Array | null = null;

    for (const child of iterateChildren(elementData, el.dataOffset, el.dataSize)) {
      if (child.id === IDs.BLOCK) {
        const raw = elementData.subarray(child.dataOffset, child.dataOffset + child.dataSize);
        const tv = readTrackNumber(raw, 0);
        trackNum = tv.value;
        const payloadStart = tv.length + 3;
        blockPayload = raw.slice(payloadStart);
      } else if (child.id === IDs.BLOCK_DURATION) {
        blockDuration = readUint(elementData, child.dataOffset, child.dataSize);
      } else if (child.id === IDs.BLOCK_ADDITIONS) {
        additions = parseBlockAdditions(elementData, child);
      }
    }

    if (!blockPayload || !subtitleTrackNumbers.has(trackNum)) return null;

    return {
      trackNumber: trackNum,
      timestampMs: cueTimeMs,
      durationMs: blockDuration !== undefined ? blockDuration * tsMultiplier : undefined,
      data: blockPayload,
      additions,
    };
  }

  return null;
}
