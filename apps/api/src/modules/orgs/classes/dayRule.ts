// WHAT ONE DATE ON THE CALENDAR MAY TAKE — §13.3's "this day only", 17b-ii-b-i.
//
// Pure. The repo reads the facts under the gym's row lock and asks this; the
// table test in `classes.dayRule.test.ts` covers every combination.
//
// A date that has started is history: nothing changes it, cancels it or puts it
// back. Cancelling a cancelled date and putting back a running one change
// nothing and are not errors, so a double tap or a retry answers the same.

export type DayAction = "change" | "cancel" | "restore";

export interface DayFacts {
  status: "scheduled" | "cancelled";
  /** Its `starts_at` is at or before the server's now. */
  started: boolean;
  /** Change only: the time, length, places and coach asked for are the ones it
   *  already has. False for cancel and restore. */
  unchanged: boolean;
  /** Change only: the new start time, on that date, is at or before now. False
   *  for cancel and restore. */
  newStartPassed: boolean;
}

export type DayVerdict =
  | "write"
  | "nothing"
  | "started"
  /** A change asked of a cancelled date: put it back first. */
  | "cancelled"
  | "time_passed";

export function dayVerdict(action: DayAction, facts: DayFacts): DayVerdict {
  if (facts.started) return "started";
  switch (action) {
    case "cancel":
      return facts.status === "cancelled" ? "nothing" : "write";
    case "restore":
      return facts.status === "scheduled" ? "nothing" : "write";
    case "change":
      if (facts.status === "cancelled") return "cancelled";
      if (facts.unchanged) return "nothing";
      if (facts.newStartPassed) return "time_passed";
      return "write";
    default: {
      const never: never = action;
      throw new Error(`unhandled day action: ${String(never)}`);
    }
  }
}
