import { describe, expect, it } from "vitest";
import { myCardViewSchema, type MyCardView } from "@app/shared";
import { cardBox, cardExpiryLine, cardReadyToSave, cardSavedLine } from "../src/screens/gym/cardView";

// Card on file on My membership (20d): what the box shows for every answer the server can send. Each answer is read
// through the server's own shape.

const FORM = {
  environment: "sandbox",
  applicationId: "sandbox-sq0idb-AbCdEfGhIjKlMnOp",
  locationId: "LOCATIONIRON01",
  contact: { givenName: "Tara", familyName: "Shah", email: null, countryCode: "US" },
};
const CARD = {
  brand: "VISA",
  last4: "1111",
  expMonth: 12,
  expYear: 2028,
  expired: false,
  expiresThisMonth: false,
  expiryReminder: null,
  expiryReminderOn: null,
  savedAt: "2026-11-10T10:00:00.000Z",
  savedFrom: "app",
};

const view = (over: Record<string, unknown> = {}): MyCardView =>
  myCardViewSchema.parse({
    record: "own",
    state: "ready",
    card: null,
    earlierCard: null,
    paidBy: null,
    canSave: true,
    gymName: "Iron House",
    agreement: "I agree that Iron House may save this card and charge it for my membership and any fees when they are due. I can remove it at the front desk at any time.",
    form: FORM,
    ...over,
  });

describe("what the box shows", () => {
  it.each<[string, Record<string, unknown>, ReturnType<typeof cardBox>]>([
    ["no card, Square ready: Add card", {}, { kind: "none", line: null, button: "Add card" }],
    ["a card: its name, expiry and Update card", { card: CARD }, { kind: "card", name: "Visa ending 1111", expiry: "Expires 12/2028", expired: false, button: "Update card" }],
    [
      "an expired card: Expired, and Update card",
      { card: { ...CARD, expYear: 2025, expired: true } },
      { kind: "card", name: "Visa ending 1111", expiry: "Expired 12/2025", expired: true, button: "Update card" },
    ],
    [
      "a card saved on the gym's earlier Square account: add it again",
      { earlierCard: { brand: "MASTERCARD", last4: "4444" } },
      { kind: "none", line: "Mastercard ending 4444 was saved with the Square account Iron House used before. Add the card again.", button: "Add card" },
    ],
    ["somebody else pays: their card, no button", { paidBy: "Priya Sharma", canSave: false, form: null }, { kind: "paid_by", line: "Priya Sharma pays for you, so Priya Sharma’s card is used." }],
    ["a card, the gym no longer taking cards in the app: the card, no button", { card: CARD, canSave: false, form: null }, { kind: "card", name: "Visa ending 1111", expiry: "Expires 12/2028", expired: false, button: null }],
    ["Square not connected yet: no box", { state: "connect", canSave: false, form: null }, null],
    ["the owner still choosing a location: no box", { state: "choose_location", canSave: false, form: null }, null],
    ["the gym not on a paid plan: no box", { canSave: false, form: null }, null],
    ["not one of Square's countries: no box", { state: "not_offered", canSave: false, form: null }, null],
    ["a record shared with somebody else: no box", { record: "shared", canSave: false, form: null }, null],
    ["no record on the list: no box", { record: "none", canSave: false, form: null }, null],
    ["a form missing though the server says yes: no Add card", { form: null }, null],
  ])("%s", (_name, over, expected) => {
    expect(cardBox(view(over))).toEqual(expected);
  });
});

describe("its words", () => {
  it("names the card saved and its expiry", () => {
    expect(cardSavedLine({ brand: "AMERICAN_EXPRESS", last4: "0005" })).toBe("Card saved: American Express ending 0005.");
    expect(cardSavedLine({ brand: "SOMETHING_NEW", last4: "1234" })).toBe("Card saved: Card ending 1234.");
    expect(cardExpiryLine({ expMonth: 3, expYear: 2027, expired: false })).toBe("Expires 03/2027");
  });

  it("Save card waits for Square's boxes, the tick, and nothing on its way", () => {
    expect(cardReadyToSave(true, true, false)).toBe(true);
    expect(cardReadyToSave(false, true, false)).toBe(false);
    expect(cardReadyToSave(true, false, false)).toBe(false);
    expect(cardReadyToSave(true, true, true)).toBe(false);
  });
});
