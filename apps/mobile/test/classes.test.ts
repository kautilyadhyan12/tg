import { describe, expect, it } from "vitest";
import { classBookingViewSchema, type ClassBookingView } from "@app/shared";
import {
  actionsOf,
  askedLate,
  cancelAsk,
  dayHeading,
  feesText,
  mineText,
  newRequestKey,
  nextReadAt,
  onlineText,
  ordinal,
  placesText,
  shortDay,
  weekText,
  whenText,
  whyText,
  zoneNote,
} from "../src/screens/gym/classesView";

// The classes' words, every class of case: what the server says about a class in, what the member reads
// out. Read through the server's own shape, so a case the server cannot send is not tested here.

type Over = Partial<Omit<ClassBookingView, "can" | "mine">> & { can?: Partial<ClassBookingView["can"]>; mine?: ClassBookingView["mine"] };
const klass = (over: Over = {}): ClassBookingView =>
  classBookingViewSchema.parse({
    sessionId: "11111111-1111-4111-8111-111111111111",
    className: "Spin",
    localDate: "2026-11-02",
    localStartMinute: 18 * 60 + 30,
    timezone: "Asia/Kolkata",
    startsAt: "2026-11-02T13:00:00.000Z",
    minutes: 45,
    cancelled: false,
    places: 12,
    booked: 8,
    waitlisted: 0,
    opensAt: "2026-10-26T13:00:00.000Z",
    freeCancelUntil: "2026-11-02T11:00:00.000Z",
    online: null,
    fees: null,
    ...over,
    mine: over.mine ?? null,
    can: { book: false, joinWaitlist: false, claim: false, cancel: null, why: null, ...over.can },
  });
const booked = (packCharged = false) => ({ status: "booked" as const, waitlistPlace: null, packCharged });
const waiting = (place: number | null) => ({ status: "waitlisted" as const, waitlistPlace: place, packCharged: false });
const INR = { lateCancelMinor: 50_000, noShowMinor: 80_000, currency: "INR" };

describe("how full a class is", () => {
  it.each([
    ["free places", klass({ can: { book: true } }), "4 of 12 places left"],
    ["the last place", klass({ booked: 11, can: { book: true } }), "1 place left"],
    ["full, nobody waiting", klass({ booked: 12, can: { joinWaitlist: true } }), "Full"],
    ["full, two waiting", klass({ booked: 12, waitlisted: 2, can: { joinWaitlist: true } }), "Full · 2 on the waitlist"],
    [
      "a free place that is the first in line's",
      klass({ booked: 11, waitlisted: 1, can: { joinWaitlist: true } }),
      "Full · 1 on the waitlist · a free place is going to the first in line",
    ],
    ["a free place, and they may claim it", klass({ booked: 11, waitlisted: 1, mine: waiting(1), can: { claim: true, cancel: "free" } }), "1 place left"],
    ["a free place they may not book (membership)", klass({ booked: 11, waitlisted: 1, can: { why: "not_covered" } }), "1 place left"],
    ["no limit", klass({ places: null, can: { book: true } }), null],
    ["cancelled by the gym", klass({ cancelled: true }), null],
    ["more booked than places (made smaller)", klass({ places: 8, booked: 10 }), "Full"],
  ])("%s", (_, c, words) => {
    expect(placesText(c)).toBe(words);
  });
});

describe("what the member holds", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");
  it.each([
    ["nothing", klass(), null],
    ["booked", klass({ mine: booked() }), { pill: "You’re booked", tone: "good", line: null }],
    ["booked from a pack", klass({ mine: booked(true) }), { pill: "You’re booked", tone: "good", line: "1 class used from your pack" }],
    ["second in line", klass({ mine: waiting(2) }), { pill: "On the waitlist", tone: "gold", line: "Not booked yet · 2nd in line" }],
    ["waiting, place not known", klass({ mine: waiting(null) }), { pill: "On the waitlist", tone: "gold", line: "Not booked yet" }],
    ["checked in before the start", klass({ mine: { status: "attended", waitlistPlace: null, packCharged: false } }), { pill: "Checked in", tone: "good", line: null }],
    ["late cancel on a pack", klass({ mine: { status: "late_cancelled", waitlistPlace: null, packCharged: true } }), { pill: "Late cancel", tone: "plain", line: "The class stays used on your pack" }],
    ["no-show", klass({ mine: { status: "no_show", waitlistPlace: null, packCharged: false } }), { pill: "No-show", tone: "plain", line: null }],
    ["cancelled free", klass({ mine: { status: "cancelled", waitlistPlace: null, packCharged: false } }), null],
    ["booked on a class the gym cancelled", klass({ cancelled: true, mine: booked() }), null],
  ])("%s", (_, c, words) => {
    expect(mineText(c, now)).toEqual(words);
  });

  it("an online class under way that they came to reads Attended", () => {
    expect(mineText(klass({ mine: { status: "attended", waitlistPlace: null, packCharged: false } }), Date.parse("2026-11-02T13:10:00.000Z"))?.pill).toBe("Attended");
  });
});

