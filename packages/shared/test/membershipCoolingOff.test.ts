// A cooling-off period on a line of the price list (ROADMAP 18v-iii).
//
// The first block is the worst thing this job could do to a real person: a full refund offered to a
// member whose days are over, or never offered on a day still inside them. Every date below was read
// off the calendar (`date -d`), not worked out by the code.
import { describe, expect, it } from "vitest";
import {
  agreementFacts,
  cancelHeldMembershipRequestSchema,
  giveHeldMembership,
  heldMembershipView,
  moveHeldMembership,
  noticeAsked,
  releaseAsked,
  saveGymMembershipTypeRequestSchema,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000, coolingOffDays: 3 };
const COOL: HeldMembershipEvent = { type: "cancel", when: "cooling_off" };

function given(type: HeldMembershipTerms, startsOn: string, today: string, paid = true): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

/** Given on 4 November 2026, paid; its days count from then unless `from` says another day (a signing). */
const ana = (over: Partial<HeldMembership> = {}, type: HeldMembershipTerms = monthly): HeldMembership => ({ ...given(type, "2026-11-04", "2026-11-04"), ...over });
const offered = (m: HeldMembership, today: string) => heldMembershipView(m, today).can.coolingOff;

describe("the worst thing: a full refund only inside the days, from the first to the last", () => {
  it.each([
    // [what, from, days, today, until or null]
    ["the day it was added", "2026-11-04", 3, "2026-11-04", "2026-11-07"],
    ["the day after", "2026-11-04", 3, "2026-11-05", "2026-11-07"],
    ["the last day", "2026-11-04", 3, "2026-11-07", "2026-11-07"],
    ["the day after the last", "2026-11-04", 3, "2026-11-08", null],
    ["a month later", "2026-11-04", 3, "2026-12-04", null],
    ["one day: the day after", "2026-11-04", 1, "2026-11-05", "2026-11-05"],
    ["one day: two days after", "2026-11-04", 1, "2026-11-06", null],
    ["thirty days: the last", "2026-11-04", 30, "2026-12-04", "2026-12-04"],
    ["thirty days: the day after", "2026-11-04", 30, "2026-12-05", null],
    ["signed later: the signing day", "2026-11-10", 3, "2026-11-10", "2026-11-13"],
    ["signed later: before the signing", "2026-11-10", 3, "2026-11-09", null],
    ["across a month's end", "2027-01-30", 3, "2027-02-02", "2027-02-02"],
    ["across a leap day", "2028-02-28", 3, "2028-03-02", "2028-03-02"],
    ["across a year's end", "2026-12-30", 3, "2027-01-02", "2027-01-02"],
    ["across a year's end, the day after", "2026-12-30", 3, "2027-01-03", null],
  ] as const)("%s", (_what, from, days, today, until) => {
    const m: HeldMembership = { ...given({ ...monthly, coolingOffDays: days }, from, from), coolingOffFrom: from };
    expect(offered(m, today)).toEqual(until === null ? null : { until });
    const move = moveHeldMembership(m, COOL, today);
    if (until === null) expect(move).toEqual({ ok: false, reason: "not_allowed" });
    else expect(move).toMatchObject({ ok: true, changed: true, membership: { status: "cancelled", cancelledOn: today, changedMind: true, frozenOn: null } });
  });

  it.each([
    ["no cooling-off period", { coolingOffDays: null }],
    ["no day to count from: changed to another membership", { coolingOffFrom: null }],
    ["nothing to pay", { free: true }],
    ["cancelled already", { status: "cancelled", cancelledOn: "2026-11-04" }],
    ["cancelled in its cooling-off period already", { status: "cancelled", cancelledOn: "2026-11-04", changedMind: true }],
    ["cancelled early with its fee already", { leftEarly: true, renews: false }],
  ] as const)("none where there is %s", (_what, over) => {
    const m = ana(over);
    expect(offered(m, "2026-11-05")).toBeNull();
  });

  it("a week's pass whose week is over has none, inside the days or not", () => {
    const week: HeldMembershipTerms = { kind: "one_time", termCount: 1, termUnit: "day", packClasses: null, packDays: null, priceMinor: 1500, coolingOffDays: 3 };
    const m = given(week, "2026-11-04", "2026-11-04");
    expect(offered(m, "2026-11-04")).toEqual({ until: "2026-11-07" });
    expect(offered(m, "2026-11-05")).toBeNull();
  });

  it.each([
    ["frozen", { status: "frozen", frozenOn: "2026-11-05" }],
    ["still to start", {}],
    ["set to end at the end of what is paid", { renews: false }],
    ["with notice given", { noticeDays: 30, stopsAfter: 2 }],
  ] as const)("offered while %s", (what, over) => {
    const m = what === "still to start" ? { ...given(monthly, "2026-11-20", "2026-11-04"), ...over } : ana(over);
    expect(heldMembershipView(m, "2026-11-06").status).toBe(what === "still to start" ? "upcoming" : what === "frozen" ? "frozen" : "active");
    expect(offered(m, "2026-11-06")).toEqual({ until: "2026-11-07" });
    expect(moveHeldMembership(m, COOL, "2026-11-06")).toMatchObject({ ok: true, membership: { status: "cancelled", cancelledOn: "2026-11-06", changedMind: true } });
  });

  it("the same press twice is one, and nothing more is offered", () => {
    const once = moveHeldMembership(ana(), COOL, "2026-11-05");
    if (!once.ok) throw new Error("refused");
    expect(moveHeldMembership(once.membership, COOL, "2026-11-05")).toMatchObject({ ok: true, changed: false });
    expect(moveHeldMembership(once.membership, COOL, "2026-11-09")).toMatchObject({ ok: true, changed: false });
    expect(offered(once.membership, "2026-11-05")).toBeNull();
  });
});

