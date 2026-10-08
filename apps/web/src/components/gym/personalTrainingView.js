import { PT_MEMBER_LATE_CANCEL, PT_MEMBER_LATE_CANCEL_PACK, PT_MEMBER_WORDS, PT_NOT_ON_LIST_WORDS } from '@app/shared';
import { clockText, dayHeading, instantText } from './classesView';
import { dayLabel } from './leaderboardView';

// A MEMBER'S PERSONAL TRAINING, IN WORDS (spec Part 3 §13.5; ROADMAP 17e-ii). Pure. A day
// and a clock time arrive as the gym's own and are printed as they are, never moved to the
// phone's zone.

/** "10:00 am – 11:00 am": a whole session. */
export function sessionSpan(startMinute, minutes) {
  return `${clockText(startMinute)} – ${clockText((startMinute + minutes) % 1440)}`;
}

/** "Sam Trainer", or "a trainer" for one who has typed no name. */
export const trainerText = (name) => name ?? 'a trainer';

/** What a booking on a day would use, or why it cannot be made; null where the gym sells
 *  no memberships and there is nothing to say. */
export function payText(view, day) {
  if (!view.onList) return { text: PT_NOT_ON_LIST_WORDS, can: false };
  if (day.why !== null) return { text: PT_MEMBER_WORDS[day.why], can: false };
  const pays = day.pays;
  if (pays === null) return { text: PT_MEMBER_WORDS.no_membership, can: false };
  if (pays.membership === null) return null;
  if (pays.sessionsLeft === null) return { text: `Included in your membership: ${pays.membership}.`, can: true };
  const left = pays.sessionsLeft === 1 ? '1 session left' : `${pays.sessionsLeft} sessions left`;
  return { text: `A booking uses 1 session from your pack: ${pays.membership} · ${left}.`, can: true };
}

const samePay = (a, b) => (a === null || b === null ? a === b : a.text === b.text);

/** Each trainer with the days they have times on, and the page's lines about paying: one
 *  at the top (the first day's), and one under any day that differs from it. */
export function ptPage(view) {
  const dayPay = new Map(view.days.map((d) => [d.localDate, payText(view, d)]));
  const first = view.days[0];
  const top = first === undefined ? null : dayPay.get(first.localDate);
  const heading = (day) => dayHeading(day, view.from === view.today ? view.today : null);
  return {
    top,
    trainers: view.trainers.map((t) => ({
      trainerId: t.trainerId,
      name: trainerText(t.name),
      lengthText: `${t.sessionMinutes} min sessions`,
      sessionMinutes: t.sessionMinutes,
      days: t.days
        .filter((d) => d.free.length > 0)
        .map((d) => {
          const pay = dayPay.get(d.localDate) ?? null;
          return {
            localDate: d.localDate,
            heading: heading(d.localDate),
            // A day nothing pays for shows its times, and none of them is a button.
            can: pay === null || pay.can,
            note: samePay(pay, top) ? null : (pay?.text ?? null),
            times: d.free.map((minute) => ({ minute, text: sessionSpan(minute, t.sessionMinutes) })),
          };
        }),
    })),
  };
}

/** The line where a week holds no time anybody can press, or null. */
export function emptyText(view, gymName) {
  if (view.trainers.length === 0) return `${gymName} has no trainers taking personal training sessions yet.`;
  if (view.from > view.lastDay) return `Booking for these days isn't open yet. You can book up to ${dayLabel(view.lastDay)}.`;
  return null;
}

/** "Fri 9 Oct · 10:00 am – 11:00 am · with Sam Trainer" */
export function sessionText(s) {
  return `${dayLabel(s.localDate)} · ${sessionSpan(s.localStartMinute, s.minutes)} · with ${trainerText(s.trainerName)}`;
}

/** What the box asks before a session is cancelled. */
export function ptCancelAsk(s, timezone) {
  const what = sessionText(s);
  if (s.cancel === 'late') {
    return { title: 'Cancel late?', lines: [what, s.packCharged ? PT_MEMBER_LATE_CANCEL_PACK : PT_MEMBER_LATE_CANCEL], yes: 'Cancel session', no: 'Keep it' };
  }
  const until = `Free to cancel until ${instantText(s.freeCancelUntil, timezone)}.`;
  return {
    title: 'Cancel your session?',
    lines: [what, s.packCharged ? `${until} Your pack gets the session back.` : until],
    yes: 'Cancel session',
    no: 'Keep it',
  };
}

/** What is said once a cancel has gone through, from the session as the server now has it. */
export function ptCancelledText(s) {
  if (s.status === 'late_cancelled') return s.packCharged ? 'Cancelled late. The session stays used on your pack.' : 'Cancelled late.';
  return 'Cancelled.';
}

const clockIn = (at, timeZone) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at);

/** The line that says whose clock the times are on, when the phone's differs; null when
 *  they agree. */
export function ptZoneNote(timezone, gymName, deviceZone, now) {
  let differs;
  try {
    differs = clockIn(now, deviceZone) !== clockIn(now, timezone);
  } catch {
    differs = true;
  }
  return differs ? `Times are ${gymName} time (${timezone.replaceAll('_', ' ')}), not this device's.` : null;
}
