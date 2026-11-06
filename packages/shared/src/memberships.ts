// WHAT A GYM SELLS — Part 3 §13.1; ROADMAP Stage 2 item 17a-i.
//
// A membership type is one line of the gym's own price list: a name, a kind, a
// price in the gym's own money, how long it lasts or how many classes it holds,
// and what it includes. A person's membership (17a-ii) points at one.
//
// A price crosses the wire as a whole number of MINOR units (cents, paise, yen)
// and the currency is the server's, from the gym's country. The two functions at
// the bottom are the only place a typed price becomes minor units and the only
// place minor units become a printed price.
import { z } from "zod";
import { VISIBLE_TEXT } from "./visibleText.js";
import { supportedCountrySchema, type SupportedCountry } from "./orgs.js";

/** The four kinds (§13.1). A day pass is a pack of 1 class valid for 1 day, as
 *  PushPress makes a drop-in; `isDayPass` says which packs those are. */
export const MEMBERSHIP_KINDS = ["recurring", "one_time", "pack", "trial"] as const;
export const membershipKindSchema = z.enum(MEMBERSHIP_KINDS);
export type MembershipKind = z.infer<typeof membershipKindSchema>;

/** How a length is counted. A repeating type bills by the week, month or year. */
export const MEMBERSHIP_TERM_UNITS = ["day", "week", "month", "year"] as const;
export const membershipTermUnitSchema = z.enum(MEMBERSHIP_TERM_UNITS);
export type MembershipTermUnit = z.infer<typeof membershipTermUnitSchema>;
export const MEMBERSHIP_PERIOD_UNITS = ["week", "month", "year"] as const;

/** What it includes: every class, a limit of so many classes a week or a month, or
 *  the gym floor only. */
export const MEMBERSHIP_ACCESS = ["all_classes", "limited", "gym_only"] as const;
export const membershipAccessSchema = z.enum(MEMBERSHIP_ACCESS);
export type MembershipAccess = z.infer<typeof membershipAccessSchema>;

/** A gym's live types, counted under the gym's lock. */
export const MEMBERSHIP_TYPES_MAX = 60;
/** The archived list is a page of an unbounded set, newest first. */
export const MEMBERSHIP_ARCHIVED_PAGE = 200;
export const MEMBERSHIP_NAME_MAX = 80;
/** 999,999.99 in a two-decimal currency; inside a Postgres integer. */
export const MEMBERSHIP_PRICE_MINOR_MAX = 99_999_999;
/** The highest price of a taxed membership type (18b-iii): at the highest tax rate, 30%,
 *  added on top, its bill still fits under a bill's cap. 76,923,076 bills 99,999,999. */
export const TAXED_PRICE_MINOR_MAX = 76_923_076;
/** A tax rate in thousandths of a percent ("pcm", per cent mille; 18b-v-a): 9975 is 9.975%,
 *  8250 is 8.25%. 30% is the most one rate, or all of one thing's rates together, can be. */
export const SALES_TAX_PCM_MAX = 30_000;
/** How many named tax rates a gym can have (18b-iii), and so how many one thing can charge. */
export const TAX_RATES_MAX = 10;
/** The rates a membership type charges (18b-v-b): each of the gym's rates once, in order. */
const taxRateIdsSchema = z
  .array(z.string().uuid())
  .max(TAX_RATES_MAX)
  .refine((ids) => new Set(ids).size === ids.length, "rate_twice");
