// P2.6b — Geo & running READ/plan contracts (Part 4 §3.9; v1 §6.1, §12).
// Web is browse/plan only: route generation, saved_routes CRUD, runs read.
// Run RECORDING (write/sync) and route-name geocoding-on-save are mobile (P5).
import { z } from "zod";
import { PACE_LINE_MOST, RUN_MAX_ELAPSED_MS, RUN_MAX_PAUSES, RUN_MAX_POINTS } from "./runMaths.js";
import { RUN_SHAPE_MOST_CHARS } from "./runShape.js";
import { INDOOR_MOST_STEPS, LEARN_RUNS, STEP_FACTOR_LEAST, STEP_FACTOR_MOST } from "./indoorRun.js";
import { HEART_BPM_LEAST, HEART_BPM_MOST, heartLineSchema, heartMaxSchema, heartSamplesSchema, heartZonesSchema } from "./heartRate.js";

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
  id: z.uuid(),
  name: z.string(),
  polyline: z.string(),
  distanceM: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type SavedRoute = z.infer<typeof savedRouteSchema>;

// ── runs (read-only; record/sync = P5) ──────────────────────────────────────
// GPS polylines are the most sensitive data the app holds (Part 4 §3.9):
// own-user-only, org-invisible, never logged — polyline appears in DETAIL only.
/** A whole kilometre or mile of a run, or what is left at its end: metres and seconds. */
export const runSplitSchema = z.object({ m: z.number().int().nonnegative(), s: z.number().int().nonnegative() });

/** The pace chart (37c-iii): the speed in centimetres a second at evenly spaced places along the run
 *  (`paceLineOf`), and the hills behind it in metres at the same places (`hillLineOf`); empty where
 *  there is none. */
export const paceLineSchema = z.array(z.number().int().nonnegative().max(2000)).max(PACE_LINE_MOST);
export const hillLineSchema = z.array(z.number().int().min(-1000).max(9000)).max(PACE_LINE_MOST);

/** A day of the person's own time zone, YYYY-MM-DD. */
const runDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    // A real day of the calendar, from 1900: 2026-02-30 and 2026-13-45 are refused, never read as another day.
    const [y, m, d] = day.split("-").map(Number);
    if (y === undefined || m === undefined || d === undefined || y < 1900) return false;
    const at = new Date(Date.UTC(y, m - 1, d));
    return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
  }, "not a day of the calendar");
/** A month of the person's own time zone, YYYY-MM. */
export const runMonthSchema = z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/);

const heartBpmSchema = z.number().int().min(HEART_BPM_LEAST).max(HEART_BPM_MOST);

export const runSummarySchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  /** The moving time. */
  durationS: z.number().int().nonnegative(),
  distanceM: z.number().int().nonnegative(),
  routeName: z.string().nullable(),
  kcalPoint: z.number().int().nullable(),
  source: z.string(),
  // ROADMAP 37c-i: what Your runs shows of each.
  /** What the person called it; "Run" for one that came from the old app with no name. */
  name: z.string().min(1),
  /** The day it began, in the person's own time zone: the list's month and the calendar's day. */
  day: runDaySchema,
  /** From Start to Finish, pauses and all; the moving time for a run that kept none. */
  elapsedS: z.number().int().nonnegative(),
  /** Metres climbed (37b-ii); null where it is not known. */
  climbM: z.number().int().nonnegative().nullable(),
  /** The route made small for its picture (`runShape.ts`); null with no route. */
  shape: z.string().max(RUN_SHAPE_MOST_CHARS).nullable(),
  /** Run indoors (37q): a treadmill, or inside the house, with no route. A server from before sends none: outdoors. */
  indoor: z.boolean().default(false),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

/** A month's runs and distance, in the person's own time zone. */
export const runMonthTotalSchema = z.object({ month: runMonthSchema, runs: z.number().int().nonnegative(), distanceM: z.number().int().nonnegative() });
export type RunMonthTotal = z.infer<typeof runMonthTotalSchema>;

