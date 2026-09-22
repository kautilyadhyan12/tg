// THE ONE-DAY RULE, every combination (CLAUDE.md §4: a rule that picks ships
// with a table test). Pure — no database. The wiring is proved through the
// routes in `classes.days.routes.test.ts`.
import { describe, expect, it } from "vitest";
import {
  dayVerdict,
  type DayAction,
  type DayFacts,
  type DayVerdict,
} from "../src/modules/orgs/classes/dayRule.js";

const ACTIONS: DayAction[] = ["change", "cancel", "restore"];
const STATUSES: DayFacts["status"][] = ["scheduled", "cancelled"];
const BOOLS = [false, true];

// Every combination of a date that has NOT started, written out by hand.
// Columns: action, status, unchanged, newStartPassed → verdict.
const NOT_STARTED: [DayAction, DayFacts["status"], boolean, boolean, DayVerdict][] = [
  // change a running day
  ["change", "scheduled", false, false, "write"],
  ["change", "scheduled", false, true, "time_passed"],
  ["change", "scheduled", true, false, "nothing"],
  // Asking for the time it already has is not a move into the past.
  ["change", "scheduled", true, true, "nothing"],
  // change a cancelled day: put it back first, whatever was asked
  ["change", "cancelled", false, false, "cancelled"],
  ["change", "cancelled", false, true, "cancelled"],
  ["change", "cancelled", true, false, "cancelled"],
  ["change", "cancelled", true, true, "cancelled"],
  // cancel: the two change-only facts never matter
  ["cancel", "scheduled", false, false, "write"],
  ["cancel", "scheduled", false, true, "write"],
  ["cancel", "scheduled", true, false, "write"],
  ["cancel", "scheduled", true, true, "write"],
  ["cancel", "cancelled", false, false, "nothing"],
  ["cancel", "cancelled", false, true, "nothing"],
  ["cancel", "cancelled", true, false, "nothing"],
  ["cancel", "cancelled", true, true, "nothing"],
  // restore: likewise
  ["restore", "scheduled", false, false, "nothing"],
  ["restore", "scheduled", false, true, "nothing"],
  ["restore", "scheduled", true, false, "nothing"],
  ["restore", "scheduled", true, true, "nothing"],
  ["restore", "cancelled", false, false, "write"],
  ["restore", "cancelled", false, true, "write"],
  ["restore", "cancelled", true, false, "write"],
  ["restore", "cancelled", true, true, "write"],
];

describe("what one date on the calendar may take", () => {
  it("the hand-written table covers every combination of a date that has not started, once", () => {
    const seen = new Set(NOT_STARTED.map((r) => r.slice(0, 4).join("|")));
    expect(seen.size).toBe(NOT_STARTED.length);
    expect(seen.size).toBe(ACTIONS.length * STATUSES.length * BOOLS.length * BOOLS.length);
  });

  it.each(NOT_STARTED)(
    "%s on a %s day (unchanged %s, new time passed %s) → %s",
    (action, status, unchanged, newStartPassed, verdict) => {
      expect(dayVerdict(action, { status, started: false, unchanged, newStartPassed })).toBe(
        verdict,
      );
    },
  );

  it("a day that has started takes nothing, whatever is asked of it", () => {
    for (const action of ACTIONS) {
      for (const status of STATUSES) {
        for (const unchanged of BOOLS) {
          for (const newStartPassed of BOOLS) {
            expect(
              dayVerdict(action, { status, started: true, unchanged, newStartPassed }),
              `${action} ${status} ${String(unchanged)} ${String(newStartPassed)}`,
            ).toBe("started");
          }
        }
      }
    }
  });
});
