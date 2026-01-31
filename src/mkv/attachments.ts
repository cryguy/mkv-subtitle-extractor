import { RangeReader } from '../io/range-reader.js';
import { parseElementHeader, iterateChildren, readUtf8, readBinary } from '../ebml/parser.js';
import * as IDs from '../ebml/ids.js';
import type { FontFile } from '../types.js';

const FONT_MIME_TYPES = new Set([
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'font/sfnt',
  'application/font-ttf',
  'application/font-otf',
  'application/font-woff',
  'application/font-woff2',
  'application/x-truetype-font',
  'application/vnd.ms-opentype',
  'application/font-sfnt',
  'application/x-font-ttf',
  'application/x-font-otf',
]);

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

function isFontFile(mimeType: string, fileName: string): boolean {
  if (FONT_MIME_TYPES.has(mimeType.toLowerCase())) return true;
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? FONT_EXTENSIONS.has(ext) : false;
}

/**
 * Parse the Attachments element and return embedded font files.
 */
export async function parseAttachments(
  reader: RangeReader,
  segmentDataOffset: number,
  attachmentsPosition: number,
): Promise<FontFile[]> {
  const absoluteOffset = segmentDataOffset + attachmentsPosition;

  // Read header to get total size
  const headerData = await reader.read(absoluteOffset, 12);
  const attEl = parseElementHeader(headerData, 0);

  // Read full Attachments element data
  const totalSize = attEl.dataOffset + attEl.dataSize;
  const attData = await reader.read(absoluteOffset, totalSize);

  const fonts: FontFile[] = [];

  for (const fileEl of iterateChildren(attData, attEl.dataOffset, attEl.dataSize)) {
    if (fileEl.id !== IDs.ATTACHED_FILE) continue;

    let fileName = '';
    let mimeType = '';
    let fileData: Uint8Array | null = null;

    for (const child of iterateChildren(attData, fileEl.dataOffset, fileEl.dataSize)) {
      switch (child.id) {
        case IDs.FILE_NAME:
          fileName = readUtf8(attData, child.dataOffset, child.dataSize);
          break;
        case IDs.FILE_MIME_TYPE:
          mimeType = readUtf8(attData, child.dataOffset, child.dataSize);
          break;
        case IDs.FILE_DATA:
          fileData = readBinary(attData, child.dataOffset, child.dataSize);
          break;
      }
    }

    if (fileData && isFontFile(mimeType, fileName)) {
      fonts.push({ name: fileName, data: fileData });
    }
  }

  return fonts;
}
