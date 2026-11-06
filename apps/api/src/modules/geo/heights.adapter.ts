// The height map under a run's elevation gain (ROADMAP Stage 5 item 37b-ii), from two free public maps
// kept in HEIGHTS_DIR once fetched (RUNBOOK/height-map.md), one file each a degree square:
//
// - the Mapzen terrain tiles ("skadi"), the bare ground: the US survey's 3DEP in the United States, NASA's
//   SRTM in most other places. Its coasts hold false bumps (a Florida beach read 101 m where the USGS's
//   lidar reads 0.3 m, measured 2026-11-06);
// - Copernicus GLO-30 (the "Copernicus WorldDEM-30"), the surface: roofs and treetops included (Park Avenue
//   climbed 167 m on it where the ground climbs 21), true on open ground and beaches.
//
// The ground is never above the surface, so a place's height is the lower of the two: measured on
// 2026-11-06 over twelve cases (Manhattan, Brooklyn and Queens streets against the US survey's ground,
// real runs against their watches) it was within 2 m of the truth in every one where either map alone
// was off by up to 146 m. With only one map known at a place, that one is read.
//
// The only thing ever asked of either source is a whole degree square by its name, once: never a run,
// a point, a person or a sign-in. Only squares on Copernicus's own list of land are asked
// (`copernicusSquares.ts`): the sea is never fetched, and a place there has no height. A run in more than
// HEIGHT_MOST_SQUARES squares (no runner's) has none at all. Each map fetches one square at a time, and
// at most HEIGHT_NEW_SQUARES_AN_HOUR new ones an hour, so no request can fill the server's memory or
// disk (round one of 37b-ii, C1). A file is checked before it is kept, and unpacked no bigger than it
// says it is.
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip, inflate } from "node:zlib";
import { HEIGHT_HIGHEST_M, HEIGHT_LOWEST_M, heightTileHeaderSchema, heightTileName, type HeightTileHeader } from "@app/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../../config.js";
import { copernicusHasSquare } from "./copernicusSquares.js";

const inflateAsync = promisify(inflate);
const gunzipAsync = promisify(gunzip);

/** The heights at each place (null where neither map has one), or "waiting" when a piece of a map could
 *  not be had within `waitMs`: it keeps coming, and the run is worked out again later. */
export interface HeightMap {
  heightsAt(places: readonly (readonly [number, number])[], waitMs: number): Promise<(number | null)[] | "waiting">;
}

export interface HeightMapDeps {
  dir: string;
  /** Where Copernicus's files are: `<copernicus>/<name>/<name>.tif`. */
  copernicus: string;
  /** Where the Mapzen terrain tiles are: `<mapzen>/skadi/N28/N28W081.hgt.gz`. */
  mapzen: string;
  fetch: typeof fetch;
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  now?: () => number;
  /** For the tests: the most bytes a fetched file may have, and the new squares an hour. */
  mostBytes?: number;
  newSquaresAnHour?: number;
}

/** The biggest of the seven Copernicus files measured on 2026-11-06 was 48.6 MB, of the Mapzen ones
 *  11.1 MB packed; nothing past this is read. */
export const HEIGHT_FILE_MOST_BYTES = 100 * 1024 * 1024;
/** A fetch that failed is not tried again for this long, so a broken square cannot be fetched over and over. */
export const HEIGHT_RETRY_AFTER_MS = 10 * 60 * 1000;
/** A run is in at most this many degree squares: 12 hours of running is about 130 km, three squares in a
 *  line, six along a corner. Past it, no height is read and nothing is fetched. */
export const HEIGHT_MOST_SQUARES = 6;
/** New squares each map fetches in an hour, for every request together; past it, "waiting". */
export const HEIGHT_NEW_SQUARES_AN_HOUR = 30;
/** How long one fetch may take before it is given up. */
const FETCH_MOST_MS = 120_000;
/** Copernicus blocks kept unpacked, 4 MB each (1024 x 1024 32-bit floats). */
const BLOCKS_KEPT = 6;
/** A Mapzen square: 3601 x 3601 heights, big-endian 16-bit metres, north row first. */
const HGT_SIDE = 3601;
const HGT_BYTES = HGT_SIDE * HGT_SIDE * 2;
/** Rows of a Mapzen square read in one go, at most (1.8 MB). */
const ROWS_AT_ONCE = 256;
/** Mapzen's two marks for a place with no height. */
const HGT_NONE = new Set([-32768, 32767]);
const HOUR_MS = 3_600_000;

