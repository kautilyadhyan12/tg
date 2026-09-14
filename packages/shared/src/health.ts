// Health screening, Safe mode and the consent log (RULINGS 2026-09-07 and
// 2026-09-09, Onboarding; ROADMAP Stage 1 item 3b).
//
// ONE question, never a list of conditions (Kd, 2026-09-09: a fitness app, not
// a medical one — the ruling says nothing specific is ever asked or stored).
// "Do you have a medical condition, an injury, or are you pregnant, or
// anything else that could affect exercise or eating?" A yes opens "Check
// first": either a professional has cleared the person, or not yet. THIS
// screening stores exactly those two facts and derives the rest. It is the ONLY
// health question the app has: the older free-text "medical conditions" box on
// the fitness profile was switched off and its column dropped with its stored
// text when this screen landed (4b-i, migration 0029 — Kd ruled it on
// 2026-09-09, RULINGS.md "Privacy and legal").
//   · any yes  → no calorie cut, cleared or not (the app cannot know what the
//                yes is, so it treats every yes the careful way);
//   · not yet  → Safe mode: no workout or run plans, no intensity progression;
//                meals, the library behind a warning, gym check-in and
//                consistency goals still work.
// Both can be changed later by saving the screening again.
import { z } from "zod";

/** The person's answer to "Check first" after a yes. */
export const checkFirstSchema = z.enum(["cleared", "not_yet"]);
export type CheckFirst = z.infer<typeof checkFirstSchema>;

// ── The words both screens show (ROADMAP 4b-i) ──────────────────────────────
// The wizard's health step and Settings ask the SAME question and offer the
// same two answers, so the words live here once rather than twice on two
// screens that could drift apart. RULINGS 2026-09-09 is the question's own
// sentence; Kd's decision C (2026-09-10) added the medicine clause to it.

export const HEALTH_QUESTION =
  "Do you have a medical condition, an injury, or are you pregnant, or take any medicine, including for weight loss, or anything else that could affect exercise or eating?";

/** What is kept, on the screen that asks it. BOTH stored facts are named: the
 *  yes or no, and on a yes the "Check first" choice — the ruling's own words
 *  are "the server stores only the yes/no and the choice" (RULINGS
 *  2026-09-09), and the choice is picked directly under this line, so a note
 *  that promised only the first would be untrue where it is read. The last
 *  sentence promises no detail AT ALL, which is the ruling ("nothing specific
 *  is ever asked or kept"): the question above asks about a condition, an
 *  injury, pregnancy and medicine, so a promise about "the condition" alone
 *  would be narrower than the truth and leave the rest an open question. */
export const HEALTH_QUESTION_NOTE =
  "We keep only your answer, and — if it is yes — whether a professional has cleared you. We never ask for any detail.";

/** The two answers to "Check first", with what each one changes. Any yes stops
 *  the calorie cut, cleared or not — the app cannot know what the yes is — so
 *  both say so (RULINGS 2026-09-09). */
export const CHECK_FIRST_HEADING = "Check first";
export const CHECK_FIRST_OPTIONS: Readonly<Record<CheckFirst, { label: string; detail: string }>> = {
  cleared: {
    label: "A professional has cleared me",
    detail: "You get the whole app. Your plan has no calorie cut, and you follow your professional's advice.",
  },
  not_yet: {
    label: "Not yet",
    detail:
      "Safe mode: no workout or run plans and no calorie cut until a professional clears you. Meals, the exercise library, gym check-in and consistency goals still work.",
  },
};

/** The whole screening, replaced as one (PUT). `checkFirst` is required
 *  exactly when the answer is yes and must be absent (or null) on a no — a
 *  "cleared" with nothing to be cleared of is a contradiction, refused here. */
export const putHealthScreeningRequestSchema = z
  .object({
    hasCondition: z.boolean(),
    checkFirst: checkFirstSchema.nullable().optional(),
  })
  .strict()
  .refine((r) => (r.hasCondition ? r.checkFirst != null : r.checkFirst == null), {
    message: "checkFirst is required when hasCondition is true and must be null otherwise",
    path: ["checkFirst"],
  });
