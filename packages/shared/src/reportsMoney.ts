// The console's Reports page: the money figures (spec Part 3 §16.5; ROADMAP 21b-i).
//
// Read from the gym's own notebook (§14.2): the memberships it gave here, their bills,
// the payments staff recorded and the refunds they noted. The app holds no money, so a
// gym that records no payment here has no figures and is told why, never shown a zero.
import { z } from "zod";
import { heldMembershipView, type HeldMembership } from "./heldMemberships.js";
import { coversFrom, reportPeriodOf, reportPeriodSchema, yearEarlierFigureSchema, yearEarlierOf, type ReportPeriodKey } from "./reportPeriod.js";
import { churnBasis, type MembersReportFacts } from "./reports.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const countSchema = z.number().int().min(0);
/** Whole minor units of the gym's currency. */
const minorSchema = z.number().int().min(0);
/** Payments less refunds: below zero in a month that gave back more than it took. */
const netSchema = z.number().int();

/** One membership stored in use, of somebody on the gym's list. */
export interface MoneyHeld {
  typeId: string;
  typeName: string;
  priceMinor: number;
  membership: HeldMembership;
}

/** Money in one month for one membership type, as the database added it up. */
export interface MoneyMonthOfType {
  typeId: string;
  typeName: string;
  /** 'YYYY-MM'. */
  month: string;
  /** Payments that stand, by the day they were paid. */
  paidMinor: number;
  /** Refunds that stand, by the day the money was given back. */
  refundedMinor: number;
  /** The part of each that falls on the period's own days. */
  periodPaidMinor: number;
  periodRefundedMinor: number;
}

export interface MoneyReportFacts {
  timezone: string;
  /** The gym's own day today. */
  today: string;
  period: ReportPeriodKey;
  /** The currency of the gym's newest money: its newest payment's, else its newest
   *  membership's, else its country's. Null with none of the three. */
  currency: string | null;
  /** Whether a membership has ever been given here. */
  anyMembership: boolean;
  /** The gym's day of the first payment that stands; null with none. */
  firstPaidOn: string | null;
  /** A payment or a bill owed stands in another currency (the gym's country changed): not counted. */
  otherCurrency: boolean;
  /** How many days after its due date an unpaid bill reads Overdue. */
  overdueAfterDays: number;
  held: readonly MoneyHeld[];
  /** The last twelve months, the month in progress among them; a month with nothing is absent. */
  months: readonly MoneyMonthOfType[];
  /** Bills still open whose day has come, less what is paid on them. */
  owed: {
    currentMinor: number;
    currentPeople: number;
    /** The people on the list the Members page reads as "Payment due": Overview's count. */
    listPeople: number;
    pastMinor: number;
    pastPeople: number;
    overdueMinor: number;
    overduePeople: number;
  };
  /** The list's own counts, for churn: lifetime value divides by it. */
  members: Pick<MembersReportFacts, "today" | "firstListedOn" | "everLeft" | "months">;
  /** Payments and refunds that stand, over the same days a year earlier (`yearEarlierOf`). */
  yearEarlier: { paidMinor: number; refundedMinor: number };
}

const lifetimeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), minor: minorSchema, months: z.array(monthSchema).min(1), leavers: countSchema.min(1) }).strict(),
  /** `nobody_left` here is nobody in the months it is worked out over; `nothing_collected`
   *  is those months giving back as much as they took. */
  z.object({ state: z.enum(["not_enough_data", "nobody_left", "nobody_at_start", "nothing_collected"]) }).strict(),
]);
export type MoneyLifetimeFigure = z.infer<typeof lifetimeSchema>;

