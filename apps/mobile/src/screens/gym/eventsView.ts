// A place's events, in words: the browser's rules (apps/web/src/components/gym/eventsView.js) in the phone's Classes
// words (Book, You're booked, Cancel booking), on the gym's own clock. Pure, so tested alone. An event's days and clock times arrive as the gym's own and are printed as they
// are, never moved to the phone's zone. What the screen says about a person's place comes only from `going`.
import { reminderClock, type GymClockFormat, type MemberGymEvent } from "@app/shared";
import { ordinal, shortDay } from "./classesView";

const count = (n: number) => n.toLocaleString("en-GB");

/** "Sat 17 Oct", with its year where that is not the year of `today` (the gym's day). */
export function eventDay(day: string, today: string): string {
  return today.slice(0, 4) === day.slice(0, 4) ? shortDay(day) : `${shortDay(day)} ${day.slice(0, 4)}`;
}

/** "Sat 17 Oct · 10:00 AM – 1:00 PM", or for one that runs past its day "Sat 17 Oct, 10:00 AM – Sun 18 Oct, 4:00 PM". */
export function eventWhen(event: MemberGymEvent, today: string, clock: GymClockFormat): string {
  const from = reminderClock(event.startMinute, clock) ?? "";
  const to = reminderClock(event.endMinute, clock) ?? "";
  if (event.startsOn === event.endsOn) return `${eventDay(event.startsOn, today)} · ${from} – ${to}`;
  return `${eventDay(event.startsOn, today)}, ${from} – ${eventDay(event.endsOn, today)}, ${to}`;
}

/** "12 of 30 places left", "1 place left", "Full", "Full · 3 on the waitlist", and with no limit "12 going". Null with no limit and
 *  nobody down for it yet. */
export function eventPlacesLeft(event: MemberGymEvent): string | null {
  const { coming, waiting } = event.going;
  if (event.places === null) return coming === 0 ? null : `${count(coming)} going`;
  const left = Math.max(0, event.places - coming);
  if (left === 0) return waiting === 0 ? "Full" : `Full · ${count(waiting)} on the waitlist`;
  return left === 1 ? "1 place left" : `${count(left)} of ${count(event.places)} places left`;
}

/** What the member holds, as its pill and the line under it: null when they hold nothing. Waiting never reads as booked. */
export function eventMine(event: MemberGymEvent): { pill: string; good: boolean; line: string | null } | null {
  const { mine, can } = event.going;
  if (mine === null) return null;
  if (mine.status === "coming") return { pill: "You’re booked", good: true, line: null };
  if (can.claim) return { pill: "On the waitlist", good: false, line: "A place is free. Claim it before someone else does." };
  return { pill: "On the waitlist", good: false, line: mine.waitlistPlace === null ? "Not booked yet" : `Not booked yet · ${ordinal(mine.waitlistPlace)} in line` };
}

export type EventAct = "come" | "wait" | "cancel";
export interface EventAction {
  kind: EventAct;
  label: string;
  main: boolean;
}

/** The buttons an event offers this member, in order. None on a cancelled event: it keeps everybody's place in case it
 *  comes back, and the server would let a place go that could not then be had again. */
export function eventActions(event: MemberGymEvent): EventAction[] {
  if (event.cancelled) return [];
  const { mine, can } = event.going;
  const actions: EventAction[] = [];
  if (can.come) actions.push({ kind: "come", label: "Book", main: true });
  if (can.claim) actions.push({ kind: "come", label: "Claim place", main: true });
  if (can.joinWaitlist) actions.push({ kind: "wait", label: "Join waitlist", main: true });
  if (can.cancel) actions.push({ kind: "cancel", label: mine?.status === "waitlisted" ? "Leave waitlist" : "Cancel booking", main: false });
  return actions;
}

/** Why there is no button, where the card does not already say: Full and Cancelled say so themselves. */
export function eventWhyNot(event: MemberGymEvent): string | null {
  const { mine, can } = event.going;
  if (can.why === "waitlist_full") return "The waitlist is full.";
  if (can.why === "event_started" && mine?.status !== "coming") return "Booking has closed.";
  return null;
}

/** Under a member's own waitlist line, while a place can still come to them. */
export function waitlistNote(event: MemberGymEvent): string | null {
  const { mine, can } = event.going;
  if (mine?.status !== "waitlisted" || can.claim || can.why !== null || event.cancelled) return null;
  return "Check back here if a place opens.";
}

/** Whether Cancel booking asks first: somebody else would take the place at once. */
export function givingUpAsks(event: MemberGymEvent): boolean {
  const { mine, coming, waiting } = event.going;
  return !event.cancelled && mine?.status === "coming" && event.places !== null && (coming >= event.places || waiting > 0);
}

/** Whether it has started and not ended, at `now`. */
export function eventIsOn(event: MemberGymEvent, now: number): boolean {
  return Date.parse(event.startsAt) <= now && now < Date.parse(event.endsAt);
}

const clockIn = (at: string, timeZone: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(at));

/** The line that says whose clock the times are on, when the phone's differs for any event listed. */
export function eventsZoneNote(events: readonly MemberGymEvent[], gymName: string, gymZone: string, phoneZone: string): string | null {
  const differs = events.some((e) => {
    try {
      return clockIn(e.startsAt, phoneZone) !== clockIn(e.startsAt, gymZone);
    } catch {
      return true;
    }
  });
  if (!differs) return null;
  return `Times are ${gymName} time (${gymZone.replaceAll("_", " ")}), not this phone’s.`;
}

/** The next moment a listed event starts or ends, after `now`: what the page says changes then. */
export function nextEventChangeAt(events: readonly MemberGymEvent[], now: number): number | null {
  const later = events.flatMap((e) => [Date.parse(e.startsAt), Date.parse(e.endsAt)]).filter((at) => at > now);
  return later.length === 0 ? null : Math.min(...later);
}

/** The longest a timer for the next start or end is set for. */
const LONGEST_TIMER_MS = 60 * 60_000;

/** The next timer on the way to `at`: only the start or end itself is worth a read; a long wait is only cut into pieces. */
export function nextEventTimer(at: number, now: number): { afterMs: number; read: boolean } {
  const left = at - now + 1000;
  return left > LONGEST_TIMER_MS ? { afterMs: LONGEST_TIMER_MS, read: false } : { afterMs: left, read: true };
}

export const NO_EVENTS = "No upcoming events.";
export const EVENTS_NOT_SHOWN = "Events aren’t available right now.";
export const EVENTS_NOT_READ = "Couldn’t load events.";
export const EARLIER_BOOKING_GONE = "Your earlier booking was cancelled.";

/** The box's line, true to what the card says: full only when no place is free. */
export function givingUpLine(event: MemberGymEvent): string {
  return event.places !== null && event.going.coming >= event.places
    ? "This event is full, so your place may go to someone else."
    : "People are waiting for a place, so yours may go to someone else.";
}
