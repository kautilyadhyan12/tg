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
import { usdaWords } from "./usdaWords.js";
import type { BodyMeasurementInput, DishwareInput, PatchBodyMeasurement, PatchDishware } from "./schemas.js";

/** Reads that run both standalone and inside a tx (postgres.js's Sql and
 *  TransactionSql are siblings, neither assignable to the other). */
type SqlOrTx = Sql | TransactionSql;

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
  input: { userId: string; gymId: string | null; provider: string; tokens: number; costMicro: bigint },
): Promise<void> {
  // cost_micro travels as text→::bigint (postgres.js doesn't parameterize
  // JS bigint by default); stays bigint in the TS domain (R6.1).
  await sql`
    INSERT INTO api_cost_events (user_id, gym_id, feature, provider, units, unit_type, cost_micro)
    VALUES (${input.userId}, ${input.gymId}, 'meal_scan', ${input.provider},
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


// ── body measurements (Part 4 §3.6) — THE ONE SOURCE OF BODY WEIGHT ─────────

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

/** THE ONE RULE (Kd ruling 2026-09-10, redesigned the same day): body weight
 *  lives in this history and NOWHERE ELSE. The person's current weight is the
 *  newest row that SAYS SOMETHING about weight — a weigh-in that carries one,
 *  or a typed row, which may carry none (that is a clear). There is no copy of
 *  the number (the `users.weight_kg` cache went with migration 0027), so every
 *  reader — the profile, the onboarding answers, the workout calories, the
 *  macro rings — calls this and cannot disagree with the history.
 *
 *  So a deleted mis-entry falls back to the weight before it, never to a
 *  blank while a weighed row remains, and never to a weight the person had
 *  already cleared (the clear is itself a row, and the newest one). A
 *  weightless row (waist only) is never picked up. */
export async function currentWeightKg(sql: SqlOrTx, userId: string): Promise<number | null> {
  const rows = await sql<{ weight_kg: string | null }[]>`
    SELECT weight_kg FROM body_measurements
    WHERE user_id = ${userId} AND (weight_kg IS NOT NULL OR source = ${TYPED_WEIGHT_SOURCE})
    ORDER BY measured_at DESC, id DESC LIMIT 1`;
  const r = rows[0];
  return r === undefined || r.weight_kg === null ? null : Number(r.weight_kg);
}

/** The users row joined to its newest weight-bearing row, or to nothing (the
 *  four nullable columns are the LEFT JOIN's empty side). */
interface NewestWeightRow {
  id: string | null;
  weight_kg: string | null;
  source: string | null;
  created_at: Date | null;
  timezone: string | null;
}

/** A weight typed on screen 2 or PATCH /v1/users/me, or cleared there
 *  (`null`). Callers hold the person's users row (active, FOR NO KEY UPDATE)
 *  for the whole transaction; that is what refuses a deleted account and
 *  serialises this with any other save. The read below still asks for an
 *  active account, so a caller that forgot would write nothing.
 *
 *  - The number the history ALREADY SHOWS, from any row, writes nothing. A
 *    form that echoes the weight it loaded (the web's profile form sends
 *    every field on every save) must not leave a "typed by me" entry the
 *    person never typed: such an entry outranks the weigh-in it copied, so
 *    deleting that weigh-in as a mistake would keep the mistake alive — the
 *    opposite of the ruling. The same goes for a clear when there is no
 *    weight to clear.
 *  - Otherwise, when the newest weight-bearing row is the person's own typed
 *    row from TODAY (their zone; the row's own created_at, which is never in
 *    the future), it is edited in place: a save-as-you-go screen sending
 *    70 → 71 → 72 in a minute leaves ONE entry saying 72, never three
 *    "weigh-ins" of which two are numbers the person never had.
 *  - Otherwise a NEW typed row — a number, or none for a clear — dated so that
 *    it is the newest of everything this person has: `now()`, or one second
 *    after their newest entry when one is dated ahead of the clock (a weigh-in
 *    may be dated up to 24 h in the future; it must not outrank what was
 *    typed today). */
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
  if (current === weightKg) return;

  const zone = newest.timezone ?? "UTC";
  const typedToday =
    newest.id !== null &&
    newest.source === TYPED_WEIGHT_SOURCE &&
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
      VALUES (${userId},
              GREATEST(now(), (SELECT max(measured_at) FROM body_measurements WHERE user_id = ${userId}) + interval '1 second'),
              ${weightKg}, ${tx.json({})}, ${TYPED_WEIGHT_SOURCE})`;
  }
}

