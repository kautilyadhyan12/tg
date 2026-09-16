// The health screening and consent contracts (ROADMAP Stage 1 item 3b).
import { describe, expect, it } from "vitest";
import {
  CHECK_FIRST_OPTIONS,
  CURRENT_DISCLAIMER_VERSION,
  DISCLAIMER_WORDINGS,
  FOOD_ALLERGY_CAUTION,
  HEALTH_QUESTION,
  HEALTH_QUESTION_NOTE,
  PHOTO_SCAN_CAUTION,
  UNANSWERED_HEALTH_SCREENING,
  checkFirstSchema,
  consentListResponseSchema,
  consentPurposeSchema,
  deriveHealthFlags,
  healthScreeningSchema,
  putHealthScreeningRequestSchema,
  recordConsentRequestSchema,
} from "../src/index.js";

describe("health screening contract", () => {
  it("the request: a yes must choose, a no must not — and no named condition is ever a field", () => {
    const ok = (b: unknown) => putHealthScreeningRequestSchema.safeParse(b).success;
    expect(ok({ hasCondition: false })).toBe(true);
    expect(ok({ hasCondition: false, checkFirst: null })).toBe(true);
    expect(ok({ hasCondition: true, checkFirst: "cleared" })).toBe(true);
    expect(ok({ hasCondition: true, checkFirst: "not_yet" })).toBe(true);
    expect(ok({ hasCondition: true })).toBe(false);
    expect(ok({ hasCondition: true, checkFirst: null })).toBe(false);
    expect(ok({ hasCondition: false, checkFirst: "cleared" })).toBe(false);
    expect(ok({ hasCondition: true, checkFirst: "later" })).toBe(false);
    for (const named of ["pregnant", "heart", "bloodPressure", "diabetes", "injury"]) {
      expect(ok({ hasCondition: true, checkFirst: "cleared", [named]: true })).toBe(false);
    }
    // The derived flags are never accepted from a client.
    expect(ok({ hasCondition: false, safeMode: true })).toBe(false);
    expect(ok({ hasCondition: false, noCalorieCut: false })).toBe(false);
  });

  it("the one rule: Safe mode is a yes with 'not yet'; no calorie cut is any yes", () => {
    expect(deriveHealthFlags({ hasCondition: false, checkFirst: null })).toEqual({ safeMode: false, noCalorieCut: false });
    expect(deriveHealthFlags({ hasCondition: true, checkFirst: "cleared" })).toEqual({ safeMode: false, noCalorieCut: true });
    expect(deriveHealthFlags({ hasCondition: true, checkFirst: "not_yet" })).toEqual({ safeMode: true, noCalorieCut: true });
  });

  it("the response refuses a derived flag that disagrees with the answer, and an unanswered shape that carries one", () => {
    const ok = (b: unknown) => healthScreeningSchema.safeParse(b).success;
    const at = "2026-09-09T10:00:00.000Z";
    expect(ok({ answered: true, hasCondition: true, checkFirst: "not_yet", safeMode: true, noCalorieCut: true, updatedAt: at })).toBe(true);
    expect(ok({ answered: true, hasCondition: true, checkFirst: "not_yet", safeMode: false, noCalorieCut: true, updatedAt: at })).toBe(false);
    expect(ok({ answered: true, hasCondition: true, checkFirst: "cleared", safeMode: true, noCalorieCut: true, updatedAt: at })).toBe(false);
    expect(ok({ answered: true, hasCondition: false, checkFirst: null, safeMode: false, noCalorieCut: true, updatedAt: at })).toBe(false);
    expect(ok({ answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null })).toBe(true);
    expect(ok({ answered: false, hasCondition: true, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null })).toBe(false);
    expect(ok({ answered: true, hasCondition: false, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null })).toBe(false);
  });

  it("the unanswered screening is the contract's own shape, and the one copy of it", () => {
    // The server answers with it before anything is saved, and both screens
    // fall back to it when a refused finish says the server holds no answer.
    // It is a reply like any other, so it must satisfy the schema every real
    // reply is parsed through — a hand-written copy that lost a field, or
    // carried a flag an unanswered screening cannot carry, would be a screening
    // no server could ever send.
    expect(healthScreeningSchema.safeParse(UNANSWERED_HEALTH_SCREENING).success).toBe(true);
    expect(UNANSWERED_HEALTH_SCREENING).toEqual({
      answered: false,
      hasCondition: null,
      checkFirst: null,
      safeMode: false,
      noCalorieCut: false,
      updatedAt: null,
    });
    // Shared, so nothing may edit it for everyone else.
    expect(Object.isFrozen(UNANSWERED_HEALTH_SCREENING)).toBe(true);
  });
});

