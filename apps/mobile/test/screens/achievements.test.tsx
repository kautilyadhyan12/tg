import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { leaderboardResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { ACHIEVEMENTS_READS } from "../../src/screens/achievements/AchievementsPage";
import { fakeServer as kitServer, kept, memoryStore, refusal, tokens, type Reply, type Route } from "../kit";

// Me → Achievements (35c-iii). The worst thing on the phone: a badge drawn as earned that the server says is not, so
// the first test reads every medal's own words with one badge reached but not yet awarded beside one earned.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const ME = {
  streak: { current: 2, longest: 3, lastActivityDate: null, freezesAvailable: 1 },
  xp: { total: 1240, level: 4, xpInLevel: 140, xpForNext: 300, progressPct: 46.7, nextLevelAt: 1400 },
  achievements: [{ code: "first_workout", earnedAt: "2026-10-14T12:00:00.000Z" }],
};
const badge = (code: string, tier: string, target: number, current: number, earnedAt: string | null = null, workoutsFirst: { current: number; target: number } | null = null) => ({
  code,
  tier,
  xp: { bronze: 50, silver: 150, gold: 400, platinum: 1000 }[tier] ?? 50,
  earnedAt,
  current,
  target,
  workoutsFirst,
});
const BADGES = {
  badges: [
    badge("first_workout", "bronze", 1, 1, "2026-10-14T12:00:00.000Z"),
    badge("ten_workouts", "silver", 10, 8),
    // Reached, not awarded: the server awards on its read, but a phone shown this must still not say earned.
    badge("fifty_workouts", "gold", 50, 50),
    badge("streak_3", "bronze", 3, 2),
    badge("form_master", "gold", 90, 95, null, { current: 3, target: 5 }),
    badge("moon_landing", "gold", 1, 0),
  ],
};
const challenge = (code: string, measure: string, difficulty: string, target: number, current: number, more: object = {}) => ({ code, measure, difficulty, target, current, done: current >= target, xp: 200, held: null, ...more });
const WEEK = {
  weekStart: "2026-11-02",
  weekEnd: "2026-11-08",
  challenges: [
    challenge("train_days_3", "training_days", "easy", 3, 3),
    challenge("food_days_5", "food_days", "medium", 5, 2),
    challenge("train_minutes_300", "training_minutes", "hard", 300, 94, { held: { code: "safe_mode" } }),
  ],
  xpThisWeek: 200,
};

type Place = { id: string; name: string };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House" };
const org = (gym: Place) => ({
  ...gym, city: null, orgType: "gym", clockFormat: "12h", slug: "iron-house", timezone: "Asia/Kolkata", locale: "en",
  currencyDisplay: "INR", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z",
});
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const FLAMES = ["yes", "no", "yes", "no", "no", "no", "open"];
const PRIYA = "11111111-1111-4111-8111-111111111111";
const ME_ID = "22222222-2222-4222-8222-222222222222";
const BOARD = leaderboardResponseSchema.parse({
  gymId: IRON.id, gymName: IRON.name, timezone: "Asia/Kolkata", board: "gym_days", period: "this_week", from: DAYS[0], to: DAYS[6],
  circleDays: DAYS, status: "shown", boardsOff: [], ranked: 3,
  rows: [
    { userId: PRIYA, name: "Priya S.", initials: "PS", place: 1, value: 5, circles: FLAMES, isMe: false },
    { userId: ME_ID, name: "Ravi K.", initials: "RK", place: 2, value: 2, circles: FLAMES, isMe: true },
  ],
  me: { value: 2, place: 2, hidden: null, toNextPlace: 3, nextPlace: 1, circles: FLAMES },
  asOf: "2026-11-05T06:00:00.000Z",
});

