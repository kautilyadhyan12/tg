// A gym's tax: the only file that reads or writes `gym_tax_rates` and whether the gym's
// prices hold the tax (spec Part 3 §14.3; ROADMAP 18b-iii). `repo.ts` reads a product's rates
// (`gym_product_tax_rates`, 18b-v-a) for a sale, and `memberships/` read a type's and a
// membership's rate for its bills, through `rateOf`, `ratesOf` and `taxIncludedOf` below,
// inside their own transactions.
//
// Every statement carries `gym_id` in its WHERE, the ones holding a rate's id included.
// Every write takes the gym's row lock first, so the cap, the name check and "nothing live
// charges it" are decided against rows nobody else is changing.
import type { Sql, TransactionSql } from "postgres";
import { SALES_TAX_PCM_MAX, TAXED_PRICE_MINOR_MAX, TAX_RATES_MAX, taxIncludedForCountry, type GymTaxRate } from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { taxedInUse } from "../memberships/heldRepo.js";

/** Whether the gym's prices hold its tax: what it chose, else what its country does. */
export async function taxIncludedOf(sql: Sql | TransactionSql, gymId: string): Promise<boolean | null> {
  const [gym] = await sql<{ country: string | null; sales_tax_included: boolean | null }[]>`
    SELECT country, sales_tax_included FROM gyms WHERE id = ${gymId}`;
  if (gym === undefined) return null;
  return gym.sales_tax_included ?? taxIncludedForCountry(gym.country);
}

/** One of this gym's rates, or null where it has no such rate. */
export async function rateOf(sql: Sql | TransactionSql, gymId: string, rateId: string): Promise<{ id: string; name: string; pcm: number } | null> {
  const [row] = await sql<{ id: string; name: string; rate_pcm: number }[]>`
    SELECT id, name, rate_pcm FROM gym_tax_rates WHERE gym_id = ${gymId} AND id = ${rateId}`;
  return row === undefined ? null : { id: row.id, name: row.name, pcm: row.rate_pcm };
}

/** These of this gym's rates, in the order given; null where one is not the gym's (18b-v-a). */
export async function ratesOf(sql: Sql | TransactionSql, gymId: string, rateIds: readonly string[]): Promise<{ id: string; name: string; pcm: number }[] | null> {
  if (rateIds.length === 0) return [];
  const rows = await sql<{ id: string; name: string; rate_pcm: number }[]>`
    SELECT id, name, rate_pcm FROM gym_tax_rates WHERE gym_id = ${gymId} AND id = ANY(${rateIds}::uuid[])`;
  const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, pcm: r.rate_pcm }]));
  const found = rateIds.map((id) => byId.get(id));
  return found.every((r) => r !== undefined) ? found.filter((r) => r !== undefined) : null;
}

/** The gym's rates by name, each with what live charges it: products on sale, types on the
 *  price list, and memberships current members hold that will be billed again
 *  (`taxedInUse`), counted on the gym's own day; with `today` null, those are not counted.
 *  A gym has at most `TAX_RATES_MAX`. */
export async function readRates(sql: Sql | TransactionSql, gymId: string, today: string | null): Promise<GymTaxRate[]> {
  const [rows, held] = await Promise.all([
    sql<{ id: string; name: string; rate_pcm: number; products: number; types: number }[]>`
      SELECT r.id, r.name, r.rate_pcm,
             (SELECT count(*) FROM gym_product_tax_rates x
              JOIN gym_products p ON p.gym_id = x.gym_id AND p.id = x.product_id
              WHERE x.gym_id = r.gym_id AND x.tax_rate_id = r.id AND p.archived_at IS NULL)::int AS products,
             (SELECT count(*) FROM gym_membership_types t
              WHERE t.gym_id = r.gym_id AND t.tax_rate_id = r.id AND t.archived_at IS NULL)::int AS types
      FROM gym_tax_rates r
      WHERE r.gym_id = ${gymId}
      ORDER BY lower(r.name), r.id
      LIMIT ${TAX_RATES_MAX}`,
    today === null ? new Map<string, number>() : taxedInUse(sql, gymId, today),
  ]);
  return rows.map((r) => ({ id: r.id, name: r.name, pcm: r.rate_pcm, products: r.products, membershipTypes: r.types, memberships: held.get(r.id) ?? 0 }));
}

export type RateWriteOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "name_taken" }
  /** Something live still charges it: say what, so staff can change it first. */
  | { kind: "in_use"; name: string; products: number; membershipTypes: number; memberships: number }
  /** A product on sale would charge more than 30% in all (18b-v-a): which one. */
  | { kind: "taxes_over_cap"; product: string };

/** The first product on sale, of those charging `rateId` (or of `productIds`), whose rates would
 *  come to more than the cap with `rateId` at `pcm`; null where none would. */
