import { describe, expect, it } from "vitest";
import { memberPtResponseSchema, memberPtSessionSchema, type MemberPtResponse, type MemberPtSession } from "@app/shared";
import {
  askedLate,
  bookedText,
  couldNotRead,
  emptyText,
  gymInstant,
  historyText,
  opensLaterText,
  payText,
  ptBookAsk,
  ptCancelAsk,
  ptCancelledText,
  ptDay,
  ptDays,
  ptFeeText,
  ptZoneNote,
  sessionFeeLines,
  sessionSpan,
  sessionText,
  type BookTime,
} from "../src/screens/gym/ptView";

// Personal training's words, every class of case: what the server says in, what the member reads out. Read through
// the server's own shape, so a case the server cannot send is not tested here.

const INR = { lateCancelMinor: 50_000, noShowMinor: 80_000, currency: "INR" };
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const session = (over: Partial<MemberPtSession> = {}): MemberPtSession =>
  memberPtSessionSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    trainerName: "Sam Trainer",
    localDate: "2030-03-04",
    localStartMinute: 10 * 60,
    minutes: 60,
    startsAt: "2030-03-04T04:30:00.000Z",
    freeCancelUntil: "2030-03-04T02:30:00.000Z",
    status: "booked",
    packCharged: false,
    usesLimit: false,
    cancel: "free",
    fees: null,
    fee: null,
    ...over,
  });

type DayOver = Partial<MemberPtResponse["days"][number]>;
const dayOf = (localDate: string, over: DayOver = {}) => ({
  localDate,
  pays: { membership: "Gold", sessionsLeft: null },
  why: null,
  limit: null,
  fees: null,
  ...over,
});
const view = (over: Partial<MemberPtResponse> = {}, days: DayOver[] = [{}]): MemberPtResponse =>
  memberPtResponseSchema.parse({
    timezone: "Asia/Kolkata",
    today: "2030-03-04",
    from: "2030-03-04",
    to: "2030-03-10",
    lastDay: "2030-03-10",
    opensDays: 14,
    freeCancelMinutes: 120,
    record: "own",
    days: days.map((d, i) => dayOf(`2030-03-${String(4 + i).padStart(2, "0")}`, d)),
    trainers: [],
    sessions: [],
    history: [],
    ...over,
  });

describe("what a booking on a day uses, or why it can't be made", () => {
  const limit = { membership: "Gold", limit: 4, period: "week" as const, left: 2 };
  it.each([
    ["a record shared with another account", view({ record: "shared" }), false, /^Two app accounts share your record/],
    ["not on the gym's list", view({ record: "none" }), false, /./],
    ["no membership", view({}, [{ pays: null, why: "no_membership" }]), false, /./],
    ["the membership doesn't cover it", view({}, [{ pays: null, why: "not_covered" }]), false, /./],
    ["a payment overdue", view({}, [{ pays: null, why: "payment_overdue" }]), false, /./],
    ["included", view(), true, /^Personal training is included in your membership: Gold\.$/],
    ["a limit with sessions left", view({}, [{ limit }]), true, /^You have Gold: 2 of 4 sessions left this week\.$/],
    [
      "the week's sessions used",
      view({}, [{ pays: null, why: "limit_week", limit: { ...limit, left: 0 } }]),
      false,
      /^You’ve used all 4 personal training sessions Gold includes this week\. A new week starts on Mon 11 Mar\.$/,
    ],
    ["a pack", view({}, [{ pays: { membership: "10 sessions", sessionsLeft: 3 } }]), true, /^You have 10 sessions: 3 sessions left\. Each booking uses 1 session\.$/],
    [
      "a pack because the week's are used",
      view({}, [{ pays: { membership: "10 sessions", sessionsLeft: 1 }, limit: { ...limit, left: 0 } }]),
      true,
      /^You have 10 sessions: 1 session left\. Each booking uses 1 session\. Gold’s sessions for this week are used, so a booking uses your pack\.$/,
    ],
  ])("%s", (_, v, can, words) => {
    const day = v.days[0];
    if (day === undefined) throw new Error("no day");
    const pay = payText(v, day, "gym");
    expect(pay?.can).toBe(can);
    expect(pay?.text).toMatch(words);
  });

  it("a gym that sells no memberships has nothing to say, and its times can be booked", () => {
    const v = view({ trainers: [{ trainerId: T1, name: null, sessionMinutes: 45, days: [{ localDate: "2030-03-04", free: [600], opensLater: false }] }] }, [
      { pays: { membership: null, sessionsLeft: null } },
    ]);
    const day = ptDay(v, "2030-03-04", "gym", "12h");
    expect(day.pay).toBeNull();
    expect(day.can).toBe(true);
    expect(day.trainers[0]?.name).toBe("a member of staff");
    expect(day.trainers[0]?.times).toEqual([{ minute: 600, text: "10:00 AM – 10:45 AM" }]);
  });

  it("a day nothing pays for shows its times and says no fees", () => {
    const v = view({}, [{ pays: null, why: "no_membership", fees: INR }]);
    const day = ptDay(v, "2030-03-04", "gym", "12h");
    expect(day.can).toBe(false);
    expect(day.fees).toBeNull();
  });

  it("a day past the last open one says so", () => {
    expect(ptDay(view({ lastDay: "2030-03-04" }, [{}, {}]), "2030-03-05", "gym", "24h").notOpen).toBe(
      "Booking for this day isn’t open yet. You can book up to Mon 4 Mar.",
    );
  });
});