/** The kit's server, with routes that also name their query (a board's own board and period). */
function server(over: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    [ACHIEVEMENTS_READS.me]: ok(ME),
    [ACHIEVEMENTS_READS.badges]: ok(BADGES),
    [ACHIEVEMENTS_READS.challenges]: ok(WEEK),
    ...over,
  };
  const kit = kitServer(routes);
  const ask: Ask = async (url, init) => {
    const { pathname, search } = new URL(url);
    const exact = search === "" ? undefined : routes[pathname + search];
    if (search !== "" && exact === undefined && pathname.includes("/leaderboard")) return { ok: false, status: 404, json: () => Promise.resolve(refusal(404, "not_found", "Not found").body) };
    if (exact === undefined) return kit.ask(url, init);
    kit.asked.push({ method: init.method ?? "GET", path: pathname + search, body: undefined, headers: init.headers ?? {} });
    const reply = await exact(undefined);
    return { ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ...kit, ask };
}

async function openAchievements(ask: Ask) {
  await render(<App extra={extra} store={memoryStore(kept(1))} ask={ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Achievements" }));
}

describe("Me → Achievements", () => {
  it("draws only what the server says is earned as earned", async () => {
    await openAchievements(server().ask);
    expect(await screen.findByLabelText("First Workout, Bronze. Earned 14 Oct.")).toBeTruthy();
    expect(screen.getByLabelText("10 Workouts, Silver. Not earned yet, 8 of 10 workouts.")).toBeTruthy();
    expect(screen.getByLabelText("50 Workouts, Gold. Not earned yet, 50 of 50 workouts.")).toBeTruthy();
    expect(screen.getByLabelText("3-Day Streak, Bronze. Not earned yet, 2 of 3 days.")).toBeTruthy();
    expect(screen.getByLabelText("Form Master, Gold. Not earned yet, 3 of 5 workouts first.")).toBeTruthy();
    expect(screen.queryAllByLabelText(/Earned/)).toHaveLength(1);
    // A code this phone does not know is left out, never shown raw, and is not counted.
    expect(screen.queryByText(/moon/i)).toBeNull();
    expect(screen.getByText("1,240 XP · 1 of 5 badges")).toBeTruthy();
    expect(screen.getByText("160 XP to Level 5")).toBeTruthy();
    expect(screen.getByLabelText("Level 4")).toBeTruthy();
    for (const name of ["Badges", "Challenges", "Leaderboard"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Badges" }).props.accessibilityState).toEqual({ selected: true });
  });

  // Found on the walk: the badges' read awards a badge already reached, with its XP; the level read at the same moment
  // still said the XP before it.
  it("reads the level again once the badges are in, so a badge awarded on the read shows its XP", async () => {
    let badgesRead = false;
    const s = server({
      [ACHIEVEMENTS_READS.me]: () => ({ status: 200, body: badgesRead ? { ...ME, xp: { ...ME.xp, total: 1390, nextLevelAt: 1400 } } : ME }),
      [ACHIEVEMENTS_READS.badges]: () => {
        badgesRead = true;
        return { status: 200, body: BADGES };
      },
    });
    await openAchievements(s.ask);
    expect(await screen.findByText("1,390 XP · 1 of 5 badges")).toBeTruthy();
    expect(screen.getByText("10 XP to Level 5")).toBeTruthy();
  });

  it("a badge pressed opens its box: not earned yet, what it takes, how far to go", async () => {
    await openAchievements(server().ask);
    await fireEvent.press(await screen.findByLabelText("10 Workouts, Silver. Not earned yet, 8 of 10 workouts."));
    expect(await screen.findByText("Not earned yet")).toBeTruthy();
    expect(screen.getByText("Finish 10 workouts.")).toBeTruthy();
    expect(screen.getByText("of 10 workouts")).toBeTruthy();
    expect(screen.getByText("+150")).toBeTruthy();
    expect(screen.getByText("XP when earned")).toBeTruthy();
    expect(screen.getByText("2 more workouts to go.")).toBeTruthy();
  });

  it("an earned badge's box says the day, with no bar", async () => {
    await openAchievements(server().ask);
    await fireEvent.press(await screen.findByLabelText("First Workout, Bronze. Earned 14 Oct."));
    expect(await screen.findByText("Earned 14 Oct")).toBeTruthy();
    expect(screen.queryByText(/to go\./)).toBeNull();
  });

  it("Challenges: the week, each challenge's laurel, done, to go and paused", async () => {
    await openAchievements(server().ask);
    await fireEvent.press(await screen.findByRole("tab", { name: "Challenges" }));
    expect(await screen.findByText("2 – 8 Nov · new ones on Monday")).toBeTruthy();
    expect(screen.getByText("of 600 XP")).toBeTruthy();
    expect(screen.getByLabelText("1 of 3 done")).toBeTruthy();
    expect(screen.getByLabelText("3 of 3, done")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByLabelText("2 of 5")).toBeTruthy();
    expect(screen.getByText("3 to go")).toBeTruthy();
    expect(screen.getByLabelText("94 of 300 min")).toBeTruthy();
    expect(screen.getByText("Paused in Safe mode")).toBeTruthy();
  });

  it("a challenge pressed opens its box: what counts, how far, its XP and the week's end", async () => {
    await openAchievements(server().ask);
    await fireEvent.press(await screen.findByRole("tab", { name: "Challenges" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Log your food on 5 days, Medium, 2 of 5. See more" }));
    expect(await screen.findByText("A day with any meal logged counts.")).toBeTruthy();
    expect(screen.getByText("of 5 days")).toBeTruthy();
    expect(screen.getByText("XP when done")).toBeTruthy();
    expect(screen.getByText("Sun")).toBeTruthy();
    expect(screen.getByText("ends 8 Nov")).toBeTruthy();
    expect(screen.getByText("3 to go this week.")).toBeTruthy();
  });

  it("a paused challenge's box says it is paused, never how far to go", async () => {
    await openAchievements(server().ask);
    await fireEvent.press(await screen.findByRole("tab", { name: "Challenges" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Train for 300 minutes, Hard, 94 of 300 min. See more" }));
    expect(await screen.findByText("Paused in Safe mode until the week ends.")).toBeTruthy();
    expect(screen.queryByText(/to go this week/)).toBeNull();
  });

  it("Leaderboard with no gym: only Worldwide, coming soon", async () => {
    await openAchievements(server().ask);
    await fireEvent.press(await screen.findByRole("tab", { name: "Leaderboard" }));
    expect(await screen.findByLabelText("Worldwide: Coming soon")).toBeTruthy();
    expect(screen.queryByText("See the full board")).toBeNull();
  });

  it("Leaderboard at a gym: the same board as Your Rank, a lane each, the person's own as You", async () => {
    const s = server({ "/v1/orgs/mine": ok({ orgs: [org(IRON)], formerOrgs: [] }), [`/v1/orgs/${IRON.id}/leaderboard?board=gym_days&period=this_week`]: ok(BOARD) });
    await openAchievements(s.ask);
    await fireEvent.press(await screen.findByRole("tab", { name: "Leaderboard" }));
    expect(await screen.findByLabelText("1st, Priya S., 5 visits. See their profile")).toBeTruthy();
    expect(screen.getByLabelText("2nd, you, 2 visits. See the full board")).toBeTruthy();
    expect(screen.getByText("Visits · This week")).toBeTruthy();
    expect(screen.getByText("Your place · 2 visits")).toBeTruthy();
    expect(screen.getByText("3 more visits to reach 1st")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See the full board" })).toBeTruthy();
  });
});

describe("the Dashboard opens Achievements where its box points", () => {
  it.each([
    ["Latest Badges, View all", "Badges"],
    ["Weekly Challenges, see all", "Challenges"],
  ] as const)("%s opens on %s", async (box, tab) => {
    await render(<App extra={extra} store={memoryStore(kept(1))} ask={server().ask} />);
    await fireEvent.press(await screen.findByRole("button", { name: box }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: tab }).props.accessibilityState).toEqual({ selected: true });
    });
    expect(within(screen.getByRole("tab", { name: tab })).getByText(tab)).toBeTruthy();
  });
});
