// PERSONAL TRAINING, its words and its form's rules (spec Part 3 §13.5; ROADMAP 17e-i).
// Pure, so the tests read every state without a browser. Every time is the gym's own clock.
import { PT_RANGES_PER_DAY, PT_SESSION_MINUTES, ptHoursProblem } from '@app/shared';
import { WEEKDAYS, clockLabel, clockToMinutes, minutesToClock } from './hoursView';
import { dayLabel } from '../../components/gym/leaderboardView';

export const PT_TITLE = 'Personal training';

/** Until the inbox exists nobody is told by the app (RULINGS 2026-10-05). */
export const NOT_TOLD = "The app doesn't tell them yet. Let them know yourself.";

export const SESSION_LENGTH_CHOICES = PT_SESSION_MINUTES.map((minutes) => ({ value: String(minutes), label: `${String(minutes)} minutes` }));

/** A member of staff's name on this page; the reader's own row says so. */
export function trainerName(trainer) {
  const name = typeof trainer?.name === 'string' && trainer.name.trim() !== '' ? trainer.name : 'A member of staff';
  return trainer?.mine === true ? `${name} (you)` : name;
}

/** Whether somebody has hours that make sessions. */
export function takesSessions(trainer) {
  return trainer?.offers === true && trainer.sessionMinutes !== null && trainer.hours.length > 0;
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

/** Who the page opens on: the trainer named in the address, else the reader's own row
 *  when they take sessions, else the first person who does, else the first row. */
export function pickTrainer(trainers, wantedId) {
  if (!Array.isArray(trainers) || trainers.length === 0) return null;
  return (
    trainers.find((t) => t.userId === wantedId) ??
    trainers.find((t) => t.mine && takesSessions(t)) ??
    trainers.find((t) => takesSessions(t)) ??
    trainers.find((t) => t.mine) ??
    trainers[0]
  );
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
    // Somebody opening the form for the first time is setting themselves up to take sessions.
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
  const ranges = draftRanges(draft);
  if (ranges.some((r) => r.fromMinute === null || r.toMinute === null)) return 'Pick a start and an end time for each set of hours, or remove it.';
  const length = Number(draft.sessionMinutes);
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
  return { offers: draft.offers, sessionMinutes: Number(draft.sessionMinutes), hours: draftRanges(draft) };
}

/** How many sessions a week the form's hours make: "12 sessions a week". */
export function sessionsAWeek(draft) {
  const length = Number(draft.sessionMinutes);
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

/** A session's own line: its time, who it is with, and what it was booked on. */
export function sessionRow(appointment, clockFormat) {
  const time = timeRange(appointment.localStartMinute, appointment.localStartMinute + appointment.minutes, clockFormat);
  const name = appointment.name ?? 'Somebody no longer on your list';
  const paid =
    appointment.membership === null ? '' : appointment.packCharged ? `${appointment.membership} · 1 session used` : appointment.membership;
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
  const who = person === null ? 'Pick who the session is for.' : `${person.fullName} will be booked`;
  if (person === null) return who;
  return `${who} with ${trainerName(trainer)} on ${dayLabel(localDate)}, ${timeRange(startMinute, startMinute + minutes, clockFormat)}.`;
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

/** The member list's search, as its query string; null for nothing typed. */
export function personQuery(text) {
  const typed = typeof text === 'string' ? text.trim() : '';
  return typed === '' ? null : `query=${encodeURIComponent(typed)}`;
}

/** One person found, as the picker lists them: the name and what the list says of them. */
export function personRow(entry) {
  const detail = [entry.membershipType, entry.email].filter((v) => typeof v === 'string' && v.trim() !== '').join(' · ');
  return { name: entry.fullName, detail };
}
