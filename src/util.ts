const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** Concatenate multiple Uint8Arrays into one */
export function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Decode a Uint8Array as UTF-8 string */
export function decodeUtf8(data: Uint8Array): string {
  return decoder.decode(data);
}

/** Encode a string as UTF-8 Uint8Array */
export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}