describe("the words both screens show (4b-i)", () => {
  it("asks ONE question, and it carries the medicine clause Kd added", () => {
    // RULINGS 2026-09-09's own sentence, plus decision C (2026-09-10). No
    // condition is ever NAMED as a thing to tick: the words list examples
    // inside one question, and the answer is a yes or a no.
    expect(HEALTH_QUESTION).toBe(
      "Do you have a medical condition, an injury, or are you pregnant, or take any medicine, including for weight loss, or anything else that could affect exercise or eating?",
    );
    expect(HEALTH_QUESTION.match(/\?/g)).toHaveLength(1);
  });

  it("says what is kept, and that is BOTH stored facts, not just the yes or no", () => {
    // The screening stores two things (RULINGS 2026-09-09: "the server stores
    // only the yes/no and the choice"), and the choice is picked directly under
    // this line. A note promising only the first would be untrue exactly where
    // a person reads it — on the screen where they have just made the second.
    const lower = HEALTH_QUESTION_NOTE.toLowerCase();
    expect(lower).toContain("cleared");
    // Nothing specific is ever asked (RULINGS 2026-09-09), so the promise is
    // "no detail", full stop. The question above asks about four things — a
    // condition, an injury, pregnancy, medicine — and a promise naming only one
    // of them is narrower than the truth: it leaves a person wondering whether
    // the medicine is asked about.
    expect(lower).toContain("never ask for any detail");
    for (const named of ["condition", "injury", "pregnan", "medicine"]) {
      expect(lower, named).not.toMatch(new RegExp(`never ask [^.]*${named}`));
    }
    expect(lower).not.toMatch(/only (this|your) yes or no/);
    // And it never promises the app forgets an answer it keeps.
    expect(lower).not.toContain("never store");
  });

  it("offers exactly the two answers to 'Check first', and both say the calorie cut is off", () => {
    expect(Object.keys(CHECK_FIRST_OPTIONS).sort()).toEqual([...checkFirstSchema.options].sort());
    // ANY yes stops the cut, cleared or not (RULINGS 2026-09-09) — a person
    // reading either card is told so, rather than finding out from the number.
    for (const option of Object.values(CHECK_FIRST_OPTIONS)) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.detail.toLowerCase()).toContain("no calorie cut");
    }
    // Only "not yet" turns Safe mode on, and only its card says so.
    expect(CHECK_FIRST_OPTIONS.not_yet.detail).toContain("Safe mode");
    expect(CHECK_FIRST_OPTIONS.cleared.detail).not.toContain("Safe mode");
  });

  it("the food caution says both halves of the ruling: any food allergy, and the labels (RULINGS 2026-09-09)", () => {
    const lower = FOOD_ALLERGY_CAUTION.toLowerCase();
    expect(lower).toContain("any food allergy");
    expect(lower).toContain("check the labels");
    // It cautions; it never promises a food is free of anything.
    expect(lower).not.toMatch(/allergen-free|allergy-free|\bsafe\b|free from/);
  });

  it("the photo scan's caution says both halves of the ruling: calories are estimated, and allergens cannot be detected (RULINGS 2026-09-09)", () => {
    const lower = PHOTO_SCAN_CAUTION.toLowerCase();
    expect(lower).toContain("estimate");
    expect(lower).toContain("cannot detect allergens");
    expect(lower).not.toMatch(/allergen-free|allergy-free|\bsafe\b|free from/);
  });

  it("never claims anything is safe for the person, treated or cured", () => {
    for (const text of [HEALTH_QUESTION, HEALTH_QUESTION_NOTE, FOOD_ALLERGY_CAUTION, PHOTO_SCAN_CAUTION, ...Object.values(CHECK_FIRST_OPTIONS).flatMap((o) => [o.label, o.detail])]) {
      const lower = text.toLowerCase();
      expect(lower).not.toContain("safe for you");
      expect(lower).not.toMatch(/treats?/);
      expect(lower).not.toMatch(/cures?/);
    }
  });
});

