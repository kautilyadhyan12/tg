// Gym platform, first slice — create an org, join it by code, read the roster.
// Contracts live here once and are consumed by the API and by typed clients
// (R7.2). Sources: Part 3 §2.1 (columns), §2.2 (role matrix), §2.4 (the
// visibility boundary), §3.3 (route surface), §4.0 (onboarding wizard fields);
// Part 4 §3.2 (DDL), §4.2 (seat-safe join).
import { z } from "zod";
import { instantSchema } from "./time.js";

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

/** One join code as the CONSOLE reads it back — Part 3 §3.3's `GET /codes`,
 *  the read half of its `GET/POST/PATCH /codes` surface.
 *
 *  **Why this exists at all:** `createOrgResponse.joinCode` was, until this
 *  card, the ONLY exit a code had from the server. So an owner saw their code
 *  once, at creation, and the console had no way to show it again after a
 *  reload — measured, not assumed (`listOrgsForUser` selects no code column and
 *  no other route reads `gym_codes` outside the join transaction). Kd ruled the
 *  read endpoint in rather than let the console print a code from its own
 *  memory of one.
 *
 *  **`paused`/`expiresAt`/`maxUses`/`uses` are not decoration.** The join path
 *  refuses a paused, expired or exhausted code, so a console that printed one
 *  under "share this with your members" would be promising something the server
 *  will not honour — a false thing on screen (:5807). The console decides
 *  live-vs-dead from these four fields and says so.
 *
 *  No `id`: nothing in this slice addresses a single code, and `code` is
 *  globally unique, so a list key needs nothing else. */
export const orgCodeSchema = z.object({
  code: z.string(),
  label: z.string(),
  paused: z.boolean(),
  /** ISO instant, or null for "never expires". */
  expiresAt: z.string().nullable(),
  /** null = unlimited uses. */
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
});
export type OrgCode = z.infer<typeof orgCodeSchema>;

export const orgCodesResponseSchema = z.object({ codes: z.array(orgCodeSchema) });
export type OrgCodesResponse = z.infer<typeof orgCodesResponseSchema>;

/** THE WRITE HALF of Part 3 §3.3's `GET/POST/PATCH /codes`, and §2.2's
 *  "Create / rotate / expire codes" row.
 *
 *  **NO `label` FIELD, AND THAT IS A KD RULING (2026-08-21), not an omission.**
 *  Shown a plan whose create form asked for a name ("Morning Batch"), he
 *  answered *"this kind of names not needed men"* and confirmed it when the cost
 *  was put to him: a label is Part 3 §2.1's GROUP mechanism — the thing that
 *  eventually tells a gym which desk, class or campaign a member arrived
 *  through — so dropping the input means a gym cannot tell its cohorts apart
 *  later, and §2.3's trainer-scoping-to-group has nothing to scope to.
 *
 *  **The COLUMN is untouched and keeps its `'Front Desk'` default** (no-removal
 *  rule: narrowed at the door, never deleted from the database — the same shape
 *  as the clinic narrowing at `createOrgTypeSchema`). Every code this route
 *  mints carries the default, nothing reads it as meaningful, and re-opening the
 *  door is adding one optional field here. No migration either way.
 *
 *  `expiresAt` and `maxUses` are BOTH optional and BOTH default to null, which
 *  is the plain-language shape Kd approved: a code with no end date and no limit
 *  is the ordinary one, and the two restrictions are things you opt into. */
export const createOrgCodeRequestSchema = z
  .object({
    /** ISO instant, or null for "never expires". Whether it is in the FUTURE is
     *  the service's answer, not the schema's, so the refusal can be a sentence
     *  an owner understands — the `country` precedent above. */
    expiresAt: instantSchema.nullable().default(null),
    /** null = unlimited. Upper bound is the COLUMN's (`integer`), so a value the
     *  schema blesses can always be stored: a bound invented smaller would be a
     *  number nobody chose, and no bound at all turns `1e30` into a 500 from
     *  Postgres rather than a 400 from here (:4483's shape — a schema that
     *  proves less than the code assumes). */
    maxUses: z.number().int().min(1).max(2147483647).nullable().default(null),
  })
  .strict();
export type CreateOrgCodeRequest = z.infer<typeof createOrgCodeRequestSchema>;

/** Changing an existing code: pause it, wake it up, or move either restriction.
 *
 *  **Every field is optional and at least one must be present.** An empty body
 *  would otherwise be a 200 that changed nothing while reading, to the screen
 *  and to the audit row it writes, exactly like a change that landed.
 *
 *  **`paused` is separate from `expiresAt` on purpose, and the split is the
 *  product rule**: pause means OFF NOW and is reversible; an expiry means off
 *  LATER and is a date. Collapsing them — "expire it by setting the date to the
 *  past" — is how an owner who mistypes a year silently kills the poster their
 *  members are holding. */
