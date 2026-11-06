// A gym's membership types: the only file that reads or writes them (spec Part 3
// §13.1; ROADMAP 17a-i).
//
// Every statement carries `gym_id` in its WHERE, the ones holding a type's id
// included: the pair is the key, never the id alone. Every write takes the gym's
// row lock first, so the cap, the name check and the classes a type covers are
// decided against a list nobody else is changing.
import type { Sql, TransactionSql } from "postgres";
import { MEMBERSHIP_ARCHIVED_PAGE, MEMBERSHIP_TYPES_MAX, SALES_TAX_PCM_MAX, memberCurrencyForCountry } from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { ratesOf, readRates, taxIncludedOf } from "../register/taxRepo.js";
import { typeTaxRateIdsSql } from "./taxesSql.js";

export interface MembershipTypeRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  priceMinor: number;
  currency: string;
  termCount: number | null;
  termUnit: string | null;
  packClasses: number | null;
  packDays: number | null;
  access: string;
  bookingsLimit: number | null;
  bookingsPeriod: string | null;
  /** null: every class. */
  classTypes: { id: string; name: string }[] | null;
  includesPt: boolean;
  ptLimit: number | null;
  ptPeriod: string | null;
  /** The gym's rates its bills charge, in the order picked (18b-v-b); empty for none. */
  taxRateIds: string[];
  /** Charged on the first bill of a membership given from it (18t); 0 for none. */
  joiningFeeMinor: number;
  /** The business's other agreement it is signed with (18u-ii-a); null for the main one. */
  agreementId: string | null;
  /** Its contract (18v-i): so many payments, then it renews or ends; both null for none. */
  contractPeriods: number | null;
  contractThen: string | null;
  /** Its notice to cancel in days (18v-ii-a); null for none. */
  noticeDays: number | null;
  /** Its minimum term's early cancellation fee (18v-ii-b); null for none. */
  leaveFeeMinor: number | null;
  /** Its cooling-off period in days (18v-iii); null for none. */
  coolingOffDays: number | null;
  /** Its renewal reminder (18v-iv); null for none. */
  renewalReminderDays: number | null;
  termReminderDays: number | null;
  /** Members may buy it in the app (18k-i). */
  soldInApp: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface PriceListRow {
  country: string | null;
  types: MembershipTypeRow[];
  archived: MembershipTypeRow[];
  archivedTotal: number;
  classChoices: { id: string; name: string }[];
  /** The gym's tax rates, for a type's "Tax" (18b-iii), and whether its prices hold the tax. */
  taxRates: { id: string; name: string; pcm: number }[];
  taxIncluded: boolean;
  /** The day of the month the gym bills everyone on (18y), for Add member's total; null for none. */
  billDay: number | null;
  /** The business's other agreements, by name, and whether each is asked for (18u-ii-a). */
  agreements: { id: string; name: string; inUse: boolean }[];
  /** Its default agreement: never written, turned off, or in use. */
  defaultAgreement: "none" | "off" | "in_use";
}

interface RawType {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  price_minor: number;
  currency: string;
  term_count: number | null;
  term_unit: string | null;
  pack_classes: number | null;
  pack_days: number | null;
  access: string;
  bookings_limit: number | null;
  bookings_period: string | null;
  covers_all_classes: boolean;
  includes_pt: boolean;
  pt_limit: number | null;
  pt_period: string | null;
  tax_rate_ids: string[];
  joining_fee_minor: number;
  agreement_document_id: string | null;
  contract_periods: number | null;
  contract_then: string | null;
  notice_days: number | null;
  leave_fee_minor: number | null;
  cooling_off_days: number | null;
  renewal_reminder_days: number | null;
  term_reminder_days: number | null;
  sold_in_app: boolean;
  archived_at: Date | null;
  updated_at: Date;
}

/** The whole price list, or null where the gym does not exist. The live list is
 *  bounded by the cap the writes enforce; the archived list is a page, newest
 *  first, with the gym's real count beside it. */
