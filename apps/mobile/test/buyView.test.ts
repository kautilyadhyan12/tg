import { describe, expect, it } from "vitest";
import { APP_PURCHASE_WORDS, PROMO_CODE_WORDS, appPurchaseRequestSchema, appPurchaseSchema, type AppPaymentState, type ForSaleLine, type ForSaleResponse } from "@app/shared";
import {
  BANK_CHECK_DESK,
  CARD_NOT_TAKEN,
  NOT_READY,
  NOT_READY_BOTH,
  NOT_READY_CARD,
  NOT_READY_WHO,
  NOT_READY_WHO_BOTH,
  notReadyLine,
  paidHow,
  buyBody,
  buyRefusalSaid,
  buySay,
  codeOf,
  forSaleListPath,
  promoLine,
  endedBuySaid,
  lineSummary,
  nameLabel,
  paidShortLine,
  payLabel,
  signerOf,
  todayLine,
  todayParts,
} from "../src/screens/gym/buyView";
import { NOT_PAID, PAY_CHECK, PAY_WAITING } from "../src/screens/gym/payView";
import { AGREEMENT_ID, DAY_TYPE, GOLD_TYPE, PACK_ID, PACK_TYPE, SPRING20, SUMMER_TYPE, lineOf } from "./forSaleLines";

// Buy in the app (ROADMAP Stage 5 item 20g): how a line reads, what Pay sends, and how the end is said. The server decides
// all of it (`appPurchases.routes.test.ts`); the phone sends exactly what it showed, and reads bought only from `paid`.

// A press's own id, as the phone makes one.
const PRESS = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("what Pay sends: exactly the line shown", () => {
  it("the line, today's amount, the key of its details and the agreement signed as shown; nothing the server would not take", () => {
    const pack = lineOf(PACK_TYPE, { factsKey: "b".repeat(64) });
    const body = buyBody(pack, { signer: "person", name: "Asha Walk" });
    expect(body).toEqual({ typeId: PACK_ID, amountMinor: 9000, factsKey: "b".repeat(64), agreement: { agreementId: AGREEMENT_ID, signer: "person", name: "Asha Walk" } });
    expect(appPurchaseRequestSchema.safeParse({ ...body, requestKey: PRESS }).success).toBe(true);
    // Today's amount with a joining fee is what is sent, never the price alone.
    expect(buyBody(lineOf(SUMMER_TYPE), { signer: "guardian", name: "Priya Walk" })).toMatchObject({ amountMinor: 14500, agreement: { signer: "guardian", name: "Priya Walk" } });
    // A gym that asks for no agreement signs nothing, whatever was typed.
    expect(buyBody(lineOf(DAY_TYPE, { agreement: false }), { signer: "person", name: "Asha Walk" }).agreement).toBeNull();
  });

  it("a Refer a friend gift is taken off what is sent, as the server worked it out", () => {
    const gifted = lineOf(PACK_TYPE, { friendGift: true });
    expect(buyBody(gifted, null).amountMinor).toBe(gifted.firstPayment.amountMinor);
    expect(gifted.firstPayment.amountMinor).toBe(8000);
  });
});

