// A gym's discounts and promo codes: the only file that reads or writes `gym_discounts`
// and `gym_discount_products` (spec Part 3 §14.3; ROADMAP 18b-ii-a). `repo.ts` calls
// `lockedDiscount`, `takeUse` and `returnUse` from inside a sale's own transaction.
//
// Every statement carries `gym_id` in its WHERE, the ones holding a discount's id
// included. Every write takes the gym's row lock first.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { DISCOUNTS_MAX, DISCOUNT_ARCHIVED_PAGE, DISCOUNT_KINDS, memberCurrencyForCountry, type DiscountKind } from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";

export interface DiscountRow {
  id: string;
  name: string;
  code: string | null;
  kind: DiscountKind;
  percentBp: number | null;
  amountMinor: number | null;
  currency: string | null;
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  uses: number;
  allProducts: boolean;
  productIds: string[];
  archivedAt: Date | null;
  updatedAt: Date;
}

interface RawDiscount {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  percent_bp: number | null;
  amount_minor: number | null;
  currency: string | null;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  uses: number;
  all_products: boolean;
  product_ids: string[];
  archived_at: Date | null;
  updated_at: Date;
}

const kindSchema = z.enum(DISCOUNT_KINDS);

const discount = (r: RawDiscount): DiscountRow => ({
  id: r.id,
  name: r.name,
  code: r.code,
  // Text under a CHECK: parsed, so a kind this build does not know fails here.
  kind: kindSchema.parse(r.kind),
  percentBp: r.percent_bp,
  amountMinor: r.amount_minor,
  currency: r.currency,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  maxUses: r.max_uses,
  uses: r.uses,
  allProducts: r.all_products,
  productIds: r.product_ids,
  archivedAt: r.archived_at,
  updatedAt: r.updated_at,
});

/** The columns every read of a discount takes, from `gym_discounts d`. */
const columns = (sql: Sql | TransactionSql) => sql`
  d.id, d.name, d.code, d.kind, d.percent_bp, d.amount_minor, d.currency, d.starts_on::text AS starts_on,
  d.ends_on::text AS ends_on, d.max_uses, d.uses, d.all_products, d.archived_at, d.updated_at,
  COALESCE((SELECT array_agg(p.product_id::text ORDER BY p.product_id)
            FROM gym_discount_products p WHERE p.gym_id = d.gym_id AND p.discount_id = d.id), '{}') AS product_ids`;

/** A gym's discounts: the ones in use (bounded by the cap the writes hold), a page of the
 *  archived ones, and how many of those there are. */
export async function readDiscounts(sql: Sql, gymId: string): Promise<{ live: DiscountRow[]; archived: DiscountRow[]; archivedTotal: number }> {
  const [live, archived, count] = await Promise.all([
    sql<RawDiscount[]>`
      SELECT ${columns(sql)} FROM gym_discounts d
      WHERE d.gym_id = ${gymId} AND d.archived_at IS NULL
      ORDER BY lower(d.name), d.id LIMIT ${DISCOUNTS_MAX}`,
    sql<RawDiscount[]>`
      SELECT ${columns(sql)} FROM gym_discounts d
      WHERE d.gym_id = ${gymId} AND d.archived_at IS NOT NULL
      ORDER BY d.archived_at DESC, d.id LIMIT ${DISCOUNT_ARCHIVED_PAGE}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_discounts WHERE gym_id = ${gymId} AND archived_at IS NOT NULL`,
  ]);
  return { live: live.map(discount), archived: archived.map(discount), archivedTotal: count[0]?.n ?? 0 };
}

/** One discount of this gym's, held for a sale, or null where it is not this gym's. */
export async function lockedDiscount(tx: TransactionSql, gymId: string, discountId: string): Promise<DiscountRow | null> {
  const [raw] = await tx<RawDiscount[]>`
    SELECT ${columns(tx)} FROM gym_discounts d
    WHERE d.gym_id = ${gymId} AND d.id = ${discountId}
    FOR UPDATE OF d`;
  return raw === undefined ? null : discount(raw);
}

/** Counts one more use, in one statement that will not pass the limit. False where the
 *  limit is reached. */
