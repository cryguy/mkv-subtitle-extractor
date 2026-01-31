// EBML Header
export const EBML_HEADER = 0x1A45DFA3;

// Segment
export const SEGMENT = 0x18538067;

// SeekHead
export const SEEK_HEAD = 0x114D9B74;
export const SEEK = 0x4DBB;
export const SEEK_ID = 0x53AB;
export const SEEK_POSITION = 0x53AC;

// Segment Info
export const INFO = 0x1549A966;
export const TIMESTAMP_SCALE = 0x2AD7B1;
export const DURATION = 0x4489;

// Tracks
export const TRACKS = 0x1654AE6B;
export const TRACK_ENTRY = 0xAE;
export const TRACK_NUMBER = 0xD7;
export const TRACK_TYPE = 0x83;
export const CODEC_ID = 0x86;
export const CODEC_PRIVATE = 0x63A2;
export const LANGUAGE = 0x22B59C;
export const LANGUAGE_BCP47 = 0x22B59D;
export const NAME = 0x536E;
export const DEFAULT_DURATION = 0x23E383;

// Attachments
export const ATTACHMENTS = 0x1941A469;
export const ATTACHED_FILE = 0x61A7;
export const FILE_NAME = 0x466E;
export const FILE_MIME_TYPE = 0x4660;
export const FILE_DATA = 0x465C;

// Cluster
export const CLUSTER = 0x1F43B675;
export const CLUSTER_TIMESTAMP = 0xE7;
export const SIMPLE_BLOCK = 0xA3;
export const BLOCK_GROUP = 0xA0;
export const BLOCK = 0xA1;
export const BLOCK_DURATION = 0x9B;
export const BLOCK_ADDITIONS = 0x75A1;
export const BLOCK_MORE = 0xA6;
export const BLOCK_ADD_ID = 0xEE;
export const BLOCK_ADDITIONAL = 0xA5;

// Cues
export const CUES = 0x1C53BB6B;
export const CUE_POINT = 0xBB;
export const CUE_TIME = 0xB3;
export const CUE_TRACK_POSITIONS = 0xB7;
export const CUE_TRACK = 0xF7;
export const CUE_CLUSTER_POSITION = 0xF1;
export const CUE_RELATIVE_POSITION = 0xF0;

// Chapters
export const CHAPTERS = 0x1043A770;

// Tags
export const TAGS = 0x1254C367;

/** Set of top-level segment children IDs (for detecting element boundaries) */
export const SEGMENT_LEVEL_IDS = new Set<number>([
  SEEK_HEAD, INFO, TRACKS, ATTACHMENTS, CLUSTER, CUES, CHAPTERS, TAGS,
]);
