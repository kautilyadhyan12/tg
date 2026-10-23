// A declined card tried again (ROADMAP 18d-iii-ii-a). The codes come from OUTSIDE this code: every
// decline in Square's ErrorCode list (developer.squareup.com/reference/square/enums/ErrorCode, read
// 2026-10-23, with Square's own one-line meaning), each placed by what Square and the card companies
// say of it, and codes Square has never sent (a new one, Stripe's words, nothing): a code nobody has
// placed stops the card, never tries it again.
import { describe, expect, it } from "vitest";
import { CARD_RETRY, appCardRetry, appRetryDue, cardDeclineClassOf, staffCardRetry, type CardChargeTry } from "../src/index.js";

describe("cardDeclineClassOf: Square's decline codes", () => {
  it.each([
    // "Retrying after a few days might be effective" (Square); Visa's Category 2.
    ["INSUFFICIENT_FUNDS", "The funding source has insufficient funds to cover the payment.", "later"],
    ["TRANSACTION_LIMIT", "The card issuer has determined the payment amount is either too high or too low.", "later"],
    // "Don't retry" by itself; the cardholder can clear it with their bank (Square).
    ["GENERIC_DECLINE", "Square received a decline without any additional information.", "bank"],
    ["CARD_DECLINED", "The card was declined.", "bank"],
    ["CARD_DECLINED_CALL_ISSUER", "The payment card was declined with a request for the card holder to call the issuer.", "bank"],
    ["CARD_DECLINED_VERIFICATION_REQUIRED", "The payment card was declined with a request for additional verification.", "bank"],
    ["VOICE_FAILURE", "The card issuer declined the request because the issuer requires voice authorization from the cardholder.", "bank"],
    ["CVV_FAILURE", "The card issuer declined the request because the CVV value is invalid.", "bank"],
    ["ADDRESS_VERIFICATION_FAILURE", "The card issuer declined the request because the postal code is invalid.", "bank"],
    // Never approved on this card: Visa's Category 1 (closed, unknown, expired, not allowed).
    ["CARD_EXPIRED", "The card issuer declined the request because the card is expired.", "new_card"],
    ["EXPIRATION_FAILURE", "The card expiration date is either invalid or indicates that the card is expired.", "new_card"],
    ["INVALID_ACCOUNT", "The issuer was not able to locate the account on record.", "new_card"],
    ["ACCOUNT_UNUSABLE", "The account provided cannot carry out transactions.", "new_card"],
    ["CARDHOLDER_INSUFFICIENT_PERMISSIONS", "The card issuer has declined the transaction due to restrictions on where the card can be used.", "new_card"],
    ["CARD_NOT_SUPPORTED", "The card is not supported either in the geographic region or by the merchant category code (MCC).", "new_card"],
    ["BUYER_REFUSED_PAYMENT", "Bank account rejected or was not authorized for the payment.", "new_card"],
    // Card-present codes a card on file should never see: nothing to try again.
    ["INVALID_PIN", "The card issuer declined the request because the PIN is invalid.", "new_card"],
    ["ALLOWABLE_PIN_TRIES_EXCEEDED", "The card has exhausted its available pin entry retries set by the card issuer.", "new_card"],
    ["CHIP_INSERTION_REQUIRED", "The card issuer requires that the card be read using a chip reader.", "new_card"],
    ["APPLE_TTP_PIN_TOKEN", "The payment was declined by the card issuer during an Apple Tap to Pay (TTP) transaction with a request for the card's PIN.", "new_card"],
    ["READER_DECLINED", "The Square Card Reader declined the payment for an unknown reason.", "new_card"],
    ["GIFT_CARD_AVAILABLE_AMOUNT", "Provides the available balance on a Square gift card when a gift card payment fails due to insufficient funds.", "new_card"],
    ["VERIFY_CVV_FAILURE", "The CVV could not be verified.", "new_card"],
    ["VERIFY_AVS_FAILURE", "The AVS could not be verified.", "new_card"],
    // Never sent by Square, or not yet: stops the card.
    ["CARD_DECLINED_TEMPORARILY", "(a code Square might add)", "new_card"],
    ["lost_card", "(Stripe's word, not Square's)", "new_card"],
    ["UNKNOWN", "(what a row keeps for a code it could not read)", "new_card"],
    ["", "(nothing)", "new_card"],
  ])("%s (%s) → %s", (code, _meaning, expected) => {
    expect(cardDeclineClassOf(code)).toBe(expected);
  });
});

const CARD = "ccof:card-a";
const NEW_CARD = "ccof:card-b";
const at = (iso: string) => new Date(iso);
const declined = (iso: string, day: string, code: string, over: Partial<CardChargeTry> = {}): CardChargeTry => ({
  cardId: CARD,
  outcome: "declined",
  code,
  bySchedule: true,
  startedAt: at(iso),
  day,
  ...over,
});

