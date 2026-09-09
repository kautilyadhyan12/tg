// Health screening, Safe mode and the consent log (RULINGS 2026-09-07 and
// 2026-09-09, Onboarding; ROADMAP Stage 1 item 3b).
//
// ONE question, never a list of conditions (Kd, 2026-09-09: a fitness app, not
// a medical one — nothing specific is ever asked or stored). "Do you have a
// medical condition, an injury, or are you pregnant, or anything else that
// could affect exercise or eating?" A yes opens "Check first": either a
// professional has cleared the person, or not yet. The server stores exactly
// those two facts and derives the rest:
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
    /** Any yes, cleared or not: the plan holds no calorie deficit. */
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
 *  never appear (RULINGS 2026-09-07); the shared test checks every entry. */
export const DISCLAIMER_WORDINGS: Readonly<Record<ConsentPurpose, Readonly<Record<string, string>>>> = {
  sign_up: {
    v1: "This app gives general fitness and eating information. It is not medical advice and does not diagnose anything. Talk to a doctor or another qualified professional before you start, and follow their advice over anything this app says.",
  },
  health_step: {
    v1: "Your answer here only makes the app more careful. It is not a diagnosis and not medical advice. If you have a medical condition, an injury, or are pregnant, ask a professional before you train or change how you eat, and follow their advice over the app's.",
  },
  plan_screen: {
    v1: "These numbers are general guidance, not medical advice. Check them with a doctor or another qualified professional before you follow them, and follow their advice over the app's.",
  },
};

/** The version a screen shows today, per purpose — the newest entry. */
export const CURRENT_DISCLAIMER_VERSION: Readonly<Record<ConsentPurpose, string>> = {
  sign_up: "v1",
  health_step: "v1",
  plan_screen: "v1",
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
export const consentListResponseSchema = z.object({ consents: z.array(consentRecordSchema) }).strict();
export type ConsentListResponse = z.infer<typeof consentListResponseSchema>;
