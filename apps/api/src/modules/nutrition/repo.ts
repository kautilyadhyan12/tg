// P2.6a — nutrition repo: the ONLY file that touches meal_logs /
// meal_log_corrections / user_dishware / body_measurements (v1 §6.2, R4.6).
// Every query is keyed by the owning userId (R3.2). api_cost_events and the
// gym_members spend-time lookup are metering/tenancy tables with no owning
// module yet — written here like prior tasks' disclosed crossings.
// Reformatted to house style at T3 (behavior unchanged; this is the file
// where the tenancy WHEREs live — it must be reviewable at a glance).
import type { Sql, TransactionSql } from "postgres";
import { mealItemSchema, type MealItem } from "@app/shared";
import { z } from "zod";
import type { BodyMeasurementInput, DishwareInput, PatchBodyMeasurement, PatchDishware } from "./schemas.js";

export interface DishwareRow {
  id: string;
  label: string;
  containerClass: string;
  volumeMl: number;
  foodHint: string | null;
  createdAt: Date;
}

export interface MeasurementRow {
  id: string;
  measuredAt: Date;
  weightKg: number | null;
  metrics: Record<string, number>;
  source: string;
  createdAt: Date;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
const toMealType = (v: string | null): MealType | null =>
  v === "breakfast" || v === "lunch" || v === "dinner" || v === "snack" ? v : null;

export interface MealRow {
  id: string;
  takenAt: Date;
  mealType: MealType | null;
  mealName: string | null;
  items: MealItem[];
  kcalPoint: number;
  kcalLow: number;
  kcalHigh: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confirmed: boolean;
  origin: "photo" | "manual";
  portionSource: string;
  nutritionSources: string[];
  calcVersion: number;
}

export interface MealWrite {
  takenAt: Date;
  /** User-chosen label (Kd ruling 2026-07-17); null = unlabeled. */
  mealType: MealType | null;
  mealName: string;
  items: MealItem[];
  origin: "photo" | "manual";
  /** Confirm-time pre-edit estimates for the ESTIMATED items only; a diff
   *  against correctedItems writes a corrections row. */
  originalItems?: MealItem[];
  /** The user's confirmed values for exactly those estimated items — NOT the
   *  whole meal. Card 5c: items the user ADDED by search were never estimated,
   *  so they are excluded here; folding them in would charge their mass to the
   *  draft's rung and corrupt the Stage-5 signal (DECISIONS 2026-07-12 T3
   *  finding 3: the stamp is "the rung that produced the corrected-away
   *  number"). Defaults to items when absent (the manual/no-extras path). */
  correctedItems?: MealItem[];
}

// Stored jsonb was written by our own parser, so failure = DB drift → 500
// (established precedent: surfaced, never silently served).
const parseItems = (value: unknown): MealItem[] => mealItemSchema.array().parse(value);

interface MealDbRow {
  id: string;
  taken_at: Date;
  meal_type: string | null;
  meal_name: string | null;
  items: unknown;
  kcal_point: number;
  kcal_low: number;
  kcal_high: number;
  protein_g: string | null;
  carbs_g: string | null;
  fat_g: string | null;
  confirmed: boolean;
  origin: string;
  portion_source: string;
  nutrition_sources: string[];
  calc_version: number;
}

const toMeal = (r: MealDbRow): MealRow => ({
  id: r.id,
  takenAt: r.taken_at,
  mealType: toMealType(r.meal_type),
  mealName: r.meal_name,
  items: parseItems(r.items),
  kcalPoint: r.kcal_point,
  kcalLow: r.kcal_low,
  kcalHigh: r.kcal_high,
  proteinG: Number(r.protein_g ?? 0),
  carbsG: Number(r.carbs_g ?? 0),
  fatG: Number(r.fat_g ?? 0),
  confirmed: r.confirmed,
  origin: r.origin === "photo" ? "photo" : "manual",
  portionSource: r.portion_source,
  nutritionSources: r.nutrition_sources,
  calcVersion: r.calc_version,
});

const totals = (items: readonly MealItem[]) => ({
  kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0),
  kcalLow: items.reduce((n, i) => n + i.kcalLow, 0),
  kcalHigh: items.reduce((n, i) => n + i.kcalHigh, 0),
  proteinG: items.reduce((n, i) => n + i.proteinG, 0).toFixed(1),
  carbsG: items.reduce((n, i) => n + i.carbsG, 0).toFixed(1),
  fatG: items.reduce((n, i) => n + i.fatG, 0).toFixed(1),
});