describe("consent contract", () => {
  it("every purpose has a current version whose wording exists", () => {
    for (const purpose of consentPurposeSchema.options) {
      const version = CURRENT_DISCLAIMER_VERSION[purpose];
      expect(DISCLAIMER_WORDINGS[purpose][version]).toBeTypeOf("string");
    }
  });

  it("no wording ever says 'safe for you', 'treats' or 'cures', and every one sends people to a professional (RULINGS 2026-09-07)", () => {
    for (const purpose of consentPurposeSchema.options) {
      for (const [version, text] of Object.entries(DISCLAIMER_WORDINGS[purpose])) {
        const lower = text.toLowerCase();
        expect(lower, `${purpose} ${version}`).not.toContain("safe for you");
        expect(lower, `${purpose} ${version}`).not.toMatch(/\btreats?\b/);
        expect(lower, `${purpose} ${version}`).not.toMatch(/\bcures?\b/);
        // "Not medical advice", in the words each version says it: Kd's own
        // sign-up words (v3) say "not a substitute for professional medical advice".
        expect(lower, `${purpose} ${version}`).toMatch(/not medical advice|not a substitute for professional medical advice/);
        expect(lower, `${purpose} ${version}`).toContain("professional");
      }
    }
  });

  it("v2 keeps 'follow their advice' and drops the comparison with the app, on all three screens (Kd, 2026-09-10)", () => {
    for (const purpose of consentPurposeSchema.options) {
      // v2 is what the health step and the plan show today (the sign-up note
      // has moved on to Kd's own words, v3: the next test)…
      expect(CURRENT_DISCLAIMER_VERSION[purpose]).toBe(purpose === "sign_up" ? "v3" : "v2");
      const v1 = DISCLAIMER_WORDINGS[purpose]["v1"] ?? "";
      const v2 = DISCLAIMER_WORDINGS[purpose]["v2"] ?? "";
      expect(v1, purpose).not.toBe("");
      // …the advice stays…
      expect(v2, purpose).toContain("follow their advice");
      // …and the comparison goes, in either spelling v1 used.
      expect(v2, purpose).not.toContain("over the app");
      expect(v2, purpose).not.toContain("over anything this app says");
      expect(v1, purpose).toMatch(/over the app's|over anything this app says/);
      // v2 IS v1 with that clause removed — nothing else was reworded, and the
      // old version is untouched, so the consent log keeps what each person
      // agreed to.
      expect(v2, purpose).toBe(v1.replace(/ over the app's| over anything this app says/, ""));
    }
  });

  it("the sign-up note shows Kd's own words, which keep 'follow their advice' and name what the health question asks about (Kd, 2026-09-14)", () => {
    expect(CURRENT_DISCLAIMER_VERSION.sign_up).toBe("v3");
    const v3 = DISCLAIMER_WORDINGS.sign_up["v3"] ?? "";
    // Word for word what Kd said go to.
    expect(v3).toBe(
      "This app provides fitness, workout, and nutrition guidance intended to support your health and fitness goals. The recommendations are not a substitute for professional medical advice, diagnosis, or treatment. If you have a medical condition or an injury, are pregnant, take any medicine, or have a specific health concern, consult a qualified healthcare professional before making significant changes to your exercise or diet, and follow their advice.",
    );
    expect(v3).toContain("follow their advice");
    expect(v3).not.toMatch(/disclaimer/i);
    for (const asked of ["medical condition", "injury", "pregnant", "medicine"]) {
      expect(HEALTH_QUESTION, asked).toContain(asked);
      expect(v3, asked).toContain(asked);
    }
    // The words people ticked before stay, for the rows that carry them.
    expect(DISCLAIMER_WORDINGS.sign_up["v2"]).toContain("Talk to a doctor or another qualified professional before you start");
  });

  it("the request names a screen, a version and a build; nothing else", () => {
    const ok = (b: unknown) => recordConsentRequestSchema.safeParse(b).success;
    expect(ok({ purpose: "sign_up", wordingVersion: "v1", appVersion: "web-0.0.1" })).toBe(true);
    expect(ok({ purpose: "sign_up", wordingVersion: "1", appVersion: "web" })).toBe(false);
    expect(ok({ purpose: "sign_up", wordingVersion: "v1", appVersion: "   " })).toBe(false);
    expect(ok({ purpose: "sign_up", wordingVersion: "v1", appVersion: "x".repeat(41) })).toBe(false);
    expect(ok({ purpose: "sign_up", wordingVersion: "v1", appVersion: "web", wording: "mine" })).toBe(false);
    expect(ok({ purpose: "camera", wordingVersion: "v1", appVersion: "web" })).toBe(false);
  });

  it("the list always carries a total, and never claims fewer rows than it shows", () => {
    const ok = (b: unknown) => consentListResponseSchema.safeParse(b).success;
    expect(ok({ consents: [], total: 0 })).toBe(true);
    expect(ok({ consents: [], total: 101 })).toBe(true); // a capped list, honestly labelled
    expect(ok({ consents: [] })).toBe(false); // no total = no way to tell a cap from the whole
    const row = { id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", purpose: "sign_up", wordingVersion: "v1", wording: "w", appVersion: "web", recordedAt: "2026-09-09T00:00:00.000Z" };
    expect(ok({ consents: [row], total: 1 })).toBe(true);
    expect(ok({ consents: [row], total: 0 })).toBe(false);
    expect(ok({ consents: [row], total: -1 })).toBe(false);
  });
});