export async function readPriceList(sql: Sql, gymId: string): Promise<PriceListRow | null> {
  const readTypes = (archived: boolean, limit: number) => sql<RawType[]>`
    SELECT id, name, description, kind, price_minor, currency, term_count, term_unit,
           pack_classes, pack_days, access, bookings_limit, bookings_period,
           covers_all_classes, includes_pt, pt_limit, pt_period, ${typeTaxRateIdsSql(sql)} AS tax_rate_ids, joining_fee_minor, agreement_document_id,
           contract_periods, contract_then, notice_days, leave_fee_minor, cooling_off_days,
           renewal_reminder_days, term_reminder_days, sold_in_app, archived_at, updated_at
    FROM gym_membership_types t
    WHERE gym_id = ${gymId} AND (archived_at IS NOT NULL) = ${archived}
    ORDER BY ${archived ? sql`archived_at DESC, id` : sql`lower(name), id`}
    LIMIT ${limit}`;

  const [gymRows, live, archived, totals, covered, classChoices, rates, taxIncluded, agreements] = await Promise.all([
    sql<{ country: string | null; bills_day: number | null }[]>`SELECT country, bills_day FROM gyms WHERE id = ${gymId}`,
    readTypes(false, MEMBERSHIP_TYPES_MAX),
    readTypes(true, MEMBERSHIP_ARCHIVED_PAGE),
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_membership_types
      WHERE gym_id = ${gymId} AND archived_at IS NOT NULL`,
    sql<{ membership_type_id: string; id: string; name: string }[]>`
      SELECT c.membership_type_id, t.id, t.name
      FROM gym_membership_type_classes c
      JOIN gym_class_types t ON t.id = c.class_type_id AND t.gym_id = c.gym_id
      WHERE c.gym_id = ${gymId}
      ORDER BY lower(t.name), t.id`,
    sql<{ id: string; name: string }[]>`
      SELECT id, name FROM gym_class_types
      WHERE gym_id = ${gymId} AND archived_at IS NULL
      ORDER BY lower(name), id`,
    readRates(sql, gymId, null),
    taxIncludedOf(sql, gymId),
    sql<{ id: string; name: string | null; in_use: boolean | null }[]>`
      SELECT d.id, d.name,
             (SELECT a.stopped_at IS NULL FROM gym_agreements a WHERE a.gym_id = d.gym_id AND a.document_id = d.id ORDER BY a.version DESC LIMIT 1) AS in_use
      FROM gym_agreement_documents d
      WHERE d.gym_id = ${gymId}
      ORDER BY d.name IS NOT NULL, lower(d.name), d.id`,
  ]);
  const gym = gymRows[0];
  if (gym === undefined || taxIncluded === null) return null;

  const coveredByType = new Map<string, { id: string; name: string }[]>();
  for (const row of covered) {
    const list = coveredByType.get(row.membership_type_id) ?? [];
    list.push({ id: row.id, name: row.name });
    coveredByType.set(row.membership_type_id, list);
  }
  const shape = (r: RawType): MembershipTypeRow => ({
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
    access: r.access,
    bookingsLimit: r.bookings_limit,
    bookingsPeriod: r.bookings_period,
    classTypes: r.covers_all_classes ? null : (coveredByType.get(r.id) ?? []),
    includesPt: r.includes_pt,
    ptLimit: r.pt_limit,
    ptPeriod: r.pt_period,
    taxRateIds: r.tax_rate_ids,
    joiningFeeMinor: r.joining_fee_minor,
    agreementId: r.agreement_document_id,
    contractPeriods: r.contract_periods,
    contractThen: r.contract_then,
    noticeDays: r.notice_days,
    leaveFeeMinor: r.leave_fee_minor,
    coolingOffDays: r.cooling_off_days,
    renewalReminderDays: r.renewal_reminder_days,
    termReminderDays: r.term_reminder_days,
    soldInApp: r.sold_in_app,
    archivedAt: r.archived_at,
    updatedAt: r.updated_at,
  });
  return {
    country: gym.country,
    types: live.map(shape),
    archived: archived.map(shape),
    archivedTotal: totals[0]?.n ?? 0,
    classChoices: classChoices.map((c) => ({ id: c.id, name: c.name })),
    taxRates: rates.map((r) => ({ id: r.id, name: r.name, pcm: r.pcm })),
    taxIncluded,
    billDay: gym.bills_day,
    agreements: agreements.flatMap((a) => (a.name === null ? [] : [{ id: a.id, name: a.name, inUse: a.in_use === true }])),
    defaultAgreement: ((main) => (main === undefined || main.in_use === null ? "none" : main.in_use ? "in_use" : "off"))(agreements.find((a) => a.name === null)),
  };
}

export interface MembershipTypeInput {
  name: string;
  description: string | null;
  kind: string;
  priceMinor: number;
  termCount: number | null;
  termUnit: string | null;
  packClasses: number | null;
  packDays: number | null;
  access: string;
  bookingsLimit: number | null;
  bookingsPeriod: string | null;
  /** null: every class. */
  classTypeIds: string[] | null;
  includesPt: boolean;
  /** How many personal training sessions a week or a month; both null: no limit. */
  ptLimit: number | null;
  ptPeriod: string | null;
  /** The gym's tax rates its bills charge, in order; empty for none. */
  taxRateIds: string[];
  /** Charged on the first bill of a membership given from it; 0 for none. */
  joiningFeeMinor: number;
  /** Its contract (18v-i); both null for none. */
  contractPeriods: number | null;
  contractThen: string | null;
  /** Its notice to cancel in days (18v-ii-a); null for none. */
  noticeDays: number | null;
  /** Its minimum term's early cancellation fee (18v-ii-b); null for none. */
  leaveFeeMinor: number | null;
  /** Its cooling-off period in days (18v-iii); null for none. */
  coolingOffDays: number | null;
  /** Its renewal reminder (18v-iv); null for none. */
  renewalReminderDays: number | null;
  termReminderDays: number | null;
  /** Members may buy it in the app (18k-i). */
  soldInApp: boolean;
}

export type MembershipWriteOutcome =
  /** `raised`: the members already on it whose price was raised with it (18w). */
  | { kind: "ok"; raised?: number }
  /** A raise for members already on it, where the price does not go up or the line does not repeat (18w). */
  | { kind: "raise_not_allowed" }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "name_taken" }
  /** A class named in `classTypeIds` is not one of this gym's. */
  | { kind: "class_not_in_gym" }
  /** An update tried to change the type's kind. */
  | { kind: "kind_fixed" }
  /** The type was changed after the form that sent this update read it. */
  | { kind: "changed" }
  /** The gym's country has no money to price in. */
  | { kind: "no_currency" }
  /** A tax rate named is not one of this gym's. */
  | { kind: "rate_not_found" }
  /** Its rates would come to more than 30% together (18b-v-b). */
  | { kind: "taxes_over_cap" };

/** The rates a type is saved with are this gym's, and come to 30% at most together (18b-v-b),
 *  read under the gym's lock that a rate's change takes. */
async function checkTypeRates(tx: TransactionSql, gymId: string, rateIds: readonly string[]): Promise<MembershipWriteOutcome | null> {
  const rates = await ratesOf(tx, gymId, rateIds);
  if (rates === null) return { kind: "rate_not_found" };
  if (rates.reduce((n, r) => n + r.pcm, 0) > SALES_TAX_PCM_MAX) return { kind: "taxes_over_cap" };
  return null;
}

/** A type's rates, replaced by these in this order. Memberships already given keep their own. */
async function writeTypeRates(tx: TransactionSql, gymId: string, typeId: string, rateIds: readonly string[]): Promise<void> {
  await tx`DELETE FROM gym_membership_type_tax_rates WHERE gym_id = ${gymId} AND membership_type_id = ${typeId}`;
  if (rateIds.length === 0) return;
  await tx`
    INSERT INTO gym_membership_type_tax_rates (gym_id, membership_type_id, tax_rate_id, position)
    SELECT ${gymId}, ${typeId}, r.id, r.n
    FROM unnest(${rateIds}::uuid[]) WITH ORDINALITY AS r(id, n)`;
}

/** A type put back on the price list charges at most 30% in all (18b-v-b), as a product put back
 *  on sale does: a rate may have been raised while it was archived, and nobody could then be given
 *  it. Its last rates are taken off until it fits; their names, for the gym's record. */
async function takeTypeRatesOverCap(tx: TransactionSql, gymId: string, typeId: string): Promise<string[]> {
  const rates = await tx<{ tax_rate_id: string; name: string; rate_pcm: number }[]>`
    SELECT x.tax_rate_id, r.name, r.rate_pcm
    FROM gym_membership_type_tax_rates x
    JOIN gym_tax_rates r ON r.gym_id = x.gym_id AND r.id = x.tax_rate_id
    WHERE x.gym_id = ${gymId} AND x.membership_type_id = ${typeId}
    ORDER BY x.position, x.tax_rate_id`;
  let together = rates.reduce((n, r) => n + r.rate_pcm, 0);
  const off: { id: string; name: string }[] = [];
  for (const rate of [...rates].reverse()) {
    if (together <= SALES_TAX_PCM_MAX) break;
    together -= rate.rate_pcm;
    off.push({ id: rate.tax_rate_id, name: rate.name });
  }
  if (off.length > 0) {
    await tx`
      DELETE FROM gym_membership_type_tax_rates
      WHERE gym_id = ${gymId} AND membership_type_id = ${typeId} AND tax_rate_id = ANY(${off.map((r) => r.id)}::uuid[])`;
  }
  return off.map((r) => r.name);
}

async function liveCount(tx: TransactionSql, gymId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL`;
  return row?.n ?? 0;
}

/** Is a live type of this name already on the gym's list, other than `exceptId`? */
async function nameTaken(
  tx: TransactionSql,
  gymId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL AND lower(name) = lower(${name})
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1`;
  return rows.length > 0;
}

/** Every class named is this gym's own. Archived classes count: a type may go on
 *  covering a class the gym has since stopped running. */
async function classesAreThisGyms(tx: TransactionSql, gymId: string, ids: string[] | null): Promise<boolean> {
  if (ids === null) return true;
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_class_types
    WHERE gym_id = ${gymId} AND id = ANY(${ids}::uuid[])`;
  return (row?.n ?? 0) === ids.length;
}

async function writeCoveredClasses(
  tx: TransactionSql,
  gymId: string,
  typeId: string,
  ids: string[] | null,
): Promise<void> {
  await tx`
    DELETE FROM gym_membership_type_classes
    WHERE membership_type_id = ${typeId} AND gym_id = ${gymId}`;
  if (ids === null) return;
  await tx`
    INSERT INTO gym_membership_type_classes (membership_type_id, class_type_id, gym_id)
    SELECT ${typeId}, id, ${gymId} FROM gym_class_types
    WHERE gym_id = ${gymId} AND id = ANY(${ids}::uuid[])`;
}

export async function createMembershipType(
  sql: Sql,
  input: MembershipTypeInput & { gymId: string; actorUserId: string },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    // The country is read under the lock: a type is stamped with the money of the
    // country the gym is in when the type is made, not a moment before.
    const [gym] = await tx<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${input.gymId}`;
    if (gym === undefined) return { kind: "not_found" };
    const currency = memberCurrencyForCountry(gym.country);
    if (currency === null) return { kind: "no_currency" };
    if ((await liveCount(tx, input.gymId)) >= MEMBERSHIP_TYPES_MAX) {
      return { kind: "too_many", cap: MEMBERSHIP_TYPES_MAX };
    }
    if (await nameTaken(tx, input.gymId, input.name, null)) return { kind: "name_taken" };
    if (!(await classesAreThisGyms(tx, input.gymId, input.classTypeIds))) {
      return { kind: "class_not_in_gym" };
    }
    const ratesWrong = await checkTypeRates(tx, input.gymId, input.taxRateIds);
    if (ratesWrong !== null) return ratesWrong;

    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, description, kind, price_minor, currency, term_count, term_unit,
         pack_classes, pack_days, access, bookings_limit, bookings_period, covers_all_classes, includes_pt,
         pt_limit, pt_period, joining_fee_minor, contract_periods, contract_then, notice_days, leave_fee_minor, cooling_off_days,
         renewal_reminder_days, term_reminder_days, sold_in_app)
      VALUES (${input.gymId}, ${input.name}, ${input.description}, ${input.kind}, ${input.priceMinor},
              ${currency}, ${input.termCount}, ${input.termUnit}, ${input.packClasses},
              ${input.packDays}, ${input.access}, ${input.bookingsLimit}, ${input.bookingsPeriod},
              ${input.classTypeIds === null}, ${input.includesPt}, ${input.ptLimit}, ${input.ptPeriod}, ${input.joiningFeeMinor},
              ${input.contractPeriods}, ${input.contractThen}, ${input.noticeDays}, ${input.leaveFeeMinor}, ${input.coolingOffDays},
              ${input.renewalReminderDays}, ${input.termReminderDays}, ${input.soldInApp})
      RETURNING id`;
    if (created === undefined) throw new Error("membership type insert returned no row");
    await writeCoveredClasses(tx, input.gymId, created.id, input.classTypeIds);
    await writeTypeRates(tx, input.gymId, created.id, input.taxRateIds);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_created",
      targetType: "gym_membership_type",
      targetId: created.id,
      meta: {
        name: input.name,
        kind: input.kind,
        priceMinor: String(input.priceMinor),
        currency,
        ...(input.joiningFeeMinor > 0 ? { joiningFeeMinor: String(input.joiningFeeMinor) } : {}),
        ...(input.contractPeriods === null || input.contractThen === null ? {} : { contractPeriods: String(input.contractPeriods), contractThen: input.contractThen }),
        ...(input.noticeDays === null ? {} : { noticeDays: String(input.noticeDays) }),
        ...(input.leaveFeeMinor === null ? {} : { leaveFeeMinor: String(input.leaveFeeMinor) }),
        ...(input.coolingOffDays === null ? {} : { coolingOffDays: String(input.coolingOffDays) }),
        ...(input.renewalReminderDays === null && input.termReminderDays === null ? {} : { renewalReminder: reminderWords(input.renewalReminderDays, input.termReminderDays) }),
        ...(input.soldInApp ? { soldInApp: "true" } : {}),
      },
    });
    return { kind: "ok" };
  });
}

