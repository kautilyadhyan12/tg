// THE TIME SLOT RULE, every combination (CLAUDE.md §4: a rule that picks ships
// with a table test). Pure — no database. The wiring is proved through the
// routes in `classes.slots.routes.test.ts`.
//
// Each row fixes the facts that decide it and SWEEPS the rest over both values,
// so a row also proves the facts it leaves out do not matter. The first test
// checks the rows cover every combination exactly once.
import { describe, expect, it } from "vitest";
import {
  fromVerdict,
  slotChangeKind,
  peakRunning,
  slotDateFate,
  withinSlotLimits,
  type SlotChange,
  type SlotDateFacts,
  type SlotDateFate,
} from "../src/modules/orgs/classes/slotRule.js";

type Flag = "beforeFrom" | "started" | "changedAlone" | "opened";
const FLAGS: Flag[] = ["beforeFrom", "started", "changedAlone", "opened"];
const CHANGES: SlotChange[] = ["fields", "move"];
const STATUSES: SlotDateFacts["status"][] = ["scheduled", "cancelled"];

interface Row {
  change: SlotChange;
  /** Absent: swept over both. */
  status?: SlotDateFacts["status"];
  fixed: Partial<Record<Flag, boolean>>;
  fate: SlotDateFate;
}

// Written by hand, in words a gym would use.
const ROWS: Row[] = [
  // THE WORST THING: a class before the date, or one that has started, is never
  // touched by either kind of change, whatever else is true of it.
  ...CHANGES.map((change): Row => ({ change, fixed: { beforeFrom: true }, fate: "keep" })),
  ...CHANGES.map((change): Row => ({
    change,
    fixed: { beforeFrom: false, started: true },
    fate: "keep",
  })),

  // A new length, size or coach, from the date on.
  // A class changed on its own keeps its own values…
  {
    change: "fields",
    fixed: { beforeFrom: false, started: false, changedAlone: true, opened: false },
    fate: "keep",
  },
  // …unless it is the one the change was made from on the Calendar.
  {
    change: "fields",
    fixed: { beforeFrom: false, started: false, changedAlone: true, opened: true },
    fate: "restamp",
  },
  // Every other class takes them, a cancelled one included (it stays cancelled).
  {
    change: "fields",
    fixed: { beforeFrom: false, started: false, changedAlone: false },
    fate: "restamp",
  },

  // A new day or time: the time slot is replaced from the date.
  // The opened class is the gym's own pick, so it is never asked about.
  { change: "move", fixed: { beforeFrom: false, started: false, opened: true }, fate: "replace" },
  // An ordinary running class is replaced without asking.
  {
    change: "move",
    status: "scheduled",
    fixed: { beforeFrom: false, started: false, opened: false, changedAlone: false },
    fate: "replace",
  },
  // One the gym cancelled or changed on its own is replaced, and asked about.
  {
    change: "move",
    status: "scheduled",
    fixed: { beforeFrom: false, started: false, opened: false, changedAlone: true },
    fate: "replace_asked",
  },
  {
    change: "move",
    status: "cancelled",
    fixed: { beforeFrom: false, started: false, opened: false },
    fate: "replace_asked",
  },
];

/** Every combination of the swept flags (and the status, when free) for a row. */
function expand(row: Row): { status: SlotDateFacts["status"]; facts: SlotDateFacts }[] {
  const free = FLAGS.filter((f) => row.fixed[f] === undefined);
  const statuses = row.status === undefined ? STATUSES : [row.status];
  const out: { status: SlotDateFacts["status"]; facts: SlotDateFacts }[] = [];
  for (const status of statuses) {
    for (let mask = 0; mask < 1 << free.length; mask += 1) {
      const facts: SlotDateFacts = {
        status,
        beforeFrom: false,
        started: false,
        changedAlone: false,
        opened: false,
      };
      for (const f of FLAGS) {
        const fixed = row.fixed[f];
        if (fixed !== undefined) facts[f] = fixed;
      }
      free.forEach((f, i) => {
        facts[f] = (mask & (1 << i)) !== 0;
      });
      out.push({ status, facts });
    }
  }
  return out;
}