export async function takeUse(tx: TransactionSql, gymId: string, discountId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_discounts SET uses = uses + 1
    WHERE gym_id = ${gymId} AND id = ${discountId} AND archived_at IS NULL AND (max_uses IS NULL OR uses < max_uses)
    RETURNING id`;
  return rows.length === 1;
}

/** Gives one use back: the sale that took it was undone. */
export async function returnUse(tx: TransactionSql, gymId: string, discountId: string): Promise<void> {
  await tx`UPDATE gym_discounts SET uses = GREATEST(uses - 1, 0) WHERE gym_id = ${gymId} AND id = ${discountId}`;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface DiscountInput {
  name: string;
  code: string | null;
  kind: DiscountKind;
  percentBp: number | null;
  amountMinor: number | null;
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  allProducts: boolean;
  productIds: string[];
}

export type DiscountWriteOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "name_taken" }
  | { kind: "code_taken" }
  /** The discount was changed after the form that sent this read it. */
  | { kind: "changed" }
  /** A product it is limited to is not one this gym has for sale. */
  | { kind: "product_not_found" }
  /** A fixed amount, and the gym's country has no money to put it in. */
  | { kind: "no_currency" };

async function liveCount(tx: TransactionSql, gymId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_discounts WHERE gym_id = ${gymId} AND archived_at IS NULL`;
  return row?.n ?? 0;
}

/** Whether another discount in use has this name, or this promo code. */
async function clash(tx: TransactionSql, gymId: string, name: string, code: string | null, exceptId: string | null): Promise<"name_taken" | "code_taken" | null> {
  const rows = await tx<{ same_name: boolean; same_code: boolean }[]>`
    SELECT lower(name) = lower(${name}) AS same_name, (${code}::text IS NOT NULL AND code = ${code}) AS same_code
    FROM gym_discounts
    WHERE gym_id = ${gymId} AND archived_at IS NULL
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
      AND (lower(name) = lower(${name}) OR (${code}::text IS NOT NULL AND code = ${code}))`;
  if (rows.some((r) => r.same_name)) return "name_taken";
  return rows.some((r) => r.same_code) ? "code_taken" : null;
}

/** Whether every product named is one this gym has for sale. */
async function productsAreLive(tx: TransactionSql, gymId: string, productIds: string[]): Promise<boolean> {
  if (productIds.length === 0) return true;
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_products
    WHERE gym_id = ${gymId} AND archived_at IS NULL AND id IN ${tx(productIds)}`;
  return (row?.n ?? 0) === productIds.length;
}

async function setProducts(tx: TransactionSql, gymId: string, discountId: string, productIds: string[]): Promise<void> {
  await tx`DELETE FROM gym_discount_products WHERE gym_id = ${gymId} AND discount_id = ${discountId}`;
  if (productIds.length === 0) return;
  await tx`
    INSERT INTO gym_discount_products ${tx(productIds.map((productId) => ({ gym_id: gymId, discount_id: discountId, product_id: productId })))}`;
}

/** The money a fixed amount is in: the gym's own as it is now. A percentage has none. */
async function currencyFor(tx: TransactionSql, gymId: string, kind: DiscountKind): Promise<{ ok: true; currency: string | null } | { ok: false }> {
  if (kind === "percent") return { ok: true, currency: null };
  const [gym] = await tx<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${gymId}`;
  const currency = memberCurrencyForCountry(gym?.country ?? null);
  return currency === null ? { ok: false } : { ok: true, currency };
}

const what = (input: DiscountInput, currency: string | null): Record<string, string> => ({
  name: input.name,
  ...(input.code === null ? {} : { code: input.code }),
  ...(input.kind === "percent" ? { percentBp: String(input.percentBp) } : { amountMinor: String(input.amountMinor), currency: currency ?? "" }),
  ...(input.startsOn === null ? {} : { startsOn: input.startsOn }),
  ...(input.endsOn === null ? {} : { endsOn: input.endsOn }),
  maxUses: input.maxUses === null ? "no limit" : String(input.maxUses),
  products: input.allProducts ? "all" : String(input.productIds.length),
});

