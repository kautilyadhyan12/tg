// Personal training (spec Part 3 §13.5; ROADMAP 17e-i).
//
// The worst thing this job could do to a real person: book two people with one trainer at
// the same time, or take a session off somebody's pack for a booking that never happened.
// The first block is that, on the rule alone; both are raced on the real database in
// `apps/api/test/pt.routes.test.ts`.
//
// The tables' expected answers are written out case by case, not read back from the rule.
import { describe, expect, it } from "vitest";
import {
  addPtTimeOffRequestSchema,
  bookPtRequestSchema,
  decidePtBook,
  decidePtCancel,
  giveHeldMembership,
  isoWeekday,
  pickPtCover,
  ptBusy,
  ptFreeTimes,
  ptHoursProblem,
  ptOfferedTimes,
  ptTime,
  ptTimeOffOnDay,
  ptTimeOffProblem,
  ptTimeOffRefusal,
  savePtTrainerRequestSchema,
  saveGymMembershipTypeRequestSchema,
  type HeldMembership,
  type HeldMembershipTerms,
  type PtBookInput,
  type PtCover,
  type PtHeld,
  type PtHoursRange,
} from "../src/index.js";

const MIN = 60_000;
const DAY = "2026-10-20"; // a Tuesday

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, true, startsOn);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}
const held = (id: string, membership: HeldMembership, includesPt: boolean): PtHeld => ({ id, membership, includesPt });
const cover = (list: PtHeld[], gymHasTypes = true): PtCover => pickPtCover({ gymHasTypes, day: DAY, held: list });

const covered: PtCover = { ok: true, membershipId: "m", chargePack: true };
const fine: PtBookInput = { offers: true, offered: true, started: false, tooFar: false, trainerBusy: false, trainerInClass: false, trainerOff: false, personBusy: false, cover: covered };

describe("the worst thing: two people with one trainer at one time, or a pack charged for nothing", () => {
  it("a time the trainer already has a session in is refused, whoever asks and whatever they hold", () => {
    expect(decidePtBook({ ...fine, trainerBusy: true })).toEqual({ kind: "refuse", reason: "time_taken" });
    expect(decidePtBook({ ...fine, trainerBusy: true, cover: { ok: true, membershipId: null, chargePack: false } })).toEqual({
      kind: "refuse",
      reason: "time_taken",
    });
  });

  it("a time the trainer coaches a class in is refused the same way, and says it is a class", () => {
    expect(decidePtBook({ ...fine, trainerInClass: true })).toEqual({ kind: "refuse", reason: "trainer_in_class" });
    expect(decidePtBook({ ...fine, trainerInClass: true, cover: { ok: true, membershipId: null, chargePack: false } }).kind).toBe("refuse");
    // A class is one more thing that takes the trainer's time: a 45-minute class from 10:15
    // leaves 09:00 and 11:00 free, and takes 10:00.
    const at = (minute: number) => ({ startMinute: minute, startsAtMs: minute * MIN });
    const coaching = [{ fromMs: 615 * MIN, toMs: 660 * MIN }];
    expect(ptFreeTimes([at(540), at(600), at(660), at(720)], { minutes: 60, taken: coaching, nowMs: 0 }).map((t) => t.startMinute)).toEqual([540, 660, 720]);
  });

  it("a session that only touches another's end, or its start, is not the same time", () => {
    const taken = [{ fromMs: 60 * MIN, toMs: 120 * MIN }];
    expect(ptBusy(0, 60, taken)).toBe(false);
    expect(ptBusy(120 * MIN, 60, taken)).toBe(false);
    // One minute in from either side, a longer one around it, a shorter one inside it.
    expect(ptBusy(1 * MIN, 60, taken)).toBe(true);
    expect(ptBusy(119 * MIN, 60, taken)).toBe(true);
    expect(ptBusy(30 * MIN, 120, taken)).toBe(true);
    expect(ptBusy(75 * MIN, 30, taken)).toBe(true);
  });

  it("a refusal never charges: only a booking names a pack", () => {
    const refusals: Partial<PtBookInput>[] = [
      { offers: false },
      { offered: false },
      { started: true },
      { tooFar: true },
      { trainerBusy: true },
      { trainerInClass: true },
      { personBusy: true },
      { cover: { ok: false, reason: "pack_used" } },
    ];
    for (const over of refusals) expect(decidePtBook({ ...fine, ...over }).kind).toBe("refuse");
    expect(decidePtBook(fine)).toEqual({ kind: "book", membershipId: "m", chargePack: true });
  });

  it("a cancel gives a pack's session back once, and a cancel sent again changes nothing", () => {
    const booked = { status: "booked" as const, started: false, freeCancel: true, packCharged: true, lateOk: false, giveBack: false };
    expect(decidePtCancel(booked)).toEqual({ kind: "cancel", status: "cancelled", refundPack: true });
    expect(decidePtCancel({ ...booked, status: "cancelled" })).toEqual({ kind: "already" });
    // The late cancel sent again is the same answer; nothing changes.
    expect(decidePtCancel({ ...booked, status: "late_cancelled", freeCancel: false, lateOk: true })).toEqual({ kind: "already" });
  });

  it("a session already cancelled late is never answered as given back: a give-back, or a plain cancel, is told it stays used", () => {
    const late = { status: "late_cancelled" as const, started: false, freeCancel: false, packCharged: true, lateOk: true, giveBack: false };
    expect(decidePtCancel({ ...late, giveBack: true })).toEqual({ kind: "refuse", reason: "kept_used" });
    // A page still showing it as free to cancel.
    expect(decidePtCancel({ ...late, lateOk: false })).toEqual({ kind: "refuse", reason: "kept_used" });
    expect(decidePtCancel({ ...late, lateOk: false, freeCancel: true })).toEqual({ kind: "refuse", reason: "kept_used" });
    // Whatever the clock says by then.
    expect(decidePtCancel({ ...late, giveBack: true, started: true })).toEqual({ kind: "refuse", reason: "kept_used" });
    // A session cancelled with nothing kept: a give-back or a plain cancel again changes
    // nothing, and the late cancel is told nothing was kept.
    expect(decidePtCancel({ ...late, status: "cancelled", packCharged: false, giveBack: true })).toEqual({ kind: "already" });
    expect(decidePtCancel({ ...late, status: "cancelled", packCharged: false, lateOk: false })).toEqual({ kind: "already" });
    expect(decidePtCancel({ ...late, status: "cancelled", packCharged: false })).toEqual({ kind: "refuse", reason: "not_kept" });
    expect(decidePtCancel({ ...late, status: "cancelled", packCharged: false, started: true })).toEqual({ kind: "refuse", reason: "not_kept" });
  });
});

