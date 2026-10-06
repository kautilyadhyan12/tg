// PERSONAL TRAINING, its words and its form's rules (spec Part 3 §13.5; ROADMAP 17e-i).
// Pure, so the tests read every state without a browser. Every time is the gym's own clock.
import { PT_RANGES_PER_DAY, PT_SESSION_MINUTES_MAX, PT_SESSION_MINUTES_MIN, PT_SESSION_MINUTES_USUAL, ptHoursProblem } from '@app/shared';
import { WEEKDAYS, clockLabel, clockToMinutes, minutesToClock } from './hoursView';
import { dayLabel } from '../../components/gym/leaderboardView';

export const PT_TITLE = 'Personal training';

/** What the page is for, in one line under its name. */
export const PT_INTRO_MANAGER = 'One-to-one sessions with a trainer. Set when each trainer is free, then book members into their free times.';
export const PT_INTRO_OWN = 'One-to-one sessions. Set when you are free; the sessions booked with you appear below.';

/** Said once beside the hours: they are set once, and the timetable is already counted. */
export const HOURS_REPEAT = 'These hours repeat every week. A class a trainer coaches is taken off their free times by itself.';
export const HOURS_REPEAT_OWN = 'These hours repeat every week. A class you coach is taken off your free times by itself.';

/** The steps a gym that has never used the page reads, in order. The middle one is only
 *  for a gym that sells memberships in the app: with none, anybody on its list is booked. */
export function howItWorks(gymHasTypes) {
  return [
    'Add a trainer and set the hours they are free.',
    ...(gymHasTypes
      ? ['Tick "Includes personal training" on a membership or pack (Settings, then Memberships) and give it to the member on their page.']
      : []),
    "Press one of the trainer's free times and pick the member.",
  ];
}

/** The two ways along the weeks. */
export const PREVIOUS_WEEK = 'Previous week';
export const NEXT_WEEK = 'Next week';

/** Until the inbox exists nobody is told by the app (RULINGS 2026-10-05). */
export const NOT_TOLD = "The app doesn't tell them yet. Let them know yourself.";

/** The lengths offered in one press; any other length is typed. */
export const SESSION_LENGTH_USUAL = PT_SESSION_MINUTES_USUAL.map((minutes) => String(minutes));
export const SESSION_LENGTH_HINT = `Any length from ${String(PT_SESSION_MINUTES_MIN)} to ${String(PT_SESSION_MINUTES_MAX)} minutes, in steps of 5.`;

