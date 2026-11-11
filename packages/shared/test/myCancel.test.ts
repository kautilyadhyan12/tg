// Cancel in the app (ROADMAP 18l): which ways a member may cancel, for every class of membership, and the sentences the
// box says. The front desk's own Cancel is the rule (`heldMembershipView`'s `can`), less a release; every day below was
// read off the calendar, not worked out by the code.
import { describe, expect, it } from "vitest";
import {
  appCancelLine,
  appCancelRowWhat,
  giveHeldMembership,
  heldMembershipView,
  moveHeldMembership,
  myCancelButton,
  myCancelDoneLine,
  myCancelFrontDeskSooner,
  myCancelFrozen,
  myCancelLines,
  myCancelOwedNote,
  myCancelPaidByLine,
  myCancelWays,
  myCancelledLine,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
  type MyCancelFacts,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const oneMonth: HeldMembershipTerms = { kind: "one_time", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const pack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string, today: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, today, null);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}
function moved(m: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)}: ${move.reason}`);
  return move.membership;
}
const ways = (m: HeldMembership, today: string) => myCancelWays(m, today).map((w) => `${w.when} ${w.endsOn}`);

// Started 1 October 2026, paid for October and November: paid to 30 November.
const TODAY = "2026-11-10";
const paidTwo = (type: HeldMembershipTerms): HeldMembership => ({ ...given(type, "2026-10-01", "2026-10-01"), paidPeriods: 2, coolingOffAdded: "2026-10-01" });

describe("the ways a member may cancel in the app, for every class of membership", () => {
  const cases: [string, HeldMembership, string, string[]][] = [
    ["repeating, paid past today: with what is paid", paidTwo(monthly), TODAY, ["period_end 2026-11-30"]],
    ["repeating, nothing paid past today: today", { ...paidTwo(monthly), paidPeriods: 1 }, TODAY, ["today 2026-11-10"]],
    ["repeating, still to start and paid: with what is paid, as the desk", given(monthly, "2026-12-01", TODAY), TODAY, ["period_end 2026-12-31"]],
    ["repeating, still to start, nothing paid: today", { ...given(monthly, "2026-12-01", TODAY), paidPeriods: 0 }, TODAY, ["today 2026-11-10"]],
    ["frozen with a notice: nothing dated, the front desk cancels it", { ...paidTwo({ ...monthly, noticeDays: 30 }), status: "frozen", frozenOn: "2026-11-05" }, TODAY, []],
    ["frozen inside a minimum term: nothing dated, the front desk cancels it", { ...paidTwo({ ...monthly, contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900 }), status: "frozen", frozenOn: "2026-11-05" }, TODAY, []],
    ["repeating, frozen: today, as the desk", { ...paidTwo(monthly), status: "frozen", frozenOn: "2026-11-05" }, TODAY, ["today 2026-11-10"]],
    ["set to end already: nothing", { ...paidTwo(monthly), renews: false }, TODAY, []],
    ["cancelled already: nothing", { ...paidTwo(monthly), status: "cancelled", cancelledOn: "2026-11-01" }, TODAY, []],
    ["set to end and ended by the clock: nothing", { ...paidTwo(monthly), renews: false }, "2026-12-15", []],
    ["a notice: it ends after it, at the end of the period its last day falls in", paidTwo({ ...monthly, noticeDays: 30 }), TODAY, ["notice 2026-12-31"]],
    ["a notice paid past already: with what is paid", { ...paidTwo({ ...monthly, noticeDays: 30 }), paidPeriods: 4 }, TODAY, ["period_end 2027-01-31"]],
    ["a notice given already: nothing", { ...paidTwo({ ...monthly, noticeDays: 30 }), stopsAfter: 3 }, TODAY, []],
    ["a minimum term that renews: with the term", paidTwo({ ...monthly, contractPeriods: 12, contractThen: "renews" }), TODAY, ["contract_end 2027-09-30"]],
    ["a minimum term with a fee: with the term, or early with the fee", paidTwo({ ...monthly, contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900 }), TODAY, ["contract_end 2027-09-30", "leave_early 2026-11-30"]],
    ["a minimum term that ends by itself: nothing to press", paidTwo({ ...monthly, contractPeriods: 12, contractThen: "ends" }), TODAY, []],
    ["a minimum term that ends by itself, with a fee: early with the fee", paidTwo({ ...monthly, contractPeriods: 12, contractThen: "ends", leaveFeeMinor: 9900 }), TODAY, ["leave_early 2026-11-30"]],
    ["a minimum term whose notice ends inside it: with the term", { ...paidTwo({ ...monthly, contractPeriods: 2, contractThen: "renews", noticeDays: 30 }), paidPeriods: 1 }, "2026-10-20", ["contract_end 2026-11-30"]],
    ["a minimum term whose notice runs past its end: after the notice", { ...paidTwo({ ...monthly, contractPeriods: 2, contractThen: "renews", noticeDays: 30 }), paidPeriods: 1 }, "2026-11-20", ["notice 2026-12-31"]],
    ["a minimum term paid past its end: with what is paid", { ...paidTwo({ ...monthly, contractPeriods: 2, contractThen: "renews" }), paidPeriods: 3 }, "2026-11-20", ["period_end 2026-12-31"]],
    ["paid once, outside its cooling-off period: nothing", paidTwo(oneMonth), "2026-10-10", []],
    ["a pack, outside its cooling-off period: nothing", given(pack, "2026-10-01", "2026-10-01"), "2026-10-10", []],
    ["repeating, inside its cooling-off period: a full refund alone", { ...paidTwo({ ...monthly, coolingOffDays: 3, contractPeriods: 12, contractThen: "renews", noticeDays: 30, leaveFeeMinor: 9900 }) }, "2026-10-03", ["cooling_off 2026-10-03"]],
    ["paid once, inside its cooling-off period: a full refund", { ...given({ ...oneMonth, coolingOffDays: 3 }, "2026-10-01", "2026-10-01"), coolingOffAdded: "2026-10-01" }, "2026-10-04", ["cooling_off 2026-10-04"]],
    ["a pack, inside its cooling-off period: a full refund", { ...given({ ...pack, coolingOffDays: 3 }, "2026-10-01", "2026-10-01"), coolingOffAdded: "2026-10-01" }, "2026-10-02", ["cooling_off 2026-10-02"]],
    ["the day after its cooling-off period: as any other", { ...given({ ...oneMonth, coolingOffDays: 3 }, "2026-10-01", "2026-10-01"), coolingOffAdded: "2026-10-01" }, "2026-10-05", []],
  ];
  it.each(cases)("%s", (_, m, today, expected) => {
    expect(ways(m, today)).toEqual(expected);
  });

  it("never offers today where something is paid past today, and each way is one the desk takes without a reason", () => {
    for (const [, m, today] of cases) {
      for (const w of myCancelWays(m, today)) {
        if (w.when === "today") expect(heldMembershipView(m, today).can.cancelAtPeriodEnd).toBeNull();
        // Each way is one the desk's own step takes without a reason.
        expect(moveHeldMembership(m, { type: "cancel", when: w.when }, today).ok, `${w.when} on ${today}`).toBe(true);
      }
    }
  });

  it("a frozen one held by a term or a notice is the front desk's; one held by nothing ends today", () => {
    expect(myCancelFrozen({ ...paidTwo({ ...monthly, noticeDays: 30 }), status: "frozen", frozenOn: "2026-11-05" }, TODAY)).toBe(true);
    expect(myCancelFrozen({ ...paidTwo(monthly), status: "frozen", frozenOn: "2026-11-05" }, TODAY)).toBe(false);
    expect(myCancelFrozen(paidTwo({ ...monthly, noticeDays: 30 }), TODAY)).toBe(false);
  });

  it("says the front desk can end it sooner only inside a minimum term or a notice", () => {
    expect(myCancelFrontDeskSooner(paidTwo(monthly), TODAY)).toBe(false);
    expect(myCancelFrontDeskSooner(paidTwo({ ...monthly, noticeDays: 30 }), TODAY)).toBe(true);
    expect(myCancelFrontDeskSooner(paidTwo({ ...monthly, contractPeriods: 12, contractThen: "renews" }), TODAY)).toBe(true);
    expect(myCancelFrontDeskSooner(moved(paidTwo({ ...monthly, noticeDays: 30 }), { type: "cancel", when: "notice" }, TODAY), TODAY)).toBe(true);
  });
});

describe("what the box says", () => {
  const facts = (over: Partial<MyCancelFacts>): MyCancelFacts => ({
    gymName: "Iron Gym",
    membershipName: "Gold Monthly",
    forName: null,
    currency: "USD",
    today: TODAY,
    way: { when: "period_end", endsOn: "2026-11-30" },
    upcoming: false,
    noticeDays: null,
    coolingOffUntil: null,
    termUntil: null,
    payments: [],
    card: null,
    feeMinor: null,
    refundMinor: null,
    ending: { classes: 0, sessions: 0 },
    paidAhead: false,
    renewsAgain: null,
    ...over,
  });
  const card = { brand: "VISA", last4: "1111" };

  it("each way's sentences, with the card only where the app charges it", () => {
    expect(myCancelLines(facts({}))).toEqual(["Gold Monthly ends on 30 Nov 2026, the last day you've paid for.", "No more payments come due for it."]);
    expect(myCancelLines(facts({ card }))[1]).toBe("Visa ending 1111 won't be charged again.");
    expect(myCancelLines(facts({ way: { when: "notice", endsOn: "2026-12-31" }, noticeDays: 30, payments: [{ dueOn: "2026-12-01", amountMinor: 4999 }], card }))).toEqual([
      "Gold Monthly has 30 days' notice to cancel, so it ends on 31 Dec 2026.",
      "Visa ending 1111 is charged $49.99 once more, on 1 Dec 2026.",
    ]);
    expect(myCancelLines(facts({ way: { when: "contract_end", endsOn: "2027-09-30" }, termUntil: "2027-09-30", payments: [{ dueOn: "2026-12-01", amountMinor: 4999 }, { dueOn: "2027-01-01", amountMinor: 5499 }] }))).toEqual([
      "Your minimum term runs until 30 Sep 2027, so Gold Monthly ends on 30 Sep 2027.",
      "2 more payments, $104.98 in all, are due, the last on 1 Jan 2027.",
    ]);
    expect(myCancelLines(facts({ way: { when: "leave_early", endsOn: TODAY }, feeMinor: 9900, ending: { classes: 2, sessions: 1 } }))).toEqual([
      "Cancel early: you pay the early cancellation fee of $99.00, and Gold Monthly ends today.",
      "No more payments come due for it.",
      "The $99.00 fee is added to your bill today. Pay it in the app or at the front desk.",
      "Your 2 class bookings and 1 personal training session are cancelled too.",
    ]);
    expect(myCancelLines(facts({ way: { when: "cooling_off", endsOn: TODAY }, coolingOffUntil: "2026-11-12", refundMinor: 5000 }))).toEqual([
      "You're in your cooling-off period until 12 Nov 2026. Gold Monthly ends today, and Iron Gym refunds the $50.00 you paid.",
    ]);
    expect(myCancelLines(facts({ way: { when: "today", endsOn: TODAY }, upcoming: true, paidAhead: true, renewsAgain: "Silver" }))).toEqual([
      "Gold Monthly is cancelled before it starts.",
      "No more payments come due for it.",
      "Ending it today doesn't refund what you've paid for it. Ask the front desk about a refund.",
      "Silver renews again, as it did before the change.",
    ]);
    expect(myCancelLines(facts({ ending: { classes: 1, sessions: 0 } }))[2]).toBe("Your 1 class booking after 30 Nov 2026 is cancelled too.");
  });

  it("pressed by whoever pays for them, every sentence says whose it is", () => {
    const dev = { forName: "Dev Shah" };
    expect(myCancelLines(facts(dev))[0]).toBe("Dev Shah's Gold Monthly ends on 30 Nov 2026, the last day you've paid for.");
    expect(myCancelLines(facts({ ...dev, way: { when: "contract_end", endsOn: "2027-09-30" }, termUntil: "2027-09-30" }))[0]).toBe(
      "Dev Shah's minimum term runs until 30 Sep 2027, so Dev Shah's Gold Monthly ends on 30 Sep 2027.",
    );
    expect(myCancelLines(facts({ ...dev, way: { when: "cooling_off", endsOn: TODAY }, coolingOffUntil: "2026-11-12", refundMinor: 5000 }))).toEqual([
      "Dev Shah's Gold Monthly is in its cooling-off period until 12 Nov 2026. It ends today, and Iron Gym refunds the $50.00 you paid.",
    ]);
    expect(myCancelLines(facts({ ...dev, ending: { classes: 2, sessions: 0 } }))[2]).toBe("Dev Shah's 2 class bookings after 30 Nov 2026 are cancelled too.");
    expect(myCancelDoneLine(facts(dev))).toBe("Cancelled. Dev Shah's Gold Monthly ends on 30 Nov 2026.");
  });

  it("the buttons, the done line, the owed note and who else can", () => {
    expect(myCancelButton("period_end", null, "USD")).toBe("Cancel membership");
    expect(myCancelButton("leave_early", 9900, "USD")).toBe("Cancel early, $99.00 fee");
    expect(myCancelButton("cooling_off", null, "USD")).toBe("Cancel with full refund");
    expect(myCancelDoneLine(facts({}))).toBe("Cancelled. Gold Monthly ends on 30 Nov 2026.");
    expect(myCancelDoneLine(facts({ way: { when: "today", endsOn: TODAY } }))).toBe("Cancelled. Gold Monthly ends today.");
    expect(myCancelDoneLine(facts({ way: { when: "cooling_off", endsOn: TODAY }, refundMinor: 5000 }))).toBe("Cancelled. Iron Gym refunds the $50.00 you paid.");
    expect(myCancelOwedNote(4999, "USD", "Iron Gym", null)).toBe("You still owe $49.99. Pay it in the app or at the front desk.");
    expect(myCancelOwedNote(4999, "USD", "Iron Gym", card)).toBe("You still owe $49.99. Pay it in the app or at the front desk. Iron Gym can charge your saved card, Visa ending 1111, for it.");
    expect(myCancelPaidByLine("Priya Sharma")).toBe("Priya Sharma pays for this membership, so Priya Sharma can cancel it in the app. Or ask the front desk.");
    expect(myCancelledLine("2026-11-10", true, "Maya Test")).toBe("You cancelled it in the app on 10 Nov 2026.");
    expect(myCancelledLine("2026-11-10", false, "Priya Sharma")).toBe("Priya Sharma cancelled it in the app on 10 Nov 2026.");
    expect(appCancelLine({ on: "2026-11-10", byName: "Maya Test", reason: "cost" })).toBe("Cancelled in the app on 10 Nov 2026 by Maya Test · Reason: Cost");
    expect(appCancelRowWhat({ membershipName: "Gold", on: "2026-11-10", endsOn: "2026-11-30", when: "period_end" })).toBe("Gold · Cancelled 10 Nov 2026 · Ends 30 Nov 2026");
    expect(appCancelRowWhat({ membershipName: "Gold", on: "2026-11-10", endsOn: "2026-11-10", when: "cooling_off" })).toBe("Gold · Cancelled 10 Nov 2026 · Ended in its cooling-off period");
    expect(appCancelRowWhat({ membershipName: "Gold", on: "2026-11-10", endsOn: null, when: "period_end" })).toBe("Gold · Cancelled 10 Nov 2026 · Frozen, no end day yet");
  });
});
