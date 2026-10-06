import {
  GYM_CHALLENGE_DETAILS_MAX,
  GYM_CHALLENGE_MAX_DAYS,
  GYM_CHALLENGE_MAX_DAYS_AHEAD,
  GYM_CHALLENGE_MAX_DAYS_BACK,
  GYM_CHALLENGE_NAME_MAX,
  GYM_CHALLENGE_PRIZE_MAX,
  GYM_CHALLENGE_SCORE_MAX,
  GYM_CHALLENGE_UNIT_MAX,
  GYM_CHALLENGE_WORDS,
  challengeSaveProblem,
  eventNameIsSeen,
  postLength,
} from '@app/shared';
import { dayLabel } from '../../components/gym/leaderboardView';
import { HIDDEN_TAG } from './leaderboardStaffView';

// THE CONSOLE'S CHALLENGES PAGE, IN WORDS AND RULES (spec Part 3 §15.6; ROADMAP 19d-i).
// Pure. The form's draft, what is wrong with it in a sentence staff can act on, what is
// sent, and every line the page says. Written for someone who opened a gym last week.

export function canManageChallenges(privileges) {
  return Array.isArray(privileges) && privileges.includes('leaderboard.manage');
}

export const CHALLENGE_LIMITS = { unit: GYM_CHALLENGE_UNIT_MAX, score: GYM_CHALLENGE_SCORE_MAX, name: GYM_CHALLENGE_NAME_MAX, details: GYM_CHALLENGE_DETAILS_MAX, prize: GYM_CHALLENGE_PRIZE_MAX, days: GYM_CHALLENGE_MAX_DAYS, back: GYM_CHALLENGE_MAX_DAYS_BACK, ahead: GYM_CHALLENGE_MAX_DAYS_AHEAD };

const UNIT = { gym_days: 'gym day', workout_days: 'workout day' };
const count = (n) => n.toLocaleString('en');
const plural = (n, unit) => `${count(n)} ${unit}${n === 1 ? '' : 's'}`;
const peopleCount = (n) => (n === 1 ? '1 person' : `${count(n)} people`);

const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
/** The day `days` after `day`. */
export const dayAfter = (day, days) => new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);

/** What a challenge can count. */
export const COUNT_CHOICES = [
  { id: 'gym_days', title: 'Gym days', sub: 'A day somebody is checked in at the front desk or by staff' },
  { id: 'workout_days', title: 'Workout days', sub: 'A day somebody finishes a workout in the app' },
  { id: 'own', title: 'Your own count', sub: 'Anything you count yourself, in the gym or away from it. Your staff type each person\'s number.' },
];

/** How it is won. The lowest number can win only where the gym counts for itself (a time). */
export function winChoices(counts) {
  const choices = [
    { id: 'most', title: 'Whoever has the most', sub: 'One board. First place wins.' },
    { id: 'target', title: 'Everyone who reaches a number', sub: 'You set the number. Everybody who gets there wins.' },
  ];
  if (counts === 'own') choices.push({ id: 'lowest', title: 'Whoever has the lowest', sub: 'For a fastest time. The lowest number wins.' });
  return choices;
}
export const WIN_CHOICES = winChoices('gym_days');

const isOwn = (c) => c.counts === 'own';
/** The word after a number, for the app's counts or the gym's own. */
const wordsOf = (c) => (isOwn(c) ? (c.unit ?? '').trim() : `${UNIT[c.counts]}s`);
const capital = (text) => (text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1));

/** Who is in it. */
export function whoChoices(words, inApp) {
  return [
    { id: 'everyone', title: 'Everyone in the app', sub: `Everybody using the app is in it: ${peopleCount(inApp)}. Nobody has to do anything.` },
    { id: 'joined', title: 'Only people who join', sub: `Your ${words.people} see it and tap Join.` },
  ];
}

/** An empty form: the commonest challenge, most gym days, everyone in. */
export function newChallengeDraft() {
  return { name: '', details: '', prize: '', counts: 'gym_days', unit: '', startsOn: '', endsOn: '', win: 'most', target: '', who: 'everyone' };
}

/** The form filled in from a challenge as the server has it. */
export function draftOf(challenge) {
  return {
    name: challenge.name,
    details: challenge.details,
    prize: challenge.prize,
    counts: challenge.counts,
    unit: challenge.unit ?? '',
    startsOn: challenge.startsOn,
    endsOn: challenge.endsOn,
    win: challenge.target !== null ? 'target' : challenge.lowestWins ? 'lowest' : 'most',
    target: challenge.target === null ? '' : String(challenge.target),
    who: challenge.who,
  };
}