const why = (err: unknown): string => (err instanceof Error ? err.name : typeof err);
const believable = (h: number): number | null => (Number.isFinite(h) && h >= HEIGHT_LOWEST_M && h <= HEIGHT_HIGHEST_M ? h : null);

// ── Fetching and keeping a square, for either map ───────────────────────────────────────────────

/** One map's squares: from memory, from this server's disk, or fetched once. `T` is what reading a kept
 *  square needs; null from `keep` means the file was not one this server reads. */
interface SquareKind<T> {
  map: "copernicus" | "mapzen";
  url(name: string): string;
  /** Checks the fetched bytes and keeps them in `dir`; what reading the square then needs. */
  keep(name: string, bytes: Buffer): Promise<T | null>;
  /** The square as kept before, whole, or null. */
  kept(name: string): Promise<T | null>;
}

function squareStore<T>(deps: Omit<HeightMapDeps, "copernicus" | "mapzen">, kind: SquareKind<T>, made: () => Promise<void>) {
  const now = deps.now ?? Date.now;
  const mostBytes = deps.mostBytes ?? HEIGHT_FILE_MOST_BYTES;
  const anHour = deps.newSquaresAnHour ?? HEIGHT_NEW_SQUARES_AN_HOUR;
  const known = new Map<string, T>();
  const going = new Map<string, Promise<T | null>>();
  const failedAt = new Map<string, number>();
  /** When each fetch of the last hour began. */
  const began: number[] = [];
  /** One fetch at a time for this map: each waits for the one before it to end. */
  let line: Promise<unknown> = Promise.resolve();

  async function fetchIt(name: string): Promise<T | null> {
    await made();
    const startedAt = now();
    const notFetched = (more: Record<string, string | number>): null => {
      deps.log.error({ event: "geo.heights_fetch_failed", map: kind.map, tile: name, ...more }, "height map piece not fetched");
      return null;
    };
    let res: Response;
    try {
      res = await deps.fetch(kind.url(name), { method: "GET", redirect: "error", signal: AbortSignal.timeout(FETCH_MOST_MS) });
    } catch (err) {
      return notFetched({ errName: why(err) });
    }
    // Every square asked is on Copernicus's list of land, and Mapzen covers the whole world, so a 404 is a
    // source gone or moved, never "no heights here": a failure, tried again later (round one, H1).
    if (res.status !== 200 || Number(res.headers.get("content-length") ?? "0") > mostBytes || res.body === null) {
      await res.body?.cancel();
      return notFetched({ status: res.status });
    }
    const parts: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    try {
      for (let part = await reader.read(); !part.done; part = await reader.read()) {
        const chunk: unknown = part.value;
        if (!(chunk instanceof Uint8Array)) return notFetched({ reason: "not_bytes" });
        total += chunk.byteLength;
        if (total > mostBytes) return notFetched({ reason: "too_big" });
        parts.push(chunk);
      }
    } catch (err) {
      return notFetched({ errName: why(err) });
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const value = await kind.keep(name, Buffer.concat(parts));
    if (value === null) {
      deps.log.error({ event: "geo.heights_bad_file", map: kind.map, tile: name, bytes: total }, "height map piece is not one this server reads");
      return null;
    }
    deps.log.info({ event: "geo.heights_kept", map: kind.map, tile: name, bytes: total, durationMs: now() - startedAt }, "height map piece kept");
    return value;
  }

  /** The fetch, in this map's line; "full" when this hour's new squares are used up (not a failure). */
  function inLine(name: string): Promise<T | null | "full"> {
    const turn = line.then(async (): Promise<T | null | "full"> => {
      while (began.length > 0 && now() - (began[0] ?? 0) >= HOUR_MS) began.shift();
      if (began.length >= anHour) {
        deps.log.warn({ event: "geo.heights_hour_full", map: kind.map, tile: name }, "new height map pieces this hour used up");
        return "full";
      }
      began.push(now());
      return await fetchIt(name);
    });
    line = turn.catch(() => undefined);
    return turn;
  }

  /** The square kept, or null when it could not be had now (tried again HEIGHT_RETRY_AFTER_MS after a failure). */
  return function square(name: string): Promise<T | null> {
    const had = known.get(name);
    if (had !== undefined) return Promise.resolve(had);
    const already = going.get(name);
    if (already !== undefined) return already;
    const job = (async (): Promise<T | null> => {
      const kept = await kind.kept(name);
      if (kept !== null) return kept;
      const failed = failedAt.get(name);
      if (failed !== undefined && now() - failed < HEIGHT_RETRY_AFTER_MS) return null;
      // Only a fetch that was tried and failed starts the wait again: one skipped above, or past this
      // hour's squares, does not.
      const got = await inLine(name);
      if (got === "full") return null;
      if (got === null) failedAt.set(name, now());
      return got;
    })()
      .catch((err: unknown) => {
        deps.log.error({ event: "geo.heights_failed", map: kind.map, tile: name, errName: why(err) }, "height map piece failed");
        failedAt.set(name, now());
        return null;
      })
      .then((got) => {
        if (got !== null) {
          failedAt.delete(name);
          known.set(name, got);
        }
        going.delete(name);
        return got;
      });
    going.set(name, job);
    return job;
  };
}

/** Writes `bytes` to `file` whole before it has that name, so a half-written file is never read. */
async function keepWhole(dir: string, file: string, bytes: Buffer | string): Promise<void> {
  const part = join(dir, `${randomUUID()}.part`);
  try {
    await writeFile(part, bytes);
    await rename(part, file);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}

// ── Copernicus: a tiled GeoTIFF of 32-bit floats ────────────────────────────────────────────────

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  samplesPerPixel: 277,
  predictor: 317,
  blockWidth: 322,
  blockHeight: 323,
  blockOffsets: 324,
  blockLengths: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiePoint: 33922,
  geoKeys: 34735,
} as const;
const GT_RASTER_TYPE = 1025;
const TYPE_SIZE: Readonly<Record<number, number>> = { 3: 2, 4: 4, 12: 8 };

/** The first image's tags of a classic little-endian TIFF, as numbers; null when the bytes are not one. */
function readTags(file: Buffer): Map<number, number[]> | null {
  if (file.length < 16 || file.toString("latin1", 0, 2) !== "II" || file.readUInt16LE(2) !== 42) return null;
  const ifd = file.readUInt32LE(4);
  if (ifd + 2 > file.length) return null;
  const count = file.readUInt16LE(ifd);
  if (count > 200 || ifd + 2 + count * 12 > file.length) return null;
  const tags = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    const tag = file.readUInt16LE(entry);
    const type = file.readUInt16LE(entry + 2);
    const n = file.readUInt32LE(entry + 4);
    const size = TYPE_SIZE[type];
    if (size === undefined || n > 8192) continue;
    const at = size * n <= 4 ? entry + 8 : file.readUInt32LE(entry + 8);
    if (at + size * n > file.length) return null;
    const values: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = at + k * size;
      values.push(type === 3 ? file.readUInt16LE(p) : type === 4 ? file.readUInt32LE(p) : file.readDoubleLE(p));
    }
    tags.set(tag, values);
  }
  return tags;
}

