// A person's membership (spec Part 3 §13.2; ROADMAP 17a-ii).
//
// The first block is the worst thing this job could do to a real person: show a
// paid-up member as ended or owing a day early, so the desk turns them away or asks
// them for money. Its dates come from the calendar, not from the code: each expected
// day below was read off a 2026–2029 calendar (2028 is the leap year), and the month-end
// renewals are the ones a card company's billing gives (31 Jan, 28 Feb, 31 Mar).
import { describe, expect, it } from "vitest";
import {
  HELD_PAID_AHEAD_MAX,
  addDays,
  addTerms,
  daysBetween,
  giveHeldMembership,
  heldMembershipView,
  isCalendarDay,
  moveHeldMembership,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week" };
const yearly: HeldMembershipTerms = { ...monthly, termUnit: "year" };
const quarterly: HeldMembershipTerms = { ...monthly, termCount: 3 };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3 };
const freeWeek: HeldMembershipTerms = { ...monthly, kind: "trial", termCount: 7, termUnit: "day", priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };
const dayPass: HeldMembershipTerms = { ...tenPack, packClasses: 1, packDays: 1, priceMinor: 1500 };

function given(type: HeldMembershipTerms, startsOn: string, paid: boolean, today: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function moved(m: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(`refused: ${JSON.stringify(event)} on ${today}`);
  return move.membership;
}

describe("a paid-up member is never shown as ended or owing a day early", () => {
  it("a one-time membership runs through its last day and ends the day after", () => {
    // [type, starts, last day it runs]
    const cases: [HeldMembershipTerms, string, string][] = [
      [threeMonths, "2026-10-04", "2027-01-03"],
      [threeMonths, "2026-11-30", "2027-02-27"], // 30 Nov + 3 months is 28 Feb: February has no 30th
      [threeMonths, "2027-11-30", "2028-02-28"], // a leap February: 29 Feb is the day after
      [{ ...threeMonths, termCount: 1 }, "2026-01-31", "2026-02-27"],
      [{ ...threeMonths, termCount: 1 }, "2028-01-31", "2028-02-28"],
      [{ ...threeMonths, termCount: 1, termUnit: "year" }, "2028-02-29", "2029-02-27"],
      [{ ...threeMonths, termCount: 2, termUnit: "week" }, "2026-12-25", "2027-01-07"],
      [freeWeek, "2026-12-29", "2027-01-04"],
      [tenPack, "2026-10-04", "2026-12-02"],
      [dayPass, "2026-12-31", "2026-12-31"],
    ];
    for (const [type, starts, last] of cases) {
      const m = given(type, starts, true, starts);
      const label = `${type.kind} from ${starts}`;
      expect(heldMembershipView(m, starts).endsOn, label).toBe(last);
      // A day pass has no day before its last: the day before is before it starts.
      expect(heldMembershipView(m, addDays(last, -1)).status, `${label}, the day before its last`).toBe(last === starts ? "upcoming" : "active");
      expect(heldMembershipView(m, last).status, `${label}, on its last day`).toBe("active");
      expect(heldMembershipView(m, addDays(last, 1)).status, `${label}, the day after`).toBe("ended");
    }
  });

  it("a repeating membership renews on the same day each period, counted from its start", () => {
    // [type, starts, the renewal days that follow]
    const cases: [HeldMembershipTerms, string, string[]][] = [
      [monthly, "2026-10-04", ["2026-11-04", "2026-12-04", "2027-01-04"]],
      [monthly, "2026-01-31", ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]],
      [monthly, "2027-12-31", ["2028-01-31", "2028-02-29", "2028-03-31"]],
      [monthly, "2026-08-30", ["2026-09-30", "2026-10-30", "2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28", "2027-03-30"]],
      [quarterly, "2026-11-30", ["2027-02-28", "2027-05-30", "2027-08-30"]],
      [weekly, "2026-12-28", ["2027-01-04", "2027-01-11"]],
      [yearly, "2028-02-29", ["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]],
    ];
    for (const [type, starts, renewals] of cases) {
      const m = given(type, starts, true, starts);
      let from = starts;
      for (const renewal of renewals) {
        const label = `${String(type.termCount)} ${String(type.termUnit)} from ${starts}`;
        // Every day of the period, its first and its last included, shows this renewal.
        for (const day of [from, addDays(from, 1), addDays(renewal, -1)]) {
          const view = heldMembershipView(m, day);
          expect(view.renewsOn, `${label} on ${day}`).toBe(renewal);
          expect(view.status, `${label} on ${day}`).toBe("active");
          expect(view.endsOn).toBeNull();
        }
        from = renewal;
      }
    }
  });

  it("paid up to a day means paid on every day before it, and owing from that day on", () => {
    const m = given(monthly, "2026-10-04", true, "2026-10-04");
    expect(heldMembershipView(m, "2026-10-04").payment).toEqual({ state: "paid", until: "2026-11-04" });
    expect(heldMembershipView(m, "2026-11-03").payment).toEqual({ state: "paid", until: "2026-11-04" });
    expect(heldMembershipView(m, "2026-11-04").payment).toEqual({ state: "due", since: "2026-11-04" });
    expect(heldMembershipView(m, "2026-12-25").payment).toEqual({ state: "due", since: "2026-11-04" });
    // Owing never ends a repeating membership: staff decide that.
    expect(heldMembershipView(m, "2027-06-01").status).toBe("active");

    const paidAgain = moved(m, { type: "paid", paidPeriods: 2 }, "2026-11-04");
    expect(heldMembershipView(paidAgain, "2026-12-03").payment).toEqual({ state: "paid", until: "2026-12-04" });
    expect(heldMembershipView(paidAgain, "2026-12-04").payment).toEqual({ state: "due", since: "2026-12-04" });

    // A month-end start: paid for January and February is paid up to 31 March, not 28 March.
    const monthEnd = moved(given(monthly, "2026-01-31", true, "2026-01-31"), { type: "paid", paidPeriods: 2 }, "2026-02-01");
    expect(heldMembershipView(monthEnd, "2026-03-30").payment).toEqual({ state: "paid", until: "2026-03-31" });
    expect(heldMembershipView(monthEnd, "2026-03-31").payment).toEqual({ state: "due", since: "2026-03-31" });
  });

  it("not marked paid is owing from the start day, and one payment covers a one-time membership or a pack", () => {
    for (const type of [threeMonths, tenPack, dayPass]) {
      const unpaid = given(type, "2026-10-04", false, "2026-10-04");
      expect(heldMembershipView(unpaid, "2026-10-04").payment).toEqual({ state: "due", since: "2026-10-04" });
      const paid = moved(unpaid, { type: "paid", paidPeriods: 1 }, "2026-10-04");
      expect(heldMembershipView(paid, "2026-10-04").payment).toEqual({ state: "paid", until: null });
      expect(heldMembershipView(paid, "2026-10-04").can.markPaid).toBeNull();
    }
    // A free trial has nothing to pay, paid or not.
    for (const paid of [true, false]) {
      const trial = given(freeWeek, "2026-10-04", paid, "2026-10-04");
      expect(trial.paidPeriods).toBe(0);
      const view = heldMembershipView(trial, "2026-10-05");
      expect(view.payment).toBeNull();
      expect(view.can.markPaid).toBeNull();
      expect(view.can.undoPaid).toBeNull();
    }
  });

  it("a membership given to someone who started earlier is paid, or owing, for the period today is in", () => {
    // Started 4 July, given on 20 October: the period is 4 Oct to 3 Nov.
    const upToDate = given(monthly, "2026-07-04", true, "2026-10-20");
    expect(heldMembershipView(upToDate, "2026-10-20")).toMatchObject({
      status: "active",
      renewsOn: "2026-11-04",
      payment: { state: "paid", until: "2026-11-04" },
    });
    const owing = given(monthly, "2026-07-04", false, "2026-10-20");
    expect(heldMembershipView(owing, "2026-10-20").payment).toEqual({ state: "due", since: "2026-10-04" });
    // Given on a renewal day itself, the new period is the one in question.
    expect(heldMembershipView(given(monthly, "2026-07-04", true, "2026-11-04"), "2026-11-04").payment).toEqual({
      state: "paid",
      until: "2026-12-04",
    });
    // Years back, by the week: no drift.
    const old = given(weekly, "2001-01-01", true, "2026-10-04");
    expect(daysBetween("2001-01-01", heldMembershipView(old, "2026-10-04").renewsOn ?? "") % 7).toBe(0);
    expect(heldMembershipView(old, "2026-10-04").renewsOn).toBe("2026-10-05");
  });

  it("a membership that starts later is upcoming until its start day", () => {
    const m = given(monthly, "2026-10-12", false, "2026-10-04");
    expect(heldMembershipView(m, "2026-10-11")).toMatchObject({ status: "upcoming", renewsOn: "2026-11-12", payment: { state: "due", since: "2026-10-12" } });
    expect(heldMembershipView(m, "2026-10-11").can.freeze).toBe(false);
    expect(heldMembershipView(m, "2026-10-12")).toMatchObject({ status: "active", payment: { state: "due", since: "2026-10-12" } });
  });
});

describe("freezing gives back every day frozen", () => {
  it("moves a one-time membership's last day by the days it was frozen", () => {
    const m = given(threeMonths, "2026-10-04", true, "2026-10-04"); // last day 3 Jan
    const frozen = moved(m, { type: "freeze" }, "2026-10-20");
    // Frozen, it never ends by itself and shows no end day: that day moves daily.
    expect(heldMembershipView(frozen, "2027-06-01")).toMatchObject({ status: "frozen", endsOn: null, renewsOn: null });
    const back = moved(frozen, { type: "unfreeze" }, "2026-10-30");
    expect(back.startsOn).toBe("2026-10-04");
    expect(heldMembershipView(back, "2026-10-30").endsOn).toBe("2027-01-13");
    // The same day: nothing moves.
    const sameDay = moved(moved(m, { type: "freeze" }, "2026-10-20"), { type: "unfreeze" }, "2026-10-20");
    expect(heldMembershipView(sameDay, "2026-10-20").endsOn).toBe("2027-01-03");
    // Frozen twice: both stretches are given back.
    const twice = moved(moved(back, { type: "freeze" }, "2026-11-01"), { type: "unfreeze" }, "2026-11-06");
    expect(heldMembershipView(twice, "2026-11-06").endsOn).toBe("2027-01-18");
  });

  it("moves a repeating membership's renewal and what is paid by the same days", () => {
    const m = given(monthly, "2026-10-04", true, "2026-10-04"); // paid up to 4 Nov
    const frozen = moved(m, { type: "freeze" }, "2026-10-20");
    // While frozen, what was paid on the day it froze still counts as paid.
    expect(heldMembershipView(frozen, "2026-12-25").payment).toEqual({ state: "paid", until: null });
    const back = moved(frozen, { type: "unfreeze" }, "2026-10-30");
    expect(heldMembershipView(back, "2026-10-30")).toMatchObject({
      status: "active",
      renewsOn: "2026-11-14",
      payment: { state: "paid", until: "2026-11-14" },
    });
    expect(heldMembershipView(back, "2026-11-14").payment).toEqual({ state: "due", since: "2026-11-14" });
    // Owing when frozen is still owing while frozen.
    const owing = moved(given(monthly, "2026-10-04", false, "2026-10-04"), { type: "freeze" }, "2026-10-20");
    expect(heldMembershipView(owing, "2026-12-25").payment).toEqual({ state: "due", since: null });
  });

  it("gives back exactly the days frozen at a month's end, where February is shorter", () => {
    // [type, starts, frozen on, unfrozen on, the day paid up to (repeating) or the last day (one time), after]
    const cases: [HeldMembershipTerms, string, string, string, string][] = [
      [monthly, "2026-01-28", "2026-02-01", "2026-02-04", "2026-03-03"], // 28 Feb + 3
      [monthly, "2026-01-29", "2026-02-01", "2026-02-03", "2026-03-02"], // 28 Feb + 2
      [monthly, "2026-01-30", "2026-02-01", "2026-02-02", "2026-03-01"], // 28 Feb + 1
      [monthly, "2026-01-31", "2026-02-01", "2026-03-04", "2026-03-31"], // 28 Feb + 31
      [monthly, "2026-02-28", "2026-03-01", "2026-03-02", "2026-03-29"], // 28 Mar + 1
      [yearly, "2028-02-29", "2028-03-01", "2028-03-06", "2029-03-05"], // 28 Feb 2029 + 5
      [{ ...threeMonths, termCount: 1 }, "2026-01-29", "2026-02-01", "2026-02-03", "2026-03-01"], // last day 27 Feb + 2
      [{ ...threeMonths, termCount: 1 }, "2026-01-31", "2026-02-10", "2026-02-13", "2026-03-02"], // last day 27 Feb + 3
    ];
    for (const [type, starts, frozenOn, backOn, want] of cases) {
      const m = given(type, starts, true, starts);
      const back = moved(moved(m, { type: "freeze" }, frozenOn), { type: "unfreeze" }, backOn);
      const view = heldMembershipView(back, backOn);
      const label = `${type.kind} from ${starts}, frozen ${frozenOn} to ${backOn}`;
      if (type.kind === "recurring") expect(view.payment, label).toEqual({ state: "paid", until: want });
      else expect(view.endsOn, label).toBe(want);
      expect(back.startsOn).toBe(starts);
    }
  });

  it("moves every date by exactly the days frozen, whatever the start day, the unit and the length of the freeze", () => {
    const kinds: HeldMembershipTerms[] = [monthly, quarterly, weekly, yearly, threeMonths, { ...threeMonths, termCount: 1, termUnit: "year" }, tenPack, freeWeek];
    let checked = 0;
    for (const year of ["2026", "2028"]) {
      for (let offset = 0; offset < 91; offset++) {
        const starts = addDays(`${year}-01-01`, offset);
        for (const type of kinds) {
          for (const days of [1, 2, 3, 30, 31, 400]) {
            const m = given(type, starts, true, starts);
            const before = heldMembershipView(m, starts);
            const backOn = addDays(starts, days);
            const back = moved(moved(m, { type: "freeze" }, starts), { type: "unfreeze" }, backOn);
            const after = heldMembershipView(back, backOn);
            const label = `${type.kind} ${String(type.termCount)} ${String(type.termUnit)} from ${starts}, frozen ${String(days)} days`;
            if (before.endsOn !== null) expect(daysBetween(before.endsOn, after.endsOn ?? ""), label).toBe(days);
            if (before.payment?.state === "paid" && before.payment.until !== null) {
              expect(after.payment, label).toEqual({ state: "paid", until: addDays(before.payment.until, days) });
            }
            if (before.renewsOn !== null) expect(after.renewsOn, label).toBe(addDays(before.renewsOn, days));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(2 * 91 * 8 * 6);
  });

  it("a pack frozen keeps its classes and gets its days back", () => {
    const m = given(tenPack, "2026-10-04", true, "2026-10-04"); // last day 2 Dec
    const back = moved(moved(m, { type: "freeze" }, "2026-11-01"), { type: "unfreeze" }, "2026-11-08");
    expect(back.classesLeft).toBe(10);
    expect(heldMembershipView(back, "2026-11-08").endsOn).toBe("2026-12-09");
  });
});

describe("cancelling", () => {
  it("today stops it today, whatever is paid", () => {
    const m = given(monthly, "2026-10-04", true, "2026-10-04");
    const gone = moved(m, { type: "cancel", when: "today" }, "2026-10-20");
    expect(heldMembershipView(gone, "2026-10-20")).toMatchObject({ status: "cancelled", endsOn: "2026-10-20", renewsOn: null, payment: null });
    expect(heldMembershipView(gone, "2027-10-20").status).toBe("cancelled");
  });

  it("at the end of what is paid runs through the last paid day, then ends, and takes no more payments", () => {
    const m = given(monthly, "2026-10-04", true, "2026-10-04");
    expect(heldMembershipView(m, "2026-10-20").can.cancelAtPeriodEnd).toBe("2026-11-03");
    const stopping = moved(m, { type: "cancel", when: "period_end" }, "2026-10-20");
    const view = heldMembershipView(stopping, "2026-10-21");
    expect(view).toMatchObject({ status: "active", endsOn: "2026-11-03", renewsOn: null });
    expect(view.can.markPaid).toBeNull();
    expect(view.can.undoPaid).toBeNull();
    expect(view.can.cancelAtPeriodEnd).toBeNull();
    expect(heldMembershipView(stopping, "2026-11-03").status).toBe("active");
    expect(heldMembershipView(stopping, "2026-11-04").status).toBe("ended");
    // Nothing paid ahead: there is no paid period to run out, so only "today" is offered.
    const owing = given(monthly, "2026-10-04", false, "2026-10-04");
    expect(heldMembershipView(owing, "2026-10-20").can.cancelAtPeriodEnd).toBeNull();
    expect(moveHeldMembership(owing, { type: "cancel", when: "period_end" }, "2026-10-20")).toEqual({ ok: false, reason: "not_allowed" });
    // Only a repeating membership has a period end to cancel at.
    expect(heldMembershipView(given(threeMonths, "2026-10-04", true, "2026-10-04"), "2026-10-20").can.cancelAtPeriodEnd).toBeNull();
  });
});

describe("the one transition, every status against every event", () => {
  const today = "2026-10-20";
  const active = given(monthly, "2026-10-04", true, "2026-10-04");
  const states: Record<string, HeldMembership> = {
    upcoming: given(monthly, "2026-11-01", true, "2026-10-04"),
    active,
    "active, will not renew": moved(active, { type: "cancel", when: "period_end" }, "2026-10-10"),
    frozen: moved(active, { type: "freeze" }, "2026-10-10"),
    ended: given(threeMonths, "2026-07-01", true, "2026-07-01"),
    cancelled: moved(active, { type: "cancel", when: "today" }, "2026-10-10"),
  };
  const events: Record<string, HeldMembershipEvent> = {
    freeze: { type: "freeze" },
    unfreeze: { type: "unfreeze" },
    "cancel today": { type: "cancel", when: "today" },
    "cancel at period end": { type: "cancel", when: "period_end" },
    "mark paid": { type: "paid", paidPeriods: 2 },
    "undo paid": { type: "paid", paidPeriods: 0 },
  };
  // What each pair gives: a status it moves to, "same" (already so: nothing written),
  // "kept" (the status stays and something else changes) or "refused".
  const expected: Record<string, Record<string, string>> = {
    upcoming: { freeze: "refused", unfreeze: "same", "cancel today": "cancelled", "cancel at period end": "kept", "mark paid": "kept", "undo paid": "kept" },
    active: { freeze: "frozen", unfreeze: "same", "cancel today": "cancelled", "cancel at period end": "kept", "mark paid": "kept", "undo paid": "kept" },
    "active, will not renew": { freeze: "frozen", unfreeze: "same", "cancel today": "cancelled", "cancel at period end": "same", "mark paid": "refused", "undo paid": "refused" },
    frozen: { freeze: "same", unfreeze: "active", "cancel today": "cancelled", "cancel at period end": "refused", "mark paid": "kept", "undo paid": "kept" },
    ended: { freeze: "refused", unfreeze: "refused", "cancel today": "refused", "cancel at period end": "refused", "mark paid": "refused", "undo paid": "refused" },
    cancelled: { freeze: "refused", unfreeze: "refused", "cancel today": "same", "cancel at period end": "refused", "mark paid": "refused", "undo paid": "refused" },
  };

  for (const [stateName, state] of Object.entries(states)) {
    for (const [eventName, event] of Object.entries(events)) {
      it(`${stateName} + ${eventName}`, () => {
        const want = expected[stateName]?.[eventName];
        const move = moveHeldMembership(state, event, today);
        if (want === "refused") {
          expect(move).toEqual({ ok: false, reason: "not_allowed" });
          return;
        }
        if (!move.ok) throw new Error("refused");
        const before = heldMembershipView(state, today).status;
        const after = heldMembershipView(move.membership, today).status;
        if (want === "same") {
          expect(move.changed).toBe(false);
          expect(move.membership).toEqual(state);
        } else if (want === "kept") {
          expect(move.changed).toBe(true);
          expect(after).toBe(before);
          // The one thing each of these is meant to move, and nothing else.
          const meant =
            event.type === "paid" ? { paidPeriods: event.paidPeriods } : event.type === "cancel" ? { renews: false } : null;
          if (meant === null) throw new Error("no kept pair expects this event");
          expect(move.membership).toEqual({ ...state, ...meant });
          expect(move.membership).not.toEqual(state);
        } else {
          expect(move.changed).toBe(true);
          expect(after).toBe(want);
        }
      });
    }
  }

  it("the same request arriving twice changes it once", () => {
    for (const event of [events["freeze"], events["cancel today"], events["cancel at period end"], events["mark paid"]]) {
      if (event === undefined) throw new Error("no event");
      const once = moveHeldMembership(active, event, today);
      if (!once.ok) throw new Error("refused");
      const twice = moveHeldMembership(once.membership, event, today);
      expect(twice).toEqual({ ok: true, membership: once.membership, changed: false });
    }
  });

  it("the clock ends an active membership past its last day before any event meets it", () => {
    const over = given(threeMonths, "2026-07-01", true, "2026-07-01"); // last day 30 Sep
    expect(over.status).toBe("active");
    expect(moveHeldMembership(over, { type: "freeze" }, "2026-10-01")).toEqual({ ok: false, reason: "not_allowed" });
    expect(moveHeldMembership(over, { type: "freeze" }, "2026-09-30")).toMatchObject({ ok: true, changed: true });
    // A pack with no class left has ended, whatever the date.
    const used = { ...given(tenPack, "2026-10-04", true, "2026-10-04"), classesLeft: 0 };
    expect(heldMembershipView(used, "2026-10-05").status).toBe("ended");
    expect(heldMembershipView({ ...used, classesLeft: 1 }, "2026-10-05").status).toBe("active");
  });

  it("marks paid one period at a time, either way, and only so far ahead", () => {
    expect(moveHeldMembership(active, { type: "paid", paidPeriods: 3 }, today)).toEqual({ ok: false, reason: "not_allowed" });
    expect(moveHeldMembership(given(threeMonths, "2026-10-04", true, today), { type: "paid", paidPeriods: 2 }, today)).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    let m = active;
    let marks = 0;
    for (;;) {
      const next = heldMembershipView(m, today).can.markPaid;
      if (next === null) break;
      m = moved(m, { type: "paid", paidPeriods: next.paidPeriods }, today);
      marks += 1;
      if (marks > 100) throw new Error("no ceiling");
    }
    expect(marks).toBe(HELD_PAID_AHEAD_MAX);
    // Taken back all the way to nothing paid, and no further.
    for (let n = m.paidPeriods - 1; n >= 0; n--) m = moved(m, { type: "paid", paidPeriods: n }, today);
    expect(heldMembershipView(m, today).can.undoPaid).toBeNull();
    expect(heldMembershipView(m, today).payment).toEqual({ state: "due", since: "2026-10-04" });
  });
});

describe("taking a payment mark back", () => {
  it("never goes below what the membership was given with", () => {
    // Started 4 July, given on 20 October with the paid tick left off: three earlier
    // periods count as paid, and staff marked none of them.
    const owing = given(monthly, "2026-07-04", false, "2026-10-20");
    expect(owing).toMatchObject({ paidPeriods: 3, paidFloor: 3 });
    expect(heldMembershipView(owing, "2026-10-20").can.undoPaid).toBeNull();
    expect(moveHeldMembership(owing, { type: "paid", paidPeriods: 2 }, "2026-10-20")).toEqual({ ok: false, reason: "not_allowed" });
    // Ticked paid by mistake: that one mark can be taken back, and no further.
    const ticked = given(monthly, "2026-07-04", true, "2026-10-20");
    expect(ticked).toMatchObject({ paidPeriods: 4, paidFloor: 3 });
    expect(heldMembershipView(ticked, "2026-10-20").can.undoPaid).toEqual({ paidPeriods: 3 });
    const back = moved(ticked, { type: "paid", paidPeriods: 3 }, "2026-10-20");
    expect(heldMembershipView(back, "2026-10-20").can.undoPaid).toBeNull();
    expect(heldMembershipView(back, "2026-10-20").payment).toEqual({ state: "due", since: "2026-10-04" });
    // Years back, by the week: nothing to take back, however many periods have gone by.
    const old = given(weekly, "2000-01-03", false, "2026-10-04");
    expect(old.paidFloor).toBe(old.paidPeriods);
    expect(old.paidPeriods).toBeGreaterThan(1000);
    expect(heldMembershipView(old, "2026-10-04").can.undoPaid).toBeNull();
  });
});

describe("giving a membership", () => {
  it("refuses a start day the calendar does not have, one too far off, and one already over", () => {
    const today = "2026-10-04";
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "26-10-04", "", "1999-12-31", "2027-10-06"]) {
      expect(giveHeldMembership(monthly, bad, true, today), bad).toEqual({ ok: false, reason: "start_out_of_range" });
    }
    expect(giveHeldMembership(monthly, "2027-10-05", true, today).ok).toBe(true);
    expect(giveHeldMembership(monthly, "2000-01-01", true, today).ok).toBe(true);
    expect(giveHeldMembership(dayPass, "2026-10-03", true, today)).toEqual({ ok: false, reason: "already_over" });
    expect(giveHeldMembership(dayPass, "2026-10-04", true, today).ok).toBe(true);
    expect(giveHeldMembership(threeMonths, "2026-07-04", true, today)).toEqual({ ok: false, reason: "already_over" });
    expect(giveHeldMembership(threeMonths, "2026-07-05", true, today).ok).toBe(true);
  });

  it("keeps the type's term as it was, a pack's classes, and whether there is anything to pay", () => {
    expect(given(tenPack, "2026-10-04", false, "2026-10-04")).toMatchObject({ classesLeft: 10, packDays: 60, renews: false, free: false, paidPeriods: 0 });
    expect(given(monthly, "2026-10-04", true, "2026-10-04")).toMatchObject({ classesLeft: null, renews: true, frozenDays: 0, paidPeriods: 1, paidFloor: 0 });
    expect(given(freeWeek, "2026-10-04", true, "2026-10-04")).toMatchObject({ free: true, renews: false });
  });
});

describe("day arithmetic", () => {
  it("knows the calendar", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2100-02-29")).toBe(false);
    expect(isCalendarDay("2000-02-29")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(addTerms("2026-01-31", 1, "month", 13)).toBe("2027-02-28");
    expect(addTerms("2026-03-29", 1, "week", 1)).toBe("2026-04-05"); // across a clock change
  });
});
