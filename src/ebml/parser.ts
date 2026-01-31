import { readElementId, readDataSize } from './vint.js';
import type { EbmlElement } from '../types.js';

/**
 * Parse an EBML element header from a buffer at the given offset.
 */
export function parseElementHeader(data: Uint8Array, offset: number): EbmlElement {
  const headerOffset = offset;

  const id = readElementId(data, offset);
  offset += id.length;

  const size = readDataSize(data, offset);
  offset += size.length;

  return {
    id: id.value,
    dataSize: size.value === -1 ? -1 : size.value,
    headerOffset,
    dataOffset: offset,
    unknownSize: size.value === -1,
  };
}

/**
 * Iterate over child elements of a parent element within a buffer.
 * Yields EbmlElement for each child.
 */
export function* iterateChildren(
  data: Uint8Array,
  parentDataOffset: number,
  parentDataSize: number,
): Generator<EbmlElement> {
  const end = parentDataOffset + parentDataSize;
  let offset = parentDataOffset;

  while (offset < end) {
    if (offset + 2 > data.length) break;

    try {
      const element = parseElementHeader(data, offset);
      yield element;

      if (element.unknownSize) break;
      offset = element.dataOffset + element.dataSize;
    } catch {
      break;
    }
  }
}

/** Read an unsigned integer from element data */
export function readUint(data: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + data[offset + i];
  }
  return value;
}

/** Read a signed integer from element data */
export function readSint(data: Uint8Array, offset: number, length: number): number {
  if (length === 0) return 0;
  let value = data[offset];
  if (value & 0x80) {
    value -= 256;
  }
  for (let i = 1; i < length; i++) {
    value = value * 256 + data[offset + i];
  }
  return value;
}

/** Read UTF-8 string from element data, trimming trailing null bytes */
export function readUtf8(data: Uint8Array, offset: number, length: number): string {
  const decoder = new TextDecoder('utf-8');
  let end = offset + length;
  while (end > offset && data[end - 1] === 0) {
    end--;
  }
  return decoder.decode(data.subarray(offset, end));
}

/** Read a float from element data (4 or 8 bytes) */
export function readFloat(data: Uint8Array, offset: number, length: number): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, length);
  if (length === 4) {
    return view.getFloat32(0, false);
  } else if (length === 8) {
    return view.getFloat64(0, false);
  }
  throw new Error(`Invalid float size: ${length}`);
}

/** Read binary data from element data */
export function readBinary(data: Uint8Array, offset: number, length: number): Uint8Array {
  return data.slice(offset, offset + length);
}
