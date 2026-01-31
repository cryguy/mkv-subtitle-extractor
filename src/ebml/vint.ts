/** Result of reading a VINT */
export interface VintResult {
  /** The decoded value */
  value: number;
  /** Number of bytes consumed */
  length: number;
}

/**
 * Read a VINT-encoded element ID from a buffer at the given offset.
 * Element IDs keep all bits (including the marker bit) as part of the ID value.
 */
export function readElementId(data: Uint8Array, offset: number): VintResult {
  if (offset >= data.length) {
    throw new Error('Unexpected end of data reading element ID');
  }

  const firstByte = data[offset];
  if (firstByte === 0) {
    throw new Error('Invalid VINT: leading byte is 0');
  }

  const width = vintWidth(firstByte);

  if (offset + width > data.length) {
    throw new Error('Unexpected end of data reading element ID');
  }

  // For element IDs, keep ALL bits (marker bit is part of the ID)
  let value = firstByte;
  for (let i = 1; i < width; i++) {
    value = (value * 256) + data[offset + i];
  }

  return { value, length: width };
}

/**
 * Read a VINT-encoded data size from a buffer at the given offset.
 * Data sizes mask out the marker bit.
 * Returns -1 for unknown size (all value bits are 1).
 */
export function readDataSize(data: Uint8Array, offset: number): VintResult {
  if (offset >= data.length) {
    throw new Error('Unexpected end of data reading data size');
  }

  const firstByte = data[offset];
  if (firstByte === 0) {
    throw new Error('Invalid VINT: leading byte is 0');
  }

  const width = vintWidth(firstByte);

  if (offset + width > data.length) {
    throw new Error('Unexpected end of data reading data size');
  }

  // Mask out the marker bit from the first byte
  const mask = (1 << (8 - width)) - 1;
  let value = firstByte & mask;

  // Check for unknown size (all value bits are 1)
  let allOnes = (firstByte & mask) === mask;

  for (let i = 1; i < width; i++) {
    value = (value * 256) + data[offset + i];
    if (data[offset + i] !== 0xFF) {
      allOnes = false;
    }
  }

  if (allOnes) {
    return { value: -1, length: width };
  }

  return { value, length: width };
}

/**
 * Read a block track number (same encoding as data size — marker bit is masked).
 */
export function readTrackNumber(data: Uint8Array, offset: number): VintResult {
  if (offset >= data.length) {
    throw new Error('Unexpected end of data reading track number');
  }

  const firstByte = data[offset];
  if (firstByte === 0) {
    throw new Error('Invalid VINT: leading byte is 0');
  }

  const width = vintWidth(firstByte);

  if (offset + width > data.length) {
    throw new Error('Unexpected end of data reading track number');
  }

  const mask = (1 << (8 - width)) - 1;
  let value = firstByte & mask;

  for (let i = 1; i < width; i++) {
    value = (value * 256) + data[offset + i];
  }

  return { value, length: width };
}

/** Determine the width of a VINT from its first byte */
function vintWidth(firstByte: number): number {
  if (firstByte & 0x80) return 1;
  if (firstByte & 0x40) return 2;
  if (firstByte & 0x20) return 3;
  if (firstByte & 0x10) return 4;
  if (firstByte & 0x08) return 5;
  if (firstByte & 0x04) return 6;
  if (firstByte & 0x02) return 7;
  if (firstByte & 0x01) return 8;
  return 1;
}
