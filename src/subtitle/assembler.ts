import type { SubtitleBlock, SubtitleTrackInfo, SubtitleFormat } from '../types.js';
import { assembleSrt } from './srt.js';
import { assembleAss } from './ass.js';
import { assembleVtt } from './vtt.js';

/** Map CodecID to subtitle format */
export function getSubtitleFormat(codecId: string): SubtitleFormat {
  switch (codecId) {
    case 'S_TEXT/UTF8':
      return 'srt';
    case 'S_TEXT/ASS':
      return 'ass';
    case 'S_TEXT/SSA':
      return 'ssa';
    case 'S_TEXT/WEBVTT':
      return 'vtt';
    default:
      return 'srt'; // fallback
  }
}

/**
 * Assemble a complete subtitle file from track info and extracted blocks.
 * Routes to the appropriate format-specific assembler based on CodecID.
 */
export function assembleSubtitle(track: SubtitleTrackInfo, blocks: SubtitleBlock[]): Uint8Array {
  switch (track.codecId) {
    case 'S_TEXT/UTF8':
      return assembleSrt(blocks);
    case 'S_TEXT/ASS':
    case 'S_TEXT/SSA':
      return assembleAss(track, blocks);
    case 'S_TEXT/WEBVTT':
      return assembleVtt(track, blocks);
    default:
      return assembleSrt(blocks);
  }
}
