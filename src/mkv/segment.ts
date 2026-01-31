import { RangeReader } from '../io/range-reader.js';
import { parseElementHeader, iterateChildren, readUint } from '../ebml/parser.js';
import { readElementId } from '../ebml/vint.js';
import * as IDs from '../ebml/ids.js';
import { MkvParseError } from '../errors.js';
import type { SeekEntry, SegmentInfo, EbmlElement } from '../types.js';

export interface SegmentParseResult {
  /** Absolute byte offset where Segment data begins */
  segmentDataOffset: number;
  /** Size of Segment data in bytes */
  segmentDataSize: number;
  /** SeekHead entries pointing to top-level elements */
  seekEntries: SeekEntry[];
  /** Segment Info (TimestampScale) */
  info: SegmentInfo;
}

/**
 * Parse the EBML header and Segment element, extracting SeekHead entries and Info.
 */
export async function parseSegment(reader: RangeReader): Promise<SegmentParseResult> {
  // Single read from offset 0 — covers EBML header, Segment header, and metadata area.
  // init() pre-fetches 256KB so this is typically a cache hit.
  const readSize = Math.min(256 * 1024, reader.size);
  const data = await reader.read(0, readSize);

  // Parse EBML header
  const ebmlHeader = parseElementHeader(data, 0);
  if (ebmlHeader.id !== IDs.EBML_HEADER) {
    throw new MkvParseError('Not a valid EBML file: missing EBML header');
  }

  // Parse Segment element
  const segmentStart = ebmlHeader.dataOffset + ebmlHeader.dataSize;
  const segment = parseElementHeader(data, segmentStart);
  if (segment.id !== IDs.SEGMENT) {
    throw new MkvParseError('Not a valid MKV file: missing Segment element');
  }

  const segmentDataOffset = segment.dataOffset;
  const segmentDataSize = segment.unknownSize
    ? (reader.size - segment.dataOffset)
    : segment.dataSize;

  // Metadata area starts at segmentDataOffset within the same buffer
  const metaEnd = data.length - segmentDataOffset;
  const segData = data.subarray(segmentDataOffset);

  let seekEntries: SeekEntry[] = [];
  let info: SegmentInfo = { timestampScale: 1000000 };

  let offset = 0;
  while (offset < metaEnd - 2) {
    let element: EbmlElement;
    try {
      element = parseElementHeader(segData, offset);
    } catch {
      break;
    }

    if (element.id === IDs.SEEK_HEAD) {
      const entries = parseSeekHead(segData, element);
      seekEntries.push(...entries);
    } else if (element.id === IDs.INFO) {
      info = parseInfo(segData, element);
    } else if (element.id === IDs.CLUSTER) {
      // Stop scanning at first cluster
      break;
    }

    if (element.unknownSize) break;
    offset = element.dataOffset + element.dataSize;
  }

  return { segmentDataOffset, segmentDataSize, seekEntries, info };
}

function parseSeekHead(data: Uint8Array, seekHeadEl: EbmlElement): SeekEntry[] {
  const entries: SeekEntry[] = [];

  for (const seekEl of iterateChildren(data, seekHeadEl.dataOffset, seekHeadEl.dataSize)) {
    if (seekEl.id !== IDs.SEEK) continue;

    let seekId = 0;
    let seekPosition = 0;

    for (const child of iterateChildren(data, seekEl.dataOffset, seekEl.dataSize)) {
      if (child.id === IDs.SEEK_ID) {
        const idBytes = data.subarray(child.dataOffset, child.dataOffset + child.dataSize);
        const parsed = readElementId(idBytes, 0);
        seekId = parsed.value;
      } else if (child.id === IDs.SEEK_POSITION) {
        seekPosition = readUint(data, child.dataOffset, child.dataSize);
      }
    }

    if (seekId !== 0) {
      entries.push({ id: seekId, position: seekPosition });
    }
  }

  return entries;
}

function parseInfo(data: Uint8Array, infoEl: EbmlElement): SegmentInfo {
  let timestampScale = 1000000; // default: 1ms

  for (const child of iterateChildren(data, infoEl.dataOffset, infoEl.dataSize)) {
    if (child.id === IDs.TIMESTAMP_SCALE) {
      timestampScale = readUint(data, child.dataOffset, child.dataSize);
    }
  }

  return { timestampScale };
}