export const updateOrgCodeRequestSchema = z
  .object({
    paused: z.boolean().optional(),
    expiresAt: instantSchema.nullable().optional(),
    maxUses: z.number().int().min(1).max(2147483647).nullable().optional(),
  })
  .strict()
  .refine((v) => v.paused !== undefined || v.expiresAt !== undefined || v.maxUses !== undefined, {
    message: "nothing to change",
  });
export type UpdateOrgCodeRequest = z.infer<typeof updateOrgCodeRequestSchema>;

/** One code, after it was created or changed. The row as it NOW STANDS rather
 *  than an echo of the request: `uses` and `label` were never in the request,
 *  and a screen that re-derived the new state from what it sent is a screen that
 *  disagrees with the next `GET /codes`. */
export const orgCodeMutationResponseSchema = z.object({ code: orgCodeSchema });
export type OrgCodeMutationResponse = z.infer<typeof orgCodeMutationResponseSchema>;

/** ROTATE — Part 3 §7's answer to "code leaked publicly", and ONE call rather
 *  than two.
 *
 *  Kd's words for it: *"new code out, old one off, together"*. It is a server
 *  route and not two client calls because the halves fail independently: pause
 *  the old one, lose the connection, and the gym is left with NO working code —
 *  a gym nobody can join, which is the exact state `createOrgAttempt` opens a
 *  transaction to prevent. One transaction, both or neither.
 *
 *  BOTH rows come back. The new code is what the owner shares; `replaced` is
 *  proof the old one is off, so the screen can say so instead of the owner
 *  reloading to check. */
export const rotateOrgCodeResponseSchema = z.object({
  code: orgCodeSchema,
  replaced: orgCodeSchema,
});
export type RotateOrgCodeResponse = z.infer<typeof rotateOrgCodeResponseSchema>;

/** One row of "my orgs". A single row carries BOTH relationships because the
 *  default owner IS a member (Part 3 §4.0 step 6) — two lists would show the
 *  same gym twice and invite a screen that double-counts it. */
export const myOrgSchema = orgSummarySchema.extend({
  staffRole: orgRoleSchema.nullable(),
  isMember: z.boolean(),
  joinedAt: z.string().nullable(),
});
export type MyOrg = z.infer<typeof myOrgSchema>;

/** A gym the caller USED to belong to and was REMOVED from.
 *
 *  **Kd ruled that silence here is a hole** (2026-08-20): when a gym removes
 *  somebody, the app said nothing at all about that gym, and a person who was
 *  let in and then taken out was left to work it out from the absence of a
 *  card. The T3 round-1 fix stopped the app calling them a stranger
 *  ("{gym} didn't confirm your request"); it did not give them the truth.
 *
 *  **It is a SEPARATE list and not a row in `orgs`, on purpose.** `orgs` means
 *  "gyms I have a live relationship with" and the console reads the same
 *  response — a removed gym appearing there would put a gym in a console list
 *  whose every read the server then answers 404 to. Additive keeps that
 *  reader's meaning intact and keeps one fact in one place. */
export const formerOrgSchema = orgSummarySchema.extend({
  /** When the gym removed them. The card says nothing about WHO removed them or
   *  why, because the server does not know a reason and inventing one would be
   *  the same class of defect this whole entry exists to fix. */
  removedAt: z.string(),
});
export type FormerOrg = z.infer<typeof formerOrgSchema>;

export const myOrgsResponseSchema = z.object({
  orgs: z.array(myOrgSchema),
  /** Bounded by the same window as a refused application
   *  (`DECIDED_VISIBLE_DAYS`): a person must be TOLD they were removed, and
   *  must not be told forever.
   *
   *  **`.default([])` is deliberate and the web client is why.** `orgsApi.js`
   *  parses this response through THIS schema and treats a mismatch as a hard
   *  failure, and the card treats a failed read as silence — so a REQUIRED
   *  field would mean that during any window where the web app is newer than
   *  the API, the whole gym card vanishes, taking "You're a member of Iron
   *  House" with it. Degrading one sentence beats degrading the card. It is
   *  the same expand-then-contract discipline R4.4 imposes on migrations,
   *  applied to a response contract.
   *
   *  It costs something and the cost is named: a server that FORGETS to send
   *  this is indistinguishable from a server saying nobody was removed. That
   *  is acceptable only because the field is additive and its absence removes
   *  a sentence rather than inventing one — the failure mode is silence, which
   *  is what this field exists to end, so the SERVER-side test asserting a real
   *  removal appears is the guard that matters, not this default. */
  formerOrgs: z.array(formerOrgSchema).default([]),
});
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

