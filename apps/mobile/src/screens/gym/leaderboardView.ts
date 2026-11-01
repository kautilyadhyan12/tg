// The gym's leaderboard, in words: the browser's rules (apps/web/src/components/gym/leaderboardView.js) in the phone's
// short words. Pure, so tested alone. Days arrive as the gym's own and are printed as they are; a time is on the gym's clock.
import type {
  GymClockFormat,
  LeaderboardBoard,
  LeaderboardCircle,
  LeaderboardCountedResponse,
  LeaderboardHiddenReason,
  LeaderboardMe,
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardVisit,
  LeaderboardVisitNotCounted,
} from "@app/shared";
import { ordinal, shortDay } from "./classesView";
import { visitTime } from "./visitsView";

export { ordinal };

export const BOARD_TABS: readonly { id: LeaderboardBoard; label: string }[] = [
  { id: "gym_days", label: "Visits" },
  { id: "workout_days", label: "Workout days" },
  { id: "streak", label: "Streak" },
];

export const PERIODS: readonly { value: LeaderboardPeriod; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all_time", label: "All time" },
];

const UNIT: Record<LeaderboardBoard, string> = { gym_days: "visit", workout_days: "workout day", streak: "week" };
const plural = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? "" : "s"}`;

/** The tabs a member is offered: every board the gym has not switched off. */
export function boardTabs(boardsOff: readonly LeaderboardBoard[]): readonly { id: LeaderboardBoard; label: string }[] {
  return BOARD_TABS.filter((t) => !boardsOff.includes(t.id));
}

/** The board to open instead of the one just read, or null to show it. A gym that checks nobody in opens on Workout
 *  days until the person picks a tab; a board the gym switched off gives way to the first still on. */
export function boardInstead(board: Pick<LeaderboardResponse, "board" | "status" | "boardsOff">, picked: boolean): LeaderboardBoard | null {
  if (board.status === "no_checkins" && board.board === "gym_days" && !picked) return "workout_days";
  if (board.status === "switched_off") return boardTabs(board.boardsOff)[0]?.id ?? null;
  return null;
}

/** "5 visits", "2 workout days", "1 week" */
export function valueText(value: number, board: LeaderboardBoard): string {
  return plural(value, UNIT[board]);
}

/** "2 more visits to reach 3rd", or null. */
export function nextPlaceText(me: Pick<LeaderboardMe, "toNextPlace" | "nextPlace">, board: LeaderboardBoard): string | null {
  if (me.toNextPlace === null || me.nextPlace === null) return null;
  return `${plural(me.toNextPlace, `more ${UNIT[board]}`)} to reach ${ordinal(me.nextPlace)}`;
}

/** Why there is no board to show, or null when there is one. */
export function statusText(board: Pick<LeaderboardResponse, "status" | "board" | "gymName">): string | null {
  switch (board.status) {
    case "too_few":
      return board.board === "streak" ? "The board shows once 3 people have a streak." : `The board shows once 3 people have a ${UNIT[board.board]} in this period.`;
    case "no_checkins":
      return `${board.gymName} hasn’t checked anyone in for 30 days, so Visits and Streak aren’t showing.`;
    case "paused":
      return `The leaderboard isn’t available at ${board.gymName} right now.`;
    case "switched_off":
      return `${board.gymName} has switched its leaderboard off.`;
    case "shown":
      return null;
  }
}

/** Why the person's own row is greyed. */
export function hiddenText(reason: LeaderboardHiddenReason, gymName: string): string {
  switch (reason) {
    case "hide_me":
      return "Hide me is on. Only you see this row.";
    case "under_18":
      return "You’re hidden because you’re under 18. Only you see this row.";
    case "no_name":
      return "Add your full name to be on the board.";
    case "taken_off":
      return `${gymName} took you off the board. Only you see this row.`;
    case "staff":
      return "Staff are not ranked.";
  }
}

/** What each board counts, for its box. */
export function whatCounts(board: LeaderboardBoard, gymName: string): string[] {
  const common = "Equal numbers share a place. Staff, under-18s and anyone who chose Hide me are not shown.";
  if (board === "streak") {
    return [
      "Weeks in a row, Monday to Sunday, with at least one visit.",
      "Last week keeps your streak going until this Sunday ends.",
      `A week when ${gymName} checked nobody in doesn’t count and doesn’t break it.`,
      common,
    ];
  }
  if (board === "workout_days") {
    return [
      `One for each day you finished a workout in the app since you joined ${gymName}, wherever you are.`,
      "Two workouts on one day are one workout day. It needs a set with a rep or a hold, saved within 7 days.",
      common,
    ];
  }
  return [`One for each day you were checked in at ${gymName}, by a scan at the front desk or by staff.`, "Two check-ins on one day are one visit. Nothing you tap yourself counts.", common];
}

/** The board's dates, in the gym's calendar. */
export function datesLine(board: Pick<LeaderboardResponse, "board" | "from" | "to" | "gymName">): string {
  const whose = `${board.gymName}’s time`;
  if (board.board === "streak") return `Weeks in a row, up to this week · ${whose}`;
  if (board.from === null) return `Every ${UNIT[board.board]} up to ${shortDay(board.to)} · ${whose}`;
  return `${shortDay(board.from)} – ${shortDay(board.to)} · ${whose}`;
}

/** What the flames stand for, where the page's own dates do not say (RULINGS 2026-10-04). */
export function flamesLine(board: LeaderboardBoard, period: LeaderboardPeriod | null): string | null {
  if (board === "streak") return "The flames are the last seven weeks.";
  return period === "this_week" || period === "last_week" ? null : "The flames are this week.";
}

/** The first letter of a day's name, under a week's flames. */
export function weekdayInitial(day: string): string {
  return shortDay(day).charAt(0);
}

/** What a flame means, for a screen reader. */
export function flameLabel(circle: LeaderboardCircle, day: string, board: LeaderboardBoard): string {
  const when = board === "streak" ? `Week of ${shortDay(day)}` : shortDay(day);
  const what = {
    yes: board === "streak" ? "counted" : UNIT[board],
    no: board === "workout_days" ? "no workout day" : "no visit",
    skipped: "nobody was checked in that week",
    open: "this week, still open",
  }[circle];
  return `${when}: ${what}`;
}

const staffWords = (by: string | null) => (by !== null && by.trim() !== "" ? `${by.trim()} (staff)` : "staff");

/** One counted visit. A visit staff added on a later day has no time of its own: it says who added it and when. */
export function visitText(visit: LeaderboardVisit, zone: string, clock: GymClockFormat): string {
  if (visit.addedOn !== null) return `Added by ${staffWords(visit.by)} on ${shortDay(visit.addedOn)}`;
  const when = visitTime(visit.at, zone, clock);
  return visit.how === "staff" ? `${when} · checked in by ${visit.by ?? "staff"}` : `${when} · scanned at ${visit.by ?? "the front desk"}`;
}

/** A visit in the period that did not count. */
export function notCountedText(item: LeaderboardVisitNotCounted): string {
  if (item.why === "removed") return `Visit removed by ${staffWords(item.by)}${item.removedOn === null ? "" : ` on ${shortDay(item.removedOn)}`}`;
  return item.why === "own_tap" ? "Your own “I’m here” tap. Only front desk and staff check-ins count." : "Checked in with the app’s code. Only front desk and staff check-ins count.";
}

type NotCountedWorkout = LeaderboardCountedResponse["workoutsNotCounted"][number];
type CountedWorkout = LeaderboardCountedResponse["workoutDays"][number]["workouts"][number];
type Week = LeaderboardCountedResponse["weeks"][number];

/** One counted workout: its time, and who counted its reps where the sets say. */
export function workoutText(workout: CountedWorkout, zone: string, clock: GymClockFormat): string {
  const when = visitTime(workout.at, zone, clock);
  if (workout.countedBy === null) return when;
  return `${when} · ${{ camera: "counted by the camera", you: "counted by you", both: "counted by the camera and by you" }[workout.countedBy]}`;
}

/** A workout in the period that did not count. */
export function workoutNotCountedText(item: NotCountedWorkout, gymName: string): string {
  switch (item.why) {
    case "saved_late":
      return `Saved more than ${String(item.daysLate ?? 7)} days after the workout. It counts when saved within 7 days.`;
    case "saved_early":
      return "Saved before its own start time. Check the date and time on your phone.";
    case "before_joining":
      return `Before you joined ${gymName}`;
    case "no_sets":
      return "No reps or holds saved";
    case "future":
      return "Its time is still ahead. It counts once that time has passed.";
  }
}

/** One week of the Streak's What counted. */
export function weekLine(week: Week, gymName: string): { label: string; text: string } {
  const label = `Week of ${shortDay(week.weekStart)}`;
  switch (week.state) {
    case "counted":
      return { label, text: `${plural(week.gymDays, "visit")}, counted` };
    case "open":
      return { label, text: "Still open until Sunday ends" };
    case "skipped":
      return { label, text: `${gymName} checked nobody in. It doesn’t break the streak.` };
    case "missed":
      return { label, text: "No visit. The streak counts from after this week." };
  }
}

/** The Dashboard's Your Rank, from one board. A hidden person's would-be place stays on their own board. */
export function rankWords(board: LeaderboardResponse): { big: string; of: string | null; line: string } {
  const tab = BOARD_TABS.find((t) => t.id === board.board)?.label ?? "";
  const what = board.board === "streak" ? tab : `${tab} this week`;
  if (board.status === "paused" || board.status === "switched_off" || board.status === "no_checkins") return { big: "–", of: null, line: "Not showing" };
  const { me } = board;
  if (me.hidden === "staff") return { big: "–", of: null, line: "Staff" };
  if (me.hidden === "no_name") return { big: "–", of: null, line: "Add your name" };
  if (me.hidden !== null) return { big: "–", of: null, line: "Hidden" };
  if (me.place === null) return { big: "–", of: null, line: what };
  return { big: ordinal(me.place), of: `of ${String(board.ranked)}`, line: what };
}