/** The typed session length as a number the server takes, or null. */
export function sessionLength(text) {
  if (typeof text !== 'string' || !/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= PT_SESSION_MINUTES_MIN && n <= PT_SESSION_MINUTES_MAX && n % 5 === 0 ? n : null;
}

/** A member of staff's name on this page; the reader's own row says so. */
export function trainerName(trainer) {
  const name = typeof trainer?.name === 'string' && trainer.name.trim() !== '' ? trainer.name : 'A member of staff';
  return trainer?.mine === true ? `${name} (you)` : name;
}

/** The staff who are set up to take sessions, and the rest, who can be. */
export function trainerGroups(trainers) {
  const list = Array.isArray(trainers) ? trainers : [];
  return { setUp: list.filter((t) => t.sessionMinutes !== null), others: list.filter((t) => t.sessionMinutes === null) };
}

/** The one line under a trainer's name. */
export function trainerSummary(trainer) {
  if (trainer.sessionMinutes === null) return 'No hours set yet';
  if (trainer.offers !== true) return 'Not taking sessions';
  if (trainer.hours.length === 0) return 'Taking sessions, but no hours set';
  return `${String(trainer.sessionMinutes)}-minute sessions`;
}

/** "16:00 – 20:00" on the gym's clock. */
export function timeRange(fromMinute, toMinute, clockFormat) {
  return `${clockLabel(fromMinute, clockFormat)} – ${clockLabel(toMinute, clockFormat)}`;
}

/** A trainer's hours, one line a weekday that has any: "Monday · 09:00 – 13:00, 16:00 – 20:00". */
export function hoursLines(trainer, clockFormat) {
  return WEEKDAYS.flatMap((day) => {
    const ranges = trainer.hours.filter((h) => h.weekday === day.iso).sort((a, b) => a.fromMinute - b.fromMinute);
    if (ranges.length === 0) return [];
    return [`${day.label} · ${ranges.map((r) => timeRange(r.fromMinute, r.toMinute, clockFormat)).join(', ')}`];
  });
}

/** Whose week the page shows: the trainer named in the address, else the reader when they
 *  are set up, else the first person who is. Nobody where nobody is set up: staff who run
 *  the timetable are shown how to add a trainer, never themselves as one. Somebody who
 *  sees only their own row always gets it. */
export function pickTrainer(trainers, wantedId, canManage) {
  if (!Array.isArray(trainers) || trainers.length === 0) return null;
  if (!canManage) return trainers.find((t) => t.mine) ?? trainers[0];
  const { setUp } = trainerGroups(trainers);
  return setUp.find((t) => t.userId === wantedId) ?? setUp.find((t) => t.mine) ?? setUp[0] ?? null;
}

// ── THE HOURS FORM ──

/** The form for one trainer's hours: a list of ranges a weekday, each end a clock string
 *  ('' until both of its boxes are picked). */
export function hoursDraft(trainer) {
  const days = {};
  for (const day of WEEKDAYS) {
    days[day.iso] = (trainer?.hours ?? [])
      .filter((h) => h.weekday === day.iso)
      .sort((a, b) => a.fromMinute - b.fromMinute)
      .map((h) => ({ from: minutesToClock(h.fromMinute), to: minutesToClock(h.toMinute) }));
  }
  return {
    // Somebody opening the form for the first time is being set up to take sessions.
    offers: trainer?.sessionMinutes === null ? true : trainer?.offers === true,
    sessionMinutes: String(trainer?.sessionMinutes ?? 60),
    days,
  };
}

export function canAddRange(draft, weekday) {
  return (draft.days[weekday] ?? []).length < PT_RANGES_PER_DAY;
}

export function addRange(draft, weekday) {
  return { ...draft, days: { ...draft.days, [weekday]: [...(draft.days[weekday] ?? []), { from: '', to: '' }] } };
}

export function removeRange(draft, weekday, index) {
  return { ...draft, days: { ...draft.days, [weekday]: (draft.days[weekday] ?? []).filter((_, n) => n !== index) } };
}

export function setRange(draft, weekday, index, patch) {
  return {
    ...draft,
    days: { ...draft.days, [weekday]: (draft.days[weekday] ?? []).map((range, n) => (n === index ? { ...range, ...patch } : range)) },
  };
}

function draftRanges(draft) {
  return WEEKDAYS.flatMap((day) =>
    (draft.days[day.iso] ?? []).map((range) => ({ weekday: day.iso, fromMinute: clockToMinutes(range.from), toMinute: clockToMinutes(range.to) })),
  );
}

/** What is wrong with the form in one sentence, or null when it can be saved. */
export function hoursFormProblem(draft) {
  const length = sessionLength(draft.sessionMinutes);
  if (length === null) return `Type how long a session is, in minutes. ${SESSION_LENGTH_HINT}`;
  const ranges = draftRanges(draft);
  if (ranges.some((r) => r.fromMinute === null || r.toMinute === null)) return 'Pick a start and an end time for each set of hours, or remove it.';
  switch (ptHoursProblem(ranges)) {
    case 'range':
      return 'Each set of hours must end after it starts.';
    case 'too_many':
      return `A day can have up to ${String(PT_RANGES_PER_DAY)} sets of hours.`;
    case 'overlap':
      return 'Two sets of hours on the same day overlap.';
    default:
      break;
  }
  const short = ranges.find((r) => r.toMinute - r.fromMinute < length);
  if (short !== undefined) {
    const day = WEEKDAYS.find((d) => d.iso === short.weekday)?.label ?? 'One day';
    return `${day} has hours shorter than one ${String(length)}-minute session. Make them longer, or remove them.`;
  }
  if (draft.offers && ranges.length === 0) return 'Add the hours they train, or untick "Takes personal training sessions".';
  return null;
}

/** The request the form sends. Call only when `hoursFormProblem` is null. */
export function hoursRequest(draft) {
  return { offers: draft.offers, sessionMinutes: sessionLength(draft.sessionMinutes), hours: draftRanges(draft) };
}

/** How many sessions a week the form's hours make: "12 sessions a week". */
export function sessionsAWeek(draft) {
  const length = sessionLength(draft.sessionMinutes);
  if (length === null) return '0 sessions a week';
  const ranges = draftRanges(draft).filter((r) => r.fromMinute !== null && r.toMinute !== null && r.toMinute > r.fromMinute);
  const n = ranges.reduce((sum, r) => sum + Math.floor((r.toMinute - r.fromMinute) / length), 0);
  return n === 1 ? '1 session a week' : `${String(n)} sessions a week`;
}

// ── THE WEEK ──

/** "Wed 7 Oct – Tue 13 Oct" */
export function weekTitle(week) {
  return `${dayLabel(week.from)} – ${dayLabel(week.to)}`;
}

export function canGoEarlier(week) {
  return week.from > week.today;
}

export function canGoLater(week) {
  return week.to < week.lastDay;
}

/** How far ahead the page goes, said under the week: "Sessions can be booked up to Tue 1 Dec." */
export function bookableUntil(week) {
  return `Sessions can be booked up to ${dayLabel(week.lastDay)}.`;
}

/** A class the trainer coaches, as their day lists it: "10:15 – 11:00 · Spin". */
export function coachedClassRow(coached, clockFormat) {
  return `${timeRange(coached.localStartMinute, coached.localStartMinute + coached.minutes, clockFormat)} · ${coached.name}`;
}

/** The class a booked session runs into, if the trainer was given one over it afterwards;
 *  null where there is none. */
export function sessionClash(appointment, classes) {
  const from = appointment.localStartMinute;
  const to = from + appointment.minutes;
  const hit = (Array.isArray(classes) ? classes : []).find((c) => c.localStartMinute < to && from < c.localStartMinute + c.minutes);
  return hit === undefined ? null : `This runs into ${hit.name}, a class they coach at the same time. Move one of them.`;
}

/** "Today · Wed 7 Oct", or the day alone. */
export function dayHeading(localDate, today) {
  return localDate === today ? `Today · ${dayLabel(localDate)}` : dayLabel(localDate);
}

/** Why a trainer's week shows no free times at all, or null when that needs no words. */
export function noTimesNote(week, trainer) {
  if (week.sessionMinutes === null) return `${trainerName(trainer)} has no hours yet. Set their hours to book sessions.`;
  if (!week.offers) return `${trainerName(trainer)} isn't taking sessions. Their booked sessions are still shown.`;
  return null;
}

/** A free time as its button reads: "09:00 – 10:00". */
export function freeTimeLabel(startMinute, minutes, clockFormat) {
  return timeRange(startMinute, startMinute + minutes, clockFormat);
}

/** A session's own line: its time, who it is with, and what it was booked on. */
export function sessionRow(appointment, clockFormat) {
  const time = timeRange(appointment.localStartMinute, appointment.localStartMinute + appointment.minutes, clockFormat);
  const name = appointment.name ?? 'Somebody no longer on your list';
  // A trainer is not sent what the person pays with, only whether a pack's session is used.
  const paid =
    appointment.membership === null
      ? appointment.packCharged
        ? '1 session used from their pack'
        : ''
      : appointment.packCharged
        ? `${appointment.membership} · 1 session used`
        : appointment.membership;
  return { time, name, detail: paid };
}

/** "2 hours", "90 minutes", "1 day". */
export function durationWords(minutes) {
  if (minutes % 1440 === 0 && minutes > 0) return minutes === 1440 ? '1 day' : `${String(minutes / 1440)} days`;
  if (minutes % 60 === 0 && minutes > 0) return minutes === 60 ? '1 hour' : `${String(minutes / 60)} hours`;
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}

/** The box before a booking: who, with whom, when. */
export function bookSentence({ person, trainer, localDate, startMinute, minutes, clockFormat }) {
  if (person === null) return 'Pick who the session is for.';
  return `${person.name} will be booked with ${trainerName(trainer)} on ${dayLabel(localDate)}, ${timeRange(startMinute, startMinute + minutes, clockFormat)}.`;
}

/** What booking this person costs them, said before the button. */
export function bookCost(person) {
  if (person?.pt === null || person?.pt === undefined) return '';
  return person.pt.sessionsLeft === null ? `It is booked on ${person.pt.membership}.` : `One session is used from ${person.pt.membership}.`;
}

/** The box before a cancel: what it costs the person, and the buttons that say so. */
export function cancelBox(appointment, { freeCancelMinutes, clockFormat }) {
  const row = sessionRow(appointment, clockFormat);
  const what = `${row.name}'s session on ${dayLabel(appointment.localDate)}, ${row.time}`;
  if (appointment.cancel === 'free') {
    return {
      question: appointment.packCharged
        ? `Cancel ${what}? It's free to cancel, and their pack gets the session back.`
        : `Cancel ${what}? It's free to cancel.`,
      choices: [{ key: 'free', label: 'Cancel session', lateOk: false, giveBack: false }],
    };
  }
  const inside = freeCancelMinutes > 0 ? `It starts in less than ${durationWords(freeCancelMinutes)}, so it's too late to cancel for free.` : "It's too late to cancel for free.";
  if (!appointment.packCharged) {
    return {
      question: `Cancel ${what}? ${inside} It will be recorded as a late cancel.`,
      choices: [{ key: 'late', label: 'Cancel session', lateOk: true, giveBack: false }],
    };
  }
  return {
    question: `Cancel ${what}? ${inside} Choose what happens to the session on their pack.`,
    choices: [
      { key: 'late', label: 'Late cancel: the session stays used', lateOk: true, giveBack: false },
      { key: 'back', label: 'Cancel and give the session back', lateOk: true, giveBack: true },
    ],
  };
}

/** One person in the picker: their name, what they hold that pays for a session, and
 *  whether they can be picked. Where the gym sells memberships, somebody holding nothing
 *  that includes personal training cannot be booked, and the row says so. */
export function personRow(person, gymHasTypes) {
  if (person.pt === null) {
    return gymHasTypes
      ? { name: person.name, detail: 'No membership that includes personal training', pickable: false }
      : { name: person.name, detail: '', pickable: true };
  }
  const left = person.pt.sessionsLeft;
  const sessions = left === null ? '' : left === 1 ? ' · 1 session left' : ` · ${String(left)} sessions left`;
  return { name: person.name, detail: `${person.pt.membership}${sessions}`, pickable: true };
}

/** What the picker says above its list. */
export function peopleHeading(people, typed) {
  if (typed.trim() !== '') return people.people.length === 0 ? 'Nobody on your member list matches.' : 'Matching people';
  if (people.people.length === 0) return 'Your member list is empty. Add people on Members first.';
  return people.gymHasTypes ? 'Your members, people with personal training first' : 'Your members';
}
