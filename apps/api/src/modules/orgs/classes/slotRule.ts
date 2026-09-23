// CHANGING A TIME SLOT FROM A DATE — §13.3's "this day and later", 17b-ii-b-ii.
//
// Pure. The repo reads a time slot's coming classes under the gym's row lock,
// asks `slotDateFate` about each one and writes by the ids it answers; the table
// test in `classes.slotRule.test.ts` covers every combination.
//
// **Classes before the Update-from date are never touched, and neither is one
// that has started.** That is the job's worst thing: a change "from 12 Oct" that
// also moved the classes before it would send people to an empty room.
//
// Two kinds of change (TeamUp's Bulk Edit and its "End the old slot ➔ create a
// new repeating slot on the new day/time"):
//   · FIELDS — length, size or coach. The time slot stays; each class from the
//     date takes the new values, except one the gym changed on its own. A
//     cancelled class stays cancelled: its status is not a field.
//   · MOVE — the days or the start time. The time slot ends the day before the
//     date and a new one starts on it, so every class from the date is replaced
//     by the new time slot's. One the gym changed or cancelled on its own is
//     replaced too, and the gym is asked first (Outlook's "Any exceptions
//     associated with this recurring appointment will be lost").
//
// The one class the change was made from on the Calendar ("This and future
// classes") is the gym's own choice for that class, so it always takes the change
// and is never counted in the question.

import { CLASS_SCHEDULES_LISTED_PER_TYPE_MAX, CLASS_SCHEDULES_PER_TYPE_MAX } from "@app/shared";

export type SlotChange = "fields" | "move";

/** A move when the days or the start time differ; the order of the days is not
 *  a difference (both sides arrive sorted, and this does not rely on it). */
export function slotChangeKind(
  before: { weekdays: readonly number[]; startMinute: number },
  after: { weekdays: readonly number[]; startMinute: number },
): SlotChange {
  if (before.startMinute !== after.startMinute) return "move";
  const was = new Set(before.weekdays);
  const now = new Set(after.weekdays);
  if (was.size !== now.size) return "move";
  for (const day of now) if (!was.has(day)) return "move";
  return "fields";
}

export interface SlotDateFacts {
  /** Its date is before the Update-from date. */
  beforeFrom: boolean;
  /** It has started, by the server's clock. */
  started: boolean;
  status: "scheduled" | "cancelled";
  changedAlone: boolean;
  /** The class the change was made from on the Calendar. */
  opened: boolean;
}

export type SlotDateFate =
  /** Left exactly as it is. */
  | "keep"
  /** Takes the new length, size, coach and time slot's start; stays cancelled
   *  if it was, and no longer marked changed on its own. */
  | "restamp"
  /** Taken off; the new time slot writes its own class for that date. */
  | "replace"
  /** Replaced, and it was changed or cancelled on its own: counted, and the gym
   *  is asked before it goes. */
  | "replace_asked";

export function slotDateFate(change: SlotChange, facts: SlotDateFacts): SlotDateFate {
  if (facts.started || facts.beforeFrom) return "keep";
  switch (change) {
    case "fields":
      return facts.changedAlone && !facts.opened ? "keep" : "restamp";
    case "move":
      if (facts.opened) return "replace";
      return facts.status === "cancelled" || facts.changedAlone ? "replace_asked" : "replace";
    default: {
      const never: never = change;
      throw new Error(`unhandled slot change: ${String(never)}`);
    }
  }
}

/** The most of these time slots that run on any one day from `window.from` to
 *  `window.until` (null: no end). The count only rises on a day one of them
 *  starts, so those days and the first are the only ones to look at. */
export function peakRunning(
  slots: readonly { startsOn: string; endsOn: string | null }[],
  window: { from: string; until: string | null },
): number {
  const days = [
    window.from,
    ...slots
      .map((s) => s.startsOn)
      .filter((day) => day > window.from && (window.until === null || day <= window.until)),
  ];
  let peak = 0;
  for (const day of days) {
    const running = slots.filter(
      (s) => s.startsOn <= day && (s.endsOn === null || s.endsOn >= day),
    ).length;
    if (running > peak) peak = running;
  }
  return peak;
}

/** THE CLASS'S LIMITS OF TIME SLOTS, for a write that adds one.
 *
 *  `peak` is the most of the class's other time slots running on any one day
 *  the new one runs (`peakRunning`): at most `CLASS_SCHEDULES_PER_TYPE_MAX` may
 *  run at once, which is the limit a gym is told about. A time slot changed from
 *  a date ends the day before it, so it never runs beside the one that follows.
 *
 *  `listed` is how many time slots the class has not finished, every half
 *  included: at most `CLASS_SCHEDULES_LISTED_PER_TYPE_MAX`, the number the
 *  Classes screen reads a class. */
export function withinSlotLimits(counts: {
  peak: number;
  addsRunning: number;
  listed: number;
  addsListed: number;
}): boolean {
  return (
    counts.peak + counts.addsRunning <= CLASS_SCHEDULES_PER_TYPE_MAX &&
    counts.listed + counts.addsListed <= CLASS_SCHEDULES_LISTED_PER_TYPE_MAX
  );
}

export type FromVerdict =
  | "ok"
  /** Before the gym's today. */
  | "past"
  /** Before the time slot's own first day. */
  | "before_start"
  /** After the time slot's own last day. */
  | "after_end"
  /** Past the calendar's written window, where the classes before it are not
   *  all written yet and so could not be told apart from the ones after it. A
   *  time slot's own first day is never this: it has no class before it. */
  | "beyond_calendar";

/** Is `from` a date this time slot can be changed from? All `YYYY-MM-DD`, which
 *  sort in calendar order as strings. */
export function fromVerdict(
  from: string,
  slot: { today: string; startsOn: string; endsOn: string | null; lastCalendarDate: string },
): FromVerdict {
  if (from < slot.today) return "past";
  if (from < slot.startsOn) return "before_start";
  if (slot.endsOn !== null && from > slot.endsOn) return "after_end";
  if (from > slot.lastCalendarDate && from !== slot.startsOn) return "beyond_calendar";
  return "ok";
}