export const MEMBERSHIP_TERM_COUNT_MAX = 365;
export const MEMBERSHIP_PACK_CLASSES_MAX = 500;
export const MEMBERSHIP_PACK_DAYS_MAX = 730;
/** A repeating type's contract (18v-i): how many payments it runs for, at most three years of weekly ones. */
export const MEMBERSHIP_CONTRACT_PERIODS_MAX = 156;
/** What a contract does once it has run: go on renewing period by period, or end. */
export const CONTRACT_THEN = ["renews", "ends"] as const;
export const contractThenSchema = z.enum(CONTRACT_THEN);
export type ContractThen = z.infer<typeof contractThenSchema>;
export const contractPeriodsSchema = z.number().int().min(1).max(MEMBERSHIP_CONTRACT_PERIODS_MAX);
/** A repeating type's notice to cancel (18v-ii-a): so many days, at most 90. */
export const MEMBERSHIP_NOTICE_DAYS_MAX = 90;
export const noticeDaysSchema = z.number().int().min(1).max(MEMBERSHIP_NOTICE_DAYS_MAX);
/** A minimum term's early cancellation fee (18v-ii-b): a set amount, the line's tax inside it. */
export const leaveFeeMinorSchema = z.number().int().min(1).max(99_999_999);
/** A line's cooling-off period (18v-iii): so many days after signing in which a member may cancel with a
 *  full refund, at most 30. Weekends count. */
export const MEMBERSHIP_COOLING_OFF_DAYS_MAX = 30;
export const coolingOffDaysSchema = z.number().int().min(1).max(MEMBERSHIP_COOLING_OFF_DAYS_MAX);

/** A line's renewal reminder (18v-iv): an email so many days before every renewal, or before its minimum
 *  term ends. The rule is `renewalReminders.ts`. */
export const RENEWAL_REMINDER_WHEN = ["every_renewal", "term_end"] as const;
export const renewalReminderWhenSchema = z.enum(RENEWAL_REMINDER_WHEN);
export type RenewalReminderWhen = z.infer<typeof renewalReminderWhenSchema>;

/** How many days before: picked, never typed. */
export const RENEWAL_REMINDER_DAYS = [3, 7, 14, 30, 45, 60] as const;
export const renewalReminderDaysSchema = z
  .number()
  .int()
  .refine((n) => (RENEWAL_REMINDER_DAYS as readonly number[]).includes(n), { message: "not_a_choice" });

export interface RenewalReminderSetting {
  when: RenewalReminderWhen;
  days: number;
}

/** The emails go from this hour of the gym's own morning. */
export const RENEWAL_REMINDER_FROM_HOUR = 8;

/** The fewest days one period of `count` `unit` can hold. */
function shortestPeriodDays(count: number, unit: MembershipTermUnit): number {
  if (unit === "day") return count;
  if (unit === "week") return 7 * count;
  if (unit === "month") return 28 * count;
  return 365 * count;
}

/** The days a line paid every `termCount` `termUnit` offers. Before every renewal, fewer than one period
 *  holds, so a reminder is never about the renewal after next: a weekly line offers 3 days. */
export function renewalReminderDaysOffered(when: RenewalReminderWhen, termCount: number, termUnit: MembershipTermUnit): number[] {
  if (when === "term_end") return [...RENEWAL_REMINDER_DAYS];
  const longest = shortestPeriodDays(termCount, termUnit);
  return RENEWAL_REMINDER_DAYS.filter((days) => days < longest);
}
export const renewalReminderSchema = z.object({ when: renewalReminderWhenSchema, days: renewalReminderDaysSchema }).strict();
/** A line's reminders as the rule reads them: before every renewal first, then before its minimum term ends. */
export function lineReminders(line: { renewalReminderDays?: number | null; termReminderDays?: number | null }): RenewalReminderSetting[] {
  return [
    ...((line.renewalReminderDays ?? null) === null ? [] : [{ when: "every_renewal" as const, days: line.renewalReminderDays ?? 0 }]),
    ...((line.termReminderDays ?? null) === null ? [] : [{ when: "term_end" as const, days: line.termReminderDays ?? 0 }]),
  ];
}
/** What happens to one membership's reminder: sent (`on` the gym's day); on its way; to be emailed (`on` the day
 *  it goes); or why not. `aboutOn` is the day it names, where there is one to come. */