/** Thrown by the three history writes when the account is not active: a
 *  request that passed sign-in and then queued behind the account's deletion.
 *  The service turns it into the 401 every request after a deletion gets. */
export class AccountNotActiveError extends Error {
  constructor() {
    super("account is not active");
    this.name = "AccountNotActiveError";
  }
}

/** The active-account gate for the three history writes below. Locks the
 *  users row for the transaction, so a deletion (an UPDATE of that row)
 *  cannot land between this check and the write. NO KEY UPDATE, not FOR
 *  UPDATE: every foreign-key check on this user elsewhere (a meal logged, a
 *  workout synced) takes KEY SHARE, which FOR UPDATE would make wait. */
async function lockOwner(tx: TransactionSql, userId: string): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM users WHERE id = ${userId} AND status = 'active' FOR NO KEY UPDATE`;
  if (rows.length === 0) throw new AccountNotActiveError();
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

/** Throws AccountNotActiveError for an account that is not active. */
export async function createMeasurement(
  sql: Sql,
  userId: string,
  v: BodyMeasurementInput,
): Promise<MeasurementRow> {
  return await sql.begin(async (tx) => {
    await lockOwner(tx, userId);
    const rows = await tx<MeasurementDbRow[]>`
      INSERT INTO body_measurements (user_id, measured_at, weight_kg, metrics, source)
      VALUES (${userId}, ${new Date(v.measuredAt)}, ${v.weightKg ?? null}, ${tx.json(v.metrics)}, ${v.source})
      RETURNING id, measured_at, weight_kg, metrics, source, created_at`;
    const r = rows[0];
    if (r === undefined) throw new Error("measurement insert returned no row");
    return toMeasurement(r);
  });
}

/** Null when the row is not this person's. Throws AccountNotActiveError for
 *  an account that is not active. */
export async function updateMeasurement(
  sql: Sql,
  userId: string,
  id: string,
  v: PatchBodyMeasurement,
): Promise<MeasurementRow | null> {
  return await sql.begin(async (tx) => {
    await lockOwner(tx, userId);
    const rows = await tx<MeasurementDbRow[]>`
      UPDATE body_measurements SET
        measured_at = coalesce(${v.measuredAt === undefined ? null : new Date(v.measuredAt)}, measured_at),
        weight_kg = CASE WHEN ${v.weightKg !== undefined} THEN ${v.weightKg ?? null} ELSE weight_kg END,
        metrics = coalesce(${v.metrics === undefined ? null : tx.json(v.metrics)}, metrics)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, measured_at, weight_kg, metrics, source, created_at`;
    const r = rows[0];
    return r === undefined ? null : toMeasurement(r);
  });
}

/** False when the row is not this person's. Throws AccountNotActiveError for
 *  an account that is not active. */
export async function deleteMeasurement(sql: Sql, userId: string, id: string): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockOwner(tx, userId);
    const rows = await tx<{ id: string }[]>`
      DELETE FROM body_measurements WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
  });
}

// ── the USDA food table (ROADMAP 7a-iii-a) ───────────────────────────────────
// PUBLIC DATA, NO OWNER: `usda_foods` is the one table here whose rows belong to
// nobody, so these are the only queries in this file with no tenancy WHERE.
// Nothing a person owns is reachable through them, and nothing here writes —
// `tools/import-usda.ts` is the table's only writer.

/** A USDA food as the search box and the food resolver read it. A figure the
 *  release does not measure is null; 7a-v shows the twelve beyond the macros,
 *  which is why only what a `FoodReference` carries is selected here. */