/** Part 4 §3.6: the row stores the WORST rung used across items. */
const worst = (items: readonly MealItem[]): string =>
  items.some((i) => i.portionSource === "default")
    ? "default"
    : items.some((i) => i.portionSource === "regional_prior")
      ? "regional_prior"
      : "user_dishware";

const sources = (items: readonly MealItem[]): string[] => [...new Set(items.map((i) => i.nutritionSource))];

// ── cost ledger (Part 4 §3.10; v1 §9.3) ─────────────────────────────────────

export async function insertCostEvent(
  sql: Sql,
  input: { userId: string; gymId: string | null; model: string; tokens: number; costMicro: bigint },
): Promise<void> {
  // cost_micro travels as text→::bigint (postgres.js doesn't parameterize
  // JS bigint by default); stays bigint in the TS domain (R6.1).
  await sql`
    INSERT INTO api_cost_events (user_id, gym_id, feature, provider, units, unit_type, cost_micro)
    VALUES (${input.userId}, ${input.gymId}, 'meal_scan', ${`groq:${input.model}`},
            ${input.tokens}, 'tokens', ${input.costMicro.toString()}::bigint)`;
}

/** Live gym at spend time (§3.10: null for direct consumers). */
export async function getLiveGymId(sql: Sql, userId: string): Promise<string | null> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT m.gym_id FROM gym_members m
    JOIN subscriptions s ON s.owner_type = 'gym' AND s.owner_id = m.gym_id
                         AND s.status IN ('trialing','active','past_due')
    WHERE m.user_id = ${userId} AND m.removed_at IS NULL
    LIMIT 1`;
  return rows[0]?.gym_id ?? null;
}

// ── meals ────────────────────────────────────────────────────────────────────

export async function createMeal(sql: Sql, userId: string, input: MealWrite): Promise<MealRow> {
  return await sql.begin(async (tx) => {
    const t = totals(input.items);
    const rows = await tx<MealDbRow[]>`
      INSERT INTO meal_logs (user_id, taken_at, meal_type, meal_name, items,
                             kcal_point, kcal_low, kcal_high,
                             protein_g, carbs_g, fat_g,
                             confirmed, origin, portion_source, nutrition_sources, calc_version)
      VALUES (${userId}, ${input.takenAt}, ${input.mealType}, ${input.mealName}, ${tx.json(input.items)},
              ${t.kcalPoint}, ${t.kcalLow}, ${t.kcalHigh},
              ${t.proteinG}, ${t.carbsG}, ${t.fatG},
              true, ${input.origin}, ${worst(input.items)}, ${sources(input.items)}, 1)
      RETURNING id, taken_at, meal_type, meal_name, items, kcal_point, kcal_low, kcal_high,
             protein_g, carbs_g, fat_g, confirmed, origin, portion_source,
             nutrition_sources, calc_version`;
    const row = rows[0];
    if (row === undefined) throw new Error("meal insert returned no row");

    // 2B Stage 5: a confirm that changed the estimate records the correction —
    // stamped with the ORIGINAL estimate's rung (T3 P2.6a finding 3: the rung
    // that produced the wrong number is the telemetry signal, not the user's
    // corrected state). Card 5c: the diff is estimate-vs-confirmed for the
    // ESTIMATED items only. An empty originalItems means nothing was estimated
    // (an all-added meal), so there is no correction and no rung to stamp —
    // worst([]) would otherwise fabricate the BEST rung ('user_dishware').
    const corrected = input.correctedItems ?? input.items;
    if (
      input.originalItems !== undefined &&
      input.originalItems.length > 0 &&
      JSON.stringify(input.originalItems) !== JSON.stringify(corrected)
    ) {
      await tx`
        INSERT INTO meal_log_corrections (meal_log_id, field, original, corrected, portion_source)
        VALUES (${row.id}, 'items', ${tx.json(input.originalItems)}, ${tx.json(corrected)},
                ${worst(input.originalItems)})`;
    }
    return toMeal(row);
  });
}

export async function getMeal(sql: Sql, userId: string, id: string): Promise<MealRow | null> {
  const rows = await sql<MealDbRow[]>`
    SELECT id, taken_at, meal_type, meal_name, items, kcal_point, kcal_low, kcal_high,
             protein_g, carbs_g, fat_g, confirmed, origin, portion_source,
             nutrition_sources, calc_version FROM meal_logs
    WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] === undefined ? null : toMeal(rows[0]);
}