const moneyFiguresSchema = z
  .object({
    state: z.literal("ok"),
    timezone: z.string(),
    today: daySchema,
    period: reportPeriodSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    firstPaidOn: daySchema,
    otherCurrency: z.boolean(),
    /** Each repeating membership in use today, its price as one month. */
    recurring: z.object({ monthlyMinor: minorSchema, memberships: countSchema }).strict(),
    thisMonth: z.object({ month: monthSchema, paidMinor: minorSchema, refundedMinor: minorSchema, netMinor: netSchema }).strict(),
    /** Payments that stand less refunds that stand, over the period's days. */
    inPeriod: z.object({ paidMinor: minorSchema, refundedMinor: minorSchema, netMinor: netSchema }).strict(),
    /** The same over the same days a year earlier; no figure where the first payment
     *  recorded here came after they began. */
    yearEarlier: yearEarlierFigureSchema({ paidMinor: minorSchema, refundedMinor: minorSchema, netMinor: netSchema }),
    owed: z
      .object({
        minor: minorSchema,
        /** People on the list with a bill owed here. */
        people: countSchema,
        /** People the Members page also reads as "Payment due" with no bill owed here: the
         *  gym's own file says so, or their bill is not opened yet. No amount is known. */
        listOnlyPeople: countSchema,
        pastMinor: minorSchema,
        pastPeople: countSchema,
        overdueMinor: minorSchema,
        overduePeople: countSchema,
        overdueAfterDays: countSchema,
      })
      .strict(),
    lifetimeValue: lifetimeSchema,
    /** The months the period touches, from the month of the first payment, oldest first, the month in progress last. */
    months: z.array(z.object({ month: monthSchema, paidMinor: minorSchema, refundedMinor: minorSchema, netMinor: netSchema }).strict()).max(12),
    /** A membership the gym sells that is in use, or took or gave back money in the period. */
    types: z.array(
      z
        .object({
          name: z.string(),
          inUse: countSchema,
          monthlyMinor: minorSchema,
          monthNetMinor: netSchema,
          periodNetMinor: netSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const moneyReportSchema = z.discriminatedUnion("state", [
  moneyFiguresSchema,
  /** `no_memberships`: nothing has been given here. `no_payments`: none is recorded. */
  z.object({ state: z.enum(["no_memberships", "no_payments"]), timezone: z.string(), today: daySchema }).strict(),
]);
export type MoneyReport = z.infer<typeof moneyReportSchema>;
export type MoneyFigures = z.infer<typeof moneyFiguresSchema>;

export const moneyReportResponseSchema = z.object({ report: moneyReportSchema }).strict();
export type MoneyReportResponse = z.infer<typeof moneyReportResponseSchema>;

/** A repeating membership's price as one month, to the nearest minor unit: a term of
 *  months or years shared out, a week counted as a twelfth of fifty-two. Null for any
 *  other kind, which is paid once. */
export function monthlyMinorOf(m: Pick<HeldMembership, "kind" | "termCount" | "termUnit">, priceMinor: number): number | null {
  if (m.kind !== "recurring" || m.termCount === null || m.termCount < 1) return null;
  if (m.termUnit === "month") return Math.round(priceMinor / m.termCount);
  if (m.termUnit === "year") return Math.round(priceMinor / (12 * m.termCount));
  if (m.termUnit === "week") return Math.round((priceMinor * 52) / (12 * m.termCount));
  return null;
}

const monthOf = (day: string): string => day.slice(0, 7);

/** The figures from what the notebook holds.
 *
 *  Monthly recurring revenue counts a repeating membership only while it is in use today:
 *  not one that is frozen, not started yet, ended, cancelled or free. Collected is the
 *  payments that stand, each in the month it was paid, less the refunds that stand, each
 *  in the month the money went back. Lifetime value is the money a member brings in a
 *  month over the share of members who leave in a month, both over the same full months
 *  churn is worked out over: that is the money collected in those months for each member
 *  who left in them. It is not given before payments were recorded for the whole of those
 *  months, nor where nobody left in them. Collected and the months and memberships listed
 *  follow the period; what is owed, recurring revenue and lifetime value do not. */
export function moneyReportFrom(facts: MoneyReportFacts): MoneyReport {
  const period = reportPeriodOf(facts.period, facts.today);
  const base = { timezone: facts.timezone, today: facts.today };
  if (facts.currency === null || !facts.anyMembership) return { state: "no_memberships", ...base };
  if (facts.firstPaidOn === null) return { state: "no_payments", ...base };
  const earlier = yearEarlierOf(period);

  const thisMonth = monthOf(facts.today);
  const firstMonth = monthOf(facts.firstPaidOn);

  interface TypeSums {
    name: string;
    inUse: number;
    monthlyMinor: number;
    monthNetMinor: number;
    periodNetMinor: number;
    /** A payment or a refund of it is in the period. */
    moved: boolean;
  }
  const types = new Map<string, TypeSums>();
  const typeOf = (id: string, name: string): TypeSums => {
    const had = types.get(id);
    if (had !== undefined) return had;
    const made = { name, inUse: 0, monthlyMinor: 0, monthNetMinor: 0, periodNetMinor: 0, moved: false };
    types.set(id, made);
    return made;
  };

  let monthlyMinor = 0;
  let memberships = 0;
  for (const h of facts.held) {
    if (heldMembershipView(h.membership, facts.today).status !== "active") continue;
    const type = typeOf(h.typeId, h.typeName);
    type.inUse += 1;
    const monthly = h.membership.free ? null : monthlyMinorOf(h.membership, h.priceMinor);
    if (monthly === null) continue;
    type.monthlyMinor += monthly;
    monthlyMinor += monthly;
    memberships += 1;
  }

  const byMonth = new Map<string, { paidMinor: number; refundedMinor: number }>();
  const inPeriod = { paidMinor: 0, refundedMinor: 0 };
  for (const row of facts.months) {
    if (row.month > thisMonth) continue;
    inPeriod.paidMinor += row.periodPaidMinor;
    inPeriod.refundedMinor += row.periodRefundedMinor;
    const sums = byMonth.get(row.month) ?? { paidMinor: 0, refundedMinor: 0 };
    sums.paidMinor += row.paidMinor;
    sums.refundedMinor += row.refundedMinor;
    byMonth.set(row.month, sums);
    const type = typeOf(row.typeId, row.typeName);
    type.periodNetMinor += row.periodPaidMinor - row.periodRefundedMinor;
    type.moved ||= row.periodPaidMinor > 0 || row.periodRefundedMinor > 0;
    if (row.month === thisMonth) type.monthNetMinor += row.paidMinor - row.refundedMinor;
  }
  const monthSums = (month: string): { month: string; paidMinor: number; refundedMinor: number; netMinor: number } => {
    const sums = byMonth.get(month) ?? { paidMinor: 0, refundedMinor: 0 };
    return { month, ...sums, netMinor: sums.paidMinor - sums.refundedMinor };
  };

  const shown: string[] = [];
  const fromMonth = monthOf(period.from) > firstMonth ? monthOf(period.from) : firstMonth;
  for (let month = thisMonth; shown.length < 12 && month >= fromMonth; month = monthBefore(month)) shown.unshift(month);

  return {
    state: "ok",
    ...base,
    period,
    currency: facts.currency,
    firstPaidOn: facts.firstPaidOn,
    otherCurrency: facts.otherCurrency,
    recurring: { monthlyMinor, memberships },
    thisMonth: monthSums(thisMonth),
    inPeriod: { ...inPeriod, netMinor: inPeriod.paidMinor - inPeriod.refundedMinor },
    yearEarlier: coversFrom(facts.firstPaidOn, earlier.from)
      ? { state: "ok", ...earlier, ...facts.yearEarlier, netMinor: facts.yearEarlier.paidMinor - facts.yearEarlier.refundedMinor }
      : { state: "no_history", ...earlier, since: facts.firstPaidOn },
    owed: {
      minor: facts.owed.currentMinor,
      people: facts.owed.currentPeople,
      listOnlyPeople: Math.max(0, facts.owed.listPeople - facts.owed.currentPeople),
      pastMinor: facts.owed.pastMinor,
      pastPeople: facts.owed.pastPeople,
      overdueMinor: facts.owed.overdueMinor,
      overduePeople: facts.owed.overduePeople,
      overdueAfterDays: facts.overdueAfterDays,
    },
    lifetimeValue: lifetimeValue(facts, (month) => monthSums(month).netMinor),
    months: shown.map(monthSums),
    types: [...types.values()]
      .filter((t) => t.inUse > 0 || t.moved)
      .sort((a, b) => b.periodNetMinor - a.periodNetMinor || b.monthlyMinor - a.monthlyMinor || a.name.localeCompare(b.name))
      .map((t) => ({ name: t.name, inUse: t.inUse, monthlyMinor: t.monthlyMinor, monthNetMinor: t.monthNetMinor, periodNetMinor: t.periodNetMinor })),
  };
}

function lifetimeValue(facts: MoneyReportFacts, netOf: (month: string) => number): MoneyLifetimeFigure {
  const basis = churnBasis(facts.members);
  if (basis.state !== "ok") return { state: basis.state };
  const first = basis.months[0];
  // Payments were recorded here for the whole of those months, or the money is short.
  if (first === undefined || facts.firstPaidOn === null || facts.firstPaidOn > `${first}-01`) return { state: "not_enough_data" };
  if (basis.leftOfStart === 0) return { state: "nobody_left" };
  const net = basis.months.reduce((sum, month) => sum + netOf(month), 0);
  if (net <= 0) return { state: "nothing_collected" };
  return { state: "ok", minor: Math.round(net / basis.leftOfStart), months: basis.months, leavers: basis.leftOfStart };
}

/** The month before 'YYYY-MM'. */
function monthBefore(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${String(year - 1).padStart(4, "0")}-12` : `${month.slice(0, 4)}-${String(m - 1).padStart(2, "0")}`;
}
