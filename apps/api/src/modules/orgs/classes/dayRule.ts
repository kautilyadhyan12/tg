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
  /** Change only: the new start time does not exist on that date in the gym's
   *  zone — the clocks go forward over it (round one, L-3). False when the time
   *  is not being changed, so a date the fill already put at such a time can
   *  still have its places or coach changed. */
  newTimeMissing: boolean;
  /** Its repeat has been stopped, or its class removed (round one, H-2). Such a
   *  date is only ever a cancelled one — the running ones are deleted — and it
   *  keeps its class off that whole day. Putting it back LIFTS that hold: the
   *  row goes and the class's live repeats run that day (re-check, N-1). */
  repeatStopped: boolean;
}

export type DayVerdict =
  | "write"
  | "nothing"
  | "started"
  /** A change asked of a cancelled date: put it back first. */
  | "cancelled"
  | "time_passed"
  | "time_missing"
  /** Put back a cancelled date whose repeat was stopped: lift the hold. */
  | "lift";

export function dayVerdict(action: DayAction, facts: DayFacts): DayVerdict {
  if (facts.started) return "started";
  switch (action) {
    case "cancel":
      return facts.status === "cancelled" ? "nothing" : "write";
    case "restore":
      if (facts.status === "scheduled") return "nothing";
      return facts.repeatStopped ? "lift" : "write";
    case "change":
      if (facts.status === "cancelled") return "cancelled";
      if (facts.unchanged) return "nothing";
      if (facts.newStartPassed) return "time_passed";
      if (facts.newTimeMissing) return "time_missing";
      return "write";
    default: {
      const never: never = action;
      throw new Error(`unhandled day action: ${String(never)}`);
    }
  }
}