describe("the row of days and the empty week", () => {
  it("opens on the first day with a time, and today and tomorrow are named", () => {
    const v = view({ trainers: [{ trainerId: T1, name: "Sam", sessionMinutes: 60, days: [{ localDate: "2030-03-06", free: [600], opensLater: false }] }] }, [{}, {}, {}]);
    const row = ptDays(v);
    expect(row.first).toBe("2030-03-06");
    expect(row.days.map((d) => d.label)).toEqual(["Today · Mon 4 Mar", "Tomorrow · Tue 5 Mar", "Wed 6 Mar"]);
  });
  it.each([
    ["no trainers", view(), "Lotus Yoga has no trainers taking personal training sessions yet."],
    ["not open yet", view({ from: "2030-03-11", to: "2030-03-17", trainers: [{ trainerId: T1, name: "Sam", sessionMinutes: 60, days: [] }] }), "Booking for these days isn’t open yet. You can book up to Sun 10 Mar."],
  ])("%s", (_, v, words) => {
    expect(emptyText(v, "Lotus Yoga", "gym")).toBe(words);
  });
  it("later times say when they open", () => {
    expect(opensLaterText(1, false)).toBe("Times on this day aren’t open yet: each one opens 1 day before it starts.");
    expect(opensLaterText(14, true)).toBe("More times on this day open later: each one opens 14 days before it starts.");
  });
});

describe("a session's words on the gym's clock", () => {
  it.each([
    ["12h", "Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer"],
    ["24h", "Mon 4 Mar · 10:00 – 11:00 · with Sam Trainer"],
  ] as const)("%s", (clock, words) => {
    expect(sessionText(session(), clock)).toBe(words);
  });
  it("a session past midnight ends on the next day's clock", () => {
    expect(sessionSpan(23 * 60 + 30, 60, "24h")).toBe("23:30 – 00:30");
  });
});

describe("the box before a cancel: every fee in it is the one sent", () => {
  it.each([
    ["free, nothing follows", session(), "Cancel your session?", []],
    ["free, a pack", session({ packCharged: true }), "Cancel your session?", [expect.stringMatching(/until Mon 4 Mar, 8:00 AM\. Your pack gets the session back\.$/)]],
    ["free, a fee after", session({ fees: INR }), "Cancel your session?", ["Iron House lets you cancel for free until Mon 4 Mar, 8:00 AM. After that there is a one-time late cancel fee of ₹500.00."]],
    [
      "free, a limit and a fee",
      session({ fees: INR, usesLimit: true }),
      "Cancel your session?",
      [expect.stringMatching(/no longer counts as one of the sessions your membership includes\. After Mon 4 Mar, 8:00 AM there is a one-time late cancel fee of ₹500\.00\.$/)],
    ],
    ["late, a fee", session({ cancel: "late", fees: INR }), "Cancel late?", [expect.stringMatching(/a one-time late cancel fee of ₹500\.00 will be added to your bill\.$/)]],
    ["late, a pack", session({ cancel: "late", packCharged: true }), "Cancel late?", [expect.stringMatching(/the session stays used on your pack\.$/)]],
    ["late, a limit", session({ cancel: "late", usesLimit: true }), "Cancel late?", [expect.stringMatching(/it still counts as one of the sessions your membership includes\.$/)]],
    ["late, nothing costs", session({ cancel: "late" }), "Cancel late?", ["Cancelling this close to the start counts as a late cancel. There’s no fee."]],
  ])("%s", (_, s, title, more) => {
    const ask = ptCancelAsk(s, "Asia/Kolkata", "Iron House", "12h");
    expect(ask.title).toBe(title);
    expect(ask.lines[0]).toBe("Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer");
    expect(ask.lines.slice(1)).toEqual(more);
    expect(ask.yes).toBe("Cancel session");
  });
  it("never says free where nothing follows", () => {
    expect(ptCancelAsk(session(), "Asia/Kolkata", "Iron House", "12h").lines.join(" ")).not.toMatch(/free/i);
    expect(ptCancelAsk(session({ cancel: "late" }), "Asia/Kolkata", "Iron House", "12h").lines.join(" ")).not.toMatch(/for free/i);
  });
});