/** The lifecycle of a join application (Kd ruling 2026-08-19, DECISIONS
 *  :11072). `cancelled` is written by account deletion, `expired` by the
 *  sweep :11385 rules (its own card) — both exist in the vocabulary from day
 *  one so a later card adds a writer, never a column. */
export const orgApplicationStatusSchema = z.enum([
  "pending",
  "confirmed",
  "rejected",
  "cancelled",
  "expired",
]);
export type OrgApplicationStatus = z.infer<typeof orgApplicationStatusSchema>;

/** The applicant's own view of their application. */
export const orgApplicationSchema = z.object({
  id: z.string().uuid(),
  status: orgApplicationStatusSchema,
  appliedAt: z.string(),
  /** :11385 — a pending application dies if nobody acts on it, and
   *  re-applying is free. Sent so the screen can say WHEN rather than
   *  inventing a number of its own. */
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  /** When this person last tapped "Remind them" (:11385 mechanic 3), or null
   *  if they never have. The screen needs it to say "you can do this again
   *  tomorrow" instead of offering a button that will be refused.
   *
   *  **`.default(null)` for the `formerOrgs` reason, not for tidiness.**
   *  `orgsApi.js` parses this response through this schema and treats a
   *  mismatch as a hard failure, and the gym card treats a failed read as
   *  SILENCE — so a REQUIRED field would make the whole card vanish during any
   *  window where the web bundle is newer than the API. A missing field costs
   *  one button; a required one costs the sentence that says which gym you are
   *  waiting on. R4.4's expand-then-contract, applied to a response. */
  nudgedAt: z.string().nullable().default(null),
});
export type OrgApplication = z.infer<typeof orgApplicationSchema>;

/** THE JOIN DOOR'S ANSWER, as a discriminated union rather than a flat object
 *  with nullable halves.
 *
 *  Each arm carries exactly what its own screen needs, so the server cannot
 *  serve "you are waiting" alongside a membership, and the client cannot draw
 *  a waiting card off an arm that has no application. The flat-with-nullables
 *  shape compiles just as well and lets both mistakes through.
 *
 *  **`joined` is deliberately NOT an arm here.** The only path that produces
 *  an instant membership is :9870's auto-attach (verified email, exactly ONE
 *  candidate row in that gym's IMPORTED roster) — and no roster table exists
 *  yet (measured 2026-08-19), so nothing can emit it. The auto-confirm card
 *  adds the arm together with the code that produces it; an arm no path emits
 *  is a branch every client must handle and no test can reach. */
export const joinOrgResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("pending"),
    org: orgSummarySchema,
    application: orgApplicationSchema,
  }),
  /** A second tap while already waiting. Idempotent by the partial unique
   *  index, so it returns the SAME application rather than an error — the
   *  same reasoning §4.2 applies to a repeat join. */
  z.object({
    outcome: z.literal("already_pending"),
    org: orgSummarySchema,
    application: orgApplicationSchema,
  }),
  /** Someone who is already a live member re-typing the code. Never becomes
   *  an application: they are in. */
  z.object({
    outcome: z.literal("already_member"),
    org: orgSummarySchema,
    membership: membershipSchema,
  }),
]);
export type JoinOrgResponse = z.infer<typeof joinOrgResponseSchema>;

/** One row of the console's confirm queue.
 *
 *  Part 3 §2.4 governs what a gym may see about its MEMBERS; an applicant is
 *  not one, and this is deliberately no wider than the roster already serves
 *  — who they say they are, when they asked, and which code they came in
 *  through. No email, no stats, nothing from the never-see list. The front
 *  desk recognises a person standing in front of them; it does not need a
 *  dossier to do it. */
export const orgApplicantSchema = z.object({
  /** The APPLICATION id — what confirm/reject address. */
  id: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  appliedAt: z.string(),
  expiresAt: z.string(),
  /** The label of the code they used, e.g. "Front Desk" — Part 3 §2.1's group
   *  mechanism, and often the only thing that tells a big gym which desk or
   *  class this person came from. */
  groupLabel: z.string(),
  /** :11385's ordering rule made visible. `gymNotifiedAt` is stamped by the
   *  reminder sweep and is the SAME fact the expiry statement reads before it
   *  is allowed to touch a row — so what the owner sees marked "needs a
   *  decision" and what the machine may expire cannot drift apart. Null means
   *  nobody has been chased about this one yet.
   *
   *  It is NOT the word "reminded" on screen, deliberately: no email and no
   *  push exist, so nothing was DELIVERED anywhere. What is true is that the
   *  app is now flagging it, and the copy says that. */
  gymNotifiedAt: z.string().nullable().default(null),
  /** When the applicant last tapped "Remind them". The front desk seeing "they
   *  asked again" is the whole in-app content of the member's nudge — there is
   *  nowhere else for it to arrive. */
  nudgedAt: z.string().nullable().default(null),
});
export type OrgApplicant = z.infer<typeof orgApplicantSchema>;

