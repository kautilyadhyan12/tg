// THE CONSOLE LEADERBOARD'S WORDS (spec Part 3 §15.5; ROADMAP 19a-iii). Pure, so every
// sentence is tested without a browser. Written for someone who opened a gym last week.
import { BOARD_TABS } from '../../components/gym/leaderboardView';

export function canSeeLeaderboard(privileges) {
  return Array.isArray(privileges) && privileges.includes('leaderboard.manage');
}

const count = (n) => n.toLocaleString('en');
const UNIT = { gym_days: 'gym day', workout_days: 'workout day', streak: 'streak' };

/** What each board counts, in one line a new gym understands. */
export const WHAT_IT_COUNTS = {
  gym_days: 'One for each day a person was checked in at the front desk or by staff.',
  workout_days: 'One for each day a person finished a workout in the app.',
  streak: 'Weeks in a row with at least one check-in.',
};

/** Why members do not see this person, as the tag on their row. */
export const HIDDEN_TAG = {
  staff: 'Staff, not ranked',
  taken_off: 'Taken off by staff',
  hide_me: 'Chose Hide me',
  under_18: 'Under 18',
  no_name: 'No name yet',
};

/** The same reason as a sentence, on the person's panel. */
export function hiddenLine(reason, words) {
  switch (reason) {
    case 'staff':
      return `Staff are never ranked, so ${words.people} don't see them on the board.`;
    case 'taken_off':
      return `Your staff took them off the board. ${words.peopleCap} don't see them.`;
    case 'hide_me':
      return `They switched on Hide me in their app. ${words.peopleCap} don't see them, and only they can switch it off.`;
    case 'under_18':
      return `They are under 18, so they are hidden until they choose to be shown.`;
    case 'no_name':
      return 'They have not added their name in the app yet, so they are not shown.';
    default:
      return null;
  }
}

export function nameOf(person) {
  return person.name ?? 'No name yet';
}

/** One board's switch: whether members see it, and the reason when they do not. `board` is
 *  the page's answer for the board and period on screen. */
export function boardSwitch(boardId, board, words) {
  const label = BOARD_TABS.find((t) => t.id === boardId)?.label ?? '';
  const on = !board.boardsOff.includes(boardId);
  let line;
  if (!on) line = `Switched off. ${words.peopleCap} don't see this board.`;
  else if (!board.live) line = `Not showing to ${words.people}: this ${words.it} has no plan right now.`;
  else if (boardId !== 'workout_days' && !board.checkingIn) {
    line = `Not showing to ${words.people}: nobody has been checked in at the front desk in the last 30 days.`;
  } else if (boardId === board.board && board.memberStatus === 'too_few') {
    line =
      boardId === 'streak'
        ? `Not showing to ${words.people} yet: fewer than 3 people have a streak.`
        : `Not showing to ${words.people} yet: fewer than 3 people have a ${UNIT[boardId]} in this period.`;
  } else if (boardId === board.board) line = `${words.peopleCap} see this board.`;
  else line = `${words.peopleCap} see this board when 3 or more people are on it.`;
  return { id: boardId, label, on, line, showing: on && boardId === board.board && board.memberStatus === 'shown' };
}

/** "9 people have a gym day · members see 4" */
export function countLine(board, words) {
  if (board.total === 0) return null;
  const unit = board.board === 'streak' ? 'a streak' : `a ${UNIT[board.board]}`;
  const have = `${count(board.total)} ${board.total === 1 ? 'person has' : 'people have'} ${unit}`;
  const hidden = board.total - board.ranked;
  if (hidden === 0) return have;
  return `${have} · ${count(hidden)} ${hidden === 1 ? 'is' : 'are'} hidden from ${words.people}`;
}

export function emptyLine(board) {
  if (board.board === 'streak') {
    return board.checkingIn
      ? 'Nobody has a streak yet. A streak is weeks in a row with at least one check-in.'
      : 'Nobody has a streak: no one has been checked in at the front desk in the last 30 days.';
  }
  return board.board === 'gym_days' ? 'Nobody was checked in during this period.' : 'Nobody finished a workout in the app during this period.';
}

