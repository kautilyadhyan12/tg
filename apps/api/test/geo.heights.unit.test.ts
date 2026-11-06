// The height map under a run's elevation gain (ROADMAP 37b-ii). The first block is the job's worst
// thing: another company learning where a person ran. The only thing the server ever asks of either
// map's source is a whole degree square by its name, once; never a run, a place, a person or a
// sign-in. Then what is kept, what is refused, the lower of the two maps, and Copernicus's real bytes.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createHeightMap, heightTileHeader, mapzenTileName, type HeightMapDeps } from "../src/modules/geo/heights.adapter.js";

const COP = "https://copernicus.test";
const MZ = "https://mapzen.test";
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

// ── Files in each map's own layout ───────────────────────────────────────────────────────────────

/** A Copernicus-style file for the square whose south-west corner is (south, west): classic TIFF,
 *  3600 x 3600 32-bit floats in 1024 x 1024 blocks, DEFLATE and the floating-point predictor, "pixel
 *  is point". `height(row, col)` gives each pixel; a block where `flat(index)` gives a number is that
 *  number throughout. */
function copernicusFile(south: number, west: number, height: (row: number, col: number) => number, flat: (block: number) => number | null = () => null): Buffer {
  const W = 3600;
  const B = 1024;
  const across = Math.ceil(W / B);
  const blocks: Buffer[] = [];
  for (let k = 0; k < across * across; k++) {
    const br = Math.floor(k / across);
    const bc = k % across;
    const same = flat(k);
    const raw = Buffer.alloc(B * B * 4);
    const value = new DataView(new ArrayBuffer(4));
    for (let r = 0; r < B; r++) {
      const start = r * B * 4;
      for (let c = 0; c < B; c++) {
        const row = br * B + r;
        const col = bc * B + c;
        value.setFloat32(0, same ?? (row < W && col < W ? height(row, col) : 0), false);
        for (let p = 0; p < 4; p++) raw[start + p * B + c] = value.getUint8(p);
      }
      for (let i = start + B * 4 - 1; i > start; i--) raw[i] = ((raw[i] ?? 0) - (raw[i - 1] ?? 0)) & 0xff;
    }
    blocks.push(deflateSync(raw));
  }
  // The header: 16 entries, then the arrays, then the blocks.
  const entries: [number, number, number[]][] = [
    [256, 3, [W]],
    [257, 3, [W]],
    [258, 3, [32]],
    [259, 3, [8]],
    [277, 3, [1]],
    [317, 3, [3]],
    [322, 3, [B]],
    [323, 3, [B]],
    [324, 4, []],
    [325, 4, blocks.map((b) => b.length)],
    [339, 3, [3]],
    [33550, 12, [1 / 3600, 1 / 3600, 0]],
    [33922, 12, [0, 0, 0, west, south + 1, 0]],
    [34735, 3, [1, 1, 0, 2, 1024, 0, 1, 2, 1025, 0, 1, 2]],
  ];
  const size: Record<number, number> = { 3: 2, 4: 4, 12: 8 };
  const ifdAt = 8;
  let arraysAt = ifdAt + 2 + entries.length * 12 + 4;
  const arrayPlace = new Map<number, number>();
  for (const [tag, type] of entries) {
    const count = tag === 324 ? blocks.length : (entries.find((e) => e[0] === tag)?.[2].length ?? 0);
    if ((size[type] ?? 1) * count > 4) {
      arrayPlace.set(tag, arraysAt);
      arraysAt += (size[type] ?? 1) * count;
    }
  }
  const offsets: number[] = [];
  let at = arraysAt;
  for (const b of blocks) {
    offsets.push(at);
    at += b.length;
  }
  const head = Buffer.alloc(arraysAt);
  head.write("II", 0, "latin1");
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(ifdAt, 4);
  head.writeUInt16LE(entries.length, ifdAt);
  entries.forEach(([tag, type, given], i) => {
    const values = tag === 324 ? offsets : given;
    const e = ifdAt + 2 + i * 12;
    head.writeUInt16LE(tag, e);
    head.writeUInt16LE(type, e + 2);
    head.writeUInt32LE(values.length, e + 4);
    const place = arrayPlace.get(tag);
    const write = (buf: Buffer, p: number, v: number) => (type === 3 ? buf.writeUInt16LE(v, p) : type === 4 ? buf.writeUInt32LE(v, p) : buf.writeDoubleLE(v, p));
    if (place === undefined) values.forEach((v, k) => write(head, e + 8 + k * (size[type] ?? 1), v));
    else {
      head.writeUInt32LE(place, e + 8);
      values.forEach((v, k) => write(head, place + k * (size[type] ?? 1), v));
    }
  });
  return Buffer.concat([head, ...blocks]);
}

