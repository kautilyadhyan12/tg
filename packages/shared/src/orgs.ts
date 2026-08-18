// Gym platform, first slice — create an org, join it by code, read the roster.
// Contracts live here once and are consumed by the API and by typed clients
// (R7.2). Sources: Part 3 §2.1 (columns), §2.2 (role matrix), §2.4 (the
// visibility boundary), §3.3 (route surface), §4.0 (onboarding wizard fields);
// Part 4 §3.2 (DDL), §4.2 (seat-safe join).
import { z } from "zod";

/** The DB vocabulary (Part 4 §3.2's CHECK), used to PARSE rows on the way out.
 *  It still contains `clinic` on purpose — see `createOrgTypeSchema`. */
export const orgTypeSchema = z.enum(["gym", "studio", "clinic"]);
export type OrgType = z.infer<typeof orgTypeSchema>;

/** KD RULING 2026-08-18: *"no click will be there only gyms and fitness
 *  centers"* — clinics are OUT of the product.
 *
 *  **This is the no-removal rule's authorised path** (CLAUDE.md MIGRATION
 *  STANCE): an explicit Kd ruling, made in response to a cited option. He was
 *  asked whether a clinic OWNER should be auto-enrolled in their own clinic
 *  and stamped with a consent record nobody collected; he answered by removing
 *  clinics altogether, which is the better answer — a problem that cannot
 *  arise beats a problem handled carefully.
 *
 *  **NARROWED AT THE DOOR, NOT DELETED FROM THE DATABASE.** `orgTypeSchema`
 *  above keeps all three values and the §3.2 CHECK is untouched, so any row
 *  that already exists still reads back rather than throwing, and the clinic
 *  consent gate in the join path stays live for it. What changes is that no
 *  NEW clinic can be created. No migration, and the door reopens by adding one
 *  value here if Kd ever reverses it.
 *
 *  `studio` stays: a boutique or personal-training studio is a fitness
 *  business, not a medical one, so it sits inside "gyms and fitness centres".
 *  That call was stated to Kd in one line and not overruled. */
export const createOrgTypeSchema = z.enum(["gym", "studio"]);
export type CreateOrgType = z.infer<typeof createOrgTypeSchema>;

/** Part 3 §2.2. `admin` is deliberately absent — Kd's internal panel is a
 *  separate surface (Part 3 §1), never a role inside an org. */
