// UNDO CANCELLATION (ROADMAP 18l-ii-b): the one transition's `undo_cancel`, over every way the front desk cancels to a
// later day and every pair of them staff can stack, and the box's sentences.
import { describe, expect, it } from "vitest";
import {
  KEEP_WHENS,
  giveHeldMembership,
  heldMembershipView,
  moveHeldMembership,
  undoCancelDoneLine,
  undoCancelLines,
  undoCancelQuestion,
  undoCancelReplacedNote,
  type HeldMembership,
  type HeldMembershipTerms,
  type KeepWhen,
} from "../src/index.js";

const TODAY = "2026-11-12";
const base = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 2500 } as const;
const TYPES: Record<string, HeldMembershipTerms> = {
  plain: base,
  notice: { ...base, noticeDays: 30 },
  term: { ...base, contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900 },
  "term and notice": { ...base, contractPeriods: 3, contractThen: "renews", noticeDays: 30, leaveFeeMinor: 5000 },
};

const given = (type: HeldMembershipTerms, startsOn: string): HeldMembership => {
  const g = giveHeldMembership(type, startsOn, true, TODAY);
  if (!g.ok) throw new Error(g.reason);
  return g.membership;
};
const cancelled = (m: HeldMembership, when: KeepWhen): HeldMembership | null => {
  const move = moveHeldMembership(m, { type: "cancel", when, release: "moved" }, TODAY);
  return move.ok && move.changed ? move.membership : null;
};
/** What a cancel changes, and so what the undo must put back. */
const cancelFields = (m: HeldMembership) => ({ status: m.status, renews: m.renews, stopsAfter: m.stopsAfter ?? null, contractThen: m.contractThen, leftEarly: m.leftEarly === true });

describe("undo_cancel puts back exactly what the desk's cancels changed", () => {
  // Every type, two start days (one inside its minimum term's first months, one later), every single way and every
  // pair of ways that changes it, built from the rule itself rather than listed by hand.
  const cases: { name: string; m: HeldMembership; ways: KeepWhen[]; after: HeldMembership }[] = [];
  for (const [typeName, type] of Object.entries(TYPES)) {
    for (const startsOn of ["2026-10-01", "2026-03-01"]) {
      const m = given(type, startsOn);
      for (const a of KEEP_WHENS) {
        const one = cancelled(m, a);
        if (one === null) continue;
        cases.push({ name: `${typeName} from ${startsOn}: ${a}`, m, ways: [a], after: one });
        for (const b of KEEP_WHENS) {
          const two = cancelled(one, b);
          if (two !== null) cases.push({ name: `${typeName} from ${startsOn}: ${a} then ${b}`, m, ways: [a, b], after: two });
        }
      }
    }
  }

  it("covers the stacks staff can make: notice then the end of what is paid, the minimum term then leaving early", () => {
    const names = cases.map((c) => c.name);
    expect(names).toContain("notice from 2026-10-01: notice then period_end");
    expect(names).toContain("term from 2026-10-01: contract_end then period_end");
    expect(names).toContain("term from 2026-10-01: contract_end then leave_early");
    expect(cases.length).toBeGreaterThan(12);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const undone = moveHeldMembership(c.after, { type: "undo_cancel", ways: c.ways }, TODAY);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.changed).toBe(true);
    expect(cancelFields(undone.membership)).toEqual(cancelFields(c.m));
    expect(heldMembershipView(undone.membership, TODAY).renewsOn).toBe(heldMembershipView(c.m, TODAY).renewsOn);
    // Pressed again, it is already so.
    const again = moveHeldMembership(undone.membership, { type: "undo_cancel", ways: c.ways }, TODAY);
    expect(again).toMatchObject({ ok: true, changed: false });
  });

  it("the ways in either order are one undo", () => {
    const m = given(TYPES["notice"] ?? base, "2026-10-01");
    const two = cancelled(cancelled(m, "notice") ?? m, "period_end") ?? m;
    const forward = moveHeldMembership(two, { type: "undo_cancel", ways: ["notice", "period_end"] }, TODAY);
    const backward = moveHeldMembership(two, { type: "undo_cancel", ways: ["period_end", "notice"] }, TODAY);
    expect(forward).toEqual(backward);
  });

  it("refuses with no ways, once cancelled today, and once its last day has passed", () => {
    const m = given(base, "2026-10-01");
    const later = cancelled(m, "period_end") ?? m;
    expect(moveHeldMembership(later, { type: "undo_cancel", ways: [] }, TODAY)).toEqual({ ok: false, reason: "not_allowed" });
    const today = moveHeldMembership(later, { type: "cancel", when: "today" }, TODAY);
    if (!today.ok) throw new Error("cancel today");
    expect(moveHeldMembership(today.membership, { type: "undo_cancel", ways: ["period_end"] }, TODAY)).toEqual({ ok: false, reason: "not_allowed" });
    const lastDay = heldMembershipView(later, TODAY).endsOn ?? "";
    expect(moveHeldMembership(later, { type: "undo_cancel", ways: ["period_end"] }, "2027-01-15")).toEqual({ ok: false, reason: "not_allowed" });
    expect(lastDay).toBe("2026-11-30");
  });

  it("a way it was never cancelled by changes nothing it did not change", () => {
    const m = given(base, "2026-10-01");
    expect(moveHeldMembership(m, { type: "undo_cancel", ways: ["period_end"] }, TODAY)).toMatchObject({ ok: true, changed: false });
  });
});

describe("the box's sentences", () => {
  const facts = { name: "Maya Test", membershipName: "Off-peak Monthly", currency: "USD", next: { dueOn: "2026-12-06", amountMinor: 2500 }, card: null, feeOffMinor: null, ended: { classes: 0, sessions: 0 } };

  it("says it renews and the next payment, with the card where the app charges one", () => {
    expect(undoCancelQuestion("Maya Test", "Off-peak Monthly")).toBe("Undo the cancellation of Maya Test's Off-peak Monthly?");
    expect(undoCancelLines(facts)).toEqual(["It will keep renewing until it's cancelled again.", "Their next payment is $25.00 on 6 Dec 2026."]);
    expect(undoCancelLines({ ...facts, card: { brand: "VISA", last4: "1111" } })[1]).toMatch(/^Their next payment of \$25\.00 will be charged to .*1111 on 6 Dec 2026\.$/);
    expect(undoCancelLines({ ...facts, next: null })[1]).toBe("There's nothing to pay for it.");
  });

  it("names the fee taken off and the bookings that stay cancelled", () => {
    expect(undoCancelLines({ ...facts, feeOffMinor: 9900, ended: { classes: 2, sessions: 1 } }).slice(2)).toEqual([
      "The $99.00 early cancellation fee will be removed from their bills.",
      "The 2 class bookings and 1 personal training session cancelled with it aren't booked again.",
    ]);
    expect(undoCancelLines({ ...facts, ended: { classes: 1, sessions: 0 } })[2]).toBe("The 1 class booking cancelled with it isn't booked again.");
  });

  it("says what happened, and why another membership stops it", () => {
    expect(undoCancelDoneLine("Off-peak Monthly")).toBe("Off-peak Monthly is reactivated and will keep renewing.");
    expect(undoCancelReplacedNote("Maya Test", "Silver", "2026-12-04", true)).toBe("Maya Test is moving to Silver on 4 Dec 2026, so this cancellation can't be undone.");
    expect(undoCancelReplacedNote("Maya Test", "Silver", "2026-12-04", false)).toBe("Another membership, Silver, starts on 4 Dec 2026, so this cancellation can't be undone.");
  });
});
