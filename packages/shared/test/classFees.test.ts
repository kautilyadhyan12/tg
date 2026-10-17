// A fee for a late cancel or a no-show, for classes (spec Part 3 §14.2; ROADMAP 18h-i): the
// one rule for whether one costs money, and the words a member reads.
import { describe, expect, it } from "vitest";
import { classFeeFor, classFeesLine, feeItemName, lateCancelFeeWords } from "../src/index.js";

const fees = { lateCancelMinor: 500, noShowMinor: 800 };
const HELD = "7f9c2b8e-4a51-4c3d-9e2f-1b6a0d5c8e71";

describe("classFeeFor", () => {
  const cases: { name: string; fee: "late_cancel" | "no_show"; heldMembershipId: string | null; packCharged: boolean; fees: typeof fees; want: number }[] = [
    { name: "a late cancel on a membership", fee: "late_cancel", heldMembershipId: HELD, packCharged: false, fees, want: 500 },
    { name: "a no-show on a membership", fee: "no_show", heldMembershipId: HELD, packCharged: false, fees, want: 800 },
    { name: "a late cancel on a pack: the class stays used, and that is all", fee: "late_cancel", heldMembershipId: HELD, packCharged: true, fees, want: 0 },
    { name: "a no-show on a pack", fee: "no_show", heldMembershipId: HELD, packCharged: true, fees, want: 0 },
    { name: "a booking with no membership behind it", fee: "late_cancel", heldMembershipId: null, packCharged: false, fees, want: 0 },
    { name: "a no-show with no membership behind it", fee: "no_show", heldMembershipId: null, packCharged: false, fees, want: 0 },
    { name: "fees off", fee: "late_cancel", heldMembershipId: HELD, packCharged: false, fees: { lateCancelMinor: 0, noShowMinor: 0 }, want: 0 },
    { name: "a no-show where only late cancels cost", fee: "no_show", heldMembershipId: HELD, packCharged: false, fees: { lateCancelMinor: 500, noShowMinor: 0 }, want: 0 },
    { name: "a late cancel where only no-shows cost", fee: "late_cancel", heldMembershipId: HELD, packCharged: false, fees: { lateCancelMinor: 0, noShowMinor: 800 }, want: 0 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(classFeeFor(c)).toBe(c.want);
    });
  }
});

describe("the words", () => {
  it("the box before a late cancel names the fee in the gym's money", () => {
    expect(lateCancelFeeWords(500, "GBP")).toBe(
      "It's too late to cancel for free. Cancelling now counts as a late cancel, and a one-time late cancel fee of £5.00 will be added to your bill.",
    );
    expect(lateCancelFeeWords(20000, "INR")).toContain("a one-time late cancel fee of ₹200.00 will be added");
  });
  it("the line beside a class says only the fees that cost something", () => {
    expect(classFeesLine({ ...fees, currency: "GBP" })).toBe("One-time fees: late cancel £5.00 · no-show £8.00");
    expect(classFeesLine({ lateCancelMinor: 0, noShowMinor: 800, currency: "GBP" })).toBe("One-time fee: no-show £8.00");
    expect(classFeesLine({ lateCancelMinor: 500, noShowMinor: 0, currency: "GBP" })).toBe("One-time fee: late cancel £5.00");
    expect(classFeesLine({ lateCancelMinor: 0, noShowMinor: 0, currency: "GBP" })).toBeNull();
  });
  it("a fee is named for what it was for", () => {
    expect(feeItemName("late_cancel", "Spin")).toBe("Late cancel fee · Spin");
    expect(feeItemName("no_show", "Yoga Flow")).toBe("No-show fee · Yoga Flow");
  });
});