export const orgRoleSchema = z.enum(["owner", "manager", "trainer"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const orgStatusSchema = z.enum(["active", "archived"]);
export type OrgStatus = z.infer<typeof orgStatusSchema>;

/** Part 3 §4.0 step 4: "human-safe 6-char alphabet, no 0/O/1/I".
 *  32 symbols exactly, which is also what makes the byte→symbol mapping in
 *  `codeFromBytes` unbiased (256 % 32 === 0) — do not add or remove one
 *  without re-reading that function. */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 6;

/** KD RULING 2026-08-18: *"no inr default wil update according to location for
 *  now usa india candan and europe later"*.
 *
 *  The currency a gym is shown follows WHERE THE GYM IS, and the SERVER derives
 *  it — the client says which country, never which currency (R3.1: a
 *  client-sent currency is a display hint at best, and at worst a gym billed in
 *  the wrong money).
 *
 *  This list IS the supported set, and a country outside it is refused with an
 *  honest "not open there yet" rather than being given somebody else's
 *  currency. Kd's "later" is the rest of the world; adding a row here is the
 *  whole change, but a new currency also needs prices that exist, so it belongs
 *  with the pricing ratification (:9944) and not with a chat's guess.
 *
 *  The euro-area members are listed individually rather than as "Europe"
 *  because Europe is not one currency: the UK is on the pound, and several EU
 *  states run their own money (Poland, Sweden, Denmark, Switzerland, Norway,
 *  Czechia, Hungary, Romania) — each of those is an unsupported country today,
 *  deliberately, because guessing euros for them would be the exact falsehood
 *  this ruling removes. */
export const supportedCountrySchema = z.enum([
  "US", "IN", "CA", "GB",
  // Euro area.
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
]);
export type SupportedCountry = z.infer<typeof supportedCountrySchema>;

/** The picker's own source of truth — a console that builds its country list
 *  from anything else will offer a country the server then refuses. Typed
 *  straight off the schema rather than through `Object.keys`, which returns
 *  `string[]` and would need a cast (R2.2). */
export const SUPPORTED_COUNTRIES = supportedCountrySchema.options;

/** Typed as a total Record, so TypeScript refuses to compile a country added
 *  to the schema above without a currency here. */
export const COUNTRY_CURRENCY: Readonly<Record<SupportedCountry, string>> = {
  US: "USD",
  IN: "INR",
  CA: "CAD",
  GB: "GBP",
  AT: "EUR", BE: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR",
  DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR",
  MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR",
};

/** null = we are not open in that country yet. Never a fallback currency:
 *  a fallback here is how a Canadian gym ends up quoted in rupees.
 *
 *  Parsed rather than looked up (R2.3): `safeParse` both narrows the type
 *  without a cast and closes the inherited-key hole for free — a bare
 *  `key in COUNTRY_CURRENCY` matches `constructor` and `toString`. */
export function currencyForCountry(country: string): string | null {
  const parsed = supportedCountrySchema.safeParse(country.trim().toUpperCase());
  return parsed.success ? COUNTRY_CURRENCY[parsed.data] : null;
}

/** Both of these ask the platform's own database rather than pattern-matching:
 *  the IANA zone list changes (zones are added, renamed and merged), so any
 *  regular expression here would be wrong by next year. `Intl` throws
 *  `RangeError` on an unknown zone or a malformed locale tag, which is the
 *  check — a try/catch around a throw, not a guess. */
function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false; // RangeError: unknown zone
  }
}

function isValidLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length > 0;
  } catch {
    return false; // RangeError: malformed tag
  }
}

/** Part 3 §4.0 step 1's fields, plus `country`.
 *
 *  `country` is an ADDITION to the wizard the spec describes, and it is here
 *  because Kd's currency ruling needs a location to follow and `city` is free
 *  text that cannot be mapped. It is NOT derived from `timezone`: that would be
 *  a guess, and a wrong guess puts the wrong currency in front of a paying gym.
 *
 *  `currencyDisplay` is deliberately NOT accepted from the client — the server
 *  computes it from `country`. */
export const createOrgRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    city: z.string().trim().max(120).nullable().optional(),
    /** ISO 3166-1 alpha-2. Shape only — whether we are OPEN there is the
     *  service's answer, so the refusal can be a sentence a gym owner
     *  understands rather than an enum error. */
    country: z.string().trim().length(2),
    orgType: createOrgTypeSchema.default("gym"),
    /** IANA zone; Part 3 §4.0 prefills it from the browser. Every org-day
     *  boundary is computed from this and nowhere else (playbook trap #8),
     *  which is exactly why the string is PROVEN to name a real zone here
     *  rather than merely bounded in length. Nothing reads the column yet, so
     *  no user can see a wrong day today — but a junk zone written now is a
     *  permanent row, and the rollup that eventually reads it has no way to
     *  tell "Mars/Olympus" from a zone it simply does not know. */
    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, {
      message: "not a known IANA time zone",
    }),
    locale: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .refine(isValidLocale, { message: "not a well-formed locale" })
      .default("en"),
  })
  .strict();
export type CreateOrgRequest = z.infer<typeof createOrgRequestSchema>;

export const orgSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  orgType: orgTypeSchema,
  timezone: z.string(),
  locale: z.string(),
  /** Derived from the org's country, server-side (see COUNTRY_CURRENCY). It is
   *  in the response so a console never has to re-derive it — two places
   *  deciding what money a gym is in is two places to disagree. */
  currencyDisplay: z.string(),
  status: orgStatusSchema,
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;

export const joinCodeSchema = z.object({
  code: z.string(),
  label: z.string(),
});
export type JoinCode = z.infer<typeof joinCodeSchema>;

