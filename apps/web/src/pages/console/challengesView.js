import {
  GYM_CHALLENGE_DETAILS_MAX,
  GYM_CHALLENGE_MAX_DAYS,
  GYM_CHALLENGE_MAX_DAYS_AHEAD,
  GYM_CHALLENGE_MAX_DAYS_BACK,
  GYM_CHALLENGE_NAME_MAX,
  GYM_CHALLENGE_PRIZE_MAX,
  GYM_CHALLENGE_SCORE_MAX,
  GYM_CHALLENGE_UNIT_MAX,
  GYM_CHALLENGE_SCORES_A_SAVE,
  GYM_CHALLENGE_TEAMS_MAX,
  GYM_CHALLENGE_TEAMS_MIN,
  GYM_CHALLENGE_TEAM_NAME_MAX,
  GYM_CHALLENGE_TEAM_PEOPLE_A_SAVE,
  GYM_CHALLENGE_WORDS,
  challengeSaveProblem,
  challengeTakesNumbers,
  challengeTakesTeams,
  challengeSubject,
  challengeWords,
  eventNameIsSeen,
  kindPerDay,
  postLength,
  teamNameKey,
} from '@app/shared';
import { countText, winLine } from '../../components/gym/challengesView';
import { dayLabel, ordinal } from '../../components/gym/leaderboardView';
import { HIDDEN_TAG } from './leaderboardStaffView';

// THE CONSOLE'S CHALLENGES PAGE, IN WORDS AND RULES (spec Part 3 §15.6; ROADMAP 19d-i).
// Pure. The form's draft, what is wrong with it in a sentence staff can act on, what is
// sent, and every line the page says. Written for someone who opened a gym last week.
//
// A challenge the server sent is said in its own words (`words`, spec §15.10.1). The form
// offers what the server's list for the gym offers (`offered`), and sends the list's kind.

export function canManageChallenges(privileges) {
  return Array.isArray(privileges) && privileges.includes('leaderboard.manage');
}

export const TEAM_LIMITS = { min: GYM_CHALLENGE_TEAMS_MIN, max: GYM_CHALLENGE_TEAMS_MAX, name: GYM_CHALLENGE_TEAM_NAME_MAX };
export const CHALLENGE_LIMITS = { unit: GYM_CHALLENGE_UNIT_MAX, score: GYM_CHALLENGE_SCORE_MAX, name: GYM_CHALLENGE_NAME_MAX, details: GYM_CHALLENGE_DETAILS_MAX, prize: GYM_CHALLENGE_PRIZE_MAX, days: GYM_CHALLENGE_MAX_DAYS, back: GYM_CHALLENGE_MAX_DAYS_BACK, ahead: GYM_CHALLENGE_MAX_DAYS_AHEAD };

const count = (n) => n.toLocaleString('en');
const plural = (n, unit) => `${count(n)} ${unit}${n === 1 ? '' : 's'}`;
const peopleCount = (n) => (n === 1 ? '1 person' : `${count(n)} people`);

const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
/** The day `days` after `day`. */
export const dayAfter = (day, days) => new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);

/** The form's draft is counted by the staff: their word is typed. */
const isOwn = (draft) => draft.countedBy === 'staff';
/** A challenge the server sent is counted by the staff. */
const staffCount = (c) => c.countedBy === 'staff';
/** The words of what the form will send (`kindOf`), as the server will send them once it is saved. */
const draftWords = (draft) => challengeWords({ ...kindOf(draft), unit: (draft.unit ?? '').trim() }, '');
/** The word after a number: a sent challenge's own; the form's, '' until the staff's is typed. */
const wordsOf = (c) => (c.words !== undefined ? c.words.many : isOwn(c) ? (c.unit ?? '').trim() : draftWords(c).many);
const capital = (text) => (text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1));
const lower = (text) => (text === '' ? text : text.charAt(0).toLowerCase() + text.slice(1));

/** A number with its word, as members read it: "4 gym days", "1 gym day", "55 push-ups". */
export const amountOf = (challenge, n) => countText(n, challenge.words);

// ── WHAT IT IS ABOUT, AND WHO COUNTS IT (spec Part 3 §15.10.6) ──
//
// `offered` is the server's list for this gym (`GET …/challenges/subjects`): each subject
// with what the app can count for it, and the library's exercises. The form offers nothing
// else, and never the app for something the app cannot count.

const subjectOf = (offered, id) => offered?.subjects.find((s) => s.id === id);
const exerciseOf = (offered, slug) => offered?.exercises.find((e) => e.slug === slug);

/** "What is the challenge about": every subject the server offers, with its one line. */
export function aboutChoices(offered) {
  return offered.subjects.map((s) => ({ id: s.id, title: s.title, sub: s.hint }));
}

/** The exercises to pick from, in the library's names. */
export const exerciseChoices = (offered) => offered.exercises.map((e) => ({ id: e.slug, title: e.name }));

/** What the app counts for the draft's subject and exercise; null where it can't. */
function appMeasure(draft, offered) {
  const subject = subjectOf(offered, draft.subject);
  const measure = subject?.appCounts[0];
  if (measure === undefined) return null;
  if (subject.pickExercise && exerciseOf(offered, draft.exercise)?.appCounts !== true) return null;
  return measure;
}