export const RENEWAL_REMINDER_STATES = [
  "sent",
  "sending",
  "will_send",
  "no_email",
  "address_blocked",
  "not_sent",
  "frozen",
  "not_renewing",
  "no_term",
  "former_payer",
  "billed_elsewhere",
] as const;
export const renewalReminderStatusSchema = z
  .object({ state: z.enum(RENEWAL_REMINDER_STATES), on: z.string().nullable(), aboutOn: z.string().nullable() })
  .strict();
export type RenewalReminderStatus = z.infer<typeof renewalReminderStatusSchema>;

// ── RAISE THE PRICE FOR MEMBERS ALREADY ON A LINE (18w; `priceRaises.ts` holds the rule) ──

/** How many days before the first payment at the new price each member is emailed. */
export const PRICE_RAISE_NOTICE_DAYS = [7, 14, 30] as const;
export const priceRaiseNoticeDaysSchema = z.union([z.literal(7), z.literal(14), z.literal(30)]);
export type PriceRaiseNoticeDays = z.infer<typeof priceRaiseNoticeDaysSchema>;
/** The most memberships one Save may raise: a gym of 10,000 on one line, twice over. */
export const PRICE_RAISE_TICKED_MAX = 20_000;
/** Raise the price for these memberships of the line, ticked in the box before Save: the line's new price, from
 *  each one's first payment at least `noticeDays` away, emailed that many days before it. */
export const priceRaiseRequestSchema = z
  .object({ noticeDays: priceRaiseNoticeDaysSchema, membershipIds: z.array(z.string().uuid()).min(1).max(PRICE_RAISE_TICKED_MAX) })
  .strict();
export type PriceRaiseRequest = z.infer<typeof priceRaiseRequestSchema>;
/** What happens to one membership's price: to be emailed (`on` the day it goes); after a freeze; on its way; emailed
 *  (`on` the gym's day); or why it stays. `startsOn` is the first payment at the new price, where there is one. */
export const PRICE_RAISE_STATES = [
  "will_send",
  "after_freeze",
  "sending",
  "sent",
  "not_renewing",
  "not_higher",
  "raise_waiting",
  "no_email",
  "address_blocked",
  "not_sent",
  "maybe_sent",
  "former_payer",
  "billed_elsewhere",
] as const;
export const priceRaiseStateSchema = z.enum(PRICE_RAISE_STATES);
export type PriceRaiseState = z.infer<typeof priceRaiseStateSchema>;
export const priceRaiseStatusSchema = z
  .object({
    state: priceRaiseStateSchema,
    /** Its price now and the new price, before tax, as the price list and a person's page show prices. */
    fromMinor: z.number().int().min(0),
    toMinor: z.number().int().min(0),
    startsOn: z.string().nullable(),
    on: z.string().nullable(),
  })
  .strict();
export type PriceRaiseStatus = z.infer<typeof priceRaiseStatusSchema>;


/** What a class limit is counted over. */
export const MEMBERSHIP_LIMIT_PERIODS = ["week", "month"] as const;
export const membershipLimitPeriodSchema = z.enum(MEMBERSHIP_LIMIT_PERIODS);
export type MembershipLimitPeriod = z.infer<typeof membershipLimitPeriodSchema>;
export const MEMBERSHIP_BOOKINGS_LIMIT_MAX = 200;
/** The most personal training sessions a week or a month a type can allow. */
export const MEMBERSHIP_PT_LIMIT_MAX = 200;
export const MEMBERSHIP_DESCRIPTION_MAX = 300;
/** A gym's live class types are capped at 60 (`CLASS_TYPES_MAX`); a type edited
 *  later may still cover archived ones. */
export const MEMBERSHIP_CLASS_TYPES_MAX = 200;

/** The money a gym's MEMBERS pay it in: the country's own (RULINGS 2026-08-18,
 *  §13.1). This is not `COUNTRY_CURRENCY`, which is what the gym pays us in and
 *  is dollars outside India. */
