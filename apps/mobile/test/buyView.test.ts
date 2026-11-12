import { describe, expect, it } from "vitest";
import { APP_PURCHASE_WORDS, appPurchaseRequestSchema, appPurchaseSchema, type AppPaymentState } from "@app/shared";
import {
  buyBody,
  buyRefusalSaid,
  buySay,
  endedBuySaid,
  lineSummary,
  nameLabel,
  paidBuyLine,
  payLabel,
  signerOf,
  todayLine,
  todayParts,
} from "../src/screens/gym/buyView";
import { NOT_PAID, PAY_CHECK, PAY_WAITING } from "../src/screens/gym/payView";
import { AGREEMENT_ID, DAY_TYPE, PACK_ID, PACK_TYPE, SUMMER_TYPE, lineOf } from "./forSaleLines";

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
    expect(endedBuySaid(purchase("closed"))).toEqual({ tone: "plain", line: NOT_PAID });
    expect(endedBuySaid(purchase("check"))).toEqual({ tone: "warn", line: PAY_CHECK });
    expect(endedBuySaid(purchase("open"))).toEqual({ tone: "warn", line: PAY_WAITING, again: true });
    for (const state of ["closed", "check", "open"] as const) expect(endedBuySaid(purchase(state))?.line).not.toMatch(/success|yours/i);
    expect(endedBuySaid(purchase("paid"))).toBeNull();
  });

  it("the paid line names what was bought, and the agreement only where one was signed", () => {
    expect(paidBuyLine(purchase("paid"), true)).toBe("$90.00 paid. 10-class pack is yours, and your signed agreement is on My membership.");
    expect(paidBuyLine(purchase("paid"), false)).toBe("$90.00 paid. 10-class pack is yours. It’s on My membership.");
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
