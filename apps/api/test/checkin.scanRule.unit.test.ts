// The scan rule's table (spec Part 3 §12.4): each way in × who the read named × the pass
// fresh · old · used · garbled × first · same period · next period · outside hours.
// Who a read names at a gym (member · former · removed · never · another gym's) is decided
// against the database and swept in `checkin.routes.test.ts`; here it arrives as one of
// the three things the rule can be told.
import { describe, expect, it } from "vitest";
import { decideScan, type ScanDecision, type ScanPeriod, type ScanPerson, type ScanRead, type VisitToday } from "../src/modules/orgs/checkin/scanRule.js";

const at = (hhmm: string): Date => new Date(`2026-10-02T${hhmm}:00.000Z`);

const MORNING: ScanPeriod = { hoursStatus: "in_session", opensMinute: 360, closesMinute: 600 };
const EVENING: ScanPeriod = { hoursStatus: "in_session", opensMinute: 1020, closesMinute: 1260 };
const OUTSIDE: ScanPeriod = { hoursStatus: "outside_hours", opensMinute: null, closesMinute: null };

/** The four moments of a person's day, each with what the rule must say for a member. */
const MOMENTS: { name: string; period: ScanPeriod; visits: VisitToday[]; member: ScanDecision }[] = [
  { name: "first scan of the day", period: MORNING, visits: [], member: { result: "checked_in", slotKey: "360-600" } },
  {
    name: "again in the same period",
    period: MORNING,
    visits: [{ slotKey: "360-600", markedAt: at("06:02") }],
    member: { result: "already", slotKey: "360-600", firstAt: at("06:02") },
  },
  {
    name: "the next period that day",
    period: EVENING,
    visits: [{ slotKey: "360-600", markedAt: at("06:02") }],
    member: { result: "checked_in", slotKey: "1020-1260" },
  },
  {
    name: "outside the gym's hours",
    period: OUTSIDE,
    visits: [{ slotKey: "360-600", markedAt: at("06:02") }],
    member: { result: "checked_in", slotKey: "outside_hours" },
  },
];

const READS: { name: string; read: ScanRead; names: boolean }[] = [
  { name: "a fresh pass", read: { kind: "pass", pass: "fresh" }, names: true },
  { name: "an old pass", read: { kind: "pass", pass: "old" }, names: false },
  { name: "a used pass", read: { kind: "pass", pass: "used" }, names: false },
  { name: "a garbled pass", read: { kind: "pass", pass: "garbled" }, names: false },
  { name: "a key tag", read: { kind: "key_tag" }, names: true },
  { name: "staff's pick", read: { kind: "staff" }, names: true },
];

const PEOPLE: { name: string; person: ScanPerson }[] = [
  { name: "one of the gym's people", person: { kind: "member" } },
  { name: "nobody the gym has", person: { kind: "not_a_member" } },
  { name: "a number two records share", person: { kind: "ambiguous" } },
];

describe("the scan rule, every class", () => {
  const rows: [string, ScanRead, ScanPerson | null, ScanPeriod, VisitToday[], ScanDecision][] = [];
  for (const read of READS) {
    for (const who of PEOPLE) {
      for (const moment of MOMENTS) {
        const expected: ScanDecision = !read.names
          ? { result: "fresh_pass_needed" }
          : who.person.kind === "not_a_member"
            ? { result: "not_a_member" }
            : who.person.kind === "ambiguous"
              ? { result: "see_staff" }
              : moment.member;
        // A pass that is not fresh names nobody: the service never looks a person up.
        const person = read.names ? who.person : null;
        rows.push([`${read.name} · ${who.name} · ${moment.name}`, read.read, person, moment.period, moment.visits, expected]);
      }
    }
  }

  it("has a row for every class (6 reads × 3 people × 4 moments)", () => {
    expect(rows.length).toBe(72);
  });

  it.each(rows)("%s", (_name, read, person, period, visitsToday, expected) => {
    expect(decideScan({ read, person, period, visitsToday })).toEqual(expected);
  });
});

describe("the scan rule, the hour and the period", () => {
  const member: ScanPerson = { kind: "member" };
  const keyTag: ScanRead = { kind: "key_tag" };

  it.each([
    ["outside_hours", OUTSIDE],
    ["closed_day", { hoursStatus: "closed_day", opensMinute: null, closesMinute: null } satisfies ScanPeriod],
    ["hours_unset", { hoursStatus: "hours_unset", opensMinute: null, closesMinute: null } satisfies ScanPeriod],
    ["open_24h", { hoursStatus: "open_24h", opensMinute: null, closesMinute: null } satisfies ScanPeriod],
  ])("never refuses for the hour: %s checks in", (slotKey, period) => {
    expect(decideScan({ read: keyTag, person: member, period, visitsToday: [] })).toEqual({ result: "checked_in", slotKey });
  });

  it("a second scan outside hours the same day is the same visit", () => {
    const visitsToday = [{ slotKey: "outside_hours", markedAt: at("23:10") }];
    expect(decideScan({ read: keyTag, person: member, period: OUTSIDE, visitsToday })).toEqual({
      result: "already",
      slotKey: "outside_hours",
      firstAt: at("23:10"),
    });
  });

  it("'already' names the FIRST visit of the period when there are two", () => {
    const visitsToday = [
      { slotKey: "360-600", markedAt: at("07:15") },
      { slotKey: "360-600", markedAt: at("06:02") },
      { slotKey: "1020-1260", markedAt: at("05:00") },
    ];
    expect(decideScan({ read: keyTag, person: member, period: MORNING, visitsToday })).toEqual({
      result: "already",
      slotKey: "360-600",
      firstAt: at("06:02"),
    });
  });

  it("a fresh pass that named nobody is not a member", () => {
    expect(decideScan({ read: { kind: "pass", pass: "fresh" }, person: null, period: MORNING, visitsToday: [] })).toEqual({
      result: "not_a_member",
    });
  });
});