export interface UsdaFoodRow {
  fdcId: number;
  release: string;
  description: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  servingGrams: number;
  servingUnit: string;
}

/** At most this many words of a query reach the index; a search box query is
 *  capped at 100 characters upstream, and ten words is far past a food's name. */
const MAX_SEARCH_WORDS = 10;

/** A query's words, cut by the one rule that also stored the description's
 *  (`usdaWords.ts`): accents folded, lower case, letters and digits, a decimal
 *  point kept inside a number — the index is built from the description folded
 *  the same way (`search_text`), so "jalapeño" typed finds "Jalapeno". That rule
 *  is what makes the tsquery safe too — `&`, `|`, `!`, `(`, `)`, `:` and `*`
 *  separate words here, so no typed text can ever become a tsquery operator, and
 *  the result still crosses to Postgres as a parameter. */
export const usdaSearchWords = (query: string): string[] => usdaWords(query).slice(0, MAX_SEARCH_WORDS);

/** EVERY typed word must match, the last one as a prefix so the box answers
 *  while it is still being typed ("cappucc" finds "Coffee, Cappuccino").
 *  Null where nothing typed is searchable. English stop words are not in the
 *  index at all, so Postgres drops them from the query too: "milk of a cow"
 *  searches milk and cow, and a query of nothing but stop words matches
 *  nothing rather than everything. */
export function usdaTsQuery(query: string): string | null {
  const words = usdaSearchWords(query);
  if (words.length === 0) return null;
  return words.map((word, at) => (at === words.length - 1 ? `${word}:*` : word)).join(" & ");
}

const usdaRow = (r: {
  fdc_id: number; release: string; description: string; kcal: number; protein_g: number;
  carbs_g: number; fat_g: number; fiber_g: number | null; serving_grams: number; serving_unit: string;
}): UsdaFoodRow => ({
  fdcId: r.fdc_id, release: r.release, description: r.description, kcal: r.kcal,
  proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g, fiberG: r.fiber_g,
  servingGrams: r.serving_grams, servingUnit: r.serving_unit,
});

type UsdaColumns = Parameters<typeof usdaRow>[0];

/** The search box's USDA rung. These rows carry no physical sanity bound, as a
 *  packaged product does (`openfoodfacts.adapter.ts` refuses over 1,000 kcal or
 *  a macro over 100 g per 100 g): Open Food Facts is crowd-edited and a prank
 *  value can be written into it, while these are a government release loaded by
 *  one tool. Measured over both releases on 2026-09-16: the highest is 902 kcal
 *  per 100 g (beef tallow, and lard), and no macro exceeds 100 g.
 *
 *  A food with no energy, protein, carbohydrate or
 *  fat figure cannot be priced into a meal, so neither this nor the lookup below
 *  ever offers one: exactly one food is in that state, FNDDS 2705383 "Milk,
 *  human" (measured 2026-09-16).
 *
 *  THE FOOD ITSELF FIRST, THEN THE DISHES MADE FROM IT. USDA names a food
 *  "head, then qualifiers" — "Pumpkin, cooked" is the vegetable, "Muffin,
 *  pumpkin" is a muffin — so what a person typed is matched against the head of
 *  the description, in three steps, before anything else is considered:
 *    1. the head IS what was typed ("pumpkin" → "Pumpkin, cooked"; "orange
 *       juice" → "Orange juice, 100%, NFS", never "Orange, canned, juice pack");
 *    2. failing that, the description STARTS with what was typed, which is what
 *       keeps the answers steady while a word is still half-typed;
 *    3. failing that, its first word is the first word typed, which is what
 *       orders a query of two words USDA writes with a comma between them
 *       ("rice brown" → "Rice, brown, cooked, …", never "Beans and brown rice").
 *  Without this a two-word dish and a two-word ingredient tie, and USDA's own id
 *  decides: "pumpkin" answered Muffin, Bread, Cookie, Pie and Pancakes before
 *  the vegetable, and "banana" answered Banana split (measured 2026-09-16).
 *
 *  Then FNDDS before SR Legacy — the survey release
 *  describes food as people eat it — then the fewest-worded description, which
 *  is the plainest entry ("Coffee, Cappuccino" before "Coffee, Cappuccino,
 *  decaffeinated, with non-dairy milk"), then USDA's own id so two equal rows
 *  never swap places between searches.
 *
 *  The three head steps compare against `search_text` and `first_word`, which the
 *  importer folded by the same rule as the typed words, so an accent on either
 *  side changes no step. The words hold nothing but letters, digits and a decimal
 *  point, so they carry no `%` or `_` into `LIKE`. Measured through this function against the
 *  loaded table 2026-09-16: a word a person really types answers in 6–9 ms, and
 *  the widest word in either release ("cooked", 2,448 rows) in 20 ms. */
