// PERSONAL TRAINING, its words and its form's rules (spec Part 3 §13.5; ROADMAP 17e-i).
// Pure, so the tests read every state without a browser. Every time is the gym's own clock.
import {
  PT_RANGES_PER_DAY,
  PT_SESSION_MINUTES_MAX,
  PT_SESSION_MINUTES_MIN,
  PT_SESSION_MINUTES_USUAL,
  PT_TIME_OFF_AHEAD_DAYS,
  PT_TIME_OFF_DAYS_MAX,
  PT_TIME_OFF_MAX,
  PT_TIME_OFF_OVER_ERROR,
  orgWords,
  ptHoursProblem,
  ptTimeOffOverSchema,
  ptTimeOffProblem,
} from '@app/shared';
import { WEEKDAYS, addDays, clockLabel, clockToMinutes, minutesToClock } from './hoursView';
import { dayLabel } from '../../components/gym/leaderboardView';
import { placeFor } from './consolePlaces';

export const PT_TITLE = 'Personal training';

/** What the page is for, in one line under its name. */
export const PT_INTRO_MANAGER = 'One-to-one sessions with a trainer. Set when each trainer is available, then book members into their available times.';
export const PT_INTRO_OWN = 'One-to-one sessions. Set when you are available; the sessions booked with you appear below.';

/** Said once beside the hours: they are set once, and the timetable is already counted. */
export const HOURS_REPEAT = 'These hours repeat every week. A class a trainer coaches is taken off their available times by itself.';
export const HOURS_REPEAT_OWN = 'These hours repeat every week. A class you coach is taken off your available times by itself.';

/** EVERY STEP TO A FIRST SESSION, each with a tick once it is done and a button that opens
 *  the place it is done in (ROADMAP 23d). For whoever runs the timetable.
 *
 *  A gym that sells memberships in the app needs one that includes personal training and
 *  somebody holding it; a gym that sells none books anybody on its list. The server says
 *  which steps are done (`list.setup`), each from this gym's own rows; a trainer who is
 *  taking sessions and has hours is read from the list on screen, since nobody can be
 *  booked with one who is not. A button is offered only to somebody who can open its
 *  place: anybody else reads who can.
 *
 *  `show` is false once every step is done, for anybody who does not run the timetable,
 *  and where the server sent no steps. */