/** GET /v1/geo/runs: a page of the person's runs, newest first. `months`: the whole of each month
 *  the page's runs fall in, though the page holds only some of it; `total`: every run they have. */
export const runPageSchema = z.object({
  items: z.array(runSummarySchema),
  nextCursor: z.string().nullable(),
  months: z.array(runMonthTotalSchema),
  total: z.object({ runs: z.number().int().nonnegative(), distanceM: z.number().int().nonnegative() }),
});
export type RunPage = z.infer<typeof runPageSchema>;

/** The list's own query: `upTo` starts it at a day picked on the calendar, the runs of that day and
 *  before (the person's own time zone). */
export const runListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional(), upTo: runDaySchema.optional() })
  .strict();
export type RunListQuery = z.infer<typeof runListQuerySchema>;

// ── Running records (ROADMAP 37c-ii) ─────────────────────────────────────────────────────────────
/** A record the person keeps: the fastest 1 km, mile, 5 km, 10 km, and the longest run. */
export const RUN_RECORD_KINDS = ["k1", "mile", "k5", "k10", "longest"] as const;
export const runRecordKindSchema = z.enum(RUN_RECORD_KINDS);
export type RunRecordKind = z.infer<typeof runRecordKindSchema>;

/** A run's fastest 1 km, mile, 5 km and 10 km, whole seconds; null where it did not cover one, or was
 *  saved before records were kept. */
export const runBestsSchema = z.object({
  k1: z.number().int().positive().nullable(),
  mile: z.number().int().positive().nullable(),
  k5: z.number().int().positive().nullable(),
  k10: z.number().int().positive().nullable(),
});

/** One record: the run that holds it, its value (seconds, or metres for the longest run), and the
 *  person's best before that run, null when it was their first. */