describe("under a coming session", () => {
  it.each([
    ["no fees", session(), []],
    ["a free cancel with fees", session({ fees: INR }), ["Free to cancel until Mon 4 Mar, 8:00 AM. After that, a one-time late cancel fee of ₹500.00.", "If you don’t come, a one-time no-show fee of ₹800.00 will be added to your bill."]],
    ["a late cancel with fees", session({ fees: INR, cancel: "late" }), ["If you cancel now, a one-time late cancel fee of ₹500.00 will be added to your bill.", "If you don’t come, a one-time no-show fee of ₹800.00 will be added to your bill."]],
    ["a no-show fee alone", session({ fees: { ...INR, lateCancelMinor: 0 } }), ["If you don’t come, a one-time no-show fee of ₹800.00 will be added to your bill."]],
    ["started", session({ fees: INR, cancel: null }), []],
  ])("%s", (_, s, lines) => {
    expect(sessionFeeLines(s, "Asia/Kolkata", "12h")).toEqual(lines);
  });
});

describe("the instant a gym's day and minute is", () => {
  it.each([
    ["India", "2030-03-04", 600, "Asia/Kolkata", "2030-03-04T04:30:00.000Z"],
    ["New York in winter", "2030-01-15", 9 * 60, "America/New_York", "2030-01-15T14:00:00.000Z"],
    ["New York in summer", "2030-07-15", 9 * 60, "America/New_York", "2030-07-15T13:00:00.000Z"],
    ["London on the day the clocks go forward, after", "2030-03-31", 10 * 60, "Europe/London", "2030-03-31T09:00:00.000Z"],
    ["London on the day the clocks go back, after", "2030-10-27", 10 * 60, "Europe/London", "2030-10-27T10:00:00.000Z"],
    ["just after midnight in Auckland", "2030-03-04", 5, "Pacific/Auckland", "2030-03-03T11:05:00.000Z"],
  ])("%s", (_, day, minute, zone, at) => {
    expect(new Date(gymInstant(day, minute, zone) ?? 0).toISOString()).toBe(at);
  });
  it("a zone this phone can't read is no instant", () => {
    expect(gymInstant("2030-03-04", 600, "Not/AZone")).toBeNull();
  });
});

describe("the box before a booking says what it uses and what a cancel and a no-show cost", () => {
  const time: BookTime = { trainerName: "Sam Trainer", localDate: "2030-03-04", dayLabel: "Today · Mon 4 Mar", minute: 600, timeText: "10:00 AM – 11:00 AM" };
  // 10:00 in India is 04:30 UTC; free cancelling ends two hours before, 02:30 UTC.
  const at = (iso: string) => Date.parse(iso);
  const pay = { text: "You have 10 sessions: 3 sessions left. Each booking uses 1 session.", can: true };
  const withFees = view({}, [{ fees: INR }]);
  it.each([
    ["no fees", view(), null, at("2030-03-01T00:00:00Z"), ["Today · Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer"]],
    [
      "a pack, days ahead",
      withFees,
      pay,
      at("2030-03-01T00:00:00Z"),
      [
        "Today · Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer",
        pay.text,
        "Free to cancel until Mon 4 Mar, 8:00 AM. After that, a one-time late cancel fee of ₹500.00.",
        "If you don’t come, a one-time no-show fee of ₹800.00 will be added to your bill.",
      ],
    ],
    [
      "minutes before free cancelling ends",
      withFees,
      null,
      at("2030-03-04T02:27:00Z"),
      [
        "Today · Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer",
        "Free cancelling ends at Mon 4 Mar, 8:00 AM. If you cancel after that, a one-time late cancel fee of ₹500.00 will be added to your bill.",
        "If you don’t come, a one-time no-show fee of ₹800.00 will be added to your bill.",
      ],
    ],
    [
      "inside the free-cancel time",
      withFees,
      null,
      at("2030-03-04T03:00:00Z"),
      [
        "Today · Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer",
        "This session starts soon, so it can’t be cancelled for free. If you book and then cancel, a one-time late cancel fee of ₹500.00 will be added to your bill.",
        "If you don’t come, a one-time no-show fee of ₹800.00 will be added to your bill.",
      ],
    ],
  ])("%s", (_, v, p, now, lines) => {
    const ask = ptBookAsk(v, time, p, "12h", now);
    expect(ask.title).toBe("Book this session?");
    expect(ask.lines).toEqual(lines);
    expect([ask.yes, ask.no]).toEqual(["Book session", "Not now"]);
  });
});

