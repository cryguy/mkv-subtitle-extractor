# CLAUDE.md

## Project Overview

`mkv-subtitle-extractor` is a TypeScript library that extracts subtitle tracks and embedded fonts from MKV (Matroska) files streamed from a URL. It uses HTTP Range requests to download only the bytes needed (~97% bandwidth savings), and works in both browsers and Node.js 18+.

## Architecture

- **Input**: A URL pointing to an MKV file (supports HTTP/HTTPS with Range requests)
- **Output**: An array of `TrackResult` objects containing:
  - `type`: The subtitle format (`"srt"`, `"ass"`, `"ssa"`, `"vtt"`)
  - `metadata`: Track number, language tag, track name
  - `output.subtitle`: A `Uint8Array` containing the raw subtitle file data
  - `output.fonts`: Embedded font files for ASS/SSA tracks (`FontFile[]` or `null`)

### Key Design Decisions
- Uses `fetch` API (not Node.js `http`/`https`) for browser compatibility
- Uses `Uint8Array` / `DataView` (not Node.js `Buffer`) for cross-platform support
- HTTP Range requests to selectively fetch metadata, subtitle data, and fonts
- Falls back to full download only if explicitly opted in via `allowFullDownload: true`
- Cues index used for targeted block reads when available, with adaptive batch grouping
- Configurable concurrency via sliding-window worker pool (default: sequential)
- Zero native dependencies

## Build & Development

- **Language**: TypeScript (strict mode)
- **Target**: ES2020, ESM + CJS dual output
- **Build**: `npm run build` (runs `tsup`, outputs to `dist/`)
- **Bundler**: tsup (ESM + CJS + `.d.ts`)
- **Entry point**: `src/index.ts` → `dist/index.js` (ESM) + `dist/index.cjs` (CJS)
- **E2E test**: `node test_e2e/test.js <mkv-url> [concurrency]`

## Project Structure

```
src/
├── index.ts                 — Public API: extractSubtitles(url, options?)
├── types.ts                 — All public + internal type definitions
├── errors.ts                — RangeNotSupportedError, MkvParseError
├── util.ts                  — Uint8Array concat, UTF-8 encode/decode helpers
├── ebml/
│   ├── vint.ts              — VINT (variable integer) decoding
│   ├── ids.ts               — Element ID constants (SeekHead, Tracks, Cluster, etc.)
│   └── parser.ts            — EBML element header parsing, child iteration, data readers
├── io/
│   └── range-reader.ts      — HTTP Range-based seekable reader with 32KB read-ahead cache
├── mkv/
│   ├── segment.ts           — Parse EBML header, Segment, SeekHead, Info
│   ├── tracks.ts            — Parse Tracks element, filter subtitle TrackEntries
│   ├── attachments.ts       — Parse Attachments element, extract font files
│   ├── cues.ts              — Parse Cues element (index), return CueEntry[]
│   └── clusters.ts          — Linear cluster scan + Cues-targeted block reads with batch optimization
└── subtitle/
    ├── assembler.ts          — Route blocks to format-specific assembler
    ├── srt.ts               — Reconstruct SRT from blocks
    ├── ass.ts               — Reconstruct ASS/SSA from CodecPrivate + blocks
    └── vtt.ts               — Reconstruct WebVTT from CodecPrivate + blocks
```

## Conventions

- Use strict TypeScript (`strict: true` in tsconfig)
- Export types and interfaces alongside implementation
- Keep dependencies minimal — parse MKV at the binary level, no ffmpeg
- All public API surfaces should have JSDoc comments
- Use `Uint8Array` for all binary data (not `Buffer`)
- Use `fetch` API for HTTP (not Node.js-specific modules)