export async function listMeals(
  sql: Sql,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<MealRow[]> {
  const rows = await sql<MealDbRow[]>`
    SELECT id, taken_at, meal_type, meal_name, items, kcal_point, kcal_low, kcal_high,
             protein_g, carbs_g, fat_g, confirmed, origin, portion_source,
             nutrition_sources, calc_version FROM meal_logs
    WHERE user_id = ${userId}
      AND (${cursor === null} OR (taken_at, id) < (${cursor?.at ?? null}, ${cursor?.id ?? null}))
    ORDER BY taken_at DESC, id DESC
    LIMIT ${limit + 1}`;
  return rows.map(toMeal);
}

/** PATCH: corrections rows (originals preserved — P4 doctrine) for every
 *  changed field, stamped with the ORIGINAL items' rung (T3 finding 3). */
export async function updateMeal(sql: Sql, userId: string, id: string, next: MealWrite): Promise<MealRow | null> {
  return await sql.begin(async (tx) => {
    const beforeRows = await tx<MealDbRow[]>`
      SELECT id, taken_at, meal_type, meal_name, items, kcal_point, kcal_low, kcal_high,
             protein_g, carbs_g, fat_g, confirmed, origin, portion_source,
             nutrition_sources, calc_version FROM meal_logs
      WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
    const beforeRaw = beforeRows[0];
    if (beforeRaw === undefined) return null;
    const before = toMeal(beforeRaw);
    const t = totals(next.items);
    const originalRung = worst(before.items);

    if (before.mealName !== next.mealName) {
      await tx`
        INSERT INTO meal_log_corrections (meal_log_id, field, original, corrected, portion_source)
        VALUES (${id}, 'meal_name', ${tx.json(before.mealName)}, ${tx.json(next.mealName)}, ${originalRung})`;
    }
    if (before.takenAt.toISOString() !== next.takenAt.toISOString()) {
      await tx`
        INSERT INTO meal_log_corrections (meal_log_id, field, original, corrected, portion_source)
        VALUES (${id}, 'taken_at', ${tx.json(before.takenAt.toISOString())},
                ${tx.json(next.takenAt.toISOString())}, ${originalRung})`;
    }
    if (JSON.stringify(before.items) !== JSON.stringify(next.items)) {
      await tx`
        INSERT INTO meal_log_corrections (meal_log_id, field, original, corrected, portion_source)
        VALUES (${id}, 'items', ${tx.json(before.items)}, ${tx.json(next.items)}, ${originalRung})`;
    }

    // meal_type edits get no corrections row: the label is user preference,
    // not a Stage-5 estimation-telemetry signal (2B corrections doctrine).
    const rows = await tx<MealDbRow[]>`
      UPDATE meal_logs SET
        taken_at = ${next.takenAt},
        meal_type = ${next.mealType},
        meal_name = ${next.mealName},
        items = ${tx.json(next.items)},
        kcal_point = ${t.kcalPoint}, kcal_low = ${t.kcalLow}, kcal_high = ${t.kcalHigh},
        protein_g = ${t.proteinG}, carbs_g = ${t.carbsG}, fat_g = ${t.fatG},
        portion_source = ${worst(next.items)},
        nutrition_sources = ${sources(next.items)}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, taken_at, meal_type, meal_name, items, kcal_point, kcal_low, kcal_high,
             protein_g, carbs_g, fat_g, confirmed, origin, portion_source,
             nutrition_sources, calc_version`;
    const row = rows[0];
    return row === undefined ? null : toMeal(row);
  });
}

export async function deleteMeal(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM meal_logs WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

// ── dishware (2B Stage 5 rung-1 memory) ─────────────────────────────────────

interface DishwareDbRow {
  id: string;
  label: string;
  container_class: string;
  volume_ml: number;
  food_hint: string | null;
  created_at: Date;
}

const toDishware = (r: DishwareDbRow): DishwareRow => ({
  id: r.id,
  label: r.label,
  containerClass: r.container_class,
  volumeMl: r.volume_ml,
  foodHint: r.food_hint,
  createdAt: r.created_at,
});

export async function listDishware(
  sql: Sql,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<DishwareRow[]> {
  const rows = await sql<DishwareDbRow[]>`
    SELECT id, label, container_class, volume_ml, food_hint, created_at FROM user_dishware
    WHERE user_id = ${userId}
      AND (${cursor === null} OR (created_at, id) < (${cursor?.at ?? null}, ${cursor?.id ?? null}))
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}`;
  return rows.map(toDishware);
}

/** Single dish by id, tenant-scoped (Card 5c2 dishware arm). A foreign id
 *  returns null → the caller 400s; never leaks another user's dish. */
export async function getDishware(sql: Sql, userId: string, id: string): Promise<DishwareRow | null> {
  const rows = await sql<DishwareDbRow[]>`
    SELECT id, label, container_class, volume_ml, food_hint, created_at FROM user_dishware
    WHERE id = ${id} AND user_id = ${userId}`;
  const r = rows[0];
  return r === undefined ? null : toDishware(r);
}

export async function createDishware(sql: Sql, userId: string, v: DishwareInput): Promise<DishwareRow> {
  const rows = await sql<DishwareDbRow[]>`
    INSERT INTO user_dishware (user_id, label, container_class, volume_ml, food_hint)
    VALUES (${userId}, ${v.label}, ${v.containerClass}, ${v.volumeMl}, ${v.foodHint ?? null})
    RETURNING id, label, container_class, volume_ml, food_hint, created_at`;
  const r = rows[0];
  if (r === undefined) throw new Error("dishware insert returned no row");
  return toDishware(r);
}

export async function updateDishware(
  sql: Sql,
  userId: string,
  id: string,
  v: PatchDishware,
): Promise<DishwareRow | null> {
  const rows = await sql<DishwareDbRow[]>`
    UPDATE user_dishware SET
      label = coalesce(${v.label ?? null}, label),
      container_class = coalesce(${v.containerClass ?? null}, container_class),
      volume_ml = coalesce(${v.volumeMl ?? null}, volume_ml),
      food_hint = CASE WHEN ${v.foodHint !== undefined} THEN ${v.foodHint ?? null} ELSE food_hint END
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, label, container_class, volume_ml, food_hint, created_at`;
  const r = rows[0];
  return r === undefined ? null : toDishware(r);
}

export async function deleteDishware(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM user_dishware WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

// ── body measurements (Part 4 §3.6; users.weight_kg sync — DECISIONS) ──────

const metricsSchema = z.record(z.number().finite().nonnegative());

interface MeasurementDbRow {
  id: string;
  measured_at: Date;
  weight_kg: string | null;
  metrics: unknown;
  source: string;
  created_at: Date;
}

const toMeasurement = (r: MeasurementDbRow): MeasurementRow => ({
  id: r.id,
  measuredAt: r.measured_at,
  weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
  metrics: metricsSchema.parse(r.metrics),
  source: r.source,
  createdAt: r.created_at,
});

/** users.weight_kg mirrors the latest non-null measurement (single write
 *  path for weight history — supersedes P2.2 GAP-2, DECISIONS 2026-07-12).
 *
 *  That column is NOT the measurements' alone: onboarding screen 2 and
 *  PATCH /v1/users/me write a weight the person TYPED straight into it, with no
 *  measurement behind it to fall back to. So this statement MOVES the number and
 *  never EMPTIES it, and two rules keep it honest:
 *
 *  1. COALESCE. An empty subquery means "no measurement has anything to say
 *     about this person's weight", which is not the same as "this person has no
 *     weight". Assigning it would destroy the typed answer and blank the plan
 *     and the macro rings in the same moment — the harm arrives one step after
 *     the guards below, when the LAST weighed measurement is deleted or has its
 *     weight cleared (a mis-entry, the wrong day), which is an ordinary
 *     correction and not a request to erase anything.
 *  2. THE GUARDS at each of the three call sites: called only from a write that
 *     can change which measurement is the latest weighted one. Without them a
 *     waist logged after the person typed a NEWER weight than any weigh-in would
 *     snap the column back to that older measurement.
 *
 *  Emptying the weight stays available where the person asks for it: screen 2's
 *  `weightKg: null` and PATCH /v1/users/me both write the column directly. */
async function refreshWeight(sql: TransactionSql, userId: string): Promise<void> {
  await sql`
    UPDATE users SET weight_kg = coalesce((
      SELECT weight_kg FROM body_measurements
      WHERE user_id = ${userId} AND weight_kg IS NOT NULL
      ORDER BY measured_at DESC, id DESC LIMIT 1), weight_kg)
    WHERE id = ${userId}`;
}

export async function listMeasurements(
  sql: Sql,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<MeasurementRow[]> {
  const rows = await sql<MeasurementDbRow[]>`
    SELECT id, measured_at, weight_kg, metrics, source, created_at FROM body_measurements
    WHERE user_id = ${userId}
      AND (${cursor === null} OR (measured_at, id) < (${cursor?.at ?? null}, ${cursor?.id ?? null}))
    ORDER BY measured_at DESC, id DESC
    LIMIT ${limit + 1}`;
  return rows.map(toMeasurement);
}

export async function createMeasurement(
  sql: Sql,
  userId: string,
  v: BodyMeasurementInput,
): Promise<MeasurementRow> {
  return await sql.begin(async (tx) => {
    const rows = await tx<MeasurementDbRow[]>`
      INSERT INTO body_measurements (user_id, measured_at, weight_kg, metrics, source)
      VALUES (${userId}, ${new Date(v.measuredAt)}, ${v.weightKg ?? null}, ${tx.json(v.metrics)}, ${v.source})
      RETURNING id, measured_at, weight_kg, metrics, source, created_at`;
    const r = rows[0];
    if (r === undefined) throw new Error("measurement insert returned no row");
    // Only a row that carries a weight can change which measurement is the
    // latest weighted one.
    if (r.weight_kg !== null) await refreshWeight(tx, userId);
    return toMeasurement(r);
  });
}

export async function updateMeasurement(
  sql: Sql,
  userId: string,
  id: string,
  v: PatchBodyMeasurement,
): Promise<MeasurementRow | null> {
  return await sql.begin(async (tx) => {
    const rows = await tx<MeasurementDbRow[]>`
      UPDATE body_measurements SET
        measured_at = coalesce(${v.measuredAt === undefined ? null : new Date(v.measuredAt)}, measured_at),
        weight_kg = CASE WHEN ${v.weightKg !== undefined} THEN ${v.weightKg ?? null} ELSE weight_kg END,
        metrics = coalesce(${v.metrics === undefined ? null : tx.json(v.metrics)}, metrics),
        source = coalesce(${v.source ?? null}, source)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, measured_at, weight_kg, metrics, source, created_at`;
    const r = rows[0];
    // The mirror can only move if this row carries a weight NOW (its own weight
    // may have changed, or `measured_at` may have moved it past another row's),
    // or carried one that this very write has just cleared. A weightless row
    // whose waist or source changed cannot affect it either way.
    if (r !== undefined && (r.weight_kg !== null || v.weightKg !== undefined)) {
      await refreshWeight(tx, userId);
    }
    return r === undefined ? null : toMeasurement(r);
  });
}

export async function deleteMeasurement(sql: Sql, userId: string, id: string): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; weight_kg: string | null }[]>`
      DELETE FROM body_measurements WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, weight_kg`;
    // Deleting a weightless row cannot change which measurement is the latest
    // weighted one; deleting a weighted one falls back to the one before it,
    // and to the number already on the users row when it was the last (see
    // refreshWeight: a correction is not an erasure).
    if (rows[0]?.weight_kg != null) await refreshWeight(tx, userId);
    return rows.length > 0;
  });
}
