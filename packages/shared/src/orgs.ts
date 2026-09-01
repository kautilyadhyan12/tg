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
 *  this ruling removes.
 *
 *  **THAT PARAGRAPH STILL GOVERNS THIS LIST EVEN THOUGH IT NO LONGER GOVERNS
 *  THE CURRENCY** (:22215 §3.5 bills CA/GB/the euro area in USD — see the map
 *  below). It reads as if the euro-area enumeration existed to get the CURRENCY
 *  right, and half of it did; the other half is which countries we are open in
 *  at all, which is :10010's *"usa india candan and europe"* and is untouched.
 *  **So Poland and Sweden stay OUT** — not because we would have to guess their
 *  money, but because Kd has never said we sell there. Widening this enum is a
 *  ruling, not a consequence of the currency change. */
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
 *  to the schema above without a currency here.
 *
 *  **CANADA, THE UK AND THE EURO AREA ARE BILLED IN US DOLLARS — KD RULING
 *  2026-08-28 (:22215 §3.5), and it is what :17366 had already ratified:
 *  *"US · CANADA · EUROPE, one USD book"*.** His words, given while ruling the
 *  forced trial prompt in the same message: *"A forced trial pop-up traps gyms
 *  in Canada, the UK and Europe. they also pays in dollar"*.
 *
 *  **THIS WAS CAD/GBP/EUR UNTIL TODAY AND IT WAS A BRICK WALL, WHICH IS WHY THE
 *  RULING ARRIVED ATTACHED TO THE PROMPT RATHER THAN ON ITS OWN.** The seeded
 *  price book has USD and INR rows ONLY, so `startGymTrial` found no plan for a
 *  Canadian gym's currency and answered 409 `no_plan_for_currency` — *"We're not
 *  open for business in your country yet"*. Survivable while the trial was a
 *  button somebody could ignore. **With a prompt that cannot be skipped it
 *  strands that gym on a screen whose only button fails**, which is :22215 §4 in
 *  as many words.
 *
 *  **THE ALTERNATIVE IS DEAD, NOT DEFERRED**: three more price books (CAD, GBP,
 *  EUR) he has never priced. Inventing them is Part 0 rule 4's forbidden shape.
 *
 *  **:10010's NO-FALLBACK RULE IS UNTOUCHED AND THIS IS NOT AN EXCEPTION TO IT.**
 *  That rule forbids handing an unsupported country SOMEBODY ELSE'S money by
 *  default; a country absent from the enum above is still refused outright by
 *  `currencyForCountry` returning null. What changed is the ruled price of a
 *  SUPPORTED country, which is Kd's to set — not a fallback this function
 *  reaches for when it does not know.
 *
 *  A country whose currency is here still needs PLANS in that currency, and
 *  nothing in this file can guarantee that. `orgs.plans.test.ts` walks every
 *  supported country and fails if one of them has no active monthly org plan —
 *  which is the check that would have caught this map before it became a wall.
 *
 *  **CHANGING A ROW HERE DOES NOT MOVE THE GYMS ALREADY STORED UNDER IT, AND
 *  THAT IS THE TRAP IN THIS FILE.** `gyms.currency_display` is written once at
 *  creation and recomputed by `updateOrg` ONLY when the country itself changes
 *  — so a gym that stays put keeps the currency it was created with, for ever,
 *  and `startGymTrial` matches plans on that stored column and not on this map.
 *
 *  **No backfill shipped with the 2026-08-28 change, because on the database
 *  that matters there was nothing to backfill.** Measured by the query this
 *  hazard is actually about — gyms whose `currency_display` disagrees with
 *  `currencyForCountry(country)` — **shared branch: 0. Local: 1.**
 *
 *  **THE FIRST VERSION OF THIS PARAGRAPH COUNTED THE WRONG COLUMN AND WENT
 *  STALE INSIDE ITS OWN COMMIT** (T3 round 1, Low-3). It counted `country`
 *  rather than `currency_display`, and quoted a local figure that this card's
 *  own browser smoke invalidated an hour later by creating a Canadian gym while
 *  the api was still serving the old map. That gym is the local `1`. **The
 *  conclusion did not move — the shared branch still has none — but a
 *  measurement that its own session falsifies is worth recording as one.**
 *
 *  **A future re-ruling of this map will not be so lucky and owes a backfill in
 *  its own card.** Run the disagreement query above first; do not infer it from
 *  a count of countries. */
export const COUNTRY_CURRENCY: Readonly<Record<SupportedCountry, string>> = {
  US: "USD",
  IN: "INR",
  CA: "USD",
  GB: "USD",
  AT: "USD", BE: "USD", HR: "USD", CY: "USD", EE: "USD", FI: "USD", FR: "USD",
  DE: "USD", GR: "USD", IE: "USD", IT: "USD", LV: "USD", LT: "USD", LU: "USD",
  MT: "USD", NL: "USD", PT: "USD", SK: "USD", SI: "USD", ES: "USD",
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
  /** WHERE THE GYM IS — ISO 3166-1 alpha-2, and `null` for every gym created
   *  before migration `0014`, because the wizard collected it and the server
   *  threw it away.
   *
   *  It is on the response because `currencyDisplay` cannot answer the question:
   *  the map runs one way, and EUR is twenty countries. A console editing a
   *  gym's country needs to know which one it holds now, or the box reads back
   *  empty after every save.
   *
   *  **`.default(null)` for :12660's expand-then-contract reason**, and this one
   *  is load-bearing rather than ceremonial: `orgsApi.js` treats a contract
   *  mismatch as a hard failure and the console treats a failed read as an error
   *  card, so a REQUIRED field would blank the whole gym list during any window
   *  where the web is newer than the api. `null` is also a real answer here
   *  ("nobody ever told us"), which is why it is not `.optional()` alone. */
  country: z.string().nullable().default(null),
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

/** EDIT THE GYM'S OWN DETAILS — `PATCH /v1/orgs/:gymId`, gated on `org.manage`.
 *
 *  Until this existed a gym's row was insert-only after `createOrgAttempt`
 *  (nineteen routes in the module, not one of them a PATCH), so a typo in the
 *  name was on every screen for ever and a gym set up in the wrong zone had its
 *  day boundaries wrong for ever — `gyms.timezone` is the only thing the rollup
 *  worker asks when it decides where a gym's day ends (playbook trap #8).
 *
 *  **PARTIAL, and an absent key is not the same as a null one.** Omit `city` and
 *  it is left alone; send `city: null` and it is cleared. That distinction is
 *  the whole reason this is a PATCH rather than a PUT — a screen that edits one
 *  field must not be able to blank three others it never displayed (C26, and
 *  :13920's pause switch for the same reason one component away).
 *
 *  **`.strict()`, so the fields NOT here are refused rather than ignored.**
 *    - `currencyDisplay` — the server derives it from `country` and a
 *      client-sent one is refused, exactly as at create (R3.1, :10010). Money a
 *      caller can name is money a caller can choose.
 *    - `slug` — minted once against `RESERVED_SLUGS`, and a gym named "New"
 *      already collides with the console's own create form (:10596 L-2).
 *      Renaming an address is a separate and harder question with its own line.
 *    - `orgType` — changing a gym into a studio changes who may read the roster
 *      (§2.3's trainer hold-back reads it), so it is an authorisation change
 *      wearing a settings field's clothes.
 *    - `locale` — a control with no effect; nothing reads the column and its own
 *      `OWED.md` line says so. Offering it would be a box that does nothing.
 *  A refusal is louder than a silent strip: an owner who typed a currency finds
 *  out that we decide it, instead of watching their change vanish. */
export const updateOrgRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    city: z.string().trim().max(120).nullable(),
    /** ISO 3166-1 alpha-2. Shape only here — whether we are OPEN there is the
     *  service's answer, so the refusal can be a sentence a gym owner
     *  understands rather than an enum error. Identical to create's, on purpose.
     *
     *  **KD RULING 2026-08-26 — THIS FIELD FREEZES THE DAY THE GYM STARTS
     *  PAYING** (*"a gym should not be able to change the country as it will
     *  create problem of money"*). It decides `currency_display`, which is the
     *  money the gym is BILLED in. The SERVER enforces it — so this schema
     *  accepting the field is not the same as the field being changeable, and a
     *  console must handle the refusal rather than only hiding the box (R3.3).
     *
     *  **WHAT IS REFUSED IS A CHANGE THAT MOVES THE MONEY, not any mention of
     *  the country — T3 round 1 C/H-1/C/H-2.** A paying gym on a subscription
     *  past `trialing` gets a 409 `currency_locked` only when the new country
     *  resolves to a DIFFERENT currency. So a settings form may safely send the
     *  country back unchanged with a name edit (the first version refused that
     *  whole save), a pre-`0014` gym may record the country it is already billed
     *  for, and France → Germany is allowed because both are EUR.
     *
     *  **He first said "lock it outright" and refined it after being shown what
     *  the providers do**: Stripe refuses a currency change once a customer has
     *  been invoiced once, and Paddle refuses a COUNTRY change on a live
     *  subscription outright — but NEITHER freezes from day one, because before
     *  any money moves there is nothing to protect and a gym that mistyped its
     *  country on the first screen of signup would be stuck for ever. The
     *  card-less 30-day trial (:16548) is deliberately NOT a lock, for the same
     *  reason: it is the moment before the typo starts to cost. */
    country: z.string().trim().length(2),
    /** PROVEN to name a real IANA zone, not merely bounded in length — the same
     *  refine create uses. A junk zone written here is a permanent row, and the
     *  rollup that eventually reads it cannot tell "Mars/Olympus" from a zone it
     *  simply does not know. */
    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, {
      message: "not a known IANA time zone",
    }),
  })
  .partial()
  .strict()
  /** AN EMPTY PATCH IS A 400 (:13803's precedent, same module). A request that
   *  asks for nothing is a client bug, and answering 200 to it teaches a screen
   *  that its save worked when it never sent anything. */
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be sent",
  });