describe("after an answer", () => {
  it.each([
    ["cancelled", session({ status: "cancelled", cancel: null }), "Cancelled", "Cancelled."],
    ["late, a fee", session({ status: "late_cancelled", cancel: null, fee: { kind: "late_cancel", amountMinor: 50_000, state: "owed", currency: "INR" } }), "Cancelled late", "Cancelled late. A one-time late cancel fee of ₹500.00 was added to your bill."],
    ["late, a pack", session({ status: "late_cancelled", cancel: null, packCharged: true }), "Cancelled late · the session stays used on your pack", "Cancelled late. The session stays used on your pack."],
    ["late, a limit", session({ status: "late_cancelled", cancel: null, usesLimit: true }), "Cancelled late · it still counts as one of your sessions", "Cancelled late. It still counts as one of the sessions your membership includes."],
    ["late, nothing", session({ status: "late_cancelled", cancel: null }), "Cancelled late", "Cancelled late."],
  ])("%s", (_, s, history, cancelled) => {
    expect(historyText(s)).toBe(history);
    expect(ptCancelledText(s)).toBe(cancelled);
  });
  it.each([
    ["came", session({ status: "attended", cancel: null }), "You came"],
    ["missed", session({ status: "no_show", cancel: null }), "You missed this session"],
    ["missed, a pack", session({ status: "no_show", cancel: null, packCharged: true }), "You missed this session · it stays used on your pack"],
    ["missed, a limit", session({ status: "no_show", cancel: null, usesLimit: true }), "You missed this session · it still counts as one of your sessions"],
  ])("%s", (_, s, words) => {
    expect(historyText(s)).toBe(words);
  });
  it.each([
    ["owed", "One-time late cancel fee ₹500.00 · Payment due"],
    ["paid", "One-time late cancel fee ₹500.00 · Paid"],
    ["waived", "One-time late cancel fee ₹500.00 · Waived"],
  ] as const)("a fee %s", (state, words) => {
    expect(ptFeeText(session({ fee: { kind: "late_cancel", amountMinor: 50_000, state, currency: "INR" } }))).toBe(words);
  });
  it("a no-show fee and none", () => {
    expect(ptFeeText(session({ fee: { kind: "no_show", amountMinor: 80_000, state: "owed", currency: "INR" } }))).toBe("One-time no-show fee ₹800.00 · Payment due");
    expect(ptFeeText(session())).toBeNull();
  });
  it("a booking answered as cancelled since is never said as booked", () => {
    expect(bookedText(session(), "12h")).toEqual({ text: "Booked: Mon 4 Mar · 10:00 AM – 11:00 AM · with Sam Trainer.", bad: false });
    expect(bookedText(session({ status: "cancelled" }), "12h")).toEqual({ text: "That session was cancelled since. It is not booked.", bad: true });
  });
});

describe("a late cancel the server asks for again", () => {
  it("takes the server's fee and pack", () => {
    const now = askedLate(session({ fees: INR }), { error: "late_cancel", feeMinor: 70_000, currency: "INR", packCharged: true });
    expect(now.cancel).toBe("late");
    expect(now.packCharged).toBe(true);
    expect(now.fees).toEqual({ lateCancelMinor: 70_000, noShowMinor: 80_000, currency: "INR" });
  });
  it.each([
    ["no fee", { feeMinor: 0, currency: "INR" }],
    ["a fee that is not a whole number", { feeMinor: 12.5, currency: "INR" }],
    ["no currency", { feeMinor: 70_000 }],
    ["no body", null],
  ])("%s is no fee", (_, body) => {
    expect(askedLate(session({ fees: INR }), body).fees).toBeNull();
  });
});

describe("the page's other lines", () => {
  it("whose clock", () => {
    const now = new Date("2030-03-04T04:30:00Z");
    expect(ptZoneNote("Asia/Kolkata", "Iron House", "Asia/Kolkata", now)).toBeNull();
    expect(ptZoneNote("America/New_York", "Iron House", "Asia/Kolkata", now)).toBe("Times are Iron House time (America/New York), not this phone’s.");
  });
  it("can't be read", () => {
    expect(couldNotRead(404, "Iron House")).toBe("Iron House’s personal training isn’t available right now.");
    expect(couldNotRead(null, "Iron House")).toBe("Couldn’t load personal training.");
  });
});
