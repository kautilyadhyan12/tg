// The health screening and consent contracts (ROADMAP Stage 1 item 3b).
import { describe, expect, it } from "vitest";
import {
  CURRENT_DISCLAIMER_VERSION,
  DISCLAIMER_WORDINGS,
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
        expect(lower, `${purpose} ${version}`).toContain("not medical advice");
        expect(lower, `${purpose} ${version}`).toContain("professional");
      }
    }
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
});
