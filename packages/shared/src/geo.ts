// P2.6b — Geo & running READ/plan contracts (Part 4 §3.9; v1 §6.1, §12).
// Web is browse/plan only: route generation, saved_routes CRUD, runs read.
// Run RECORDING (write/sync) and route-name geocoding-on-save are mobile (P5).
import { z } from "zod";
import { RUN_MAX_ELAPSED_MS, RUN_MAX_PAUSES, RUN_MAX_POINTS } from "./runMaths.js";

// ── route generation (POST /v1/geo/routes/generate) ─────────────────────────
// Bounds ported verbatim from running.py:123,126 (Part 0 rule 4): targetKm
// gt=0/le=42.2/default 5.0 (NO floor exists in the salvage), count 1–5 default 3.
export const generateRoutesRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    targetKm: z.number().gt(0).max(42.2).default(5),
    count: z.number().int().min(1).max(5).default(3),
  })
  .strict();
export type GenerateRoutesRequest = z.infer<typeof generateRoutesRequestSchema>;

/** Normalized ORS candidate — the _normalize_route shape (routing_provider.py
 *  :187-200), distances kept as ORS's native integer metres. No server-side
 *  scoring/weather (deferred to @app/engine / P5, v1 §12). */
export const routeCandidateSchema = z.object({
  coords: z.array(z.tuple([z.number(), z.number()])), // [[lat, lng], ...]
  distanceM: z.number().int().nonnegative(),
  elevationGainM: z.number().int().nonnegative(),
  safeFraction: z.number().min(0).max(1), // runnable roads (footway/path/street)
  busyFraction: z.number().min(0).max(1), // vehicle roads
  greenFraction: z.number().min(0).max(1), // park/trail surface proxy
  isLoop: z.boolean(),
  source: z.literal("ors"),
});
export type RouteCandidate = z.infer<typeof routeCandidateSchema>;

export const generateRoutesResponseSchema = z.object({ routes: z.array(routeCandidateSchema) });
export type GenerateRoutesResponse = z.infer<typeof generateRoutesResponseSchema>;

// ── saved_routes CRUD (Part 4 §3.9) ─────────────────────────────────────────
// polyline is opaque text passthrough (the §7 migration contract) — the client
// encodes coords→polyline before saving; a saved route is named by the user on
// web (geocoding-on-save is mobile, v1 §12), so no name resolution here.
export const savedRouteCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    polyline: z.string().min(1).max(100_000),
    distanceM: z.number().int().nonnegative(),
  })
  .strict();
export type SavedRouteCreate = z.infer<typeof savedRouteCreateSchema>;

export const savedRouteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  polyline: z.string(),
  distanceM: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type SavedRoute = z.infer<typeof savedRouteSchema>;

// ── runs (read-only; record/sync = P5) ──────────────────────────────────────
// GPS polylines are the most sensitive data the app holds (Part 4 §3.9):
// own-user-only, org-invisible, never logged — polyline appears in DETAIL only.
export const runSummarySchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  durationS: z.number().int().nonnegative(),
  distanceM: z.number().int().nonnegative(),
  routeName: z.string().nullable(),
  kcalPoint: z.number().int().nullable(),
  source: z.string(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

/** GET /v1/geo/runs: a page of the person's runs, newest first. */
export const runPageSchema = z.object({ items: z.array(runSummarySchema), nextCursor: z.string().nullable() });
export type RunPage = z.infer<typeof runPageSchema>;

export const runDetailSchema = runSummarySchema.extend({ polyline: z.string().nullable() });
export type RunDetail = z.infer<typeof runDetailSchema>;

// ── Record a run (POST /v1/geo/runs; ROADMAP 37a) ──────────────────────────────────────────────
// The phone sends the points and pauses it recorded; the server works every number out again
// from them (`runMaths.ts`), so a typed distance can never be saved. Sent twice, saved once: the
// run's id is the Idempotency-Key.
const msIntoRun = z.number().int().min(0).max(RUN_MAX_ELAPSED_MS);
const noNul = (text: string): string => text.replace(/\u0000/g, "");

export const saveRunRequestSchema = z
  .object({
    runId: z.string().uuid(),
    startedAt: z.string().datetime(),
    elapsedMs: msIntoRun,
    // A NUL is stripped, never refused: Postgres cannot keep one, and a refusal would lose the run.
    name: z.string().max(200).transform(noNul).pipe(z.string().trim().min(1).max(60)),
    /** How it felt, 1 (easy) to 10 (max effort); null when not given. */
    effort: z.number().int().min(1).max(10).nullable(),
    note: z.string().max(3000).transform(noNul).pipe(z.string().trim().max(1000)).nullable(),
    points: z
      .array(z.tuple([msIntoRun, z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(0).max(100_000).nullable()]))
      .max(RUN_MAX_POINTS),
    pauses: z.array(z.tuple([msIntoRun, msIntoRun])).max(RUN_MAX_PAUSES),
  })
  .strict();
export type SaveRunRequest = z.infer<typeof saveRunRequestSchema>;

export const runSplitSchema = z.object({ m: z.number().int().nonnegative(), s: z.number().int().nonnegative() });

/** A saved run, everything its summary shows. */
export const savedRunSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  name: z.string(),
  effort: z.number().int().nullable(),
  note: z.string().nullable(),
  distanceM: z.number().int().nonnegative(),
  movingS: z.number().int().nonnegative(),
  elapsedS: z.number().int().nonnegative(),
  leftOutM: z.number().int().nonnegative(),
  leftOutS: z.number().int().nonnegative(),
  kcal: z.number().int().nonnegative(),
  splitsKm: z.array(runSplitSchema),
  splitsMi: z.array(runSplitSchema),
  polyline: z.string(),
  /** Where in the polyline's points each stretch begins: the line starts again there. */
  trackStarts: z.array(z.number().int().nonnegative()),
});
export type SavedRun = z.infer<typeof savedRunSchema>;

