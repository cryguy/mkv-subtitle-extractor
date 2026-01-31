import { RangeReader } from '../io/range-reader.js';
import { parseElementHeader, iterateChildren, readUint, readUtf8, readBinary } from '../ebml/parser.js';
import * as IDs from '../ebml/ids.js';
import type { SubtitleTrackInfo } from '../types.js';

const SUBTITLE_TRACK_TYPE = 17;

/**
 * Parse the Tracks element and return information about subtitle tracks.
 */
export async function parseTracks(
  reader: RangeReader,
  segmentDataOffset: number,
  tracksPosition: number,
): Promise<SubtitleTrackInfo[]> {
  const absoluteOffset = segmentDataOffset + tracksPosition;

  // Read Tracks header first to get size
  const headerData = await reader.read(absoluteOffset, 12);
  const tracksEl = parseElementHeader(headerData, 0);

  // Read full Tracks element data
  const totalSize = tracksEl.dataOffset + tracksEl.dataSize;
  const tracksData = await reader.read(absoluteOffset, totalSize);

  const subtitleTracks: SubtitleTrackInfo[] = [];

  for (const entryEl of iterateChildren(tracksData, tracksEl.dataOffset, tracksEl.dataSize)) {
    if (entryEl.id !== IDs.TRACK_ENTRY) continue;

    let trackNumber = 0;
    let trackType = 0;
    let codecId = '';
    let codecPrivate: Uint8Array | null = null;
    let language: string | undefined;
    let trackName: string | undefined;
    let defaultDuration: number | undefined;

    for (const child of iterateChildren(tracksData, entryEl.dataOffset, entryEl.dataSize)) {
      switch (child.id) {
        case IDs.TRACK_NUMBER:
          trackNumber = readUint(tracksData, child.dataOffset, child.dataSize);
          break;
        case IDs.TRACK_TYPE:
          trackType = readUint(tracksData, child.dataOffset, child.dataSize);
          break;
        case IDs.CODEC_ID:
          codecId = readUtf8(tracksData, child.dataOffset, child.dataSize);
          break;
        case IDs.CODEC_PRIVATE:
          codecPrivate = readBinary(tracksData, child.dataOffset, child.dataSize);
          break;
        case IDs.LANGUAGE:
          if (language === undefined) {
            language = readUtf8(tracksData, child.dataOffset, child.dataSize);
          }
          break;
        case IDs.LANGUAGE_BCP47:
          // BCP47 takes priority over legacy Language
          language = readUtf8(tracksData, child.dataOffset, child.dataSize);
          break;
        case IDs.NAME:
          trackName = readUtf8(tracksData, child.dataOffset, child.dataSize);
          break;
        case IDs.DEFAULT_DURATION:
          defaultDuration = readUint(tracksData, child.dataOffset, child.dataSize);
          break;
      }
    }

    if (trackType === SUBTITLE_TRACK_TYPE) {
      subtitleTracks.push({
        trackNumber,
        codecId,
        codecPrivate,
        language: language === 'und' ? undefined : language,
        trackName,
        defaultDuration,
      });
    }
  }

  return subtitleTracks;
}