describe("appCardRetry: when the app charges a declined card by itself", () => {
  it("a bill never charged is the first try", () => {
    expect(appCardRetry([], CARD, false)).toEqual({ kind: "first" });
  });

  it("not enough money: tried again 3 days after the first decline, then 7, then never", () => {
    const one = [declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS")];
    expect(appCardRetry(one, CARD, false)).toEqual({ kind: "on", day: "2026-10-26", notBefore: at("2026-10-24T11:00:00Z") });
    const two = [...one, declined("2026-10-26T11:00:00Z", "2026-10-26", "INSUFFICIENT_FUNDS")];
    expect(appCardRetry(two, CARD, false)).toEqual({ kind: "on", day: "2026-10-30", notBefore: at("2026-10-27T11:00:00Z") });
    const three = [...two, declined("2026-10-30T11:00:00Z", "2026-10-30", "INSUFFICIENT_FUNDS")];
    expect(appCardRetry(three, CARD, false)).toEqual({ kind: "no", why: "tried_out" });
  });

  it("a staff press counts among the three", () => {
    const tries = [
      declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS"),
      declined("2026-10-24T15:00:00Z", "2026-10-24", "INSUFFICIENT_FUNDS", { bySchedule: false }),
      declined("2026-10-26T11:00:00Z", "2026-10-26", "INSUFFICIENT_FUNDS"),
    ];
    expect(appCardRetry(tries, CARD, false)).toEqual({ kind: "no", why: "tried_out" });
  });

  it.each([
    ["GENERIC_DECLINE", "bank"],
    ["CARD_DECLINED_CALL_ISSUER", "bank"],
    ["CARD_EXPIRED", "new_card"],
    ["INVALID_ACCOUNT", "new_card"],
    ["CARD_DECLINED_TEMPORARILY", "new_card"],
  ])("after %s the app never tries again (%s)", (code, why) => {
    expect(appCardRetry([declined("2026-10-23T11:00:00Z", "2026-10-23", code)], CARD, false)).toEqual({ kind: "no", why });
  });

  it("after a later decline that the bank says is for good, never again, even if an earlier one could have been", () => {
    const tries = [declined("2026-10-23T11:00:00Z", "2026-10-23", "CARD_EXPIRED"), declined("2026-10-24T15:00:00Z", "2026-10-24", "INSUFFICIENT_FUNDS")];
    expect(appCardRetry(tries, CARD, false)).toEqual({ kind: "no", why: "new_card" });
  });

  it("a card stopped by another bill's decline is never tried, not even for a bill's first try", () => {
    expect(appCardRetry([declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS")], CARD, true)).toEqual({ kind: "no", why: "new_card" });
    expect(appCardRetry([], CARD, true)).toEqual({ kind: "no", why: "new_card" });
  });

  it("a card saved since the decline is staff's to charge, not the app's", () => {
    expect(appCardRetry([declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS")], NEW_CARD, false)).toEqual({ kind: "no", why: "card_changed" });
  });

  it.each([
    ["charging", null],
    ["refused", "refused"],
    ["unanswered", "gone"],
    ["taken but not recorded", "not_recorded"],
    ["paid", "paid"],
  ] as const)("a newest charge %s ends the app's own tries", (_what, outcome) => {
    const tries = [
      declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS"),
      { ...declined("2026-10-24T15:00:00Z", "2026-10-24", "INSUFFICIENT_FUNDS"), outcome, code: null },
    ];
    expect(appCardRetry(tries, CARD, false)).toEqual({ kind: "no", why: "not_declined" });
  });

  it("is due from its day and a whole day after the last decline, never sooner", () => {
    const retry = appCardRetry([declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS")], CARD, false);
    expect(appRetryDue(retry, "2026-10-25", at("2026-10-25T18:00:00Z"))).toBe(false);
    expect(appRetryDue(retry, "2026-10-26", at("2026-10-26T12:00:00Z"))).toBe(true);
    // A staff press late on the 25th: the app waits a whole day after it.
    const pressed = appCardRetry(
      [declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS"), declined("2026-10-26T03:00:00Z", "2026-10-25", "INSUFFICIENT_FUNDS", { bySchedule: false })],
      CARD,
      false,
    );
    expect(pressed).toEqual({ kind: "on", day: "2026-10-30", notBefore: at("2026-10-27T03:00:00Z") });
    expect(appRetryDue({ kind: "first" }, "2026-10-26", at("2026-10-26T12:00:00Z"))).toBe(false);
  });
});

describe("staffCardRetry: when staff may charge a declined card again", () => {
  const now = at("2026-10-25T12:00:00Z");
  it("never charged, or declined more than a day ago for a reason the bank can clear: yes", () => {
    expect(staffCardRetry([], CARD, false, now)).toEqual({ kind: "yes" });
    expect(staffCardRetry([declined("2026-10-23T11:00:00Z", "2026-10-23", "GENERIC_DECLINE")], CARD, false, now)).toEqual({ kind: "yes" });
    expect(staffCardRetry([declined("2026-10-23T11:00:00Z", "2026-10-23", "INSUFFICIENT_FUNDS")], CARD, false, now)).toEqual({ kind: "yes" });
  });
  it("declined less than a day ago: from a day after it", () => {
    expect(staffCardRetry([declined("2026-10-25T02:00:00Z", "2026-10-24", "GENERIC_DECLINE")], CARD, false, now)).toEqual({ kind: "wait", from: at("2026-10-26T02:00:00Z") });
  });
  it.each(["CARD_EXPIRED", "INVALID_ACCOUNT", "CARDHOLDER_INSUFFICIENT_PERMISSIONS", "CARD_DECLINED_TEMPORARILY"])("after %s: never this card", (code) => {
    expect(staffCardRetry([declined("2026-10-20T11:00:00Z", "2026-10-20", code)], CARD, false, now)).toEqual({ kind: "no", why: "new_card" });
  });
  it("three declines of this card for this bill: no more; another card starts again", () => {
    const tries = ["2026-10-20", "2026-10-21", "2026-10-22"].map((day) => declined(`${day}T11:00:00Z`, day, "GENERIC_DECLINE", { bySchedule: false }));
    expect(tries).toHaveLength(CARD_RETRY.tries);
    expect(staffCardRetry(tries, CARD, false, now)).toEqual({ kind: "no", why: "tried_out" });
    expect(staffCardRetry(tries, NEW_CARD, false, now)).toEqual({ kind: "yes" });
  });
  it("a card stopped by another bill: never", () => {
    expect(staffCardRetry([], CARD, true, now)).toEqual({ kind: "no", why: "new_card" });
  });
});
