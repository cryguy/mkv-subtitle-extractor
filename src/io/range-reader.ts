import { RangeNotSupportedError } from '../errors.js';

/**
 * HTTP Range-based seekable reader with read-ahead cache.
 * Falls back to full download when Range is not supported and allowFullDownload is set.
 */
export class RangeReader {
  private url: string;
  private fileSize = 0;
  private fullBuffer: Uint8Array | null = null;
  private allowFullDownload: boolean;
  private fetchFn: typeof globalThis.fetch;
  private customHeaders: Record<string, string>;
  private _bytesDownloaded = 0;
  private _requestCount = 0;

  // Read-ahead cache
  private cacheOffset = -1;
  private cacheBuffer: Uint8Array | null = null;
  private static readonly READ_AHEAD_SIZE = 32 * 1024; // 32KB

  constructor(
    url: string,
    options?: {
      allowFullDownload?: boolean;
      fetch?: typeof globalThis.fetch;
      headers?: Record<string, string>;
    }
  ) {
    this.url = url;
    this.allowFullDownload = options?.allowFullDownload ?? false;
    this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
    this.customHeaders = options?.headers ?? {};
  }

  /** Total bytes downloaded so far */
  get bytesDownloaded(): number {
    return this._bytesDownloaded;
  }

  /** Total file size in bytes */
  get size(): number {
    return this.fileSize;
  }

  /** Total number of HTTP requests made */
  get requestCount(): number {
    return this._requestCount;
  }

  /**
   * Initialize the reader: check Range support and get file size.
   * Pre-fetches a chunk to prime the cache for subsequent reads.
   * Must be called before read().
   */
  async init(): Promise<void> {
    // Fetch an initial chunk to detect Range support, get file size, and prime cache
    const probeSize = 256 * 1024; // 256KB — covers EBML header + Segment metadata
    this._requestCount++;
    const response = await this.fetchFn(this.url, {
      method: 'GET',
      headers: {
        ...this.customHeaders,
        'Range': `bytes=0-${probeSize - 1}`,
      },
    });

    if (response.status === 206) {
      // Range is supported
      const contentRange = response.headers.get('Content-Range');
      if (contentRange) {
        const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/);
        if (match) {
          this.fileSize = parseInt(match[1], 10);
        }
      }
      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);
      this._bytesDownloaded += data.length;
      // Prime cache with the initial chunk
      this.cacheOffset = 0;
      this.cacheBuffer = data;
      return;
    }

    // Range not supported
    if (!this.allowFullDownload) {
      throw new RangeNotSupportedError(this.url);
    }

    // Full download fallback
    const fullResponse = response.status === 200
      ? response
      : (this._requestCount++, await this.fetchFn(this.url, { headers: this.customHeaders }));
    const buffer = await fullResponse.arrayBuffer();
    this.fullBuffer = new Uint8Array(buffer);
    this.fileSize = this.fullBuffer.length;
    this._bytesDownloaded = this.fileSize;
  }

  /**
   * Read `length` bytes starting at `offset` from the file.
   */
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.fullBuffer) {
      return this.fullBuffer.slice(offset, offset + length);
    }

    // Check if request is within cache
    if (
      this.cacheBuffer &&
      this.cacheOffset >= 0 &&
      offset >= this.cacheOffset &&
      offset + length <= this.cacheOffset + this.cacheBuffer.length
    ) {
      const start = offset - this.cacheOffset;
      return this.cacheBuffer.slice(start, start + length);
    }

    // Fetch with read-ahead
    this._requestCount++;
    const readAheadLength = Math.max(length, RangeReader.READ_AHEAD_SIZE);
    const end = Math.min(offset + readAheadLength - 1, this.fileSize - 1);

    const response = await this.fetchFn(this.url, {
      headers: {
        ...this.customHeaders,
        'Range': `bytes=${offset}-${end}`,
      },
    });

    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`HTTP ${response.status} fetching range ${offset}-${end}`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    this._bytesDownloaded += data.length;

    // Cache the read-ahead buffer
    this.cacheOffset = offset;
    this.cacheBuffer = data;

    return data.slice(0, Math.min(length, data.length));
  }
}