/** A Mapzen square, gzipped: 3601 x 3601 big-endian 16-bit metres, the north row first. */
function mapzenFile(height: (row: number, col: number) => number): Buffer {
  const S = 3601;
  const raw = Buffer.alloc(S * S * 2);
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) raw.writeInt16BE(height(r, c), (r * S + c) * 2);
  return gzipSync(raw);
}

const copName = (south: number, west: number) =>
  `Copernicus_DSM_COG_10_${south >= 0 ? "N" : "S"}${String(Math.abs(south)).padStart(2, "0")}_00_${west >= 0 ? "E" : "W"}${String(Math.abs(west)).padStart(3, "0")}_00_DEM`;
const copUrl = (south: number, west: number) => `${COP}/${copName(south, west)}/${copName(south, west)}.tif`;
const mzUrl = (south: number, west: number) => {
  const name = mapzenTileName(south + 0.5, west + 0.5);
  return `${MZ}/skadi/${name.slice(0, 3)}/${name}.hgt.gz`;
};

// Files made once: Guwahati's square and Kolkata's, each map with a height of its own.
const GUWAHATI: [number, number] = [26, 91];
const KOLKATA: [number, number] = [22, 88];
const copFlat = (value: number) => copernicusFile(0, 0, () => value, () => value);
const files = {
  copGuwahati: copernicusFile(GUWAHATI[0], GUWAHATI[1], () => 0, () => 60),
  mzGuwahati: mapzenFile(() => 55),
  copKolkata: copernicusFile(KOLKATA[0], KOLKATA[1], () => 0, () => 9),
  mzKolkata: mapzenFile(() => 7),
};
void copFlat;

interface Call {
  url: string;
  init: RequestInit | undefined;
}
/** A fetch answering from `served` (an address's bytes, or a status), writing down every call. */
function fakeFetch(served: Map<string, Buffer | number>, calls: Call[], slowMs = 0): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (slowMs > 0) await new Promise((ok) => setTimeout(ok, slowMs));
    const got = served.get(url);
    if (got === undefined || typeof got === "number") return new Response(null, { status: got ?? 404 });
    return new Response(new Uint8Array(got), { status: 200, headers: { "content-length": String(got.length) } });
  };
}

