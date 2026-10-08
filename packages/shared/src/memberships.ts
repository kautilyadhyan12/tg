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
export const MEMBERSHIP_TERM_COUNT_MAX = 365;
export const MEMBERSHIP_PACK_CLASSES_MAX = 500;
export const MEMBERSHIP_PACK_DAYS_MAX = 730;
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
  AT: "EUR", BE: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR",
  DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR",
  MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR",
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
  })
  .strict();
export type GymMembershipTypesResponse = z.infer<typeof gymMembershipTypesResponseSchema>;

/** Text a gym types that is printed as a name: no control characters, no half of a
 *  surrogate pair (Postgres refuses one inside JSON), and none of the invisible or
 *  direction-turning characters that make two names look like one. The two joiners
 *  (U+200C, U+200D) are let through: Hindi, Persian and joined emoji are typed with them. */
const VISIBLE_TEXT = /^[^\p{Cc}\p{Cs}\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]*$/u;

/** Whether a name or description holds nothing hidden, as the server will ask. */
export function isVisibleText(text: string): boolean {
  return VISIBLE_TEXT.test(text);
}

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
};
const membershipTypeObject = z.object(membershipTypeFields);

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
  })
  .strict()
  .superRefine(refineMembershipType);
export type UpdateGymMembershipTypeRequest = z.infer<typeof updateGymMembershipTypeRequestSchema>;

/** A day pass is a pack of 1 class that lasts 1 day (§13.1). */
export function isDayPass(type: Pick<GymMembershipType, "kind" | "packClasses" | "packDays">): boolean {
  return type.kind === "pack" && type.packClasses === 1 && type.packDays === 1;
}

let knownCurrencies: ReadonlySet<string> | null = null;

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
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? null;
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
  try {
    // The decimal text, not `minor / 100`: the cap keeps it far inside the range
    // a double prints exactly at this many places.
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(text));
  } catch {
    return `${text} ${currency}`;
  }
}
