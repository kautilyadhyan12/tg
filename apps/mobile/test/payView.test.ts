import { describe, expect, it } from "vitest";
import { APP_PAYMENT_WORDS, appPaymentSchema, appPaymentRequestSchema, myMembershipSchema, type MyFee } from "@app/shared";
import { feesOf } from "../src/screens/gym/membershipView";
import { NOT_PAID, PAY_CHANGED, PAY_CHECK, billKey, billTarget, endedSaid, feeKey, feeTarget, keyOfPayment, payBody, payRefusalSaid, paySay } from "../src/screens/gym/payView";

// Pay what I owe (ROADMAP Stage 5 item 20f): which bill or fee has Pay, what Pay sends, and how the end is said. The
// server decides all of it (`appPayments.routes.test.ts`); the phone offers Pay only where the server would take it, sends
// exactly what it showed, and reads Paid only from the server's own `paid`.

const M = "11111111-1111-4111-8111-111111111111";
const F = "5d0f2f8e-6b0a-4c1e-9a43-2f6c1d9e7a02";
const TODAY = "2026-11-12";

const held = (over: Record<string, unknown> = {}) =>
  myMembershipSchema.parse({
    id: M,
    name: "Gold Monthly",
    kind: "recurring",
    priceMinor: 4900,
    currency: "USD",
    status: "active",
    startsOn: "2026-10-04",
    fromList: false,
    endsOn: null,
    renewsOn: "2026-12-04",
    frozenOn: null,
    classesLeft: null,
    packClasses: null,
    owed: null,
    payments: [],
    olderPeriodsNotShown: 0,
    fees: [],
    ...over,
  });
const owed = (over: Record<string, unknown> = {}) => ({ amountMinor: 4900, dueOn: "2026-11-04", state: "overdue", periodIndex: 1, ...over });
const fee = (over: Partial<MyFee> = {}): MyFee => ({
  id: F,
  fee: "no_show",
  forName: "Spin",
  on: "2026-11-10",
  amountMinor: 1000,
  dueOn: "2026-11-11",
  state: "overdue",
  refundedMinor: 0,
  refundPending: false,
  receiptNumber: null,
  stillOwed: true,
  check: false,
  ...over,
});
const feeItem = (f: MyFee) => {
  const [item] = feesOf([held({ fees: [f] })]);
  if (item === undefined) throw new Error("no fee");
  return item;
};

describe("the worst thing: Pay only where the server would take it, for exactly what is shown, and Paid only from the server", () => {
  it("a bill: owed and due by today has Pay; ahead of its day, nothing owed, waiting for the desk's check, or nothing to pay has none", () => {
    const cases: [string, Record<string, unknown> | null, boolean][] = [
      ["overdue", owed(), true],
      ["due today", owed({ state: "due", dueOn: TODAY }), true],
      ["due tomorrow: paying ahead stays at the desk", owed({ state: "due", dueOn: "2026-11-13" }), false],
      ["the front desk is checking an earlier payment", owed({ check: true }), false],
      ["nothing left to pay", owed({ amountMinor: 0 }), false],
      ["nothing owed", null, false],
    ];
    for (const [what, o, has] of cases) expect(billTarget(held({ owed: o }), TODAY) !== null, what).toBe(has);
    // Somebody else pays: the server sends no owed, so nothing.
    expect(billTarget(held({ owed: null, priceMinor: null }), TODAY)).toBeNull();
  });

  it("a fee: owed, due by today and still counted has Pay; paid, refunded, waived, ahead, no longer counted or being checked has none", () => {
    const cases: [string, Partial<MyFee>, boolean][] = [
      ["overdue", {}, true],
      ["due today", { state: "due", dueOn: TODAY }, true],
      ["due tomorrow", { state: "due", dueOn: "2026-11-13" }, false],
      ["paid", { state: "paid", receiptNumber: 31 }, false],
      ["refunded", { state: "refunded", receiptNumber: 31, refundedMinor: 1000 }, false],
      ["waived", { state: "waived" }, false],
      ["marked Came while a page held it", { stillOwed: false }, false],
      ["the front desk is checking an earlier payment", { check: true }, false],
      ["nothing to pay", { amountMinor: 0 }, false],
    ];
    for (const [what, over, has] of cases) expect(feeTarget(feeItem(fee(over)), TODAY) !== null, what).toBe(has);
  });

  it("Pay sends the bill or the fee it showed, all of its amount, never both, and the server's own shape takes it", () => {
    const bill = billTarget(held({ owed: owed() }), TODAY);
    const noShow = feeTarget(feeItem(fee()), TODAY);
    if (bill === null || noShow === null) throw new Error("no target");
    const pressId = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(payBody(bill, pressId)).toEqual({ requestKey: pressId, membershipId: M, amountMinor: 4900, periodIndex: 1 });
    expect(payBody(noShow, pressId)).toEqual({ requestKey: pressId, membershipId: M, amountMinor: 1000, feeId: F });
    expect(appPaymentRequestSchema.safeParse(payBody(bill, pressId)).success).toBe(true);
    expect(appPaymentRequestSchema.safeParse(payBody(noShow, pressId)).success).toBe(true);
    expect(paySay(bill)).toBe("Pay $49.00 for Gold Monthly");
    expect(paySay(noShow)).toBe("Pay $10.00 for No-show fee, Spin");
    expect(bill.key).toBe(billKey(M, 1));
    expect(noShow.key).toBe(feeKey(F));
  });

  it("only the server's paid reads Paid; closed reads not paid; check sends them to the desk; open says nothing yet", () => {
    const page = (state: string) =>
      appPaymentSchema.parse({ id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", membershipId: M, periodIndex: 1, feeId: null, amountMinor: 4900, currency: "USD", state, url: null, closesAt: null, receiptNumber: state === "paid" ? 12 : null });
    expect(endedSaid(page("paid"))).toEqual({ tone: "good", line: "Paid $49.00 in the app." });
    expect(endedSaid(page("closed"))).toEqual({ tone: "plain", line: NOT_PAID });
    expect(endedSaid(page("check"))).toEqual({ tone: "warn", line: PAY_CHECK });
    expect(endedSaid(page("open"))).toBeNull();
    for (const state of ["closed", "check", "open"]) expect(endedSaid(page(state))?.line ?? "", state).not.toMatch(/^Paid/);
    expect(keyOfPayment(page("open"))).toBe(billKey(M, 1));
    expect(keyOfPayment({ membershipId: M, periodIndex: null, feeId: F })).toBe(feeKey(F));
  });

  it("refusals are said in the member's words, a changed bill asks them to look again", () => {
    expect(payRefusalSaid("app_payment_changed", APP_PAYMENT_WORDS.changed)).toEqual({ tone: "warn", line: PAY_CHANGED });
    expect(payRefusalSaid("app_payment_check", APP_PAYMENT_WORDS.check_first)).toEqual({ tone: "warn", line: APP_PAYMENT_WORDS.check_first });
    expect(payRefusalSaid("app_payment_at_desk", APP_PAYMENT_WORDS.at_desk)).toEqual({ tone: "bad", line: APP_PAYMENT_WORDS.at_desk });
    expect(payRefusalSaid("app_payment_not_offered", APP_PAYMENT_WORDS.not_offered).line).toBe("You can't pay in the app here yet. Pay at the front desk.");
  });
});