export type PutHealthScreeningRequest = z.infer<typeof putHealthScreeningRequestSchema>;

/** What the server says back. `answered` is false until the screen has been
 *  saved once; then the two stored facts and the two derived ones. The derived
 *  flags are computed on the server from the stored answer, never sent by a
 *  screen (a client cannot switch Safe mode off by omitting a field). */
export const healthScreeningSchema = z
  .object({
    answered: z.boolean(),
    hasCondition: z.boolean().nullable(),
    checkFirst: checkFirstSchema.nullable(),
    /** A yes with "not yet": no workout or run plans until a professional clears the person. */
    safeMode: z.boolean(),
    /** THE HEALTH ANSWER ALONE: any yes, cleared or not. It is NOT "the plan
     *  holds the cut" — age is a separate rule with the same effect, so a
     *  16-year-old who answered no reads false here while their targets and
     *  plan hold the deficit anyway.
     *
     *  The targets' and the plan's own `noCalorieCut` (nutrition.ts) is not the
     *  combined answer either: it says A DEFICIT WAS WITHHELD, which also needs
     *  a weight-loss goal, so it too reads false for a 16-year-old who is not
     *  trying to lose weight. NO SINGLE FLAG says "the under-18 rule applies to
     *  this person" — a screen that needs that reads the age. */
    noCalorieCut: z.boolean(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict()
  .refine((s) => (s.answered ? s.hasCondition !== null && s.updatedAt !== null : s.hasCondition === null && s.checkFirst === null && s.updatedAt === null), {
    message: "an unanswered screening carries no answer; an answered one carries one",
  })
  .refine((s) => s.safeMode === (s.hasCondition === true && s.checkFirst === "not_yet"), {
    message: "safeMode is exactly a yes with 'not yet'",
  })
  .refine((s) => s.noCalorieCut === (s.hasCondition === true), {
    message: "noCalorieCut is exactly a yes",
  });
export type HealthScreening = z.infer<typeof healthScreeningSchema>;

export const healthScreeningResponseSchema = z.object({ healthScreening: healthScreeningSchema }).strict();
export type HealthScreeningResponse = z.infer<typeof healthScreeningResponseSchema>;

/** The screening with NOTHING in it: what the server answers with before this
 *  person has ever saved one, and therefore what a refused finish naming the
 *  health question means to a screen holding a stale answer.
 *
 *  It lives here, once, and crosses the contract like every real reply does —
 *  the two screens and the server all read this object, so no hand-written copy
 *  can drift from the shape the schema allows (a copy missing a field the
 *  contract later gains would be a screening no reply could ever be). Frozen,
 *  because it is shared: nothing may edit the one copy. */
export const UNANSWERED_HEALTH_SCREENING: HealthScreening = Object.freeze(
  healthScreeningSchema.parse({
    answered: false,
    hasCondition: null,
    checkFirst: null,
    safeMode: false,
    noCalorieCut: false,
    updatedAt: null,
  }),
);

/** The two derived facts, from the two stored ones — the ONE place the rule
 *  lives, used by the server to build a response and by the plan maths' input. */
export function deriveHealthFlags(stored: { hasCondition: boolean; checkFirst: CheckFirst | null }): {
  safeMode: boolean;
  noCalorieCut: boolean;
} {
  return {
    safeMode: stored.hasCondition && stored.checkFirst === "not_yet",
    noCalorieCut: stored.hasCondition,
  };
}

// ── The consent log ──────────────────────────────────────────────────────────
// RULINGS 2026-09-07: one explicit tap at sign-up, at the health step and on
// the plan screen, stored with the time, the app version and the wording. The
// wording is stored VERBATIM on the row, so a later edit to the text below can
// never change what a person agreed to; the server writes the text it holds
// for the version the client names, and refuses a version it does not know.

export const consentPurposeSchema = z.enum(["sign_up", "health_step", "plan_screen"]);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

/** Every wording ever shown, by screen and version. NEVER edit a version in
 *  place — add the next one. The words "safe for you", "treats" and "cures"
 *  never appear (RULINGS 2026-09-07); the shared test checks every entry.
 *
 *  v2 is v1 with ONE change, and only where it appears: the comparison with the
 *  app goes, "follow their advice" stays (Kd, 2026-09-10, decision D — *"follow
 *  their advice should be kept but over the app should not be there"*). It is a
 *  new version rather than an edit so the consent log keeps the words each
 *  person actually agreed to. v1 stays exactly as it was, for the rows that
 *  carry it.
 *
 *  The sign-up note's v3 is Kd's own words (2026-09-14: v2 read *"like this
 *  app is not good and should not be followed"*), with the three changes he
 *  said go to: no "Disclaimer:" label under the screen's heading, pregnancy and
 *  medicine named as the health question names them, and "follow their advice"
 *  kept (decision D). It sends to a professional the people with a condition,
 *  an injury, a pregnancy, a medicine or a health concern, as exercise
 *  screening does since ACSM 2015 (Riebe and colleagues), rather than everyone. */
export const DISCLAIMER_WORDINGS: Readonly<Record<ConsentPurpose, Readonly<Record<string, string>>>> = {
  sign_up: {
    v1: "This app gives general fitness and eating information. It is not medical advice and does not diagnose anything. Talk to a doctor or another qualified professional before you start, and follow their advice over anything this app says.",
    v2: "This app gives general fitness and eating information. It is not medical advice and does not diagnose anything. Talk to a doctor or another qualified professional before you start, and follow their advice.",
    v3: "This app provides fitness, workout, and nutrition guidance intended to support your health and fitness goals. The recommendations are not a substitute for professional medical advice, diagnosis, or treatment. If you have a medical condition or an injury, are pregnant, take any medicine, or have a specific health concern, consult a qualified healthcare professional before making significant changes to your exercise or diet, and follow their advice.",
  },
  health_step: {
    v1: "Your answer here only makes the app more careful. It is not a diagnosis and not medical advice. If you have a medical condition, an injury, or are pregnant, ask a professional before you train or change how you eat, and follow their advice over the app's.",
    v2: "Your answer here only makes the app more careful. It is not a diagnosis and not medical advice. If you have a medical condition, an injury, or are pregnant, ask a professional before you train or change how you eat, and follow their advice.",
  },
  plan_screen: {
    v1: "These numbers are general guidance, not medical advice. Check them with a doctor or another qualified professional before you follow them, and follow their advice over the app's.",
    v2: "These numbers are general guidance, not medical advice. Check them with a doctor or another qualified professional before you follow them, and follow their advice.",
  },
};

/** The version a screen shows today, per purpose — the newest entry. */
export const CURRENT_DISCLAIMER_VERSION: Readonly<Record<ConsentPurpose, string>> = {
  sign_up: "v3",
  health_step: "v2",
  plan_screen: "v2",
};

export const recordConsentRequestSchema = z
  .object({
    purpose: consentPurposeSchema,
    wordingVersion: z.string().regex(/^v\d{1,4}$/, "expected v<number>"),
    /** The build that showed the words (web: the package version; phone: the store build). */
    appVersion: z.string().trim().min(1).max(40),
  })
  .strict();
export type RecordConsentRequest = z.infer<typeof recordConsentRequestSchema>;

export const consentRecordSchema = z
  .object({
    id: z.string().uuid(),
    purpose: consentPurposeSchema,
    wordingVersion: z.string(),
    wording: z.string().min(1),
    appVersion: z.string(),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const consentRecordResponseSchema = z.object({ consent: consentRecordSchema }).strict();
/** The newest taps, plus how many rows the person has in all — so a list that
 *  stops at the server's cap never passes for the whole record. */
export const consentListResponseSchema = z
  .object({ consents: z.array(consentRecordSchema), total: z.number().int().nonnegative() })
  .strict()
  .refine((r) => r.consents.length <= r.total, { message: "total counts every row, listed or not" });
export type ConsentListResponse = z.infer<typeof consentListResponseSchema>;
