// P2.7e — running stage. Transforms legacy `running_sessions` → `runs` and
// `running_routes` → `saved_routes`, inserted idempotently. Field contract
// mirrors the geo.ts schema. GAP-F: polyline is opaque text (shared/geo.ts:38,
// z.string()) — legacy [lat,lng] arrays are JSON.stringify'd, no encoder
// invented. GAP-H: missing duration/distance → 0 (NOT NULL); missing kcal/
// splits → null. running_schedules is DEFERRED (GAP-G).
import { z } from "zod";
import type { JSONValue, Sql } from "postgres";
import { uuidv5 } from "../uuid5.js";

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** splits is z.array(z.unknown()) from the boundary parse; TS can't prove
 *  JSON-ness, but every value arrived through a JSON.parse'd Mongo doc, so it
 *  IS JSONValue by construction (runtime guard: reject anything that doesn't
 *  survive a JSON round-trip — same pattern as workouts/repo.ts asJsonValue). */
function asJsonValue(v: unknown[]): JSONValue {
  JSON.stringify(v); // throws on circular/BigInt — cannot happen for parsed docs
  return v as JSONValue;
}

/** Finite non-negative number, else 0. */
function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

// ── runs ──────────────────────────────────────────────────────────────────

const legacyRunSchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    started_at: z.union([z.date(), z.string()]).nullish(),
    duration_min: z.number().nullish(),
    distance_km: z.number().nullish(),
    calories_burned: z.number().nullish(),
    path: z.array(z.unknown()).nullish(),
    splits: z.array(z.unknown()).nullish(),
  })
  .passthrough();

export interface RunRow {
  id: string;
  userId: string;
  startedAt: Date;
  durationS: number;
  distanceM: number;
  polyline: string | null;
  splits: JSONValue | null;
  kcalPoint: number | null;
  legacyMongoId: string;
}

/** Pure transform — null when `started_at` is missing/unparseable (NOT NULL). */
export function transformRun(doc: unknown): RunRow | null {
  const parsed = legacyRunSchema.safeParse(doc);
  if (!parsed.success) return null;
  const r = parsed.data;
  const startedAt = toDate(r.started_at);
  if (startedAt === null) return null;
  return {
    id: uuidv5(r._id),
    userId: uuidv5(r.user_id),
    startedAt,
    durationS: Math.round(num(r.duration_min) * 60), // GAP-H default 0
    distanceM: Math.round(num(r.distance_km) * 1000),
    polyline: r.path == null ? null : JSON.stringify(r.path), // GAP-F opaque passthrough
    splits: r.splits == null ? null : asJsonValue(r.splits),
    kcalPoint: r.calories_burned == null ? null : Math.round(r.calories_burned),
    legacyMongoId: r._id,
  };
}

/** Idempotent insert (ON CONFLICT (id) — deterministic UUIDv5 PK; runs.id has
 *  no DB default). kcal_calc_version=0 (keep-stored), source='mobile'. */
export async function insertRun(sql: Sql, r: RunRow): Promise<number> {
  const res = await sql`
    INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, polyline,
                      splits, kcal_point, kcal_calc_version, source, legacy_mongo_id)
    VALUES (${r.id}, ${r.userId}, ${r.startedAt}, ${r.durationS}, ${r.distanceM},
            ${r.polyline}, ${r.splits === null ? null : sql.json(r.splits)},
            ${r.kcalPoint}, 0, 'mobile', ${r.legacyMongoId})
    ON CONFLICT (id) DO NOTHING`;
  return res.count;
}

// ── saved routes ────────────────────────────────────────────────────────────

const legacyRouteSchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    label: z.string().nullish(),
    coords: z.array(z.unknown()).nullish(),
    distance_km: z.number().nullish(),
  })
  .passthrough();

export interface RouteRow {
  id: string;
  userId: string;
  name: string;
  polyline: string;
  distanceM: number;
  legacyMongoId: string;
}

/** Pure transform — null when `coords` is missing/empty (polyline is NOT NULL,
 *  so a route with no path is unmigratable rather than fabricated). */
export function transformRoute(doc: unknown): RouteRow | null {
  const parsed = legacyRouteSchema.safeParse(doc);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (r.coords == null || r.coords.length === 0) return null;
  const label = typeof r.label === "string" && r.label.trim() !== "" ? r.label.trim() : "Legacy route";
  return {
    id: uuidv5(r._id),
    userId: uuidv5(r.user_id),
    name: label,
    polyline: JSON.stringify(r.coords), // GAP-F opaque passthrough
    distanceM: Math.round(num(r.distance_km) * 1000),
    legacyMongoId: r._id,
  };
}

export async function insertRoute(sql: Sql, r: RouteRow): Promise<number> {
  const res = await sql`
    INSERT INTO saved_routes (id, user_id, name, polyline, distance_m, legacy_mongo_id)
    VALUES (${r.id}, ${r.userId}, ${r.name}, ${r.polyline}, ${r.distanceM}, ${r.legacyMongoId})
    ON CONFLICT (id) DO NOTHING`;
  return res.count;
}
