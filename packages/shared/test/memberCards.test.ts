// A member's card on file (ROADMAP 18d-ii): how a card, its expiry and the agreement read.
import { describe, expect, it } from "vitest";
import {
  cardAgreementWords,
  cardBrandWords,
  cardExpired,
  cardExpiryWords,
  cardName,
  cardNameParts,
  cardOnFileLine,
  cardOwnerOnlyLine,
  cardPaidByLine,
  saveCardRequestSchema,
} from "../src/index.js";

describe("a card's words", () => {
  it("names a card by its brand and last four, and any brand Square adds later as a card", () => {
    expect(cardName({ brand: "VISA", last4: "1111" })).toBe("Visa ending 1111");
    expect(cardName({ brand: "AMERICAN_EXPRESS", last4: "0005" })).toBe("American Express ending 0005");
    expect(cardName({ brand: "MASTERCARD", last4: "4444" })).toBe("Mastercard ending 4444");
    expect(cardBrandWords("OTHER_BRAND")).toBe("Card");
    expect(cardBrandWords("SOMETHING_NEW")).toBe("Card");
  });

  it("a card is good to the end of its expiry month, on the gym's day", () => {
    const card = { expMonth: 12, expYear: 2028 };
    expect(cardExpired(card, "2028-12-31")).toBe(false);
    expect(cardExpired(card, "2029-01-01")).toBe(true);
    expect(cardExpired({ expMonth: 3, expYear: 2027 }, "2027-02-28")).toBe(false);
    expect(cardExpired({ expMonth: 3, expYear: 2027 }, "2027-04-01")).toBe(true);
    expect(cardExpiryWords(card, "2026-10-20")).toBe("expires 12/2028");
    expect(cardExpiryWords({ expMonth: 4, expYear: 2025 }, "2026-10-20")).toBe("expired 04/2025");
    expect(cardOnFileLine({ brand: "VISA", last4: "1111", expMonth: 12, expYear: 2028, expired: false })).toBe("Card on file: Visa ending 1111 · expires 12/2028");
    expect(cardOnFileLine({ brand: "MASTERCARD", last4: "4444", expMonth: 4, expYear: 2025, expired: true })).toBe("Card on file: Mastercard ending 4444 · expired 04/2025");
  });

  it("the agreement is Kd's sentence, with the gym's own name", () => {
    expect(cardAgreementWords("Iron House")).toBe(
      "I agree that Iron House may save this card and charge it for my membership and any fees when they are due. I can remove it at the front desk at any time.",
    );
  });

  it("the payer and owner lines name the people and the gym", () => {
    expect(cardPaidByLine("Priya Sharma", "Aarav Sharma")).toBe("Priya Sharma pays for Aarav Sharma, so Priya Sharma's card is used.");
    expect(cardOwnerOnlyLine("Iron House")).toBe("Only the owner of Iron House can connect Square.");
  });

  it("a full name is Square's given and family names, the last word the family name", () => {
    expect(cardNameParts("Tara Singh")).toEqual({ givenName: "Tara", familyName: "Singh" });
    expect(cardNameParts("Mary Ann Smith")).toEqual({ givenName: "Mary Ann", familyName: "Smith" });
    expect(cardNameParts("  José   García  ")).toEqual({ givenName: "José", familyName: "García" });
    expect(cardNameParts("Cher")).toEqual({ givenName: "Cher", familyName: "" });
    expect(cardNameParts("")).toEqual({ givenName: "", familyName: "" });
  });

  it("a save needs the person's own tick and the words they read", () => {
    const pressId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const ok = { sourceId: "cnon:card-nonce-ok", agreed: true, agreement: "I agree", requestKey: pressId };
    expect(saveCardRequestSchema.safeParse(ok).success).toBe(true);
    expect(saveCardRequestSchema.safeParse({ ...ok, agreed: false }).success).toBe(false);
    expect(saveCardRequestSchema.safeParse({ ...ok, agreed: "true" }).success).toBe(false);
    expect(saveCardRequestSchema.safeParse({ sourceId: ok.sourceId, agreement: ok.agreement, requestKey: ok.requestKey }).success).toBe(false);
    expect(saveCardRequestSchema.safeParse({ ...ok, sourceId: 'cnon:x"}' }).success).toBe(false);
    expect(saveCardRequestSchema.safeParse({ ...ok, entryId: "0f8fad5b-d9cb-469f-a165-70867728950e" }).success).toBe(false);
  });
});