export const createOrgResponseSchema = z.object({
  org: orgSummarySchema,
  /** Part 3 §4.0 step 4 — the first code is created WITH the org, never as a
   *  second call the owner could skip and end up with an org nobody can join. */
  joinCode: joinCodeSchema,
});
export type CreateOrgResponse = z.infer<typeof createOrgResponseSchema>;

/** One row of "my orgs". A single row carries BOTH relationships because the
 *  default owner IS a member (Part 3 §4.0 step 6) — two lists would show the
 *  same gym twice and invite a screen that double-counts it. */
export const myOrgSchema = orgSummarySchema.extend({
  staffRole: orgRoleSchema.nullable(),
  isMember: z.boolean(),
  joinedAt: z.string().nullable(),
});
export type MyOrg = z.infer<typeof myOrgSchema>;

export const myOrgsResponseSchema = z.object({ orgs: z.array(myOrgSchema) });
export type MyOrgsResponse = z.infer<typeof myOrgsResponseSchema>;

export const joinOrgRequestSchema = z
  .object({
    /** Typed by a human off a poster, so it is normalised (case, spaces,
     *  dashes) server-side before lookup. Bounded generously rather than
     *  pinned to 6 so a pasted "AIHG-24KQ7B" fails on the LOOKUP, with a
     *  "no such code" answer, instead of on a length check that reads as a
     *  different kind of error. */
    code: z.string().trim().min(1).max(32),
    /** Part 3 §2.4: joining a CLINIC code is the consent record, timestamped
     *  in `gym_members.consent_at`. Recorded on any org type when sent; the
     *  service REFUSES a clinic join without it. */
    consent: z.boolean().optional(),
  })
  .strict();
export type JoinOrgRequest = z.infer<typeof joinOrgRequestSchema>;

export const membershipSchema = z.object({
  id: z.string().uuid(),
  joinedAt: z.string(),
  /** The label of the code used, e.g. "Front Desk" — Part 3 §2.1's group
   *  mechanism.
   *
   *  Nullable because `gym_members.code_id` is (Part 4 §3.2), not because any
   *  path produces a null today: the owner's own seat is given the first
   *  code's id at creation, and every join goes through a code by definition.
   *  A membership written by the roster IMPORT, which has no code at all, is
   *  the case that will first make this real. (T3 round 1 L-1 — the original
   *  comment claimed the owner seat was the null case, which was false of the
   *  code three lines away.) */
  groupLabel: z.string().nullable(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const joinOrgResponseSchema = z.object({
  org: orgSummarySchema,
  membership: membershipSchema,
  /** True when the caller was ALREADY a live member. The join is idempotent
   *  (Part 4 §4.2), so this is the honest way to say "nothing changed"
   *  without turning a harmless second tap into an error. */
  alreadyMember: z.boolean(),
});
export type JoinOrgResponse = z.infer<typeof joinOrgResponseSchema>;

/** Cursor pagination per R7.3. Cursor = `<joinedAt ISO>|<membership uuid>`
 *  from the previous page (keyset on the same pair the ordering uses). */
export const orgMemberListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(120).optional(),
  })
  .strict();
export type OrgMemberListQuery = z.infer<typeof orgMemberListQuerySchema>;

/** Part 3 §2.4 IS this shape's specification. Identity, when they joined and
 *  which code brought them in — nothing else. No email, no stats, and nothing
 *  from the never-see list (meals, weight, coach chats, run routes). A field
 *  added here without re-reading §2.4 is how that promise gets broken. */
export const orgMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  joinedAt: z.string(),
  groupLabel: z.string().nullable(),
  /** The owner's own seat (Part 3 §4.0 step 6) — excluded from seat counts. */
  complimentary: z.boolean(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

export const orgMemberPageSchema = z.object({
  items: z.array(orgMemberSchema),
  nextCursor: z.string().nullable(),
});
export type OrgMemberPage = z.infer<typeof orgMemberPageSchema>;