/** Another thing counted: the lowest number wins only for the gym's own count, and its
 *  word is the gym's own count's alone. */
export function withCounts(draft, counts) {
  return { ...draft, counts, win: counts !== 'own' && draft.win === 'lowest' ? 'most' : draft.win };
}

/** A new first day moves a last day that is unpicked, or before it, to the same day. */
export function withStartDay(draft, day) {
  return { ...draft, startsOn: day, endsOn: draft.endsOn === '' || draft.endsOn < day ? day : draft.endsOn };
}

/** How many days the draft runs, both ends counted; null until both are picked in order. */
export function draftDays(draft) {
  if (draft.startsOn === '' || draft.endsOn === '' || draft.endsOn < draft.startsOn) return null;
  return dayNumber(draft.endsOn) - dayNumber(draft.startsOn) + 1;
}

const wholeNumber = (text) => (/^\d{1,7}$/.test(text.trim()) ? Number(text.trim()) : null);

/** The rules a draft would be saved with; `target` null where the most wins. */
const rulesOf = (draft) => ({
  counts: draft.counts,
  startsOn: draft.startsOn,
  endsOn: draft.endsOn,
  target: draft.win === 'target' ? wholeNumber(draft.target) : null,
  who: draft.who,
  lowestWins: isOwn(draft) && draft.win === 'lowest',
});

/** Once a challenge has started, what it counts, its first day, who is in it and its
 *  target stay as they are (the server's own rule). */
export function isLocked(challenge) {
  return challenge !== null && challenge.state === 'running';
}

/** The first thing that stops the form being saved, as `{ field, text }`, or null.
 *  `before`: the challenge being edited, null for a new one. */
export function challengeProblem(draft, today, before = null) {
  if (!eventNameIsSeen(draft.name)) return { field: 'name', text: 'Give the challenge a name.' };
  if (postLength(draft.name.trim()) > CHALLENGE_LIMITS.name) return { field: 'name', text: `Keep the name to ${CHALLENGE_LIMITS.name} characters.` };
  if (draft.startsOn === '') return { field: 'startsOn', text: 'Pick its first day.' };
  if (draft.endsOn === '') return { field: 'endsOn', text: 'Pick its last day.' };
  const days = draftDays(draft);
  if (days === null) return { field: 'endsOn', text: 'The last day must not be before the first day.' };
  if (days > CHALLENGE_LIMITS.days) return { field: 'endsOn', text: `A challenge can run for ${CHALLENGE_LIMITS.days} days at most.` };
  if (isOwn(draft)) {
    if (!eventNameIsSeen(draft.unit)) return { field: 'unit', text: 'Say what you are counting, for example push-ups.' };
    if (postLength(draft.unit.trim()) > CHALLENGE_LIMITS.unit) return { field: 'unit', text: `Keep what you are counting to ${CHALLENGE_LIMITS.unit} characters.` };
  }
  if (draft.win === 'target') {
    const target = wholeNumber(draft.target);
    const unit = wordsOf(draft);
    if (target === null || target < 1) return { field: 'target', text: `Type how many ${unit} to reach, as a whole number.` };
    if (isOwn(draft)) {
      if (target > CHALLENGE_LIMITS.score) return { field: 'target', text: `The number to reach can be ${count(CHALLENGE_LIMITS.score)} at most.` };
    } else if (target > days) {
      return { field: 'target', text: `One a day is counted and this challenge is ${plural(days, 'day')} long, so the most anyone can reach is ${count(days)}. Type ${count(days)} or less, or make it longer.` };
    }
  }
  if (postLength(draft.prize.trim()) > CHALLENGE_LIMITS.prize) return { field: 'prize', text: `Keep the prize to ${CHALLENGE_LIMITS.prize} characters.` };
  if (postLength(draft.details.trim()) > CHALLENGE_LIMITS.details) return { field: 'details', text: `Keep the details to ${CHALLENGE_LIMITS.details} characters.` };
  const rule = challengeSaveProblem({
    today,
    before: before === null ? null : { counts: before.counts, startsOn: before.startsOn, endsOn: before.endsOn, target: before.target, who: before.who, lowestWins: before.lowestWins === true },
    next: rulesOf(draft),
  });
  if (rule === null) return null;
  const field = rule === 'ends_before_today' ? 'endsOn' : rule === 'started_locked' || rule === 'ended' ? 'form' : 'startsOn';
  return { field, text: GYM_CHALLENGE_WORDS[rule] };
}

