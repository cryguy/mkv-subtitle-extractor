/** Thrown when the server does not support HTTP Range requests */
export class RangeNotSupportedError extends Error {
  constructor(url: string) {
    super(
      `The server at "${url}" does not support HTTP Range requests. ` +
      `Range requests are required for efficient subtitle extraction. ` +
      `To download the full file instead, pass { allowFullDownload: true } in options.`
    );
    this.name = 'RangeNotSupportedError';
  }
}

/** Thrown when the MKV/EBML structure is invalid or unsupported */
export class MkvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MkvParseError';
  }
}
