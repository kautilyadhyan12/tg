// P2.6b — Geo & running READ/plan contracts (Part 4 §3.9; v1 §6.1, §12).
// Web is browse/plan only: route generation, saved_routes CRUD, runs read.
// Run RECORDING (write/sync) and route-name geocoding-on-save are mobile (P5).
import { z } from "zod";

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

export const runDetailSchema = runSummarySchema.extend({ polyline: z.string().nullable() });
export type RunDetail = z.infer<typeof runDetailSchema>;

// ── shared list query (cursor pagination, R7.3) ─────────────────────────────
export const geoListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() })
  .strict();
export type GeoListQuery = z.infer<typeof geoListQuerySchema>;
