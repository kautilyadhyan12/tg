// The person's own clock for the reminders (ROADMAP Stage 5 item 19e-i): the one place their day, the
// minute and the day of the week are worked out, for saving and for sending alike.

const checked = new Map<string, string>();
/** A zone named as the world's list names one ("Asia/Kolkata", "America/New_York") or "UTC"; anything
 *  else, including "+05:30", which Postgres reads the other way round, is read as UTC. */
export function reminderZone(zone: string | null): string {
  if (zone === null || zone === "") return "UTC";
  const known = checked.get(zone);
  if (known !== undefined) return known;
  let read = "UTC";
  if (zone === "UTC" || /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone)) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: zone });
      read = zone;
    } catch {
      read = "UTC";
    }
  }
  // Kept for the next call; a run reads the same few zones thousands of times. Bounded, as people type them.
  if (checked.size < 2000) checked.set(zone, read);
  return read;
}

export interface LocalClock {
  /** 'YYYY-MM-DD' on the person's clock. */
  day: string;
  /** Minutes after midnight, 0 to 1439. */
  minute: number;
  /** 1 Monday … 7 Sunday. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// One reader a zone, made once: making one costs far more than using it, and a run reads thousands of times.
const readers = new Map<string, Intl.DateTimeFormat>();
function readerOf(zone: string): Intl.DateTimeFormat {
  const known = readers.get(zone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  readers.set(zone, made);
  return made;
}

export function localClock(zone: string | null, now: Date): LocalClock {
  const parts = readerOf(reminderZone(zone)).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(part("hour")) % 24;
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    minute: hour * 60 + Number(part("minute")),
    weekday: WEEKDAYS[part("weekday")] ?? 1,
  };
}

/** The hour on the person's clock when a meal was logged, for the Food screen's own sections. */
export function localHourOf(zone: string | null, at: Date): number {
  return Math.floor(localClock(zone, at).minute / 60);
}