export type UpdateOrgRequest = z.infer<typeof updateOrgRequestSchema>;

/** Wrapped in `{ org }` rather than served bare, matching
 *  `createOrgResponseSchema` — a bare object leaves no room for the next thing
 *  this route has to say (a warning about the currency it just moved, say)
 *  without breaking every reader. */
export const updateOrgResponseSchema = z.object({ org: orgSummarySchema });
export type UpdateOrgResponse = z.infer<typeof updateOrgResponseSchema>;

export const createOrgResponseSchema = z.object({
  org: orgSummarySchema,
  /** Part 3 §4.0 step 4 — the first code is created WITH the org, never as a
   *  second call the owner could skip and end up with an org nobody can join. */
  joinCode: joinCodeSchema,
});
export type CreateOrgResponse = z.infer<typeof createOrgResponseSchema>;

/** Part 4 §3.3's own CHECK, as a parser. The repo parses the column through this
 *  rather than casting it, for the reason `orgStatusSchema` exists: a value the
 *  database grew and the code has never heard of must fail loudly at the
 *  boundary, not flow into a `switch` that silently does nothing (R2.3). */
export const orgSubscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
]);
export type OrgSubscriptionStatus = z.infer<typeof orgSubscriptionStatusSchema>;

/** WHAT THE GYM IS ON — the three facts a console can render without knowing
 *  anything about how we bill (R3.1: the server decides, the client draws).
 *
 *  (This block sat above `orgSubscriptionStatusSchema` for four commits,
 *  documenting a symbol one line below the one it describes — T3 round 1, Low-4.)
 *
 *  **Deliberately NOT the plan's code, price or name.** A screen that knows it is
 *  on `org_b1_us_m` is a screen one step from doing money arithmetic, which R10.4
 *  forbids, and the code is an internal key with no user meaning. What a person
 *  actually asks is *"how long have I got"* and *"how many members can I have"* —
 *  which is `trialEndsAt` and `seatCap`, both computed here.
 *
 *  `seatCap` is nullable because `plans.seat_cap` is: a capless tier is a real
 *  shape in the price book. Neither absence may be rendered as a number
 *  (:5807). */
export const orgSubscriptionSchema = z.object({
  status: orgSubscriptionStatusSchema,
  /** WHEN THE TRIAL ENDS OR ENDED — null only when this subscription never had
   *  a trial at all.
   *
   *  **NOT "null when this is not a trial", which is what this line said until
   *  T3 round 1 (Low-5).** Nothing clears the column when a subscription leaves
   *  `trialing`, so once billing exists a PAYING gym answers with the date its
   *  old trial ran out — a past date under a field the client had been promised
   *  would be null. **Gate on `status`, never on this being null.** Unreachable
   *  today only because no subscription has ever left `trialing`; the screen that
   *  renders this field is the very next card. */
  trialEndsAt: z.string().nullable(),
  /** Live members this plan admits, or null for a capless tier. */
  seatCap: z.number().int().positive().nullable(),
});
export type OrgSubscription = z.infer<typeof orgSubscriptionSchema>;

/** Starting the gym's own 30-day trial.
 *
 *  **`already_subscribed` is a SUCCESS arm, not an error**, and it is the same
 *  instinct as `already_member` and `already_confirmed` one file over: an owner
 *  pressing a button twice is a person pressing a button twice. The caller asked
 *  for the gym to be on a plan and the gym is on a plan, so it answers with the
 *  state rather than with a complaint. Which press created it is the audit log's
 *  business (:12227 L-3).
 *
 *  The two REFUSALS are not arms here — they are 409s with their own outcome
 *  names (`trial_already_used`, `no_plan_for_currency`), because neither leaves
 *  the gym in a state there is anything to report about. */
export const startOrgTrialResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("started"), subscription: orgSubscriptionSchema }),
  z.object({ outcome: z.literal("already_subscribed"), subscription: orgSubscriptionSchema }),
]);
export type StartOrgTrialResponse = z.infer<typeof startOrgTrialResponseSchema>;

/** ONE PLAN A GYM COULD BUY, as the subscribe prompt draws it — Kd's ruling of
 *  2026-08-28 (:22697): a second gym's owner, whose one trial is spent, is shown
 *  *"the real plans at their real prices"*.
 *
 *  **THIS IS THE FIRST TIME A PRICE HAS LEFT THIS SERVER.** Grep-verified before
 *  it was written: there was no plans or pricing endpoint anywhere in the api
 *  (:22697 §3.2), while the book itself has been seeded and live since :18488.
 *
 *  **IT DOES NOT CONTRADICT `orgSubscriptionSchema`'S REFUSAL TO CARRY A PRICE,
 *  and the difference is the whole design.** That schema deliberately withholds
 *  the plan's code, price and name because a console that knows what it is ON
 *  is one step from doing money arithmetic about it (R10.4). This schema is not
 *  about what a gym is on — it is a PRICE LIST, and a price list with no prices
 *  is not one. What both obey is the same rule: the client never computes a
 *  money value, it only draws one the server computed.
 *
 *  **`priceLabel` IS FORMATTED BY THE SERVER, ON PURPOSE, AND IT IS THE ONLY
 *  MONEY FIELD.** The minor-unit integer is deliberately NOT sent beside it.
 *  Sending both would put a second source of the same number on the wire, and
 *  the client dividing by 100 to render it is exactly the arithmetic R10.4 and
 *  R6.1 exist to keep away from a screen — plus the divisor is not even
 *  constant across currencies. One field, already a sentence.
 *
 *  **NO DISPLAY NAME, BECAUSE THE DATABASE HAS NONE.** `plans.name_key` holds a
 *  translation key (`plan.org_b1_us_m`) and this product has no translation
 *  table to resolve it against — verified, not assumed. Inventing "Band 1" or
 *  "Starter" here would be a chat naming Kd's products (R0.2), so the plan is
 *  identified by the only human fact the row actually carries: how many members
 *  it admits. `seatCap` is that number, and it is null for a capless tier, which
 *  a screen must render as a word and never as a zero (:5807).
 *
 *  `code` is the row's identity — a stable key for a list, and what a checkout
 *  will one day have to name. It is NOT for display; it means nothing to a
 *  person. */
