// STAFF CHECK-IN AND THE LIVE LOG, the pure half (Attendance; ROADMAP 16b-ii).
import { CHECKIN_LOG_LIMIT } from '@app/shared';

/** Whether this person may check people in from the console. */
export function canCheckPeopleIn(privileges) {
  return Array.isArray(privileges) && privileges.includes('attendance.mark');
}

const byNewest = (a, b) => (a.markedAt === b.markedAt ? (a.id < b.id ? 1 : -1) : a.markedAt < b.markedAt ? 1 : -1);

/** The log held on screen and what a poll brought, each visit once, newest first, at most
 *  the server's page. A poll asks from a little before the newest it has, so it can bring
 *  back a visit already shown. */
export function mergeLog(held, incoming) {
  const seen = new Map();
  for (const visit of [...(Array.isArray(held) ? held : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (typeof visit?.id === 'string') seen.set(visit.id, visit);
  }
  return [...seen.values()].sort(byNewest).slice(0, CHECKIN_LOG_LIMIT);
}

/** What the next poll asks from: the newest visit held, or null for the whole of today. */
export function newestAt(visits) {
  let newest = null;
  for (const visit of Array.isArray(visits) ? visits : []) {
    if (typeof visit?.markedAt === 'string' && (newest === null || visit.markedAt > newest)) newest = visit.markedAt;
  }
  return newest;
}

/** How a visit was made, in the words a front desk uses, with the desk's or the staff
 *  member's name. */
export function howLine(visit) {
  const by = typeof visit?.by === 'string' && visit.by.trim() !== '' ? visit.by.trim() : null;
  switch (visit?.method) {
    case 'pass':
      return by === null ? 'Pass' : `Pass · ${by}`;
    case 'key_tag':
      return by === null ? 'Key tag' : `Key tag · ${by}`;
    case 'staff':
      return by === null ? 'Checked in by staff' : `Checked in by ${by}`;
    case 'manual':
    case 'qr':
      return 'From the member app';
    default:
      return '';
  }
}

/** A person's status and payment words, as the Members list has them: what they hold in
 *  the app ("Active · Payment due"), or the gym's own words for somebody who holds
 *  nothing there. Empty when there is neither, or the reader is not sent them. */
export function wordsLine(words) {
  return [words?.status, words?.payment]
    .filter((word) => typeof word === 'string' && word.trim() !== '')
    .map((word) => word.trim())
    .join(' · ');
}

/** A found person's second line: member number and email, whichever the gym has. */
export function foundDetails(person) {
  const parts = [];
  if (typeof person?.memberNumber === 'string' && person.memberNumber.trim() !== '') parts.push(`No. ${person.memberNumber.trim()}`);
  if (typeof person?.email === 'string' && person.email.trim() !== '') parts.push(person.email.trim());
  return parts.join(' · ');
}

/** A found person's key on screen: their record, or their app account. */
export function pickKey(pick) {
  if (typeof pick?.entryId === 'string') return `entry:${pick.entryId}`;
  if (typeof pick?.userId === 'string') return `user:${pick.userId}`;
  return '';
}

/** A person on the day list: their account, or their record when they have no app. */
export function personKey(person) {
  return person?.userId ?? person?.entryId ?? '';
}
