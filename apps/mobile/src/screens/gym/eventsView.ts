// A place's events, in words: the browser's rules (apps/web/src/components/gym/eventsView.js), on the gym's own
// clock. Pure, so tested alone. An event's days and clock times arrive as the gym's own and are printed as they
// are, never moved to the phone's zone. What the screen says about a person's place comes only from `going`.
import { reminderClock, type GymClockFormat, type MemberGymEvent } from "@app/shared";
import { shortDay } from "./classesView";

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

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${String(n)}th`;
  return `${String(n)}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** "12 of 30 places left", "Full", "Full · 3 on the waitlist", and with no limit "12 coming". Null with no limit and
 *  nobody down for it yet. */
export function eventPlacesLeft(event: MemberGymEvent): string | null {
  const { coming, waiting } = event.going;
  if (event.places === null) return coming === 0 ? null : `${count(coming)} coming`;
  const left = Math.max(0, event.places - coming);
  if (left === 0) return waiting === 0 ? "Full" : `Full · ${count(waiting)} on the waitlist`;
  return `${count(left)} of ${count(event.places)} ${event.places === 1 ? "place" : "places"} left`;
}

/** The member's own line: null when they are not down for it. */
export function eventMine(event: MemberGymEvent): { text: string; good: boolean } | null {
  const { mine, can } = event.going;
  if (mine === null) return null;
  if (mine.status === "coming") return { text: "You’re coming", good: true };
  if (can.claim) return { text: "A place is free for you. Take it before somebody else does.", good: true };
  return { text: mine.waitlistPlace === null ? "You’re on the waitlist" : `You’re ${ordinal(mine.waitlistPlace)} on the waitlist`, good: false };
}

export type EventAct = "come" | "wait" | "cancel";
export interface EventAction {
  kind: EventAct;
  label: string;
  main: boolean;
}

/** The buttons an event offers this member, in order. */
export function eventActions(event: MemberGymEvent): EventAction[] {
  const { mine, can } = event.going;
  const actions: EventAction[] = [];
  if (can.come) actions.push({ kind: "come", label: "I’m coming", main: true });
  if (can.claim) actions.push({ kind: "come", label: "Take the place", main: true });
  if (can.joinWaitlist) actions.push({ kind: "wait", label: "Join the waitlist", main: true });
  if (can.cancel) actions.push({ kind: "cancel", label: mine?.status === "waitlisted" ? "Leave the waitlist" : "Can’t come", main: false });
  return actions;
}

/** Why there is no button, where the card does not already say (a cancelled event does). */
export function eventWhyNot(event: MemberGymEvent): string | null {
  const { mine, can } = event.going;
  if (can.why === "waitlist_full") return "This event and its waitlist are full.";
  if (can.why === "event_full") return "This event is full.";
  if (can.why === "event_started" && mine === null) return "This event has started, so it’s too late to say you’re coming.";
  if (can.why === "event_started" && mine?.status === "waitlisted") return "This event has started, so the waitlist is closed.";
  if (mine?.status === "coming" && !can.cancel && !event.cancelled) return "This event has started, so this can’t be changed.";
  return null;
}

/** Under a member's own waitlist line, while a place can still come to them. */
export function waitlistNote(event: MemberGymEvent): string | null {
  const { mine, can } = event.going;
  if (mine?.status !== "waitlisted" || can.claim || can.why !== null || event.cancelled) return null;
  return "If a place comes free it can go to you. Check back here.";
}

/** Whether "Can't come" asks first: somebody else would take the place at once. */
export function givingUpAsks(event: MemberGymEvent): boolean {
  const { mine, coming, waiting } = event.going;
  return mine?.status === "coming" && event.places !== null && (coming >= event.places || waiting > 0);
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

export const noEvents = (gymName: string) => `${gymName} has no events coming up.`;
export const eventsNotShown = (gymName: string) => `${gymName}’s events aren’t available right now.`;
export const EVENTS_NOT_READ = "Couldn’t load the events.";
export const EVENT_CANCELLED_LINE = "This event has been cancelled.";
export const EARLIER_PLACE_GONE = "Your earlier place was given up. Press again to come.";
export const givingUpTitle = (name: string) => `Give up your place at ${name}?`;
export const GIVING_UP_LINE = "This event is full, so somebody else can take your place straight away.";