describe("how a line reads", () => {
  it("its price and until when, in the agreement's own words; today's amount only where it differs, with why", () => {
    const pack = lineOf(PACK_TYPE);
    expect(lineSummary(pack)).toEqual({ price: "$90.00 for 10 classes", until: "Use by 10 Jan 2027" });
    expect(todayLine(pack)).toBeNull();
    expect(todayParts(pack)).toBeNull();
    const summer = lineOf(SUMMER_TYPE);
    expect(lineSummary(summer).price).toBe("$120.00, paid once");
    expect(lineSummary(summer).until).toMatch(/^Ends /);
    expect(todayLine(summer)).toBe("$145.00 today, with a $25.00 joining fee");
    expect(todayParts(summer)).toBe("$120.00 + $25.00 joining fee");
    expect(todayLine(lineOf(PACK_TYPE, { friendGift: true }))).toBe("$80.00 today, with your Refer a friend gift");
    // Tax added on top is named too, never left for the joining fee to seem to explain (round one, L2).
    const taxed = lineOf(SUMMER_TYPE, { taxes: [{ name: "Sales tax", pcm: 8250 }] });
    expect(todayLine(taxed)).toBe("$156.96 today, with a $25.00 joining fee and tax");
    expect(todayParts(taxed)).toBeNull();
    expect(todayLine(lineOf(PACK_TYPE, { taxes: [{ name: "Sales tax", pcm: 8250 }] }))).toBe("$97.43 today, with tax");
    expect(lineSummary(lineOf(DAY_TYPE))).toEqual({ price: "$15.00 for 1 class", until: "Use by 12 Nov 2026" });
  });

  it("its buttons say what they do", () => {
    const pack = lineOf(PACK_TYPE);
    expect(buySay(pack)).toBe("Buy 10-class pack, $90.00");
    expect(payLabel(lineOf(SUMMER_TYPE))).toBe("Pay $145.00");
  });

  it("who signs: the server's answer where it knows, their choice where it doesn't", () => {
    expect(signerOf("person")).toBe("person");
    expect(signerOf("guardian")).toBe("guardian");
    expect(signerOf("either")).toBeNull();
    expect(nameLabel("guardian")).toBe("Parent or guardian’s full name");
    expect(nameLabel("person")).toBe("Full name");
    expect(nameLabel(null)).toBe("Full name");
  });
});

