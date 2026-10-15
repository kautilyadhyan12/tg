// A gym's discounts and promo codes: the only file that reads or writes `gym_discounts`,
// `gym_discount_products` and `gym_discount_membership_types` (spec Part 3 §14.3; ROADMAP
// 18b-ii-a and 18b-ii-b). `repo.ts` calls `lockedDiscount`, `takeUse` and `returnUse` from
// inside a sale's own transaction, and `memberships/heldRepo.ts` the first two from inside
// the giving of a membership.
//
// Every statement carries `gym_id` in its WHERE, the ones holding a discount's id
// included. Every write takes the gym's row lock first.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  DISCOUNTS_MAX,
  DISCOUNT_ARCHIVED_PAGE,
  DISCOUNT_KINDS,
  MEMBERSHIP_PAYMENTS,
  memberCurrencyForCountry,
  type DiscountKind,
  type MembershipPayments,
} from "@app/shared";
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
  forProducts: boolean;
  allProducts: boolean;
  productIds: string[];
  forMemberships: boolean;
  allMembershipTypes: boolean;
  membershipTypeIds: string[];
  membershipPayments: MembershipPayments | null;
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
  for_products: boolean;
  all_products: boolean;
  product_ids: string[];
  for_memberships: boolean;
  all_membership_types: boolean;
  membership_type_ids: string[];
  membership_payments: string | null;
  archived_at: Date | null;
  updated_at: Date;
}

const kindSchema = z.enum(DISCOUNT_KINDS);
const paymentsSchema = z.enum(MEMBERSHIP_PAYMENTS).nullable();

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
  forProducts: r.for_products,
  allProducts: r.all_products,
  productIds: r.product_ids,
  forMemberships: r.for_memberships,
  allMembershipTypes: r.all_membership_types,
  membershipTypeIds: r.membership_type_ids,
  membershipPayments: paymentsSchema.parse(r.membership_payments),
  archivedAt: r.archived_at,
  updatedAt: r.updated_at,
});

/** The columns every read of a discount takes, from `gym_discounts d`. */
const columns = (sql: Sql | TransactionSql) => sql`
  d.id, d.name, d.code, d.kind, d.percent_bp, d.amount_minor, d.currency, d.starts_on::text AS starts_on,
  d.ends_on::text AS ends_on, d.max_uses, d.uses, d.for_products, d.all_products, d.for_memberships,
  d.all_membership_types, d.membership_payments, d.archived_at, d.updated_at,
  COALESCE((SELECT array_agg(p.product_id::text ORDER BY p.product_id)
            FROM gym_discount_products p WHERE p.gym_id = d.gym_id AND p.discount_id = d.id), '{}') AS product_ids,
  COALESCE((SELECT array_agg(m.membership_type_id::text ORDER BY m.membership_type_id)
            FROM gym_discount_membership_types m WHERE m.gym_id = d.gym_id AND m.discount_id = d.id), '{}') AS membership_type_ids`;

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

/** A gym's discounts in use that are for memberships: what a person's page offers when a
 *  membership is added. Bounded by the cap the writes hold. */
export async function membershipDiscounts(sql: Sql, gymId: string): Promise<DiscountRow[]> {
  const rows = await sql<RawDiscount[]>`
    SELECT ${columns(sql)} FROM gym_discounts d
    WHERE d.gym_id = ${gymId} AND d.archived_at IS NULL AND d.for_memberships
    ORDER BY lower(d.name), d.id LIMIT ${DISCOUNTS_MAX}`;
  return rows.map(discount);
}

/** The discounts Refer a friend can give (20e-ii-a): the gym's ones in use with a promo
 *  code, and any named in `picked` whatever they are now (one archived since it was
 *  picked). Bounded by the cap the writes hold, plus the two picked. */
export async function referralDiscounts(sql: Sql | TransactionSql, gymId: string, picked: readonly string[]): Promise<DiscountRow[]> {
  const rows = await sql<RawDiscount[]>`
    SELECT ${columns(sql)} FROM gym_discounts d
    WHERE d.gym_id = ${gymId}
      AND ((d.archived_at IS NULL AND d.code IS NOT NULL) OR d.id = ANY(${[...picked]}::uuid[]))
    ORDER BY lower(d.name), d.id LIMIT ${DISCOUNTS_MAX + 2}`;
  return rows.map(discount);
}