/** The staff's word a draft starts with: the exercise's name ("squats"), the subject's word
 *  ("visits"), or what they typed for something of their own. */
function staffWordFor(draft, offered) {
  const subject = subjectOf(offered, draft.subject);
  if (subject?.pickExercise) {
    const exercise = exerciseOf(offered, draft.exercise);
    if (exercise?.held === true) return TIME_WORD;
    return (exercise?.word ?? '').slice(0, CHALLENGE_LIMITS.unit);
  }
  if (subject !== undefined && subject.staffWord !== '') return subject.staffWord;
  return draft.ownUnit ?? '';
}

/** "Who counts it": the two choices, where the subject could be counted either way; or one
 *  plain line where only the staff can. `off` is The app switched off, with its reason. */
export function countedByChoices(draft, offered, words) {
  const subject = subjectOf(offered, draft.subject);
  if (subject === undefined) return { line: null, choices: [] };
  const staff = { id: 'staff', title: 'Your staff', sub: `Your staff enter each ${words.person}'s number.` };
  if (subject.appCounts.length === 0 && !subject.pickExercise) return { line: 'Counted by your staff.', choices: [] };
  const measure = appMeasure(draft, offered);
  if (measure !== null) return { line: null, choices: [{ id: 'app', title: 'The app', sub: `It counts ${measure.many} by itself. Your staff don't enter any numbers.` }, staff] };
  const name = exerciseOf(offered, draft.exercise)?.name;
  const anyCounted = offered.exercises.some((e) => e.appCounts);
  const why = name !== undefined ? `The camera can't count ${name} yet, so your staff count it.` : anyCounted ? 'Pick an exercise first.' : "The camera can't count exercises for challenges yet, so your staff count them.";
  return { line: null, choices: [{ id: 'app', title: 'The app', sub: why, off: true }, staff] };
}

/** The draft made about another subject: the app counts it where it can, else the staff,
 *  in their word for it. What was typed for something of the gym's own is kept for coming back. */
export function withSubject(draft, subject, offered) {
  if (subject === draft.subject) return draft;
  const ownUnit = draft.subject === 'own' ? draft.unit : (draft.ownUnit ?? '');
  const next = { ...draft, subject, ownUnit, exercise: subjectOf(offered, subject)?.pickExercise ? (draft.exercise ?? '') : '' };
  return settled(withCountedBy(next, appMeasure(next, offered) === null ? 'staff' : 'app', offered, true), offered);
}

/** The draft counted by the app or by the staff. The app only where it can count it; the
 *  lowest number wins only where the staff count. */
export function withCountedBy(draft, by, offered, force = false) {
  if (!force && by === draft.countedBy) return draft;
  const measure = by === 'app' ? appMeasure(draft, offered) : null;
  if (by === 'app' && measure === null) return draft;
  const app = by === 'app';
  return settled({ ...draft, countedBy: by, measure: app ? measure.measure : null, unit: app ? '' : timedWord(draft, staffWordFor(draft, offered)), win: app && draft.win === 'lowest' ? 'most' : draft.win }, offered);
}

/** The fastest time is offered for something of the gym's own and for an exercise done in
 *  reps: never for a count of days, nor a hold or a pose, which are won by the longest. */
export function fastestOffered(draft, offered) {
  if (!isOwn(draft)) return false;
  if (draft.subject === 'own') return true;
  return picksExercise(draft) && exerciseOf(offered, draft.exercise)?.held !== true;
}

/** A draft whose fastest time is no longer offered goes back to the most, in the form's word. */
function settled(draft, offered) {
  if (draft.win !== 'lowest' || fastestOffered(draft, offered)) return draft;
  return { ...draft, win: 'most', unit: draft.unit === TIME_WORD ? staffWordFor(draft, offered) : draft.unit };
}

/** The word a fastest time is typed in. */
const TIME_WORD = 'seconds';
/** Where the fastest time wins, the staff's word is a time: their own word, else seconds. */
const timedWord = (draft, word) => (draft.win === 'lowest' && (word.trim() === '' || picksExercise(draft) || word === subjectWordOf(draft)) ? TIME_WORD : word);
const subjectWordOf = (draft) => challengeSubject(draft.subject)?.staffWord ?? '';

/** Another way to win. The fastest time is typed in seconds: the word the form gave becomes
 *  seconds, and back on the most or a target the form's word comes back. A word the staff
 *  typed stays theirs. */
export function withWin(draft, win, offered) {
  if (win === draft.win) return draft;
  const given = staffWordFor(draft, offered);
  if (win === 'lowest') return { ...draft, win, unit: draft.unit.trim() === '' || draft.unit === given ? TIME_WORD : draft.unit };
  return { ...draft, win, unit: draft.win === 'lowest' && draft.unit === TIME_WORD && given !== '' ? given : draft.unit };
}

