// A gym's tax: the only file that reads or writes `gym_tax_rates` and whether the gym's
// prices hold the tax (spec Part 3 §14.3; ROADMAP 18b-iii). `repo.ts` reads a product's rate
// for a sale, and `memberships/` read a type's and a membership's rate for its bills, each
// through `rateOf` and `taxIncludedOf` below, inside their own transactions.
//
// Every statement carries `gym_id` in its WHERE, the ones holding a rate's id included.
// Every write takes the gym's row lock first, so the cap, the name check and "nothing live
// charges it" are decided against rows nobody else is changing.
import type { Sql, TransactionSql } from "postgres";
import { TAX_RATES_MAX, taxIncludedForCountry, type GymTaxRate } from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";

/** Whether the gym's prices hold its tax: what it chose, else what its country does. */
export async function taxIncludedOf(sql: Sql | TransactionSql, gymId: string): Promise<boolean | null> {
  const [gym] = await sql<{ country: string | null; sales_tax_included: boolean | null }[]>`
    SELECT country, sales_tax_included FROM gyms WHERE id = ${gymId}`;
  if (gym === undefined) return null;
  return gym.sales_tax_included ?? taxIncludedForCountry(gym.country);
}

/** One of this gym's rates, or null where it has no such rate. */
export async function rateOf(sql: Sql | TransactionSql, gymId: string, rateId: string): Promise<{ id: string; name: string; bp: number } | null> {
  const [row] = await sql<{ id: string; name: string; rate_bp: number }[]>`
    SELECT id, name, rate_bp FROM gym_tax_rates WHERE gym_id = ${gymId} AND id = ${rateId}`;
  return row === undefined ? null : { id: row.id, name: row.name, bp: row.rate_bp };
}

/** The gym's rates by name, each with what live charges it: products on sale, types on the
 *  price list, and memberships people hold that are not over. A gym has at most
 *  `TAX_RATES_MAX`. */
export async function readRates(sql: Sql | TransactionSql, gymId: string): Promise<GymTaxRate[]> {
  const rows = await sql<{ id: string; name: string; rate_bp: number; products: number; types: number; memberships: number }[]>`
    SELECT r.id, r.name, r.rate_bp,
           (SELECT count(*) FROM gym_products p
            WHERE p.gym_id = r.gym_id AND p.tax_rate_id = r.id AND p.archived_at IS NULL)::int AS products,
           (SELECT count(*) FROM gym_membership_types t
            WHERE t.gym_id = r.gym_id AND t.tax_rate_id = r.id AND t.archived_at IS NULL)::int AS types,
           (SELECT count(*) FROM gym_held_memberships h
            WHERE h.gym_id = r.gym_id AND h.tax_rate_id = r.id AND h.status IN ('active','frozen'))::int AS memberships
    FROM gym_tax_rates r
    WHERE r.gym_id = ${gymId}
    ORDER BY lower(r.name), r.id
    LIMIT ${TAX_RATES_MAX}`;
  return rows.map((r) => ({ id: r.id, name: r.name, bp: r.rate_bp, products: r.products, membershipTypes: r.types, memberships: r.memberships }));
}

export type RateWriteOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "name_taken" }
  /** Something live still charges it: say what, so staff can change it first. */
  | { kind: "in_use"; name: string; products: number; membershipTypes: number; memberships: number };

async function nameTaken(tx: TransactionSql, gymId: string, name: string, exceptId: string | null): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_tax_rates
    WHERE gym_id = ${gymId} AND lower(name) = lower(${name})
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1`;
  return rows.length > 0;
}

export async function createRate(sql: Sql, input: { gymId: string; name: string; bp: number; actorUserId: string }): Promise<RateWriteOutcome> {
  return await sql.begin(async (tx): Promise<RateWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [count] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_tax_rates WHERE gym_id = ${input.gymId}`;
    if ((count?.n ?? 0) >= TAX_RATES_MAX) return { kind: "too_many", cap: TAX_RATES_MAX };
    if (await nameTaken(tx, input.gymId, input.name, null)) return { kind: "name_taken" };
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_tax_rates (gym_id, name, rate_bp) VALUES (${input.gymId}, ${input.name}, ${input.bp})
      RETURNING id`;
    if (created === undefined) throw new Error("tax rate insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.tax_rate_created",
      targetType: "gym_tax_rate",
      targetId: created.id,
      meta: { name: input.name, bp: String(input.bp) },
    });
    return { kind: "ok" };
  });
}

/** A new name or percentage. Sales and bills already made keep theirs; every one made from
 *  now on charges the new one. */
export async function updateRate(sql: Sql, input: { gymId: string; rateId: string; name: string; bp: number; actorUserId: string; now: Date }): Promise<RateWriteOutcome> {
  return await sql.begin(async (tx): Promise<RateWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const before = await rateOf(tx, input.gymId, input.rateId);
    if (before === null) return { kind: "not_found" };
    if (before.name === input.name && before.bp === input.bp) return { kind: "ok" };
    if (await nameTaken(tx, input.gymId, input.name, input.rateId)) return { kind: "name_taken" };
    await tx`
      UPDATE gym_tax_rates SET name = ${input.name}, rate_bp = ${input.bp}, updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND id = ${input.rateId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.tax_rate_updated",
      targetType: "gym_tax_rate",
      targetId: input.rateId,
      meta: { before: before.name, after: input.name, bpBefore: String(before.bp), bpAfter: String(input.bp) },
    });
    return { kind: "ok" };
  });
}

/** Removes a rate nothing live charges. What is archived or over loses it (the foreign keys
 *  clear it); every sale and bill made with it keeps its name and percentage. */
export async function removeRate(sql: Sql, input: { gymId: string; rateId: string; actorUserId: string }): Promise<RateWriteOutcome> {
  return await sql.begin(async (tx): Promise<RateWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const rate = (await readRates(tx, input.gymId)).find((r) => r.id === input.rateId);
    if (rate === undefined) return { kind: "not_found" };
    if (rate.products > 0 || rate.membershipTypes > 0 || rate.memberships > 0) {
      return { kind: "in_use", name: rate.name, products: rate.products, membershipTypes: rate.membershipTypes, memberships: rate.memberships };
    }
    await tx`DELETE FROM gym_tax_rates WHERE gym_id = ${input.gymId} AND id = ${input.rateId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.tax_rate_removed",
      targetType: "gym_tax_rate",
      targetId: input.rateId,
      meta: { name: rate.name, bp: String(rate.bp) },
    });
    return { kind: "ok" };
  });
}

/** Whether the gym's prices hold the tax. Bills and sales already made keep theirs. */
export async function saveTaxMode(sql: Sql, input: { gymId: string; included: boolean; actorUserId: string }): Promise<void> {
  await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const was = await taxIncludedOf(tx, input.gymId);
    if (was === null || was === input.included) return;
    await tx`UPDATE gyms SET sales_tax_included = ${input.included} WHERE id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.sales_tax_changed",
      targetType: "gym",
      targetId: input.gymId,
      meta: { includedBefore: String(was), includedAfter: String(input.included) },
    });
  });
}