/** Part 4 §3.3's `plans_interval_check`, as a parser — `orgStatusSchema`'s own
 *  reason: a value the database grew and this code has never heard of must fail
 *  loudly at the boundary rather than flow into a screen as an unknown word. */
export const planIntervalSchema = z.enum(["month", "year"]);
export type PlanInterval = z.infer<typeof planIntervalSchema>;

export const orgPlanOfferSchema = z.object({
  code: z.string().min(1),
  priceLabel: z.string().min(1),
  currency: z.string().min(1),
  interval: planIntervalSchema,
  seatCap: z.number().int().positive().nullable(),
});
export type OrgPlanOffer = z.infer<typeof orgPlanOfferSchema>;

/** The gym's own price list, in the gym's own currency.
 *
 *  **AN OBJECT RATHER THAN A BARE ARRAY**, on `myOrgsResponseSchema`'s
 *  precedent: a top-level array is the one JSON shape that cannot grow a field
 *  later without breaking every reader.
 *
 *  **AN EMPTY LIST IS A REAL ANSWER AND IT IS A BRICK WALL.** It means the gym's
 *  currency has no active monthly plan, and behind an unskippable prompt that is
 *  a gym stranded with nothing to buy — :22215 §4's exact shape, and what the
 *  CA/GB/euro-area currency ruling was made to prevent.
 *
 *  **WHAT GUARDS IT, STATED PRECISELY, BECAUSE THIS SENTENCE OVERCLAIMED ONCE**
 *  (T3 round 1, Low-4). `orgs.plans.test.ts` walks every supported country
 *  through `currencyForCountry` and fails if one of them reaches an empty book.
 *  **That covers the MAP. The route reads `gyms.currency_display`, which is a
 *  STORED COLUMN the map only writes at creation** — so a gym still carrying a
 *  currency the book has since dropped is outside the walk, and gets `{plans:
 *  []}` with a 200. The old wording said the walk made an empty list impossible;
 *  it makes it impossible for a gym created TODAY, which is a different claim
 *  and is :15010/:19960's "a guard whose only proof is that the code looks
 *  right".
 *
 *  Bounded rather than closed: the disagreeing set is empty on the shared branch
 *  and cannot grow, because `updateOrg` recomputes through the same map. **The
 *  card that builds the subscribe prompt is what turns this from a 200 with an
 *  empty list into somebody staring at a wall, and it should decide there
 *  whether the SERVICE ought to refuse instead** — the way `no_plan_for_currency`
 *  already does one function over. Not decided here (R1.1). */
export const orgPlansResponseSchema = z.object({
  plans: z.array(orgPlanOfferSchema),
});
export type OrgPlansResponse = z.infer<typeof orgPlansResponseSchema>;

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
 *  **`paused`/`expiresAt`/`maxUses`/`joined` are not decoration.** The join path
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
  /** null = no limit on how many people may be in through this code. */
  maxUses: z.number().int().nullable(),
  /** PEOPLE IN THE GYM NOW WHO CAME THROUGH THIS CODE — not times it was used.
   *
   *  It was `uses` until Kd's smoke of 2026-08-21 read "2 people have joined with
   *  it" off a code ONE person had ever used: they joined, were removed, and
   *  joined again, and the old field counted both claims. A sentence about PEOPLE
   *  over a count of EVENTS is a false thing on screen (:5807), and the same
   *  number gates `maxUses` at the door — so a member who left used to take their
   *  place in the limit with them.
   *
   *  The owner is NOT in it. Their §4.0-step-6 seat is `complimentary` and carries
   *  the first code's id, so counting it would tell every gym that one more person
   *  had joined than ever did — and Kd's own reason for asking is that an owner
   *  should never be counted against their own gym. */
  joined: z.number().int(),
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
 *  than an echo of the request: `joined` and `label` were never in the request,
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

/** Taking a finished code off the gym's list.
 *
 *  **No row comes back, and that is the point**: the code has left the list, so
 *  there is no state for a screen to draw from it — the panel re-reads the list
 *  like it does after every other change. `status` is a literal for the same
 *  reason `removeMemberResponseSchema`'s is: it means "this code is not on your
 *  list now", equally true whether this call removed it or the previous tap did.
 *
 *  It exists at all because every other answer this module gives is parsed
 *  through a shared schema and this one was a bare object literal (T3 L-8) — the
 *  one shape a typed client could not see. */
export const removeOrgCodeResponseSchema = z.object({ status: z.literal("removed") });
export type RemoveOrgCodeResponse = z.infer<typeof removeOrgCodeResponseSchema>;

/** One row of "my orgs". A single row carries BOTH relationships because the
 *  default owner IS a member (Part 3 §4.0 step 6) — two lists would show the
 *  same gym twice and invite a screen that double-counts it. */
