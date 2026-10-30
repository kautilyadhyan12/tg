import { describe, expect, it } from "vitest";
import { myMembershipSchema, receiptSchema, type MyMembership } from "@app/shared";
import {
  classesText,
  datesText,
  daysText,
  dayText,
  feeText,
  feesOf,
  myReceiptPath,
  owedText,
  paymentText,
  purchasePaid,
  receiptHead,
  receiptLines,
  receiptNotes,
  receiptTitle,
  statusTag,
} from "../src/screens/gym/membershipView";

// My membership's words, every class of case: what the server says in, what the member reads out. Read through the
// server's own shape, so a case the server cannot send is not tested here.

const M1 = "11111111-1111-4111-8111-111111111111";
const held = (over: Partial<MyMembership> = {}): MyMembership =>
  myMembershipSchema.parse({
    id: M1,
    name: "Gold Monthly",
    kind: "recurring",
    priceMinor: 150_000,
    currency: "INR",
    status: "active",
    startsOn: "2026-10-04",
    fromList: false,
    endsOn: null,
    renewsOn: "2026-11-04",
    frozenOn: null,
    classesLeft: null,
    packClasses: null,
    owed: null,
    payments: [],
    olderPeriodsNotShown: 0,
    fees: [],
    ...over,
  });

const common = {
  gym: { name: "Iron House", address: null },
  on: "2026-10-04",
  person: "Ravi Kumar",
  personDeleted: false,
  paidBy: null,
  paidByDeleted: false,
  by: null,
  currency: "INR",
  cancelled: false,
};
const amounts = (over: object = {}) => ({ listedMinor: 150_000, discount: null, tax: null, totalMinor: 150_000, ...over });
const payment = (over: object = {}) =>
  receiptSchema.parse({
    ...common,
    kind: "payment",
    number: 12,
    item: { name: "Gold Monthly", covers: { from: "2026-10-04", to: "2026-11-03" }, part: false },
    amounts: amounts(),
    joiningFeeMinor: 0,
    changeCredit: null,
    paidMinor: 150_000,
    method: "cash",
    balance: null,
    refunds: [],
    ...over,
  });
const line = (name: string, quantity: number, unit: number, over: object = {}) => ({
  name,
  quantity,
  unitPriceMinor: unit,
  amounts: amounts({ listedMinor: quantity * unit, totalMinor: quantity * unit, ...over }),
});
const sale = (lines: object[], totalMinor: number, over: object = {}) =>
  receiptSchema.parse({ ...common, kind: "sale", number: 20, lines, totalMinor, method: "card_at_desk", refunds: [], ...over });
const pairs = (r: ReturnType<typeof receiptLines>) => r.map((l) => [l.label, l.amount]);

describe("days", () => {
  it("a day, a span in one year and across two, and one that cannot be read", () => {
    expect(dayText("2026-10-04")).toBe("4 Oct 2026");
    expect(daysText({ from: "2026-10-04", to: "2026-11-03" })).toBe("4 Oct – 3 Nov 2026");
    expect(daysText({ from: "2026-12-15", to: "2027-01-14" })).toBe("15 Dec 2026 – 14 Jan 2027");
    expect(daysText({ from: "2026-10-04", to: "2026-10-04" })).toBe("4 Oct 2026");
    expect(dayText("not a day")).toBe("not a day");
  });

  it("a receipt's address names the place and the number", () => {
    expect(myReceiptPath("g/1", 12)).toBe("/v1/orgs/g%2F1/my-membership/receipts/12");
  });
});

