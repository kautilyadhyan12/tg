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
import { dayInTz } from "../gamification/streak.js";
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

// ── body measurements (Part 4 §3.6; users.weight_kg — RULINGS 2026-09-10) ──

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

/** The `source` of a measurement the person typed on a form (onboarding
 *  screen 2, PATCH /v1/users/me) rather than logged as a weigh-in. It shows in
 *  their history marked "typed by me". A row with this source and NO weight is
 *  the record of the person clearing their weight on purpose. */
export const TYPED_WEIGHT_SOURCE = "self_reported";

/** THE ONE RULE (Kd ruling 2026-09-10; supersedes P2.2 GAP-2): the history is
 *  the only source of body weight, and `users.weight_kg` is a cache of the
 *  newest row that SAYS SOMETHING about weight — a weigh-in that carries one,
 *  or a typed row (which may carry none: that is a clear). Nothing else ever
 *  writes the column, and every write to the history ends by running this, so
 *  the cache can never disagree with the history; migration `0027` put every
 *  weight that existed before this rule under a typed row of its own.
 *
 *  So a deleted mis-entry falls back to the weight before it — never to the
 *  mis-entry (a COALESCE onto the column did exactly that), never to a blank
 *  while a weighed row remains, and never to a weight the person had already
 *  cleared (the clear is itself a row, and the newest one).
 *
 *  A weightless row (waist only) is never picked up; a write that only touched
 *  such a row cannot move the number. The call-site guards that skip this on
 *  those writes are a cost saving and nothing more: run unconditionally the
 *  statement would recompute the same value. */
async function refreshWeight(sql: TransactionSql, userId: string): Promise<void> {
  await sql`
    UPDATE users SET weight_kg = (
      SELECT weight_kg FROM body_measurements
      WHERE user_id = ${userId} AND (weight_kg IS NOT NULL OR source = ${TYPED_WEIGHT_SOURCE})
      ORDER BY measured_at DESC, id DESC LIMIT 1)
    WHERE id = ${userId} AND status = 'active'`;
}

/** True when this row can be the one the rule above picks. */
const bearsWeight = (r: { weight_kg: string | null; source: string }): boolean =>
  r.weight_kg !== null || r.source === TYPED_WEIGHT_SOURCE;

/** The users row joined to its newest weight-bearing row, or to nothing (the
 *  three nullable columns are the LEFT JOIN's empty side). */
interface NewestWeightRow {
  id: string | null;
  weight_kg: string | null;
  source: string | null;
  created_at: Date | null;
  timezone: string | null;
}

/** A weight typed on screen 2 or PATCH /v1/users/me, or cleared there
 *  (`null`). Three cases, and the invariant that the typed row is the newest
 *  weight-bearing row is ENFORCED BY THE WRITE, not assumed:
 *
 *  - The newest weight-bearing row is already this person's own typed row from
 *    TODAY (their zone; the row's own created_at, which is never in the future):
 *    it is edited in place. A save-as-you-go screen sending 70 → 71 → 72 in a
 *    minute leaves ONE entry saying 72, never three "weigh-ins" of which two
 *    are numbers the person never had (RULINGS 2026-09-07 and 2026-09-10).
 *    The same number again, on any day, writes nothing while the person's
 *    own typed row is still the newest thing that says it.
 *  - Otherwise a number is a NEW typed row — even the number a weigh-in
 *    already shows, so that weigh-in can later be deleted as a mistake and
 *    the typed number is what comes back — dated so that it is the newest of
 *    everything this person has — `now()`, or one second after their newest
 *    entry when one is dated ahead of the clock (the contract allows a weigh-in
 *    up to 24 h in the future; it must not swallow what was typed today).
 *  - Otherwise `null` is a new typed row WITH NO WEIGHT, dated the same way,
 *    so nothing older than the clear can outrank it; when the number is
 *    already empty there is nothing to clear and nothing is written.
 *
 *  Both statements re-assert the account is active: callers hold the users
 *  row, but the guarantee lives in the SQL, not in that promise. */
export async function recordTypedWeight(
  tx: TransactionSql,
  userId: string,
  weightKg: number | null,
): Promise<void> {
  const rows = await tx<NewestWeightRow[]>`
    SELECT m.id, m.weight_kg, m.source, m.created_at, u.timezone
    FROM users u
    LEFT JOIN LATERAL (
      SELECT id, weight_kg, source, created_at FROM body_measurements
      WHERE user_id = u.id AND (weight_kg IS NOT NULL OR source = ${TYPED_WEIGHT_SOURCE})
      ORDER BY measured_at DESC, id DESC LIMIT 1) m ON true
    WHERE u.id = ${userId} AND u.status = 'active'`;
  const newest = rows[0];
  if (newest === undefined) return; // not an active account: nothing is written
  const current = newest.weight_kg === null ? null : Number(newest.weight_kg);
  const ownTyped = newest.id !== null && newest.source === TYPED_WEIGHT_SOURCE;
  // Nothing to record: the person's own typed row already says exactly this,
  // or there is no weight to clear. A WEIGH-IN carrying the same number is
  // not the same thing — typing it must still leave a typed row, or deleting
  // that weigh-in as a mistake later would leave nothing to fall back to.
  if (ownTyped && current === weightKg) return;
  if (weightKg === null && current === null) return;

  const zone = newest.timezone ?? "UTC";
  const typedToday =
    ownTyped &&
    newest.created_at !== null &&
    dayInTz(newest.created_at, zone) === dayInTz(new Date(), zone);
  if (typedToday) {
    await tx`
      UPDATE body_measurements SET weight_kg = ${weightKg}
      WHERE id = ${newest.id} AND user_id = ${userId}`;
  } else {
    // GREATEST ignores a NULL, so a person with no history gets now().
    await tx`
      INSERT INTO body_measurements (user_id, measured_at, weight_kg, metrics, source)
      SELECT u.id,
             GREATEST(now(), (SELECT max(measured_at) FROM body_measurements WHERE user_id = u.id) + interval '1 second'),
             ${weightKg}, ${tx.json({})}, ${TYPED_WEIGHT_SOURCE}
      FROM users u WHERE u.id = ${userId} AND u.status = 'active'`;
  }
  await refreshWeight(tx, userId);
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
    // A weightless row cannot be the one the rule picks (refreshWeight's note).
    if (bearsWeight(r)) await refreshWeight(tx, userId);
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
        metrics = coalesce(${v.metrics === undefined ? null : tx.json(v.metrics)}, metrics)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, measured_at, weight_kg, metrics, source, created_at`;
    const r = rows[0];
    // Skipped only for a row that bears no weight now and bore none before this
    // write (a waist edit): such a row is never the one the rule picks.
    if (r !== undefined && (bearsWeight(r) || v.weightKg !== undefined)) {
      await refreshWeight(tx, userId);
    }
    return r === undefined ? null : toMeasurement(r);
  });
}

export async function deleteMeasurement(sql: Sql, userId: string, id: string): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; weight_kg: string | null; source: string }[]>`
      DELETE FROM body_measurements WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, weight_kg, source`;
    // Deleting a row the rule could pick falls back to the one before it;
    // deleting a weightless row cannot move the number.
    const gone = rows[0];
    if (gone !== undefined && bearsWeight(gone)) await refreshWeight(tx, userId);
    return rows.length > 0;
  });
}