export const runRecordSchema = z.object({
  runId: z.uuid(),
  name: z.string().min(1),
  startedAt: z.iso.datetime(),
  day: runDaySchema,
  value: z.number().int().positive(),
  before: z.number().int().positive().nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

/** GET /v1/geo/runs/records: each record, null while not set. */
export const runRecordsSchema = z.object({
  k1: runRecordSchema.nullable(),
  mile: runRecordSchema.nullable(),
  k5: runRecordSchema.nullable(),
  k10: runRecordSchema.nullable(),
  longest: runRecordSchema.nullable(),
});
export type RunRecords = z.infer<typeof runRecordsSchema>;

/** Where a run's distance is from (37q): the GPS, the steps the phone counted indoors, or a treadmill's own, typed
 *  after Finish. A server from before sends none: the GPS. */
export const runDistanceFromSchema = z.enum(["gps", "steps", "treadmill"]).default("gps");
export type RunDistanceFrom = z.infer<typeof runDistanceFromSchema>;
/** The steps counted on an indoor run (37q); null outdoors. */
const runStepsSchema = z.number().int().nonnegative().nullable().default(null);

/** A run's own page: everything its summary showed after Finish. */
export const runDetailSchema = runSummarySchema.extend({
  polyline: z.string().nullable(),
  distanceFrom: runDistanceFromSchema,
  steps: runStepsSchema,
  trackStarts: z.array(z.number().int().nonnegative()),
  splitsKm: z.array(runSplitSchema),
  splitsMi: z.array(runSplitSchema),
  effort: z.number().int().min(1).max(10).nullable(),
  note: z.string().nullable(),
  leftOutM: z.number().int().nonnegative(),
  leftOutS: z.number().int().nonnegative(),
  /** Its best efforts, and the records it holds now (37c-ii). */
  bests: runBestsSchema,
  records: z.array(runRecordKindSchema),
  /** The pace chart (37c-iii); empty for a run saved before it, or too short for one. */
  paceLine: paceLineSchema,
  hillLine: hillLineSchema,
  /** Heart rate from a strap or watch (37f-i): beats a minute over the time running; null for a run
   *  with none. */
  // A server from before 37f sends neither: read as none.
  heartAvg: heartBpmSchema.nullable().default(null),
  heartMax: heartBpmSchema.nullable().default(null),
  /** The heart rate chart (37f-ii-a): the heart rate at the pace line's places, 0 where the monitor had
   *  no signal; empty for a run with none, too short for a pace chart, or saved before 37f-ii-a. */
  heartLine: heartLineSchema.default([]),
  /** Its time in each of the five heart rate zones, and the maximum they were worked from; null for a
   *  run with no heart rate, no maximum when it was saved, or saved before 37f-ii-a. */
  heartZones: heartZonesSchema.nullable().default(null),
});
export type RunDetail = z.infer<typeof runDetailSchema>;
export const runDetailResponseSchema = z.object({ run: runDetailSchema });

/** GET /v1/geo/runs/days?month=YYYY-MM: the calendar's month, each day the person ran, in their own
 *  time zone; `first` is the day of their first run, so the calendar goes back no further. */
export const runDaysQuerySchema = z.object({ month: runMonthSchema }).strict();
export const runCalendarDaySchema = z.object({ day: runDaySchema, runs: z.number().int().positive(), distanceM: z.number().int().nonnegative() });
export type RunCalendarDay = z.infer<typeof runCalendarDaySchema>;
export const runDaysResponseSchema = z.object({ month: runMonthSchema, days: z.array(runCalendarDaySchema), first: runDaySchema.nullable() });
export type RunDaysResponse = z.infer<typeof runDaysResponseSchema>;

/** PATCH /v1/geo/runs/:id: what the person may change of a saved run; its numbers never. Each field
 *  left out stays as it is. */
export const changeRunRequestSchema = z
  .object({
    name: z.string().max(200).transform((t) => t.replace(/\u0000/g, "")).pipe(z.string().trim().min(1).max(60)).optional(),
    effort: z.number().int().min(1).max(10).nullable().optional(),
    note: z.string().max(3000).transform((t) => t.replace(/\u0000/g, "")).pipe(z.string().trim().max(1000)).nullable().optional(),
  })
  .strict()
  .refine((c) => c.name !== undefined || c.effort !== undefined || c.note !== undefined, { message: "nothing to change" });
export type ChangeRunRequest = z.infer<typeof changeRunRequestSchema>;

/** The server's sentences about a saved run, said where the press was made. */
export const RUN_WORDS = {
  not_found: "This run was deleted.",
  run_deleted: "This run was deleted.",
} as const;

// ── Record a run (POST /v1/geo/runs; ROADMAP 37a) ──────────────────────────────────────────────
// The phone sends the points and pauses it recorded; the server works every number out again
// from them (`runMaths.ts`), so a typed distance can never be saved. Sent twice, saved once: the
// run's id is the Idempotency-Key.
const msIntoRun = z.number().int().min(0).max(RUN_MAX_ELAPSED_MS);
const noNul = (text: string): string => text.replace(/\u0000/g, "");

/** Still stretches (37k): each one from before to, each after the one before it. */
function stillInOrder(still: readonly (readonly [number, number])[]): boolean {
  let end = -1;
  for (const [from, to] of still) {
    if (from >= to || from < end) return false;
    end = to;
  }
  return true;
}

const saveRunObject = z
  .object({
    runId: z.uuid(),
    startedAt: z.iso.datetime(),
    elapsedMs: msIntoRun,
    // A NUL is stripped, never refused: Postgres cannot keep one, and a refusal would lose the run.
    name: z.string().max(200).transform(noNul).pipe(z.string().trim().min(1).max(60)),
    /** How it felt, 1 (easy) to 10 (max effort); null when not given. */
    effort: z.number().int().min(1).max(10).nullable(),
    note: z.string().max(3000).transform(noNul).pipe(z.string().trim().max(1000)).nullable(),
    // Too many is refused before one point is read: zod would keep a fault for each bad one.
    points: z
      .custom<unknown[]>((value) => !Array.isArray(value) || value.length <= RUN_MAX_POINTS, { message: "too many points" })
      .pipe(z.array(z.tuple([msIntoRun, z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(0).max(100_000).nullable()]))),
    pauses: z
      .custom<unknown[]>((value) => !Array.isArray(value) || value.length <= RUN_MAX_PAUSES, { message: "too many pauses" })
      .pipe(z.array(z.tuple([msIntoRun, msIntoRun]))),
    /** The heart rate from the person's strap or watch (37f-i), [ms into the run, bpm]; none sent by a
     *  phone without one, or before it. */
    heart: heartSamplesSchema.optional(),
    /** The stretches the phone felt the person standing with no pause (37k), [from, to] ms into the run, in
     *  order, none overlapping; none sent by a phone with none, or before it. The server works the run out
     *  with them and keeps them nowhere. */
    still: z
      .custom<unknown[]>((value) => !Array.isArray(value) || value.length <= RUN_MAX_PAUSES, { message: "too many still stretches" })
      .pipe(z.array(z.tuple([msIntoRun, msIntoRun])).refine(stillInOrder, { message: "still stretches out of order" }))
      .optional(),
    /** An indoor run (37q), with no GPS: the phone's counts of the steps since Start, [ms into the run, steps], and the
     *  distance a treadmill showed, in metres, typed after Finish (null with none). The server works the distance out
     *  from them (`indoorSums`) and takes the treadmill's only where somebody could have run it in that time. Such a run
     *  sends no points and no still stretches: indoors the phone may lie on a treadmill while the person runs. */
    indoor: z
      .object({
        counts: z
          .custom<unknown[]>((value) => !Array.isArray(value) || value.length <= RUN_MAX_POINTS, { message: "too many step counts" })
          .pipe(z.array(z.tuple([msIntoRun, z.number().int().min(0).max(INDOOR_MOST_STEPS)]))),
        // Any whole number is read: one too large is the person's slip and is not taken, never a run refused.
        treadmillM: z.number().int().min(0).max(1_000_000_000).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
/** Each still stretch inside the run's own time. */
const stillWithin = (run: { elapsedMs: number; still?: readonly (readonly [number, number])[] | undefined }): boolean =>
  (run.still ?? []).every(([, to]) => to <= run.elapsedMs);
const stillPastEnd = { message: "a still stretch past the run's end", path: ["still"] };
/** An indoor run has no route and no still stretches (37q). */
const indoorHasNoRoute = (run: { points: readonly unknown[]; still?: readonly unknown[] | undefined; indoor?: unknown }): boolean =>
  run.indoor === undefined || (run.points.length === 0 && (run.still ?? []).length === 0);
const indoorWithRoute = { message: "an indoor run has no points and no still stretches", path: ["indoor"] };

export const saveRunRequestSchema = saveRunObject.refine(stillWithin, stillPastEnd).refine(indoorHasNoRoute, indoorWithRoute);
export type SaveRunRequest = z.infer<typeof saveRunRequestSchema>;


/** A saved run, everything its summary shows. */
export const savedRunSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
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
  /** Metres climbed (37b-ii), from the server's height map; null while it waits for the map, where the
   *  map has no heights, or for a run saved before. */
  climbM: z.number().int().nonnegative().nullable(),
  // A server from before 37f sends neither: read as none.
  heartAvg: heartBpmSchema.nullable().default(null),
  heartMax: heartBpmSchema.nullable().default(null),
  /** Its time in each heart rate zone (37f-ii-a), as the run's page shows it. */
  heartZones: heartZonesSchema.nullable().default(null),
  /** Run indoors (37q), where its distance is from, and its steps. */
  indoor: z.boolean().default(false),
  distanceFrom: runDistanceFromSchema,
  steps: runStepsSchema,
});
export type SavedRun = z.infer<typeof savedRunSchema>;

// ── What an indoor run's steps are measured with (GET /v1/geo/runs/step-length; ROADMAP 37q) ──────
// The phone shows an indoor run's distance as it goes with the same basis the server saves it with (`indoorSums`).
export const stepLengthSchema = z.object({
  /** The height measured from: the person's own, or HEIGHT_UNKNOWN_CM where they gave none. */
  heightCm: z.number().min(50).max(300),
  heightKnown: z.boolean(),
  /** How far their own steps are from their height's, learned from treadmills; 1 until one has taught it. */
  factor: z.number().min(STEP_FACTOR_LEAST).max(STEP_FACTOR_MOST),
  /** How many treadmill runs taught it. */
  learnedFrom: z.number().int().min(0).max(LEARN_RUNS),
});
export type StepLength = z.infer<typeof stepLengthSchema>;
export const stepLengthResponseSchema = z.object({ stepLength: stepLengthSchema });

// ── A run's elevation gain before it is saved (POST /v1/geo/runs/climb; ROADMAP 37b-ii) ───────────
// The run's summary asks with the same points it will save: the server works the line out with the
// same rules, reads the heights under it, and keeps nothing. Saved, the run is worked out again the
// same way, so the two numbers are one.
export const runClimbRequestSchema = saveRunObject.pick({ elapsedMs: true, points: true, pauses: true, still: true }).strict().refine(stillWithin, stillPastEnd);
export type RunClimbRequest = z.infer<typeof runClimbRequestSchema>;

export const runClimbSchema = z.discriminatedUnion("state", [
  /** `hills`: the line behind the pace chart (37c-iii), at the pace line's places. */
  z.object({ state: z.literal("done"), m: z.number().int().nonnegative(), hills: hillLineSchema }),
  /** The map has no heights under this run. */
  z.object({ state: z.literal("none") }),
  /** A piece of the map is still coming: ask again. */
  z.object({ state: z.literal("waiting") }),
]);
export type RunClimb = z.infer<typeof runClimbSchema>;
export const runClimbResponseSchema = z.object({ climb: runClimbSchema });

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

/** Today's planned run, step by step, kept with the run it guides (37d-ii,
 *  `apps/mobile/src/screens/running/runGuide.ts`). A step ends after its seconds, after its metres,
 *  or, a cool-down, once the run's whole distance is reached and it has run at least its least. */
const guideUntilSchema = z.union([
  z.object({ s: z.number().int().positive() }),
  z.object({ m: z.number().int().positive() }),
  z.object({ totalM: z.number().int().nonnegative(), leastM: z.number().int().nonnegative() }),
]);
export const GUIDE_STEP_KINDS = ["warm_walk", "run", "walk", "cool_walk", "warm", "tempo", "fast", "recover", "cool", "easy", "long"] as const;
export const keptRunGuideSchema = z.object({
  /** The session's name as the plan shows it: "Run 2 · 28½ min". */
  title: z.string().max(80),
  /** Couch to 5K: walks and runs by the clock, and no kilometre lines. */
  walkRun: z.boolean(),
  steps: z
    .array(
      z.object({
        kind: z.enum(GUIDE_STEP_KINDS),
        until: guideUntilSchema,
        /** A repeat's number and how many: [2, 6]. */
        rep: z.tuple([z.number().int().positive(), z.number().int().positive()]).nullable(),
      }),
    )
    .min(1)
    .max(200),
  /** Where the run is: the step it is on (steps.length once all are done), and the moving
   *  milliseconds and metres at which that step began. */
  at: z.object({ index: z.number().int().nonnegative(), fromMs: z.number().nonnegative(), fromM: z.number().nonnegative() }),
});
export type KeptRunGuide = z.infer<typeof keptRunGuideSchema>;
export type GuideStep = KeptRunGuide["steps"][number];
export type GuidePlace = KeptRunGuide["at"];

/** What an indoor run's steps are measured with on the phone (37q-ii-a): the person's height and their own factor, as
 *  the server last gave them (GET /v1/geo/runs/step-length), so the screen shows the distance the server saves. */
export const keptStepBasisSchema = z.object({
  heightCm: z.number().min(50).max(300),
  factor: z.number().min(STEP_FACTOR_LEAST).max(STEP_FACTOR_MOST),
});
/** An indoor run going on (37q-ii-a), kept with the run's state. */
export const keptIndoorSchema = z.object({
  /** Its step counts' files. */
  stepFiles: z.number().int().nonnegative(),
  /** The phone's own step counter as last read: it counts from when the phone was switched on, never from Start. Null
   *  before its first reading in this run. */
  raw: z.number().nonnegative().nullable(),
  /** The steps since Start. */
  steps: z.number().int().nonnegative().max(INDOOR_MOST_STEPS),
  /** No step is counted: Physical activity not allowed, or a phone with no step counter. */
  stepsOff: z.boolean(),
  /** A step was counted since Start, or since Resume was last pressed: only then may Auto-pause pause (a phone lying on
   *  a treadmill counts none, and its run is never stopped for that). */
  armed: z.boolean(),
  basis: keptStepBasisSchema,
});
export type KeptIndoor = z.infer<typeof keptIndoorSchema>;
/** An indoor run's step counts kept beside its state (37q-ii-a): [ms into the run, steps since Start]. */
export const keptRunStepsSchema = z.array(z.tuple([z.number(), z.number().int().nonnegative().max(INDOOR_MOST_STEPS)]));

/** The run going on, kept beside its points (`apps/mobile/src/screens/running/recorder.ts`). */
export const keptRunStateSchema = z.object({
  runId: z.uuid(),
  userId: z.uuid(),
  startedAt: z.number(),
  phase: z.enum(["running", "paused", "finished"]),
  pausedByPerson: z.boolean(),
  autoPause: z.boolean(),
  pauses: z.array(z.tuple([z.number(), z.number().nullable()])),
  finishedMs: z.number().nullable(),
  files: z.number().int().nonnegative(),
  /** A run started from the plan; none for one kept before 37d-ii. */
  guide: keptRunGuideSchema.nullable().default(null),
  /** Its heart rate's files (37f-i); none for one kept before. */
  heartFiles: z.number().int().nonnegative().default(0),
  /** Its motion's files (37i); none for one kept before. */
  motionFiles: z.number().int().nonnegative().default(0),
  /** The stretches the phone felt still (37k), the last one open while it lasts; none for one kept before. */
  still: z.array(z.tuple([z.number(), z.number().nullable()])).default([]),
  /** The seconds each Auto-pause was dated back over (37k); none for one kept before. */
  datedBack: z.array(z.tuple([z.number(), z.number()])).default([]),
  /** The GPS's time less the phone's, taken off each point's (37o); null until known, as for one kept before. */
  clockGapMs: z.number().nullable().default(null),
  /** An indoor run (37q-ii-a): its steps instead of points; null outdoors, as for one kept before. */
  indoor: keptIndoorSchema.nullable().default(null),
});
/** A run's heart rate kept beside its points: [ms into the run, bpm]. */
export const keptRunHeartSchema = z.array(z.tuple([z.number(), z.number().int().min(HEART_BPM_LEAST).max(HEART_BPM_MOST)]));
export const keptRunPointsSchema = z.array(z.tuple([z.number(), z.number(), z.number(), z.number().nullable()]));
/** How much the phone was shaken in each second of a run (37i), kept beside its points and never sent:
 *  [ms into the run, the standard deviation of the acceleration's size in hundredths of a m/s²]. */
export const keptRunMotionSchema = z.array(z.tuple([z.number(), z.number().int().nonnegative()]));

/** The run's choices (37a, 37a-ii, 37b-i): Auto-pause, the voice, the account's units, kept for a run
 *  the phone carries on with the app closed, and the map's colours. One missing or unreadable keeps its
 *  default. */
export const keptRunChoicesSchema = z.object({
  autoPause: z.boolean().catch(true),
  voice: z.boolean().catch(true),
  units: z.enum(["metric", "imperial"]).catch("metric"),
  /** "auto": light from sunrise to sunset where the person is, dark after (Kd, 37b-i). */
  mapColours: z.enum(["auto", "light", "dark"]).catch("auto"),
  /** The maximum heart rate the zones are worked from (37f-ii-a), as last read, and whose it is, so the voice
   *  says the zone with the app closed (37f-ii-b) and never from another person's. Null before one was read. */
  heartMax: z
    .object({ who: z.string().min(1).max(64), max: heartMaxSchema.nullable() })
    .nullable()
    .catch(null),
  /** Outdoor or Indoor (37q-ii-a), as last picked on the Running page: outdoors until picked. */
  indoor: z.boolean().catch(false),
  /** The person's step length as the server last gave it (37q-ii-a), and whose it is, for an indoor run started with no
   *  signal; null before one was read. */
  stepBasis: keptStepBasisSchema.extend({ who: z.string().min(1).max(64) }).nullable().catch(null),
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
export type PhoneLocations = z.infer<typeof phoneLocationsSchema>;

/** What the phone's motion sensor code hands over during a run (37i, `apps/mobile/modules/run-motion`): for each
 *  second finished since the last take, its end (ms since 1970, the phone's clock), the standard deviation over
 *  it of the acceleration's size in m/s², and how many readings it held. A second the sensor did not report is
 *  not handed over: not known, never still. */
export const phoneMotionSchema = z.array(z.object({ at: z.number(), sd: z.number().nonnegative(), n: z.number().int().nonnegative() })).max(10_000);
export type PhoneMotion = z.infer<typeof phoneMotionSchema>;

/** What the phone's own step counter hands over during an indoor run (37q-ii-a, `apps/mobile/modules/run-motion`): each
 *  reading since the last take, when it came (ms since 1970, the phone's clock), and the counter's total, which counts
 *  from when the phone was switched on, never from Start. */
export const phoneStepsSchema = z.array(z.object({ at: z.number(), steps: z.number().nonnegative() })).max(10_000);
export type PhoneSteps = z.infer<typeof phoneStepsSchema>;

/** What the phone's compass code hands over while a run's map is on screen (37p, `apps/mobile/modules/run-motion`),
 *  as Android reads it, the way it points worked out by the app (`compassHeading.ts`): `r` the rotation matrix
 *  (row by row, the phone's axes in east, north and up), `rotation` the screen's turn from the phone's natural way up
 *  (0 to 3, quarter turns), `declination` how far magnetic north lies east of true north at the person's place, in
 *  degrees, `accuracy` Android's own estimate of the heading's error in radians (-1 where it gives none), `status`
 *  its sensor status (3 high, 2 medium, 1 low, 0 unreliable, -1 no contact). Shown on the screen only; never kept or sent. */
export const phoneCompassSchema = z.object({
  r: z.array(z.number().min(-1.01).max(1.01)).length(9),
  rotation: z.number().int().min(0).max(3),
  declination: z.number().min(-180).max(180),
  accuracy: z.number(),
  status: z.number().int().min(-1).max(3),
});
export type PhoneCompass = z.infer<typeof phoneCompassSchema>;

/** A saved run the server refused, kept whole on the phone: the person may send it again or
 *  remove it, and nothing they ran is ever thrown away by the app (round one of 37a, H1). */
// Kept as it was sent, read only on Try again: a run refused for its size must still read back.
export const refusedRunSchema = z.object({ runId: z.string(), name: z.string(), message: z.string(), run: z.unknown().optional() });
export type RefusedRun = z.infer<typeof refusedRunSchema>;
export const runOutboxFileSchema = z.object({ version: z.literal(1), waiting: z.array(z.unknown()), refused: z.array(z.unknown()) });