export const myOrgSchema = orgSummarySchema.extend({
  staffRole: orgRoleSchema.nullable(),
  /** WHAT THE CALLER MAY DO AT THIS GYM — their OWN effective set, not anybody
   *  else's (T3 round 1 C/H-1).
   *
   *  **Without this the console had no way to ask the right question.** The
   *  server decides on the TICK (`requirePrivilege`), the screens decided on the
   *  ROLE NAME, and those two were the same answer only while nothing could
   *  grant a tick — which is exactly what the ticks card built. An owner ticking
   *  `codes.manage` onto a trainer bought them a power the server allowed and no
   *  screen would draw. :11429's seam, finally reaching the client.
   *
   *  **`staffRole` STAYS.** It is what a screen shows a person about themselves,
   *  and the Staff screen's role button still writes it. What changes is that no
   *  screen may DECIDE on it (R3.3 — and hiding was never the enforcement; the
   *  server's 403 is, and still is).
   *
   *  **OPTIONAL, for the same expand-then-contract reason as everything else on
   *  this response** (:12660): absent means the api is older than this bundle,
   *  and the client falls back to the ROLE's own defaults — i.e. exactly the
   *  behaviour that shipped before the ticks, which is right for every row
   *  nobody has ticked. Falling back to "no powers" would strip a real manager's
   *  controls the moment the web deployed first.
   *
   *  **Strings, not the enum**, for the reason written out at
   *  `orgStaffSchema.privileges`: an older browser must not be destroyed by a
   *  newer server's seventh privilege.
   *
   *  **`[]` is a real answer and is not the same as absent** — a member who
   *  staffs nothing has no powers here, and that must not read as "fall back to
   *  a role you do not hold". */
  privileges: z.array(z.string()).optional(),
  /** WHAT THE GYM IS ON — the fact §4.2's banner is a state machine over, and
   *  until this field existed the console had no way to ask for it.
   *
   *  `orgSubscriptionSchema` left the server in exactly ONE place before this:
   *  the response to the button that STARTS a trial. So a console could learn a
   *  gym was trialling only in the second after somebody pressed something, and
   *  a reload forgot it — which is why `Overview.jsx` carried a comment saying
   *  the banner slot was absent because "its states are read off `subscriptions`
   *  and billing does not exist". Billing still does not exist; the *state* does,
   *  and this is the read that serves it.
   *
   *  **NULL HAS THREE CAUSES AND THEY DELIBERATELY RENDER THE SAME.** The gym is
   *  on nothing · the caller is not STAFF here (see below) · the api predates
   *  this field and `.default(null)` filled it in. All three mean the console
   *  knows of no plan, and the only honest thing to draw for an unknown state is
   *  nothing at all (:5807). A client that branched on which of the three it was
   *  would be claiming to know something it does not.
   *
   *  **A PLAIN MEMBER IS TOLD NOTHING, and that is a §2.4 decision rather than a
   *  convenience.** This response is read by the member app as well as the
   *  console — it is where "You're a member of Iron House" comes from — and when
   *  a gym's trial runs out is the gym's business, not its members'. The console
   *  filters to `staffRole != null` before drawing anything, so nothing is lost.
   *
   *  **`.default(null)` rather than `.optional()`, for the reason `country`
   *  carries three fields up**: `orgsApi.js` treats a contract mismatch as a hard
   *  failure and the console treats that as an error card, so a REQUIRED field
   *  would blank the whole gym list during any window where the web is newer than
   *  the api. Absent collapses into the same null every other unknown does. */
  subscription: orgSubscriptionSchema.nullable().default(null),
  /** LIVE MEMBERS OCCUPYING ONE OF THE GYM'S PAID PLACES — the numerator of
   *  §4.3's seat meter, and of §4.2's "87/100 seats" row.
   *
   *  **It is NOT the length of a roster page and must never be replaced by one.**
   *  The roster is cursor-paginated fifty at a time, so `items.length` says "50
   *  seats used" at a gym of six hundred; `memberCountLabel` prints `50+` for
   *  exactly that reason. A meter needs an exact count over the whole gym, which
   *  only the server can take.
   *
   *  **Counted by the rule the SEAT CAP itself counts by** — live, not
   *  complimentary, and not staff — so the meter and the door cannot disagree
   *  about who costs money. That rule is written out in three places now
   *  (`claimSeat`, `listMembers`, `listOrgsForUser`); a shared `sql` fragment is
   *  R3.8's forbidden shape, and what stops the copies drifting is a test that
   *  drives the meter and the refusal on ONE fixture (:14013's precedent).
   *
   *  Null for a non-staff caller and for an api too old to say, exactly as
   *  `subscription` above. Never rendered as a zero: "0 of 300 seats" and "we
   *  could not ask" are different sentences. */
  seatsUsed: z.number().int().nonnegative().nullable().default(null),
  /** HAS THIS GYM'S OWNER ALREADY SPENT THEIR ONE FREE TRIAL, EVER — the single
   *  fact that picks which arm the unskippable prompt shows (:22697).
   *
   *  **IT EXISTS BECAUSE `subscription` CANNOT ANSWER IT AND MUST NOT BE MADE
   *  TO.** That field is the gym's LIVE plan and its LATERAL serves §4.1's three
   *  granting statuses only, so a gym whose trial ENDED and a gym that never
   *  started one are the same `null` — byte for byte. That identity is what put
   *  *"Start your 30-day free trial"* over a button answering 409
   *  `trial_already_used` (:22341 §7, the finding the sweep card reported
   *  against itself), and it is what the expiry smoke's step 6 was staged over.
   *
   *  **WIDENING THE SUBSCRIPTION LATERAL WAS THE OTHER WAY AND IT IS THE WRONG
   *  ONE.** `subs_one_live_uq` is a PARTIAL index over exactly those three
   *  statuses, so it is the reason that `LIMIT 1` returns a well-defined row.
   *  Add `expired` and `canceled` to the set and a gym may have many matching
   *  rows with nothing choosing between them — the `LIMIT 1` becomes arbitrary
   *  (:12731's "a partial unique index means one row" trap, from the other side).
   *  A separate boolean asks the separate question instead.
   *
   *  **IT IS ANCHORED ON THE GYM'S OWNER, NOT ON THE CALLER, and that is what
   *  makes it a per-gym fact rather than a per-person one.** The rule is one
   *  trial per OWNER ever (Part 5 §12), and `startGymTrial` reads the evidence
   *  off `gyms.owner_user_id` of the gym being started — so a manager holding
   *  `billing.manage` on somebody else's gym is told about THAT owner's trial
   *  history, which is exactly the answer that predicts whether their press
   *  would succeed.
   *
   *  **STAFF ONLY, and null is "we could not ask", never "no".** A plain member
   *  is told nothing, on the same §2.4 boundary that withholds `subscription`
   *  and `seatsUsed` from them. `.default(null)` carries an api older than this
   *  bundle. **A prompt that cannot be closed must never be drawn on a null** —
   *  the cost of guessing wrong here is a person sealed out of their own
   *  console, so the client requires a definite answer before it blocks
   *  anything. */
  ownerTrialUsed: z.boolean().nullable().default(null),
  /** IS THIS GYM'S CONSOLE READ-ONLY RIGHT NOW — Part 3 §4.2's *"the console
   *  stays read-only 14 days, then archived"*, and Kd's ruling of 2026-08-29
   *  that it stops **every member of staff**, not only whoever can pay.
   *
   *  **TRUE MEANS THE SERVER WILL REFUSE EVERY WRITE ON THIS GYM.** It is the
   *  same answer `requireWritablePrivilege` reaches on the way into the twelve
   *  routes that change something — join codes, letting people in, the roster,
   *  the staff list, the gym's own details — so the console can grey out a
   *  control instead of drawing one whose every press is a 409.
   *
   *  **HIDING IS NOT THE ENFORCEMENT AND THIS FIELD IS NOT PRETENDING TO BE**
   *  (R3.3). The refusal is server-side and fires whatever the caller believes;
   *  a client that never read this field would still be unable to change
   *  anything. What it buys is a screen that says something TRUE about why.
   *
   *  **IT EXISTS RATHER THAN BEING DERIVED FROM `subscription === null`, AND
   *  THE REASON IS THE ONE THING TO READ TWICE.** That null has three causes and
   *  they are deliberately indistinguishable (the field above says so in as many
   *  words): the gym is on nothing · the caller is not staff · the api predates
   *  the field. Two of those are "we could not ask". **A field a console cannot
   *  be sure of must never drive a lock-out** — the rule the unskippable prompt
   *  is built on (mutant C97), where guessing wrong seals a person out of their
   *  own console. So the definite answer gets its own three-state field:
   *  `true`/`false` are the server's own computation, and **`null` means "we
   *  could not ask", never "locked"**. An older api sends nothing,
   *  `.default(null)` fills it in, and the console greys out nothing at all —
   *  which is safe precisely because the server is the enforcement.
   *
   *  **IT DOES NOT WIDEN THE SUBSCRIPTION LATERAL, WHICH WAS THE OTHER ROUTE AND
   *  IS THE WRONG ONE** — `subs_one_live_uq` is a PARTIAL index over the three
   *  live statuses, which is what makes that read's `LIMIT 1` well-defined
   *  (:22921, :12731's trap from the other side). This is a separate boolean
   *  asking a separate question, exactly as `ownerTrialUsed` is.
   *
   *  **IT GATES ON STATUS AND NEVER ON A DATE** (:21580 rule (c)): "does this gym
   *  have a live plan", not "how long ago did its trial end". Nothing clears
   *  `trial_ends_at`, so a reader keying on the date would make a PAYING gym
   *  read-only the day billing exists.
   *
   *  **STAFF ONLY, BUT EVERY STAFF ROLE — and that is where it parts company with
   *  `ownerTrialUsed` above.** That field is gated on `billing.manage`, because
   *  the prompt it feeds stops only whoever can pay (:22921 §1). This one is told
   *  to a trainer as well, because Kd ruled the read-only console applies to
   *  everybody: a trainer whose buttons no longer work is owed the sentence
   *  saying why. A plain member is told nothing, on §2.4's boundary. */
  consoleReadOnly: z.boolean().nullable().default(null),
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
  /** **CAN THIS GYM ACT ON THIS REQUEST RIGHT NOW?** False while the gym has no
   *  live plan: Confirm answers 409 for it (:23711), and since Kd's ruling of
   *  2026-08-29 (:24141 §1) the request is HELD rather than expiring under them.
   *  Every applicant-facing surface needs both facts — it must stop promising
   *  "one tap at the front desk", and it must stop counting down to a deadline
   *  that will not arrive.
   *
   *  **IT LIVES HERE, ON THE SHAPE BOTH SURFACES SHARE, AND THAT IS THE POINT.**
   *  The join door's answer and the waiting list are two screens telling one
   *  person the same thing, and the first version of this card put the field on
   *  the LIST alone — leaving `/org/join` (the QR and poster route, where most
   *  people arrive) still saying "ask them now, it takes one tap" about a tap
   *  the server refuses. Two definitions of one fact is how one of them stays
   *  wrong.
   *
   *  **IT ANSWERS THE EFFECT AND NEVER THE CAUSE, DELIBERATELY.** This is served
   *  to somebody who is NOT staff of that gym, so it must not tell them which
   *  gyms have stopped paying — the boundary :23711 §2(a) built the gate's check
   *  order around, and the reason `consoleReadOnly` on `/v1/orgs/mine` is
   *  staff-only. What is theirs to ask is whether their own request can be acted
   *  on. The name generalises with the copy: a later reason a gym cannot confirm
   *  (a seat cap, say) is the same answer and the same sentence.
   *
   *  **`.default(null)` for the `formerOrgs` reason** (:12660, :12878), and
   *  three-state for `consoleReadOnly`'s (C97, :23711): `orgsApi.js` treats a
   *  contract mismatch as a hard failure and the gym card treats a failed read as
   *  SILENCE, so a REQUIRED field would make the whole card vanish during any
   *  window where the web bundle is newer than the API. **`null` means "we could
   *  not ask", never "no"** — an older API renders exactly today's copy, which is
   *  safe because the SERVER is the enforcement: the hold and the 409 are real
   *  whatever this field manages to say. */
  orgCanConfirm: z.boolean().nullable().default(null),
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
  /** Does this person occupy one of the gym's paid places?
   *
   *  **A §2.4 ADDITION, argued rather than waved through** (Kd's finding at the
   *  staff re-smoke, :14953). The roster badge read `complimentary` alone, which
   *  is deliberately never written for staff, so a trainer looked exactly like
   *  somebody the gym pays for — the door and the screen disagreeing about who
   *  costs money. Derived server-side by `claimSeat`'s own count rule; the
   *  screen renders it and never computes it (R3.1).
   *
   *  **THE §2.4 ARGUMENT, CORRECTED BY T3 L-1 — the first version of this
   *  comment was false twice and the outcome it defended is still right.**
   *
   *  It claimed the field "says this place is free, NOT this person is staff".
   *  **That is not true and the inference is exact, not probabilistic**:
   *  `complimentary === false && takesSeat === false` can only mean a
   *  `gym_staff` row in this gym, and both fields ship in the same object. It
   *  also claimed a trainer "learns no more than they already could" —
   *  **also false**: `ROLE_PRIVILEGES` grants `members.read` to trainer and
   *  manager while `staff.manage` is the owner alone, and `listOrgStaff` gates
   *  the staff list on `staff.manage`, so the two roles refused that list with a
   *  403 can now derive it from the roster.
   *
   *  **What IS true, and is the argument: that disclosure is accepted.** §2.4's
   *  enumerated never-see list is member health and personal data — meals,
   *  weight, coach chats, routes — and none of it moves here. What a colleague
   *  learns is a role inside their own gym, rendered as the same word the
   *  owner's row has carried since :10010. **Withholding it from trainers would
   *  trade a disclosure for a FALSEHOOD** — it hands them back the pre-card
   *  defect, a staff colleague drawn as occupying a paid place (:5807 outranks
   *  a tidier boundary). Hiding it is Kd's ruling to make and would need its own
   *  card; it has an `OWED.md` line.
   *
   *  **OPTIONAL for :12660's expand-then-contract reason**, and this is not
   *  timidity: `orgsApi.js` treats a contract mismatch as a hard failure, so a
   *  required key would blank the WHOLE roster with "we couldn't load the
   *  members" during any window where the web is newer than the API — a screen
   *  destroyed to add one badge. Absent, the client falls back to
   *  `complimentary`, i.e. exactly the behaviour that shipped before this. */
  takesSeat: z.boolean().optional(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

export const orgMemberPageSchema = z.object({
  items: z.array(orgMemberSchema),
  nextCursor: z.string().nullable(),
});
export type OrgMemberPage = z.infer<typeof orgMemberPageSchema>;

// ---------------------------------------------------------------------------
// STAFF — Part 3 §4.7 ("list, invite by email/phone with role, change role,
// remove; every staff mutation audit-logged; last-owner removal blocked") and
// §2.2's "Staff management: owner only" row. Kd approved this card 2026-08-21.
// ---------------------------------------------------------------------------

/** The roles this card can HAND OUT, which is deliberately not every role.
 *
 *  **`owner` is absent and that is a deferral, not an oversight.** Making a
 *  second owner is the first half of transferring a gym, and the second half —
 *  what happens to the first owner, whether §4.0 step 6's complimentary seat
 *  follows, whether the outgoing owner keeps billing — is a Kd question nobody
 *  has been asked. Shipping only the widening half would let a gym acquire two
 *  owners with no ruling on what the second one means. Own `OWED.md` line.
 *
 *  The consequence to hold in mind while reading the rest of this file: every
 *  owner is therefore the LAST owner, so `last_owner` is not an edge case here,
 *  it is the only answer removal can give about an owner. */
export const staffAssignableRoleSchema = z.enum(["manager", "trainer"]);
export type StaffAssignableRole = z.infer<typeof staffAssignableRoleSchema>;

/** EVERY TICK THE SERVER CAN ENFORCE. Kd ruling :11429 — "the three roles stay
 *  AND per-staff privilege ticks go on top", the role picking the STARTING
 *  ticks and the ticks being what `requirePrivilege` actually checks.
 *
 *  **It lives HERE rather than in the api because it is now part of the
 *  contract** (R7.2): the staff list serves these strings and the ticks route
 *  accepts them, so a vocabulary defined twice is two vocabularies. The api
 *  re-exports it; `apps/web` reads the same list, which is what stops a screen
 *  offering a box the server has never heard of.
 *
 *  **FINITE AND NAMED ON PURPOSE — a tick nobody defined is a tick nobody
 *  enforces** (:11429). Adding one means adding the check that reads it in the
 *  same card, and the database's own CHECK (migration `0013`) refuses anything
 *  outside this list, so a widened enum without a migration fails loudly rather
 *  than storing a permission that does nothing.
 *
 *  **NOT a scope** (:11429 rule 6). "May see members" is a tick; WHICH members
 *  (§2.2's trainer *assigned/group only*) is a different axis, still blocked on
 *  `gym_staff` having no group column. Conflating them hands a trainer the whole
 *  roster. */
export const ORG_PRIVILEGES = [
  "members.read",
  "codes.invite",
  "codes.manage",
  "members.confirm",
  "members.remove",
  "staff.manage",
  "org.manage",
  "billing.manage",
] as const;
export const orgPrivilegeSchema = z.enum(ORG_PRIVILEGES);
export type OrgPrivilege = z.infer<typeof orgPrivilegeSchema>;

/** Part 3 §2.2's matrix, as the DEFAULT ticks each role starts with.
 *
 *  **IT LIVES HERE FOR THE REASON THE VOCABULARY ABOVE DOES (R7.2), and the
 *  Staff screen is what moved it.** `orgStaffSchema.privileges` is OPTIONAL, so
 *  a screen that meets a row without it has to draw SOMETHING — and the only
 *  honest something is what that person's role grants, which is exactly what
 *  they could do before the column existed. Computing that needs this table, so
 *  either it is contract or the web keeps a second copy of it — and a second
 *  copy is a second answer to "what may a trainer do", which the two sides would
 *  then disagree about silently. The api re-exports it through
 *  `modules/orgs/schemas.ts`; nothing derives it twice.
 *
 *  **This is the TEMPLATE, never the answer.** What somebody may actually do is
 *  the stored set on their row (`privilegesFor` in the api service), and the
 *  server is what enforces it (R3.3, :11429 rule 4). A screen reading this table
 *  is filling a gap in a response, not deciding anything.
 *
 *  `members.read` and `codes.invite` reproduce §2.2's own rows exactly — the
 *  matrix grants "Members list + detail" and "Invite (share code / print
 *  poster)" to all three roles, and the studio/clinic trainer hold-back on the
 *  ROSTER is a separate rule applied at its own call site (§2.3's group
 *  scoping, still unbuildable).
 *
 *  `members.confirm` is an ADDITION — §2.2 predates the application door — and
 *  it is aligned with the matrix's "Remove / restore member" row (owner and
 *  manager, not trainer) because confirming and removing are the same power
 *  pointed in opposite directions: both decide who is inside the gym. Kd was
 *  given that cost before approving: a gym whose front desk is a TRAINER cannot
 *  confirm until an owner ticks the box, and that widening is one tick rather
 *  than a redesign (:11429 rule 3 — ticks may widen, not only narrow).
 *
 *  `members.remove` is §2.2's "Remove / restore member" row LITERALLY — owner
 *  and manager, never trainer (the matrix hides Remove from a trainer by name,
 *  §4.3). It sits beside `members.confirm` because they are the same power in
 *  two directions, and Kd's ruling of 2026-08-19 is that the second direction
 *  has to exist at all: confirming somebody was a one-way door until it did.
 *
 *  `codes.manage` is §2.2's "Create / rotate / expire codes" row LITERALLY —
 *  owner and manager, never trainer — and it is DELIBERATELY NOT the same tick
 *  as `codes.invite`, which the same matrix grants to all three. The two rows
 *  are one line apart in §2.2 and mean opposite things: a trainer handing a
 *  member the poster is inviting; a trainer switching the gym's door off is not
 *  something the matrix ever granted. Merging them would silently widen a
 *  trainer's power under cover of a read they already had.
 *
 *  `staff.manage` is §2.2's "Staff management" row LITERALLY — the ONE row in
 *  that matrix granted to the owner and to nobody else, and the line every
 *  product in this market draws in the same place (:11429's industry check:
 *  money and staff belong to the owner alone). **It gates the READ as well as
 *  the writes, which is narrower than §2.2 strictly requires** — the matrix has
 *  no "view staff" row at all, so the choice was between owner-only and
 *  inventing a grant. Narrow is the reversible direction: widening it later is
 *  one tick under :11429 rule 3, whereas a manager who has been reading the
 *  staff list for a month cannot be un-shown it.
 *
 *  `org.manage` is "edit gym details" — the gym's own name, city, country and
 *  time zone. **KD RULING 2026-08-26, owner-only BY DEFAULT**, given at the plan
 *  gate against the cited alternative of reusing `staff.manage`; that
 *  alternative needs no migration and was recommended AGAINST on :13803's
 *  precedent, because two rows meaning different things get different
 *  privileges. §2.2 has no row for it at all — the matrix predates a gym being
 *  able to correct anything about itself — so it is an ADDITION (:9809's class),
 *  landed on the owner's line because the fields it edits are the gym's
 *  identity and its BILLING COUNTRY.
 *
 *  **"By default" is the whole of it: this is deliberately absent from
 *  `OWNER_ONLY_PRIVILEGES` below**, so an owner who wants their manager to fix a
 *  typo can tick it across (:11429 rule 3). It is absent from the api's
 *  `LAST_OWNER_REQUIRED_PRIVILEGES` for the matching reason — a last owner
 *  ticked down from it still holds `staff.manage` and can tick it straight back,
 *  so there is no lockout to guard against.
 *
 *  `billing.manage` is "start, change or end the gym's subscription" — and
 *  unlike `org.manage` it is NOT an addition: §2.2 has the row already, and it is
 *  the strictest one in the matrix (*"Billing (view, upgrade, payment method,
 *  cancel) | ✔ | — | —"*, `03-part3-org-console.md:99`). The owner, nobody else.
 *
 *  **It is a SEPARATE tick from `org.manage` on :13803's precedent**, not merged
 *  into it: `org.manage` edits a detail, this one starts a 30-day clock, caps the
 *  roster at the plan's seat cap and freezes the gym's billing country
 *  (:19560). Merging them would mean an owner who ticked "let my manager fix our
 *  address" had also handed over the money.
 *
 *  **Owner-only by DEFAULT, like `org.manage`: deliberately absent from
 *  `OWNER_ONLY_PRIVILEGES`**, so an owner whose office manager handles invoices
 *  can tick it across (:11429 rule 3). **But it IS in the api's
 *  `LAST_OWNER_REQUIRED_PRIVILEGES`, and that closes an `OWED.md` line rather
 *  than opening one** — :11429 rule 2 names TWO lockout doors, *"ticking away the
 *  last owner's billing/staff-management is the same lockout by another door"*,
 *  and the guard has only ever covered `staff.manage` because billing had no tick
 *  to cover. The asymmetry with `org.manage` is real and is the reason: an owner
 *  ticked down from `org.manage` still holds `staff.manage` and can tick it
 *  straight back, but a gym whose last owner cannot reach billing cannot PAY, and
 *  nothing inside the gym repairs that. */
export const ROLE_PRIVILEGES: Readonly<Record<OrgRole, readonly OrgPrivilege[]>> = {
  owner: [
    "members.read",
    "codes.invite",
    "codes.manage",
    "members.confirm",
    "members.remove",
    "staff.manage",
    "org.manage",
    "billing.manage",
  ],
  manager: ["members.read", "codes.invite", "codes.manage", "members.confirm", "members.remove"],
  trainer: ["members.read", "codes.invite"],
};

/** PRIVILEGES ONLY AN OWNER'S ROW MAY CARRY — §2.2's owner-alone rows, and the
 *  enforcement of :11429 rule 1 ("only an OWNER may change anybody's ticks").
 *
 *  **Contract for the same reason the table above is** (:15534 C/H-1): the
 *  server refuses one of these on a non-owner row with 409
 *  `owner_only_privilege`, so a screen that does not know the list will draw a
 *  box whose every save fails. It is what stops staff management being handed to
 *  a manager, which the reviewer proved could end with the owner 403'd on their
 *  own roster.
 *
 *  **Hiding a box is NOT the enforcement** (:11429 rule 4, R3.3): the 409 is,
 *  and it stays wherever the request comes from. This list exists so the screen
 *  does not OFFER what it knows will be refused — the defect that rule names in
 *  advance — and a screen reading it still has to handle the refusal.
 *
 *  It is a LIST rather than one name because §2.2 puts money in the same
 *  owner-alone row and BILLING has no tick yet; the day one exists it belongs
 *  here and on the api's `LAST_OWNER_REQUIRED_PRIVILEGES` in the same commit
 *  (`OWED.md` carries that line). */
export const OWNER_ONLY_PRIVILEGES: readonly OrgPrivilege[] = ["staff.manage"];

/** One person who runs this gym.
 *
 *  **`email` IS on this row, and it is checked against §2.4 rather than waved
 *  through.** That boundary governs what an org sees about its MEMBERS, and its
 *  never-see list is meals, body measurements, coach conversations, run routes
 *  and out-of-membership activity — contact details are not on it. §4.7's own
 *  staff flow is "invite by email", so the email is the value the owner TYPED to
 *  create this row in the first place; showing it back is not disclosure. It
 *  earns its place because two people can share a display name and the tap this
 *  screen offers hands somebody the keys to the gym.
 *
 *  `isYou` is computed by the SERVER against the caller. :10726's Low-3 is the
 *  precedent and the reason it is not inferred client-side: "(you)" was once
 *  derived from a seat being complimentary, which was true only while one
 *  caller happened to behave a certain way. */
export const orgStaffSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  /** Null for an OAuth-only account: `users.email` is nullable by design. */
  email: z.string().nullable(),
  role: orgRoleSchema,
  /** WHAT THIS PERSON MAY ACTUALLY DO — the effective set the server enforces,
   *  not the role's template. The role picked it when they were appointed; an
   *  owner can then tick boxes on or off for this one person (:11429, amended
   *  :14745 and settled 2026-08-22).
   *
   *  **OPTIONAL for the expand-then-contract reason `takesSeat` is optional
   *  above** (:12660, :15093): `orgsApi.js` treats a contract mismatch as a hard
   *  failure, so a REQUIRED key would destroy the whole Staff screen during any
   *  window where the web is newer than the API. Absent, the screen falls back
   *  to what the role grants by default — which is exactly what shipped before
   *  this card, and is right for every row that has never been ticked.
   *
   *  **No §2.4 question arises**: this list is gated on `staff.manage`, which is
   *  the owner's alone, and it describes what a colleague may DO rather than
   *  anything about a member. */
  /** **STRINGS, NOT THE ENUM, AND THAT IS THE WHOLE POINT OF THE FIELD** (T3
   *  round 1 Low-1, a latent High). This is a READ parsed by whichever build the
   *  BROWSER is running, and the api can gain a privilege before the web
   *  redeploys — `OWED.md` already schedules a billing tick. Under
   *  `z.array(orgPrivilegeSchema)` an older bundle answered a newer server with
   *  `invalid_enum_value`, `orgsApi.readThrough` turned that into a hard contract
   *  failure, and **every owner's Staff screen died until the web caught up** —
   *  precisely the outcome `.optional()` was chosen to prevent, arriving through
   *  the parser instead of the network (:12660, :15093's `takesSeat`).
   *
   *  It also made the card's own carry-through unreachable: `unknownPrivileges`
   *  and its on-screen sentence, and mutant S18, all guarded a path no response
   *  could survive. **Measured before the change, with a positive control** — a
   *  row of known-only values parsed, the same row plus `billing.manage` did not.
   *
   *  **The WRITE side stays the enum on purpose** (`orgStaffPrivilegesRequest`
   *  below): the server is the authority on its own vocabulary and the database
   *  CHECK matches it. Lenient in, strict out. The SCREEN filters to what it has
   *  words for and carries the rest through untouched. */
  privileges: z.array(z.string()).optional(),
  since: z.string(),
  isYou: z.boolean(),
});
export type OrgStaff = z.infer<typeof orgStaffSchema>;

export const orgStaffResponseSchema = z.object({ staff: z.array(orgStaffSchema) });
export type OrgStaffResponse = z.infer<typeof orgStaffResponseSchema>;

/** ADDING SOMEBODY: an email, and it must belong to a LIVE MEMBER of this gym.
 *
 *  **Two reasons, and the second is the one a later chat will want to relax.**
 *  (1) Inviting a person who has no account means SENDING THEM AN EMAIL, and
 *  nothing in this product has ever sent one — `EmailSender` logs an event name
 *  (:11385). A card cannot ship an invite whose delivery does not exist.
 *  (2) Looking a stranger up by email across the whole `users` table turns this
 *  route into an oracle: "no such member" vs "added" would answer *does this
 *  person have an account here* for any address a gym owner cares to type.
 *  Scoping the lookup to the gym's own roster discloses nothing the owner cannot
 *  already read on the Members screen.
 *
 *  Cost, stated rather than discovered: a manager who is not a member has to
 *  join with the gym's own code first — which takes seconds and which the owner
 *  can already do. The invite-a-stranger half has its own `OWED.md` line and
 *  lands with the notifications module. */
export const addOrgStaffRequestSchema = z
  .object({
    /** Bounded at 320 (the RFC's local@domain maximum) so a megabyte of body
     *  never reaches Postgres. NOT `z.string().email()`: the column is `citext`
     *  and the comparison is an equality against rows we already store, so a
     *  format opinion here could only ever reject an address the app itself
     *  accepted at registration. */
    email: z.string().trim().min(3).max(320),
    role: staffAssignableRoleSchema,
  })
  .strict();
export type AddOrgStaffRequest = z.infer<typeof addOrgStaffRequestSchema>;

export const updateOrgStaffRequestSchema = z.object({ role: staffAssignableRoleSchema }).strict();
export type UpdateOrgStaffRequest = z.infer<typeof updateOrgStaffRequestSchema>;

/** CHANGING SOMEBODY'S TICKS. The WHOLE set every time, never a diff.
 *
 *  **Sending the whole set is what makes a stale screen safe.** A diff
 *  (`add: [...]`, `remove: [...]`) applied to a row somebody else has edited
 *  produces a set nobody chose; the whole set means the last writer wins on a
 *  set a human actually looked at, and the audit row can record both ends.
 *
 *  Bounded at the vocabulary's own length so a body cannot carry a megabyte of
 *  repeats; duplicates inside it are de-duplicated by the server rather than
 *  refused, because a repeated tick is not a mistake a human can see. */
export const updateOrgStaffPrivilegesRequestSchema = z
  .object({ privileges: z.array(orgPrivilegeSchema).max(ORG_PRIVILEGES.length) })
  .strict();
export type UpdateOrgStaffPrivilegesRequest = z.infer<typeof updateOrgStaffPrivilegesRequestSchema>;

export const orgStaffMutationResponseSchema = z.object({ staff: orgStaffSchema });
export type OrgStaffMutationResponse = z.infer<typeof orgStaffMutationResponseSchema>;

/** `removed` is a statement about the STATE, not about this request — the same
 *  wording and the same reason as `removeMemberResponseSchema`: a second tap
 *  answers "this person does not run your gym now", which is true whether this
 *  call deleted the row or the previous one did. */
export const removeOrgStaffResponseSchema = z.object({ status: z.literal("removed") });
export type RemoveOrgStaffResponse = z.infer<typeof removeOrgStaffResponseSchema>;

// ---------------------------------------------------------------------------
// OPENING HOURS — Kd ruling 2026-08-31 (:26624), with :26684 and :26736.
// One contract, consumed by the API's validation AND by the console and the
// member's gym card (R7.2), so the two screens cannot disagree about what a
// gym said.
// ---------------------------------------------------------------------------

/** THE THIRD STATE IS THE WHOLE FEATURE'S FAILURE MODE, so it is in the type.
 *
 *  `unset` — nobody has said anything, and members are told NOTHING about
 *  opening times. `open_24h` — Kd's *"or 24 hour open"*, a flag rather than a
 *  fake 00:00–23:59 row. `scheduled` — the week below is the answer, and only
 *  now does a weekday with no sessions mean CLOSED.
 *
 *  Every reader MUST branch on this before drawing a word (:26736): a gym that
 *  never filled the form in and a gym that is genuinely shut look identical
 *  from the rows alone, and printing "Closed" for the first is :5807
 *  Critical/High. */
export const gymHoursModeSchema = z.enum(["unset", "open_24h", "scheduled"]);
export type GymHoursMode = z.infer<typeof gymHoursModeSchema>;

/** ISO 8601 weekday: 1 = Monday … 7 = Sunday, matching Postgres `ISODOW`. JS
 *  `getDay()` is 0 = Sunday — the CLIENT converts, in one place, or the gym
 *  closes on the wrong day. */
export const gymWeekdaySchema = z.number().int().min(1).max(7);

/** ONE SESSION THE GYM IS OPEN FOR — minutes from midnight in the gym's own
 *  time zone.
 *
 *  **The refine is what makes a bad range a 400 the client can explain rather
 *  than a 500 Postgres produced** from `gym_hours_order_check`. The database
 *  keeps its CHECK anyway: this schema guards the door, the constraint guards
 *  the table, and a guarantee with one enforcement point is a guarantee that
 *  ends the day somebody adds a second writer.
 *
 *  `closesMinute` may be 1440 (midnight at the end of the day) and `opensMinute`
 *  may not. Sessions never wrap past midnight — 22:00–02:00 is two rows. */
export const gymSessionSchema = z
  .object({
    opensMinute: z.number().int().min(0).max(1439),
    closesMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((s) => s.closesMinute > s.opensMinute, {
    message: "A session must end after it starts.",
    path: ["closesMinute"],
  });
export type GymSession = z.infer<typeof gymSessionSchema>;

/** One weekday and everything the gym is open for on it. An absent weekday and
 *  a weekday with an empty list mean the same thing — no sessions — and the
 *  server normalises to the latter so a reader never has to know which it got. */
export const gymDayScheduleSchema = z
  .object({
    weekday: gymWeekdaySchema,
    /** Bounded so a body cannot carry ten thousand rows for one day. **24 is
     *  chosen, not spec'd, and it is the largest number that cannot be wrong**:
     *  sessions never wrap past midnight and must not overlap, so the finest
     *  real timetable — one session an hour, all day — is exactly 24. A gym
     *  running hourly from 6am to 10pm needs 16 and fits. Recorded in DECISIONS
     *  rather than left as a magic bound. */
    sessions: z.array(gymSessionSchema).max(24),
  })
  .strict();
export type GymDaySchedule = z.infer<typeof gymDayScheduleSchema>;

export const gymWeekScheduleSchema = z.array(gymDayScheduleSchema).max(7);
export type GymWeekSchedule = z.infer<typeof gymWeekScheduleSchema>;

/** ONE DATED CLOSURE. `day` is the GYM's date in the GYM's zone, never the
 *  server's and never the browser's (trap #8) — which is why it travels as a
 *  plain `YYYY-MM-DD` string and never as an instant. */
export const gymClosureSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(120).nullable(),
  })
  .strict();
export type GymClosure = z.infer<typeof gymClosureSchema>;

/** WHAT `GET /v1/orgs/:gymId/hours` ANSWERS — one reader for the console and
 *  for the member's gym card, so the two can never disagree.
 *
 *  `week` is empty unless `mode` is `scheduled`, and `closures` lists only
 *  today-forward dates in the gym's own zone: a closure that has passed is a
 *  fact about history and no screen asks for it. `timezone` travels with them
 *  because every one of these values is meaningless without it. */
export const gymHoursSchema = z
  .object({
    mode: gymHoursModeSchema,
    timezone: z.string().min(1),
    week: gymWeekScheduleSchema,
    /** BOUNDED — T3 round 1's Low-5. This array is on a MEMBER-facing response
     *  and nothing capped it: a gym's own owner could close every date to
     *  `9999-12-31` and grow every one of its members' payloads without limit.
     *  The server's reader now applies a one-year horizon and a `LIMIT 400`;
     *  **400 here is that limit, and the two must move together** — a cap
     *  BELOW the server's would turn a legitimate answer into a parse failure,
     *  which is a worse outcome than the unbounded array it replaces. */
    closures: z.array(gymClosureSchema).max(400),
  })
  .strict();
export type GymHours = z.infer<typeof gymHoursSchema>;

/** Every response on this surface wraps the same `hours` object, so a screen
 *  that has just written can re-render from the reply instead of re-reading —
 *  and the two can never show different weeks. */
export const gymHoursResponseSchema = z.object({ hours: gymHoursSchema });
export type GymHoursResponse = z.infer<typeof gymHoursResponseSchema>;

/** SETTING THE HOURS — a discriminated union, so `open_24h` CANNOT arrive
 *  carrying a week and `scheduled` cannot arrive without one. The alternative
 *  (one object with an optional `week`) makes "24 hours, and here is Tuesday" a
 *  representable state that some reader eventually has to decide about.
 *
 *  **`unset` IS NOT SETTABLE, deliberately.** It means "nobody has answered",
 *  and a gym that HAS answered cannot un-answer — that would be a gym silently
 *  removing information its members can see, which is the no-removal rule's own
 *  shape. A gym that wants to say nothing says it is closed every day. */
export const setGymHoursRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("open_24h") }).strict(),
  z.object({ mode: z.literal("scheduled"), week: gymWeekScheduleSchema }).strict(),
]);
export type SetGymHoursRequest = z.infer<typeof setGymHoursRequestSchema>;

export const setGymHoursResponseSchema = z.object({ hours: gymHoursSchema });
export type SetGymHoursResponse = z.infer<typeof setGymHoursResponseSchema>;

/** CLOSING ONE DAY. `note` is optional and nullable — omitted means "no reason
 *  given", and an explicit null clears a note a previous close set, because
 *  re-closing the same day is how a note is edited (the UNIQUE makes it an
 *  upsert). */
export const closeGymDayRequestSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
export type CloseGymDayRequest = z.infer<typeof closeGymDayRequestSchema>;

export const closeGymDayResponseSchema = z.object({ hours: gymHoursSchema });
export type CloseGymDayResponse = z.infer<typeof closeGymDayResponseSchema>;

/** `removed` is a statement about the STATE and not about this request — the
 *  same wording and the same reason as `removeMemberResponseSchema`. Deleting a
 *  closure that was never there answers "this day is not marked closed", which
 *  is true either way, so a double-tap is not an error. */
export const removeGymClosureResponseSchema = z.object({
  status: z.literal("removed"),
  hours: gymHoursSchema,
});
export type RemoveGymClosureResponse = z.infer<typeof removeGymClosureResponseSchema>;