async function productOverCap(
  tx: TransactionSql,
  gymId: string,
  rateId: string,
  pcm: number,
  productIds: readonly string[] | null,
): Promise<string | null> {
  const [over] = await tx<{ name: string }[]>`
    SELECT p.name FROM gym_products p
    WHERE p.gym_id = ${gymId} AND p.archived_at IS NULL
      AND ${productIds === null ? tx`EXISTS (SELECT 1 FROM gym_product_tax_rates x WHERE x.gym_id = p.gym_id AND x.product_id = p.id AND x.tax_rate_id = ${rateId})` : tx`p.id = ANY(${productIds}::uuid[])`}
      AND ${pcm} + COALESCE((SELECT sum(r.rate_pcm) FROM gym_product_tax_rates x
                             JOIN gym_tax_rates r ON r.gym_id = x.gym_id AND r.id = x.tax_rate_id
                             WHERE x.gym_id = p.gym_id AND x.product_id = p.id AND x.tax_rate_id <> ${rateId}), 0) > ${SALES_TAX_PCM_MAX}
    ORDER BY lower(p.name), p.id
    LIMIT 1`;
  return over?.name ?? null;
}

async function nameTaken(tx: TransactionSql, gymId: string, name: string, exceptId: string | null): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_tax_rates
    WHERE gym_id = ${gymId} AND lower(name) = lower(${name})
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1`;
  return rows.length > 0;
}

export async function createRate(sql: Sql, input: { gymId: string; name: string; pcm: number; actorUserId: string }): Promise<RateWriteOutcome> {
  return await sql.begin(async (tx): Promise<RateWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [count] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_tax_rates WHERE gym_id = ${input.gymId}`;
    if ((count?.n ?? 0) >= TAX_RATES_MAX) return { kind: "too_many", cap: TAX_RATES_MAX };
    if (await nameTaken(tx, input.gymId, input.name, null)) return { kind: "name_taken" };
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_tax_rates (gym_id, name, rate_pcm) VALUES (${input.gymId}, ${input.name}, ${input.pcm})
      RETURNING id`;
    if (created === undefined) throw new Error("tax rate insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.tax_rate_created",
      targetType: "gym_tax_rate",
      targetId: created.id,
      meta: { name: input.name, pcm: String(input.pcm) },
    });
    return { kind: "ok" };
  });
}

/** A new name or percentage. Sales and bills already made keep theirs; every one made from
 *  now on charges the new one. A percentage that would take a product's taxes past 30% in all
 *  is refused (18b-v-a). */
export async function updateRate(sql: Sql, input: { gymId: string; rateId: string; name: string; pcm: number; actorUserId: string; now: Date }): Promise<RateWriteOutcome> {
  return await sql.begin(async (tx): Promise<RateWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const before = await rateOf(tx, input.gymId, input.rateId);
    if (before === null) return { kind: "not_found" };
    if (before.name === input.name && before.pcm === input.pcm) return { kind: "ok" };
    if (await nameTaken(tx, input.gymId, input.name, input.rateId)) return { kind: "name_taken" };
    if (input.pcm > before.pcm) {
      const over = await productOverCap(tx, input.gymId, input.rateId, input.pcm, null);
      if (over !== null) return { kind: "taxes_over_cap", product: over };
    }
    await tx`
      UPDATE gym_tax_rates SET name = ${input.name}, rate_pcm = ${input.pcm}, updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND id = ${input.rateId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.tax_rate_updated",
      targetType: "gym_tax_rate",
      targetId: input.rateId,
      meta: { before: before.name, after: input.name, pcmBefore: String(before.pcm), pcmAfter: String(input.pcm) },
    });
    return { kind: "ok" };
  });
}

/** Removes a rate nothing live charges. What is archived or over loses it (the foreign keys
 *  clear it); every sale and bill made with it keeps its name and percentage. */
export async function removeRate(sql: Sql, input: { gymId: string; rateId: string; today: string; actorUserId: string }): Promise<RateWriteOutcome> {
  return await sql.begin(async (tx): Promise<RateWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const rate = (await readRates(tx, input.gymId, input.today)).find((r) => r.id === input.rateId);
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
      meta: { name: rate.name, pcm: String(rate.pcm) },
    });
    return { kind: "ok" };
  });
}

export type ChargeOutcome =
  | RateWriteOutcome
  /** An id on the list is not one of this gym's live types or products. */
  | { kind: "items_not_found" }
  /** A type on the list is priced too high to tax (`TAXED_PRICE_MINOR_MAX`). */
  | { kind: "too_high"; name: string }
  /** A type on the list is free, and opens no bill to tax. */
  | { kind: "free"; name: string };

/** WHAT CHARGES ONE RATE, in one press: every live type (or product) on the list charges
 *  it; one off the list that charged it no longer does. A type charges one rate, so one on the
 *  list leaves the rate it had; a product keeps its other rates (18b-v-a), and one whose rates
 *  would come to more than 30% in all refuses the press. Memberships people already hold keep
 *  the rate they were sold with. Each row changed is stamped, so a form opened on it before
 *  is refused rather than saved over this. */
