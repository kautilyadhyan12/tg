import { PT_SESSIONS_ENDING_ERROR, ptSessionsEndingSchema, ptSessionsEndingWords } from '@app/shared';
import { dayHeading, timeRange } from './classesView';

// PERSONAL TRAINING SESSIONS THAT END WHEN A PERSON LEAVES (spec Part 3 §13.5; ROADMAP
// 17e-iv-a). Removing a person, or cancelling a membership, cancels the coming sessions
// booked for them. Every box that would do it names them first; these are its words.

/** How many sessions a box lists before "See all". */
export const PT_ENDING_FIRST = 3;

/** The sessions the server says removing one person would end (409 `pt_sessions_ending`);
 *  null for any other answer. */
export function ptSessionsAsked(err) {
  const data = err?.response?.data;
  if (data?.error !== PT_SESSIONS_ENDING_ERROR) return null;
  const parsed = ptSessionsEndingSchema.safeParse(data?.sessions);
  return parsed.success ? parsed.data : null;
}

/** One session: the person, then when it is and with whom. `onePerson`: the box is about
 *  one person it has already named, so the line leads with when, then with whom. */
export function ptEndingRow(session, clockFormat, onePerson = false) {
  const when = [dayHeading(session?.localDate ?? ''), timeRange(session?.localStartMinute, session?.minutes, clockFormat)].filter(
    (part) => typeof part === 'string' && part !== '',
  );
  const trainer = typeof session?.trainerName === 'string' && session.trainerName !== '' ? `with ${session.trainerName}` : null;
  if (onePerson) return { id: session.id, name: when.join(' · '), detail: trainer ?? '' };
  return {
    id: session.id,
    name: typeof session?.personName === 'string' && session.personName !== '' ? session.personName : 'No name',
    detail: [...when, ...(trainer === null ? [] : [trainer])].join(' · '),
  };
}

/** Nobody is told by the app yet (the inbox is ROADMAP 20a). */
export const PT_ENDING_NOT_TOLD = "The app doesn't tell them or the trainer yet. Let them know yourself.";

/** Said when the sessions are not the ones the box listed a moment ago: one was booked or
 *  cancelled between the box and its button, and the press did nothing. */
export const PT_ENDING_MOVED = 'The sessions changed while this was open. Check them and press again.';

/** The box's words: what ends, what happens, what stays. */
export function ptEndingWords(ending, clockFormat, onePerson = false) {
  const words = ptSessionsEndingWords(ending);
  const rows = (Array.isArray(ending?.sessions) ? ending.sessions : []).map((session) => ptEndingRow(session, clockFormat, onePerson));
  return {
    title: words.title,
    rows,
    /** The server names a hundred at most; the count is whole. */
    unlisted: Math.max(0, ending.count - rows.length),
    change: [
      ending.count === 1 ? "The trainer's time can be booked again." : "Each trainer's time can be booked again.",
      words.packs,
      'A session that has already started stays as it is.',
    ]
      .filter((line) => line !== null)
      .join(' '),
  };
}

/** "cancel 2 sessions", for a button that goes ahead. */
export function ptEndingAction(ending) {
  return ending.count === 1 ? 'cancel 1 session' : `cancel ${ending.count.toLocaleString('en')} sessions`;
}