describe("decidePtBook: the first thing wrong is the one said", () => {
  const cases: [string, Partial<PtBookInput>, string][] = [
    ["the trainer takes no sessions", { offers: false, offered: false, started: true, trainerBusy: true }, "trainer_not_offering"],
    ["not one of their times", { offered: false, started: true, tooFar: true }, "not_a_time"],
    ["a time that has passed", { started: true, trainerBusy: true }, "time_passed"],
    ["more than eight weeks ahead", { tooFar: true, trainerBusy: true }, "too_far"],
    ["the trainer is busy", { trainerBusy: true, trainerInClass: true, personBusy: true }, "time_taken"],
    ["the trainer is coaching a class", { trainerInClass: true, personBusy: true }, "trainer_in_class"],
    ["the person is busy", { personBusy: true, cover: { ok: false, reason: "not_covered" } }, "person_busy"],
    ["no membership in use", { cover: { ok: false, reason: "no_membership" } }, "no_membership"],
    ["a membership without personal training", { cover: { ok: false, reason: "not_covered" } }, "not_covered"],
    ["a pack with nothing left", { cover: { ok: false, reason: "pack_used" } }, "pack_used"],
  ];
  it.each(cases)("%s", (_name, over, reason) => {
    expect(decidePtBook({ ...fine, ...over })).toEqual({ kind: "refuse", reason });
  });

  it("a gym with no membership types books anybody on its list, and charges nothing", () => {
    expect(decidePtBook({ ...fine, cover: cover([], false) })).toEqual({ kind: "book", membershipId: null, chargePack: false });
  });
});