const key = (change: SlotChange, f: SlotDateFacts) =>
  [change, f.status, ...FLAGS.map((flag) => String(f[flag]))].join("|");

describe("what each class of a time slot gets when the slot changes from a date", () => {
  it("the rows cover every combination of change, status and facts exactly once", () => {
    const seen = new Map<string, number>();
    for (const row of ROWS) {
      for (const { facts } of expand(row)) {
        const k = key(row.change, facts);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    expect([...seen.entries()].filter(([, n]) => n !== 1)).toEqual([]);
    expect(seen.size).toBe(CHANGES.length * STATUSES.length * 2 ** FLAGS.length);
  });

  it.each(
    ROWS.map(
      (row) =>
        [row.change, row.status ?? "any", JSON.stringify(row.fixed), row.fate, row] as const,
    ),
  )("%s, a %s class %s → %s", (_change, _status, _fixed, fate, row) => {
    for (const { facts } of expand(row)) {
      expect(slotDateFate(row.change, facts), key(row.change, facts)).toBe(fate);
    }
  });
});

describe("a move or a change of values", () => {
  const slot = { weekdays: [1, 3], startMinute: 18 * 60 };
  it.each([
    ["the same days and time", { weekdays: [1, 3], startMinute: 18 * 60 }, "fields"],
    ["the same days in another order", { weekdays: [3, 1], startMinute: 18 * 60 }, "fields"],
    ["a later start", { weekdays: [1, 3], startMinute: 18 * 60 + 30 }, "move"],
    ["an earlier start", { weekdays: [1, 3], startMinute: 7 * 60 }, "move"],
    ["a day added", { weekdays: [1, 3, 5], startMinute: 18 * 60 }, "move"],
    ["a day taken away", { weekdays: [1], startMinute: 18 * 60 }, "move"],
    ["a day swapped", { weekdays: [1, 4], startMinute: 18 * 60 }, "move"],
    ["other days entirely", { weekdays: [2, 4], startMinute: 18 * 60 }, "move"],
  ] as const)("%s is a %s change", (_label, after, kind) => {
    expect(slotChangeKind(slot, after)).toBe(kind);
  });
});

describe("the dates a time slot can be changed from", () => {
  const base = {
    today: "2026-10-05",
    startsOn: "2026-09-01",
    endsOn: null,
    lastCalendarDate: "2026-11-30",
  };
  it.each([
    ["today", "2026-10-05", base, "ok"],
    ["a later date", "2026-10-19", base, "ok"],
    ["the last date on the calendar", "2026-11-30", base, "ok"],
    ["yesterday", "2026-10-04", base, "past"],
    ["a day past the calendar", "2026-12-01", base, "beyond_calendar"],
    ["before a slot that starts later", "2026-10-10", { ...base, startsOn: "2026-10-12" }, "before_start"],
    ["the day a later slot starts", "2026-10-12", { ...base, startsOn: "2026-10-12" }, "ok"],
    ["a slot's last day", "2026-10-20", { ...base, endsOn: "2026-10-20" }, "ok"],
    ["after a slot's last day", "2026-10-21", { ...base, endsOn: "2026-10-20" }, "after_end"],
    ["the past, before a later slot starts", "2026-10-01", { ...base, startsOn: "2026-10-12" }, "past"],
    // Round one, H-2: a slot that starts past the calendar has no class before
    // its own first day, so that day can be changed from; the next cannot.
    ["a later slot's own first day, past the calendar", "2026-12-22", { ...base, startsOn: "2026-12-22" }, "ok"],
    ["the day after it", "2026-12-23", { ...base, startsOn: "2026-12-22" }, "beyond_calendar"],
  ] as const)("%s → %s", (_label, from, slot, verdict) => {
    expect(fromVerdict(from, slot)).toBe(verdict);
  });
});

// The two limits, from the gym's side: twelve time slots running on any one
// day, and twenty-four listed while halves of time slots changed from a date
// wait to end.
describe("the most time slots running on one day", () => {
  const daily = (startsOn: string, endsOn: string | null = null) => ({ startsOn, endsOn });
  // Seven time slots, one a weekday, bulk edited from 12 Oct: seven halves end
  // on 11 Oct and seven start on 12 Oct.
  const bulkEdited = [
    ...Array.from({ length: 7 }, () => daily("2026-09-01", "2026-10-11")),
    ...Array.from({ length: 7 }, () => daily("2026-10-12")),
  ];
  it.each([
    ["none", [], { from: "2026-10-05", until: null }, 0],
    ["one running", [daily("2026-09-01")], { from: "2026-10-05", until: null }, 1],
    ["one that ended before", [daily("2026-09-01", "2026-10-04")], { from: "2026-10-05", until: null }, 0],
    ["one ending on the first day", [daily("2026-09-01", "2026-10-05")], { from: "2026-10-05", until: null }, 1],
    ["one starting later", [daily("2026-11-01")], { from: "2026-10-05", until: null }, 1],
    ["one starting after the window", [daily("2026-11-01")], { from: "2026-10-05", until: "2026-10-31" }, 0],
    ["one starting on the window's last day", [daily("2026-10-31")], { from: "2026-10-05", until: "2026-10-31" }, 1],
    ["two that never meet", [daily("2026-09-01", "2026-10-10"), daily("2026-10-11")], { from: "2026-10-05", until: null }, 1],
    ["two that meet on one day", [daily("2026-09-01", "2026-10-11"), daily("2026-10-11")], { from: "2026-10-05", until: null }, 2],
    ["a daily class bulk edited, looked at from today", bulkEdited, { from: "2026-10-05", until: null }, 7],
    ["the same, from the edit's date", bulkEdited, { from: "2026-10-12", until: null }, 7],
    ["the same, over a window ending before it", bulkEdited, { from: "2026-10-05", until: "2026-10-08" }, 7],
  ] as const)("%s → %i", (_label, slots, window, peak) => {
    expect(peakRunning(slots, window)).toBe(peak);
  });
});

describe("the class's limits of time slots", () => {
  it.each([
    ["a first time slot", { peak: 0, addsRunning: 1, listed: 0, addsListed: 1 }, true],
    ["the twelfth", { peak: 11, addsRunning: 1, listed: 11, addsListed: 1 }, true],
    ["a thirteenth running at once", { peak: 12, addsRunning: 1, listed: 12, addsListed: 1 }, false],
    // Seven daily time slots bulk edited: fourteen listed, seven running on any
    // one day, so an eighth time slot can still be added.
    ["an eighth after a daily class was bulk edited", { peak: 7, addsRunning: 1, listed: 14, addsListed: 1 }, true],
    ["the twenty-fourth listed", { peak: 11, addsRunning: 1, listed: 23, addsListed: 1 }, true],
    ["a twenty-fifth listed", { peak: 1, addsRunning: 1, listed: 24, addsListed: 1 }, false],
    // One of a class's twelve changed from a date: the other eleven run beside
    // the one that follows it, and it is listed twice until the date.
    ["a split at twelve", { peak: 11, addsRunning: 1, listed: 12, addsListed: 1 }, true],
    ["a move that stops the old time slot outright", { peak: 11, addsRunning: 1, listed: 24, addsListed: 0 }, true],
    ["a bulk edit of twelve, each split", { peak: 0, addsRunning: 0, listed: 12, addsListed: 12 }, true],
    ["a bulk edit past twenty-four listed", { peak: 0, addsRunning: 0, listed: 13, addsListed: 12 }, false],
  ] as const)("%s → %s", (_label, counts, ok) => {
    expect(withinSlotLimits(counts)).toBe(ok);
  });
});
