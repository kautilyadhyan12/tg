// THE LEADERBOARD'S WORDS (spec Part 3 §15.5). Pure, so every sentence is tested without a
// browser. Dates arrive as the gym's own calendar days ("2026-10-05") and are printed as
// they are; times are printed in the gym's zone.

export const BOARD_TABS = [
  { id: 'gym_days', label: 'Gym days' },
  { id: 'workout_days', label: 'Workout days' },
  { id: 'streak', label: 'Streak' },
];

// What each board counts one of.
const UNIT = { gym_days: 'gym day', workout_days: 'workout day', streak: 'week' };
const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** The tabs a member is offered: every board the gym has not switched off. */
export function boardTabs(boardsOff) {
  const off = Array.isArray(boardsOff) ? boardsOff : [];
  return BOARD_TABS.filter((t) => !off.includes(t.id));
}
export const PERIODS = [
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'all_time', label: 'All time' },
];

// Fixed words, not Intl: its month names differ between ICU versions ("Sep", "Sept").
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const asDate = (day) => new Date(`${day}T00:00:00Z`);

/** "Mon 5 Oct" */
export function dayLabel(day) {
  const d = asDate(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "5 Oct" */
export function shortDay(day) {
  const d = asDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "M", "T", … for a week view's circles. */
export function weekdayInitial(day) {
  return WEEKDAYS[asDate(day).getUTCDay()].charAt(0);
}

/** The board's dates, in the gym's calendar. */
export function datesLine(board) {
  const whose = `${board.gymName}'s time`;
  if (board.board === 'streak') return `Weeks in a row, up to this week · ${whose}`;
  if (board.from === null) return `Every ${UNIT[board.board]} up to ${dayLabel(board.to)} · ${whose}`;
  return `${dayLabel(board.from)} – ${dayLabel(board.to)} · ${whose}`;
}

/** The ⓘ: what this board counts, in a gym's own words. */
export function whatCounts(boardId, gymName) {
  const common = 'Equal numbers share a place. Staff, under-18s and anyone who chose Hide me are not shown.';
  if (boardId === 'streak') {
    return [
      'Weeks in a row, Monday to Sunday, with at least one gym day.',
      'Last week keeps your streak going until this Sunday ends.',
      `A week when ${gymName} checked nobody in doesn't count and doesn't break it.`,
      common,
    ];
  }
  if (boardId === 'workout_days') {
    return [
      `One workout day for each day you finished a workout in the app since you joined ${gymName}, at the gym or at home.`,
      'Two workouts on one day are one workout day. A workout counts however its reps were counted, by the camera or by you.',
      'It needs at least one set with a rep or a hold, and to be saved within 7 days.',
      common,
    ];
  }
  return [
    `One gym day for each day you were checked in at ${gymName} — a scan at the front desk or a check-in by staff.`,
    'Two visits on one day are one gym day. Nothing you tap or type yourself counts.',
    common,
  ];
}

/** Why there is no board to show, or null when there is one. */
export function statusText(board) {
  switch (board.status) {
    case 'too_few':
      return board.board === 'streak'
        ? 'The board shows once 3 people have a streak.'
        : `The board shows once 3 people have a ${UNIT[board.board]} in this period.`;
    case 'no_checkins': {
      const quiet = `${board.gymName} hasn't checked anyone in at the front desk in the last 30 days, so Gym days and Streak aren't showing.`;
      // Workout days needs no front desk, but only while the gym shows it.
      return boardTabs(board.boardsOff).some((t) => t.id === 'workout_days')
        ? `${quiet} Workout days doesn't need the front desk — see that tab.`
        : quiet;
    }
    case 'paused':
      return `The leaderboard isn't available at ${board.gymName} right now.`;
    case 'switched_off':
      return boardTabs(board.boardsOff).length === 0
        ? `${board.gymName} has switched its leaderboard off.`
        : `${board.gymName} has switched this board off.`;
    default:
      return null;
  }
}

/** Why the person's own row is greyed. */
export function hiddenText(reason, gymName) {
  switch (reason) {
    case 'hide_me':
      return 'Hide me is on. Only you see this row.';
    case 'under_18':
      return "You're hidden because you're under 18. Only you see this row.";
    case 'no_name':
      return 'Add your full name in Settings → Profile to be on the board.';
    case 'taken_off':
      return `${gymName} took you off the board. Only you see this row.`;
    case 'staff':
      return 'Staff, not ranked.';
    default:
      return null;
  }
}

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** "5 gym days", "2 workout days", "1 week" */
export function valueText(value, boardId) {
  return plural(value, UNIT[boardId]);
}

/** "2 more gym days to reach 3rd", or null. */
export function nextPlaceText(me, boardId) {
  if (me.toNextPlace === null || me.nextPlace === null) return null;
  return `${plural(me.toNextPlace, `more ${UNIT[boardId]}`)} to reach ${ordinal(me.nextPlace)}`;
}

/** "Updated 10:42 am", in the gym's zone. */
export function updatedText(asOf, timezone) {
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
    .format(new Date(asOf))
    .replace(/\s?([ap])m$/i, (_, p) => ` ${p.toLowerCase()}m`);
  return `Updated ${time}`;
}

/** A visit's time, in the gym's zone. */
export function timeText(at, timezone) {
  return new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
    .format(new Date(at))
    .replace(/\s?([ap])m$/i, (_, p) => ` ${p.toLowerCase()}m`);
}

/** "Sam (staff)", or "staff" when the member of staff has typed no name. */
const staffWords = (by) => (typeof by === 'string' && by.trim() !== '' ? `${by.trim()} (staff)` : 'staff');

/** One counted visit, in words. A visit staff added on a later day has no time of its own:
 *  it says who added it and when. */
export function visitText(visit, timezone) {
  if (typeof visit.addedOn === 'string') return `Added by ${staffWords(visit.by)} on ${shortDay(visit.addedOn)}`;
  const when = timeText(visit.at, timezone);
  if (visit.how === 'staff') return `${when} · checked in by ${visit.by ?? 'staff'}`;
  return `${when} · scanned at ${visit.by ?? 'the front desk'}`;
}

/** "2 visits, 1 day" */
export function dayCountText(visits) {
  return visits === 1 ? '1 visit' : `${visits} visits, 1 day`;
}

/** A visit staff removed: who removed it and when. */
export function removedText(item) {
  const on = typeof item.removedOn === 'string' ? ` on ${shortDay(item.removedOn)}` : '';
  return `Visit removed by ${staffWords(item.by)}${on}`;
}

export function notCountedText(item) {
  if (item.why === 'removed') return removedText(item);
  return item.why === 'own_tap'
    ? 'Your own "I\'m here" tap — only front-desk and staff check-ins count'
    : 'Checked in with the app\'s code — only front-desk and staff check-ins count';
}

/** One counted workout, in words. */
export function workoutText(workout, timezone) {
  const when = timeText(workout.at, timezone);
  const by = { camera: 'counted by the camera', you: 'counted by you', both: 'counted by the camera and by you' }[workout.countedBy];
  return by === undefined ? when : `${when} · ${by}`;
}

/** "2 workouts, 1 day" */
export function workoutCountText(workouts) {
  return workouts === 1 ? '1 workout' : `${workouts} workouts, 1 day`;
}

export function workoutNotCountedText(item, gymName) {
  switch (item.why) {
    case 'saved_late':
      return `Saved more than ${item.daysLate} days after the workout — a workout counts when it is saved within 7 days`;
    case 'saved_early':
      return 'Saved before its own start time — check the date and time on your phone';
    case 'before_joining':
      return `Before you joined ${gymName}`;
    case 'no_sets':
      return 'No reps or holds saved';
    case 'future':
      return 'Its time is still ahead — it counts once that time has passed';
    default:
      return "Didn't count";
  }
}

/** One week of the Streak's "what counted". */
export function weekText(week, gymName) {
  const label = `Week of ${shortDay(week.weekStart)}`;
  switch (week.state) {
    case 'counted':
      return { label, text: `${week.gymDays} gym day${week.gymDays === 1 ? '' : 's'} — counted` };
    case 'open':
      return { label, text: 'This week — still open until Sunday ends' };
    case 'skipped':
      return { label, text: `${gymName} checked nobody in — skipped, it doesn't break the streak` };
    default:
      return { label, text: 'No gym day — the streak counts from after this week' };
  }
}

/** Which seven marks a row carries, for screen readers. */
export function weekLabel(days, boardId) {
  if (boardId === 'streak') return 'Last seven weeks';
  return `Week of ${shortDay(days[0])}, Monday to Sunday`;
}

/** What a circle means, for screen readers. */
export function circleLabel(circle, day, boardId) {
  const when = boardId === 'streak' ? `Week of ${shortDay(day)}` : dayLabel(day);
  const what = {
    yes: boardId === 'streak' ? 'counted' : UNIT[boardId],
    no: boardId === 'workout_days' ? 'no workout day' : 'no gym day',
    skipped: 'nobody checked in at the gym',
    open: 'this week, still open',
  }[circle];
  return `${when}: ${what}`;
}

const PICKED_KEY = 'myGyms.picked';

/** The gym picked last time, if it is still one of the person's gyms. */
export function pickedGym(gyms, stored) {
  return gyms.find((g) => g.id === stored)?.id ?? gyms[0]?.id ?? null;
}

export function readPicked() {
  try {
    return window.localStorage.getItem(PICKED_KEY);
  } catch {
    return null;
  }
}

export function savePicked(id) {
  try {
    window.localStorage.setItem(PICKED_KEY, id);
  } catch {
    // A private window: the picker still works, it just doesn't remember.
  }
}