/** The gym's membership types on its price list, by name; a gym has at most 60. */
export async function membershipTypeNames(sql: Sql, gymId: string): Promise<{ id: string; name: string; taxRateId: string | null; free: boolean }[]> {
  return await sql<{ id: string; name: string; taxRateId: string | null; free: boolean }[]>`
    SELECT id, name, tax_rate_id AS "taxRateId", price_minor = 0 AS free FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL
    ORDER BY lower(name), id`;
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
  forProducts: boolean;
  allProducts: boolean;
  productIds: string[];
  forMemberships: boolean;
  allMembershipTypes: boolean;
  membershipTypeIds: string[];
  membershipPayments: MembershipPayments | null;
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
  /** A membership type it is limited to is not one on this gym's price list. */
  | { kind: "membership_type_not_found" }
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

/** Whether every membership type named is one on this gym's price list. */
async function typesAreLive(tx: TransactionSql, gymId: string, typeIds: string[]): Promise<boolean> {
  if (typeIds.length === 0) return true;
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL AND id IN ${tx(typeIds)}`;
  return (row?.n ?? 0) === typeIds.length;
}

async function setMembershipTypes(tx: TransactionSql, gymId: string, discountId: string, typeIds: string[]): Promise<void> {
  await tx`DELETE FROM gym_discount_membership_types WHERE gym_id = ${gymId} AND discount_id = ${discountId}`;
  if (typeIds.length === 0) return;
  await tx`
    INSERT INTO gym_discount_membership_types ${tx(typeIds.map((typeId) => ({ gym_id: gymId, discount_id: discountId, membership_type_id: typeId })))}`;
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
  products: !input.forProducts ? "none" : input.allProducts ? "all" : String(input.productIds.length),
  memberships: !input.forMemberships ? "none" : input.allMembershipTypes ? "all" : String(input.membershipTypeIds.length),
  ...(input.membershipPayments === null ? {} : { membershipPayments: input.membershipPayments }),
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
    if (!(await typesAreLive(tx, input.gymId, input.membershipTypeIds))) return { kind: "membership_type_not_found" };
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_discounts (gym_id, name, code, kind, percent_bp, amount_minor, currency, starts_on, ends_on, max_uses,
                                 for_products, all_products, for_memberships, all_membership_types, membership_payments)
      VALUES (${input.gymId}, ${input.name}, ${input.code}, ${input.kind}, ${input.percentBp}, ${input.amountMinor}, ${money.currency},
              ${input.startsOn}::date, ${input.endsOn}::date, ${input.maxUses}, ${input.forProducts}, ${input.allProducts},
              ${input.forMemberships}, ${input.allMembershipTypes}, ${input.membershipPayments})
      RETURNING id`;
    if (created === undefined) throw new Error("discount insert returned no row");
    await setProducts(tx, input.gymId, created.id, input.productIds);
    await setMembershipTypes(tx, input.gymId, created.id, input.membershipTypeIds);
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

/** Replace a discount's fields. No sale or membership already made is touched: each keeps
 *  the name and the amount it was made with. `uses` is left as it is. */
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
    if (!(await typesAreLive(tx, input.gymId, input.membershipTypeIds))) return { kind: "membership_type_not_found" };
    await tx`
      UPDATE gym_discounts
      SET name = ${input.name}, code = ${input.code}, kind = ${input.kind}, percent_bp = ${input.percentBp},
          amount_minor = ${input.amountMinor}, currency = ${money.currency}, starts_on = ${input.startsOn}::date,
          ends_on = ${input.endsOn}::date, max_uses = ${input.maxUses}, for_products = ${input.forProducts},
          all_products = ${input.allProducts}, for_memberships = ${input.forMemberships},
          all_membership_types = ${input.allMembershipTypes}, membership_payments = ${input.membershipPayments}, updated_at = ${input.now}
      WHERE id = ${input.discountId} AND gym_id = ${input.gymId}`;
    await setProducts(tx, input.gymId, input.discountId, input.productIds);
    await setMembershipTypes(tx, input.gymId, input.discountId, input.membershipTypeIds);
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
