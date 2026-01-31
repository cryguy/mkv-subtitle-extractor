# mkv-subtitle-extractor

Extract subtitle tracks and embedded fonts from remote MKV files over HTTP — no ffmpeg required.

Uses HTTP Range requests to download only the bytes needed (typically ~3% of the file), parses the Matroska container at the binary level, and returns each subtitle track as a `Uint8Array` ready to write to disk or process further. Works in browsers and Node.js 18+.

## Install

```bash
npm install @cryguy/mkv-subtitle-extractor
```

## Usage

```ts
import { extractSubtitles } from "mkv-subtitle-extractor";

const tracks = await extractSubtitles("https://example.com/video.mkv", {
  verbose: true,
});

for (const track of tracks) {
  console.log(track.type);                  // "srt" | "ass" | "ssa" | "vtt"
  console.log(track.metadata.language);     // "eng", "jpn", etc.
  console.log(track.metadata.trackName);    // "English", "Signs & Songs", etc.
  console.log(track.metadata.trackNumber);  // 3, 4, etc.
  console.log(track.output.subtitle);       // Uint8Array containing the subtitle file
  console.log(track.output.fonts);          // FontFile[] for ASS/SSA, null otherwise
}
```

### Writing to disk (Node.js)

```ts
import { writeFile } from "node:fs/promises";

for (const track of tracks) {
  const ext = track.type; // "srt", "ass", "ssa", or "vtt"
  await writeFile(`subtitle-${track.metadata.trackNumber}.${ext}`, track.output.subtitle);

  if (track.output.fonts) {
    for (const font of track.output.fonts) {
      await writeFile(font.name, font.data);
    }
  }
}
```

## API

### `extractSubtitles(url, options?)`

```ts
function extractSubtitles(url: string, options?: ExtractOptions): Promise<TrackResult[]>
```

Fetches an MKV file from `url`, parses the Matroska container, and returns all embedded subtitle tracks.

#### `ExtractOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `languages` | `string[]` | all | Filter by language tags (e.g. `["eng", "jpn"]`) |
| `allowFullDownload` | `boolean` | `false` | Allow full file download if the server doesn't support Range requests |
| `verbose` | `boolean` | `false` | Log progress and download stats to the console |
| `concurrency` | `number` | `1` | Max concurrent HTTP requests when fetching subtitle blocks |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation (e.g. for auth or proxies) |
| `headers` | `Record<string, string>` | — | Custom HTTP headers sent with every request |

#### `TrackResult`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `SubtitleFormat` | `"srt"`, `"ass"`, `"ssa"`, or `"vtt"` |
| `metadata.trackNumber` | `number` | Track index within the MKV file |
| `metadata.language` | `string \| undefined` | BCP 47 / ISO 639 language tag |
| `metadata.trackName` | `string \| undefined` | Track name from MKV metadata |
| `output.subtitle` | `Uint8Array` | The complete subtitle file as raw bytes |
| `output.fonts` | `FontFile[] \| null` | Embedded fonts for ASS/SSA tracks; `null` for other formats |

#### `FontFile`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Original filename (e.g. `"Arial.ttf"`) |
| `data` | `Uint8Array` | Raw font file data |

#### Errors

| Error | Thrown when |
|-------|------------|
| `RangeNotSupportedError` | Server doesn't support HTTP Range requests and `allowFullDownload` is not `true` |
| `MkvParseError` | The file has an invalid EBML/Matroska structure |

## How It Works

1. Sends an initial Range request to fetch the EBML header and Segment metadata
2. Parses the SeekHead to locate Tracks, Attachments, Cues, and Cluster positions
3. Fetches and parses the Tracks element to identify subtitle tracks and their codecs
4. Extracts embedded fonts from Attachments (if present)
5. Uses the Cues index (if available) to jump directly to subtitle blocks, or falls back to a linear cluster scan
6. Assembles complete subtitle files from the extracted blocks

Because only metadata, subtitle data, and fonts are fetched — never the video or audio streams — bandwidth usage is typically ~3% of the total file size.

## Supported Formats

- **SRT** (SubRip) — `S_TEXT/UTF8`
- **ASS/SSA** (Advanced SubStation Alpha) — `S_TEXT/ASS`, `S_TEXT/SSA`
- **WebVTT** — `S_TEXT/WEBVTT`

## Compatibility

- **Node.js** 18+ (uses `fetch` API)
- **Browsers** — any modern browser with `fetch` and `Uint8Array` support
- **Dependencies** — zero runtime dependencies

## License

MIT

---

Built by shy with Claude Opus 4.5