describe("pickPtCover: what pays for a session", () => {
  const gold = given(monthly, "2026-10-01");
  const pack = (left: number, startsOn = "2026-10-01"): HeldMembership => ({ ...given(tenPack, startsOn), classesLeft: left });

  it("nothing held", () => {
    expect(cover([])).toEqual({ ok: false, reason: "no_membership" });
  });
  it("a membership that includes every class does not include personal training", () => {
    expect(cover([held("a", gold, false)])).toEqual({ ok: false, reason: "not_covered" });
  });
  it("a monthly membership that includes it pays, and nothing is charged", () => {
    expect(cover([held("a", gold, true)])).toEqual({ ok: true, membershipId: "a", chargePack: false });
  });
  it("a pack that includes it is charged a session", () => {
    expect(cover([held("p", pack(3), true)])).toEqual({ ok: true, membershipId: "p", chargePack: true });
  });
  it("a membership that includes it goes before a pack, so the pack is kept", () => {
    expect(cover([held("p", pack(3), true), held("a", gold, true)])).toEqual({ ok: true, membershipId: "a", chargePack: false });
  });
  it("of two packs, the one that ends sooner is used", () => {
    expect(cover([held("later", pack(5, "2026-10-10"), true), held("sooner", pack(5, "2026-09-01"), true)])).toEqual({
      ok: true,
      membershipId: "sooner",
      chargePack: true,
    });
  });
  it("a pack for classes only is never charged for personal training", () => {
    expect(cover([held("classes", pack(9), false)])).toEqual({ ok: false, reason: "not_covered" });
    expect(cover([held("classes", pack(9), false), held("pt", pack(1), true)])).toEqual({ ok: true, membershipId: "pt", chargePack: true });
  });
  it("a pack with no session left says so, alone or beside a membership without it", () => {
    expect(cover([held("p", pack(0), true)])).toEqual({ ok: false, reason: "pack_used" });
    expect(cover([held("p", pack(0), true), held("a", gold, false)])).toEqual({ ok: false, reason: "pack_used" });
  });
  it("a frozen or cancelled membership, one that starts later, and a pack past its days pay for nothing", () => {
    expect(cover([held("f", { ...gold, status: "frozen", frozenOn: "2026-10-05" }, true)])).toEqual({ ok: false, reason: "no_membership" });
    expect(cover([held("c", { ...gold, status: "cancelled", cancelledOn: "2026-10-10" }, true)])).toEqual({ ok: false, reason: "no_membership" });
    expect(cover([held("l", given(monthly, "2026-10-21"), true)])).toEqual({ ok: false, reason: "no_membership" });
    expect(cover([held("old", pack(4, "2026-07-01"), true)])).toEqual({ ok: false, reason: "no_membership" });
  });
  it("a membership counts on the session's own day, not today's", () => {
    // Starts on the session's day itself.
    expect(cover([held("a", given(monthly, DAY), true)])).toEqual({ ok: true, membershipId: "a", chargePack: false });
  });
});