export async function createDiscount(sql: Sql, input: DiscountInput & { gymId: string; actorUserId: string }): Promise<DiscountWriteOutcome> {
  return await sql.begin(async (tx): Promise<DiscountWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const money = await currencyFor(tx, input.gymId, input.kind);
    if (!money.ok) return { kind: "no_currency" };
    if ((await liveCount(tx, input.gymId)) >= DISCOUNTS_MAX) return { kind: "too_many", cap: DISCOUNTS_MAX };
    const taken = await clash(tx, input.gymId, input.name, input.code, null);
    if (taken !== null) return { kind: taken };
    if (!(await productsAreLive(tx, input.gymId, input.productIds))) return { kind: "product_not_found" };
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_discounts (gym_id, name, code, kind, percent_bp, amount_minor, currency, starts_on, ends_on, max_uses, all_products)
      VALUES (${input.gymId}, ${input.name}, ${input.code}, ${input.kind}, ${input.percentBp}, ${input.amountMinor}, ${money.currency},
              ${input.startsOn}::date, ${input.endsOn}::date, ${input.maxUses}, ${input.allProducts})
      RETURNING id`;
    if (created === undefined) throw new Error("discount insert returned no row");
    await setProducts(tx, input.gymId, created.id, input.productIds);
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.discount_created",
      targetType: "gym_discount",
      targetId: created.id,
      meta: what(input, money.currency),
    });
    return { kind: "ok" };
  });
}

/** Replace a discount's fields. No sale already made is touched: each keeps the name and
 *  the amount it was sold with. `uses` is left as it is. */
export async function updateDiscount(
  sql: Sql,
  input: DiscountInput & { gymId: string; discountId: string; readAt: Date; actorUserId: string; now: Date },
): Promise<DiscountWriteOutcome> {
  return await sql.begin(async (tx): Promise<DiscountWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string; updated_at: Date }[]>`
      SELECT name, updated_at FROM gym_discounts
      WHERE id = ${input.discountId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    // To the millisecond, which is what the list sends and a form can send back.
    if (before.updated_at.getTime() !== input.readAt.getTime()) return { kind: "changed" };
    const money = await currencyFor(tx, input.gymId, input.kind);
    if (!money.ok) return { kind: "no_currency" };
    const taken = await clash(tx, input.gymId, input.name, input.code, input.discountId);
    if (taken !== null) return { kind: taken };
    if (!(await productsAreLive(tx, input.gymId, input.productIds))) return { kind: "product_not_found" };
    await tx`
      UPDATE gym_discounts
      SET name = ${input.name}, code = ${input.code}, kind = ${input.kind}, percent_bp = ${input.percentBp},
          amount_minor = ${input.amountMinor}, currency = ${money.currency}, starts_on = ${input.startsOn}::date,
          ends_on = ${input.endsOn}::date, max_uses = ${input.maxUses}, all_products = ${input.allProducts}, updated_at = ${input.now}
      WHERE id = ${input.discountId} AND gym_id = ${input.gymId}`;
    await setProducts(tx, input.gymId, input.discountId, input.productIds);
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.discount_updated",
      targetType: "gym_discount",
      targetId: input.discountId,
      meta: { before: before.name, ...what(input, money.currency) },
    });
    return { kind: "ok" };
  });
}

/** Archive: the discount can no longer be used, and is kept with the sales made with it. */
export async function archiveDiscount(sql: Sql, input: { gymId: string; discountId: string; actorUserId: string; now: Date }): Promise<DiscountWriteOutcome> {
  return await sql.begin(async (tx): Promise<DiscountWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string }[]>`
      UPDATE gym_discounts SET archived_at = ${input.now}, updated_at = ${input.now}
      WHERE id = ${input.discountId} AND gym_id = ${input.gymId} AND archived_at IS NULL
      RETURNING name`;
    if (before === undefined) return { kind: "not_found" };
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.discount_archived",
      targetType: "gym_discount",
      targetId: input.discountId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}

/** Put an archived discount back. It counts against the cap, and a discount in use may
 *  have taken its name or its promo code while it was away. */
export async function restoreDiscount(sql: Sql, input: { gymId: string; discountId: string; actorUserId: string; now: Date }): Promise<DiscountWriteOutcome> {
  return await sql.begin(async (tx): Promise<DiscountWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string; code: string | null }[]>`
      SELECT name, code FROM gym_discounts
      WHERE id = ${input.discountId} AND gym_id = ${input.gymId} AND archived_at IS NOT NULL`;
    if (before === undefined) return { kind: "not_found" };
    if ((await liveCount(tx, input.gymId)) >= DISCOUNTS_MAX) return { kind: "too_many", cap: DISCOUNTS_MAX };
    const taken = await clash(tx, input.gymId, before.name, before.code, input.discountId);
    if (taken !== null) return { kind: taken };
    await tx`
      UPDATE gym_discounts SET archived_at = NULL, updated_at = ${input.now}
      WHERE id = ${input.discountId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.discount_restored",
      targetType: "gym_discount",
      targetId: input.discountId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}
