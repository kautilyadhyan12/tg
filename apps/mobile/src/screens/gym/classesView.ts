// A place's classes, in words: the browser's rules (apps/web/src/components/gym/classesView.js), on the
// place's own clock. Pure, so tested alone. A class's day and clock time arrive as the gym's own and
// are printed as they are, never moved to the phone's zone.
import {
  CLASS_BOOKING_WORDS,
  CLASS_ONLINE_WORDS,
  formatMinor,
  reminderClock,
  type ClassBookingView,
  type GymClockFormat,
  type MemberClassesResponse,
} from "@app/shared";
import { newGoalId } from "../goals/words";
import { dayIn, visitTime, WEEK_HEADS } from "./visitsView";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** One key a tap, the same uuid maker as a goal's: kept while its answer is unknown, so a second press
 *  books once. */
export const newRequestKey = (random: () => number = Math.random): string => newGoalId(random);

/** "Wed 14 Oct"; the day as it came for one that cannot be read. */
export function shortDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) return day;
  const js = at.getUTCDay();
  return `${WEEK_HEADS[js === 0 ? 6 : js - 1] ?? ""} ${String(at.getUTCDate())} ${MONTH_SHORT[at.getUTCMonth()] ?? ""}`;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** "Today · Thu 29 Oct", "Tomorrow · Fri 30 Oct", "Sat 31 Oct". `today` is the gym's own day; null for a
 *  week that does not hold it. */
