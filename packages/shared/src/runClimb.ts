// A run's elevation gain (ROADMAP Stage 5 item 37b-ii). The heights come from a public height map on
// our own server (apps/api/src/modules/geo/heights.adapter.ts); this file is the maths that turns them
// into metres climbed. Pure: the same line and heights always give the same number.
//
// Strava's rule for a run recorded on a phone, in its own words (support.strava.com, "Elevation on
// Strava FAQs", read 2026-11-06): "Elevation data on Strava is smoothed to remove noise. We have a
// threshold that requires climbing to occur consistently for more than 10 meters for activities
// without strong barometric data ... before it's added to the total elevation gain." Its smoothing
// "includes discarding outliers"; it fills a stretch with no heights "by interpolating".
import { z } from "zod";
import { geodesicMetres } from "./runMaths.js";

/** Heights are read this far apart along the run's line. */
export const CLIMB_STEP_M = 10;
/** A climb counts once it rises more than this from the lowest point before it, and a fall of more
 *  than this ends it (Strava's 10 m, above). */
export const CLIMB_THRESHOLD_M = 10;
/** Outliers out first: the middle height of this many in a row (90 m of line). */
const MEDIAN_SAMPLES = 9;
/** Then the mean of this many in a row (50 m of line). */
const MEAN_SAMPLES = 5;
/** A stretch that starts again within this of where the last one stopped (a pause where the person
 *  stood) is one line with it; further away (a stretch left out, as a car ride), its heights carry
 *  on from where the last stretch stopped, so the gap itself climbs nothing. */
const JOIN_M = 50;
/** Fewer of the run's heights known than this share, and the run has no number. */
const KNOWN_SHARE = 0.75;

/** The run's own distance (`geodesicMetres`), so the places read lie 10 m apart as its kilometres count. */
const metres = (a: readonly [number, number], b: readonly [number, number]): number => geodesicMetres(a[0], a[1], b[0], b[1]);

export interface ClimbSamples {
  /** Where to read a height: latitude, longitude, CLIMB_STEP_M apart along each stretch. */
  at: [number, number][];
  /** True where a stretch begins further than JOIN_M from where the one before it stopped. */
  apart: boolean[];
}

/** The places along a run's line to read heights at: every CLIMB_STEP_M of each stretch, its first
 *  and last points included. `starts` are where each stretch begins in `track` (`RunSums.trackStarts`). */
export function climbSamples(track: readonly (readonly [number, number])[], starts: readonly number[]): ClimbSamples {
  const at: [number, number][] = [];
  const apart: boolean[] = [];
  const bounds = [...new Set([0, ...starts.filter((s) => s > 0 && s < track.length)])].sort((a, b) => a - b);
  let last: readonly [number, number] | null = null;
  for (let k = 0; k < bounds.length; k++) {
    const from = bounds[k] ?? 0;
    const to = bounds[k + 1] ?? track.length;
    const first = track[from];
    if (first === undefined) continue;
    at.push([first[0], first[1]]);
    apart.push(last !== null && metres(last, first) > JOIN_M);
    let prev = first;
    let since = 0;
    for (let i = from + 1; i < to; i++) {
      const p = track[i];
      if (p === undefined) continue;
      let seg = metres(prev, p);
      let base = prev;
      // Every whole step along this piece of line, then carry what is left to the next.
      while (since + seg >= CLIMB_STEP_M) {
        const f = (CLIMB_STEP_M - since) / seg;
        const point: [number, number] = [base[0] + (p[0] - base[0]) * f, base[1] + (p[1] - base[1]) * f];
        at.push(point);
        apart.push(false);
        seg -= CLIMB_STEP_M - since;
        since = 0;
        base = point;
      }
      since += seg;
      prev = p;
    }
    const end = track[to - 1];
    if (end !== undefined && since > 0.5) {
      at.push([end[0], end[1]]);
      apart.push(false);
    }
    last = end ?? first;
  }
  return { at, apart };
}

/** Metres climbed over a line of heights: a rise counts once it is more than `threshold` above the
 *  lowest point since the last top, and then all of it counts; a fall of more than `threshold` from
 *  a top ends that climb. Smaller ups and downs count nothing. */
export function climbOver(heights: readonly number[], threshold: number = CLIMB_THRESHOLD_M): number {
  const first = heights[0];
  if (first === undefined) return 0;
  let gain = 0;
  let low = first;
  let high = first;
  let climbing = false;
  for (const h of heights) {
    if (climbing) {
      if (h > high) high = h;
      else if (high - h > threshold) {
        gain += high - low;
        climbing = false;
        low = h;
        high = h;
      }
    } else if (h < low) low = h;
    else if (h - low > threshold) {
      climbing = true;
      high = h;
    }
  }
  return climbing ? gain + high - low : gain;
}

/** The window around each height, as many on each side, narrowing at the line's two ends so a steady
 *  slope keeps its first and last heights (a climb that ends at Finish is counted whole). */
function around(values: readonly number[], size: number, i: number): number[] {
  const half = Math.min(Math.floor(size / 2), i, values.length - 1 - i);
  return values.slice(i - half, i + half + 1);
}

function middleOf(values: readonly number[], size: number): number[] {
  return values.map((_, i) => {
    const window = around(values, size, i).sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)] ?? 0;
  });
}

function meanOf(values: readonly number[], size: number): number[] {
  return values.map((_, i) => {
    const window = around(values, size, i);
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });
}

/** A run's elevation gain in whole metres from the heights read at its samples (null where the map
 *  has none), or null when too few are known to say. A gap with no heights is filled by a straight
 *  line between the heights either side of it; a stretch that starts `apart` carries on from the
 *  height the last one stopped at. */