describe("a membership", () => {
  it("each status is the gym list's own word, and only Active is green", () => {
    expect((["upcoming", "active", "frozen", "ended", "cancelled"] as const).map((status) => statusTag(held({ status })))).toEqual([
      { label: "Not started", tone: "plain" },
      { label: "Active", tone: "good" },
      { label: "Frozen", tone: "orange" },
      { label: "Ended", tone: "plain" },
      { label: "Cancelled", tone: "plain" },
    ]);
  });

  it("its dates, every class", () => {
    const cases: [Partial<MyMembership>, string | null][] = [
      [{}, "Started 4 Oct 2026 · Renews 4 Nov 2026"],
      [{ status: "upcoming", startsOn: "2026-11-01", renewsOn: "2026-12-01" }, "Starts 1 Nov 2026 · Renews 1 Dec 2026"],
      [{ renewsOn: null, endsOn: "2026-11-03" }, "Started 4 Oct 2026 · Ends 3 Nov 2026, won’t renew"],
      [{ kind: "pack", renewsOn: null, endsOn: "2027-01-04" }, "Started 4 Oct 2026 · Ends 4 Jan 2027"],
      [{ kind: "pack", renewsOn: null, endsOn: "2026-10-04" }, "For 4 Oct 2026 only"],
      [{ kind: "one_time", renewsOn: null, endsOn: null }, "Started 4 Oct 2026"],
      [{ status: "frozen", renewsOn: null, frozenOn: "2026-10-20" }, "Started 4 Oct 2026 · Frozen since 20 Oct 2026"],
      [{ status: "ended", renewsOn: null, endsOn: "2026-11-03" }, "4 Oct 2026 to 3 Nov 2026"],
      [{ status: "ended", renewsOn: null, endsOn: null }, "Started 4 Oct 2026"],
      [{ status: "ended", renewsOn: null, endsOn: "2026-10-04" }, "For 4 Oct 2026 only"],
      [{ status: "cancelled", renewsOn: null, endsOn: "2026-10-20" }, "Started 4 Oct 2026 · Cancelled 20 Oct 2026"],
      [{ status: "cancelled", renewsOn: null, endsOn: "2026-10-01" }, "Was to start 4 Oct 2026 · Cancelled 1 Oct 2026"],
      // From the gym's own list: its start day was worked back, and is never said.
      [{ fromList: true }, "Renews 4 Nov 2026"],
      [{ fromList: true, renewsOn: null, endsOn: "2026-11-03" }, "Ends 3 Nov 2026, won’t renew"],
      [{ fromList: true, status: "ended", renewsOn: null, endsOn: "2026-10-03" }, "Ended 3 Oct 2026"],
      [{ fromList: true, renewsOn: null }, null],
    ];
    for (const [over, words] of cases) expect([over, datesText(held(over))]).toEqual([over, words]);
  });

  it("a pack in use says what is left; a one-day pass, a pack over and any other kind say nothing", () => {
    expect(classesText(held({ kind: "pack", classesLeft: 7, packClasses: 10, renewsOn: null, endsOn: "2027-01-04" }))).toBe("7 of 10 classes left");
    expect(classesText(held({ kind: "pack", classesLeft: 1, packClasses: 1, renewsOn: null, endsOn: "2027-01-04" }))).toBe("1 of 1 class left");
    expect(classesText(held({ kind: "pack", classesLeft: 1, packClasses: 1, renewsOn: null, endsOn: "2026-10-04" }))).toBeNull();
    expect(classesText(held({ kind: "pack", classesLeft: 0, packClasses: 10, status: "ended", renewsOn: null, endsOn: "2026-10-20" }))).toBeNull();
    expect(classesText(held())).toBeNull();
  });

  it("what is owed: due in orange, overdue in red, nothing where nothing is", () => {
    expect(owedText(held({ owed: { amountMinor: 150_000, dueOn: "2026-11-04", state: "due" } }))).toEqual({ text: "₹1,500.00 due on 4 Nov 2026.", tone: "orange" });
    expect(owedText(held({ owed: { amountMinor: 150_000, dueOn: "2026-10-04", state: "overdue" } }))).toEqual({ text: "₹1,500.00 overdue since 4 Oct 2026.", tone: "bad" });
    expect(owedText(held())).toBeNull();
  });

  it("a payment with its days, and one for a membership of one period", () => {
    const p = { amountMinor: 150_000, method: "upi" as const, paidOn: "2026-10-04", covers: { from: "2026-10-04", to: "2026-11-03" }, receiptNumber: 12, refunds: [] };
    expect(paymentText(p, "INR")).toEqual({ title: "₹1,500.00 · UPI", line: "Paid 4 Oct 2026 · for 4 Oct – 3 Nov 2026" });
    expect(paymentText({ ...p, covers: null, method: "company" }, "USD")).toEqual({ title: "$1,500.00 · Card on file", line: "Paid 4 Oct 2026" });
  });
});

