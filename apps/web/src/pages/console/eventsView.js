import { GYM_EVENT_DETAILS_MAX, GYM_EVENT_MAX_DAYS, GYM_EVENT_NAME_MAX, GYM_EVENT_PLACES_MAX, GYM_EVENT_PLACE_MAX, eventNameIsSeen, postLength } from '@app/shared';
import { eventDay } from '../../components/gym/eventsView';

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
  if (!eventNameIsSeen(draft.name)) return { field: 'name', text: 'Give the event a name.' };
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

const count = (n) => n.toLocaleString('en-GB');
const peopleCount = (n) => (n === 1 ? '1 person' : `${count(n)} people`);

/** The card's places line: "40 places · 12 coming · 3 on the waitlist", "40 places · full",
 *  "No limit on places · 12 coming"; for an event that has ended, how many had said so.
 *  Nothing is said of people until somebody is down for it. */
export function eventTaken(event, past = false) {
  const places = event.places === null ? 'No limit on places' : event.places === 1 ? '1 place' : `${count(event.places)} places`;
  const parts = [places];
  if (past) {
    if (event.coming > 0) parts.push(`${peopleCount(event.coming)} said they were coming`);
    return parts.join(' · ');
  }
  if (event.coming > 0) parts.push(event.places !== null && event.coming >= event.places ? 'full' : `${count(event.coming)} coming`);
  if (event.waiting > 0) parts.push(`${count(event.waiting)} on the waitlist`);
  return parts.join(' · ');
}

/** How many people are down for an event, coming or waiting. */
export const eventPeopleCount = (event) => event.coming + event.waiting;

/** "Ann Smith, Bea Jones, Cal Brown and 9 more"; a person with no name yet is counted,
 *  never named. Null with nobody. */
export function namesLine(people, total) {
  const named = people.map((p) => p.name).filter((name) => name !== null).slice(0, 3);
  if (total === 0) return null;
  if (named.length === 0) return peopleCount(total);
  const more = total - named.length;
  return more > 0 ? `${named.join(', ')} and ${count(more)} more` : named.join(', ');
}

/** The box before an event is cancelled: what happens, and to whom. `people`: who is
 *  coming and waiting, once read; null until then, and the counts stand in. */
export function cancelBox(event, words, today, people = null) {
  const lines = [`Your ${words.people} still see it on their Events list, marked Cancelled, until ${eventDay(event.endsOn, today)}.`];
  const coming = event.coming ?? 0;
  const waiting = event.waiting ?? 0;
  if (coming > 0) {
    const names = people === null ? null : namesLine(people.coming, coming);
    lines.push(`${peopleCount(coming)} said they're coming${names === null || names === peopleCount(coming) ? '' : `: ${names}`}.`);
  }
  if (waiting > 0) lines.push(`${peopleCount(waiting)} ${waiting === 1 ? 'is' : 'are'} on the waitlist.`);
  if (coming + waiting > 0) {
    lines.push("The app doesn't tell them yet, so let them know yourself. They keep their places if you un-cancel.");
  }
  lines.push('Nobody is emailed. You can un-cancel it until then.');
  return { title: `Cancel ${event.name}?`, lines, yes: 'Cancel event', no: 'Keep it' };
}

/** "Coming (12 of 40)", "Coming (12)", "Waitlist (3), first in line first". */
export function peopleHeading(kind, people) {
  if (kind === 'waiting') return `Waitlist (${count(people.waitingTotal)}), first in line first`;
  return people.places === null ? `Coming (${count(people.comingTotal)})` : `Coming (${count(people.comingTotal)} of ${count(people.places)})`;
}

/** The box before staff take one person off an event. */
export function removeBox(person, event, waitingTotal, words) {
  const name = person.name ?? 'this person';
  const lines = ["The app doesn't tell them yet, so let them know yourself. They can say they're coming again."];
  if (waitingTotal > 0) lines.unshift(`If they had a place, it goes to the next of your ${words.people} on the waitlist.`);
  return { title: `Remove ${name} from ${event.name}?`, lines, yes: 'Remove', no: 'Keep them' };
}

/** Under the form's Places box while people are coming; null with nobody. */
export function placesHint(event) {
  if (event === null || event.coming === 0) return null;
  return `${peopleCount(event.coming)} ${event.coming === 1 ? 'is' : 'are'} coming, so places can't be fewer than ${count(event.coming)}.`;
}

/** Under the form's buttons while people are down for the event; null with nobody. */
export function changeHint(event) {
  if (event === null || event.coming + event.waiting === 0) return null;
  return "People have said they're coming. The app doesn't tell them about changes yet, so let them know yourself.";
}

/** The box before a past event's poster is taken off. */
export function posterBox(event) {
  return { title: `Remove the poster from ${event.name}?`, lines: ["The picture is deleted and can't be brought back. The rest of the event stays as it is."], yes: 'Remove poster', no: 'Keep it' };
}

/** Whether the event the server kept is the one this form holds: a save whose reply was
 *  lost and whose form was then changed is answered with the first one. */
export function sameAsSent(event, fields) {
  return ['name', 'details', 'place', 'startsOn', 'startMinute', 'endsOn', 'endMinute', 'places'].every((key) => event[key] === fields[key]);
}

export const EVENT_NOTES = {
  posterRemoved: 'Poster removed.',
  added: (words) => `Event added. Your ${words.people} can see it now.`,
  saved: (words) => `Changes saved. Your ${words.people} see them now.`,
  cancelled: (words) => `Event cancelled. Your ${words.people} see it marked Cancelled.`,
  uncancelled: (words) => `Event un-cancelled. Your ${words.people} see it as on again.`,
};

/** "Past events (3)"; with more than the page lists, "Past events (the newest 50 of 73)". */
export function pastTitle(list) {
  return list.pastTotal > list.past.length ? `Past events (the newest ${list.past.length} of ${list.pastTotal})` : `Past events (${list.pastTotal})`;
}