/** Another exercise picked: the staff's word follows it, unless they changed it. */
export function withExercise(draft, slug, offered) {
  const before = staffWordFor(draft, offered);
  const next = { ...draft, exercise: slug };
  const unit = draft.countedBy === 'staff' && (draft.unit.trim() === '' || draft.unit === before) ? timedWord(next, staffWordFor(next, offered)) : draft.unit;
  return settled({ ...next, unit }, offered);
}

/** How it is won, each choice in the words of what is counted. The lowest number can win
 *  only where the staff count (a time). `unit`: the staff's own word, '' until typed. */
export function winChoices(draft, words = { person: 'person' }, offered = null) {
  const teams = draft.teams ?? 'none';
  const given = staffWordFor(draft, offered);
  // Once the fastest wins the word is seconds; the other two still read in the form's word.
  const u = draft.win === 'lowest' && draft.unit === TIME_WORD && given !== '' && given !== TIME_WORD ? given : wordsOf(draft);
  const own = isOwn(draft);
  const fastest = fastestOffered(draft, offered);
  const theMost = u === '' ? 'highest number' : `most ${u}`;
  const most = u === '' ? 'Highest number wins' : `Most ${u} wins`;
  const lowest = 'Fastest time wins';
  const example = (n) => (u === '' ? count(n) : `${count(n)} ${u}`);
  // A time is typed in the staff's word once the fastest wins, else in seconds.
  const typed = wordsOf(draft);
  const timeWord = draft.win === 'lowest' && typed !== '' ? typed : TIME_WORD;
  const aTime = draft.subject === 'own' ? 'a 500 m row' : `100 ${given === '' || given === TIME_WORD ? 'squats' : given} as fast as possible`;
  if (teams !== 'none') {
    const choices = [
      { id: 'most', title: most, sub: `The team with the ${theMost} when it ends comes 1st. A team's number is its people's numbers added together.` },
      { id: 'target', title: 'Reach a target', sub: `You set a target for a whole team, such as ${example(own ? 500 : 60)}. Every team that reaches it wins.` },
    ];
    if (fastest) choices.push({ id: 'lowest', title: lowest, sub: `For a time, such as ${aTime}. Your staff enter each ${words.person}'s time in ${timeWord}, and the team with the lowest total comes 1st. A team gets its place once everyone in it has a number, so give each team the same number of people.` });
    return choices;
  }
  const choices = [
    { id: 'most', title: most, sub: `The ${words.person} with the ${theMost} when it ends comes 1st.` },
    { id: 'target', title: 'Reach a target', sub: `You set the target, such as ${example(own ? 100 : 12)}. Everyone who reaches it wins.` },
  ];
  if (fastest) choices.push({ id: 'lowest', title: lowest, sub: `For a time, such as ${aTime}. Your staff enter each ${words.person}'s time in ${timeWord}, and the lowest comes 1st.` });
  return choices;
}

/** Each person for themselves, or in teams, and who puts people in the teams: said as the
 *  challenge's own page says it afterwards (`teamsHeading`). */
export function teamChoices(words) {
  return [
    { id: 'none', title: 'Individual', sub: `Each ${words.person} competes on their own.` },
    { id: 'staff', title: 'Teams: you put people in them', sub: `You name the teams, then put each ${words.person} in one.` },
    { id: 'members', title: `Teams: your ${words.people} pick their own`, sub: `You name the teams. Each ${words.person} picks their own in the app.` },
  ];
}

/** Who is in it. */
export function whoChoices(words, inApp, teams = 'none') {
  return [
    { id: 'everyone', title: 'Everyone in the app', sub: `Everybody using the app is in it: ${peopleCount(inApp)}. Nobody has to do anything.` },
    // Where members pick their team, picking one is how they join.
    { id: 'joined', title: 'Only people who join', sub: teams === 'members' ? `Your ${words.people} see it and join by picking a team.` : `Your ${words.people} see it and tap Join.` },
  ];
}

/** An empty form: the commonest challenge, gym visits the app counts, the most wins,
 *  everyone in. `exercise`: the library's slug, '' until picked. `ownUnit`: what was typed
 *  for something of the gym's own, kept while another subject is tried; never sent. */
export function newChallengeDraft() {
  return { name: '', details: '', prize: '', subject: 'gym_visits', measure: 'days', countedBy: 'app', exercise: '', unit: '', ownUnit: '', startsOn: '', endsOn: '', win: 'most', target: '', who: 'everyone', teams: 'none', teamList: blankTeams() };
}

/** Two empty teams: the fewest a challenge in teams has. */
const blankTeams = () => [
  { id: null, name: '' },
  { id: null, name: '' },
];
const hasTeams = (c) => (c.teams ?? 'none') !== 'none';
/** A challenge's teams as the form and the rules hold them. */
const teamsOf = (challenge) => (challenge.teamList ?? []).map((team) => ({ id: team.id, name: team.name }));