/** Replace a live type's fields. Its kind and its currency never change: people
 *  will hold it (17a-ii), and a monthly membership that became a pack, or a
 *  price that changed money, would rewrite what they were sold. */
export async function updateMembershipType(
  sql: Sql,
  input: MembershipTypeInput & {
    gymId: string;
    typeId: string;
    /** The type's `updatedAt` as the sender's form read it. */
    readAt: Date;
    actorUserId: string;
    now: Date;
    /** Raise members already on it to the new price (18w), written in this same change: answers how many. */
    raise?: ((tx: TransactionSql) => Promise<number>) | null;
  },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<
      { name: string; kind: string; price_minor: number; joining_fee_minor: number; contract_periods: number | null; contract_then: string | null; notice_days: number | null; leave_fee_minor: number | null; cooling_off_days: number | null; renewal_reminder_days: number | null; term_reminder_days: number | null; sold_in_app: boolean; updated_at: Date }[]
    >`
      SELECT name, kind, price_minor, joining_fee_minor, contract_periods, contract_then, notice_days, leave_fee_minor, cooling_off_days, renewal_reminder_days, term_reminder_days, sold_in_app, updated_at FROM gym_membership_types
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    // To the millisecond, which is what the list sends and a form can send back.
    if (before.updated_at.getTime() !== input.readAt.getTime()) return { kind: "changed" };
    if (before.kind !== input.kind) return { kind: "kind_fixed" };
    const raise = input.raise ?? null;
    if (raise !== null && (before.kind !== "recurring" || input.priceMinor <= before.price_minor)) return { kind: "raise_not_allowed" };
    if (await nameTaken(tx, input.gymId, input.name, input.typeId)) return { kind: "name_taken" };
    if (!(await classesAreThisGyms(tx, input.gymId, input.classTypeIds))) {
      return { kind: "class_not_in_gym" };
    }
    const ratesWrong = await checkTypeRates(tx, input.gymId, input.taxRateIds);
    if (ratesWrong !== null) return ratesWrong;

    await tx`
      UPDATE gym_membership_types
      SET name = ${input.name}, description = ${input.description}, price_minor = ${input.priceMinor},
          term_count = ${input.termCount}, term_unit = ${input.termUnit},
          pack_classes = ${input.packClasses}, pack_days = ${input.packDays},
          access = ${input.access}, bookings_limit = ${input.bookingsLimit},
          bookings_period = ${input.bookingsPeriod},
          covers_all_classes = ${input.classTypeIds === null}, includes_pt = ${input.includesPt},
          pt_limit = ${input.ptLimit}, pt_period = ${input.ptPeriod},
          joining_fee_minor = ${input.joiningFeeMinor},
          contract_periods = ${input.contractPeriods}, contract_then = ${input.contractThen},
          notice_days = ${input.noticeDays}, leave_fee_minor = ${input.leaveFeeMinor}, cooling_off_days = ${input.coolingOffDays},
          renewal_reminder_days = ${input.renewalReminderDays}, term_reminder_days = ${input.termReminderDays}, sold_in_app = ${input.soldInApp}, updated_at = ${input.now}
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId}`;
    await writeCoveredClasses(tx, input.gymId, input.typeId, input.classTypeIds);
    await writeTypeRates(tx, input.gymId, input.typeId, input.taxRateIds);
    const raised = raise === null ? null : await raise(tx);
    const reminderBefore = reminderWords(before.renewal_reminder_days, before.term_reminder_days);
    const reminderAfter = reminderWords(input.renewalReminderDays, input.termReminderDays);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_updated",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: {
        before: before.name,
        after: input.name,
        priceBefore: String(before.price_minor),
        priceAfter: String(input.priceMinor),
        ...(raised === null ? {} : { membersRaised: String(raised) }),
        ...(before.joining_fee_minor === input.joiningFeeMinor
          ? {}
          : { joiningFeeBefore: String(before.joining_fee_minor), joiningFeeAfter: String(input.joiningFeeMinor) }),
        ...(before.contract_periods === input.contractPeriods && before.contract_then === input.contractThen
          ? {}
          : { contractBefore: before.contract_periods === null ? "none" : `${String(before.contract_periods)} ${before.contract_then ?? ""}`, contractAfter: input.contractPeriods === null ? "none" : `${String(input.contractPeriods)} ${input.contractThen ?? ""}` }),
        ...(before.notice_days === input.noticeDays
          ? {}
          : { noticeBefore: before.notice_days === null ? "none" : String(before.notice_days), noticeAfter: input.noticeDays === null ? "none" : String(input.noticeDays) }),
        ...(before.leave_fee_minor === input.leaveFeeMinor
          ? {}
          : { leaveFeeBefore: before.leave_fee_minor === null ? "none" : String(before.leave_fee_minor), leaveFeeAfter: input.leaveFeeMinor === null ? "none" : String(input.leaveFeeMinor) }),
        ...(before.cooling_off_days === input.coolingOffDays
          ? {}
          : {
              coolingOffBefore: before.cooling_off_days === null ? "none" : String(before.cooling_off_days),
              coolingOffAfter: input.coolingOffDays === null ? "none" : String(input.coolingOffDays),
            }),
        ...(reminderBefore === reminderAfter ? {} : { renewalReminderBefore: reminderBefore, renewalReminderAfter: reminderAfter }),
        ...(before.sold_in_app === input.soldInApp ? {} : { soldInAppBefore: String(before.sold_in_app), soldInAppAfter: String(input.soldInApp) }),
      },
    });
    // A changed reminder is looked for again today, so the line's box tells the truth (18v-iv).
    if (reminderBefore !== reminderAfter) await tx`UPDATE gyms SET renewal_reminders_checked_at = NULL WHERE id = ${input.gymId}`;
    return raised === null ? { kind: "ok" } : { kind: "ok", raised };
  });
}

/** "renewal 7, term 30", "renewal none, term none", as Staff activity keeps a line's reminders (18v-iv). */
function reminderWords(renewalDays: number | null, termDays: number | null): string {
  const one = (days: number | null): string => (days === null ? "none" : String(days));
  return `renewal ${one(renewalDays)}, term ${one(termDays)}`;
}

/** Archive: the type leaves the price list and is kept. */
export async function archiveMembershipType(
  sql: Sql,
  input: { gymId: string; typeId: string; actorUserId: string; now: Date },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string }[]>`
      SELECT name FROM gym_membership_types
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    await tx`
      UPDATE gym_membership_types SET archived_at = ${input.now}, updated_at = ${input.now}
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_archived",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}

/** Put an archived type back on the price list. It counts against the cap, and
 *  a live type may have taken its name while it was away. */
export async function restoreMembershipType(
  sql: Sql,
  input: { gymId: string; typeId: string; actorUserId: string; now: Date },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string }[]>`
      SELECT name FROM gym_membership_types
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId} AND archived_at IS NOT NULL`;
    if (before === undefined) return { kind: "not_found" };
    if ((await liveCount(tx, input.gymId)) >= MEMBERSHIP_TYPES_MAX) {
      return { kind: "too_many", cap: MEMBERSHIP_TYPES_MAX };
    }
    if (await nameTaken(tx, input.gymId, before.name, input.typeId)) return { kind: "name_taken" };
    await tx`
      UPDATE gym_membership_types SET archived_at = NULL, updated_at = ${input.now}
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId}`;
    const taken = await takeTypeRatesOverCap(tx, input.gymId, input.typeId);
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_restored",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: { name: before.name, ...(taken.length === 0 ? {} : { taxesTakenOff: taken.join(", ") }) },
    });
    return { kind: "ok" };
  });
}
