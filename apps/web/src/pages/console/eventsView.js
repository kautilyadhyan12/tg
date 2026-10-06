import { GYM_EVENT_DETAILS_MAX, GYM_EVENT_MAX_DAYS, GYM_EVENT_NAME_MAX, GYM_EVENT_PLACES_MAX, GYM_EVENT_PLACE_MAX, postLength } from '@app/shared';
import { dayLabel } from '../../components/gym/leaderboardView';

// THE CONSOLE'S EVENTS PAGE, IN WORDS AND RULES (spec Part 3 §15.4; ROADMAP 19c-i). Pure.
// The form's draft, what is wrong with it in a sentence staff can act on, and what is sent.

export const EVENT_LIMITS = { name: GYM_EVENT_NAME_MAX, details: GYM_EVENT_DETAILS_MAX, place: GYM_EVENT_PLACE_MAX, places: GYM_EVENT_PLACES_MAX, days: GYM_EVENT_MAX_DAYS };

const two = (n) => String(n).padStart(2, '0');
/** 600 → "10:00", the time control's own string. */
export const clockOf = (minute) => `${two(Math.floor(minute / 60))}:${two(minute % 60)}`;
/** "10:00" → 600; null while the hour or the minute is still unpicked. */
export function minuteOf(clock) {
  const m = /^(\d{2}):(\d{2})$/.exec(clock ?? '');
  if (m === null) return null;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return minute >= 0 && minute <= 1439 ? minute : null;
}

const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
/** The day `days` after `day`. */
export const dayAfter = (day, days) => new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);

/** An empty form: nothing picked for the gym but "No limit", which is how most events run. */
export function newEventDraft() {
  return { name: '', details: '', place: '', startsOn: '', startTime: '', endsOn: '', endTime: '', places: '', unlimited: true, poster: { kind: 'none' } };
}

/** The form filled in from an event as the server has it. */
export function draftOf(event) {
  return {
    name: event.name,
    details: event.details,
    place: event.place,
    startsOn: event.startsOn,
    startTime: clockOf(event.startMinute),
    endsOn: event.endsOn,
    endTime: clockOf(event.endMinute),
    places: event.places === null ? '' : String(event.places),
    unlimited: event.places === null,
    poster: event.poster === null ? { kind: 'none' } : { kind: 'kept', id: event.poster.id },
  };
}

/** A new start day moves an end day that is unpicked, or before it, to the same day. */
export function withStartDay(draft, day) {
  const endsOn = draft.endsOn === '' || draft.endsOn < day ? day : draft.endsOn;
  return { ...draft, startsOn: day, endsOn };
}

const wholePlaces = (text) => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null);

/** The first thing that stops the form being saved, as `{ field, text }`, or null. */
export function eventProblem(draft) {
  if (draft.name.trim() === '') return { field: 'name', text: 'Give the event a name.' };
  if (postLength(draft.name.trim()) > EVENT_LIMITS.name) return { field: 'name', text: `Keep the name to ${EVENT_LIMITS.name} characters.` };
  if (draft.startsOn === '') return { field: 'startsOn', text: 'Pick the day it starts.' };
  const start = minuteOf(draft.startTime);
  if (start === null) return { field: 'startTime', text: 'Pick the time it starts: the hour and the minute.' };
  if (draft.endsOn === '') return { field: 'endsOn', text: 'Pick the day it ends.' };
  const end = minuteOf(draft.endTime);
  if (end === null) return { field: 'endTime', text: 'Pick the time it ends: the hour and the minute.' };
  const days = dayNumber(draft.endsOn) - dayNumber(draft.startsOn);
  if (days < 0 || (days === 0 && end <= start)) return { field: 'endTime', text: 'The end must be after the start.' };
  if (days > EVENT_LIMITS.days) return { field: 'endsOn', text: `An event can run for ${EVENT_LIMITS.days} days at most.` };
  if (postLength(draft.place.trim()) > EVENT_LIMITS.place) return { field: 'place', text: `Keep the place to ${EVENT_LIMITS.place} characters.` };
  if (!draft.unlimited) {
    const places = wholePlaces(draft.places);
    if (places === null || places < 1 || places > EVENT_LIMITS.places) {
      return { field: 'places', text: `Type how many places there are, from 1 to ${EVENT_LIMITS.places.toLocaleString('en-GB')}, or tick No limit.` };
    }
  }
  if (postLength(draft.details.trim()) > EVENT_LIMITS.details) return { field: 'details', text: `Keep the details to ${EVENT_LIMITS.details.toLocaleString('en-GB')} characters.` };
  return null;
}

/** What is sent for a draft with no problem. `adding`: a new event, which sends a poster
 *  only when one was picked; a change says "leave it" by leaving `poster` out. */
export function fieldsOf(draft, adding) {
  const fields = {
    name: draft.name.trim(),
    details: draft.details.trim(),
    place: draft.place.trim(),
    startsOn: draft.startsOn,
    startMinute: minuteOf(draft.startTime),
    endsOn: draft.endsOn,
    endMinute: minuteOf(draft.endTime),
    places: draft.unlimited ? null : wholePlaces(draft.places),
  };
  if (draft.poster.kind === 'new') return { ...fields, poster: draft.poster.base64 };
  if (draft.poster.kind === 'none' && !adding) return { ...fields, poster: null };
  return fields;
}

/** "1,000 characters left", and whether it is over. */
export function detailsLine(text) {
  const left = EVENT_LIMITS.details - postLength(text.trim());
  if (left >= 0) return { over: false, text: `${left.toLocaleString('en-GB')} characters left` };
  return { over: true, text: `${(-left).toLocaleString('en-GB')} characters too many` };
}

/** Why a picked poster could not be used. */
export function posterProblem(reason) {
  return reason === 'too_big'
    ? "This picture is too big to use, even made smaller. Choose another."
    : "This file isn't a picture we can read. Choose a JPEG, PNG or WebP.";
}

/** The box before an event is cancelled: what happens, and to whom. */
export function cancelBox(event, words) {
  return {
    title: `Cancel ${event.name}?`,
    lines: [
      `Your ${words.people} still see it on their Events list, marked Cancelled, until ${dayLabel(event.endsOn)}.`,
      "Nobody is emailed. You can un-cancel it until then.",
    ],
    yes: 'Cancel event',
    no: 'Keep it',
  };
}

export const EVENT_NOTES = {
  added: (words) => `Event added. Your ${words.people} can see it now.`,
  saved: (words) => `Changes saved. Your ${words.people} see them now.`,
  cancelled: (words) => `Event cancelled. Your ${words.people} see it marked Cancelled.`,
  uncancelled: (words) => `Event un-cancelled. Your ${words.people} see it as on again.`,
};

/** "Past events (3)"; with more than the page lists, "Past events (the newest 50 of 73)". */
export function pastTitle(list) {
  return list.pastTotal > list.past.length ? `Past events (the newest ${list.past.length} of ${list.pastTotal})` : `Past events (${list.pastTotal})`;
}