function geoKey(keys: readonly number[], key: number): number | undefined {
  for (let i = 4; i + 3 < keys.length; i += 4) if (keys[i] === key && keys[i + 1] === 0) return keys[i + 3];
  return undefined;
}

/** A Copernicus file's header, checked, for the degree square `name`; null when it is not a height map
 *  file of that square, or any block lies outside the file. */
export function heightTileHeader(file: Buffer, name: string): HeightTileHeader | null {
  const tags = readTags(file);
  if (tags === null) return null;
  const one = (tag: number): number | undefined => tags.get(tag)?.[0];
  const parsed = heightTileHeaderSchema.safeParse({
    width: one(TAG.width),
    height: one(TAG.height),
    blockWidth: one(TAG.blockWidth),
    blockHeight: one(TAG.blockHeight),
    bitsPerSample: one(TAG.bitsPerSample),
    sampleFormat: one(TAG.sampleFormat),
    samplesPerPixel: one(TAG.samplesPerPixel) ?? 1,
    compression: one(TAG.compression),
    predictor: one(TAG.predictor) ?? 1,
    rasterType: geoKey(tags.get(TAG.geoKeys) ?? [], GT_RASTER_TYPE),
    blockOffsets: tags.get(TAG.blockOffsets),
    blockLengths: tags.get(TAG.blockLengths),
    west: tags.get(TAG.tiePoint)?.[3],
    north: tags.get(TAG.tiePoint)?.[4],
    pixelX: tags.get(TAG.pixelScale)?.[0],
    pixelY: tags.get(TAG.pixelScale)?.[1],
  });
  if (!parsed.success) return null;
  const h = parsed.data;
  // The file must be the square it was asked for: its corner is that square's north-west corner.
  if (!Number.isInteger(h.west) || !Number.isInteger(h.north) || heightTileName(h.north - 0.5, h.west + 0.5) !== name) return null;
  for (let i = 0; i < h.blockOffsets.length; i++) {
    if ((h.blockOffsets[i] ?? 0) + (h.blockLengths[i] ?? 0) > file.length) return null;
  }
  return h;
}

