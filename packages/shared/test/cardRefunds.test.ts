// Refund to card's words (ROADMAP 18d-iv-a): the wire is read strictly, and a code Square adds later never says more than
// it knows.
import { describe, expect, it } from "vitest";
import { CARD_REFUND_BLOCKS, CARD_REFUND_WORDS, cardRefundCheckSchema, cardRefundRefusedLine, cardRefundRequestSchema, cardRefundSentLine } from "../src/index.js";

describe("cardRefundRefusedLine", () => {
  it.each([
    ["REFUND_AMOUNT_INVALID", "less of this payment left"],
    ["AMOUNT_TOO_HIGH", "less of this payment left"],
    ["INSUFFICIENT_FUNDS", "doesn't have enough money"],
    ["PAYMENT_NOT_REFUNDABLE_DUE_TO_DISPUTE", "has a chargeback"],
    ["PAYMENT_NOT_REFUNDABLE", "can't be refunded"],
    ["INSUFFICIENT_PERMISSIONS_FOR_REFUND", "isn't allowed"],
    ["SOMETHING_NEW", "Square refused this refund"],
    [null, "Square refused this refund"],
  ])("%s", (code, words) => {
    const line = cardRefundRefusedLine(code);
    expect(line).toContain(words);
    expect(line).toContain("No money went back");
  });
});

describe("the wire", () => {
  it("every block has its words", () => {
    for (const block of CARD_REFUND_BLOCKS) expect(CARD_REFUND_WORDS[block].length).toBeGreaterThan(10);
  });
  it("a press takes a whole amount of at least 1, a reason from the list, and nothing else", () => {
    const ok = { requestKey: "11111111-1111-4111-8111-111111111111", amountMinor: 1, reason: "other" };
    expect(cardRefundRequestSchema.safeParse(ok).success).toBe(true);
    expect(cardRefundRequestSchema.safeParse({ ...ok, amountMinor: 0 }).success).toBe(false);
    expect(cardRefundRequestSchema.safeParse({ ...ok, amountMinor: 1.5 }).success).toBe(false);
    expect(cardRefundRequestSchema.safeParse({ ...ok, reason: "because" }).success).toBe(false);
    expect(cardRefundRequestSchema.safeParse({ ...ok, paymentId: "x" }).success).toBe(false);
  });
  it("a check names only a known block", () => {
    expect(cardRefundCheckSchema.safeParse({ card: null, leftMinor: 0, refundedInSquareMinor: 0, block: "nope" }).success).toBe(false);
  });
});

describe("what a press says", () => {
  const sent = { amountMinor: 2000, currency: "USD", card: null, pressId: "88888888-8888-4888-8888-000000000001", onTerminal: null } as const;
  it("pending and completed both say it is on its way", () => {
    expect(cardRefundSentLine({ ...sent, step: "pending" }, "Visa ending 1111")).toBe("Square is processing this $20.00 refund to Visa ending 1111. It can take up to 14 business days to reach the card, depending on the bank.");
    expect(cardRefundSentLine({ ...sent, step: "completed" }, "the card")).toBe("$20.00 was refunded to the card. It can take up to 10 business days to reach the card, depending on the bank.");
  });
  it("no answer never says it went", () => {
    expect(cardRefundSentLine({ ...sent, step: "checking" }, "the card")).toBe("Square hasn't answered yet, so $20.00 is not refunded yet. Don't refund it again: this page will say when Square answers.");
  });
});
