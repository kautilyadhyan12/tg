import { describe, expect, it } from "vitest";
import { LEADERBOARD_BOARDS, leaderboardResponseSchema, type LeaderboardBoard, type LeaderboardStatus } from "@app/shared";
import {
  boardInstead,
  dayCountText,
  hiddenText,
  rankWords,
  statusText,
  updatedText,
  workoutCountText,
} from "../src/screens/gym/leaderboardView";

// The leaderboard's rules on the phone. The board a reader settles on is worked out against the server's own order of
// answers (`leaderboard/service.ts`: lapsed plan, then switched off, then nobody checked in).

interface Gym {
  live: boolean;
  checkingIn: boolean;
  boardsOff: LeaderboardBoard[];
}
const statusOf = (board: LeaderboardBoard, gym: Gym): LeaderboardStatus => {
  if (!gym.live) return "paused";
  if (gym.boardsOff.includes(board)) return "switched_off";
  if (board !== "workout_days" && !gym.checkingIn) return "no_checkins";
  return "shown";
};
const everyGym: Gym[] = [true, false].flatMap((live) =>
  [true, false].flatMap((checkingIn) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((bits) => ({
      live,
      checkingIn,
      boardsOff: LEADERBOARD_BOARDS.filter((_, i) => (bits & (1 << i)) !== 0),
    })),
  ),
);
/** Every board a first reader goes through, as Your Rank reads them: nobody has picked a tab. */
function readsFor(gym: Gym): LeaderboardBoard[] {
  const seen: LeaderboardBoard[] = ["gym_days"];
  for (;;) {
    const board = seen[seen.length - 1] ?? "gym_days";
    const next = boardInstead({ board, status: statusOf(board, gym), boardsOff: gym.boardsOff }, false);
    if (next === null || next === board) return seen;
    if (seen.includes(next)) throw new Error(`back and forth: ${seen.join(" ")} ${next}, off ${gym.boardsOff.join(" ")}`);
    seen.push(next);
  }
}

describe("the board a reader settles on, for every gym there can be", () => {
  it.each(everyGym)("settles, never going back to a board it has read: %j", (gym) => {
    expect(readsFor(gym).length).toBeLessThanOrEqual(LEADERBOARD_BOARDS.length);
  });

  const cases: [string, Partial<Gym>, LeaderboardBoard[]][] = [
    ["a gym that checks people in opens on Visits", {}, ["gym_days"]],
    ["nobody checked in: Workout days", { checkingIn: false }, ["gym_days", "workout_days"]],
    ["nobody checked in, Workout days off: stays on Visits and says why", { checkingIn: false, boardsOff: ["workout_days"] }, ["gym_days"]],
    ["Visits off: the first still on", { boardsOff: ["gym_days"] }, ["gym_days", "workout_days"]],
    ["Visits and Workout days off: Streak", { boardsOff: ["gym_days", "workout_days"] }, ["gym_days", "streak"]],
    ["nobody checked in, Visits and Workout days off: Streak, which says why", { checkingIn: false, boardsOff: ["gym_days", "workout_days"] }, ["gym_days", "streak"]],
    ["all off: stays and says so", { boardsOff: ["gym_days", "workout_days", "streak"] }, ["gym_days"]],
    ["a lapsed plan: stays and says so", { live: false }, ["gym_days"]],
  ];
  it.each(cases)("%s", (_name, gym, reads) => {
    expect(readsFor({ live: true, checkingIn: true, boardsOff: [], ...gym })).toEqual(reads);
  });

  it("a person who picked Visits stays on it", () => {
    expect(boardInstead({ board: "gym_days", status: "no_checkins", boardsOff: [] }, true)).toBeNull();
  });
});