interface Block {
  /** The block's bytes as zlib gives them back, each row put back into little-endian 32-bit floats in
   *  place the first time it is read (before that, in byte planes, each plane differenced). */
  bytes: Buffer;
  view: DataView;
  rowReady: Uint8Array;
  width: number;
}

/** One row of a block put back into floats, undone as libtiff writes the floating-point predictor:
 *  differences byte by byte along the row, then four byte planes, the most significant first. */
function readyRow(block: Block, row: number): void {
  const w = block.width;
  const start = row * w * 4;
  const raw = block.bytes;
  for (let i = start + 1; i < start + w * 4; i++) raw[i] = ((raw[i] ?? 0) + (raw[i - 1] ?? 0)) & 0xff;
  const planes = Uint8Array.from(raw.subarray(start, start + w * 4));
  for (let k = 0; k < w; k++) {
    raw[start + k * 4 + 3] = planes[k] ?? 0;
    raw[start + k * 4 + 2] = planes[w + k] ?? 0;
    raw[start + k * 4 + 1] = planes[2 * w + k] ?? 0;
    raw[start + k * 4] = planes[3 * w + k] ?? 0;
  }
  block.rowReady[row] = 1;
}

function heightIn(block: Block, row: number, col: number): number | null {
  if (block.rowReady[row] !== 1) readyRow(block, row);
  return believable(block.view.getFloat32((row * block.width + col) * 4, true));
}

/** The four pixels around a place, (row, col) from the north-west pixel, and how far between them it
 *  lies. Both maps are "pixel is point": the corner named is the middle of the north-west pixel; past
 *  the last row or column, a place reads it. */
function around(width: number, height: number, west: number, north: number, pixelX: number, pixelY: number, lat: number, lng: number) {
  const x = Math.min(Math.max((lng - west) / pixelX, 0), width - 1);
  const y = Math.min(Math.max((north - lat) / pixelY, 0), height - 1);
  const c0 = Math.floor(x);
  const r0 = Math.floor(y);
  return { r0, c0, r1: Math.min(r0 + 1, height - 1), c1: Math.min(c0 + 1, width - 1), fx: x - c0, fy: y - r0 };
}
type Around = ReturnType<typeof around>;

const between = (p: Around, a: number | null, b: number | null, c: number | null, d: number | null): number | null =>
  a === null || b === null || c === null || d === null ? null : (a * (1 - p.fx) + b * p.fx) * (1 - p.fy) + (c * (1 - p.fx) + d * p.fx) * p.fy;

interface CopernicusSquare {
  header: HeightTileHeader;
  file: string;
}