export const MEMBER_CURRENCY: Readonly<Record<SupportedCountry, string>> = {
  US: "USD",
  IN: "INR",
  CA: "CAD",
  GB: "GBP",
  IE: "EUR",
  FR: "EUR",
  ES: "EUR",
  AU: "AUD",
  JP: "JPY",
};

/** null where the gym's country is not one we serve: never a fallback currency. */
export function memberCurrencyForCountry(country: string | null): string | null {
  if (country === null) return null;
  const parsed = supportedCountrySchema.safeParse(country.trim().toUpperCase());
  return parsed.success ? MEMBER_CURRENCY[parsed.data] : null;
}

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const priceMinorSchema = z.number().int().min(0).max(MEMBERSHIP_PRICE_MINOR_MAX);
const termCountSchema = z.number().int().min(1).max(MEMBERSHIP_TERM_COUNT_MAX);
const packClassesSchema = z.number().int().min(1).max(MEMBERSHIP_PACK_CLASSES_MAX);
const packDaysSchema = z.number().int().min(1).max(MEMBERSHIP_PACK_DAYS_MAX);
const bookingsLimitSchema = z.number().int().min(1).max(MEMBERSHIP_BOOKINGS_LIMIT_MAX);
const ptLimitSchema = z.number().int().min(1).max(MEMBERSHIP_PT_LIMIT_MAX);

/** One line of the price list, as the console reads it.
 *
 *  `termCount` and `termUnit` are the billing period of a repeating type and the
 *  length of a one-time type or a trial; a pack has `packClasses` and `packDays`
 *  instead. `bookingsLimit` a `bookingsPeriod` is the class limit where `access` is
 *  `limited`. `classTypes` null means every class; a list means only those. `ptLimit` a
 *  `ptPeriod` is how many personal training sessions it allows; both null is no limit. */
export const gymMembershipTypeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(MEMBERSHIP_NAME_MAX),
    description: z.string().min(1).max(MEMBERSHIP_DESCRIPTION_MAX).nullable(),
    kind: membershipKindSchema,
    priceMinor: priceMinorSchema,
    currency: currencyCodeSchema,
    termCount: termCountSchema.nullable(),
    termUnit: membershipTermUnitSchema.nullable(),
    packClasses: packClassesSchema.nullable(),
    packDays: packDaysSchema.nullable(),
    access: membershipAccessSchema,
    bookingsLimit: bookingsLimitSchema.nullable(),
    bookingsPeriod: membershipLimitPeriodSchema.nullable(),
    classTypes: z
      .array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(80) }).strict())
      .nullable(),
    /** It includes personal training (17e-i). "Every class" does not by itself. */
    includesPt: z.boolean(),
    ptLimit: ptLimitSchema.nullable(),
    ptPeriod: membershipLimitPeriodSchema.nullable(),
    /** The gym's tax rates its bills charge, in the order they were picked (18b-iii; 18b-v-b);
     *  empty for no tax. */
    taxRateIds: z.array(z.string().uuid()).max(TAX_RATES_MAX),
    /** Charged on the first bill of a membership given from it (18t); 0 for none. */
    joiningFeeMinor: priceMinorSchema,
    /** The business's other agreement it is signed with (18u-ii-a); null for the main one. */
    agreementId: z.string().uuid().nullable().default(null),
    /** Its contract (18v-i): so many payments, then it renews or ends; both null for none. */
    contractPeriods: contractPeriodsSchema.nullable().default(null),
    contractThen: contractThenSchema.nullable().default(null),
    /** Its notice to cancel in days (18v-ii-a); null for none. */
    noticeDays: noticeDaysSchema.nullable().default(null),
    /** Its minimum term's early cancellation fee (18v-ii-b); null for none. */
    leaveFeeMinor: leaveFeeMinorSchema.nullable().default(null),
    /** Its cooling-off period in days (18v-iii); null for none. */
    coolingOffDays: coolingOffDaysSchema.nullable().default(null),
    /** Its reminders (18v-iv): so many days before every renewal, and before its minimum term ends; null for none. */
    renewalReminderDays: renewalReminderDaysSchema.nullable().default(null),
    termReminderDays: renewalReminderDaysSchema.nullable().default(null),
    /** Members may buy it in the app (18k-i): a membership or a pack with a price, never a trial. */
    soldInApp: z.boolean().default(false),
    archivedAt: z.string().datetime({ offset: true }).nullable(),
    /** When it was last changed. A change sends it back, so a form opened before
     *  somebody else's change is refused, never saved over theirs. */
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type GymMembershipType = z.infer<typeof gymMembershipTypeSchema>;

