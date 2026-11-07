// WHAT A GYM SELLS IN THE APP: THE READ (ROADMAP 18k-i). The live lines of one gym's price list ticked "Sell in the
// app", with each one's tax rates as they are now. Every read names the gym.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { MEMBERSHIP_TYPES_MAX, contractThenSchema, membershipKindSchema, membershipTermUnitSchema, type ForSaleType, type HeldTax } from "@app/shared";
import { ratesOfJson, typeTaxesSql } from "../memberships/taxesSql.js";

// Parsed, not cast: `kind`, the units and `contract_then` are text columns under a CHECK.
const rowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  kind: membershipKindSchema,
  price_minor: z.number().int(),
  currency: z.string(),
  term_count: z.number().int().nullable(),
  term_unit: membershipTermUnitSchema.nullable(),
  pack_classes: z.number().int().nullable(),
  pack_days: z.number().int().nullable(),
  joining_fee_minor: z.number().int(),
  contract_periods: z.number().int().nullable(),
  contract_then: contractThenSchema.nullable(),
  notice_days: z.number().int().nullable(),
  leave_fee_minor: z.number().int().nullable(),
  cooling_off_days: z.number().int().nullable(),
  taxes: z.unknown(),
});

const LINE = (sql: Sql | TransactionSql) => sql`
    t.id, t.name, t.description, t.kind, t.price_minor, t.currency, t.term_count, t.term_unit, t.pack_classes, t.pack_days,
    t.joining_fee_minor, t.contract_periods, t.contract_then, t.notice_days, t.leave_fee_minor, t.cooling_off_days,
    ${typeTaxesSql(sql)} AS taxes`;

/** The gym's live lines sold in the app, by name, each with its rates in its own order. At most the price list's cap. */
export async function soldInApp(sql: Sql, gymId: string): Promise<{ type: ForSaleType; taxes: HeldTax[] }[]> {
  const rows = await sql`
    SELECT ${LINE(sql)}
    FROM gym_membership_types t
    WHERE t.gym_id = ${gymId} AND t.sold_in_app AND t.archived_at IS NULL
    ORDER BY lower(t.name), t.id
    LIMIT ${MEMBERSHIP_TYPES_MAX}`;
  return rows.map(lineOf);
}

/** One live line sold in the app, as the list reads it, for buying it (18k-iii-a); null where it is not one. */
export async function soldInAppLine(sql: Sql | TransactionSql, gymId: string, typeId: string): Promise<{ type: ForSaleType; taxes: HeldTax[] } | null> {
  const [row] = await sql`
    SELECT ${LINE(sql)} FROM gym_membership_types t
    WHERE t.gym_id = ${gymId} AND t.id = ${typeId} AND t.sold_in_app AND t.archived_at IS NULL`;
  return row === undefined ? null : lineOf(row);
}

function lineOf(raw: unknown): { type: ForSaleType; taxes: HeldTax[] } {
  const r = rowSchema.parse(raw);
    return {
      type: {
        id: r.id,
        name: r.name,
        description: r.description,
        kind: r.kind,
        priceMinor: r.price_minor,
        currency: r.currency,
        termCount: r.term_count,
        termUnit: r.term_unit,
        packClasses: r.pack_classes,
        packDays: r.pack_days,
        joiningFeeMinor: r.joining_fee_minor,
        contractPeriods: r.contract_periods,
        contractThen: r.contract_then,
        noticeDays: r.notice_days,
        leaveFeeMinor: r.leave_fee_minor,
        coolingOffDays: r.cooling_off_days,
      },
      taxes: ratesOfJson(r.taxes),
    };
}
