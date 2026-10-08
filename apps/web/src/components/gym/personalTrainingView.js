import { PT_MEMBER_WORDS, PT_NOT_ON_LIST_WORDS, PT_RECORD_SHARED_WORDS, addDays, bookingPeriod } from '@app/shared';
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

/** "this week" where the day is in the week or the month today is in, else "that week". */
function periodWords(period, day, today) {
  const within = bookingPeriod(day, period);
  return `${today >= within.from && today <= within.to ? 'this' : 'that'} ${period}`;
}

/** A membership's sessions for a week or a month are used: how many it includes, and the
 *  day the next week or month starts (which may be full, or not open yet, itself). */
function limitUsedText(limit, day, today) {
  const again = addDays(bookingPeriod(day, limit.period).to, 1);
  const all = limit.limit === 1 ? 'the 1 personal training session' : `all ${String(limit.limit)} personal training sessions`;
  return `You've used ${all} ${limit.membership} includes ${periodWords(limit.period, day, today)}. A new ${limit.period} starts on ${dayLabel(again)}.`;
}

/** What a booking on a day would use, or why it cannot be made; null where the gym sells
 *  no memberships and there is nothing to say. */
export function payText(view, day) {
  if (view.record === 'shared') return { text: PT_RECORD_SHARED_WORDS, can: false };
  if (view.record !== 'own') return { text: PT_NOT_ON_LIST_WORDS, can: false };
  const limit = day.limit ?? null;
  if ((day.why === 'limit_week' || day.why === 'limit_month') && limit !== null) {
    return { text: limitUsedText(limit, day.localDate, view.today), can: false };
  }
  if (day.why !== null) return { text: PT_MEMBER_WORDS[day.why], can: false };
  const pays = day.pays;
  if (pays === null) return { text: PT_MEMBER_WORDS.no_membership, can: false };
  if (pays.membership === null) return null;
  if (pays.sessionsLeft === null && limit !== null) {
    const of = `${String(limit.left)} of ${String(limit.limit)} ${limit.limit === 1 ? 'session' : 'sessions'}`;
    return { text: `You have ${pays.membership}: ${of} left ${periodWords(limit.period, day.localDate, view.today)}.`, can: true };
  }
  if (pays.sessionsLeft === null) return { text: `Personal training is included in your membership: ${pays.membership}.`, can: true };
  const left = pays.sessionsLeft === 1 ? '1 session left' : `${pays.sessionsLeft} sessions left`;
  // The pack pays because the membership's own sessions for that week or month are used.
  const why = limit === null ? '' : ` ${limit.membership}'s sessions for ${periodWords(limit.period, day.localDate, view.today)} are used, so a booking uses your pack.`;
  return { text: `You have ${pays.membership}: ${left}. Each booking uses 1 session.${why}`, can: true };
}

/** The box before a booking: a pressed time books nothing until the member says so. It
 *  names the session and what it uses. */
export function ptBookAsk({ trainerName, dayLabel, timeText, pay }) {
  return {
    title: 'Book this session?',
    lines: [`${dayLabel} · ${timeText} · with ${trainerText(trainerName)}`, ...(pay === null ? [] : [pay.text])],
    yes: 'Book session',
    no: 'Not now',
  };
}

/** The seven days as the row of days to pick from, and which one opens first: the first
 *  with a time anybody offers, else the first. */
export function ptDays(view) {
  const withTimes = new Set(view.trainers.flatMap((t) => t.days.filter((d) => d.free.length > 0).map((d) => d.localDate)));
  const days = view.days.map((d) => ({
    localDate: d.localDate,
    label: dayHeading(d.localDate, view.from === view.today ? view.today : null),
    hasTimes: withTimes.has(d.localDate),
  }));
  return { days, first: (days.find((d) => d.hasTimes) ?? days[0])?.localDate ?? null };
}

/** Under a trainer whose later times on the day are not open to members yet. */
export function opensLaterText(opensDays, some) {
  const when = Number.isInteger(opensDays) ? `${opensDays} ${opensDays === 1 ? 'day' : 'days'} before it starts` : 'closer to the day';
  return some ? `More times on this day open later: each one opens ${when}.` : `Times on this day aren't open yet: each one opens ${when}.`;
}

/** One day of the page: what a booking on it would use, and each trainer's times on it. */
export function ptDay(view, localDate) {
  const day = view.days.find((d) => d.localDate === localDate);
  const pay = day === undefined ? null : payText(view, day);
  return {
    pay,
    // A day past the last one the gym has opened: it has no time to press, and says why
    // (the gym's own number of days can be as few as one, 17e-vi).
    notOpen: localDate > view.lastDay ? `Booking for this day isn't open yet. You can book up to ${dayLabel(view.lastDay)}.` : null,
    // A day nothing pays for shows its times, and none of them is a button.
    can: pay === null || pay.can,
    trainers: view.trainers.map((t) => {
      const on = t.days.find((d) => d.localDate === localDate);
      return {
        trainerId: t.trainerId,
        name: trainerText(t.name),
        lengthText: `${t.sessionMinutes} min sessions`,
        sessionMinutes: t.sessionMinutes,
        times: (on?.free ?? []).map((minute) => ({ minute, text: sessionSpan(minute, t.sessionMinutes) })),
        // The last open day: its later times are not open yet, which is not "none".
        later: on?.opensLater === true ? opensLaterText(view.opensDays, (on.free ?? []).length > 0) : null,
      };
    }),
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

/** What the box asks before a session is cancelled. The time to cancel for free is the
 *  gym's own setting, so the box says whose it is. */
export function ptCancelAsk(s, timezone, gymName) {
  const what = sessionText(s);
  if (s.cancel === 'late') {
    const passed = `${gymName}'s time to cancel for free has passed. Cancelling now counts as a late cancel`;
    return {
      title: 'Cancel late?',
      lines: [
        what,
        s.packCharged
          ? `${passed}, and the session stays used on your pack.`
          : s.usesLimit === true
            ? `${passed}, and it still counts as one of the sessions your membership includes.`
            : `${passed}.`,
      ],
      yes: 'Cancel session',
      no: 'Keep it',
    };
  }
  const until = `${gymName} lets you cancel for free until ${instantText(s.freeCancelUntil, timezone)}.`;
  return {
    title: 'Cancel your session?',
    lines: [what, s.packCharged ? `${until} Your pack gets the session back.` : s.usesLimit === true ? `${until} It then no longer counts as one of the sessions your membership includes.` : until],
    yes: 'Cancel session',
    no: 'Keep it',
  };
}

/** What happened to a session that is over or was cancelled: the line under it in the list. */
export function historyText(s) {
  switch (s.status) {
    case 'cancelled':
      return 'Cancelled';
    case 'late_cancelled':
      return s.packCharged ? 'Cancelled late · the session stays used on your pack' : s.usesLimit === true ? 'Cancelled late · it still counts as one of your sessions' : 'Cancelled late';
    case 'attended':
      return 'You came';
    case 'no_show':
      return s.packCharged ? 'You missed this session · it stays used on your pack' : s.usesLimit === true ? 'You missed this session · it still counts as one of your sessions' : 'You missed this session';
    default:
      return 'Past';
  }
}

/** What is said once a cancel has gone through, from the session as the server now has it. */
export function ptCancelledText(s) {
  if (s.status === 'late_cancelled') {
    if (s.packCharged) return 'Cancelled late. The session stays used on your pack.';
    return s.usesLimit === true ? 'Cancelled late. It still counts as one of the sessions your membership includes.' : 'Cancelled late.';
  }
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