/** The form filled in from a challenge as the server has it. */
export function draftOf(challenge) {
  return {
    name: challenge.name,
    details: challenge.details,
    prize: challenge.prize,
    subject: challenge.subject,
    measure: challenge.measure,
    countedBy: challenge.countedBy,
    exercise: (challenge.exercises ?? [])[0] ?? '',
    unit: challenge.unit ?? '',
    ownUnit: challenge.subject === 'own' ? (challenge.unit ?? '') : '',
    startsOn: challenge.startsOn,
    endsOn: challenge.endsOn,
    win: challenge.target !== null ? 'target' : challenge.lowestWins ? 'lowest' : 'most',
    target: challenge.target === null ? '' : String(challenge.target),
    who: challenge.who,
    teams: challenge.teams ?? 'none',
    teamList: hasTeams(challenge) ? teamsOf(challenge) : blankTeams(),
  };
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

/** What the draft is about and who counts it, as it is sent. */
const kindOf = (draft) => ({ subject: draft.subject, measure: isOwn(draft) ? null : draft.measure, countedBy: draft.countedBy, exercises: (draft.exercise ?? '') === '' ? [] : [draft.exercise] });
/** The draft is about a subject the gym picks an exercise for. */
const picksExercise = (draft) => challengeSubject(draft.subject)?.pickExercise === true;

/** The rules a draft would be saved with; `target` null where the most wins. */
const rulesOf = (draft) => ({
  ...kindOf(draft),
  startsOn: draft.startsOn,
  endsOn: draft.endsOn,
  target: draft.win === 'target' ? wholeNumber(draft.target) : null,
  who: draft.who,
  lowestWins: isOwn(draft) && draft.win === 'lowest',
  teams: draft.teams,
  teamList: hasTeams(draft) ? draft.teamList.map((team) => ({ id: team.id, name: team.name.trim() })) : [],
});

/** Once a challenge has started, what it counts, its first day, who is in it, its target
 *  and its teams stay as they are (the server's own rule). */
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
  if (picksExercise(draft) && (draft.exercise ?? '') === '') return { field: 'exercise', text: 'Pick the exercise.' };
  if (isOwn(draft)) {
    if (!eventNameIsSeen(draft.unit)) return { field: 'unit', text: 'Say what your staff count, for example push-ups.' };
    if (postLength(draft.unit.trim()) > CHALLENGE_LIMITS.unit) return { field: 'unit', text: `Keep what your staff count to ${CHALLENGE_LIMITS.unit} characters.` };
  }
  if (draft.win === 'target') {
    const target = wholeNumber(draft.target);
    const unit = wordsOf(draft);
    if (target === null || target < 1) return { field: 'target', text: `Type how many ${unit} to reach, as a whole number.` };
    // A team's number is several people's added together: it is not bound by the days.
    if (!kindPerDay(kindOf(draft)) || hasTeams(draft)) {
      if (target > CHALLENGE_LIMITS.score) return { field: 'target', text: `The target can be ${count(CHALLENGE_LIMITS.score)} at most.` };
    } else if (target > days) {
      return { field: 'target', text: `One a day is counted and this challenge is ${plural(days, 'day')} long, so the most anyone can reach is ${count(days)}. Type ${count(days)} or less, or make it longer.` };
    }
  }
  if (hasTeams(draft)) {
    const names = draft.teamList.map((team) => team.name.trim());
    if (names.length < TEAM_LIMITS.min) return { field: 'teams', text: `A challenge in teams needs at least ${TEAM_LIMITS.min} teams.` };
    const empty = names.findIndex((name) => !eventNameIsSeen(name));
    if (empty !== -1) return { field: 'teams', text: `Give team ${empty + 1} a name, or remove it.` };
    const long = names.find((name) => postLength(name) > TEAM_LIMITS.name);
    if (long !== undefined) return { field: 'teams', text: `Keep each team's name to ${TEAM_LIMITS.name} characters.` };
    const twice = names.find((name, i) => names.findIndex((other) => teamNameKey(other) === teamNameKey(name)) !== i);
    if (twice !== undefined) return { field: 'teams', text: `Two teams are called ${twice}. Give each team its own name.` };
  }
  if (postLength(draft.prize.trim()) > CHALLENGE_LIMITS.prize) return { field: 'prize', text: `Keep the prize to ${CHALLENGE_LIMITS.prize} characters.` };
  if (postLength(draft.details.trim()) > CHALLENGE_LIMITS.details) return { field: 'details', text: `Keep the details to ${CHALLENGE_LIMITS.details} characters.` };
  const rule = challengeSaveProblem({
    today,
    before:
      before === null
        ? null
        : { subject: before.subject, measure: before.measure, countedBy: before.countedBy, exercises: before.exercises ?? [], startsOn: before.startsOn, endsOn: before.endsOn, target: before.target, who: before.who, lowestWins: before.lowestWins === true, teams: before.teams ?? 'none', teamList: teamsOf(before) },
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
  const same = ['name', 'details', 'prize', 'subject', 'measure', 'countedBy', 'unit', 'startsOn', 'endsOn', 'target', 'who', 'lowestWins'].every((key) => challenge[key] === fields[key]);
  const names = (list) => (list ?? []).map((team) => team.name).join('\n');
  return same && names((challenge.exercises ?? []).map((name) => ({ name }))) === names((fields.exercises ?? []).map((name) => ({ name }))) && (challenge.teams ?? 'none') === (fields.teams ?? 'none') && names(challenge.teamList) === names(fields.teamList);
}

/** What is sent as a CHANGE to the challenge an earlier press of an Add form made: its
 *  teams by the ids the server gave them, so they are kept and not made again. */
export function fieldsForKept(fields, kept) {
  const byName = new Map((kept.teamList ?? []).map((team) => [teamNameKey(team.name), team.id]));
  return { ...fields, teamList: (fields.teamList ?? []).map((team) => ({ id: byName.get(teamNameKey(team.name)) ?? null, name: team.name })) };
}

/** "500 characters left", and whether it is over. */
export function detailsLine(text) {
  const left = CHALLENGE_LIMITS.details - postLength(text.trim());
  if (left >= 0) return { over: false, text: `${count(left)} characters left` };
  return { over: true, text: `${count(-left)} characters too many` };
}

/** After the target box: what the number is a number of. '' until the staff's own word is typed. */
export function targetUnit(draft) {
  const u = wordsOf(draft);
  if (u === '') return '';
  return hasTeams(draft) ? `${u}, for a whole team` : u;
}

/** Under the target box: the most that can be reached, once the days are known. */
export function targetHint(draft) {
  if (hasTeams(draft)) return "A team's number is its people's numbers added together. Every team that reaches this wins.";
  if (isOwn(draft)) return 'Everybody whose number reaches this wins.';
  const days = draftDays(draft);
  const unit = draftWords(draft).one;
  if (days === null) return `One ${unit} a day is the most anybody can get.`;
  return `One ${unit} a day is the most anybody can get, and this challenge is ${plural(days, 'day')} long: ${count(days)} is the highest number that can be reached.`;
}

/** Under the first day: a start in the past already counts. */
export function startHint(draft, today) {
  if (draft.startsOn === '' || draft.startsOn >= today || isOwn(draft)) return null;
  return `${capital(draftWords(draft).many)} since ${dayLabel(draft.startsOn)} already count.`;
}

/** A gym that checks nobody in gets no gym days: said under the choice, before it is saved. */
export function notCheckingInNote(draft, list, words) {
  if (draft.subject !== 'gym_visits' || draft.countedBy !== 'app' || list.checkingIn) return null;
  return `Nobody has been checked in at your front desk in the last 30 days. Gym days only come from check-ins, so every ${words.person} would stay at 0. Check people in at the front desk, or pick Workouts in the app.`;
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

/** How a challenge is won, in the line its members read: "Most gym days wins". */
export function wonLine(challenge) {
  return winLine({ words: challenge.words, target: challenge.target, lowestWins: challenge.lowestWins === true, teamed: hasTeams(challenge) });
}

/** The three facts on a challenge's page: each says what, then one thing worth knowing
 *  about it. A number never stands without its word. */
export function cardFacts(challenge, inApp, words) {
  const teamed = hasTeams(challenge);
  const wonNote = challenge.target !== null ? (teamed ? 'Every team that gets there wins' : 'Everyone who gets there wins') : teamed ? "A team's number is its people's added together" : 'Equal numbers share a place';
  const who =
    challenge.who === 'everyone'
      ? { value: 'Everyone in the app', note: peopleCount(inApp) }
      : { value: `${words.peopleCap} who join`, note: challenge.joinedCount === 0 ? 'Nobody has joined yet' : `${peopleCount(challenge.joinedCount)} ${challenge.joinedCount === 1 ? 'has' : 'have'} joined` };
  return [
    { label: 'About', value: challenge.words.about, note: staffCount(challenge) ? 'Counted by your staff' : challenge.words.howLine },
    { label: 'How it is won', value: wonLine(challenge), note: wonNote },
    { label: 'Who is in it', value: who.value, note: who.note },
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

/** What somebody "has" once something of theirs counts: "a gym day"; "a number" where the staff count. */
const aThing = (challenge) => (staffCount(challenge) ? 'a number' : `a ${challenge.words.one}`);

/** How many people have a number so far, in the challenge's own words; null where the
 *  card was not sent it. */
export function withNumberLine(challenge) {
  if (challenge.withNumber === null || challenge.withNumber === undefined) return null;
  const what = aThing(challenge);
  if (challenge.withNumber === 0) return `Nobody has ${what} yet`;
  return `${peopleCount(challenge.withNumber)} ${challenge.withNumber === 1 ? 'has' : 'have'} ${what}`;
}

/** Above the first three on a card, or why there are none to show. Null where the card
 *  was not sent them. */
export function leadersLine(challenge, words) {
  if (challenge.withNumber === null || challenge.withNumber === undefined) return null;
  // In teams the card lists the teams in place of the first three people.
  if (hasTeams(challenge)) return null;
  if ((challenge.top ?? []).length > 0) return 'In the lead';
  if (challenge.withNumber === 0) return null;
  return `${words.peopleCap} see no places until 3 people they can see have ${aThing(challenge)}.`;
}

/** What staff are told about a challenge's result post in Updates (ROADMAP 19d-ii-b), or
 *  null with nothing to say. `mayPost`: this worker can open Updates; `who` says who can
 *  when they cannot. `readOnly`: the gym is on no plan. */
export function resultPostNote(challenge, mayPost, words, readOnly = false) {
  if (challenge.cancelled) return null;
  // On no plan nothing is posted, so nothing is promised.
  if (challenge.state !== 'ended') return readOnly ? null : { text: `When it ends, its result is posted to Updates for your ${words.people}.`, link: false, who: null };
  const post = challenge.resultPost ?? null;
  if (post === null) return null;
  if (post.removed) return { text: `Its result post was removed from Updates, so your ${words.people} don't see it there now.`, link: false, who: null };
  const who = mayPost ? null : 'The owner and staff who post updates can open it there.';
  if (post.hidden === true) return { text: `Its result post is hidden from your ${words.people} while it waits in Reported posts on Updates.`, link: mayPost, who };
  return { text: 'Its result is posted in Updates.', link: mayPost, who };
}

/** Whether staff type this challenge's numbers on `today`: where they count it, from its
 *  first day until members stop seeing its result; never a cancelled one (the server's rule). */
export function takesNumbers(challenge, today) {
  return challengeTakesNumbers(challenge, today);
}

/** The numbers to send, a save's worth at a time. */
export function inSaves(scores) {
  const saves = [];
  for (let i = 0; i < scores.length; i += GYM_CHALLENGE_SCORES_A_SAVE) saves.push(scores.slice(i, i + GYM_CHALLENGE_SCORES_A_SAVE));
  return saves;
}

/** What Previous and Next say beside them while boxes are typed and not saved; null with none. */
export function unsavedNote(typed) {
  const n = Object.keys(typed).length;
  if (n === 0) return null;
  return `${n === 1 ? '1 number is' : `${count(n)} numbers are`} typed and not saved yet. They are kept while you change page; press Save numbers to save them all.`;
}

/** What is typed in a person's number box, as the number to save: "" is none; null is not a number. */
export function typedNumber(text) {
  const t = String(text).trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d{1,7}$/.test(t) || Number(t) > CHALLENGE_LIMITS.score) return { ok: false, value: null };
  return { ok: true, value: Number(t) };
}

/** The numbers to send: only the people whose box no longer says what is kept, on whichever
 *  page they were typed. `rows`: every person loaded so far with the number that is kept.
 *  Null when a box holds something that is no number. */
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

/** The first person whose box holds something that is no number, on whichever page; null with none. */
export function badBox(rows, typed) {
  return rows.find((row) => typed[row.userId] !== undefined && !typedNumber(typed[row.userId]).ok) ?? null;
}

export const NUMBER_NOTES = {
  badFor: (name) => `${name ?? 'One person'}'s box isn't a number. Type a whole number up to ${count(CHALLENGE_LIMITS.score)}, or leave it empty.`,
  bad: `A number is a whole number up to ${count(CHALLENGE_LIMITS.score)}. Leave a box empty for no number.`,
  saved: (n) => `Saved. ${n === 1 ? '1 number' : `${count(n)} numbers`} changed.`,
  none: 'Nothing has changed yet.',
  help: (challenge, words) => `Type each person's ${wordsOf(challenge)} and press Save numbers. An empty box is no number. Your ${words.people} see a saved number straight away.`,
};

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
  const hidden = board.hidden;
  if (board.memberStatus === 'too_few') {
    lines.push(`${words.peopleCap} see no places yet: fewer than 3 people they can see have ${aThing(challenge)} in it.`);
  } else {
    lines.push(`${words.peopleCap} see ${peopleCount(board.ranked)} on its board${hidden > 0 ? `; ${count(hidden)} more ${hidden === 1 ? 'is' : 'are'} listed here and hidden from them` : ''}.`);
  }
  if (board.reached !== null) {
    lines.push(board.reached === 0 ? `Nobody has reached ${amountOf(challenge, challenge.target)} yet.` : `${peopleCount(board.reached)} ${board.reached === 1 ? 'has' : 'have'} reached ${amountOf(challenge, challenge.target)}.`);
  }
  return lines;
}

/** What a board's row says after the name: why members do not see the person, or that
 *  nothing of theirs has counted yet. Null for somebody members see. */
export function rowNote(row, challenge = null) {
  // The name's own place already reads "No name yet": the tag says what follows from it.
  if (row.hidden === 'no_name') return 'Hidden until they add a name';
  if (row.hidden !== null) return HIDDEN_TAG[row.hidden];
  if (row.value === 0) return challenge !== null && staffCount(challenge) ? 'No number yet' : 'Nothing counted yet';
  return null;
}

/** The words where a board has nobody on it. */
export function emptyBoard(board, challenge) {
  if (board.memberStatus === 'not_started' && challenge.who === 'joined') return 'Nobody has joined yet.';
  if (board.memberStatus === 'not_started') return null;
  return challenge.who === 'joined' ? 'Nobody has joined yet.' : staffCount(challenge) ? 'Nobody is in the app here yet.' : `Nobody has ${aThing(challenge)} in it yet.`;
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
export const LOCKED_NOTE = "This challenge has started, so what it counts, its first day, who is in it, how it is won and its teams can't change now. You can still change its name, prize, details and last day.";

// ── TEAMS (ROADMAP 19d-ii-a) ──

export const inTeams = hasTeams;

/** Whether staff may put people in teams on `today` (the server's rule). */
export function takesTeams(challenge, today) {
  return challengeTakesTeams({ teams: challenge.teams ?? 'none', endsOn: challenge.endsOn, cancelled: challenge.cancelled }, today);
}

/** The form's teams with one more, one fewer, or one renamed. */
export const withTeamAdded = (draft) => (draft.teamList.length >= TEAM_LIMITS.max ? draft : { ...draft, teamList: [...draft.teamList, { id: null, name: '' }] });
export const withTeamRemoved = (draft, at) => (draft.teamList.length <= TEAM_LIMITS.min ? draft : { ...draft, teamList: draft.teamList.filter((_team, i) => i !== at) });
export const withTeamNamed = (draft, at, name) => ({ ...draft, teamList: draft.teamList.map((team, i) => (i === at ? { ...team, name } : team)) });

/** Before Save: the teams with people in them that saving would remove, each in a line
 *  that names the team and how many people it has. */
export function removedTeamLines(draft, before) {
  if (before === null || before === undefined) return [];
  const kept = new Set(hasTeams(draft) ? draft.teamList.flatMap((team) => (team.id === null ? [] : [team.id])) : []);
  return (before.teamList ?? [])
    .filter((team) => !kept.has(team.id) && team.people > 0)
    .map((team) => `${team.name} has ${peopleCount(team.people)} in it. Saving removes the team, and ${team.people === 1 ? 'that person is' : 'those people are'} left in no team. Nobody is told.`);
}

/** Above the teams on a card. */
export function teamsHeading(challenge, words) {
  return challenge.teams === 'staff' ? 'Teams · you put people in them' : `Teams · your ${words.people} pick their own`;
}

/** The teams on a challenge's page: the placed first, then the rest in the gym's order.
 *  `numbers`: each team's number and place as read with the board, for a challenge whose
 *  list did not carry them (an ended one); null for none. */
export function teamLines(challenge, numbers = null) {
  if (!hasTeams(challenge)) return [];
  const read = new Map((numbers ?? []).map((team) => [team.id, team]));
  return (challenge.teamList ?? [])
    .map((team) => ((team.value ?? null) === null && read.has(team.id) ? { ...team, value: read.get(team.id).value, place: read.get(team.id).place } : team))
    .map((team, at) => ({ team, at }))
    .sort((a, b) => Number((a.team.place ?? null) === null) - Number((b.team.place ?? null) === null) || (a.team.place ?? 0) - (b.team.place ?? 0) || a.at - b.at)
    .map(({ team }) => ({
      id: team.id,
      name: team.name,
      place: team.place ?? null,
      placeText: (team.place ?? null) === null ? null : ordinal(team.place),
      people: team.people === 0 ? 'Nobody yet' : peopleCount(team.people),
      number: (team.value ?? null) === null ? null : amountOf(challenge, team.value),
    }));
}

/** Under the teams on a challenge's page: what its numbers leave out, and when a team is
 *  placed where the lowest wins. Nothing while no team has a number. */
export function teamNotes(challenge, lines) {
  if (!lines.some((team) => team.number !== null)) return [];
  const notes = ["A team's number leaves out people your members can't see: staff, under-18s and anyone who chose Hide me."];
  if (challenge.lowestWins) notes.push('The lowest total wins. A team has a place once everyone in it has a number.');
  return notes;
}

/** A team's name by its id; "No team" for none. */
export function teamName(challenge, teamId) {
  if (teamId === null || teamId === undefined) return 'No team';
  return (challenge.teamList ?? []).find((team) => team.id === teamId)?.name ?? 'No team';
}

/** Who to send: only the people whose team is no longer the one that is kept, on whichever
 *  page they were moved. `known`: every person loaded so far with the team that is kept. */
export function teamsToSave(known, moved) {
  const people = [];
  for (const person of known) {
    const to = moved[person.userId];
    if (to === undefined || to === (person.teamId ?? null)) continue;
    people.push({ userId: person.userId, name: person.name, from: person.teamId ?? null, teamId: to });
  }
  return people;
}

/** The people to send, a save's worth at a time. */
export function inTeamSaves(people) {
  const saves = [];
  for (let i = 0; i < people.length; i += GYM_CHALLENGE_TEAM_PEOPLE_A_SAVE) saves.push(people.slice(i, i + GYM_CHALLENGE_TEAM_PEOPLE_A_SAVE).map((p) => ({ userId: p.userId, teamId: p.teamId })));
  return saves;
}

const NAMED = 5;

/** The box before people are moved: who changes team, from which to which, and who won't. */
export function teamsBox(changes, challenge, words, all = false) {
  const n = changes.length;
  const lines = (all ? changes : changes.slice(0, NAMED)).map((p) => `${p.name ?? 'No name yet'}: ${teamName(challenge, p.from)} → ${teamName(challenge, p.teamId)}`);
  if (!all && n > NAMED) lines.push(`and ${count(n - NAMED)} more`);
  lines.push('Nobody else is moved.');
  lines.push(
    challenge.state === 'running'
      ? `The challenge is running, so each of these people's numbers moves with them: the teams' numbers change straight away. Your ${words.people} see their new team in the app. Nobody is emailed.`
      : `Your ${words.people} see their team in the app. Nobody is emailed.`,
  );
  return { title: n === 1 ? 'Move 1 person?' : `Move ${count(n)} people?`, lines, seeAll: !all && n > NAMED ? `See all ${count(n)}` : null, yes: n === 1 ? 'Move 1 person' : `Move ${count(n)} people`, no: 'Keep editing' };
}

/** Beside Previous and Next while people are moved and not saved; null with none. */
export function unsavedTeamsNote(n) {
  if (n === 0) return null;
  return `${n === 1 ? '1 person is' : `${count(n)} people are`} moved and not saved yet. They are kept while you change page; press Save teams to save them all.`;
}

export const TEAM_NOTES = {
  saved: (n) => `Saved. ${n === 1 ? '1 person' : `${count(n)} people`} moved.`,
  none: 'Nobody has been moved yet. Pick a team beside a person first.',
  help: (challenge, words) =>
    challenge.teams === 'members'
      ? `Your ${words.people} pick their own team in the app. You can also put somebody in a team here, or move them: pick the team beside their name and press Save teams.`
      : 'Pick a team beside each person and press Save teams. Somebody left on No team is in the challenge, and their number counts for no team.',
};

/** The button that opens the board to put people in teams. */
export const TEAMS_BUTTON = 'Put people in teams';

// ── THE LIST'S ROWS, AND THE FORM'S SUMMARY ──

/** A row's one line of what a challenge is: "Most gym days wins · Everyone in the app · 143 people". */
export function rowSummary(challenge, inApp, words) {
  const [, won, who] = cardFacts(challenge, inApp, words);
  return `${won.value} · ${who.value} · ${who.note.charAt(0).toLowerCase()}${who.note.slice(1)}`;
}

/** Who is first, for a row: the leading team, else the leading person; null with nobody. */
export function rowLeader(challenge) {
  if (hasTeams(challenge)) {
    const first = teamLines(challenge).find((team) => team.place === 1);
    return first === undefined ? null : `${first.name} · ${first.number}`;
  }
  const first = (challenge.top ?? []).find((person) => person.place === 1);
  return first === undefined ? null : `${first.name} · ${amountOf(challenge, first.value)}`;
}

/** How the form's challenge is won, in the line members will read; said in general words
 *  while the staff's own word or the target is not typed yet. */
function draftWon(draft) {
  const u = wordsOf(draft);
  const teamed = hasTeams(draft);
  const target = draft.win === 'target' ? wholeNumber(draft.target) : null;
  if (draft.win === 'target' && (target === null || u === '')) {
    const reach = target === null ? 'a target' : count(target);
    return teamed ? `Reach ${reach} as a team` : `Reach ${reach}`;
  }
  if (draft.win === 'lowest') return teamed ? 'The fastest team wins' : 'Fastest time wins';
  if (u === '') return teamed ? 'The team with the highest number wins' : 'Highest number wins';
  return winLine({ words: draftWords(draft), target, lowestWins: isOwn(draft) && draft.win === 'lowest', teamed });
}

/** The challenge the form holds, said back in a few lines as it is filled in. `empty`:
 *  nothing is there yet, and the line says what is missing. */
export function draftSummary(draft, list, words) {
  const name = draft.name.trim();
  const days = draftDays(draft);
  const unit = wordsOf(draft);
  const teamed = hasTeams(draft);
  const named = draft.teamList.map((team) => team.name.trim()).filter((team) => team !== '');
  const about = draftWords(draft);
  const counted = isOwn(draft) ? 'counted by your staff' : lower(about.howLine);
  const lines = [
    { label: 'Name', value: name === '' ? 'Not named yet' : name, empty: name === '' },
    { label: 'When', value: days === null ? 'Days not picked yet' : datesLine(draft, list.today), empty: days === null },
    picksExercise(draft) && (draft.exercise ?? '') === ''
      ? { label: 'About', value: `Exercise not picked yet · ${counted}`, empty: true }
      : { label: 'About', value: unit === '' ? 'Not said yet · counted by your staff' : `${about.about} · ${counted}`, empty: unit === '' },
    { label: 'How it is won', value: draftWon(draft), empty: false },
    { label: 'Who is in it', value: draft.who === 'everyone' ? `Everyone in the app · ${peopleCount(list.inApp)}` : `${words.peopleCap} who join`, empty: false },
    {
      label: 'Teams',
      value: !teamed ? 'Individual, no teams' : `${named.length === 0 ? 'Not named yet' : named.join(', ')} · ${draft.teams === 'staff' ? 'you put people in them' : `your ${words.people} pick their own`}`,
      empty: teamed && named.length === 0,
    },
    { label: 'Prize', value: draft.prize.trim() === '' ? 'None' : draft.prize.trim(), empty: draft.prize.trim() === '' },
  ];
  return lines;
}