export const orgApplicationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(120).optional(),
  })
  .strict();
export type OrgApplicationListQuery = z.infer<typeof orgApplicationListQuerySchema>;

export const orgApplicationPageSchema = z.object({
  items: z.array(orgApplicantSchema),
  nextCursor: z.string().nullable(),
  /** :11385 wants "a count the owner cannot miss". It is an EXACT count over
   *  the whole queue, not this page's length — the console printing
   *  `items.length` would say "3 people waiting" on a page of 3 out of 90
   *  (:10402's rule: a count is exact or a bound, never one page's length). */
  pendingCount: z.number().int(),
});
export type OrgApplicationPage = z.infer<typeof orgApplicationPageSchema>;

/** The applicant's own list, for the card that sits ON TOP of the whole free
 *  app (:11132 clarification 1 — never a locked or waiting SCREEN).
 *
 *  Carries the org summary because a person who applied needs to be told
 *  WHICH gym they are waiting on, by name. */
export const myOrgApplicationSchema = orgApplicationSchema.extend({
  org: orgSummarySchema,
});
export type MyOrgApplication = z.infer<typeof myOrgApplicationSchema>;

export const myOrgApplicationsResponseSchema = z.object({
  applications: z.array(myOrgApplicationSchema),
});
export type MyOrgApplicationsResponse = z.infer<typeof myOrgApplicationsResponseSchema>;

/** The front desk's tap. A union again, because `already_confirmed` carries no
 *  membership: that branch did not create one, and echoing a row this request
 *  did not write is how a screen ends up reporting something it never saw. */
export const confirmApplicationResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), membership: membershipSchema }),
  z.object({ status: z.literal("already_confirmed") }),
]);
export type ConfirmApplicationResponse = z.infer<typeof confirmApplicationResponseSchema>;

export const rejectApplicationResponseSchema = z.object({ status: z.literal("rejected") });
export type RejectApplicationResponse = z.infer<typeof rejectApplicationResponseSchema>;

/** THE WAITING MEMBER'S NUDGE (:11385 mechanic 3, ratified 2026-08-20 at one a
 *  day). A union rather than a 200/429 split, and the reasoning is the module's
 *  own: `already_confirmed` taught it. Once a day is a PRODUCT RULE the screen
 *  has to explain in words, not a transport failure — a 429 would arrive at the
 *  client indistinguishable from the request floor above it, and the screen
 *  would have to guess which one it was looking at.
 *
 *  **Both arms carry the same two fields on purpose.** The sentence the screen
 *  needs is "you can do this again tomorrow", and it is equally true whether
 *  this tap sent one or found today's already sent — so both arms can say it
 *  without the client computing a date of its own (R3.1's habit, applied to a
 *  time rather than a price). */
export const nudgeApplicationResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("sent"),
    nudgedAt: z.string(),
    nextNudgeAt: z.string(),
  }),
  z.object({
    status: z.literal("already_sent"),
    nudgedAt: z.string(),
    nextNudgeAt: z.string(),
  }),
]);
export type NudgeApplicationResponse = z.infer<typeof nudgeApplicationResponseSchema>;

/** Part 3 §4.3's remove flow — the counterpart to confirm, and the reason
 *  confirm is no longer a one-way door.
 *
 *  **KD RULING 2026-08-19, on being shown that a confirmed member could not be
 *  removed by anybody:** *"if someone joins once can not be removed what is
 *  this"*. He is right, and the gap was real — before this, the ONLY thing in
 *  the product that ever set `removed_at` was a person deleting their entire
 *  account (`users/repo.ts`, the DPDP Day-0 cascade).
 *
 *  **`removed` is a statement about the state, not about this request**, which
 *  is what makes a second tap idempotent (:12227 L-3's asymmetry, avoided
 *  rather than repeated): the answer means "this person is not in your gym
 *  now", true whether this call closed the row or the previous one did.
 *
 *  Kd's rule for what it costs the member, ruled in the same breath: *"that
 *  user losses the parks and need to take personal subscriptions"* — which is
 *  already how the resolver behaves, since it counts a membership only while
 *  `removed_at` is null. Their own workouts, streak and history are untouched;
 *  §4.3's "your workouts are yours forever". */
export const removeMemberResponseSchema = z.object({ status: z.literal("removed") });
export type RemoveMemberResponse = z.infer<typeof removeMemberResponseSchema>;

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