describe("the buttons", () => {
  it.each([
    ["book", klass({ can: { book: true } }), "Book", null],
    ["full: join the waitlist", klass({ can: { joinWaitlist: true } }), "Join waitlist", null],
    ["claim beats book", klass({ mine: waiting(1), can: { claim: true, book: true, cancel: "free" } }), "Claim place", "Leave waitlist"],
    ["booked, free to cancel", klass({ mine: booked(), can: { cancel: "free" } }), null, "Cancel booking"],
    ["booked, late", klass({ mine: booked(), can: { cancel: "late" } }), null, "Cancel booking"],
    ["waiting", klass({ mine: waiting(2), can: { cancel: "free" } }), null, "Leave waitlist"],
    ["nothing to do", klass({ can: { why: "class_started" } }), null, null],
  ])("%s", (_, c, take, give) => {
    const { take: t, give: g } = actionsOf(c);
    expect(t?.label ?? null).toBe(take);
    expect(g?.label ?? null).toBe(give);
  });

  it("only Join waitlist asks to wait", () => {
    expect(actionsOf(klass({ can: { joinWaitlist: true } })).take?.joinWaitlist).toBe(true);
    expect(actionsOf(klass({ can: { book: true } })).take?.joinWaitlist).toBe(false);
    expect(actionsOf(klass({ mine: waiting(1), can: { claim: true } })).take?.joinWaitlist).toBe(false);
  });
});

describe("why a class cannot be booked, on the gym's clock", () => {
  it.each([
    ["not open yet, 12-hour", klass({ can: { why: "not_open_yet" } }), "12h", "Booking opens Mon 26 Oct, 6:30 PM."],
    ["not open yet, 24-hour", klass({ can: { why: "not_open_yet" } }), "24h", "Booking opens Mon 26 Oct, 18:30."],
    ["not covered", klass({ can: { why: "not_covered" } }), "12h", "Your membership doesn't include this class. Ask at the front desk."],
    ["payment overdue", klass({ can: { why: "payment_overdue" } }), "12h", "Your payment is overdue. Please pay at the front desk to book."],
    ["waitlist full", klass({ can: { why: "waitlist_full" } }), "12h", "This class and its waitlist are full."],
    ["cancelled by the gym", klass({ cancelled: true }), "12h", "This class has been cancelled."],
    ["a place to claim", klass({ mine: waiting(1), can: { claim: true } }), "12h", "A place is free. The first person on the waitlist to claim it gets it."],
    ["bookable", klass({ can: { book: true } }), "12h", null],
  ] as const)("%s", (_, c, clock, words) => {
    expect(whyText(c, clock)).toBe(words);
  });
});

describe("the box before a cancel: every fee it names is the one sent", () => {
  it.each([
    ["leave the waitlist", klass({ mine: waiting(2), can: { cancel: "free" } }), "Leave the waitlist?", "You lose your place in line."],
    ["free, plain", klass({ mine: booked(), can: { cancel: "free" } }), "Cancel your booking?", "Free to cancel until Mon 2 Nov, 4:30 PM."],
    ["free, from a pack", klass({ mine: booked(true), can: { cancel: "free" } }), "Cancel your booking?", "Free to cancel until Mon 2 Nov, 4:30 PM. Your pack gets the class back."],
    [
      "free, with a fee later",
      klass({ mine: booked(), can: { cancel: "free" }, fees: INR }),
      "Cancel your booking?",
      "Free to cancel until Mon 2 Nov, 4:30 PM. After that there is a one-time late cancel fee of ₹500.00.",
    ],
    ["late, no fee", klass({ mine: booked(), can: { cancel: "late" } }), "Cancel late?", "It's too late to cancel for free. Cancelling now counts as a late cancel."],
    [
      "late, on a pack",
      klass({ mine: booked(true), can: { cancel: "late" } }),
      "Cancel late?",
      "It's too late to cancel for free. Cancelling now counts as a late cancel, and the class stays used on your pack.",
    ],
    [
      "late, with a fee",
      klass({ mine: booked(), can: { cancel: "late" }, fees: INR }),
      "Cancel late?",
      "It's too late to cancel for free. Cancelling now counts as a late cancel, and a one-time late cancel fee of ₹500.00 will be added to your bill.",
    ],
  ])("%s", (_, c, title, line) => {
    const ask = cancelAsk(c, "12h");
    expect(ask.title).toBe(title);
    expect(ask.lines).toEqual(["Spin, Mon 2 Nov at 6:30 PM", line]);
  });

  it("the server's late answer brings its own fee, and a body it cannot read brings none", () => {
    const c = klass({ mine: booked(), can: { cancel: "free" }, fees: INR });
    const now = askedLate(c, { error: "late_cancel", packCharged: false, feeMinor: 70_000, currency: "INR" });
    expect(now.can.cancel).toBe("late");
    expect(now.fees).toEqual({ lateCancelMinor: 70_000, noShowMinor: 80_000, currency: "INR" });
    for (const body of [null, "late", { feeMinor: "70000", currency: "INR" }, { feeMinor: 1.5, currency: "INR" }, { feeMinor: 700, currency: "rupees" }, { feeMinor: 0, currency: "INR" }]) {
      expect(askedLate(c, body).fees).toBeNull();
    }
    expect(askedLate(klass({ mine: booked(), can: { cancel: "free" } }), { packCharged: true }).mine?.packCharged).toBe(true);
  });

  it("the fees line shows only where there is something to book or give up", () => {
    expect(feesText(klass({ can: { book: true }, fees: INR }))).toBe("One-time fee for each late cancel ₹500.00 · no-show ₹800.00");
    expect(feesText(klass({ can: { why: "class_started" }, fees: INR }))).toBeNull();
    expect(feesText(klass({ can: { book: true } }))).toBeNull();
  });
});