/** The whole price list. `currency` is what a NEW type would be priced in, null
 *  where the gym's country has none; `classChoices` are the gym's live classes,
 *  for "which classes it covers". */
export const gymMembershipTypesResponseSchema = z
  .object({
    currency: currencyCodeSchema.nullable(),
    types: z.array(gymMembershipTypeSchema),
    archived: z.array(gymMembershipTypeSchema),
    archivedTotal: z.number().int().min(0),
    classChoices: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(80) }).strict()),
    /** The gym's tax rates, for "Tax" (18b-iii), and whether its prices hold the tax. */
    taxRates: z.array(z.object({ id: z.string().uuid(), name: z.string(), pcm: z.number().int().min(1).max(SALES_TAX_PCM_MAX) }).strict()),
    taxIncluded: z.boolean(),
    /** The day of the month the gym bills everyone on (18y); null where each is billed from its start. */
    billDay: z.number().int().min(1).max(28).nullable().default(null),
    /** The business's other agreements, by name (18u-ii-a): each line says which it uses. Empty
     *  where it has only its main one. */
    agreements: z.array(z.object({ id: z.string().uuid(), name: z.string(), inUse: z.boolean().default(true) }).strict()).default([]),
    /** The business's default agreement: never written, turned off, or in use (18u-ii-a). */
    defaultAgreement: z.enum(["none", "off", "in_use"]).default("none"),
    /** After a change that raised members already on the line (18w): how many. */
    raised: z.number().int().min(0).optional(),
  })
  .strict();
export type GymMembershipTypesResponse = z.infer<typeof gymMembershipTypesResponseSchema>;

const membershipTypeFields = {
  name: z.string().trim().min(1).max(MEMBERSHIP_NAME_MAX).regex(VISIBLE_TEXT),
  /** One or two lines for staff and, later, members. Empty is "none". */
  description: z.string().trim().max(MEMBERSHIP_DESCRIPTION_MAX).regex(VISIBLE_TEXT).nullable(),
  kind: membershipKindSchema,
  priceMinor: priceMinorSchema,
  termCount: termCountSchema.nullable(),
  termUnit: membershipTermUnitSchema.nullable(),
  packClasses: packClassesSchema.nullable(),
  packDays: packDaysSchema.nullable(),
  access: membershipAccessSchema,
  bookingsLimit: bookingsLimitSchema.nullable(),
  bookingsPeriod: membershipLimitPeriodSchema.nullable(),
  classTypeIds: z.array(z.string().uuid()).max(MEMBERSHIP_CLASS_TYPES_MAX).nullable(),
  /** Left out of a NEW type is "no"; a change must say it (below). */
  includesPt: z.boolean().default(false),
  /** Left out of a NEW type is "no limit"; a change must say both (below). */
  ptLimit: ptLimitSchema.nullable().default(null),
  ptPeriod: membershipLimitPeriodSchema.nullable().default(null),
  /** Left out of a NEW type is "no tax"; a change must say it (below). Each of the gym's rates
   *  once; together at most 30% (checked on the server, which knows each rate). */
  taxRateIds: taxRateIdsSchema.default([]),
  /** Left out of a NEW type is "no joining fee"; a change must say it (below). */
  joiningFeeMinor: priceMinorSchema.default(0),
  /** Left out of a NEW type is "no contract"; a change must say it (below). */
  contractPeriods: contractPeriodsSchema.nullable().default(null),
  contractThen: contractThenSchema.nullable().default(null),
  /** Left out of a NEW type is "no notice"; a change must say it (below). */
  noticeDays: noticeDaysSchema.nullable().default(null),
  /** Left out of a NEW type is "no early cancellation fee"; a change must say it (below). */
  leaveFeeMinor: leaveFeeMinorSchema.nullable().default(null),
  /** Left out of a NEW type is "no cooling-off period"; a change must say it (below). */
  coolingOffDays: coolingOffDaysSchema.nullable().default(null),
  /** Left out of a NEW type is "no reminder"; a change must say each (below). */
  renewalReminderDays: renewalReminderDaysSchema.nullable().default(null),
  termReminderDays: renewalReminderDaysSchema.nullable().default(null),
  /** Left out of a NEW type is "not sold in the app"; a change must say it (below). */
  soldInApp: z.boolean().default(false),
};
const membershipTypeObject = z.object(membershipTypeFields);

