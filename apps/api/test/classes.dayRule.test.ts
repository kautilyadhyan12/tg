// THE ONE-DAY RULE, every combination (CLAUDE.md §4: a rule that picks ships
// with a table test). Pure — no database. The wiring is proved through the
// routes in `classes.days.routes.test.ts`.
//
// Each row fixes the facts that decide it and SWEEPS the rest over both values,
// so a row also proves the facts it leaves out do not matter. The first test
// checks the rows cover every combination exactly once.
import { describe, expect, it } from "vitest";
import {
  dayVerdict,
  type DayAction,
  type DayFacts,
  type DayVerdict,
} from "../src/modules/orgs/classes/dayRule.js";

type Flag = "started" | "unchanged" | "newStartPassed" | "newTimeMissing" | "repeatStopped";
const FLAGS: Flag[] = ["started", "unchanged", "newStartPassed", "newTimeMissing", "repeatStopped"];
const ACTIONS: DayAction[] = ["change", "cancel", "restore"];
const STATUSES: DayFacts["status"][] = ["scheduled", "cancelled"];

interface Row {
  action: DayAction;
  status: DayFacts["status"];
  /** The facts this row decides on; every other flag is swept. */
  fixed: Partial<Record<Flag, boolean>>;
  verdict: DayVerdict;
}

// Written by hand, in words a gym would use.
const ROWS: Row[] = [
  // A date that has started takes nothing, whatever is asked.
  ...ACTIONS.flatMap((action) =>
    STATUSES.map((status): Row => ({ action, status, fixed: { started: true }, verdict: "started" })),
  ),
  // Changing a running date.
  { action: "change", status: "scheduled", fixed: { started: false, unchanged: true }, verdict: "nothing" },
  {
    action: "change",
    status: "scheduled",
    fixed: { started: false, unchanged: false, newStartPassed: true },
    verdict: "time_passed",
  },
  {
    action: "change",
    status: "scheduled",
    fixed: { started: false, unchanged: false, newStartPassed: false, newTimeMissing: true },
    verdict: "time_missing",
  },
  {
    action: "change",
    status: "scheduled",
    fixed: { started: false, unchanged: false, newStartPassed: false, newTimeMissing: false },
    verdict: "write",
  },
  // Changing a cancelled date: put it back first.
  { action: "change", status: "cancelled", fixed: { started: false }, verdict: "cancelled" },
  // Cancelling.
  { action: "cancel", status: "scheduled", fixed: { started: false }, verdict: "write" },
  { action: "cancel", status: "cancelled", fixed: { started: false }, verdict: "nothing" },
  // Putting back.
  { action: "restore", status: "scheduled", fixed: { started: false }, verdict: "nothing" },
  {
    action: "restore",
    status: "cancelled",
    fixed: { started: false, repeatStopped: false },
    verdict: "write",
  },
  {
    action: "restore",
    status: "cancelled",
    fixed: { started: false, repeatStopped: true },
    verdict: "repeat_stopped",
  },
];

/** Every combination of the swept flags for one row. */
function expand(row: Row): DayFacts[] {
  const free = FLAGS.filter((f) => row.fixed[f] === undefined);
  const out: DayFacts[] = [];
  for (let mask = 0; mask < 1 << free.length; mask += 1) {
    const facts: DayFacts = {
      status: row.status,
      started: false,
      unchanged: false,
      newStartPassed: false,
      newTimeMissing: false,
      repeatStopped: false,
    };
    for (const f of FLAGS) {
      const fixed = row.fixed[f];
      if (fixed !== undefined) facts[f] = fixed;
    }
    free.forEach((f, i) => {
      facts[f] = (mask & (1 << i)) !== 0;
    });
    out.push(facts);
  }
  return out;
}

const key = (action: DayAction, f: DayFacts) =>
  [action, f.status, ...FLAGS.map((flag) => String(f[flag]))].join("|");

describe("what one date on the calendar may take", () => {
  it("the rows cover every combination of action, status and facts exactly once", () => {
    const seen = new Map<string, number>();
    for (const row of ROWS) {
      for (const facts of expand(row)) {
        const k = key(row.action, facts);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(seen.size).toBe(ACTIONS.length * STATUSES.length * 2 ** FLAGS.length);
  });

  it.each(ROWS.map((row) => [row.action, row.status, JSON.stringify(row.fixed), row.verdict, row] as const))(
    "%s on a %s day %s → %s",
    (_action, _status, _fixed, verdict, row) => {
      for (const facts of expand(row)) {
        expect(dayVerdict(row.action, facts), key(row.action, facts)).toBe(verdict);
      }
    },
  );
});
