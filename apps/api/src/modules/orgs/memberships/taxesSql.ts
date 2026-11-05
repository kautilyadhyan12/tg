// The taxes of a membership type, a held membership and a bill (spec Part 3 §14.3; ROADMAP
// 18b-v-b): the rates each charges, in order, and each tax a bill was opened with. Every read
// carries the row's own `gym_id` into the rates it joins.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { billAmounts, heldTaxesSchema, SALES_TAX_PCM_MAX, TAX_RATES_MAX, type BillTax, type HeldTax, type TaxApplied } from "@app/shared";

/** A held membership's rates, as each is now, in the order it was sold with: a jsonb list of
 *  `{ name, pcm }`, in a statement that names the membership `h`. */
export const heldTaxesSql = (sql: Sql | TransactionSql) => sql`
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', r.name, 'pcm', r.rate_pcm) ORDER BY x.position), '[]'::jsonb)
   FROM gym_held_membership_tax_rates x
   JOIN gym_tax_rates r ON r.gym_id = x.gym_id AND r.id = x.tax_rate_id
   WHERE x.gym_id = h.gym_id AND x.held_membership_id = h.id)`;

/** A type's rates, as each is now, in the order picked, in a statement that names the type `t`. */
export const typeTaxesSql = (sql: Sql | TransactionSql) => sql`
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', r.name, 'pcm', r.rate_pcm) ORDER BY x.position), '[]'::jsonb)
   FROM gym_membership_type_tax_rates x
   JOIN gym_tax_rates r ON r.gym_id = x.gym_id AND r.id = x.tax_rate_id
   WHERE x.gym_id = t.gym_id AND x.membership_type_id = t.id)`;

/** A type's rate ids, in the order picked, in a statement that names the type `t`. */
export const typeTaxRateIdsSql = (sql: Sql | TransactionSql) => sql`
  (SELECT COALESCE(array_agg(x.tax_rate_id::text ORDER BY x.position), '{}'::text[])
   FROM gym_membership_type_tax_rates x
   WHERE x.gym_id = t.gym_id AND x.membership_type_id = t.id)`;

/** The rates the memberships named keep (18b-v-b): the gym's rates given, in that order. Run in
 *  the transaction that wrote them, under the gym's lock; nothing where there are none. */
export async function keepHeldRates(tx: TransactionSql, gymId: string, heldIds: readonly string[], rateIds: readonly string[]): Promise<void> {
  if (heldIds.length === 0 || rateIds.length === 0) return;
  await tx`
    INSERT INTO gym_held_membership_tax_rates (gym_id, held_membership_id, tax_rate_id, position)
    SELECT ${gymId}, h.id, r.id, r.position
    FROM unnest(${heldIds}::uuid[]) AS h(id)
    CROSS JOIN unnest(${rateIds}::uuid[]) WITH ORDINALITY AS r(id, position)`;
}

/** Rates read back from `heldTaxesSql` or `typeTaxesSql`: parsed, as a column of built JSON. */
export const ratesOfJson = (value: unknown): HeldTax[] => heldTaxesSchema.parse(value);

/** The taxes a bill of a membership is opened with: its rates and whether its price held them;
 *  null for none. */
export function appliedOf(rates: readonly HeldTax[], included: boolean): TaxApplied | null {
  return rates.length === 0 ? null : { rates, included };
}

/** WHAT ONE BILL IS OPENED AT: its price after any discount (`listedMinor`), with the taxes of
 *  the rates its membership was sold with, by the one rule (`billAmounts`): each tax on the
 *  price on its own, and where the price holds them, the parts adding up to the tax inside. A
 *  taxed price is capped where it is set (`TAXED_PRICE_MINOR_MAX`), and the rates together at
 *  30% wherever they are set or raised, so a bill that does not fit is a fault, never a bill. */
export function billOf(listedMinor: number, tax: TaxApplied | null): { amountMinor: number; taxes: BillTax[] } {
  const amounts = billAmounts(listedMinor, tax);
  if (!amounts.ok) throw new Error(`a bill could not be worked out: ${amounts.reason}`);
  if (tax === null) return { amountMinor: amounts.totalMinor, taxes: [] };
  const taxes = tax.rates.map((r, i) => ({ name: r.name, pcm: r.pcm, included: tax.included, minor: amounts.taxParts[i] ?? 0 }));
  return { amountMinor: amounts.totalMinor, taxes };
}

/** A bill's taxes as its columns keep them: the whole tax and the rates added up, whether the
 *  price held them, and each one by name (`taxes`). */
export function taxColumns(taxes: readonly BillTax[]): { tm: number; tb: number; ti: boolean | null; tx: { name: string; pcm: number; minor: number }[] } {
  return {
    tm: taxes.reduce((n, t) => n + t.minor, 0),
    tb: taxes.reduce((n, t) => n + t.pcm, 0),
    ti: taxes[0]?.included ?? null,
    tx: taxes.map((t) => ({ name: t.name, pcm: t.pcm, minor: t.minor })),
  };
}

const keptTaxesSchema = z
  .array(z.object({ name: z.string(), pcm: z.number().int().min(1).max(SALES_TAX_PCM_MAX), minor: z.number().int().min(0) }).strict())
  .max(TAX_RATES_MAX);

/** A bill's taxes read back from its columns: parsed, as a column of kept JSON. */
export function keptTaxes(r: { taxes: unknown; tax_included: boolean | null }): BillTax[] {
  const included = r.tax_included;
  if (included === null) return [];
  return keptTaxesSchema.parse(r.taxes).map((t) => ({ ...t, included }));
}