/** The kinds members may buy in the app (18k-i): a paid-once membership or a pack. A repeating one joins them with
 *  18k-iv, once members can cancel it in the app (18l; RULINGS 2026-10-22). A trial has its own rules for who may have
 *  one, and a product is bought at the desk (Kd, 2026-11-06). */
export const SOLD_IN_APP_KINDS: readonly MembershipKind[] = ["one_time", "pack"];
export const canSellInApp = (type: { kind: MembershipKind; priceMinor: number }): boolean => SOLD_IN_APP_KINDS.includes(type.kind) && type.priceMinor > 0;

/** The rules between the fields: each kind in its own shape. */
function refineMembershipType(value: z.infer<typeof membershipTypeObject>, ctx: z.RefinementCtx): void {
  const wrong = (path: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path] });
  };
  if (value.kind === "pack") {
    if (value.packClasses === null) wrong("packClasses");
    if (value.packDays === null) wrong("packDays");
    if (value.termCount !== null) wrong("termCount");
    if (value.termUnit !== null) wrong("termUnit");
    // A pack IS its classes: there is no "gym only" or "a week" to it.
    if (value.access !== "all_classes") wrong("access");
  } else {
    if (value.termCount === null) wrong("termCount");
    if (value.termUnit === null) wrong("termUnit");
    if (value.packClasses !== null) wrong("packClasses");
    if (value.packDays !== null) wrong("packDays");
    if (value.kind === "recurring" && value.termUnit === "day") wrong("termUnit");
  }
  if ((value.access === "limited") !== (value.bookingsLimit !== null)) wrong("bookingsLimit");
  if ((value.access === "limited") !== (value.bookingsPeriod !== null)) wrong("bookingsPeriod");
  if (value.access === "gym_only" && value.classTypeIds !== null) wrong("classTypeIds");
  // No class at all is a membership for personal training alone.
  if (value.classTypeIds !== null && value.classTypeIds.length === 0 && !value.includesPt) wrong("classTypeIds");
  if ((value.ptLimit === null) !== (value.ptPeriod === null)) wrong("ptPeriod");
  // A limit is on personal training the type includes; a pack's own count is its limit.
  if (value.ptLimit !== null && (!value.includesPt || value.kind === "pack")) wrong("ptLimit");
  if (value.classTypeIds !== null && new Set(value.classTypeIds).size !== value.classTypeIds.length) {
    wrong("classTypeIds");
  }
  const taxed = value.taxRateIds.length > 0;
  if (taxed && value.priceMinor > TAXED_PRICE_MINOR_MAX) wrong("priceMinor");
  // A free type opens no bill: it charges no tax.
  if (taxed && value.priceMinor === 0) wrong("taxRateIds");
  // A joining fee rides on the first bill: only a repeating or paid-once type with a price
  // opens one, and the two together are one bill, capped as one price.
  if (value.joiningFeeMinor > 0) {
    if ((value.kind !== "recurring" && value.kind !== "one_time") || value.priceMinor === 0) wrong("joiningFeeMinor");
    const cap = taxed ? TAXED_PRICE_MINOR_MAX : MEMBERSHIP_PRICE_MINOR_MAX;
    if (value.priceMinor + value.joiningFeeMinor > cap) wrong("joiningFeeMinor");
  }
  // A contract is so many payments of a repeating type that has a price.
  if ((value.contractPeriods === null) !== (value.contractThen === null)) wrong("contractThen");
  if (value.contractPeriods !== null && (value.kind !== "recurring" || value.priceMinor === 0)) wrong("contractPeriods");
  // A notice to cancel is a repeating type's that has a price, as a minimum term is.
  if (value.noticeDays !== null && (value.kind !== "recurring" || value.priceMinor === 0)) wrong("noticeDays");
  // A minimum term that ends by itself takes no notice (round one, H2).
  if (value.noticeDays !== null && value.contractThen === "ends") wrong("noticeDays");
  // An early cancellation fee is a minimum term's (18v-ii-b).
  if (value.leaveFeeMinor !== null && value.contractPeriods === null) wrong("leaveFeeMinor");
  // A cooling-off period gives back what was paid: a line with a price, of any kind (18v-iii).
  if (value.coolingOffDays !== null && value.priceMinor === 0) wrong("coolingOffDays");
  // A renewal reminder is a repeating line's with a price; before the minimum term ends, a line with one; before
  // every renewal, fewer days than one period holds (18v-iv).
  if (value.renewalReminderDays !== null) {
    if (value.kind !== "recurring" || value.priceMinor === 0 || value.termCount === null || value.termUnit === null) wrong("renewalReminderDays");
    else if (!renewalReminderDaysOffered("every_renewal", value.termCount, value.termUnit).includes(value.renewalReminderDays)) wrong("renewalReminderDays");
  }
  if (value.termReminderDays !== null && value.contractPeriods === null) wrong("termReminderDays");
  // Sold in the app: a paid-once membership or a pack with a price (18k-i).
  if (value.soldInApp && !canSellInApp(value)) wrong("soldInApp");
}