function copernicusReader(deps: HeightMapDeps, made: () => Promise<void>) {
  const tif = (name: string): string => join(deps.dir, `${name}.tif`);
  const json = (name: string): string => join(deps.dir, `${name}.json`);
  const square = squareStore<CopernicusSquare>(
    deps,
    {
      map: "copernicus",
      url: (name) => `${deps.copernicus}/${name}/${name}.tif`,
      async keep(name, bytes) {
        const header = heightTileHeader(bytes, name);
        if (header === null) return null;
        // The .json beside the .tif is what says the square is here, so it is written last.
        await keepWhole(deps.dir, tif(name), bytes);
        await keepWhole(deps.dir, json(name), JSON.stringify(header));
        return { header, file: tif(name) };
      },
      async kept(name) {
        try {
          const header = heightTileHeaderSchema.safeParse(JSON.parse(await readFile(json(name), "utf8")));
          if (!header.success) return null;
          // The .tif whole: at least as long as its last block's end (round one of 37b-ii, L2).
          const end = Math.max(...header.data.blockOffsets.map((at, i) => at + (header.data.blockLengths[i] ?? 0)));
          return (await stat(tif(name))).size >= end ? { header: header.data, file: tif(name) } : null;
        } catch {
          return null;
        }
      },
    },
    made,
  );
  const blocks = new Map<string, Promise<Block | null>>();

  function block(name: string, s: CopernicusSquare, index: number): Promise<Block | null> {
    const key = `${name}#${String(index)}`;
    const kept = blocks.get(key);
    if (kept !== undefined) {
      blocks.delete(key);
      blocks.set(key, kept);
      return kept;
    }
    const job = (async (): Promise<Block | null> => {
      const at = s.header.blockOffsets[index];
      const len = s.header.blockLengths[index];
      if (at === undefined || len === undefined) return null;
      const packed = Buffer.alloc(len);
      const handle = await open(s.file, "r");
      try {
        const { bytesRead } = await handle.read(packed, 0, len, at);
        if (bytesRead !== len) return null;
      } finally {
        await handle.close();
      }
      const { blockWidth, blockHeight, predictor } = s.header;
      // Never unpacked past the size the header gives a block (round one of 37b-ii, H2): zlib stops there.
      const bytes = await inflateAsync(packed, { maxOutputLength: blockWidth * blockHeight * 4 });
      if (bytes.length !== blockWidth * blockHeight * 4) return null;
      // With no predictor the bytes are little-endian floats already: every row is ready.
      const rowReady = new Uint8Array(blockHeight).fill(predictor === 1 ? 1 : 0);
      return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.length), rowReady, width: blockWidth };
    })().catch((err: unknown) => {
      deps.log.error({ event: "geo.heights_block_failed", map: "copernicus", tile: name, errName: why(err) }, "height map block not read");
      blocks.delete(key);
      return null;
    });
    blocks.set(key, job);
    while (blocks.size > BLOCKS_KEPT) {
      const oldest = blocks.keys().next();
      if (oldest.done === true) break;
      blocks.delete(oldest.value);
    }
    return job;
  }

  return {
    square: (lat: number, lng: number) => square(heightTileName(lat, lng)),
    nameOf: heightTileName,
    /** The heights at places all in one kept square: every block they cross loaded first and held here,
     *  so a block the cache lets go of during a long run is still read. */
    async read(name: string, s: CopernicusSquare, places: readonly (readonly [number, number])[]): Promise<(number | null)[]> {
      const h = s.header;
      const blockOf = (row: number, col: number): number => Math.floor(row / h.blockHeight) * Math.ceil(h.width / h.blockWidth) + Math.floor(col / h.blockWidth);
      const spots = places.map(([lat, lng]) => around(h.width, h.height, h.west, h.north, h.pixelX, h.pixelY, lat, lng));
      const need = new Map<number, Promise<Block | null>>();
      for (const p of spots) {
        for (const [r, c] of [[p.r0, p.c0], [p.r0, p.c1], [p.r1, p.c0], [p.r1, p.c1]] as const) {
          const index = blockOf(r, c);
          if (!need.has(index)) need.set(index, block(name, s, index));
        }
      }
      const loaded = new Map<number, Block | null>();
      for (const [index, job] of need) loaded.set(index, await job);
      const read = (r: number, c: number): number | null => {
        const b = loaded.get(blockOf(r, c));
        return b === undefined || b === null ? null : heightIn(b, r % h.blockHeight, c % h.blockWidth);
      };
      return spots.map((p) => between(p, read(p.r0, p.c0), read(p.r0, p.c1), read(p.r1, p.c0), read(p.r1, p.c1)));
    },
  };
}

// ── Mapzen: SRTM's own layout, 3601 x 3601 big-endian 16-bit metres ──────────────────────────────