/** What is sent for a draft with no problem. */
export function fieldsOf(draft) {
  return { name: draft.name.trim(), details: draft.details.trim(), prize: draft.prize.trim(), unit: isOwn(draft) ? draft.unit.trim() : '', ...rulesOf(draft) };
}

/** Whether the challenge the server kept is the one this form holds: a save whose reply
 *  was lost and whose form was then changed is answered with the first one. */
export function sameAsSent(challenge, fields) {
  return ['name', 'details', 'prize', 'counts', 'unit', 'startsOn', 'endsOn', 'target', 'who', 'lowestWins'].every((key) => challenge[key] === fields[key]);
}

/** "500 characters left", and whether it is over. */
export function detailsLine(text) {
  const left = CHALLENGE_LIMITS.details - postLength(text.trim());
  if (left >= 0) return { over: false, text: `${count(left)} characters left` };
  return { over: true, text: `${count(-left)} characters too many` };
}

/** Under the target box: the most that can be reached, once the days are known. */
export function targetHint(draft) {
  if (isOwn(draft)) return 'Everybody whose number reaches this wins.';
  const days = draftDays(draft);
  const unit = UNIT[draft.counts];
  if (days === null) return `One ${unit} a day is the most anybody can get.`;
  return `One ${unit} a day is the most anybody can get, and this challenge is ${plural(days, 'day')} long: ${count(days)} is the highest number that can be reached.`;
}

/** Under the first day: a start in the past already counts. */
export function startHint(draft, today) {
  if (draft.startsOn === '' || draft.startsOn >= today || isOwn(draft)) return null;
  return `${UNIT[draft.counts] === 'gym day' ? 'Gym days' : 'Workout days'} since ${dayLabel(draft.startsOn)} already count.`;
}

/** A gym that checks nobody in gets no gym days: said under the choice, before it is saved. */
export function notCheckingInNote(counts, list, words) {
  if (counts !== 'gym_days' || list.checkingIn) return null;
  return `Nobody has been checked in at your front desk in the last 30 days. Gym days only come from check-ins, so every ${words.person} would stay at 0. Check people in at the front desk, or count workout days.`;
}

/** The tag beside a challenge's name. */
export function challengeTag(challenge, today) {
  if (challenge.cancelled) return { text: 'Cancelled', tone: 'bad' };
  if (challenge.state === 'ended') return { text: `Ended ${dayLabel(challenge.endsOn)}`, tone: 'plain' };
  if (challenge.state === 'coming') {
    const days = dayNumber(challenge.startsOn) - dayNumber(today);
    return { text: days <= 1 ? 'Starts tomorrow' : `Starts in ${count(days)} days`, tone: 'plain' };
  }
  const left = dayNumber(challenge.endsOn) - dayNumber(today) + 1;
  return { text: left <= 1 ? 'Running · last day' : `Running · ${count(left)} days left`, tone: 'good' };
}