export const saveRunResponseSchema = z.object({ status: z.enum(["created", "duplicate"]), run: savedRunSchema });
export type SaveRunResponse = z.infer<typeof saveRunResponseSchema>;

// ── The map under a run (GET /v1/geo/map; ROADMAP 37b-i) ───────────────────────────────────────
// Which map the phones draw a run on, as the server says: OpenFreeMap's, or our own copy of
// Protomaps' world file the day OpenFreeMap stops (RUNBOOK/switch-the-map.md), with no new app
// version. The two name their layers differently, so the phone keeps a look for each `maker`. Only
// map squares and letters are asked of these addresses: the run itself is drawn on the phone.
const mapAddress = z.string().max(500).regex(/^(pmtiles:\/\/)?https?:\/\/[^\s"'<>\\]+$/);

export const mapSourceSchema = z.object({
  maker: z.enum(["openmaptiles", "protomaps"]),
  /** The map squares: a TileJSON address, or `pmtiles://` and the address of one world file. */
  tiles: mapAddress,
  /** The letters of the street names: an address holding {fontstack} and {range}. */
  glyphs: mapAddress.refine((at) => at.includes("{fontstack}") && at.includes("{range}"), "glyphs needs {fontstack} and {range}"),
  /** The landmarks' small pictures; null where the map has none this app draws. */
  sprite: mapAddress.nullable(),
  /** Shown in the map's corner, as OpenStreetMap's licence asks. */
  credit: z.string().trim().min(1).max(120),
});
export type MapSource = z.infer<typeof mapSourceSchema>;

export const mapSourceResponseSchema = z.object({ map: mapSourceSchema });

/** OpenFreeMap's public map (openfreemap.org: free, no limit on views, commercial use allowed): what
 *  the server sends unless it is switched, and what a phone draws before it has heard from the server. */
export const OPENFREEMAP: MapSource = {
  maker: "openmaptiles",
  tiles: "https://tiles.openfreemap.org/planet",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
  credit: "OpenFreeMap © OpenMapTiles © OpenStreetMap",
};

// ── shared list query (cursor pagination, R7.3) ─────────────────────────────
export const geoListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() })
  .strict();
export type GeoListQuery = z.infer<typeof geoListQuerySchema>;

// ── The phone's own files for a run (apps/mobile; ROADMAP 37a) ─────────────────────────────────
// Read back through these, so a file the phone cannot read is never taken for a run.

/** The run going on, kept beside its points (`apps/mobile/src/screens/running/recorder.ts`). */
export const keptRunStateSchema = z.object({
  runId: z.string().uuid(),
  userId: z.string().uuid(),
  startedAt: z.number(),
  phase: z.enum(["running", "paused", "finished"]),
  pausedByPerson: z.boolean(),
  autoPause: z.boolean(),
  pauses: z.array(z.tuple([z.number(), z.number().nullable()])),
  finishedMs: z.number().nullable(),
  files: z.number().int().nonnegative(),
});
export const keptRunPointsSchema = z.array(z.tuple([z.number(), z.number(), z.number(), z.number().nullable()]));

/** The run's choices (37a, 37a-ii, 37b-i): Auto-pause, the voice, the account's units, kept for a run
 *  the phone carries on with the app closed, and the map's colours. One missing or unreadable keeps its
 *  default. */
export const keptRunChoicesSchema = z.object({
  autoPause: z.boolean().catch(true),
  voice: z.boolean().catch(true),
  units: z.enum(["metric", "imperial"]).catch("metric"),
  /** "auto": light from sunrise to sunset where the person is, dark after (Kd, 37b-i). */
  mapColours: z.enum(["auto", "light", "dark"]).catch("auto"),
});
export type MapColours = KeptRunChoices["mapColours"];
export type KeptRunChoices = z.infer<typeof keptRunChoicesSchema>;

/** What Android hands the app with each batch of a run's points (expo-location's task data). */
export const phoneLocationsSchema = z.object({
  locations: z.array(
    z.object({
      timestamp: z.number(),
      coords: z.object({
        latitude: z.number(),
        longitude: z.number(),
        accuracy: z.number().nullable().optional(),
        speed: z.number().nullable().optional(),
      }),
    }),
  ),
});

/** A saved run the server refused, kept whole on the phone: the person may send it again or
 *  remove it, and nothing they ran is ever thrown away by the app (round one of 37a, H1). */
// Kept as it was sent, read only on Try again: a run refused for its size must still read back.
export const refusedRunSchema = z.object({ runId: z.string(), name: z.string(), message: z.string(), run: z.unknown().optional() });
export type RefusedRun = z.infer<typeof refusedRunSchema>;
export const runOutboxFileSchema = z.object({ version: z.literal(1), waiting: z.array(z.unknown()), refused: z.array(z.unknown()) });