describe("days and times are the gym's", () => {
  it.each([
    [0, "12h", "12:00 AM · 45 min"],
    [12 * 60, "12h", "12:00 PM · 45 min"],
    [18 * 60 + 30, "12h", "6:30 PM · 45 min"],
    [18 * 60 + 30, "24h", "18:30 · 45 min"],
    [5, "24h", "00:05 · 45 min"],
  ] as const)("minute %d on a %s clock", (minute, clock, words) => {
    expect(whenText(klass({ localStartMinute: minute }), clock)).toBe(words);
  });

  it("headings, a week and a day", () => {
    expect(dayHeading("2026-11-01", "2026-11-01")).toBe("Today · Sun 1 Nov");
    expect(dayHeading("2026-11-02", "2026-11-01")).toBe("Tomorrow · Mon 2 Nov");
    expect(dayHeading("2026-11-03", "2026-11-01")).toBe("Tue 3 Nov");
    expect(dayHeading("2027-01-01", "2026-12-31")).toBe("Tomorrow · Fri 1 Jan");
    expect(dayHeading("2026-11-01", null)).toBe("Sun 1 Nov");
    expect(weekText({ from: "2026-12-29", to: "2027-01-04" })).toBe("29 Dec – 4 Jan");
    expect(shortDay("2026-02-30")).toBe("2026-02-30");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
  });

  it("says whose clock it is only when the phone's differs", () => {
    expect(zoneNote([klass()], "Iron House", "Asia/Kolkata")).toBeNull();
    expect(zoneNote([klass()], "Iron House", "America/New_York")).toBe("Times are Iron House time (Asia/Kolkata), not this phone’s.");
    expect(zoneNote([], "Iron House", "America/New_York")).toBeNull();
  });
});

describe("online classes", () => {
  const LINK = "https://meet.example.org/spin";
  const online = (state: "not_booked" | "waiting" | "early" | "open" | "no_link" | "closed", link: string | null = null) => ({
    state,
    opensAt: "2026-11-02T12:30:00.000Z",
    link,
  });

  it("the link only when the server sends it open, and only an https one", () => {
    expect(onlineText(klass({ online: online("open", LINK) }))).toEqual({ line: "Online class. Your link is ready.", link: LINK });
    expect(onlineText(klass({ online: online("open", "http://meet.example.org/spin") }))?.link).toBeNull();
    expect(onlineText(klass({ online: online("early") }))?.link).toBeNull();
    expect(onlineText(klass({ cancelled: true, online: online("closed") }))).toBeNull();
    expect(onlineText(klass())).toBeNull();
  });

  it("is read again when its link is due, while it is missing, and when the class ends", () => {
    const opens = Date.parse("2026-11-02T12:30:00.000Z");
    expect(nextReadAt([klass({ online: online("early") })], opens - 60_000)).toBe(opens + 1000);
    expect(nextReadAt([klass({ online: online("early") })], opens + 5000)).toBe(opens + 25_000);
    expect(nextReadAt([klass({ online: online("early") })], opens + 11 * 60_000)).toBe(opens + 12 * 60_000);
    expect(nextReadAt([klass({ online: online("early") })], opens - 2 * 86_400_000)).toBeNull();
    expect(nextReadAt([klass({ online: online("no_link") })], opens)).toBe(opens + 20_000);
    const end = Date.parse("2026-11-02T13:45:00.000Z");
    expect(nextReadAt([klass({ online: online("open", LINK) })], end - 60_000)).toBe(end + 1000);
    expect(nextReadAt([klass(), klass({ online: online("not_booked") })], opens)).toBeNull();
  });
});

it("a request key is a version-4 uuid, a new one each time", () => {
  const one = newRequestKey();
  expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(newRequestKey()).not.toBe(one);
});