const dirs: string[] = [];
const newDir = () => {
  const d = mkdtempSync(join(tmpdir(), "heights-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mapOn = (dir: string, fetcher: typeof fetch, more: Partial<HeightMapDeps> = {}) =>
  createHeightMap({ dir, copernicus: COP, mapzen: MZ, fetch: fetcher, log: quiet, ...more });

/** A run of a kilometre or so going north-east in Guwahati: the places the server reads. */
const guwahatiRun = (from: [number, number] = [26.1445, 91.7362]): [number, number][] =>
  Array.from({ length: 100 }, (_, i) => [from[0] + i * 0.00008, from[1] + i * 0.00005]);

describe("the worst thing: nothing about a run or a person ever leaves our server", () => {
  it("only a whole degree square is asked of each map, by its name, with nothing else", async () => {
    const calls: Call[] = [];
    const served = new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), files.copGuwahati],
      [mzUrl(...GUWAHATI), files.mzGuwahati],
    ]);
    const map = mapOn(newDir(), fakeFetch(served, calls));
    const heights = await map.heightsAt(guwahatiRun(), 5000);
    expect(heights).not.toBe("waiting");
    expect(calls.map((c) => c.url).sort()).toEqual([`${COP}/Copernicus_DSM_COG_10_N26_00_E091_00_DEM/Copernicus_DSM_COG_10_N26_00_E091_00_DEM.tif`, `${MZ}/skadi/N26/N26E091.hgt.gz`]);
    for (const { url, init } of calls) {
      // The address names the square and nothing finer: no number with a decimal point, no query.
      expect(url).toMatch(/^https:\/\/(copernicus\.test\/Copernicus_DSM_COG_10_N26_00_E091_00_DEM\/Copernicus_DSM_COG_10_N26_00_E091_00_DEM\.tif|mapzen\.test\/skadi\/N26\/N26E091\.hgt\.gz)$/);
      expect(url).not.toMatch(/[?#]|\d\.\d/);
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      // No sign-in, no cookie, no header of ours at all.
      expect(init?.headers).toBeUndefined();
      expect(init?.credentials).toBeUndefined();
    }
  });

  it("each square is fetched once: two runs at once, a later run elsewhere in it, and a new server on the same disk", async () => {
    const calls: Call[] = [];
    const served = new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), files.copGuwahati],
      [mzUrl(...GUWAHATI), files.mzGuwahati],
    ]);
    const dir = newDir();
    const map = mapOn(dir, fakeFetch(served, calls, 30));
    const [a, b] = await Promise.all([map.heightsAt(guwahatiRun(), 5000), map.heightsAt(guwahatiRun([26.18, 91.75]), 5000)]);
    expect(a).not.toBe("waiting");
    expect(b).not.toBe("waiting");
    expect(calls).toHaveLength(2);
    await map.heightsAt(guwahatiRun([26.9, 91.1]), 5000);
    expect(calls).toHaveLength(2);
    const again = mapOn(dir, fakeFetch(served, calls));
    expect(await again.heightsAt(guwahatiRun(), 5000)).not.toBe("waiting");
    expect(calls).toHaveLength(2);
  });

  it("a run across two squares asks for those two and no others", async () => {
    const calls: Call[] = [];
    const served = new Map<string, Buffer | number>([
      [copUrl(26, 91), files.copGuwahati],
      [mzUrl(26, 91), files.mzGuwahati],
      [copUrl(27, 91), copernicusFile(27, 91, () => 0, () => 60)],
      [mzUrl(27, 91), files.mzGuwahati],
    ]);
    const map = mapOn(newDir(), fakeFetch(served, calls));
    const across: [number, number][] = Array.from({ length: 20 }, (_, i) => [26.999 + i * 0.0001, 91.5]);
    expect(await map.heightsAt(across, 5000)).not.toBe("waiting");
    expect(calls.map((c) => c.url).sort()).toEqual([copUrl(26, 91), copUrl(27, 91), mzUrl(26, 91), mzUrl(27, 91)].sort());
  });
});