/** The Mapzen name of the degree square a point is in: N28W081. */
export function mapzenTileName(lat: number, lng: number): string {
  const la = Math.floor(lat);
  const lo = Math.floor(lng);
  return `${la >= 0 ? "N" : "S"}${String(Math.abs(la)).padStart(2, "0")}${lo >= 0 ? "E" : "W"}${String(Math.abs(lo)).padStart(3, "0")}`;
}

function mapzenReader(deps: HeightMapDeps, made: () => Promise<void>) {
  const hgt = (name: string): string => join(deps.dir, `${name}.hgt`);
  const square = squareStore<string>(
    deps,
    {
      map: "mapzen",
      url: (name) => `${deps.mapzen}/skadi/${name.slice(0, 3)}/${name}.hgt.gz`,
      async keep(name, bytes) {
        let unpacked: Buffer;
        try {
          // Never unpacked past one square and a byte: zlib stops there (round one of 37b-ii).
          unpacked = await gunzipAsync(bytes, { maxOutputLength: HGT_BYTES + 1 });
        } catch (err) {
          deps.log.error({ event: "geo.heights_bad_file", map: "mapzen", tile: name, errName: why(err) }, "height map piece does not unpack");
          return null;
        }
        if (unpacked.length !== HGT_BYTES) return null;
        await keepWhole(deps.dir, hgt(name), unpacked);
        return hgt(name);
      },
      async kept(name) {
        try {
          return (await stat(hgt(name))).size === HGT_BYTES ? hgt(name) : null;
        } catch {
          return null;
        }
      },
    },
    made,
  );
  return {
    square: (lat: number, lng: number) => square(mapzenTileName(lat, lng)),
    nameOf: mapzenTileName,
    /** The heights at places all in one kept square, reading only the rows they cross. */
    async read(name: string, file: string, places: readonly (readonly [number, number])[]): Promise<(number | null)[]> {
      const south = Number(name.slice(1, 3)) * (name.startsWith("S") ? -1 : 1);
      const west = Number(name.slice(4, 7)) * (name[3] === "W" ? -1 : 1);
      const step = 1 / (HGT_SIDE - 1);
      const spots = places.map(([lat, lng]) => around(HGT_SIDE, HGT_SIDE, west, south + 1, step, step, lat, lng));
      // The rows the places cross, read in runs of whole rows: a run's rows lie mostly side by side.
      const wanted = [...new Set(spots.flatMap((p) => [p.r0, p.r1]))].sort((a, b) => a - b);
      const rows = new Map<number, Buffer>();
      const handle = await open(file, "r");
      try {
        for (let i = 0; i < wanted.length; ) {
          const first = wanted[i] ?? 0;
          let last = first;
          while (i + 1 < wanted.length && (wanted[i + 1] ?? 0) - last <= 8 && (wanted[i + 1] ?? 0) - first < ROWS_AT_ONCE) last = wanted[++i] ?? last;
          i++;
          const span = Buffer.alloc((last - first + 1) * HGT_SIDE * 2);
          const { bytesRead } = await handle.read(span, 0, span.length, first * HGT_SIDE * 2);
          if (bytesRead !== span.length) continue;
          for (let r = first; r <= last; r++) rows.set(r, span.subarray((r - first) * HGT_SIDE * 2, (r - first + 1) * HGT_SIDE * 2));
        }
      } finally {
        await handle.close();
      }
      const read = (r: number, c: number): number | null => {
        const row = rows.get(r);
        if (row === undefined) return null;
        const v = row.readInt16BE(c * 2);
        return HGT_NONE.has(v) ? null : believable(v);
      };
      return spots.map((p) => between(p, read(p.r0, p.c0), read(p.r0, p.c1), read(p.r1, p.c0), read(p.r1, p.c1)));
    },
  };
}

// ── Both maps together ─────────────────────────────────────────────────────────────────────────

