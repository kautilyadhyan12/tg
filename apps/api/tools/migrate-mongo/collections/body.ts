// P2.7d — body_measurements stage. Transforms a legacy `body_measurements` doc
// into a `body_measurements` row (weight + a `metrics` jsonb of the *_cm /
// body_fat_pct fields), inserts it idempotently, and gives the legacy PROFILE
// weight its typed row when nothing imported carries a weight (GAP-D: the
// history is the ONE source of weight, RULINGS 2026-09-10; there is no
// users column). All values are the legacy numbers — none fabricated.
import { z } from "zod";
import type { Sql } from "postgres";
import { uuidv5 } from "../uuid5.js";

// The circumference/composition fields that fold into `metrics` (read-side
// guard is z.record(z.number().finite().nonnegative()) — only finite nonneg).
const METRIC_KEYS = [
  "waist_cm",
  "chest_cm",
  "hips_cm",
  "left_arm_cm",
  "right_arm_cm",
  "left_thigh_cm",
  "right_thigh_cm",
  "body_fat_pct",
] as const;

const legacyBodySchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    measured_at: z.union([z.date(), z.string()]).nullish(),
    weight_kg: z.number().nullish(),
    waist_cm: z.number().nullish(),
    chest_cm: z.number().nullish(),
    hips_cm: z.number().nullish(),
    left_arm_cm: z.number().nullish(),
    right_arm_cm: z.number().nullish(),
    left_thigh_cm: z.number().nullish(),
    right_thigh_cm: z.number().nullish(),
    body_fat_pct: z.number().nullish(),
  })
  .passthrough();

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** kg in (0, 999.99] rounded to 2dp, else null (numeric(5,2) overflow guard —
 *  same discipline as weight.ts). Legacy weight_kg is already kilograms. */
function toWeightKg(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 999.99) return null;
  return Math.round(v * 100) / 100;
}

export interface BodyRow {
  id: string;
  userId: string;
  measuredAt: Date;
  weightKg: number | null;
  metrics: Record<string, number>;
  legacyMongoId: string;
}

/** Pure transform — null when `measured_at` is missing/unparseable (NOT NULL). */
export function transformBody(doc: unknown): BodyRow | null {
  const parsed = legacyBodySchema.safeParse(doc);
  if (!parsed.success) return null;
  const b = parsed.data;

  const measuredAt = toDate(b.measured_at);
  if (measuredAt === null) return null;

  const metrics: Record<string, number> = {};
  for (const k of METRIC_KEYS) {
    const v = b[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) metrics[k] = v;
  }

  return {
    id: uuidv5(b._id),
    userId: uuidv5(b.user_id),
    measuredAt,
    weightKg: toWeightKg(b.weight_kg),
    metrics,
    legacyMongoId: b._id,
  };
}

/** Idempotent insert (ON CONFLICT (id) — deterministic UUIDv5 PK). */
export async function insertBody(sql: Sql, r: BodyRow): Promise<number> {
  const res = await sql`
    INSERT INTO body_measurements (id, user_id, measured_at, weight_kg, metrics,
                                   source, legacy_mongo_id)
    VALUES (${r.id}, ${r.userId}, ${r.measuredAt}, ${r.weightKg}, ${sql.json(r.metrics)},
            'manual', ${r.legacyMongoId})
    ON CONFLICT (id) DO NOTHING`;
  return res.count;
}

/** GAP-D, under the one-source rule (RULINGS 2026-09-10). The legacy profile
 *  held a weight with no measurement behind it and no date. It becomes a
 *  `self_reported` row ONLY for a person none of whose imported measurements
 *  carries a weight: the history wins wherever it says anything, because an
 *  undated profile number must never outrank a dated weigh-in (an earlier
 *  version let it, whenever the two numbers differed). Runs AFTER the body
 *  stage's inserts, so "nothing carries a weight" is judged on the imported
 *  history. Idempotent: the second run finds the typed row and inserts nothing. */
export async function recordLegacyProfileWeight(sql: Sql, userId: string, weightKg: number | null): Promise<number> {
  if (weightKg === null) return 0;
  const res = await sql`
    INSERT INTO body_measurements (user_id, measured_at, weight_kg, metrics, source)
    SELECT ${userId}, now(), ${weightKg}, '{}'::jsonb, 'self_reported'
    WHERE NOT EXISTS (
      SELECT 1 FROM body_measurements
      WHERE user_id = ${userId} AND (weight_kg IS NOT NULL OR source = 'self_reported'))`;
  return res.count;
}

/** The body stage's last step, for every user the users stage imported: the
 *  legacy profile weight of each (null for most) through the rule above.
 *  Returns how many typed rows were written. */
export async function recordLegacyProfileWeights(
  sql: Sql,
  legacyWeights: ReadonlyMap<string, number | null>,
): Promise<number> {
  let written = 0;
  for (const [userId, weightKg] of legacyWeights) written += await recordLegacyProfileWeight(sql, userId, weightKg);
  return written;
}