export function setupSteps(list, { orgSlug, privileges, orgType } = {}) {
  const none = { show: false, rows: [], doneCount: 0, total: 0 };
  const setup = list?.setup;
  if (list?.canManage !== true || setup === null || typeof setup !== 'object') return none;
  const words = orgWords(orgType);
  const to = (place) => placeFor(orgSlug, privileges, place);
  const inviteTo = to('inviteStaff');
  const membershipsTo = to('memberships');
  const membersTo = to('members');
  const openMembers = membersTo === null ? null : { label: `Open ${words.peopleCap}`, to: membersTo };

  const steps = [
    {
      key: 'trainer',
      done: trainerGroups(list.trainers).setUp.some((t) => t.offers === true && Array.isArray(t.hours) && t.hours.length > 0),
      title: 'Add a trainer and set their hours',
      line:
        inviteTo === null
          ? 'Pick somebody on your staff under Add a trainer, and set the hours they are available. The owner can invite somebody who is not on your staff yet.'
          : 'Pick somebody on your staff under Add a trainer, and set the hours they are available. Invite anybody who is not on your staff yet.',
      // Inviting changes the gym, so a gym with no live plan gets it greyed.
      action: inviteTo === null ? null : { label: 'Invite staff', to: inviteTo, changes: true },
    },
    ...(list.gymHasTypes === true
      ? [
          {
            key: 'type',
            done: setup.typeIncludesPt === true,
            title: 'Sell a membership or pack that includes personal training',
            line:
              membershipsTo === null
                ? 'Ask the owner to tick "Includes personal training" on a membership or pack you sell. A session is booked on it.'
                : 'On Memberships, tick "Includes personal training" on a membership or pack you sell. A session is booked on it.',
            action: membershipsTo === null ? null : { label: 'Open Memberships', to: membershipsTo },
          },
          {
            key: 'held',
            done: setup.somebodyHoldsIt === true,
            title: `Give it to a ${words.person}`,
            line: `Open the person on ${words.peopleCap} and press Add membership. They can then be booked.`,
            action: openMembers,
          },
        ]
      : [
          {
            key: 'people',
            done: setup.listHasPeople === true,
            title: `Put your ${words.people} on your list`,
            line: `Anybody on your ${words.person} list can be booked. Import your list, or add people one at a time.`,
            action: openMembers,
          },
        ]),
    {
      key: 'book',
      done: setup.sessionBooked === true,
      title: 'Book a session',
      line: "Press one of a trainer's available times below, and pick the person.",
      action: null,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return none;
  // The step to do next: the first one not done.
  const next = steps.find((s) => !s.done)?.key ?? null;
  return { show: true, rows: steps.map((s) => ({ ...s, next: s.key === next })), doneCount, total: steps.length };
}

/** "2 of 4 done". */
export function setupCount(view) {
  return `${String(view.doneCount)} of ${String(view.total)} done`;
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
export function sessionClash(appointment, classes, timeOff, canBook = true) {
  const from = appointment.localStartMinute;
  const to = from + appointment.minutes;
  const hit = (Array.isArray(classes) ? classes : []).find((c) => c.localStartMinute < to && from < c.localStartMinute + c.minutes);
  // Time off is said first: the trainer is not there at all, whatever else is at that time.
  if (inTimeOff(from, to, timeOff)) {
    return `This is in their time off. Cancel it and ${canBook ? 'book another time' : 'ask a manager to book another time'}, or remove the time off.`;
  }
  return hit === undefined ? null : `This runs into ${hit.name}, a class they coach at the same time. Move one of them.`;
}

// ── TIME OFF (17e-iii-b) ──

/** Whether a stretch of one day (minutes from midnight) runs into that day's time off. */
function inTimeOff(from, to, timeOff) {
  return (Array.isArray(timeOff) ? timeOff : []).some((o) => o.fromMinute === null || o.toMinute === null || (o.fromMinute < to && from < o.toMinute));
}

/** A class the trainer coaches inside their time off says so; null otherwise. Somebody who
 *  runs the timetable gets a button to the Calendar under it; anybody else reads who can. */
export function classInTimeOff(coached, timeOff, opensCalendar = true) {
  if (!inTimeOff(coached.localStartMinute, coached.localStartMinute + coached.minutes, timeOff)) return null;
  return opensCalendar
    ? 'In their time off. Give this class another coach on the Calendar.'
    : 'In their time off. Whoever runs the timetable can give this class another coach.';
}

/** Time off on one day of the week: "Time off · all day", "Time off · 09:00 – 12:00". */
export function dayTimeOffRow(off, clockFormat) {
  return off.fromMinute === null || off.toMinute === null ? 'Time off · all day' : `Time off · ${timeRange(off.fromMinute, off.toMinute, clockFormat)}`;
}

/** A day with its year where that is not this year's: "Fri 9 Oct", "Mon 4 Jan 2027". */
function dayWithYear(day, today) {
  return typeof today === 'string' && day.slice(0, 4) !== today.slice(0, 4) ? `${dayLabel(day)} ${day.slice(0, 4)}` : dayLabel(day);
}

/** One time off in a list: "Fri 9 Oct · all day", "Mon 12 Oct – Fri 16 Oct · all day",
 *  "Fri 9 Oct · 09:00 – 12:00". */
export function timeOffLine(off, clockFormat, today) {
  if (off.fromMinute !== null && off.toMinute !== null) return `${dayWithYear(off.fromDate, today)} · ${timeRange(off.fromMinute, off.toMinute, clockFormat)}`;
  if (off.fromDate === off.toDate) return `${dayWithYear(off.fromDate, today)} · all day`;
  return `${dayWithYear(off.fromDate, today)} – ${dayWithYear(off.toDate, today)} · all day`;
}

/** The line under a trainer's hours: their next time off and how many more; null with none. */
export function timeOffSummary(trainer, clockFormat, today) {
  const list = Array.isArray(trainer?.timeOff) ? trainer.timeOff : [];
  const [next] = list;
  if (next === undefined) return null;
  const more = list.length - 1;
  return `Time off: ${timeOffLine(next, clockFormat, today)}${more > 0 ? `, and ${String(more)} more` : ''}`;
}

export const TIME_OFF_INTRO = 'A holiday, a day away or a few hours. No session can be booked in it. The weekly hours stay as they are.';

/** The form for one new time off. `kind`: 'days' for whole days, 'hours' for part of one day. */
export function timeOffDraft() {
  return { kind: 'days', fromDate: '', toDate: '', from: '', to: '' };
}

/** The days the two calendars offer: the first day from today to a year on; the last day
 *  from the first day picked to a year after it. */
export function timeOffDayLimits(today, fromDate) {
  const first = typeof fromDate === 'string' && fromDate !== '' ? fromDate : today;
  return { min: today, max: addDays(today, PT_TIME_OFF_AHEAD_DAYS), lastMin: first, lastMax: addDays(first, PT_TIME_OFF_DAYS_MAX - 1) };
}

/** Whether two times off share any time: days in common, and on a shared day either is
 *  the whole day or their hours cross. */
export function timeOffOverlap(a, b) {
  if (a.fromDate > b.toDate || b.fromDate > a.toDate) return false;
  const whole = (o) => o.fromMinute === null || o.toMinute === null;
  return whole(a) || whole(b) || (a.fromMinute < b.toMinute && b.fromMinute < a.toMinute);
}

/** The box before a time off is removed: which one, what removing does, and what stays.
 *  Where another time off of theirs covers some of the same time, it says that one stays
 *  and promises nothing about booking. */
export function timeOffRemoveBox(off, trainer, clockFormat, today) {
  const who = trainerName(trainer);
  const others = (Array.isArray(trainer?.timeOff) ? trainer.timeOff : []).filter((o) => o.id !== off.id);
  return {
    question: `Remove ${who}'s time off on ${timeOffLine(off, clockFormat, today)}?`,
    after: others.some((o) => timeOffOverlap(o, off))
      ? `${who} has other time off in these times, and that stays. Nothing that is booked changes.`
      : `These times go back to ${who}'s usual hours, so sessions can be booked in them again. Nothing that is booked changes.`,
  };
}

function draftSpan(draft) {
  const whole = draft.kind === 'days';
  return {
    fromDate: draft.fromDate,
    toDate: whole ? draft.toDate : draft.fromDate,
    fromMinute: whole ? null : clockToMinutes(draft.from),
    toMinute: whole ? null : clockToMinutes(draft.to),
  };
}

/** What is wrong with the form in one sentence, or null when it can be added. */
export function timeOffFormProblem(draft, today, coming = 0) {
  const whole = draft.kind === 'days';
  if (coming >= PT_TIME_OFF_MAX) return `A trainer can have up to ${String(PT_TIME_OFF_MAX)} times off coming. Remove one first.`;
  if (draft.fromDate === '' || (whole && draft.toDate === '')) return whole ? 'Pick the first and the last day.' : 'Pick the day.';
  const span = draftSpan(draft);
  if (!whole && (span.fromMinute === null || span.toMinute === null)) return 'Pick a start and an end time.';
  switch (ptTimeOffProblem(span)) {
    case 'order':
      return 'The last day is before the first day.';
    case 'range':
      return 'The end time must be after the start time.';
    case 'too_long':
      return 'Time off can be up to a year long.';
    case null:
      break;
    default:
      return "That isn't a day on the calendar.";
  }
  if (span.toDate < today) return 'That day has already passed.';
  if (span.fromDate > addDays(today, PT_TIME_OFF_AHEAD_DAYS)) return 'Time off can start up to a year ahead.';
  return null;
}

/** The request the form sends. Call only when `timeOffFormProblem` is null. */
export function timeOffRequest(draft, requestKey, confirm) {
  return { requestKey, ...draftSpan(draft), ...(typeof confirm === 'string' ? { confirm } : {}) };
}

/** The sessions and classes the server says are in the time off; null for any other answer. */
export function timeOffAsked(err) {
  const data = err?.response?.data;
  if (data?.error !== PT_TIME_OFF_OVER_ERROR) return null;
  const parsed = ptTimeOffOverSchema.safeParse(data?.over);
  return parsed.success && parsed.data.sessions.count + parsed.data.classes.count > 0 ? parsed.data : null;
}

/** How many of each the box lists before "See all". */
export const TIME_OFF_BOX_FIRST = 3;

const counted = (n, one, many) => (n === 1 ? `1 ${one}` : `${n.toLocaleString('en')} ${many}`);

/** "Sam Reed has 2 sessions booked and coaches 1 class in this time" */
export function timeOffBoxTitle(over, trainer) {
  const who = trainerName(trainer);
  const s = over.sessions.count;
  const c = over.classes.count;
  const sessions = `${counted(s, 'session', 'sessions')} booked`;
  const classes = counted(c, 'class', 'classes');
  if (s > 0 && c > 0) return `${who} has ${sessions} and coaches ${classes} in this time`;
  return s > 0 ? `${who} has ${sessions} in this time` : `${who} coaches ${classes} in this time`;
}

/** One session or class in the box: who or what, and when. */
export function timeOffBoxRow(row, clockFormat, today, kind) {
  const fallback = kind === 'session' ? 'Somebody no longer on your list' : 'A class';
  return {
    name: typeof row.name === 'string' && row.name !== '' ? row.name : fallback,
    detail: `${dayWithYear(row.localDate, today)} · ${timeRange(row.localStartMinute, row.localStartMinute + row.minutes, clockFormat)}`,
  };
}

/** What adding it does, and who does not change. `opensCalendar`: the reader runs the
 *  timetable, so the box puts a button to the Calendar under these lines. */
export function timeOffBoxLines(over, trainer, draft, canBook = true, opensCalendar = true) {
  const who = trainerName(trainer);
  const lines = [`If you add this time off, no new session can be booked with ${who} in it.`];
  if (over.sessions.count > 0) {
    lines.push(
      `${over.sessions.count === 1 ? 'This session stays' : 'These sessions stay'} booked: nobody is cancelled and nothing comes off or goes back on a pack. To move one, cancel it on this page and ${canBook ? 'book another time' : 'ask a manager to book another time'}.`,
    );
  }
  if (over.classes.count > 0) {
    lines.push(
      `${over.classes.count === 1 ? 'This class stays' : 'These classes stay'} on the calendar with ${who} as coach. ${
        opensCalendar ? 'To change the coach, open the class on the Calendar.' : 'Whoever runs the timetable can change the coach.'
      }`,
    );
  }
  const last = draft.kind === 'days' ? draft.toDate : draft.fromDate;
  if (typeof last === 'string' && last > over.classesUpTo) {
    lines.push(`Classes after ${dayLabel(over.classesUpTo)} aren't on the calendar yet, so they aren't listed here. ${who}'s week will mark them when they are.`);
  }
  return lines;
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

/** "3 of 4 sessions left that week": what is left of a membership's limit in the week or
 *  the month of the session being booked, before this booking. */
export function limitLeft(limit) {
  if (limit.left === 0) return `no sessions left that ${limit.period}`;
  return `${String(limit.left)} of ${String(limit.limit)} ${limit.limit === 1 ? 'session' : 'sessions'} left that ${limit.period}`;
}

/** What booking this person costs them, said before the button. */
export function bookCost(person) {
  if (person?.pt === null || person?.pt === undefined) return '';
  const limit = person.limit ?? null;
  // A pack pays because the membership's own sessions for that week or month are used.
  if (person.pt.sessionsLeft !== null) {
    const why = limit === null ? '' : ` ${limit.membership}'s sessions for that ${limit.period} are used.`;
    return `One session is used from ${person.pt.membership}.${why}`;
  }
  return limit === null
    ? `It is booked on ${person.pt.membership}.`
    : `It is booked on ${person.pt.membership}, which includes ${String(limit.limit)} a ${limit.period}: ${limitLeft(limit)}, before this one.`;
}

/** The box before a cancel: what it costs the person, and the buttons that say so. */
export function cancelBox(appointment, { freeCancelMinutes, clockFormat }) {
  const row = sessionRow(appointment, clockFormat);
  const what = `${row.name}'s session on ${dayLabel(appointment.localDate)}, ${row.time}`;
  if (appointment.cancel === 'free') {
    return {
      question: appointment.packCharged
        ? `Cancel ${what}? It's free to cancel, and their pack gets the session back.`
        : appointment.usesLimit === true
          ? `Cancel ${what}? It's free to cancel, and it no longer counts as one of the sessions their membership includes.`
          : `Cancel ${what}? It's free to cancel.`,
      choices: [{ key: 'free', label: 'Cancel session', lateOk: false, giveBack: false }],
    };
  }
  const inside = freeCancelMinutes > 0 ? `It starts in less than ${durationWords(freeCancelMinutes)}, so it's too late to cancel for free.` : "It's too late to cancel for free.";
  // A session that counts against a membership's limit is staff's to keep used or give
  // back, as a pack's is: the gym may be the one calling it off.
  if (!appointment.packCharged && appointment.usesLimit === true) {
    return {
      question: `Cancel ${what}? ${inside} Choose whether it still counts as one of the sessions their membership includes.`,
      choices: [
        { key: 'late', label: 'Late cancel: the session stays used', lateOk: true, giveBack: false },
        { key: 'back', label: 'Cancel and give the session back', lateOk: true, giveBack: true },
      ],
    };
  }
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
 *  that includes personal training cannot be booked, and the row says so; so does somebody
 *  whose membership's sessions for that week or month are used. */
export function personRow(person, gymHasTypes) {
  const limit = person.limit ?? null;
  if (person.pt === null && limit !== null) {
    return { name: person.name, detail: `${limit.membership} · ${limitLeft(limit)}`, pickable: false };
  }
  if (person.pt === null) {
    return gymHasTypes
      ? { name: person.name, detail: 'No membership that includes personal training', pickable: false }
      : { name: person.name, detail: '', pickable: true };
  }
  const left = person.pt.sessionsLeft;
  const sessions = left === null ? (limit === null ? '' : ` · ${limitLeft(limit)}`) : left === 1 ? ' · 1 session left' : ` · ${String(left)} sessions left`;
  return { name: person.name, detail: `${person.pt.membership}${sessions}`, pickable: true };
}

/** What the picker says above its list. An empty list names the page people are added on,
 *  by the name this kind of organisation's menu gives it; the box puts a button to it under
 *  the line (`pickerIsEmpty`). */
export function peopleHeading(people, typed, orgType) {
  if (typed.trim() !== '') return people.people.length === 0 ? 'Nobody on your member list matches.' : 'Matching people';
  if (people.people.length === 0) return `Your member list is empty. Add people on ${orgWords(orgType).peopleCap} first.`;
  return people.gymHasTypes ? 'Your members, people with personal training first' : 'Your members';
}

/** The picker has nobody to list at all, with nothing typed. */
export function pickerIsEmpty(people, typed) {
  return typed.trim() === '' && Array.isArray(people?.people) && people.people.length === 0;
}