/** The height map kept in `deps.dir`, filling itself one degree square at a time from both sources. */
export function createHeightMap(deps: HeightMapDeps): HeightMap {
  let making: Promise<void> | null = null;
  const made = (): Promise<void> => (making ??= mkdir(deps.dir, { recursive: true }).then(() => undefined));
  const copernicus = copernicusReader(deps, made);
  const mapzen = mapzenReader(deps, made);

  /** Each place's height from one map, or "waiting" when a square of it could not be had in time. */
  async function fromMap<T>(
    reader: {
      square(lat: number, lng: number): Promise<T | null>;
      nameOf(lat: number, lng: number): string;
      read(name: string, value: T, places: readonly (readonly [number, number])[]): Promise<(number | null)[]>;
    },
    places: readonly (readonly [number, number])[],
    late: Promise<"late">,
  ): Promise<(number | null)[] | "waiting"> {
    const groups = new Map<string, number[]>();
    places.forEach(([lat, lng], i) => {
      const name = reader.nameOf(lat, lng);
      const group = groups.get(name);
      if (group === undefined) groups.set(name, [i]);
      else group.push(i);
    });
    const names = [...groups.keys()];
    const firsts = names.map((name) => groups.get(name)?.[0] ?? 0);
    const got = await Promise.race([Promise.all(firsts.map((i) => reader.square(places[i]?.[0] ?? 0, places[i]?.[1] ?? 0))), late]);
    if (got === "late" || got.some((g) => g === null)) return "waiting";
    const out: (number | null)[] = places.map(() => null);
    for (let k = 0; k < names.length; k++) {
      const g = got[k];
      const name = names[k];
      const at = name === undefined ? undefined : groups.get(name);
      if (g === undefined || g === null || name === undefined || at === undefined) continue;
      const heights = await reader.read(name, g, at.map((i) => places[i] ?? [0, 0]));
      at.forEach((i, j) => {
        out[i] = heights[j] ?? null;
      });
    }
    return out;
  }

  return {
    async heightsAt(places, waitMs) {
      // A run in more squares than any runner's: nothing is read and nothing fetched (round one, C1).
      const squares = new Set(places.map(([lat, lng]) => `${String(Math.floor(lat))},${String(Math.floor(lng))}`));
      if (squares.size > HEIGHT_MOST_SQUARES) {
        deps.log.warn({ event: "geo.heights_too_many_squares", squares: squares.size }, "a run in too many squares");
        return places.map(() => null);
      }
      // Only places on Copernicus's list of land are read: the sea, and the squares it withholds, have none.
      const onLand = places.flatMap(([lat, lng], i) => (copernicusHasSquare(lat, lng) ? [i] : []));
      const landPlaces = onLand.map((i): readonly [number, number] => places[i] ?? [0, 0]);
      const out: (number | null)[] = places.map(() => null);
      if (landPlaces.length === 0) return out;
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => {
          resolve("late");
        }, waitMs);
      });
      try {
        const [surface, ground] = await Promise.all([fromMap(copernicus, landPlaces, late), fromMap(mapzen, landPlaces, late)]);
        if (surface === "waiting" || ground === "waiting") return "waiting";
        onLand.forEach((at, j) => {
          const s = surface[j] ?? null;
          const g = ground[j] ?? null;
          // Copernicus reads its sea as exactly 0, where Mapzen holds the sea floor: never below it (L1).
          out[at] = s === null ? g : g === null ? s : s === 0 ? Math.max(0, Math.min(s, g)) : Math.min(s, g);
        });
        return out;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Under the tests no square is ever fetched: a test that wants heights gives the app a map of its own. */
const fetchNothing: typeof fetch = () => Promise.reject(new Error("the tests fetch no height map"));

/** The height map in HEIGHTS_DIR (a folder under the system's temporary one when unset, outside
 *  production), filled from the two sources the config names: the api and the worker make the same. */
export function heightMapFor(
  config: Pick<AppConfig, "NODE_ENV" | "HEIGHTS_DIR" | "HEIGHTS_COPERNICUS" | "HEIGHTS_MAPZEN">,
  log: HeightMapDeps["log"],
): HeightMap {
  return createHeightMap({
    dir: config.HEIGHTS_DIR ?? join(tmpdir(), config.NODE_ENV === "test" ? "aihg-heights-test" : "aihg-heights"),
    copernicus: config.HEIGHTS_COPERNICUS,
    mapzen: config.HEIGHTS_MAPZEN,
    fetch: config.NODE_ENV === "test" ? fetchNothing : fetch,
    log,
  });
}