describe("what is kept, and what is refused", () => {
  it("a square a map has no file for (the sea) is remembered as having none, and never asked again", async () => {
    const calls: Call[] = [];
    const dir = newDir();
    const sea: [number, number][] = [[30.5, -40.5]];
    const map = mapOn(dir, fakeFetch(new Map(), calls));
    expect(await map.heightsAt(sea, 5000)).toEqual([null]);
    expect(calls).toHaveLength(2);
    expect(readdirSync(dir).sort()).toEqual(["Copernicus_DSM_COG_10_N30_00_W041_00_DEM.copernicus.none", "N30W041.mapzen.none"]);
    expect(await mapOn(dir, fakeFetch(new Map(), calls)).heightsAt(sea, 5000)).toEqual([null]);
    expect(calls).toHaveLength(2);
  });

  it("a file that is not the square asked for is not kept, and the square is not fetched again for ten minutes", async () => {
    const calls: Call[] = [];
    let now = 1_000_000;
    // Kolkata's file served for Guwahati's address.
    const served = new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), files.copKolkata],
      [mzUrl(...GUWAHATI), files.mzGuwahati],
    ]);
    const dir = newDir();
    const map = mapOn(dir, fakeFetch(served, calls), { now: () => now });
    expect(await map.heightsAt(guwahatiRun(), 5000)).toBe("waiting");
    expect(readdirSync(dir).filter((f) => f.startsWith("Copernicus"))).toEqual([]);
    const fetched = calls.length;
    now += 9 * 60 * 1000;
    expect(await map.heightsAt(guwahatiRun(), 5000)).toBe("waiting");
    expect(calls.length).toBe(fetched);
    now += 2 * 60 * 1000;
    served.set(copUrl(...GUWAHATI), files.copGuwahati);
    expect(await map.heightsAt(guwahatiRun(), 5000)).not.toBe("waiting");
    expect(calls.length).toBe(fetched + 1);
  });

  it.each([
    ["bytes that are no picture at all", Buffer.from("<Error>AccessDenied</Error>")],
    ["a picture cut short", Buffer.from(files.copGuwahati.subarray(0, 4000))],
  ])("Copernicus: %s is not kept", async (_why, bytes) => {
    const served = new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), bytes],
      [mzUrl(...GUWAHATI), files.mzGuwahati],
    ]);
    const dir = newDir();
    expect(await mapOn(dir, fakeFetch(served, [])).heightsAt(guwahatiRun(), 5000)).toBe("waiting");
    expect(readdirSync(dir).filter((f) => f.startsWith("Copernicus"))).toEqual([]);
  });

  it.each([
    ["bytes that are not gzip", Buffer.from("not gzip")],
    ["a square of the wrong size", gzipSync(Buffer.alloc(1201 * 1201 * 2))],
  ])("Mapzen: %s is not kept", async (_why, bytes) => {
    const served = new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), files.copGuwahati],
      [mzUrl(...GUWAHATI), bytes],
    ]);
    const dir = newDir();
    expect(await mapOn(dir, fakeFetch(served, [])).heightsAt(guwahatiRun(), 5000)).toBe("waiting");
    expect(readdirSync(dir).filter((f) => f.endsWith(".hgt"))).toEqual([]);
  });

  it("a file said to be over 100 MB is not read", async () => {
    const big: typeof fetch = () => Promise.resolve(new Response(new Uint8Array(10), { status: 200, headers: { "content-length": String(101 * 1024 * 1024) } }));
    expect(await mapOn(newDir(), big).heightsAt(guwahatiRun(), 5000)).toBe("waiting");
  });

  it("a square still coming past the wait gives 'waiting', and is read once it lands", async () => {
    const calls: Call[] = [];
    const served = new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), files.copGuwahati],
      [mzUrl(...GUWAHATI), files.mzGuwahati],
    ]);
    const map = mapOn(newDir(), fakeFetch(served, calls, 300));
    expect(await map.heightsAt(guwahatiRun(), 20)).toBe("waiting");
    await new Promise((ok) => setTimeout(ok, 600));
    const later = await map.heightsAt(guwahatiRun(), 20);
    expect(later).not.toBe("waiting");
    expect(calls).toHaveLength(2);
  });

  it("a source that cannot be reached gives 'waiting', never a height", async () => {
    const down: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    expect(await mapOn(newDir(), down).heightsAt(guwahatiRun(), 5000)).toBe("waiting");
  });
});

describe("a place's height is the lower of the two maps (the ground is never above a roof)", () => {
  const serve = (cop: Buffer, mz: Buffer) =>
    new Map<string, Buffer | number>([
      [copUrl(...GUWAHATI), cop],
      [mzUrl(...GUWAHATI), mz],
    ]);
  const at: [number, number][] = [[26.5, 91.5]];
  it.each([
    ["a roof on Copernicus (60 m) over the ground on Mapzen (55 m)", copernicusFile(26, 91, () => 0, () => 60), mapzenFile(() => 55), 55],
    ["a false bump on Mapzen's coast (101 m) over Copernicus's open beach (0 m)", copernicusFile(26, 91, () => 0, () => 0), mapzenFile(() => 101), 0],
    ["Mapzen's no-height mark 32767: Copernicus's height", copernicusFile(26, 91, () => 0, () => 12), mapzenFile(() => 32767), 12],
    ["Mapzen's no-height mark -32768: Copernicus's height", copernicusFile(26, 91, () => 0, () => 12), mapzenFile(() => -32768), 12],
    ["Copernicus's no-data (-32767): Mapzen's height", copernicusFile(26, 91, () => 0, () => -32767), mapzenFile(() => 40), 40],
    ["a height past 9000 m on both: none", copernicusFile(26, 91, () => 0, () => 9500), mapzenFile(() => 9500), null],
  ])("%s", async (_why, cop, mz, want) => {
    const got = await mapOn(newDir(), fakeFetch(serve(cop, mz), [])).heightsAt(at, 5000);
    expect(got === "waiting" ? got : got[0]).toBe(want);
  });

  it("a square only one map has (a country Copernicus withholds) reads that map", async () => {
    const served = new Map<string, Buffer | number>([[mzUrl(...GUWAHATI), files.mzGuwahati]]);
    const got = await mapOn(newDir(), fakeFetch(served, [])).heightsAt(at, 5000);
    expect(got).toEqual([55]);
  });
});