/** How long a contract of `periods` payments, each every `termCount` `termUnit`, runs:
 *  "12 months", "2 years", "52 weeks". Months that make two or more whole years are said as years. */
export function contractLengthWords(periods: number, termCount: number, termUnit: MembershipTermUnit): string {
  const n = periods * termCount;
  const say = (count: number, one: string): string => `${String(count)} ${one}${count === 1 ? "" : "s"}`;
  if (termUnit === "year") return say(n, "year");
  if (termUnit === "month") return n % 12 === 0 && n >= 24 ? say(n / 12, "year") : say(n, "month");
  return say(n, termUnit);
}

/** What a gym types. Every field every time: an update replaces, it never merges,
 *  so `classTypeIds: null` means "every class" and never "leave it alone". The
 *  currency is not accepted: the server takes it from the gym's country. */
export const saveGymMembershipTypeRequestSchema = membershipTypeObject.strict().superRefine(refineMembershipType);
export type SaveGymMembershipTypeRequest = z.infer<typeof saveGymMembershipTypeRequestSchema>;

/** A change: the same fields, and the `updatedAt` the list gave for the type. */
export const updateGymMembershipTypeRequestSchema = membershipTypeObject
  // A change states the tick outright, as it states every other field: a default here
  // would take personal training off everybody who holds the type, or its limit.
  .extend({
    updatedAt: z.string().datetime({ offset: true }),
    includesPt: z.boolean(),
    ptLimit: ptLimitSchema.nullable(),
    ptPeriod: membershipLimitPeriodSchema.nullable(),
    taxRateIds: taxRateIdsSchema,
    joiningFeeMinor: priceMinorSchema,
    contractPeriods: contractPeriodsSchema.nullable(),
    contractThen: contractThenSchema.nullable(),
    noticeDays: noticeDaysSchema.nullable(),
    leaveFeeMinor: leaveFeeMinorSchema.nullable(),
    coolingOffDays: coolingOffDaysSchema.nullable(),
    renewalReminderDays: renewalReminderDaysSchema.nullable(),
    termReminderDays: renewalReminderDaysSchema.nullable(),
    soldInApp: z.boolean(),
    /** Members already on the line pay its new, higher price too (18w): only those ticked. */
    raise: priceRaiseRequestSchema.optional(),
  })
  .strict()
  .superRefine(refineMembershipType);