export async function searchUsdaFoods(sql: SqlOrTx, query: string, limit: number): Promise<UsdaFoodRow[]> {
  const words = usdaSearchWords(query);
  const tsQuery = usdaTsQuery(query);
  if (tsQuery === null || limit < 1) return [];
  const typed = words.join(" ");
  const firstWord = words[0] ?? "";
  const rows = await sql<UsdaColumns[]>`
    SELECT fdc_id, release, description, kcal, protein_g, carbs_g, fat_g, fiber_g, serving_grams, serving_unit
    FROM usda_foods
    WHERE search @@ to_tsquery('english', ${tsQuery})
      AND kcal IS NOT NULL AND protein_g IS NOT NULL AND carbs_g IS NOT NULL AND fat_g IS NOT NULL
    ORDER BY (search_text = ${typed} OR search_text LIKE ${`${typed},%`}) DESC,
             (search_text LIKE ${`${typed}%`}) DESC,
             (first_word = ${firstWord}) DESC,
             (release = 'fndds') DESC, word_count ASC, fdc_id ASC
    LIMIT ${limit}`;
  return rows.map(usdaRow);
}

/** The release a canonical names. The table stores SR Legacy as `sr_legacy`;
 *  a canonical spells it `sr`, as the curated list's citations do. */
const CANONICAL_RELEASES: ReadonlyMap<string, string> = new Map([
  ["sr", "sr_legacy"],
  ["fndds", "fndds"],
]);

const USDA_CANONICAL = /^usda_(sr|fndds)_(\d{1,10})$/;

/** `usda_foods.fdc_id` is an `integer` column, so an id past its range is not a
 *  food — and asking anyway is not a miss but a database error ("value
 *  2147483648 is out of range for type integer"), which would reach a person as
 *  a 500 for a canonical anyone can type. */
const MAX_FDC_ID = 2_147_483_647;

/** `usda_sr_167512` / `usda_fndds_2710472`. A saved meal keeps this, and comes
 *  back to the same row for as long as the release carries it. */
export const usdaCanonical = (row: { fdcId: number; release: string }): string =>
  `usda_${row.release === "fndds" ? "fndds" : "sr"}_${String(row.fdcId)}`;

/** The one food a canonical names, or null. The release is part of the WHERE,
 *  not decoration: `usda_fndds_167512` must never answer with SR Legacy's
 *  167512 just because the id happens to exist. */
export async function usdaFoodByCanonical(sql: SqlOrTx, canonical: string): Promise<UsdaFoodRow | null> {
  const parsed = USDA_CANONICAL.exec(canonical);
  const release = CANONICAL_RELEASES.get(parsed?.[1] ?? "");
  const fdcId = Number(parsed?.[2] ?? NaN);
  if (release === undefined || !Number.isInteger(fdcId) || fdcId < 1 || fdcId > MAX_FDC_ID) return null;
  const rows = await sql<UsdaColumns[]>`
    SELECT fdc_id, release, description, kcal, protein_g, carbs_g, fat_g, fiber_g, serving_grams, serving_unit
    FROM usda_foods
    WHERE fdc_id = ${fdcId} AND release = ${release}
      AND kcal IS NOT NULL AND protein_g IS NOT NULL AND carbs_g IS NOT NULL AND fat_g IS NOT NULL`;
  const r = rows[0];
  return r === undefined ? null : usdaRow(r);
}