describe("where in a square a place is read", () => {
  it("Copernicus: a pixel's middle is its own height, and between two pixels a straight line", async () => {
    // Each pixel's height is its row: 26.5° N is row 1800 of the square 26..27.
    const cop = copernicusFile(26, 91, (row) => row);
    const served = new Map<string, Buffer | number>([
      [copUrl(26, 91), cop],
      [mzUrl(26, 91), mapzenFile(() => 9000)],
    ]);
    const map = mapOn(newDir(), fakeFetch(served, []));
    const got = await map.heightsAt([[26.5, 91.2], [26.5 - 0.5 / 3600, 91.2], [27 - 1 / 3600, 91.9], [26 + 0.1 / 3600, 91.1]], 5000);
    expect(got).not.toBe("waiting");
    if (got === "waiting") return;
    expect(got[0]).toBeCloseTo(1800, 3);
    expect(got[1]).toBeCloseTo(1800.5, 3);
    expect(got[2]).toBeCloseTo(1, 3);
    // Past the last row (which stops short of the next square's first), the last row is read.
    expect(got[3]).toBeCloseTo(3599, 3);
  });

  it("Mapzen: its 3601 rows run from the north edge to the south edge, the edges shared", async () => {
    const served = new Map<string, Buffer | number>([
      [copUrl(26, 91), copernicusFile(26, 91, () => 0, () => 9000)],
      [mzUrl(26, 91), mapzenFile((row, col) => (row + col) % 30000)],
    ]);
    const map = mapOn(newDir(), fakeFetch(served, []));
    const got = await map.heightsAt([[27 - 1e-9, 91], [26, 92 - 1e-9], [26.5, 91.5], [26.5, 91.5 + 0.5 / 3600]], 5000);
    expect(got).not.toBe("waiting");
    if (got === "waiting") return;
    expect(got[0]).toBeCloseTo(0, 3);
    expect(got[1]).toBeCloseTo(3600 + 3600, 0);
    expect(got[2]).toBeCloseTo(1800 + 1800, 3);
    expect(got[3]).toBeCloseTo(3600.5, 3);
  });
});

describe("Copernicus's own bytes (a real block, fixtures/heights/NOTICE.md)", () => {
  const real = readFileSync(join(import.meta.dirname, "fixtures", "heights", "Copernicus_DSM_COG_10_N40_00_W074_00_DEM-block7.tif"));
  const name = "Copernicus_DSM_COG_10_N40_00_W074_00_DEM";

  it("its header is read as Copernicus wrote it, and refused for any other square", () => {
    const h = heightTileHeader(real, name);
    expect(h).toMatchObject({ width: 3600, height: 3600, blockWidth: 1024, blockHeight: 1024, compression: 8, predictor: 3, rasterType: 2, west: -74, north: 41 });
    expect(heightTileHeader(real, "Copernicus_DSM_COG_10_N41_00_W074_00_DEM")).toBeNull();
  });

  it("each land height lies between the US survey's lidar ground and 10 m above it (a surface map holds roofs and trees), and the sea is 0", async () => {
    const served = new Map<string, Buffer | number>([
      [`${COP}/${name}/${name}.tif`, real],
      [mzUrl(40, -74), mapzenFile(() => 9000)],
    ]);
    const map = mapOn(newDir(), fakeFetch(served, []));
    // The USGS's own 1 m lidar ground at each place (its Elevation Point Query Service, read 2026-11-06).
    const ground: [number, number, number][] = [
      [40.712, -73.146, 1.41],
      [40.682, -73.01, 1.29],
      [40.664, -73.076, 0.88],
      [40.65, -73.136, 1.06],
      [40.674, -73.034, 6.3],
    ];
    const got = await map.heightsAt([...ground.map(([lat, lng]): [number, number] => [lat, lng]), [40.5, -73.05]], 5000);
    expect(got).not.toBe("waiting");
    if (got === "waiting") return;
    ground.forEach(([, , g], i) => {
      expect(got[i]).toBeGreaterThanOrEqual(g - 1);
      expect(got[i]).toBeLessThanOrEqual(g + 10);
    });
    // As read on 2026-11-06, so a change in the reading shows.
    expect(got.slice(0, 5).map((h) => Math.round((h ?? 0) * 100) / 100)).toEqual([9.15, 8.2, 3.96, 2.51, 8.15]);
    expect(got[5]).toBe(0);
  });
});