describe("fees", () => {
  const fee = (state: "due" | "overdue" | "paid" | "refunded" | "waived", over: object = {}) => ({
    fee: "late_cancel" as const,
    forName: "Spin at 6",
    on: "2026-10-20",
    amountMinor: 20_000,
    dueOn: "2026-10-21",
    state,
    refundedMinor: 0,
    receiptNumber: state === "paid" || state === "refunded" ? 31 : null,
    ...over,
  });
  const item = (f: ReturnType<typeof fee>) => ({ fee: f, currency: "INR", membership: "Gold Monthly" });

  it("each state: only Paid is paid and only Paid has a receipt", () => {
    expect(feeText(item(fee("due")), "Iron House")).toEqual({
      title: "Late cancel fee · Spin at 6",
      tag: { label: "Payment due", tone: "orange" },
      line: "₹200.00 · 20 Oct 2026 · Gold Monthly",
      note: "Due on 21 Oct 2026.",
      receipt: null,
    });
    expect(feeText(item(fee("overdue")), "Iron House")).toMatchObject({ tag: { label: "Overdue", tone: "bad" }, note: "Overdue since 21 Oct 2026.", receipt: null });
    expect(feeText(item(fee("paid")), "Iron House")).toMatchObject({ tag: { label: "Paid", tone: "good" }, note: null, receipt: 31 });
    expect(feeText(item(fee("waived")), "Iron House")).toMatchObject({ tag: { label: "Waived", tone: "plain" }, note: "Iron House waived this fee.", receipt: null });
    expect(feeText(item(fee("refunded", { refundedMinor: 20_000 })), "Iron House")).toMatchObject({ tag: { label: "Refunded", tone: "plain" }, note: "Iron House refunded this fee.", receipt: 31 });
    expect(feeText(item(fee("paid", { refundedMinor: 5_000 })), "Iron House")).toMatchObject({ tag: { label: "Paid", tone: "good" }, note: "Iron House refunded ₹50.00 of this fee.", receipt: 31 });
  });

  it("a no-show and a freeze fee are named as the gym's list names them", () => {
    expect(feeText(item(fee("due", { fee: "no_show", forName: "Personal training with Sam" })), "Iron House").title).toBe("No-show fee · Personal training with Sam");
    expect(feeText(item(fee("due", { fee: "freeze", forName: "Gold Monthly" })), "Iron House").title).toBe("Freeze fee · Gold Monthly");
  });

  it("every membership's fees, newest day first, each with its own membership and money", () => {
    const a = held({ name: "Gold Monthly", fees: [fee("paid", { on: "2026-10-10" }), fee("due", { on: "2026-10-25" })] });
    const b = held({ id: "22222222-2222-4222-8222-222222222222", name: "Ten Classes", currency: "USD", fees: [fee("waived", { on: "2026-10-15" })] });
    expect(feesOf([a, b]).map((f) => [f.fee.on, f.membership, f.currency])).toEqual([
      ["2026-10-25", "Gold Monthly", "INR"],
      ["2026-10-15", "Ten Classes", "USD"],
      ["2026-10-10", "Gold Monthly", "INR"],
    ]);
  });
});

describe("a purchase", () => {
  it("how it was paid, in a sentence", () => {
    const p = { receiptNumber: 20, soldOn: "2026-10-22", method: "card_at_desk" as const, currency: "INR", totalMinor: 5_000, lines: [{ name: "Water", quantity: 1, totalMinor: 5_000 }], refunds: [] };
    expect(purchasePaid(p)).toBe("Paid by card at the desk · 22 Oct 2026");
    expect(purchasePaid({ ...p, method: "upi" })).toBe("Paid by UPI · 22 Oct 2026");
  });
});

