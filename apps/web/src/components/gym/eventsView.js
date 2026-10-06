import { clockText } from './classesView';
import { dayLabel } from './leaderboardView';

// A GYM'S EVENTS, IN WORDS (spec Part 3 §15.4; ROADMAP 19c-i). Pure. An event's days and
// clock times arrive as the gym's own and are printed as they are, never moved to the
// phone's zone. The member's list and the console's page both read these.

/** "Sat 17 Oct · 10:00 am – 1:00 pm", or for one that runs past its day
 *  "Sat 17 Oct, 10:00 am – Sun 18 Oct, 4:00 pm". */
export function eventWhen(event) {
  const from = clockText(event.startMinute);
  const to = clockText(event.endMinute);
  if (event.startsOn === event.endsOn) return `${dayLabel(event.startsOn)} · ${from} – ${to}`;
  return `${dayLabel(event.startsOn)}, ${from} – ${dayLabel(event.endsOn)}, ${to}`;
}

/** "40 places", "1 place"; null for an event with no limit. */
export function eventPlaces(event) {
  if (event.places === null) return null;
  return event.places === 1 ? '1 place' : `${event.places.toLocaleString('en-GB')} places`;
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