/** "Mon 5 Oct – Sun 11 Oct · 7 days"; a year only where it is not today's. */
export function datesLine(challenge, today) {
  const year = (day) => (day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`);
  const days = dayNumber(challenge.endsOn) - dayNumber(challenge.startsOn) + 1;
  const first = `${dayLabel(challenge.startsOn)}${year(challenge.startsOn)}`;
  if (days === 1) return `${first} · 1 day`;
  return `${first} – ${dayLabel(challenge.endsOn)}${year(challenge.endsOn)} · ${count(days)} days`;
}

/** "Counts gym days · whoever has the most wins" */
export function rulesLine(challenge) {
  const what = `Counts ${wordsOf(challenge)}`;
  if (challenge.target === null) return `${what} · whoever has the ${challenge.lowestWins ? 'lowest' : 'most'} wins`;
  return `${what} · everyone who reaches ${count(challenge.target)} wins`;
}

/** The three facts on a challenge's card, each a few words. */
export function cardFacts(challenge, inApp, words) {
  const counts = isOwn(challenge) ? capital(wordsOf(challenge)) : challenge.counts === 'gym_days' ? 'Gym days' : 'Workout days';
  const won = challenge.target !== null ? `Reach ${count(challenge.target)}` : challenge.lowestWins ? 'Lowest wins' : 'Most wins';
  const who =
    challenge.who === 'everyone'
      ? `Everyone in the app · ${count(inApp)}`
      : challenge.joinedCount === 0
        ? `${words.peopleCap} who join · none yet`
        : `${words.peopleCap} who join · ${count(challenge.joinedCount)}`;
  return [
    { label: 'Counts', value: counts, note: isOwn(challenge) ? 'Typed in by your staff' : 'Counted by the app' },
    { label: 'How it is won', value: won, note: challenge.target !== null ? 'Everybody who gets there' : 'First place' },
    { label: 'Who is in it', value: who, note: null },
  ];
}

/** How far through its days a challenge is: "Day 2 of 7" and the bar's fill; null before
 *  it starts and for a cancelled one. An ended one is full. */
export function daysBar(challenge, today) {
  if (challenge.cancelled || challenge.state === 'coming') return null;
  const days = dayNumber(challenge.endsOn) - dayNumber(challenge.startsOn) + 1;
  if (challenge.state === 'ended') return { percent: 100, text: `All ${plural(days, 'day')} done` };
  const day = dayNumber(today) - dayNumber(challenge.startsOn) + 1;
  return { percent: Math.round((day / days) * 100), text: `Day ${count(day)} of ${count(days)}` };
}

/** How many people have a number so far, in the challenge's own words; null where the
 *  card was not sent it. */
export function withNumberLine(challenge) {
  if (challenge.withNumber === null || challenge.withNumber === undefined) return null;
  const what = isOwn(challenge) ? 'a number' : `a ${UNIT[challenge.counts]}`;
  if (challenge.withNumber === 0) return `Nobody has ${what} yet`;
  return `${peopleCount(challenge.withNumber)} ${challenge.withNumber === 1 ? 'has' : 'have'} ${what}`;
}

/** Above the first three on a card, or why there are none to show. Null where the card
 *  was not sent them. */
export function leadersLine(challenge, words) {
  if (challenge.withNumber === null || challenge.withNumber === undefined) return null;
  if ((challenge.top ?? []).length > 0) return 'In the lead';
  if (challenge.withNumber === 0) return null;
  return `${words.peopleCap} see no places until 3 people they can see have ${isOwn(challenge) ? 'a number' : `a ${UNIT[challenge.counts]}`}.`;
}

/** Whether staff type this challenge's numbers now: the gym's own count, started, not cancelled. */
export function takesNumbers(challenge) {
  return isOwn(challenge) && !challenge.cancelled && challenge.state !== 'coming';
}

/** What is typed in a person's number box, as the number to save: "" is none; null is not a number. */
export function typedNumber(text) {
  const t = String(text).trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d{1,7}$/.test(t) || Number(t) > CHALLENGE_LIMITS.score) return { ok: false, value: null };
  return { ok: true, value: Number(t) };
}

/** The numbers to send: only the people whose box no longer says what is kept. Null when a box holds something that is no number. */
export function numbersToSave(rows, typed) {
  const scores = [];
  for (const row of rows) {
    const text = typed[row.userId];
    if (text === undefined) continue;
    const parsed = typedNumber(text);
    if (!parsed.ok) return null;
    const value = parsed.value ?? 0;
    if (value !== row.value) scores.push({ userId: row.userId, value: value === 0 ? null : value });
  }
  return scores;
}

export const NUMBER_NOTES = {
  bad: `A number is a whole number up to ${count(CHALLENGE_LIMITS.score)}. Leave a box empty for no number.`,
  saved: (n, words) => `Saved. ${n === 1 ? '1 number' : `${count(n)} numbers`} changed, and your ${words.people} see the board now.`,
  none: 'Nothing has changed yet.',
  help: (challenge, words) => `Type each person's ${wordsOf(challenge)} and press Save numbers. An empty box is no number. Your ${words.people} see the board as soon as you save.`,
};

/** Who is in it, with the number where there is one. */
export function whoText(challenge, inApp, words) {
  if (challenge.who === 'everyone') return `Everyone in the app: ${peopleCount(inApp)}`;
  if (challenge.joinedCount === 0) return `Only ${words.people} who join · nobody has joined yet`;
  return `Only ${words.people} who join · ${peopleCount(challenge.joinedCount)} ${challenge.joinedCount === 1 ? 'has' : 'have'} joined`;
}

/** The button that opens a challenge's board. */
export function boardButton(challenge, open) {
  if (open) return 'Hide the board';
  return challenge.state === 'coming' && challenge.who === 'joined' ? 'See who has joined' : 'See the board';
}

/** The box before a challenge is cancelled: what happens, and to whom. */
export function cancelBox(challenge, words) {
  const lines = [`Your ${words.people} see it marked Cancelled for 7 days, then it leaves their list. Its board stops showing straight away.`];
  if (challenge.who === 'joined' && challenge.joinedCount > 0) {
    lines.push(`${peopleCount(challenge.joinedCount)} ${challenge.joinedCount === 1 ? 'has' : 'have'} joined. The app doesn't tell them yet, so let them know yourself. They are still in it if you un-cancel.`);
  }
  lines.push(`Nobody is emailed, and nobody's gym days or workouts are touched. You can un-cancel it until ${dayLabel(challenge.endsOn)}.`);
  return { title: `Cancel ${challenge.name}?`, lines, yes: 'Cancel challenge', no: 'Keep it' };
}

/** Above a board's rows: who is listed, and what members see of it. */
export function boardLines(board, challenge, words) {
  const lines = [];
  if (board.memberStatus === 'not_started') {
    lines.push(challenge.cancelled ? 'This challenge is cancelled, so nothing is counted.' : `It starts ${dayLabel(challenge.startsOn)}. Nothing is counted until then.`);
    if (challenge.who === 'joined' && board.total > 0) lines.push(`${peopleCount(board.total)} ${board.total === 1 ? 'has' : 'have'} joined so far.`);
    return lines;
  }
  // For the gym's own count everybody in it is listed, most of them only waiting for a number.
  const hidden = isOwn(challenge) ? 0 : board.total - board.ranked;
  if (board.memberStatus === 'too_few') {
    lines.push(`${words.peopleCap} see no places yet: fewer than 3 people they can see have a ${isOwn(challenge) ? 'number' : UNIT[challenge.counts]} in it.`);
  } else {
    lines.push(`${words.peopleCap} see ${peopleCount(board.ranked)} on its board${hidden > 0 ? `; ${count(hidden)} more ${hidden === 1 ? 'is' : 'are'} listed here and hidden from them` : ''}.`);
  }
  if (board.reached !== null) {
    lines.push(board.reached === 0 ? `Nobody has reached ${count(challenge.target)} yet.` : `${peopleCount(board.reached)} ${board.reached === 1 ? 'has' : 'have'} reached ${count(challenge.target)}.`);
  }
  return lines;
}

/** What a board's row says after the name: why members do not see the person, or that
 *  nothing of theirs has counted yet. Null for somebody members see. */
export function rowNote(row, challenge = null) {
  // The name's own place already reads "No name yet": the tag says what follows from it.
  if (row.hidden === 'no_name') return 'Hidden until they add a name';
  if (row.hidden !== null) return HIDDEN_TAG[row.hidden];
  if (row.value === 0) return challenge !== null && isOwn(challenge) ? 'No number yet' : 'Nothing counted yet';
  return null;
}

/** The words where a board has nobody on it. */
export function emptyBoard(board, challenge) {
  if (board.memberStatus === 'not_started' && challenge.who === 'joined') return 'Nobody has joined yet.';
  if (board.memberStatus === 'not_started') return null;
  return challenge.who === 'joined' ? 'Nobody has joined yet.' : isOwn(challenge) ? 'Nobody is in the app here yet.' : `Nobody has a ${UNIT[challenge.counts]} in it yet.`;
}

/** "Showing 1–100 of 240" */
export function pageLine(board) {
  if (board.pages === 1) return null;
  const from = (board.page - 1) * 100 + 1;
  return `Showing ${count(from)}–${count(from + board.rows.length - 1)} of ${count(board.total)}`;
}

export const CHALLENGE_NOTES = {
  added: (words) => `Challenge added. Your ${words.people} can see it now.`,
  saved: (words) => `Changes saved. Your ${words.people} see them now.`,
  cancelled: (words) => `Challenge cancelled. Your ${words.people} see it marked Cancelled.`,
  uncancelled: (words) => `Challenge un-cancelled. Your ${words.people} see it as on again.`,
};

/** "Past challenges (3)"; with more than the page lists, "Past challenges (the newest 50 of 73)". */
export function pastTitle(list) {
  return list.pastTotal > list.past.length ? `Past challenges (the newest ${list.past.length} of ${list.pastTotal})` : `Past challenges (${list.pastTotal})`;
}

/** What the locked fields say, once a challenge has started. */
export const LOCKED_NOTE = "This challenge has started, so what it counts, its first day, who is in it and how it is won can't change now. You can still change its name, prize, details and last day.";