describe("the words", () => {
  const gym = { gymName: "Iron House" };
  it.each<[LeaderboardStatus, LeaderboardBoard, string | null]>([
    ["shown", "gym_days", null],
    ["too_few", "gym_days", "The board shows once 3 people have a visit in this period."],
    ["too_few", "workout_days", "The board shows once 3 people have a workout day in this period."],
    ["too_few", "streak", "The board shows once 3 people have a streak."],
    ["no_checkins", "gym_days", "Iron House hasn’t checked anyone in for 30 days, so Visits and Streak aren’t showing."],
    ["paused", "streak", "The leaderboard isn’t available at Iron House right now."],
    ["switched_off", "gym_days", "Iron House has switched its leaderboard off."],
  ])("%s on %s", (status, board, words) => {
    expect(statusText({ ...gym, status, board })).toBe(words);
  });

  it.each([
    ["hide_me", "Hide me is on. Only you see this row."],
    ["under_18", "You’re hidden because you’re under 18. Only you see this row."],
    ["no_name", "Add your full name to be on the board."],
    ["taken_off", "Iron House took you off the board. Only you see this row."],
    ["staff", "Staff are not ranked."],
  ] as const)("hidden for %s", (reason, words) => {
    expect(hiddenText(reason, "Iron House")).toBe(words);
  });

  it("says when the board was read, on the gym's own clock and zone", () => {
    expect(updatedText("2026-11-01T06:00:00.000Z", "Asia/Kolkata", "12h")).toBe("Updated 11:30 AM");
    expect(updatedText("2026-11-01T06:00:00.000Z", "Asia/Kolkata", "24h")).toBe("Updated 11:30");
    expect(updatedText("2026-11-01T06:00:00.000Z", "America/Chicago", "12h")).toBe("Updated 1:00 AM");
  });

  it("counts a day's visits and workouts as the browser does", () => {
    expect(dayCountText(1)).toBe("1 visit");
    expect(dayCountText(2)).toBe("2 visits, 1 day");
    expect(workoutCountText(1)).toBe("1 workout");
    expect(workoutCountText(3)).toBe("3 workouts, 1 day");
  });
});

describe("Your Rank's words", () => {
  const board = (over: object) => ({
    gymId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    gymName: "Iron House",
    timezone: "Asia/Kolkata",
    board: "gym_days" as const,
    period: "this_week" as const,
    from: "2026-10-26",
    to: "2026-11-01",
    circleDays: null,
    status: "shown" as const,
    boardsOff: [],
    ranked: 30,
    rows: [],
    me: { value: 2, place: 7, hidden: null, toNextPlace: 3, nextPlace: 1, circles: null },
    asOf: "2026-11-01T06:00:00.000Z",
    ...over,
  });
  const me = (over: object) => ({ me: { value: 2, place: 7, hidden: null, toNextPlace: null, nextPlace: null, circles: null, ...over } });
  it.each([
    ["placed", {}, { big: "7th", of: "of 30", line: "Visits this week" }],
    ["no place yet", me({ place: null, value: 0 }), { big: "–", of: null, line: "Visits this week" }],
    ["too few on it", { status: "too_few", ...me({ place: null }) }, { big: "–", of: null, line: "Visits this week" }],
    ["Streak", { board: "streak", period: null }, { big: "7th", of: "of 30", line: "Streak" }],
    ["Hide me never says the would-be place", me({ hidden: "hide_me" }), { big: "–", of: null, line: "Hidden" }],
    ["under 18", me({ hidden: "under_18" }), { big: "–", of: null, line: "Hidden" }],
    ["taken off", me({ hidden: "taken_off" }), { big: "–", of: null, line: "Hidden" }],
    ["staff", me({ hidden: "staff" }), { big: "–", of: null, line: "Staff" }],
    ["no name", me({ hidden: "no_name" }), { big: "–", of: null, line: "Add your name" }],
    ["a lapsed plan", { status: "paused" }, { big: "–", of: null, line: "Not showing" }],
    ["switched off", { status: "switched_off" }, { big: "–", of: null, line: "Not showing" }],
    ["nobody checked in", { status: "no_checkins" }, { big: "–", of: null, line: "Not showing" }],
  ])("%s", (_name, over, words) => {
    expect(rankWords(leaderboardResponseSchema.parse(board(over)))).toEqual(words);
  });
});