describe("decidePtCancel", () => {
  const base = { status: "booked" as const, started: false, freeCancel: false, packCharged: true, lateOk: false, giveBack: false };
  it("inside the free time: free, whatever else is sent", () => {
    expect(decidePtCancel({ ...base, freeCancel: true, lateOk: true })).toEqual({ kind: "cancel", status: "cancelled", refundPack: true });
    expect(decidePtCancel({ ...base, freeCancel: true, packCharged: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: false });
  });
  it("past it: asks first", () => {
    expect(decidePtCancel(base)).toEqual({ kind: "refuse", reason: "late_cancel" });
    // `giveBack` alone is not a yes.
    expect(decidePtCancel({ ...base, giveBack: true })).toEqual({ kind: "refuse", reason: "late_cancel" });
  });
  it("past it, a late cancel keeps the session used", () => {
    expect(decidePtCancel({ ...base, lateOk: true })).toEqual({ kind: "cancel", status: "late_cancelled", refundPack: false });
  });
  it("past it, a session the gym called off gives it back", () => {
    expect(decidePtCancel({ ...base, lateOk: true, giveBack: true })).toEqual({ kind: "cancel", status: "cancelled", refundPack: true });
    expect(decidePtCancel({ ...base, lateOk: true, giveBack: true, packCharged: false })).toEqual({ kind: "cancel", status: "cancelled", refundPack: false });
  });
  it("one that has started, or was come to or missed, cannot be cancelled", () => {
    expect(decidePtCancel({ ...base, started: true, lateOk: true, giveBack: true })).toEqual({ kind: "refuse", reason: "started" });
    expect(decidePtCancel({ ...base, status: "attended", freeCancel: true })).toEqual({ kind: "refuse", reason: "started" });
    expect(decidePtCancel({ ...base, status: "no_show", freeCancel: true })).toEqual({ kind: "refuse", reason: "started" });
  });
});

describe("ptTime", () => {
  const start = 10 * 60 * MIN;
  it.each([
    ["two hours and a minute before", start - 121 * MIN, { started: false, freeCancel: true }],
    ["exactly two hours before", start - 120 * MIN, { started: false, freeCancel: true }],
    ["a minute inside", start - 119 * MIN, { started: false, freeCancel: false }],
    ["at the start", start, { started: true, freeCancel: false }],
    ["after it", start + MIN, { started: true, freeCancel: false }],
  ])("%s", (_name, now, expected) => {
    expect(ptTime(now, start, 120)).toEqual(expected);
  });
  it("a gym with no free-cancel time cancels free up to the start", () => {
    expect(ptTime(start - 1, start, 0)).toEqual({ started: false, freeCancel: true });
  });
});

describe("a trainer's hours and the times they make", () => {
  const range = (weekday: number, fromMinute: number, toMinute: number): PtHoursRange => ({ weekday, fromMinute, toMinute });

  it("ISO weekdays: Monday 1 to Sunday 7", () => {
    expect(["2026-10-19", "2026-10-20", "2026-10-24", "2026-10-25", "2024-02-29"].map(isoWeekday)).toEqual([1, 2, 6, 7, 4]);
  });

  it("each range is cut into sessions from its start, and a short last piece is left out", () => {
    // Tuesday 16:00 to 20:00 and 09:00 to 10:30; Wednesday has none.
    const hours = [range(2, 960, 1200), range(2, 540, 630)];
    expect(ptOfferedTimes(hours, 60, [DAY, "2026-10-21"])).toEqual([
      { localDate: DAY, startMinute: 540 },
      { localDate: DAY, startMinute: 960 },
      { localDate: DAY, startMinute: 1020 },
      { localDate: DAY, startMinute: 1080 },
      { localDate: DAY, startMinute: 1140 },
    ]);
    expect(ptOfferedTimes(hours, 45, [DAY]).map((t) => t.startMinute)).toEqual([540, 585, 960, 1005, 1050, 1095, 1140]);
    expect(ptOfferedTimes(hours, 90, [DAY]).map((t) => t.startMinute)).toEqual([540, 960, 1050]);
    // Hours shorter than one session offer nothing.
    expect(ptOfferedTimes([range(2, 600, 640)], 45, [DAY])).toEqual([]);
    // Up to midnight.
    expect(ptOfferedTimes([range(2, 1380, 1440)], 30, [DAY]).map((t) => t.startMinute)).toEqual([1380, 1410]);
  });

  it("free times leave out what has started and what runs into a booked session", () => {
    const at = (minute: number) => ({ startMinute: minute, startsAtMs: minute * MIN });
    const offered = [at(960), at(1020), at(1080), at(1140)];
    // 17:00 to 18:00 is booked; it is 16:00 exactly, so the 16:00 time has started.
    const free = ptFreeTimes(offered, { minutes: 60, taken: [{ fromMs: 1020 * MIN, toMs: 1080 * MIN }], nowMs: 960 * MIN });
    expect(free.map((t) => t.startMinute)).toEqual([1080, 1140]);
    // A 90-minute session booked from 16:30 under an older setting blocks 16:00 and 17:00.
    expect(ptFreeTimes(offered, { minutes: 60, taken: [{ fromMs: 990 * MIN, toMs: 1080 * MIN }], nowMs: 0 }).map((t) => t.startMinute)).toEqual([1080, 1140]);
  });

  it.each([
    ["nothing", [], null],
    ["three ranges that touch", [range(1, 360, 540), range(1, 540, 720), range(1, 720, 900)], null],
    ["the same hours on two weekdays", [range(1, 600, 660), range(2, 600, 660)], null],
    ["an end before its start", [range(1, 600, 540)], "range"],
    ["an empty range", [range(1, 600, 600)], "range"],
    ["four on one day", [range(3, 0, 60), range(3, 120, 180), range(3, 240, 300), range(3, 360, 420)], "too_many"],
    ["two that overlap", [range(4, 600, 720), range(4, 660, 780)], "overlap"],
    ["one inside another", [range(4, 600, 900), range(4, 660, 720)], "overlap"],
  ])("hours: %s", (_name, hours, problem) => {
    expect(ptHoursProblem(hours)).toBe(problem);
    expect(savePtTrainerRequestSchema.safeParse({ offers: true, sessionMinutes: 60, hours }).success).toBe(problem === null);
  });

  it("the save takes any length on a five-minute mark from 10 minutes to 4 hours, and refuses a minute off the marks and a weekday that is not one", () => {
    const save = (over: object) => savePtTrainerRequestSchema.safeParse({ offers: true, sessionMinutes: 60, hours: [range(1, 600, 660)], ...over }).success;
    expect(save({})).toBe(true);
    for (const minutes of [10, 20, 50, 75, 240]) expect(save({ sessionMinutes: minutes })).toBe(true);
    for (const minutes of [5, 52, 245, 60.5, 0, -30]) expect(save({ sessionMinutes: minutes })).toBe(false);
    expect(save({ hours: [range(1, 601, 660)] })).toBe(false);
    expect(save({ hours: [range(0, 600, 660)] })).toBe(false);
    expect(save({ hours: [range(8, 600, 660)] })).toBe(false);
    expect(save({ hours: [range(1, 600, 1445)] })).toBe(false);
    expect(save({ extra: 1 })).toBe(false);
  });

  it("a booking names a day and a time on the five-minute marks", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const ok = { requestKey: id, trainerId: id, entryId: id, localDate: DAY, startMinute: 960, minutes: 60 };
    expect(bookPtRequestSchema.safeParse(ok).success).toBe(true);
    expect(bookPtRequestSchema.safeParse({ ...ok, startMinute: 961 }).success).toBe(false);
    expect(bookPtRequestSchema.safeParse({ ...ok, startMinute: 1440 }).success).toBe(false);
    expect(bookPtRequestSchema.safeParse({ ...ok, localDate: "20 Oct" }).success).toBe(false);
    // The length the screen showed travels with it.
    expect(bookPtRequestSchema.safeParse({ ...ok, minutes: undefined }).success).toBe(false);
    expect(bookPtRequestSchema.safeParse({ ...ok, minutes: 52 }).success).toBe(false);
  });
});

