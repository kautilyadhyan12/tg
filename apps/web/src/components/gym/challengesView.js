// A GYM'S CHALLENGES FOR ITS MEMBER, IN WORDS (spec Part 3 §15.6; ROADMAP 19d-i). Pure, so
// every sentence is tested without a browser. A challenge's days are the gym's own calendar
// days ("2026-10-05") and are printed as they are.
import { dayLabel, ordinal } from './leaderboardView';

const UNIT = { gym_days: 'gym day', workout_days: 'workout day' };
const plural = (n, unit) => `${n.toLocaleString('en')} ${unit}${n === 1 ? '' : 's'}`;
const people = (n) => (n === 1 ? '1 person' : `${n.toLocaleString('en')} people`);

const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const dayAt = (number) => new Date(number * 86_400_000).toISOString().slice(0, 10);

/** What one counted day is called: "gym day", "workout day". */
export const unitOf = (counts) => UNIT[counts];

/** The gym's own count (staff type the numbers) reads in the gym's own word, as typed. */
const isOwn = (challenge) => challenge.counts === 'own';
/** The word after a number: "gym days", "gym day", or the gym's own word. */
const wordFor = (challenge, n) => (isOwn(challenge) ? challenge.unit : `${UNIT[challenge.counts]}${n === 1 ? '' : 's'}`);
const amount = (challenge, n) => `${n.toLocaleString('en')} ${wordFor(challenge, n)}`;

/** "3 gym days", "1 workout day", "40 push-ups" (the gym's own word, as it typed it). */
export const countText = (value, counts, unit = '') => amount({ counts, unit }, value);

/** The mark beside a challenge's name: where it is on the gym's calendar. `tone` picks its
 *  colour and always comes with the words. */
export function challengeChip(challenge, today) {
  if (challenge.cancelled) return { text: 'Cancelled', tone: 'bad' };
  if (challenge.state === 'coming') {
    const days = dayNumber(challenge.startsOn) - dayNumber(today);
    return { text: days <= 1 ? 'Starts tomorrow' : `Starts in ${days} days`, tone: 'plain' };
  }
  if (challenge.state === 'ended') return { text: 'Ended', tone: 'plain' };
  const left = dayNumber(challenge.endsOn) - dayNumber(today) + 1;
  return { text: left <= 1 ? 'Last day' : `${left} days left`, tone: left <= 3 ? 'hot' : 'good' };
}

/** "Mon 5 Oct – Sun 11 Oct"; a year is said only where it is not today's. */
export function challengeDates(challenge, today) {
  const year = (day) => (day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`);
  const first = `${dayLabel(challenge.startsOn)}${year(challenge.startsOn)}`;
  if (challenge.startsOn === challenge.endsOn) return first;
  return `${first} – ${dayLabel(challenge.endsOn)}${year(challenge.endsOn)}`;
}

/** How it is won, in one line. */
export function howToWin(challenge) {
  if (challenge.target !== null) return `Reach ${amount(challenge, challenge.target)}`;
  return `${challenge.lowestWins ? 'Fewest' : 'Most'} ${wordFor(challenge, 2)} wins`;
}

/** What is counted, for somebody who has never seen the app. */
export function whatCounts(challenge, gymName) {
  const same = 'It is the same count as the Leaderboard.';
  if (isOwn(challenge)) {
    return `The staff at ${gymName} count the ${challenge.unit} and add each person's number. If yours is missing or wrong, ask at the front desk.`;
  }
  if (challenge.counts === 'workout_days') {
    return `A workout day is a day you finish a workout in the app, at the gym or at home. Two on one day are one. ${same}`;
  }
  return `A gym day is a day you're checked in at ${gymName}: a scan at the front desk, or a check-in by staff. Two visits on one day are one. ${same}`;
}

/** Who is in it. */
export function whoLine(challenge, gymName) {
  if (challenge.who === 'everyone') return `Everyone at ${gymName} is in`;
  if (challenge.joinedCount === 0) return 'Nobody has joined yet';
  return `${people(challenge.joinedCount)} ${challenge.joinedCount === 1 ? 'has' : 'have'} joined`;
}

/** The member's own number: the words under it, and how full its bar is (null: no bar). */
export function progress(challenge) {
  const me = challenge.me;
  if (me === null) return null;
  // The gym's own count: nothing is theirs until staff have added it.
  const waiting = isOwn(challenge) && me.value === 0 && challenge.state === 'running' ? "The staff haven't added your number yet." : null;
  if (challenge.target === null) return { big: me.value, of: null, unit: wordFor(challenge, me.value), percent: null, note: waiting, done: false };
  const unit = wordFor(challenge, 2);
  const percent = Math.min(100, Math.round((me.value / challenge.target) * 100));
  if (me.reached) return { big: me.value, of: challenge.target, unit, percent: 100, note: `Done. You reached ${amount(challenge, challenge.target)}.`, done: true };
  const toGo = challenge.target - me.value;
  const note = waiting ?? (challenge.state === 'ended' ? null : `${toGo.toLocaleString('en')} to go`);
  return { big: me.value, of: challenge.target, unit, percent, note, done: false };
}