export function dayHeading(day: string, today: string | null): string {
  if (today === null) return shortDay(day);
  if (day === today) return `Today · ${shortDay(day)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(today) && day === nextDay(today)) return `Tomorrow · ${shortDay(day)}`;
  return shortDay(day);
}

/** "6:30 PM · 45 min" or "18:30 · 45 min", on the gym's clock. */
export function whenText(c: ClassBookingView, clock: GymClockFormat): string {
  return `${reminderClock(c.localStartMinute, clock) ?? ""} · ${String(c.minutes)} min`;
}

/** "Wed 7 Oct, 7:30 AM": an instant on the gym's clock. */
export function instantText(at: string, zone: string, clock: GymClockFormat): string {
  const day = dayIn(zone, new Date(at));
  const time = visitTime(at, zone, clock);
  return day === null || time === "" ? "" : `${shortDay(day)}, ${time}`;
}

/** "13 Oct – 19 Oct" */
export function weekText(list: Pick<MemberClassesResponse, "from" | "to">): string {
  const part = (day: string) => shortDay(day).split(" ").slice(1).join(" ");
  return `${part(list.from)} – ${part(list.to)}`;
}

export interface ClassDay {
  day: string;
  classes: ClassBookingView[];
}

/** The classes under their days, in the order they arrived. */
export function byDay(classes: readonly ClassBookingView[]): ClassDay[] {
  const days: ClassDay[] = [];
  for (const c of classes) {
    const last = days.at(-1);
    if (last?.day === c.localDate) last.classes.push(c);
    else days.push({ day: c.localDate, classes: [c] });
  }
  return days;
}

const clockIn = (at: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(at));

/** The line that says whose clock the times are on, when the phone's differs for any class listed; null
 *  when they agree. */
export function zoneNote(classes: readonly ClassBookingView[], gymName: string, phoneZone: string): string | null {
  const differs = classes.some((c) => {
    try {
      return clockIn(c.startsAt, phoneZone) !== clockIn(c.startsAt, c.timezone);
    } catch {
      return true;
    }
  });
  if (!differs) return null;
  return `Times are ${gymName} time (${(classes[0]?.timezone ?? "").replaceAll("_", " ")}), not this phone’s.`;
}

/** How full the class is. A free place that is the first in line's is not left for anybody else, so
 *  the class reads full to them. */
export function placesText(c: ClassBookingView): string | null {
  if (c.cancelled || c.places === null) return null;
  const left = c.places - c.booked;
  const waiting = `${String(c.waitlisted)} on the waitlist`;
  if (left <= 0) return c.waitlisted > 0 ? `Full · ${waiting}` : "Full";
  const noReason = c.can.why === null || c.can.why === "waitlist_full";
  if (c.waitlisted > 0 && !c.can.book && !c.can.claim && noReason && c.mine?.status !== "booked") return `Full · ${waiting} · a free place is going to the first in line`;
  return left === 1 ? "1 place left" : `${String(left)} of ${String(c.places)} places left`;
}

/** "1st", "2nd", "11th", "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  const end = tens >= 11 && tens <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
  return `${String(n)}${end}`;
}

export type Tone = "good" | "gold" | "plain";

/** What the person holds in the class, as its pill and the line under it; null where they hold nothing.
 *  Waiting never reads as booked. */
export function mineText(c: ClassBookingView, now: number): { pill: string; tone: Tone; line: string | null } | null {
  if (c.mine === null || c.cancelled) return null;
  switch (c.mine.status) {
    case "booked":
      return { pill: "You’re booked", tone: "good", line: c.mine.packCharged ? "1 class used from your pack" : null };
    case "waitlisted":
      return {
        pill: "On the waitlist",
        tone: "gold",
        line: c.mine.waitlistPlace === null ? "Not booked yet" : `Not booked yet · ${ordinal(c.mine.waitlistPlace)} in line`,
      };
    case "attended":
      // A check-in at the gym before the class marks it; the list shows only classes still to start.
      return { pill: Date.parse(c.startsAt) > now ? "Checked in" : "Attended", tone: "good", line: null };
    case "no_show":
      return { pill: "No-show", tone: "plain", line: null };
    case "late_cancelled":
      return { pill: "Late cancel", tone: "plain", line: c.mine.packCharged ? "The class stays used on your pack" : null };
    default:
      return null;
  }
}

export interface Take {
  kind: "claim" | "book" | "waitlist";
  label: string;
  joinWaitlist: boolean;
}

/** The buttons a class offers this person: at most one to take a place, and one to give it up. */
export function actionsOf(c: ClassBookingView): { take: Take | null; give: { late: boolean; label: string } | null } {
  const take: Take | null = c.can.claim
    ? { kind: "claim", label: "Claim place", joinWaitlist: false }
    : c.can.book
      ? { kind: "book", label: "Book", joinWaitlist: false }
      : c.can.joinWaitlist
        ? { kind: "waitlist", label: "Join waitlist", joinWaitlist: true }
        : null;
  const give =
    c.can.cancel === null ? null : { late: c.can.cancel === "late", label: c.mine?.status === "waitlisted" ? "Leave waitlist" : "Cancel booking" };
  return { take, give };
}

/** One plain line for a class the person cannot book or wait for, or null. */
export function whyText(c: ClassBookingView, clock: GymClockFormat): string | null {
  if (c.cancelled) return CLASS_BOOKING_WORDS.class_cancelled;
  if (c.can.claim) return "A place is free. The first person on the waitlist to claim it gets it.";
  const why = c.can.why;
  if (why === null) return null;
  if (why === "not_open_yet") {
    const opens = instantText(c.opensAt, c.timezone, clock);
    return opens === "" ? CLASS_BOOKING_WORDS.not_open_yet : `Booking opens ${opens}.`;
  }
  return CLASS_BOOKING_WORDS[why];
}

/** An online class as this member meets it; null for a class at the gym. The link comes only to
 *  somebody who holds a place, from 30 minutes before the class until it ends. */
export function onlineText(c: ClassBookingView): { line: string; link: string | null } | null {
  if (c.online === null || c.cancelled) return null;
  const link = c.online.state === "open" && typeof c.online.link === "string" && c.online.link.startsWith("https://") ? c.online.link : null;
  return { line: CLASS_ONLINE_WORDS[c.online.state], link };
}

/** How often the list is read again while a link is due and not here, by this phone's clock. */
export const LINK_READ_AGAIN_MS = 20_000;
const LINK_READ_SLOWER_AFTER_MS = 10 * 60_000;
const LINK_READ_SLOWER_MS = 60_000;

/** When the list should be read again by itself, for the online classes they hold a place in; null
 *  where nothing is waited for. The browser's moments: the server decides, and this phone's clock may be
 *  fast or slow. */
export function nextReadAt(classes: readonly ClassBookingView[], now: number): number | null {
  let soonest: number | null = null;
  const want = (at: number) => {
    if (soonest === null || at < soonest) soonest = at;
  };
  for (const c of classes) {
    const online = c.online;
    if (online === null) continue;
    if (online.state === "early") {
      const at = Date.parse(online.opensAt);
      if (Number.isNaN(at) || at - now > 86_400_000) continue;
      want(at > now ? at + 1000 : now + (now - at > LINK_READ_SLOWER_AFTER_MS ? LINK_READ_SLOWER_MS : LINK_READ_AGAIN_MS));
    } else if (online.state === "no_link") {
      want(now + LINK_READ_AGAIN_MS);
    } else if (online.state === "open") {
      const end = Date.parse(c.startsAt) + c.minutes * 60_000;
      if (Number.isNaN(end)) continue;
      want(end > now ? end + 1000 : now + LINK_READ_AGAIN_MS);
    }
  }
  return soonest;
}

/** The late cancel fee this class costs this person; 0 for none. */
export const lateFee = (c: ClassBookingView): number => (c.fees !== null && c.fees.lateCancelMinor > 0 ? c.fees.lateCancelMinor : 0);

export interface CancelAsk {
  title: string;
  lines: string[];
  yes: string;
  no: string;
}

/** What the box asks before a booking is cancelled or a waitlist left. Every fee in it is the one the
 *  request then says yes to. */
export function cancelAsk(c: ClassBookingView, clock: GymClockFormat, gym: string): CancelAsk {
  const what = `${c.className}, ${shortDay(c.localDate)} at ${reminderClock(c.localStartMinute, clock) ?? ""}`;
  if (c.mine?.status === "waitlisted") {
    return { title: "Leave the waitlist?", lines: [what, "You lose your place in line."], yes: "Leave waitlist", no: "Stay on it" };
  }
  const fee = lateFee(c);
  if (c.can.cancel === "late") {
    const words =
      fee > 0 && c.fees !== null
        ? `It’s too late to cancel for free. Cancelling now counts as a late cancel, and ${gym} adds a one-time late cancel fee of ${formatMinor(fee, c.fees.currency)} to your bill.`
        : c.mine?.packCharged === true
          ? CLASS_BOOKING_WORDS.late_cancel_pack
          : CLASS_BOOKING_WORDS.late_cancel;
    return { title: "Cancel late?", lines: [what, words], yes: "Cancel booking", no: "Keep it" };
  }
  // "Free" is said only where something follows that is not: a fee, or a pack's class.
  const pack = c.mine?.packCharged === true;
  if (!pack && fee === 0) return { title: "Cancel your booking?", lines: [what], yes: "Cancel booking", no: "Keep it" };
  const until = instantText(c.freeCancelUntil, c.timezone, clock);
  const free = until === "" ? "Free to cancel now." : `Free to cancel until ${until}.`;
  const after =
    pack || c.fees === null ? " Your pack gets the class back." : ` After that, ${gym} charges a one-time late cancel fee of ${formatMinor(fee, c.fees.currency)}.`;
  return { title: "Cancel your booking?", lines: [what, `${free}${after}`], yes: "Cancel booking", no: "Keep it" };
}

/** What a class's fees mean for this person, said under it before they book and while they hold a
 *  place: when free cancelling ends and what a late cancel costs after it, and what not coming costs.
 *  Empty where neither costs anything. `now` is the phone's clock, against the gym's free-cancel time. */
export function feeLines(c: ClassBookingView, clock: GymClockFormat, now: number, gym: string): string[] {
  if (c.fees === null || c.cancelled) return [];
  const { take, give } = actionsOf(c);
  if (take === null && give === null) return [];
  const lines: string[] = [];
  const late = c.fees.lateCancelMinor;
  if (late > 0) {
    const money = formatMinor(late, c.fees.currency);
    const until = instantText(c.freeCancelUntil, c.timezone, clock);
    // A held place has the server's word; leaving a waitlist is always free, so a place still to come
    // is judged by the time.
    const booked = c.mine?.status === "booked";
    const stillFree = booked ? c.can.cancel === "free" : !insideFreeCancel(c, now);
    if (stillFree && until !== "") lines.push(`Free to cancel until ${until}. After that, ${gym} charges a one-time late cancel fee of ${money}.`);
    else if (booked) lines.push(`If you cancel now, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
    else if (!freeCancelPassed(c, now) && until !== "") lines.push(endsSoon(until, money, gym));
    else if (c.mine?.status === "waitlisted") lines.push(`This class starts soon. If you get a place and then cancel, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
    else lines.push(`This class starts soon. If you book and then cancel, ${gym} adds a one-time late cancel fee of ${money} to your bill.`);
  }
  if (c.fees.noShowMinor > 0) {
    lines.push(`If you don’t come, ${gym} adds a one-time no-show fee of ${formatMinor(c.fees.noShowMinor, c.fees.currency)} to your bill.`);
  }
  return lines;
}

/** How long before the gym's free-cancel time the phone already treats a class as inside it: a phone
 *  clock a few minutes slow then still warns, rather than skipping Book's box. */
export const CLOCK_MARGIN_MS = 5 * 60_000;

/** The class is inside its free-cancel time, or close enough to it by this phone's clock. */
export function insideFreeCancel(c: ClassBookingView, now: number): boolean {
  const until = Date.parse(c.freeCancelUntil);
  return Number.isNaN(until) || until - now <= CLOCK_MARGIN_MS;
}

/** The free-cancel time has passed by this phone's clock; inside the margin before it, it has not. */
function freeCancelPassed(c: ClassBookingView, now: number): boolean {
  const until = Date.parse(c.freeCancelUntil);
  return Number.isNaN(until) || until <= now;
}

/** Inside the margin: free cancelling has not ended yet, and ends in minutes. The fee is the gym's own. */
const endsSoon = (until: string, money: string, gym: string) =>
  `Free cancelling ends at ${until}. If you cancel after that, ${gym} adds a one-time late cancel fee of ${money} to your bill.`;

/** The box before a booking that could not be cancelled without a late cancel fee: the class starts
 *  inside its free-cancel time. Null where Book needs no question. */
export function bookAsk(c: ClassBookingView, take: Take, clock: GymClockFormat, now: number, gym: string): CancelAsk | null {
  const fee = lateFee(c);
  if (fee === 0 || c.fees === null || !insideFreeCancel(c, now)) return null;
  const what = `${c.className}, ${shortDay(c.localDate)} at ${reminderClock(c.localStartMinute, clock) ?? ""}`;
  const money = formatMinor(fee, c.fees.currency);
  const until = instantText(c.freeCancelUntil, c.timezone, clock);
  return {
    title: `${take.label}?`,
    lines: [
      what,
      !freeCancelPassed(c, now) && until !== ""
        ? endsSoon(until, money, gym)
        : `This class starts soon, so it can’t be cancelled for free. If you book and then cancel, ${gym} adds a one-time late cancel fee of ${money} to your bill.`,
    ],
    yes: take.label,
    no: "Not now",
  };
}

/** What is said once a cancel has gone through, from the class as the server now has it. */
export function cancelledText(c: ClassBookingView): string {
  return c.mine?.status === "late_cancelled" ? "Cancelled late." : "Cancelled.";
}

/** The class as a late cancel the server now asks for, with the fee it says it costs now (its 409's
 *  `packCharged`, `feeMinor` and `currency`). */
export function askedLate(c: ClassBookingView, body: unknown): ClassBookingView {
  const field = (name: string): unknown => (typeof body === "object" && body !== null && name in body ? Reflect.get(body, name) : undefined);
  const fee = field("feeMinor");
  const said = field("currency");
  const feeMinor = typeof fee === "number" && Number.isInteger(fee) && fee > 0 ? fee : 0;
  const currency = typeof said === "string" && /^[A-Z]{3}$/.test(said) ? said : null;
  return {
    ...c,
    can: { ...c.can, cancel: "late" },
    mine: c.mine === null ? null : { ...c.mine, packCharged: field("packCharged") === true },
    fees: feeMinor > 0 && currency !== null ? { lateCancelMinor: feeMinor, noShowMinor: c.fees?.noShowMinor ?? 0, currency } : null,
  };
}

/** What a place's page says when its classes can't be read: the server's 404 is for anybody who is not
 *  a member of a place on a live plan. */
export function couldNotRead(status: number | null, name: string): string {
  return status === 404 ? `${name}’s classes aren’t available right now.` : "Couldn’t load the classes.";
}

/** The page's line for a week with no classes. */
export function emptyWeek(week: number, name: string): string {
  return week === 0 ? `${name} has no classes in the next 7 days.` : `${name} has no classes in these 7 days.`;
}

/** The line under a list the server cut short. */
export const MORE_CLASSES = "These 7 days have more classes than this page shows. The later ones are not listed.";
