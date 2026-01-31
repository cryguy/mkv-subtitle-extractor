/** Subtitle format type */
export type SubtitleFormat = 'srt' | 'ass' | 'ssa' | 'vtt';

/** Embedded font file */
export interface FontFile {
  /** Original filename (e.g. "Arial.ttf") */
  name: string;
  /** Raw font file data */
  data: Uint8Array;
}

/** Result for a single subtitle track */
export interface TrackResult {
  /** Subtitle format */
  type: SubtitleFormat;
  /** Track metadata from the MKV container */
  metadata: {
    trackNumber: number;
    language: string | undefined;
    trackName: string | undefined;
  };
  /** The extracted content */
  output: {
    /** Embedded fonts used by this track (ASS/SSA only, null otherwise) */
    fonts: FontFile[] | null;
    /** The complete subtitle file as raw bytes */
    subtitle: Uint8Array;
  };
}

/** Options for extractSubtitles() */
export interface ExtractOptions {
  /** Allow full file download if Range requests aren't supported */
  allowFullDownload?: boolean;
  /** Filter by language codes (BCP 47 or ISO 639-2) */
  languages?: string[];
  /** Custom fetch function */
  fetch?: typeof globalThis.fetch;
  /** Custom headers (e.g. for auth or CORS) */
  headers?: Record<string, string>;
  /** Log progress and download stats to console */
  verbose?: boolean;
  /**
   * Maximum number of concurrent HTTP requests when fetching subtitle blocks.
   * Higher values reduce latency but increase server load.
   * Default: 1 (sequential requests).
   */
  concurrency?: number;
}

// ── Internal Types ──

/** Parsed EBML element header */
export interface EbmlElement {
  id: number;
  dataSize: number;
  /** Byte offset where this element's header starts */
  headerOffset: number;
  /** Byte offset where this element's data starts */
  dataOffset: number;
  /** True if dataSize is unknown (-1) */
  unknownSize: boolean;
}

/** A subtitle block extracted from a cluster */
export interface SubtitleBlock {
  trackNumber: number;
  /** Absolute timestamp in milliseconds */
  timestampMs: number;
  /** Block duration in milliseconds (if available) */
  durationMs: number | undefined;
  /** The raw block payload (subtitle text) */
  data: Uint8Array;
  /** BlockAdditions data (for WebVTT cue settings) */
  additions: Uint8Array | null;
}

/** Information about a subtitle track from the Tracks element */
export interface SubtitleTrackInfo {
  trackNumber: number;
  codecId: string;
  codecPrivate: Uint8Array | null;
  language: string | undefined;
  trackName: string | undefined;
  defaultDuration: number | undefined;
}

/** SeekHead entry */
export interface SeekEntry {
  id: number;
  /** Byte offset relative to Segment data start */
  position: number;
}

/** Segment-level info */
export interface SegmentInfo {
  /** Nanoseconds per timestamp unit, default 1000000 (= 1ms) */
  timestampScale: number;
}
