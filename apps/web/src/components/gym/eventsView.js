import { clockText } from './classesView';
import { dayLabel } from './leaderboardView';

// A GYM'S EVENTS, IN WORDS (spec Part 3 §15.4; ROADMAP 19c-i). Pure. An event's days and
// clock times arrive as the gym's own and are printed as they are, never moved to the
// phone's zone. The member's list and the console's page both read these.

/** "Sat 17 Oct", with its year where that is not the year of `today` (the gym's day). */
export function eventDay(day, today) {
  const year = day.slice(0, 4);
  return typeof today === 'string' && today.slice(0, 4) !== year ? `${dayLabel(day)} ${year}` : dayLabel(day);
}

/** "Sat 17 Oct · 10:00 am – 1:00 pm", or for one that runs past its day
 *  "Sat 17 Oct, 10:00 am – Sun 18 Oct, 4:00 pm". A day in another year says its year. */
export function eventWhen(event, today) {
  const from = clockText(event.startMinute);
  const to = clockText(event.endMinute);
  if (event.startsOn === event.endsOn) return `${eventDay(event.startsOn, today)} · ${from} – ${to}`;
  return `${eventDay(event.startsOn, today)}, ${from} – ${eventDay(event.endsOn, today)}, ${to}`;
}

/** "40 places", "1 place"; null for an event with no limit. */
export function eventPlaces(event) {
  if (event.places === null) return null;
  return event.places === 1 ? '1 place' : `${event.places.toLocaleString('en-GB')} places`;
}

const count = (n) => n.toLocaleString('en-GB');

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** What a member reads about an event's places: "12 of 30 places left", "Full",
 *  "Full · 3 on the waitlist", and with no limit "12 coming". Null where there is nothing
 *  to say: no limit and nobody down for it yet. */
export function eventPlacesLeft(event) {
  const { coming, waiting } = event.going;
  if (event.places === null) return coming === 0 ? null : `${count(coming)} coming`;
  const left = Math.max(0, event.places - coming);
  if (left === 0) return waiting === 0 ? 'Full' : `Full · ${count(waiting)} on the waitlist`;
  return `${count(left)} of ${count(event.places)} ${event.places === 1 ? 'place' : 'places'} left`;
}

/** The member's own line: null when they are not down for it. */
export function eventMine(event) {
  const { mine, can } = event.going;
  if (mine === null) return null;
  if (mine.status === 'coming') return { text: "You're coming", good: true };
  if (can.claim) return { text: 'A place is free for you. Take it before somebody else does.', good: true };
  return { text: mine.waitlistPlace === null ? "You're on the waitlist" : `You're ${ordinal(mine.waitlistPlace)} on the waitlist`, good: false };
}

/** The buttons an event offers this member, in order: `kind` is what the tap sends. */
export function eventActions(event) {
  const { mine, can } = event.going;
  const actions = [];
  if (can.come) actions.push({ kind: 'come', label: "I'm coming", main: true });
  if (can.claim) actions.push({ kind: 'come', label: 'Take the place', main: true });
  if (can.joinWaitlist) actions.push({ kind: 'wait', label: 'Join the waitlist', main: true });
  if (can.cancel) actions.push({ kind: 'cancel', label: mine?.status === 'waitlisted' ? 'Leave the waitlist' : "Can't come", main: false });
  return actions;
}

/** Why there is no button, where the card does not already say (a cancelled event does). */
export function eventWhyNot(event) {
  const { mine, can } = event.going;
  if (can.why === 'waitlist_full') return 'This event and its waitlist are full.';
  if (can.why === 'event_started' && mine === null) return "This event has started, so it's too late to say you're coming.";
  if (mine?.status === 'coming' && !can.cancel && !event.cancelled) return "This event has started, so this can't be changed.";
  return null;
}

/** Under a member's own waitlist line. */
export const WAITLIST_NOTE = "If a place comes free it can go to you. The app doesn't tell you yet, so check back here.";

/** Whether "Can't come" asks first: somebody else would take the place at once. */
export function givingUpAsks(event) {
  const { mine, coming, waiting } = event.going;
  return mine?.status === 'coming' && event.places !== null && (coming >= event.places || waiting > 0);
}

/** Whether it has started and not ended, at `now`. */
export function eventIsOn(event, now) {
  return Date.parse(event.startsAt) <= now && now < Date.parse(event.endsAt);
}

const clockIn = (at, timeZone) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(at));

/** The line that says whose clock the times are on, when this device's differs for any
 *  event listed; null when they agree. */
export function eventsZoneNote(events, gymName, gymZone, deviceZone) {
  const differs = events.some((e) => {
    try {
      return clockIn(e.startsAt, deviceZone) !== clockIn(e.startsAt, gymZone);
    } catch {
      return true;
    }
  });
  if (!differs) return null;
  return `Times are ${gymName} time (${gymZone.replaceAll('_', ' ')}), not this device's.`;
}

/** What a member reads where a gym has nothing coming. */
export const noEvents = (gymName) => `${gymName} has no events coming up.`;