export function climbFromHeights(heights: readonly (number | null)[], apart: readonly boolean[]): number | null {
  const known = heights.filter((h) => h !== null).length;
  if (known === 0 || known < heights.length * KNOWN_SHARE) return null;
  const filled: number[] = [];
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (h !== null && h !== undefined) {
      filled.push(h);
      continue;
    }
    let before = i - 1;
    while (before >= 0 && heights[before] === null) before--;
    let after = i + 1;
    while (after < heights.length && heights[after] === null) after++;
    const hb = before >= 0 ? heights[before] : null;
    const ha = after < heights.length ? heights[after] : null;
    if (hb !== null && hb !== undefined && ha !== null && ha !== undefined) filled.push(hb + ((ha - hb) * (i - before)) / (after - before));
    else filled.push(hb ?? ha ?? 0);
  }
  // A stretch apart from the last keeps its own ups and downs, moved to start where the last stopped.
  let shift = 0;
  const line = filled.map((h, i) => {
    if (i > 0 && apart[i] === true) shift += (filled[i - 1] ?? h) - h;
    return h + shift;
  });
  return Math.round(climbOver(meanOf(middleOf(line, MEDIAN_SAMPLES), MEAN_SAMPLES)));
}

// ── One piece of the height map, as our server keeps it ──────────────────────────────────────────
// Copernicus GLO-30 (the "Copernicus WorldDEM-30"): one file per whole degree of latitude and
// longitude, a tiled GeoTIFF of 32-bit floats, DEFLATE-packed. What its header must say before any
// height is read from it; anything else is not read at all.

/** The widths Copernicus gives a degree of longitude by latitude (its product handbook's table). */
const COPERNICUS_WIDTHS = [3600, 2400, 1800, 1200, 720, 360] as const;

export const heightTileHeaderSchema = z
  .object({
    width: z.number().int().refine((w) => COPERNICUS_WIDTHS.some((c) => c === w), "unexpected width"),
    height: z.literal(3600),
    blockWidth: z.number().int().min(16).max(4096).multipleOf(16),
    blockHeight: z.number().int().min(16).max(4096).multipleOf(16),
    bitsPerSample: z.literal(32),
    sampleFormat: z.literal(3),
    samplesPerPixel: z.literal(1),
    compression: z.literal(8),
    predictor: z.union([z.literal(1), z.literal(3)]),
    /** GeoTIFF's "pixel is point": the corner it names is the middle of the first pixel. */
    rasterType: z.literal(2),
    /** Where each block's packed bytes are in the file, and how many: one of each per block. */
    blockOffsets: z.array(z.number().int().nonnegative()).min(1).max(4096),
    blockLengths: z.array(z.number().int().positive().max(64 * 1024 * 1024)).min(1).max(4096),
    /** The west edge's longitude and the north edge's latitude, in degrees. */
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    /** Degrees a pixel spans: across, down. */
    pixelX: z.number().positive(),
    pixelY: z.number().positive(),
  })
  .superRefine((h, ctx) => {
    const across = Math.ceil(h.width / h.blockWidth) * Math.ceil(h.height / h.blockHeight);
    if (h.blockOffsets.length !== across || h.blockLengths.length !== across) ctx.addIssue({ code: "custom", message: "block count" });
    if (Math.abs(h.pixelX * h.width - 1) > 1e-6 || Math.abs(h.pixelY * h.height - 1) > 1e-6) ctx.addIssue({ code: "custom", message: "not one degree" });
  });
export type HeightTileHeader = z.infer<typeof heightTileHeaderSchema>;

/** The lowest and highest heights believed: below or above, a pixel is taken as having none. */
export const HEIGHT_LOWEST_M = -500;
export const HEIGHT_HIGHEST_M = 9000;

/** The name Copernicus gives the degree square a point is in: Copernicus_DSM_COG_10_N28_00_W081_00_DEM. */
export function heightTileName(lat: number, lng: number): string {
  const la = Math.floor(lat);
  const lo = Math.floor(lng);
  const ns = `${la >= 0 ? "N" : "S"}${String(Math.abs(la)).padStart(2, "0")}_00`;
  const ew = `${lo >= 0 ? "E" : "W"}${String(Math.abs(lo)).padStart(3, "0")}_00`;
  return `Copernicus_DSM_COG_10_${ns}_${ew}_DEM`;
}
export const HEIGHT_TILE_NAME = /^Copernicus_DSM_COG_10_[NS]\d{2}_00_[EW]\d{3}_00_DEM$/;

/** Under a run's elevation gain, the short line; Credits beside it opens HEIGHT_MAP_CREDITS. */
export const HEIGHT_MAP_SHORT_CREDIT = "Elevation: Copernicus, U.S. Geological Survey and others";

/** What each map's licence asks to be shown where heights made from it are: the Copernicus
 *  WorldDEM-30 licence's Article 6(b) and 6(c), word for word, and the Mapzen terrain tiles' own list
 *  of required attribution (github.com/tilezen/joerd, docs/attribution.md, read 2026-11-06). */
export const HEIGHT_MAP_CREDITS: readonly string[] = [
  "Elevation gain produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
  "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.",
  "ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736.",
  "Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017.",
  "Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich.",
  "Canada terrain data contains information licensed under the Open Government Licence – Canada.",
  "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers.",
  "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration.",
  "Mexico terrain data source: INEGI, Continental relief, 2016.",
  "New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved).",
  "Norway terrain data © Kartverket.",
  "United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved.",
  "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.",
];
