import { CLASS_OVER_SESSIONS_ERROR, classOverSessionsSchema } from '@app/shared';
import { dayHeading, timeRange } from './classesView';

// A CLASS PUT OVER A PERSONAL TRAINING SESSION (spec Part 3 §13.5; ROADMAP 17e-iii-a). A
// class saved with a coach who already has a session booked at that time would have them
// in two places at once. The server answers 409 `class_over_pt_sessions` with the sessions
// until the request sends their number back; these are the words of the box that asks.

/** How many sessions the box lists before "See all". */
export const OVER_SESSIONS_FIRST = 3;

/** The sessions the server says a class would run over; null for any other answer. */
export function sessionsAsked(err) {
  const data = err?.response?.data;
  if (data?.error !== CLASS_OVER_SESSIONS_ERROR) return null;
  const parsed = classOverSessionsSchema.safeParse(data?.sessions);
  return parsed.success && parsed.data.shown.length > 0 ? parsed.data : null;
}

/** The one trainer every listed session is with, or null when there are several (a bulk
 *  edit can change time slots with different coaches) or more sessions than are listed. */
function oneTrainer(sessions) {
  const shown = Array.isArray(sessions?.shown) ? sessions.shown : [];
  if (shown.length === 0 || shown.length < (sessions?.count ?? 0)) return null;
  const names = new Set(shown.map((s) => s.trainerName ?? ''));
  const [only] = names;
  return names.size === 1 && only !== '' ? only : null;
}

export function overTitle(sessions) {
  const n = sessions?.count ?? 0;
  const trainer = oneTrainer(sessions);
  if (trainer === null) {
    return n === 1
      ? 'A personal training session is booked at this time'
      : `${n.toLocaleString('en')} personal training sessions are booked at these times`;
  }
  return n === 1
    ? `${trainer} has a personal training session at this time`
    : `${trainer} has ${n.toLocaleString('en')} personal training sessions at these times`;
}

/** What going ahead does, and to whom. `kind`: 'save' for a form, 'uncancel' for a
 *  cancelled class put back. */
export function overChangeLine(sessions, kind = 'save') {
  const one = (sessions?.count ?? 0) === 1;
  const who = oneTrainer(sessions) ?? 'the coach';
  const start = kind === 'uncancel' ? 'If you un-cancel it, the class goes back on the calendar' : 'If you save, the class goes on the calendar';
  return one
    ? `${start} and this session stays booked, so ${who} would be in two places at once. Move or cancel the session on the Personal training page.`
    : `${start} and these sessions stay booked, so ${who} would be in two places at once. Move or cancel each session on the Personal training page.`;
}

/** Who does not change. */
export function overKeptLine(kind = 'save') {
  return kind === 'uncancel'
    ? "Un-cancelling doesn't cancel anybody's session or take anything off a pack."
    : "Saving doesn't cancel anybody's session or take anything off a pack.";
}

/** The button that goes ahead. */
export function overConfirmLabel(kind = 'save') {
  return kind === 'uncancel' ? 'Un-cancel anyway' : 'Save anyway';
}

/** One session in the box: the person, and when it is. The trainer is named on the line
 *  only where the box's title could not name one. */
export function overSessionLine(session, clockFormat, sessions) {
  const parts = [dayHeading(session?.localDate ?? ''), timeRange(session?.localStartMinute, session?.minutes, clockFormat)];
  if (oneTrainer(sessions) === null && typeof session?.trainerName === 'string' && session.trainerName !== '') {
    parts.push(`with ${session.trainerName}`);
  }
  return {
    name: typeof session?.name === 'string' && session.name !== '' ? session.name : 'No name',
    detail: parts.filter((part) => typeof part === 'string' && part !== '').join(' · '),
  };
}

/** "and 4 more", for the sessions not listed. */
export function overMore(sessions, listed) {
  return Math.max(0, (sessions?.count ?? 0) - listed);
}