export type UpdateGymMembershipTypeRequest = z.infer<typeof updateGymMembershipTypeRequestSchema>;

/** A day pass is a pack of 1 class that lasts 1 day (§13.1). */
export function isDayPass(type: Pick<GymMembershipType, "kind" | "packClasses" | "packDays">): boolean {
  return type.kind === "pack" && type.packClasses === 1 && type.packDays === 1;
}

let knownCurrencies: ReadonlySet<string> | null = null;
/** One formatter a currency: making one costs about a tenth of a millisecond, and a list prints many prices (18k-i). */
const priceFormats = new Map<string, Intl.NumberFormat | null>();
function priceFormat(currency: string): Intl.NumberFormat | null {
  if (!priceFormats.has(currency)) {
    let format: Intl.NumberFormat | null;
    try {
      format = new Intl.NumberFormat("en", { style: "currency", currency });
    } catch {
      format = null;
    }
    priceFormats.set(currency, format);
  }
  return priceFormats.get(currency) ?? null;
}

/** How many decimal places a currency has (2 for dollars, 0 for yen, 3 for
 *  Kuwaiti dinar), from the platform's own ISO 4217 table and never a list here.
 *  null for a code the platform does not list: the formatter alone would give a
 *  well-formed unknown code 2. */
export function currencyDecimals(currency: string): number | null {
  try {
    // A browser too old to list its currencies still formats them: only then is
    // the formatter's answer taken alone.
    if (typeof Intl.supportedValuesOf === "function") {
      knownCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
      if (!knownCurrencies.has(currency)) return null;
    }
    return priceFormat(currency)?.resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

/** A typed price as minor units, or null where it is not plainly a price.
 *
 *  Digits and at most one point, with no more decimals than the currency has.
 *  A comma is refused, never guessed: "49,99" is 49.99 in Berlin and "1,500" is
 *  1500 in Mumbai, and a guess between them is a price a hundred times off.
 *  Whole-number arithmetic throughout; no floats. */
export function priceToMinor(text: string, currency: string): number | null {
  const decimals = currencyDecimals(currency);
  if (decimals === null) return null;
  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const minor = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || "0");
  return Number.isSafeInteger(minor) && minor <= MEMBERSHIP_PRICE_MINOR_MAX ? minor : null;
}

/** Minor units as the plain number a price box holds: 4999 → "49.99", yen 5000 →
 *  "5000". The inverse of `priceToMinor`. */
export function minorToPriceText(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency) ?? 2;
  const digits = String(Math.trunc(Math.abs(minor))).padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** Minor units as a printed price: 4999 USD → "$49.99", 5000 JPY → "¥5,000". */
export function formatMinor(minor: number, currency: string): string {
  const text = minorToPriceText(minor, currency);
  // The decimal text, not `minor / 100`: the cap keeps it far inside the range
  // a double prints exactly at this many places.
  const format = priceFormat(currency);
  return format === null ? `${text} ${currency}` : format.format(Number(text));
}