describe("a receipt's lines, as the browser prints them", () => {
  it("a payment that paid the whole bill", () => {
    expect(receiptTitle(payment())).toBe("Receipt #12");
    expect(pairs(receiptLines(payment()))).toEqual([
      ["Gold Monthly, 4 Oct – 3 Nov 2026", "₹1,500.00"],
      ["Total", "₹1,500.00"],
      ["Paid by cash", "₹1,500.00"],
    ]);
  });

  it("a discount, a joining fee and a tax added on top", () => {
    const r = payment({
      amounts: amounts({ listedMinor: 200_000, discount: { name: "October offer", minor: 20_000 }, tax: { name: "GST", bp: 1800, included: false, minor: 32_400 }, totalMinor: 212_400 }),
      joiningFeeMinor: 50_000,
      paidMinor: 212_400,
    });
    expect(pairs(receiptLines(r))).toEqual([
      ["Gold Monthly, 4 Oct – 3 Nov 2026", "₹1,500.00"],
      ["Discount: October offer", "−₹200.00"],
      ["Joining fee", "₹500.00"],
      ["GST 18%", "₹324.00"],
      ["Total", "₹2,124.00"],
      ["Paid by cash", "₹2,124.00"],
    ]);
  });

  it("a tax inside the price, a part month, and a bill paid in parts", () => {
    const r = payment({
      item: { name: "Gold Monthly", covers: { from: "2026-10-20", to: "2026-10-31" }, part: true },
      amounts: amounts({ listedMinor: 60_000, tax: { name: null, bp: 500, included: true, minor: 2_857 }, totalMinor: 60_000 }),
      paidMinor: 20_000,
      balance: { paidBeforeMinor: 10_000, leftMinor: 30_000 },
    });
    expect(pairs(receiptLines(r))).toEqual([
      ["Gold Monthly, 20 Oct – 31 Oct 2026 (part month)", "₹600.00"],
      ["Bill total", "₹600.00"],
      ["Includes Tax 5%", "₹28.57"],
      ["Paid before", "₹100.00"],
      ["Paid by cash", "₹200.00"],
      ["Left to pay", "₹300.00"],
    ]);
  });

  it("a change of membership's credit", () => {
    const r = payment({ amounts: amounts({ listedMinor: 120_000, totalMinor: 120_000 }), changeCredit: { minor: 30_000, fromName: "Silver Monthly" }, paidMinor: 120_000 });
    expect(pairs(receiptLines(r)).slice(0, 2)).toEqual([
      ["Gold Monthly, 4 Oct – 3 Nov 2026", "₹1,500.00"],
      ["Unused days of Silver Monthly", "−₹300.00"],
    ]);
  });

  it("a sale of one product and a basket of several with two taxes", () => {
    expect(pairs(receiptLines(sale([line("Water bottle", 2, 2_500)], 5_000)))).toEqual([
      ["2 × Water bottle at ₹25.00 each", "₹50.00"],
      ["Total", "₹50.00"],
      ["Paid by card at the desk", "₹50.00"],
    ]);
    const basket = sale(
      [
        line("Shaker", 1, 50_000, { tax: { name: "GST", bp: 1800, included: false, minor: 9_000 }, totalMinor: 59_000 }),
        line("Protein bar", 2, 8_000, { tax: { name: "GST", bp: 500, included: true, minor: 762 } }),
      ],
      75_000,
    );
    expect(pairs(receiptLines(basket))).toEqual([
      ["1 × Shaker", "₹500.00"],
      ["2 × Protein bar at ₹80.00 each", "₹160.00"],
      ["Subtotal", "₹660.00"],
      ["GST 18%", "₹90.00"],
      ["Total", "₹750.00"],
      ["Includes GST 5%", "₹7.62"],
      ["Paid by card at the desk", "₹750.00"],
    ]);
  });

  it("a refund receipt", () => {
    const r = receiptSchema.parse({
      ...common,
      kind: "refund",
      number: 14,
      forReceipt: 12,
      item: { name: "Gold Monthly", covers: { from: "2026-10-04", to: "2026-11-03" } },
      refundedMinor: 50_000,
      method: "bank_transfer",
    });
    expect(receiptTitle(r)).toBe("Refund receipt #14");
    expect(pairs(receiptLines(r))).toEqual([
      ["Refund for receipt #12", null],
      ["Gold Monthly, 4 Oct – 3 Nov 2026", null],
      ["Given back by bank transfer", "₹500.00"],
    ]);
    expect(receiptNotes(r)).toEqual([]);
  });

  it("its notes name each refund, with the product on a basket", () => {
    expect(receiptNotes(payment({ refunds: [{ number: 14, on: "2026-10-10", amountMinor: 50_000 }] }))).toEqual(["₹500.00 given back on 10 Oct 2026 (refund receipt #14)."]);
    expect(receiptNotes(sale([line("Water bottle", 1, 2_500)], 2_500, { refunds: [{ number: 21, on: "2026-10-23", amountMinor: 2_500, item: "Water bottle" }] }))).toEqual([
      "₹25.00 given back for Water bottle on 23 Oct 2026 (refund receipt #21).",
    ]);
  });

  it("its head: the day, who it is for, and who paid where somebody else did", () => {
    expect(receiptHead(payment())).toEqual([
      { label: "Date", value: "4 Oct 2026" },
      { label: "For", value: "Ravi Kumar" },
    ]);
    expect(receiptHead(payment({ person: "Aarav Sharma", paidBy: "Priya Sharma" })).at(-1)).toEqual({ label: "Paid by", value: "Priya Sharma" });
    expect(receiptHead(payment({ paidBy: " " })).at(-1)).toEqual({ label: "Paid by", value: "No name on their record" });
    expect(receiptHead(payment({ paidBy: null, paidByDeleted: true })).at(-1)).toEqual({ label: "Paid by", value: "A deleted member" });
  });
});