export async function chargeRate(
  sql: Sql,
  input: { gymId: string; rateId: string; use: "memberships" | "products"; ids: readonly string[]; actorUserId: string; now: Date },
): Promise<ChargeOutcome> {
  return await sql.begin(async (tx): Promise<ChargeOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const rate = await rateOf(tx, input.gymId, input.rateId);
    if (rate === null) return { kind: "not_found" };
    const ids = [...new Set(input.ids)];
    const table = input.use === "memberships" ? tx`gym_membership_types` : tx`gym_products`;
    const listed = await tx<{ id: string; name: string; price_minor: number }[]>`
      SELECT id, name, price_minor FROM ${table}
      WHERE gym_id = ${input.gymId} AND archived_at IS NULL AND id = ANY(${ids}::uuid[])`;
    if (listed.length !== ids.length) return { kind: "items_not_found" };
    if (input.use === "memberships") {
      const high = listed.find((row) => row.price_minor > TAXED_PRICE_MINOR_MAX);
      if (high !== undefined) return { kind: "too_high", name: high.name };
      // A free membership opens no bill: it charges no tax.
      const free = listed.find((row) => row.price_minor === 0);
      if (free !== undefined) return { kind: "free", name: free.name };
    }
    const charged = input.use === "memberships" ? await chargeTypes(tx, input, ids) : await chargeProducts(tx, input, rate.pcm, ids);
    if ("over" in charged) return { kind: "taxes_over_cap", product: charged.over };
    const { on, off } = charged;
    if (on.length > 0 || off.length > 0) {
      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.tax_rate_charged_on",
        targetType: "gym_tax_rate",
        targetId: input.rateId,
        meta: { name: rate.name, use: input.use, now: String(ids.length), added: String(on.length), taken: String(off.length) },
      });
    }
    return { kind: "ok" };
  });
}

type Charging = { gymId: string; rateId: string; now: Date };

/** A type charges one rate: on the list, this one in place of any other; off it, none. */
async function chargeTypes(tx: TransactionSql, input: Charging, ids: readonly string[]): Promise<{ on: { id: string }[]; off: { id: string }[] }> {
  const on = await tx<{ id: string }[]>`
    UPDATE gym_membership_types SET tax_rate_id = ${input.rateId}, updated_at = ${input.now}
    WHERE gym_id = ${input.gymId} AND archived_at IS NULL AND id = ANY(${ids}::uuid[])
      AND tax_rate_id IS DISTINCT FROM ${input.rateId}::uuid
    RETURNING id`;
  const off = await tx<{ id: string }[]>`
    UPDATE gym_membership_types SET tax_rate_id = NULL, updated_at = ${input.now}
    WHERE gym_id = ${input.gymId} AND archived_at IS NULL AND tax_rate_id = ${input.rateId}
      AND NOT (id = ANY(${ids}::uuid[]))
    RETURNING id`;
  return { on, off };
}

/** A product charges as many rates as it needs (18b-v-a): on the list, this one as well, after its
 *  others; off it, not this one. Refused, with the product's name, where one on the list
 *  would charge more than 30% in all. */
async function chargeProducts(
  tx: TransactionSql,
  input: Charging,
  pcm: number,
  ids: readonly string[],
): Promise<{ on: { id: string }[]; off: { id: string }[] } | { over: string }> {
  const over = await productOverCap(tx, input.gymId, input.rateId, pcm, ids);
  if (over !== null) return { over };
  const on = await tx<{ id: string }[]>`
    INSERT INTO gym_product_tax_rates (gym_id, product_id, tax_rate_id, position)
    SELECT p.gym_id, p.id, ${input.rateId},
           COALESCE((SELECT max(x.position) FROM gym_product_tax_rates x WHERE x.gym_id = p.gym_id AND x.product_id = p.id), 0) + 1
    FROM gym_products p
    WHERE p.gym_id = ${input.gymId} AND p.archived_at IS NULL AND p.id = ANY(${ids}::uuid[])
    ON CONFLICT (product_id, tax_rate_id) DO NOTHING
    RETURNING product_id AS id`;
  const off = await tx<{ id: string }[]>`
    DELETE FROM gym_product_tax_rates x
    USING gym_products p
    WHERE x.gym_id = ${input.gymId} AND x.tax_rate_id = ${input.rateId}
      AND p.gym_id = x.gym_id AND p.id = x.product_id AND p.archived_at IS NULL
      AND NOT (x.product_id = ANY(${ids}::uuid[]))
    RETURNING x.product_id AS id`;
  const changed = [...on, ...off].map((r) => r.id);
  if (changed.length > 0) {
    await tx`UPDATE gym_products SET updated_at = ${input.now} WHERE gym_id = ${input.gymId} AND id = ANY(${changed}::uuid[])`;
  }
  return { on, off };
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