describe("how it ended: bought only from the server's own paid", () => {
  const purchase = (state: AppPaymentState) =>
    appPurchaseSchema.parse({ id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", typeId: PACK_ID, name: "10-class pack", amountMinor: 9000, currency: "USD", state, url: null, closesAt: null, membershipId: null, receiptNumber: null });

  it("every state that is not paid never reads as bought", () => {
    expect(endedBuySaid(purchase("closed"))).toEqual({ tone: "plain", line: NOT_PAID, ended: true });
    expect(endedBuySaid(purchase("check"))).toEqual({ tone: "warn", line: PAY_CHECK, ended: true });
    expect(endedBuySaid(purchase("open"))).toEqual({ tone: "warn", line: PAY_WAITING, again: true, ended: true });
    for (const state of ["closed", "check", "open"] as const) expect(endedBuySaid(purchase(state))?.line).not.toMatch(/success|yours/i);
    expect(endedBuySaid(purchase("paid"))).toBeNull();
  });

  it("the paid line names what was bought and what was paid", () => {
    expect(paidShortLine(purchase("paid"))).toBe("$90.00 paid. 10-class pack is yours.");
  });

  it("a refusal says the server's words; what changed reads the list again; money owed opens My membership", () => {
    expect(buyRefusalSaid("app_payment_changed", APP_PURCHASE_WORDS.changed)).toEqual({ tone: "warn", line: APP_PURCHASE_WORDS.changed, reread: true });
    expect(buyRefusalSaid("agreement_changed", APP_PURCHASE_WORDS.agreement_changed("Iron House")).reread).toBe(true);
    expect(buyRefusalSaid("guardian_needed", APP_PURCHASE_WORDS.guardian_needed).reread).toBe(true);
    const owed = APP_PURCHASE_WORDS.owed("$49.00", "Iron House");
    expect(buyRefusalSaid("app_purchase_owed", owed)).toEqual({ tone: "bad", line: owed, toMembership: true });
    expect(buyRefusalSaid("already_held", APP_PURCHASE_WORDS.already_held("Summer month"))).toEqual({ tone: "bad", line: "You already have Summer month." });
    expect(buyRefusalSaid("app_payment_check", APP_PURCHASE_WORDS.check_first).tone).toBe("warn");
    expect(buyRefusalSaid("square_unavailable", "").line).toBe("Checkout couldn’t open. Try again.");
  });
});

describe("a repeating membership, paid with the card saved in the app (20i-i)", () => {
  const gold = lineOf(GOLD_TYPE, { card: { brand: "VISA", last4: "1111" } });
  const view = (over: Partial<Pick<ForSaleResponse, "record" | "card">> = {}): Pick<ForSaleResponse, "record" | "card"> => ({
    record: "own",
    card: { brand: "VISA", last4: "1111", expired: false },
    ...over,
  });

  it("how it is paid, for every reader: a line paid once on Square's page; the card with its tick; or what to do first", () => {
    const pack = lineOf(PACK_TYPE);
    const cases: [string, Pick<ForSaleLine, "repeats" | "charge">, Pick<ForSaleResponse, "record" | "card">, ReturnType<typeof paidHow>][] = [
      ["a line paid once, whatever the card", pack, view({ card: null }), { kind: "page" }],
      ["own record, a card in date", gold, view(), { kind: "card", card: { brand: "VISA", last4: "1111" }, words: gold.charge ?? "" }],
      ["own record, no card", { ...gold, charge: null }, view({ card: null }), { kind: "add_card", line: APP_PURCHASE_WORDS.card_needed }],
      ["own record, an expired card", { ...gold, charge: null }, view({ card: { brand: "VISA", last4: "1111", expired: true } }), { kind: "update_card", line: APP_PURCHASE_WORDS.card_expired }],
      ["a card in date but no tick from the server: changed, never called expired", { ...gold, charge: null }, view(), { kind: "changed", line: APP_PURCHASE_WORDS.card_changed }],
      ["not on the gym's list yet", { ...gold, charge: null }, view({ record: "none", card: null }), { kind: "no_record", line: APP_PURCHASE_WORDS.card_no_record }],
      ["a shared record", gold, view({ record: "shared" }), { kind: "no_record", line: APP_PURCHASE_WORDS.card_no_record }],
    ];
    for (const [name, line, v, want] of cases) expect([name, paidHow(line, v)]).toEqual([name, want]);
  });

  it("Pay sends the card's tick word for word with no bank's check; a line paid once sends none", () => {
    const body = buyBody(gold, { signer: "person", name: "Asha Walk" });
    expect(body.charge).toEqual({ words: gold.charge, verificationToken: null });
    expect(appPurchaseRequestSchema.safeParse({ ...body, requestKey: PRESS }).success).toBe(true);
    expect("charge" in buyBody(lineOf(PACK_TYPE), { signer: "person", name: "Asha Walk" })).toBe(false);
  });

  it("refusals about the card offer Update card; what changed about it reads the list again; the bank's check goes to the desk", () => {
    expect(buyRefusalSaid("app_purchase_declined", "Visa ending 1111 was declined.")).toEqual({ tone: "bad", line: "Visa ending 1111 was declined.", updateCard: true });
    expect(buyRefusalSaid("app_purchase_card_stopped", APP_PURCHASE_WORDS.card_stopped)).toEqual({ tone: "bad", line: APP_PURCHASE_WORDS.card_stopped, updateCard: true });
    expect(buyRefusalSaid("app_purchase_card_expired", APP_PURCHASE_WORDS.card_expired)).toMatchObject({ reread: true, updateCard: true });
    expect(buyRefusalSaid("app_purchase_card_changed", APP_PURCHASE_WORDS.card_changed)).toMatchObject({ reread: true });
    expect(buyRefusalSaid("app_purchase_card_needed", APP_PURCHASE_WORDS.card_needed)).toMatchObject({ reread: true });
    expect(buyRefusalSaid("app_purchase_verification", APP_PURCHASE_WORDS.verification)).toEqual({ tone: "bad", line: BANK_CHECK_DESK });
    expect(buyRefusalSaid("app_purchase_charging", APP_PURCHASE_WORDS.charging)).toEqual({ tone: "bad", line: APP_PURCHASE_WORDS.charging });
  });

  it("a card charge closed is nothing taken, never cancelled; open and check read as for a page", () => {
    expect(endedBuySaid({ state: "closed" }, true)).toEqual({ tone: "bad", line: CARD_NOT_TAKEN, ended: true });
    expect(endedBuySaid({ state: "closed" })?.line).not.toBe(CARD_NOT_TAKEN);
    expect(endedBuySaid({ state: "open" }, true)).toEqual(endedBuySaid({ state: "open" }));
    expect(endedBuySaid({ state: "check" }, true)).toEqual(endedBuySaid({ state: "check" }));
    expect(endedBuySaid({ state: "paid" }, true)).toBeNull();
  });

  it("under Pay: what is still to do, by what the page asks", () => {
    expect(notReadyLine(false, true, true)).toBe(NOT_READY_CARD);
    expect(notReadyLine(true, true, true)).toBe(NOT_READY_BOTH);
    expect(notReadyLine(true, true, false)).toBe(NOT_READY_WHO_BOTH);
    expect(notReadyLine(true, false, true)).toBe(NOT_READY);
    expect(notReadyLine(true, false, false)).toBe(NOT_READY_WHO);
  });
});

describe("a promo code (20j)", () => {
  it("is sent as the gym writes its codes, however it was typed", () => {
    // As people type a code from a poster or a message: lower case, a space copied with it.
    expect(codeOf(" spring20 ")).toBe("SPRING20");
    expect(codeOf("Spring20")).toBe("SPRING20");
    expect(codeOf("   ")).toBe("");
    expect(forSaleListPath("g1")).toBe("/v1/orgs/g1/for-sale?repeating=true");
    expect(forSaleListPath("g1", "SPRING20")).toBe("/v1/orgs/g1/for-sale?repeating=true&code=SPRING20");
    // A code the gym could never have made is still asked about, so the server says why it isn't valid.
    expect(forSaleListPath("g1", "SUMMER 20&X")).toBe("/v1/orgs/g1/for-sale?repeating=true&code=SUMMER%2020%26X");
  });

  it("Pay sends the code a line was worked out with, and only that line's; every body passes the server's own check", () => {
    const cases = [
      { line: lineOf(PACK_TYPE, { agreement: false, promo: SPRING20 }), code: "SPRING20", amount: 7200 },
      { line: lineOf(PACK_TYPE, { agreement: false }), code: null, amount: 9000 },
      // The code fits another line, not this one: nothing is sent with it.
      { line: lineOf(DAY_TYPE, { agreement: false, promoWords: PROMO_CODE_WORDS.not_for("Day pass") }), code: null, amount: 1500 },
      { line: lineOf(SUMMER_TYPE, { agreement: false, promo: SPRING20 }), code: "SPRING20", amount: 12100 },
      { line: lineOf(GOLD_TYPE, { agreement: false, card: { brand: "VISA", last4: "1111" }, promo: SPRING20 }), code: "SPRING20", amount: 3999 },
    ];
    for (const c of cases) {
      const body = buyBody(c.line, null);
      expect(body.amountMinor).toBe(c.amount);
      if (c.code === null) expect(body).not.toHaveProperty("code");
      else expect(body.code).toBe(c.code);
      expect(appPurchaseRequestSchema.safeParse({ ...body, requestKey: PRESS }).success).toBe(true);
    }
  });

  it("reads what it takes off, with whatever else makes today's amount", () => {
    const pack = lineOf(PACK_TYPE, { promo: SPRING20 });
    expect(todayLine(pack)).toBe("$72.00 today, with the code SPRING20");
    expect(promoLine(pack)).toBe("SPRING20 · Spring offer: −\u2060$18.00");
    expect(todayLine(lineOf(SUMMER_TYPE, { promo: SPRING20 }))).toBe("$121.00 today, with a $25.00 joining fee and the code SPRING20");
    expect(todayLine(lineOf(PACK_TYPE, { promo: SPRING20, taxes: [{ name: "Sales tax", pcm: 8250 }] }))).toBe("$77.94 today, with the code SPRING20 and tax");
    // Used in place of the Refer a friend gift: the gift is not said, the code is.
    expect(todayLine(lineOf(PACK_TYPE, { friendGift: true, promo: SPRING20 }))).toBe("$72.00 today, with the code SPRING20");
    expect(promoLine(lineOf(PACK_TYPE, {}))).toBeNull();
  });

  it("refused at Pay as no longer usable: the list is read again, which says why", () => {
    expect(buyRefusalSaid("app_purchase_promo", PROMO_CODE_WORDS.used_up)).toEqual({ tone: "warn", line: PROMO_CODE_WORDS.used_up, reread: true });
    expect(buyRefusalSaid("promo_code_tries", PROMO_CODE_WORDS.too_many)).toEqual({ tone: "bad", line: PROMO_CODE_WORDS.too_many });
  });
});