describe("a membership type that includes personal training", () => {
  const type = {
    name: "PT 10",
    description: null,
    kind: "pack",
    priceMinor: 30000,
    termCount: null,
    termUnit: null,
    packClasses: 10,
    packDays: 90,
    access: "all_classes",
    bookingsLimit: null,
    bookingsPeriod: null,
    classTypeIds: null,
  };
  it("the tick is off unless sent", () => {
    const parsed = saveGymMembershipTypeRequestSchema.parse(type);
    expect(parsed.includesPt).toBe(false);
  });
  it("no class at all is allowed only with the tick: a pack for personal training alone", () => {
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, classTypeIds: [], includesPt: true }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, classTypeIds: [], includesPt: false }).success).toBe(false);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, classTypeIds: [] }).success).toBe(false);
  });
});

// 17e-iii-b. The worst thing: somebody booked with a trainer for a time the trainer is away.
describe("a trainer's time off", () => {
  it("a time the trainer has off is refused, whoever asks and whatever they hold, and says so", () => {
    expect(decidePtBook({ ...fine, trainerOff: true })).toEqual({ kind: "refuse", reason: "trainer_off" });
    expect(decidePtBook({ ...fine, trainerOff: true, cover: { ok: true, membershipId: null, chargePack: false } })).toEqual({
      kind: "refuse",
      reason: "trainer_off",
    });
    expect(decidePtBook(fine).kind).toBe("book");
  });

  it("free times leave out what runs into time off, to the minute", () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 20, h, m);
    const offered = [9, 10, 11, 12].map((h) => ({ startsAtMs: at(h) }));
    // Off 10:30 to 12:00: the 10:00 and 11:00 sessions run into it; 09:00 ends as it starts and 12:00 starts as it ends.
    const free = ptFreeTimes(offered, { minutes: 60, taken: [{ fromMs: at(10, 30), toMs: at(12) }], nowMs: at(0) });
    expect(free.map((t) => t.startsAtMs)).toEqual([at(9), at(12)]);
  });

  const days = (fromDate: string, toDate: string) => ({ fromDate, toDate, fromMinute: null, toMinute: null });
  const hours = (day: string, fromMinute: number | null, toMinute: number | null) => ({ fromDate: day, toDate: day, fromMinute, toMinute });

  it.each([
    ["one whole day", days("2026-10-20", "2026-10-20"), null],
    ["a week", days("2026-10-20", "2026-10-26"), null],
    ["a morning", hours("2026-10-20", 540, 720), null],
    ["up to midnight", hours("2026-10-20", 1320, 1440), null],
    ["a year, the longest", days("2026-10-20", "2027-10-20"), null],
    ["a day more than the longest", days("2026-10-20", "2027-10-21"), "too_long"],
    ["ends before it starts", days("2026-10-20", "2026-10-19"), "order"],
    ["hours that end as they start", hours("2026-10-20", 540, 540), "range"],
    ["hours backwards", hours("2026-10-20", 720, 540), "range"],
    ["a start with no end", hours("2026-10-20", 540, null), "half"],
    ["an end with no start", hours("2026-10-20", null, 720), "half"],
    ["hours across two days", { fromDate: "2026-10-20", toDate: "2026-10-21", fromMinute: 540, toMinute: 720 }, "one_day"],
    ["the 30th of February", days("2027-02-30", "2027-03-02"), "not_a_day"],
    ["a thirteenth month", days("2026-10-20", "2026-13-01"), "not_a_day"],
  ] as const)("as written: %s", (_name, off, problem) => {
    expect(ptTimeOffProblem(off)).toBe(problem);
    expect(addPtTimeOffRequestSchema.safeParse({ requestKey: "00000000-0000-4000-8000-000000000081", ...off }).success).toBe(problem === null);
  });

  it("the request takes five-minute marks only, and a mark that is one", () => {
    const base = { requestKey: "00000000-0000-4000-8000-000000000081", ...hours("2026-10-20", 540, 720) };
    expect(addPtTimeOffRequestSchema.safeParse({ ...base, fromMinute: 541 }).success).toBe(false);
    expect(addPtTimeOffRequestSchema.safeParse({ ...base, toMinute: 1445 }).success).toBe(false);
    expect(addPtTimeOffRequestSchema.safeParse({ ...base, confirm: "yes" }).success).toBe(false);
    expect(addPtTimeOffRequestSchema.safeParse({ ...base, confirm: "a".repeat(64) }).success).toBe(true);
    expect(addPtTimeOffRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it.each([
    ["one that is not over", { over: false, today: "2026-10-07", fromDate: "2026-10-07", coming: 0 }, null],
    ["one already over", { over: true, today: "2026-10-07", fromDate: "2026-10-06", coming: 0 }, "time_off_ended"],
    ["one that started yesterday and is not over", { over: false, today: "2026-10-07", fromDate: "2026-10-06", coming: 0 }, null],
    ["one starting a year ahead to the day", { over: false, today: "2026-10-07", fromDate: "2027-10-08", coming: 0 }, null],
    ["one starting a day past that", { over: false, today: "2026-10-07", fromDate: "2027-10-09", coming: 0 }, "time_off_too_far"],
    ["the fiftieth", { over: false, today: "2026-10-07", fromDate: "2026-10-08", coming: 49 }, null],
    ["the fifty-first", { over: false, today: "2026-10-07", fromDate: "2026-10-08", coming: 50 }, "time_off_too_many"],
  ] as const)("now: %s", (_name, input, refusal) => {
    expect(ptTimeOffRefusal(input)).toBe(refusal);
  });

  it("what it takes of a day: nothing outside it, all of a whole day, the hours of a part day", () => {
    const week = days("2026-10-20", "2026-10-26");
    expect(ptTimeOffOnDay(week, "2026-10-19")).toBeNull();
    expect(ptTimeOffOnDay(week, "2026-10-20")).toEqual({ fromMinute: null, toMinute: null });
    expect(ptTimeOffOnDay(week, "2026-10-26")).toEqual({ fromMinute: null, toMinute: null });
    expect(ptTimeOffOnDay(week, "2026-10-27")).toBeNull();
    expect(ptTimeOffOnDay(hours("2026-10-20", 540, 720), "2026-10-20")).toEqual({ fromMinute: 540, toMinute: 720 });
    expect(ptTimeOffOnDay(hours("2026-10-20", 540, 720), "2026-10-21")).toBeNull();
  });
});