/** "3rd of 24", then what it takes to move up; null with no place. */
export function placeLine(challenge) {
  const me = challenge.me;
  if (me === null || me.place === null || me.hidden !== null) return null;
  const where = `${ordinal(me.place)} of ${challenge.board.ranked.toLocaleString('en')}`;
  if (challenge.state === 'ended' || me.toNextPlace === null || me.nextPlace === null) return where;
  const less = challenge.lowestWins ? 'fewer' : 'more';
  const gap = isOwn(challenge) ? `${me.toNextPlace.toLocaleString('en')} ${less} ${challenge.unit}` : plural(me.toNextPlace, `more ${UNIT[challenge.counts]}`);
  return `${where} · ${gap} to reach ${ordinal(me.nextPlace)}`;
}

/** Why there are no places to show yet, or null when there are. */
export function boardNote(challenge) {
  if (challenge.cancelled || challenge.board.status !== 'too_few') return null;
  return `The places show once 3 people have a ${isOwn(challenge) ? 'number' : UNIT[challenge.counts]} in this challenge.`;
}

/** A gym-days challenge at a gym that checks nobody in counts nothing: say so, never a bare 0. */
export function notCountingNote(challenge, list) {
  if (challenge.counts !== 'gym_days' || challenge.state !== 'running' || challenge.cancelled || list.checkingIn) return null;
  return `${list.gymName} hasn't checked anyone in at the front desk in the last 30 days, so no gym days are being counted.`;
}

/** How it finished: who won, and how the member did. Null until it has ended. */
export function resultOf(challenge) {
  if (challenge.state !== 'ended' || challenge.cancelled) return null;
  const { board, me, target } = challenge;
  const said = (n) => amount(challenge, n);
  let headline;
  if (board.status !== 'shown') headline = 'It finished with fewer than 3 people in it, so there are no places.';
  else if (target !== null) {
    headline = board.reached === 0 ? `Nobody reached ${said(target)}.` : `${people(board.reached)} reached ${said(target)}.`;
  } else {
    const first = board.top.filter((row) => row.place === 1);
    const names = first.map((row) => (row.isMe ? 'You' : row.name));
    const with_ = `with ${said(first[0]?.value ?? 0)}`;
    if (board.leaders <= 1) headline = names[0] === 'You' ? `You won, ${with_}.` : `Winner: ${names[0]}, ${with_}.`;
    else {
      // The card names three at most; the rest who share first place are counted.
      const more = board.leaders - names.length;
      const named = more > 0 ? `${names.join(', ')} and ${more.toLocaleString('en')} more` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      headline = `Joint winners: ${named}, ${with_} each.`;
    }
  }
  let mine = null;
  if (me !== null) {
    if (target !== null) mine = me.reached ? `You reached it: ${said(me.value)}.` : `You got to ${me.value.toLocaleString('en')} of ${target.toLocaleString('en')}.`;
    else if (me.value === 0) mine = isOwn(challenge) ? 'No number was added for you.' : `You had no ${UNIT[challenge.counts]}s in it.`;
    else if (me.place !== null && me.hidden === null && me.place > 1) mine = `You finished ${ordinal(me.place)}, with ${said(me.value)}.`;
    else if (me.place === null || me.hidden !== null) mine = `You had ${said(me.value)}.`;
  }
  return { headline, mine };
}

/** The days to draw as flames, in weeks of seven, Monday first: a challenge of five weeks
 *  or less whole, a longer one as the week it is in. `null` cells are outside it. Each
 *  cell: counted, missed, today still open, or still ahead. */
export function dayMarks(challenge, today) {
  const me = challenge.me;
  // The gym's own count has no days: staff type one number.
  if (me === null || challenge.state === 'coming' || challenge.cancelled || isOwn(challenge)) return null;
  const counted = new Set(me.days);
  const first = dayNumber(challenge.startsOn);
  const last = dayNumber(challenge.endsOn);
  const now = dayNumber(today);
  const monday = (n) => n - ((new Date(n * 86_400_000).getUTCDay() + 6) % 7);
  const whole = last - first + 1 <= 35;
  const at = Math.min(Math.max(now, first), last);
  const from = whole ? monday(first) : monday(at);
  const to = whole ? monday(last) + 6 : monday(at) + 6;
  const weeks = [];
  for (let start = from; start <= to; start += 7) {
    weeks.push(
      [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const n = start + i;
        if (n < first || n > last) return null;
        const day = dayAt(n);
        const state = counted.has(day) ? 'yes' : n > now ? 'ahead' : n === now ? 'open' : 'no';
        return { day, state };
      }),
    );
  }
  return { weeks, whole };
}

/** What a flame means, for a screen reader and a hover. */
export function markLabel(cell, counts) {
  const what = { yes: UNIT[counts], no: `no ${UNIT[counts]}`, open: 'today, not counted yet', ahead: 'still to come' }[cell.state];
  return `${dayLabel(cell.day)}: ${what}`;
}

/** The box before a member leaves a challenge. */
export function leaveBox(challenge) {
  return {
    title: `Leave ${challenge.name}?`,
    line: isOwn(challenge)
      ? 'You come off its board. You can join again until it ends.'
      : `You come off its board. Your ${UNIT[challenge.counts]}s stay yours, and you can join again until it ends.`,
    yes: 'Leave',
    no: 'Stay in',
  };
}

/** What joining does, under the Join button. */
export function joinNote(challenge) {
  if (!challenge.can.join) return null;
  if (challenge.state === 'coming') return `Join now and you're in from ${dayLabel(challenge.startsOn)}.`;
  if (isOwn(challenge)) return 'Join, and the staff can add your number.';
  return `Your ${UNIT[challenge.counts]}s since ${dayLabel(challenge.startsOn)} count as soon as you join.`;
}

export const noChallenges = (gymName) => `${gymName} has no challenges on right now.`;
