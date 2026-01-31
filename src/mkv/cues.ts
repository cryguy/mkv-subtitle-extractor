import { RangeReader } from '../io/range-reader.js';
import { parseElementHeader, iterateChildren, readUint } from '../ebml/parser.js';
import * as IDs from '../ebml/ids.js';

/** A single Cue index entry mapping a track+timestamp to a cluster position */
export interface CueEntry {
  /** Absolute timestamp in raw timestamp units */
  time: number;
  /** Track number */
  track: number;
  /** Cluster position relative to Segment data start */
  clusterPosition: number;
  /** Offset within the cluster data to the Block element (optional) */
  relativePosition: number | undefined;
}

/**
 * Parse the Cues element and return all index entries.
 */
export async function parseCues(
  reader: RangeReader,
  segmentDataOffset: number,
  cuesPosition: number,
): Promise<CueEntry[]> {
  const absoluteOffset = segmentDataOffset + cuesPosition;

  // Read header to get total size
  const headerData = await reader.read(absoluteOffset, 12);
  const cuesEl = parseElementHeader(headerData, 0);

  // Read full Cues element data
  const totalSize = cuesEl.dataOffset + cuesEl.dataSize;
  const cuesData = await reader.read(absoluteOffset, totalSize);

  const entries: CueEntry[] = [];

  for (const pointEl of iterateChildren(cuesData, cuesEl.dataOffset, cuesEl.dataSize)) {
    if (pointEl.id !== IDs.CUE_POINT) continue;

    let cueTime = 0;

    // First pass: get CueTime
    for (const child of iterateChildren(cuesData, pointEl.dataOffset, pointEl.dataSize)) {
      if (child.id === IDs.CUE_TIME) {
        cueTime = readUint(cuesData, child.dataOffset, child.dataSize);
        break;
      }
    }

    // Second pass: collect CueTrackPositions
    for (const child of iterateChildren(cuesData, pointEl.dataOffset, pointEl.dataSize)) {
      if (child.id !== IDs.CUE_TRACK_POSITIONS) continue;

      let track = 0;
      let clusterPosition = 0;
      let relativePosition: number | undefined;

      for (const posChild of iterateChildren(cuesData, child.dataOffset, child.dataSize)) {
        switch (posChild.id) {
          case IDs.CUE_TRACK:
            track = readUint(cuesData, posChild.dataOffset, posChild.dataSize);
            break;
          case IDs.CUE_CLUSTER_POSITION:
            clusterPosition = readUint(cuesData, posChild.dataOffset, posChild.dataSize);
            break;
          case IDs.CUE_RELATIVE_POSITION:
            relativePosition = readUint(cuesData, posChild.dataOffset, posChild.dataSize);
            break;
        }
      }

      entries.push({ time: cueTime, track, clusterPosition, relativePosition });
    }
  }

  return entries;
}