/** People on the list who cannot be on a board. */
export function notInAppLine(n, words) {
  if (n === 0) return null;
  return n === 1
    ? `1 ${words.person} on your list doesn't have the app yet, so they aren't on any board.`
    : `${count(n)} ${words.people} on your list don't have the app yet, so they aren't on any board.`;
}

/** Which week the seven flames are, when the board's own dates are not that week. */
export function flamesNote(board) {
  if (board.board === 'streak') return 'the flames are the last 7 weeks';
  return board.period === 'this_week' || board.period === 'last_week' ? null : 'the flames are this week';
}

export function pageLine(board) {
  return board.pages > 1 ? `Page ${count(board.page)} of ${count(board.pages)}` : null;
}

/** What the row says under "What members see". A place and "On the board" only while
 *  members really see this board. */
export function rowTag(row, board) {
  if (row.hidden !== null) return { tag: true, text: HIDDEN_TAG[row.hidden] };
  return { tag: false, text: board.memberStatus === 'shown' ? 'On the board' : 'Board not showing' };
}

/** One board's line on a person's panel: "1st · 3 gym days", or why there is no place. */
export function panelPlace(board, hidden) {
  if (board.place !== null) return null;
  if (hidden === null && board.value > 0 && board.memberStatus !== 'shown') return "No place — members don't see this board now";
  return 'No place';
}

/** The box before a person is taken off the board, or put back: what changes and what
 *  stays. `profile` is the server's answer for the person: `hiddenWithoutTakeOff` is why
 *  members would not see them anyway, and a place on a board means members see them now. */
export function takeOffBox(profile, takenOff, gymName, words) {
  const name = nameOf(profile);
  const anyway = profile.hiddenWithoutTakeOff ?? null;
  const ranked = Array.isArray(profile.boards) && profile.boards.some((b) => b.place !== null);
  const ownRow = `In their app, their own row will say "${gymName} took you off the board".`;
  if (takenOff) {
    const title = `Take ${name} off the board?`;
    const button = 'Take off the board';
    if (anyway !== null) {
      return {
        title,
        button,
        changes: [
          `${name} is already hidden from ${words.people} (${HIDDEN_TAG[anyway]}). Taking them off keeps them hidden even if that changes.`,
          ownRow,
        ],
        keeps: ['Their visits and workouts are kept.', "Nobody else's place changes."],
        done: `${name} is taken off the board.`,
      };
    }
    return {
      title,
      button,
      changes: [`${name} — ${words.people} will not see them on any board at ${gymName}.`, ownRow],
      keeps: ['Their visits and workouts are kept.', ranked ? 'Nobody else is removed. People below them move up.' : 'Nobody else is removed.'],
      done: `${name} is off the board.`,
    };
  }
  const title = `Put ${name} back on the board?`;
  const button = 'Put back on the board';
  if (anyway !== null) {
    return {
      title,
      button,
      changes: [`${name} will no longer be taken off by your staff.`, `${words.peopleCap} still won't see them. ${hiddenLine(anyway, words)}`],
      keeps: ['Nothing else changes.'],
      done: `${name} is no longer taken off, and is still hidden (${HIDDEN_TAG[anyway]}).`,
    };
  }
  return {
    title,
    button,
    changes: [`${name} — ${words.people} will see them again, on every board that is showing where they have a number.`],
    keeps: ['Nothing else changes.'],
    done: `${name} is back on the board.`,
  };
}
/** A workout that did not count, said about somebody else. */
export function staffWorkoutNotCountedText(item, gymName) {
  switch (item.why) {
    case 'saved_late':
      return `Saved more than ${item.daysLate} days after the workout — a workout counts when it is saved within 7 days`;
    case 'saved_early':
      return 'Saved before its own start time';
    case 'before_joining':
      return `Before they joined ${gymName}`;
    case 'no_sets':
      return 'No reps or holds saved';
    case 'future':
      return 'Its time is still ahead — it counts once that time has passed';
    default:
      return "Didn't count";
  }
}

export function staffVisitNotCountedText(item) {
  return item.why === 'own_tap'
    ? 'Their own "I\'m here" tap — only front-desk and staff check-ins count'
    : "Checked in with the app's code — only front-desk and staff check-ins count";
}