describe("inside the days, no minimum term, notice or fee holds them", () => {
  const term: HeldMembershipTerms = { ...monthly, contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900, noticeDays: 30 };

  it("cancelled today with no reason, and leaving early with the fee is offered only once the days are over", () => {
    const m = ana({}, term);
    const inside = heldMembershipView(m, "2026-11-06");
    expect(inside.can).toMatchObject({ coolingOff: { until: "2026-11-07" }, leaveEarly: null, releaseNeeded: true });
    expect(releaseAsked(inside, "cooling_off")).toBe(false);
    expect(noticeAsked(inside, "cooling_off")).toBe(false);
    expect(moveHeldMembership(m, COOL, "2026-11-06")).toMatchObject({ ok: true, membership: { status: "cancelled", leftEarly: false, stopsAfter: null } });
    // Leaving early is refused inside the days, as Cancel does not offer it.
    expect(moveHeldMembership(m, { type: "cancel", when: "leave_early" }, "2026-11-06")).toEqual({ ok: false, reason: "not_allowed" });
    const after = heldMembershipView(m, "2026-11-08").can;
    expect(after.coolingOff).toBeNull();
    // Its 30 days' notice from 8 November ends on 7 December, in the period to 3 January.
    expect(after.leaveEarly).toEqual({ feeMinor: 9900, endsOn: "2027-01-03" });
  });
});

describe("given from a line", () => {
  it("copies the days from a line with a price, counting from the day it is added", () => {
    expect(given(monthly, "2026-11-04", "2026-11-04")).toMatchObject({ coolingOffDays: 3, coolingOffFrom: "2026-11-04", changedMind: false });
    expect(given({ ...monthly, coolingOffDays: null }, "2026-11-04", "2026-11-04")).toMatchObject({ coolingOffDays: null });
    expect(given({ ...monthly, priceMinor: 0 }, "2026-11-04", "2026-11-04")).toMatchObject({ coolingOffDays: null });
    const pack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90, priceMinor: 12000, coolingOffDays: 5 };
    expect(given(pack, "2026-11-04", "2026-11-04")).toMatchObject({ coolingOffDays: 5 });
  });

  it("the price list takes 1 to 30 days on a line with a price, of any kind", () => {
    const line = {
      name: "Gold",
      description: null,
      kind: "recurring",
      priceMinor: 5000,
      termCount: 1,
      termUnit: "month",
      packClasses: null,
      packDays: null,
      access: "all_classes",
      bookingsLimit: null,
      bookingsPeriod: null,
      classTypeIds: null,
    };
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, coolingOffDays: 3 }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, coolingOffDays: 30 }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse(line).data?.coolingOffDays).toBeNull();
    for (const days of [0, 31, 2.5, -1]) expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, coolingOffDays: days }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...line, priceMinor: 0, coolingOffDays: 3 }).success).toBe(false);
    const pack = { ...line, kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90 };
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...pack, coolingOffDays: 3 }).success).toBe(true);
  });

  it("a cancel with a full refund takes no reason and no fee", () => {
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "cooling_off" }).success).toBe(true);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "cooling_off", release: "moved" }).success).toBe(false);
    expect(cancelHeldMembershipRequestSchema.safeParse({ when: "cooling_off", leaveFeeMinor: 100 }).success).toBe(false);
  });
});

describe("the signed agreement says it", () => {
  const facts = (coolingOffDays: number | null, priceMinor = 5000) =>
    agreementFacts({
      gym: { name: "Iron House", postalAddress: null, contactPhone: null, contactEmail: null },
      personName: "Ana Lopez",
      membership: {
        typeName: "Gold",
        kind: "recurring",
        priceMinor,
        currency: "USD",
        termCount: 1,
        termUnit: "month",
        packClasses: null,
        startsOn: "2026-11-04",
        discount: null,
        tax: null,
        view: heldMembershipView(ana(), "2026-11-04"),
        coolingOffDays,
      },
      firstBill: null,
      taxIncluded: false,
    }).find((f) => f.label === "Cooling-off period")?.value;

  it.each([
    [3, "3 days after signing, to cancel with a full refund"],
    [1, "1 day after signing, to cancel with a full refund"],
    [null, undefined],
  ] as const)("%s days", (days, value) => {
    expect(facts(days)).toBe(value);
  });

  it("says nothing on a free one", () => {
    expect(facts(3, 0)).toBeUndefined();
  });
});
