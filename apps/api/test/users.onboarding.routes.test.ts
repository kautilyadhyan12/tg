// Onboarding v2, server half (ROADMAP Stage 1 item 4a) against REAL Postgres.
// DATABASE_URL-gated; needs migrations 0026-0028.
//
// Covers, per route: the happy path, a validation failure and the cross-user
// denial (CLAUDE.md §4) — plus the rules that decide what a person sees:
// saving as you go never wipes an answer another screen gave, the number
// appears only once the eight core answers are in (never from a default),
// "today" comes from the device's zone and the server clock, the weight choice
// alone sets the calories (4a-iv), a reset clears every answer, and the
// health and age rules still hold the cut.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  dietSchema,
  fitnessGoalSchema,
  onboardingAnswersSchema,
  onboardingIncompleteBodySchema,
  weightGoalSchema,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { UsersEmailSender } from "../src/modules/users/email.js";
import { deleteOnboarding, patchOnboarding, updateProfile } from "../src/modules/users/repo.js";
import {
  AccountNotActiveError,
  createMeasurement,
  currentWeightKg,
  deleteMeasurement,
  recordTypedWeight,
  updateMeasurement,
} from "../src/modules/nutrition/repo.js";
import { planAnswersFor } from "../src/modules/plan/answers.js";
import { resolvePlan } from "../src/modules/plan/maths.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "ofp-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});
const deleteCodes: string[] = [];
const capturingUsersSender = (): UsersEmailSender => ({
  sendAccountDeletionEmail: () => Promise.resolve(),
  sendAccountDeleteCodeEmail: (_e, code) => {
    deleteCodes.push(code);
    return Promise.resolve();
  },
});

let ipCounter = 0;
const nextIp = () => `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The eight answers the calorie maths cannot work without. Before the weight
 *  choice is made the target weight and the pace are NOT among them — keeping
 *  the weight never asks for them. */
const CORE_EIGHT = [
  "goal",
  "age",
  "gender",
  "heightCm",
  "weightKg",
  "dayActivity",
  "trainingDays",
  "sessionMinutes",
];

/** The three answers setup needs that the PLAN never does: the health question
 *  (screen 8) and screen 9's two. Every one of them is missing from a finish
 *  until it is given, and none of them is ever in the plan's own `missing`. */
const SETUP_ONLY = ["health", "diet", "mealsPerDay"];

/** The golden person, hand-computed from plan/maths.ts in its whole-kcal steps:
 *    resting burn  10·70 + 6.25·165 − 5·30 − 161            = 1420.25 → 1420
 *    your day       1420 · 1.2 (sitting)                     = 1704
 *    training       5 · 70 kg · (3 · 45 min) ÷ 60 ÷ 7        = 112.5   → 113
 *    daily burn     1704 + 113                               = 1817
 *    steady         0.5 kg/week · 7700 ÷ 7                   = −550 a day
 *    eat            1817 − 550                               = 1267
 *    5 kg to lose   5 · 7700 ÷ 550                           = 70 days
 *    macros (lose, 2.0 g/kg): fat 1267·0.25/9 = 35 g; protein min(140, 187.6)
 *                   = 140 g; carbs (1267 − 560 − 316.75)/4   = 98 g */
const GOLDEN_LOSE = {
  restingBurnKcal: 1420,
  dailyBurnKcal: 1817,
  targetKcal: 1267,
  dailyChangeKcal: -550,
  proteinG: 140,
  carbsG: 98,
  fatG: 35,
  plannedTargetKg: 65,
  daysToTarget: 70,
  flags: [],
};

/** The same person's seven screens, one object per screen. */
const SCREENS = {
  goal: { weightGoal: "lose" },
  aboutYou: { age: 30, gender: "female", heightCm: 165, weightKg: 70 },
  target: { targetWeightKg: 65, pace: "steady" },
  yourDay: { dayActivity: "sitting" },
  yourTraining: { fitnessLevel: "beginner", pushUpsMax: 12, plankHoldSeconds: 45 },
  yourWeek: { trainingDays: 3, sessionMinutes: 45 },
  equipment: { availableEquipment: ["dumbbells", "pull_up_bar"] },
  // Screen 9 (4b-ii). Neither answer moves a calorie — every plan number in
  // this file is the same with them and without — and setup does not end
  // without them. Screen 11, the gym code, saves nothing here at all.
  food: { diet: "non_vegetarian", mealsPerDay: 3 },
} as const;

interface PlanBody {
  answers: Record<string, unknown>;
  plan: Record<string, unknown> | null;
  missing: string[];
}

d("onboarding v2 routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    body?: unknown;
    cookies?: Record<string, string>;
  }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (email: string) => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName: "OB Fixture" },
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const path = (timeZone?: string) =>
    timeZone === undefined
      ? "/v1/users/me/onboarding"
      : `/v1/users/me/onboarding?timeZone=${encodeURIComponent(timeZone)}`;

  const get = async (cookies: Record<string, string>, timeZone?: string) => {
    const res = await inject({ method: "GET", url: path(timeZone), cookies });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as PlanBody;
  };
  const patch = (cookies: Record<string, string>, body: unknown, timeZone?: string) =>
    inject({ method: "PATCH", url: path(timeZone), body, cookies });
  const patchOk = async (cookies: Record<string, string>, body: unknown, timeZone?: string) => {
    const res = await patch(cookies, body, timeZone);
    expect(res.statusCode, `PATCH ${JSON.stringify(body)} → ${res.body}`).toBe(200);
    return JSON.parse(res.body) as PlanBody;
  };

  /** The whole wizard, through the routes, in screen order. */
  const completeScreens = async (cookies: Record<string, string>) => {
    let last: PlanBody | undefined;
    for (const screen of Object.values(SCREENS)) last = await patchOk(cookies, screen);
    if (last === undefined) throw new Error("no screens");
    return last;
  };

  /** The rings (GET /v1/nutrition/targets) against the plan the screens show,
   *  field by field. Returns the rings' kcal, or null when they show none: no
   *  plan, or a target on the wrong side of the weight, which the rings name
   *  as that (never as a question left unanswered) rather than show the
   *  weight held as the goal's number. */
  const rings = async (cookies: Record<string, string>) => {
    const res = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      targets: Record<string, unknown> | null;
      missing: string[];
      targetWrongSide: boolean;
    };
    const { plan, missing } = await get(cookies);
    const flags: unknown = plan?.["flags"];
    const wrongSide =
      Array.isArray(flags) &&
      flags.some((f: unknown) => typeof f === "object" && f !== null && "code" in f && f.code === "target_wrong_direction");
    expect(body.missing).toEqual(missing);
    expect(body.targetWrongSide).toBe(wrongSide);
    if (plan === null || wrongSide) {
      expect(body.targets).toBeNull();
      return null;
    }
    expect(body.targets).toEqual({
      bmr: plan["restingBurnKcal"],
      tdee: plan["dailyBurnKcal"],
      kcal: plan["targetKcal"],
      proteinG: plan["proteinG"],
      carbsG: plan["carbsG"],
      fatG: plan["fatG"],
      noCalorieCut: false,
    });
    return body.targets?.["kcal"] ?? null;
  };

  /** Screen 1's two answers as stored: the weight choice and the goals beside it. */
  const goalsOf = async (userId: string) => {
    const rows = await sql<{ weight_goal: string | null; fitness_goals: string[] | null }[]>`
      SELECT weight_goal, fitness_goals FROM user_fitness_profiles WHERE user_id = ${userId}`;
    return { weightGoal: rows[0]?.weight_goal ?? null, goals: rows[0]?.fitness_goals ?? null };
  };

  /** Screen 8's answer, on 3b's own route (the wizard saves it there, not
   *  through PATCH /onboarding: the screening is its own table). */
  const answerHealth = async (
    cookies: Record<string, string>,
    body: { hasCondition: boolean; checkFirst?: string | null },
  ) => {
    const res = await inject({ method: "PUT", url: "/v1/users/me/health-screening", body, cookies });
    expect(res.statusCode, res.body).toBe(200);
  };

  const healthScreening = async (cookies: Record<string, string>) => {
    const res = await inject({ method: "GET", url: "/v1/users/me/health-screening", cookies });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { healthScreening: Record<string, unknown> }).healthScreening;
  };

  /** A save from Settings' fitness tab: the whole profile as the server holds
   *  it, with only screen 1's two questions changed — what apps/web
   *  mergeFitnessProfile sends. */
  const settingsSave = async (
    cookies: Record<string, string>,
    change: { weightGoal: string | null; fitnessGoals: string[] },
  ) => {
    const res = await inject({ method: "GET", url: "/v1/users/me/fitness-profile", cookies });
    expect(res.statusCode).toBe(200);
    const { fitnessProfile: p } = JSON.parse(res.body) as { fitnessProfile: Record<string, unknown> };
    const put = await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: {
        age: p["age"],
        gender: p["gender"],
        heightCm: p["heightCm"],
        targetWeightKg: p["targetWeightKg"],
        fitnessLevel: p["fitnessLevel"],
        weightGoal: change.weightGoal,
        fitnessGoals: change.fitnessGoals,
        exerciseFrequency: p["exerciseFrequency"],
        availableEquipment: p["availableEquipment"],
        sessionDurationMin: p["sessionDurationMin"],
        preferredWorkoutTime: p["preferredWorkoutTime"],
        onboardingCompleted: p["onboardingCompleted"],
      },
      cookies,
    });
    expect(put.statusCode, put.body).toBe(200);
  };

  beforeAll(async () => {
    await sql`DELETE FROM consent_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'ob-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'ob-%@example.com'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'ob-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: silentAuthSender(),
      usersEmailSender: capturingUsersSender(),
    });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("every route requires authentication", { timeout: 30_000 }, async () => {
    expect((await inject({ method: "GET", url: path() })).statusCode).toBe(401);
    expect((await inject({ method: "PATCH", url: path(), body: { weightGoal: "lose" } })).statusCode).toBe(401);
    expect((await inject({ method: "DELETE", url: path() })).statusCode).toBe(401);
  });

  it("before any screen: NO number, and an honest list of the eight answers it needs", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ob-empty@example.com");
    const body = await get(cookies);
    expect(body.plan).toBeNull();
    expect([...body.missing].sort()).toEqual([...CORE_EIGHT].sort());
    expect(body.answers).toMatchObject({
      displayName: "OB Fixture", // the account's own name, never blank
      weightGoal: null,
      fitnessGoals: [],
      age: null,
      gender: null,
      heightCm: null,
      weightKg: null,
      targetWeightKg: null,
      pace: null,
      dayActivity: null,
      fitnessLevel: null,
      pushUpsMax: null,
      plankHoldSeconds: null,
      trainingDays: null,
      sessionMinutes: null,
      availableEquipment: [],
      diet: null,
      mealsPerDay: null,
      onboardingCompleted: false,
      updatedAt: null,
    });
    // No profile row was created by a mere read.
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id IN (SELECT id FROM users WHERE email = 'ob-empty@example.com')`;
    expect(rows[0]?.n).toBe("0");
  });

  it("saves as you go: the number appears at 'your week' and not one screen earlier", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-wizard@example.com");

    // Screen 1 — a weight choice that moves the weight starts asking for a target and a pace.
    const s1 = await patchOk(cookies, SCREENS.goal);
    expect(s1.plan).toBeNull();
    expect(s1.missing).toContain("targetWeightKg");
    expect(s1.missing).toContain("pace");
    expect(s1.missing).not.toContain("goal");
    expect(s1.answers["weightGoal"]).toBe("lose");

    const s2 = await patchOk(cookies, SCREENS.aboutYou);
    expect(s2.plan).toBeNull();
    expect(s2.missing).toEqual(expect.arrayContaining(["targetWeightKg", "pace", "dayActivity", "trainingDays", "sessionMinutes"]));

    const s3 = await patchOk(cookies, SCREENS.target);
    expect(s3.plan).toBeNull();
    const s4 = await patchOk(cookies, SCREENS.yourDay);
    expect(s4.plan).toBeNull();

    // Screen 5's two checks are stored and are NOT calorie inputs: still no number.
    const s5 = await patchOk(cookies, SCREENS.yourTraining);
    expect(s5.plan).toBeNull();
    expect(s5.missing).toEqual(["trainingDays", "sessionMinutes"]);
    expect(s5.answers).toMatchObject({ fitnessLevel: "beginner", pushUpsMax: 12, plankHoldSeconds: 45 });

    // Screen 6 completes the eight — the number exists from here on.
    const s6 = await patchOk(cookies, SCREENS.yourWeek);
    expect(s6.missing).toEqual([]);
    expect(s6.plan).toMatchObject(GOLDEN_LOSE);
    expect(typeof s6.plan?.["finishDate"]).toBe("string");
    // And the steps "How is this worked out?" prints, the golden sums above.
    expect(s6.plan?.["workings"]).toMatchObject({
      resting: { formula: "female", constant: -161, kcal: 1420 },
      day: { activity: "sitting", factor: 1.2, kcal: 1704 },
      training: { kcalPerKgHour: 5, trainingDays: 3, sessionMinutes: 45, kcal: 113 },
      change: { pace: "steady", kgPerWeek: 0.5, kcalPerKg: 7700, kcal: -550 },
      beforeFloorKcal: 1267,
      finish: { kgToMove: 5, kcalPerKg: 7700 },
    });

    // Screen 7 changes nothing about the calories — equipment is the plan
    // builder's input (6a), not the maths'.
    const s7 = await patchOk(cookies, SCREENS.equipment);
    expect(s7.plan).toEqual(s6.plan);
    expect(s7.answers["availableEquipment"]).toEqual(["dumbbells", "pull_up_bar"]);

    // And every earlier answer is still there: PATCH merges, it does not replace.
    expect(s7.answers).toMatchObject({
      weightGoal: "lose",
      age: 30,
      gender: "female",
      heightCm: 165,
      weightKg: 70,
      targetWeightKg: 65,
      pace: "steady",
      dayActivity: "sitting",
      fitnessLevel: "beginner",
      pushUpsMax: 12,
      plankHoldSeconds: 45,
      trainingDays: 3,
      sessionMinutes: 45,
    });
    expect(await get(cookies)).toEqual(s7);
  });

  it("screen 2's name is the account's own: saved trimmed, refused blank, and read wherever the account's name is", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-name@example.com");
    expect((await get(cookies)).answers["displayName"]).toBe("OB Fixture");

    const named = await patchOk(cookies, { displayName: "  Kd  " });
    expect(named.answers["displayName"]).toBe("Kd");
    // A name lives on the account, so a name-only save creates no profile row.
    expect(named.answers["updatedAt"]).toBeNull();
    const me = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect((JSON.parse(me.body) as { user: { displayName: string } }).user.displayName).toBe("Kd");

    // Blank, cleared or too long: refused, and nothing is written.
    for (const displayName of ["", "   ", null, "x".repeat(101)]) {
      expect((await patch(cookies, { displayName })).statusCode, JSON.stringify(displayName)).toBe(400);
    }
    const rows = await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`;
    expect(rows[0]?.display_name).toBe("Kd");

    // The profile form writes the same name, and onboarding reads its change.
    expect((await inject({ method: "PATCH", url: "/v1/users/me", body: { displayName: "Kd Renamed" }, cookies })).statusCode).toBe(200);
    expect((await get(cookies)).answers["displayName"]).toBe("Kd Renamed");
  });

  it("an explicit null clears one answer, and the number honestly disappears with it", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-clear@example.com");
    await completeScreens(cookies);
    const cleared = await patchOk(cookies, { dayActivity: null });
    expect(cleared.plan).toBeNull();
    expect(cleared.missing).toEqual(["dayActivity"]);
    expect(cleared.answers["dayActivity"]).toBeNull();
    // Everything else survived the clear.
    expect(cleared.answers).toMatchObject({ weightGoal: "lose", trainingDays: 3 });
    const back = await patchOk(cookies, { dayActivity: "sitting" });
    expect(back.plan).toMatchObject(GOLDEN_LOSE);
  });

  it("an empty save is a no-op that re-reads the plan, and never a 400", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ob-noop@example.com");
    const done = await completeScreens(cookies);
    const noop = await patchOk(cookies, {});
    expect(noop.plan).toEqual(done.plan);
    expect(noop.answers["updatedAt"]).toBe(done.answers["updatedAt"]);
  });

  it("the weight choice alone sets the calories; the goals beside it move none, bar Build muscle's protein", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-goals@example.com");
    await completeScreens(cookies);

    // Gain weight → a surplus of the same size, to a target above the weight.
    const gain = await patchOk(cookies, { weightGoal: "gain", targetWeightKg: 75 });
    expect(gain.plan).toMatchObject({
      dailyBurnKcal: 1817,
      targetKcal: 2367,
      dailyChangeKcal: 550,
      plannedTargetKg: 75,
      daysToTarget: 70,
      proteinG: 154,
    });

    // Keep my weight → the weight is held: no target, no pace, no date, and
    // the two are not even asked for.
    const steady = await patchOk(cookies, { weightGoal: "maintain" });
    expect(steady.missing).toEqual([]);
    expect(steady.plan).toMatchObject({
      targetKcal: 1817,
      dailyChangeKcal: 0,
      plannedTargetKg: 70,
      daysToTarget: null,
      finishDate: null,
      flags: [],
      proteinG: 112,
    });

    // The stored target and pace are untouched by the switch — going back to
    // "lose weight" restores the original plan exactly.
    expect(steady.answers).toMatchObject({ targetWeightKg: 75, pace: "steady" });
    const back = await patchOk(cookies, { weightGoal: "lose", targetWeightKg: 65 });
    expect(back.plan).toMatchObject(GOLDEN_LOSE);

    // Every goal but Build muscle ticked beside it: not a calorie moves, nor a gram.
    const others = fitnessGoalSchema.options.filter((g) => g !== "muscle_gain");
    const busy = await patchOk(cookies, { fitnessGoals: others });
    expect(busy.answers["fitnessGoals"]).toEqual(others);
    expect(busy.plan).toEqual(back.plan);

    // Build muscle beside losing weight (building muscle is not gaining weight,
    // RULINGS 2026-09-11): the same calories, and protein at 2.2 g a kilo —
    // 154 g, not 140 — with the carbohydrates giving way to it.
    const muscle = await patchOk(cookies, { fitnessGoals: ["muscle_gain"] });
    expect(muscle.plan).toMatchObject({ ...GOLDEN_LOSE, proteinG: 154, carbsG: 84 });
    expect(muscle.plan?.["workings"]).toMatchObject({ protein: { gPerKg: 2.2, weightKg: 70, wantedG: 154, buildMuscle: true } });
    // And beside keeping the weight: 2.2, not keep's 1.6.
    expect((await patchOk(cookies, { weightGoal: "maintain" })).plan).toMatchObject({ targetKcal: 1817, proteinG: 154 });
  });

  it("holds the calorie cut for a YES on the health question, and says why", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-health@example.com");
    await completeScreens(cookies);
    expect(
      (await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: true, checkFirst: "cleared" }, cookies })).statusCode,
    ).toBe(200);
    const held = await get(cookies);
    expect(held.plan).toMatchObject({
      targetKcal: 1817, // the whole daily burn
      dailyChangeKcal: 0,
      plannedTargetKg: 70,
      daysToTarget: null,
      finishDate: null,
      flags: [{ code: "no_deficit", reasons: ["health_answer"] }],
    });
    // Safe mode is listed as its own reason on top of the yes.
    expect(
      (await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: true, checkFirst: "not_yet" }, cookies })).statusCode,
    ).toBe(200);
    expect((await get(cookies)).plan?.["flags"]).toEqual([{ code: "no_deficit", reasons: ["health_answer", "safe_mode"] }]);
    // Answering no gives the cut back, at once.
    expect(
      (await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: false }, cookies })).statusCode,
    ).toBe(200);
    expect((await get(cookies)).plan).toMatchObject(GOLDEN_LOSE);
  });

  it("never cuts calories under 18, with no health answer at all", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ob-teen@example.com");
    await completeScreens(cookies);
    const teen = await patchOk(cookies, { age: 17 });
    // resting 10·70 + 6.25·165 − 5·17 − 161 = 1485.25; burn 1485.25·1.2 + 112.5 = 1894.8
    expect(teen.plan).toMatchObject({
      restingBurnKcal: 1485,
      dailyBurnKcal: 1895,
      targetKcal: 1895,
      dailyChangeKcal: 0,
      flags: [{ code: "no_deficit", reasons: ["under_18"] }],
    });
    expect((await patchOk(cookies, { age: 18 })).plan).toMatchObject({ dailyChangeKcal: -550 });
  });

  it("takes the day from the DEVICE's zone and the server clock — never from the body", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-tz@example.com");
    await completeScreens(cookies);
    // 26 hours apart, so their calendar days can never be the same instant's day.
    const east = await get(cookies, "Etc/GMT-14");
    const west = await get(cookies, "Etc/GMT+12");
    expect(east.plan?.["daysToTarget"]).toBe(70);
    expect(west.plan?.["daysToTarget"]).toBe(70);
    expect(east.plan?.["finishDate"]).not.toBe(west.plan?.["finishDate"]);
    // A day cannot be dictated: `today` is not a field this route accepts.
    expect((await patch(cookies, { today: "2030-01-01" })).statusCode).toBe(400);
    // A zone the server does not know is refused, not silently turned into UTC.
    const bad = await inject({ method: "GET", url: path("Mars/Olympus_Mons"), cookies });
    expect(bad.statusCode).toBe(400);
    expect((JSON.parse(bad.body) as { error: string }).error).toBe("unknown_time_zone");
    // And an unknown query parameter is refused rather than ignored.
    expect((await inject({ method: "GET", url: "/v1/users/me/onboarding?tz=Asia/Kolkata", cookies })).statusCode).toBe(400);
  });

  it("falls back to the person's stored zone when a client sends none", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ob-tz-stored@example.com");
    await completeScreens(cookies);
    expect((await inject({ method: "PATCH", url: "/v1/users/me", body: { timezone: "Etc/GMT-14" }, cookies })).statusCode).toBe(200);
    const stored = await get(cookies);
    expect(stored.plan?.["finishDate"]).toBe((await get(cookies, "Etc/GMT-14")).plan?.["finishDate"]);
    // The device still wins over the stored zone when it says where it is.
    expect((await get(cookies, "Etc/GMT+12")).plan?.["finishDate"]).not.toBe(stored.plan?.["finishDate"]);
  });

  it("the route's numbers are the pure calculator's, and its answers are the published contract", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ob-parity@example.com");
    const body = await completeScreens(cookies);
    // The response parses as the contract — so this comparison is against the
    // published shape, not against whatever the route happened to send.
    const answers = onboardingAnswersSchema.parse(body.answers);
    const direct = resolvePlan(planAnswersFor({ answers, health: null, today: "2026-01-01" }));
    expect({ ...body.plan, finishDate: null }).toEqual({ ...direct.plan, finishDate: null });
    // Only the date depends on "today", and it is a real day 70 days out.
    expect(String(body.plan?.["finishDate"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(direct.plan?.finishDate).toBe("2026-03-12"); // 2026-01-01 + 70
  });

  it("refuses every out-of-range answer and every stray field, and writes nothing", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-invalid@example.com");
    const bad: unknown[] = [
      { weightGoal: "get_ripped" }, // not one of the three
      { weightGoal: "keep" }, // the screen's word; the stored value is "maintain"
      { mainGoal: "weight_loss" }, // the old one-goal field is gone
      { fitnessGoals: ["weight_loss"] }, // a weight choice now, never a goal beside one
      { fitnessGoals: ["posture", "posture"] }, // a set, not a list
      { fitnessGoals: ["get_ripped"] },
      { age: 15 }, // the app is for 16 and over
      { age: 121 },
      { gender: "yes" },
      { heightCm: 49 },
      { heightCm: 175.555 }, // two decimals, as the column stores
      { weightKg: 0 },
      { weightKg: 1000 },
      { targetWeightKg: -5 },
      { pace: "extreme" },
      { dayActivity: "lying_down" },
      { fitnessLevel: "expert" },
      { pushUpsMax: -1 },
      { pushUpsMax: 501 },
      { pushUpsMax: 10.5 },
      { plankHoldSeconds: 3601 },
      { trainingDays: 0 },
      { trainingDays: 8 },
      { sessionMinutes: 4 },
      { sessionMinutes: 241 },
      { availableEquipment: ["dumbbells", "dumbbells"] }, // a set, not a list
      { availableEquipment: ["barbell"] },
      { availableEquipment: ["none", "dumbbells"] }, // "no equipment" stands alone
      { availableEquipment: ["none", "gym"] }, // a gym included
      { weightGoal: "lose", goal: "lose" }, // the plan's own word for the choice is never a field
      { targetKcal: 1200 }, // nor is any number of the plan's
      { displayName: "" }, // a name is changed, never blanked
      { displayName: null },
    ];
    for (const body of bad) {
      const res = await patch(cookies, body);
      expect(res.statusCode, `expected 400 for ${JSON.stringify(body)}`).toBe(400);
    }
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.n).toBe("0");
    expect((await get(cookies)).answers["weightGoal"]).toBeNull();
  });

  it("the macro rings read the plan: the screens' own number, whatever the weight choice", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-rings@example.com");
    await completeScreens(cookies);
    expect(await rings(cookies)).toBe(GOLDEN_LOSE.targetKcal);

    // A gain to a target above the weight: the same pace's 550 on top of the burn.
    await patchOk(cookies, { weightGoal: "gain", targetWeightKg: 75 });
    expect(await rings(cookies)).toBe(GOLDEN_LOSE.dailyBurnKcal + 550);

    await patchOk(cookies, { weightGoal: "maintain" });
    expect(await rings(cookies)).toBe(GOLDEN_LOSE.dailyBurnKcal);

    // Clearing the weight choice: no number on either, and the same one
    // question named on both.
    await patchOk(cookies, { weightGoal: null });
    expect(await rings(cookies)).toBeNull();
    expect((await get(cookies)).missing).toEqual(["goal"]);
  });

  it("Settings writes screen 1's two answers: a weight choice changed there takes effect at once, and nothing is asked again", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-settings-goal@example.com");
    await completeScreens(cookies);
    const ringsBody = async () =>
      JSON.parse((await inject({ method: "GET", url: "/v1/nutrition/targets", cookies })).body) as unknown;

    // Goals ticked beside the weight choice: the calories stay the loss plan's.
    await settingsSave(cookies, { weightGoal: "lose", fitnessGoals: ["flexibility", "posture"] });
    expect(await goalsOf(userId)).toEqual({ weightGoal: "lose", goals: ["flexibility", "posture"] });
    expect(await rings(cookies)).toBe(GOLDEN_LOSE.targetKcal);

    // Gain weight chosen there (Kd, 2026-09-11: "it should automatically
    // update according to change"): the calories follow at once. The 65 kg
    // target was a loss target, below the 70 kg weight, so the rings ask for
    // a target above it, and only that.
    await settingsSave(cookies, { weightGoal: "gain", fitnessGoals: ["flexibility", "posture"] });
    expect(await ringsBody()).toEqual({ targets: null, missing: [], targetWrongSide: true });
    expect(await rings(cookies)).toBeNull();
    // A target above the weight, as the target screen saves it: the gain plan.
    await patchOk(cookies, { targetWeightKg: 75 });
    expect(await rings(cookies)).toBe(GOLDEN_LOSE.dailyBurnKcal + 550);

    // Keep my weight, and every goal unticked: eating what you burn.
    await settingsSave(cookies, { weightGoal: "maintain", fitnessGoals: [] });
    expect(await goalsOf(userId)).toEqual({ weightGoal: "maintain", goals: [] });
    expect(await rings(cookies)).toBe(GOLDEN_LOSE.dailyBurnKcal);

    // Saving what Settings shows changes nothing.
    const before = await get(cookies);
    await settingsSave(cookies, { weightGoal: "maintain", fitnessGoals: [] });
    expect((await get(cookies)).plan).toEqual(before.plan);
  });

  it("screen 1's two answers are saved one at a time, each leaving the other as it was", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-goal-merge@example.com");
    await completeScreens(cookies);
    await patchOk(cookies, { fitnessGoals: ["muscle_gain", "balance"] });
    expect(await goalsOf(userId)).toEqual({ weightGoal: "lose", goals: ["muscle_gain", "balance"] });
    await patchOk(cookies, { weightGoal: "maintain" });
    expect(await goalsOf(userId)).toEqual({ weightGoal: "maintain", goals: ["muscle_gain", "balance"] });
    // Unticking the last goal leaves an empty list, never the old one.
    await patchOk(cookies, { fitnessGoals: [] });
    expect(await goalsOf(userId)).toEqual({ weightGoal: "maintain", goals: [] });
    // Clearing the weight choice takes nothing else with it.
    await patchOk(cookies, { fitnessGoals: ["strength"] });
    await patchOk(cookies, { weightGoal: null });
    expect(await goalsOf(userId)).toEqual({ weightGoal: null, goals: ["strength"] });
  });

  it("someone who picked Build muscle before the split is asked their weight choice, and Gain weight brings back their plan", { timeout: 60_000 }, async () => {
    // Where migration 0028 leaves them (RULINGS 2026-09-11): no weight choice,
    // Build muscle ticked, and the target and pace the old screen asked kept.
    const { userId, cookies } = await makeUser("ob-build-muscle@example.com");
    await completeScreens(cookies);
    await patchOk(cookies, { targetWeightKg: 75 });
    await sql`
      UPDATE user_fitness_profiles SET weight_goal = NULL, fitness_goals = ARRAY['muscle_gain']
      WHERE user_id = ${userId}`;
    const asked = await get(cookies);
    expect(asked.plan).toBeNull();
    expect(asked.missing).toEqual(["goal"]);
    expect(await rings(cookies)).toBeNull();
    // One tap: the gain plan they had, protein at 2.2 g a kilo as before.
    const gain = await patchOk(cookies, { weightGoal: "gain" });
    expect(gain.plan).toMatchObject({ targetKcal: 2367, dailyChangeKcal: 550, plannedTargetKg: 75, proteinG: 154 });
    expect(gain.answers).toMatchObject({ fitnessGoals: ["muscle_gain"], targetWeightKg: 75, pace: "steady" });
  });

  it("Reset onboarding clears every answer, the health one and the ones only the screens ask included; the name and the weigh-ins stay", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-reset@example.com");
    await patchOk(cookies, { displayName: "Kd" });
    await completeScreens(cookies);
    await answerHealth(cookies, { hasCondition: true, checkFirst: "cleared" });
    await patchOk(cookies, { fitnessGoals: ["balance"], onboardingCompleted: true });
    await settingsSave(cookies, { weightGoal: "lose", fitnessGoals: ["balance"] });

    const reset = await inject({ method: "DELETE", url: path(), cookies });
    expect(reset.statusCode, reset.body).toBe(200);
    const body = JSON.parse(reset.body) as PlanBody;
    expect(body.plan).toBeNull();
    expect([...body.missing].sort()).toEqual(CORE_EIGHT.filter((k) => k !== "weightKg").sort());
    expect(body.answers).toEqual({
      displayName: "Kd",
      weightGoal: null,
      fitnessGoals: [],
      age: null,
      gender: null,
      heightCm: null,
      weightKg: 70,
      targetWeightKg: null,
      pace: null,
      dayActivity: null,
      fitnessLevel: null,
      pushUpsMax: null,
      plankHoldSeconds: null,
      trainingDays: null,
      sessionMinutes: null,
      availableEquipment: [],
      diet: null,
      mealsPerDay: null,
      onboardingCompleted: false,
      updatedAt: null,
    });
    // The gate the training side reads is shut again.
    const me = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect((JSON.parse(me.body) as { user: { onboardingCompleted: boolean } }).user.onboardingCompleted).toBe(false);
    // The health answer went with the rest (4b-i): the wizard asks it again on
    // screen 8, and until it does, the screening reads unanswered.
    expect(await healthScreening(cookies)).toMatchObject({ answered: false, hasCondition: null, noCalorieCut: false });
    // No row is left, and the weight the person typed is still in the history.
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.n).toBe("0");
    expect(await currentWeightKg(sql, userId)).toBe(70);
    // A second reset answers as the first.
    const again = await inject({ method: "DELETE", url: path(), cookies });
    expect(again.statusCode).toBe(200);
    expect(JSON.parse(again.body)).toEqual(body);
    // An unknown query parameter is refused, as on the other two routes.
    expect((await inject({ method: "DELETE", url: "/v1/users/me/onboarding?tz=UTC", cookies })).statusCode).toBe(400);
    // The health yes is gone with it: the same seven answers, given again, get
    // the plan WITH its calorie cut, because there is no yes left to hold it.
    expect((await completeScreens(cookies)).plan).toMatchObject(GOLDEN_LOSE);
  });

  it("screen 9 stores the diet and the meals, changes neither number, and refuses what is not a diet", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-food@example.com");
    // The plan before any food answer, and after each one: identical. Nothing
    // on this screen is an input to the calorie maths (4b-ii) — if it ever
    // became one, every figure below would move.
    const before = await completeScreens(cookies);
    expect(before.answers).toMatchObject({ diet: "non_vegetarian", mealsPerDay: 3 });

    for (const diet of dietSchema.options) {
      const body = await patchOk(cookies, { diet });
      expect(body.answers["diet"], diet).toBe(diet);
      expect(body.plan, diet).toMatchObject(GOLDEN_LOSE);
    }
    for (const mealsPerDay of [2, 3, 4, 5, 6]) {
      const body = await patchOk(cookies, { mealsPerDay });
      expect(body.answers["mealsPerDay"]).toBe(mealsPerDay);
      expect(body.plan).toMatchObject(GOLDEN_LOSE);
    }
    // Saved as you go: one answer never touches the other, nor any other screen.
    const one = await patchOk(cookies, { diet: "vegan" });
    expect(one.answers).toMatchObject({ diet: "vegan", mealsPerDay: 6, weightGoal: "lose", trainingDays: 3 });

    // A word that is not one of the four, and a meal count outside the rail,
    // are refused by the contract — the screen cannot send them, and the
    // database has the same rule if a writer ever skips it.
    for (const body of [
      { diet: "pescatarian" },
      { diet: "" },
      { mealsPerDay: 1 },
      { mealsPerDay: 7 },
      { mealsPerDay: 3.5 },
      { cuisine: "indian" }, // there is no cuisine question (RULINGS 2026-09-12)
    ]) {
      const res = await patch(cookies, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await get(cookies)).answers).toMatchObject({ diet: "vegan", mealsPerDay: 6 });
  });

  it("the v1 fitness-profile PUT does not wipe the v2 answers it cannot ask about", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-v1-put@example.com");
    await completeScreens(cookies);
    const put = await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: {
        age: 41,
        gender: "male",
        weightGoal: "lose",
        fitnessGoals: ["endurance"],
        exerciseFrequency: 5,
        sessionDurationMin: 60,
      },
      cookies,
    });
    expect(put.statusCode).toBe(200);
    const after = await get(cookies);
    // The four columns only the screens ask survived a full-document PUT.
    expect(after.answers).toMatchObject({
      pace: "steady",
      dayActivity: "sitting",
      pushUpsMax: 12,
      plankHoldSeconds: 45,
    });
    // The columns the two screens SHARE follow the newer write, as they must —
    // they are one answer, asked twice, not two answers. Screen 1's two
    // questions are among them since 4a-iv.
    expect(after.answers).toMatchObject({
      weightGoal: "lose",
      fitnessGoals: ["endurance"],
      age: 41,
      gender: "male",
      trainingDays: 5,
      sessionMinutes: 60,
    });
    // And every shared column the PUT body OMITTED is cleared, because that is
    // what a full-document PUT has always meant on this route. Unchanged
    // behaviour, pinned here so the v1 form's reach stays visible — and exact,
    // so a column quietly joining or leaving that reach shows up as a failure.
    expect(after.answers["heightCm"]).toBeNull();
    expect(after.answers["targetWeightKg"]).toBeNull();
    expect([...after.missing].sort()).toEqual(["heightCm", "targetWeightKg"]);
    // Screen 9's two joined that reach at 4b-ii, because Settings asks them:
    // omitted, they clear like every other shared column. The PLAN's missing
    // list still never names them — no meal answer is an input to a number.
    expect(after.answers["diet"]).toBeNull();
    expect(after.answers["mealsPerDay"]).toBeNull();
    // The pace, though, is only the screens': the target went and the pace stayed.
    expect(after.answers["pace"]).toBe("steady");
    expect(await goalsOf(userId)).toEqual({ weightGoal: "lose", goals: ["endurance"] });
  });

  it("isolates users: A's answers are invisible to B and untouched by B's writes, B's reset included", { timeout: 60_000 }, async () => {
    const a = await makeUser("ob-tenant-a@example.com");
    const b = await makeUser("ob-tenant-b@example.com");
    await completeScreens(a.cookies);
    await patchOk(b.cookies, { weightGoal: "maintain", fitnessGoals: ["posture"], age: 55, displayName: "Stranger" });
    expect((await get(a.cookies)).answers).toMatchObject({ weightGoal: "lose", fitnessGoals: [], age: 30, displayName: "OB Fixture" });
    expect((await get(b.cookies)).answers).toMatchObject({
      weightGoal: "maintain",
      fitnessGoals: ["posture"],
      age: 55,
      pace: null,
      displayName: "Stranger",
    });
    expect((await get(b.cookies)).plan).toBeNull();
    const names = await sql<{ id: string; display_name: string }[]>`
      SELECT id, display_name FROM users WHERE id IN (${a.userId}, ${b.userId}) ORDER BY display_name`;
    expect(names).toEqual([
      { id: a.userId, display_name: "OB Fixture" },
      { id: b.userId, display_name: "Stranger" },
    ]);
    const rows = await sql<{ user_id: string; weight_goal: string | null }[]>`
      SELECT user_id, weight_goal FROM user_fitness_profiles
      WHERE user_id IN (${a.userId}, ${b.userId}) ORDER BY weight_goal`;
    expect(rows).toEqual([
      { user_id: a.userId, weight_goal: "lose" },
      { user_id: b.userId, weight_goal: "maintain" },
    ]);
    // B's reset clears B's answers and nobody else's.
    expect((await inject({ method: "DELETE", url: path(), cookies: b.cookies })).statusCode).toBe(200);
    expect((await get(a.cookies)).answers).toMatchObject({ weightGoal: "lose", age: 30, pace: "steady", trainingDays: 3 });
    expect((await get(b.cookies)).answers).toMatchObject({ weightGoal: null, fitnessGoals: [], age: null, displayName: "Stranger" });
  });

  it("a soft-deleted person is refused before any write, and their answers stop changing", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-deleted@example.com");
    await patchOk(cookies, SCREENS.goal);
    expect((await inject({ method: "POST", url: "/v1/users/me/delete-code", cookies })).statusCode).toBe(200);
    const code = deleteCodes[deleteCodes.length - 1];
    expect((await inject({ method: "DELETE", url: "/v1/users/me", cookies, body: { code } })).statusCode).toBe(200);
    expect((await patch(cookies, { weightGoal: "maintain" })).statusCode).toBe(401);
    expect((await inject({ method: "GET", url: path(), cookies })).statusCode).toBe(401);
    expect((await inject({ method: "DELETE", url: path(), cookies })).statusCode).toBe(401);
    const rows = await sql<{ weight_goal: string | null }[]>`
      SELECT weight_goal FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.weight_goal).toBe("lose");
  });

  it("the repo's own active-only guard refuses a soft-deleted user — the route never reaches it", { timeout: 30_000 }, async () => {
    const { userId } = await makeUser("ob-deleted-repo@example.com");
    // Prove the guard has something to guard: the same call works while active.
    expect(await patchOnboarding(sql, userId, { weightGoal: "maintain" })).not.toBeNull();
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${userId}`;
    expect(await patchOnboarding(sql, userId, { weightGoal: "gain", weightKg: 99, displayName: "Ghost" })).toBeNull();
    // Nor can a reset reach the answers of an account that is not active.
    expect(await deleteOnboarding(sql, userId)).toBeNull();
    const rows = await sql<{ weight_goal: string | null }[]>`
      SELECT weight_goal FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.weight_goal).toBe("maintain");
    expect(await currentWeightKg(sql, userId)).toBeNull();
    const names = await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`;
    expect(names[0]?.display_name).toBe("OB Fixture");
  });

  it("the database refuses a value the contract would have refused, for any writer that skips it", { timeout: 30_000 }, async () => {
    const { userId } = await makeUser("ob-checks@example.com");
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "23514" });
    await sql`INSERT INTO user_fitness_profiles (user_id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
    await refused(sql`UPDATE user_fitness_profiles SET weight_goal = 'keep' WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET fitness_goals = ARRAY['weight_loss'] WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET available_equipment = ARRAY['barbell'] WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET available_equipment = ARRAY['none', 'gym'] WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET pace = 'extreme' WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET day_activity = 'lying_down' WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET push_ups_max = 501 WHERE user_id = ${userId}`);
    await refused(sql`UPDATE user_fitness_profiles SET plank_hold_seconds = -1 WHERE user_id = ${userId}`);
  });

  it("every weight choice moves the calories its own way, and every goal beside it is storable and moves none", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-every-goal@example.com");
    const base = await completeScreens(cookies);
    for (const weightGoal of weightGoalSchema.options) {
      // A target on the right side of 70 kg for the choice.
      const targetWeightKg = weightGoal === "gain" ? 75 : 65;
      const body = await patchOk(cookies, { weightGoal, targetWeightKg, pace: "steady" });
      expect(body.answers["weightGoal"]).toBe(weightGoal);
      expect(body.plan, `${weightGoal} produced no plan`).not.toBeNull();
      const change = Number(body.plan?.["dailyChangeKcal"]);
      if (weightGoal === "lose") expect(change, weightGoal).toBeLessThan(0);
      else if (weightGoal === "gain") expect(change, weightGoal).toBeGreaterThan(0);
      else expect(change, weightGoal).toBe(0);
    }
    await patchOk(cookies, { weightGoal: "lose", targetWeightKg: 65 });
    for (const goal of fitnessGoalSchema.options) {
      const body = await patchOk(cookies, { fitnessGoals: [goal] });
      expect(body.answers["fitnessGoals"]).toEqual([goal]);
      expect(body.plan?.["targetKcal"], goal).toBe(base.plan?.["targetKcal"]);
    }
  });

  it("finishing is refused while an answer is missing, and a refused finish writes nothing", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-completed@example.com");
    // The gate the whole training side reads is the SAME column, so this is
    // what the rest of the app sees — not just what this route echoes back.
    const completed = async () => {
      const res = await inject({ method: "GET", url: "/v1/users/me", cookies });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.body) as { user: { onboardingCompleted: boolean } }).user.onboardingCompleted;
    };
    const refused = async (body: unknown, missing: string[]) => {
      const res = await patch(cookies, body);
      expect(res.statusCode, res.body).toBe(409);
      const parsed = onboardingIncompleteBodySchema.parse(JSON.parse(res.body));
      expect([...parsed.missing].sort()).toEqual([...missing].sort());
    };

    // Nothing answered: refused, naming all eight, the health question and
    // screen 9's two, and not even a row is made.
    await refused({ onboardingCompleted: true }, [...CORE_EIGHT, ...SETUP_ONLY]);
    expect(await completed()).toBe(false);
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.n).toBe("0");

    // A refused finish takes the rest of its body down with it — the answer
    // and the weigh-in alike. The list is read from the answers AS SENT, so
    // the goal and the weight are no longer in it.
    await refused(
      { weightGoal: "maintain", weightKg: 80, displayName: "Not Saved", onboardingCompleted: true },
      [...CORE_EIGHT.filter((k) => k !== "goal" && k !== "weightKg"), ...SETUP_ONLY],
    );
    expect((await get(cookies)).answers["weightGoal"]).toBeNull();
    expect(await currentWeightKg(sql, userId)).toBeNull();
    expect((await get(cookies)).answers["displayName"]).toBe("OB Fixture");

    // One answer short: the open one is named, and the gate stays shut.
    for (const screen of [SCREENS.goal, SCREENS.aboutYou, SCREENS.target, SCREENS.yourDay, SCREENS.yourTraining]) {
      await patchOk(cookies, screen);
    }
    await patchOk(cookies, { trainingDays: 3 });
    await refused({ onboardingCompleted: true }, ["sessionMinutes", ...SETUP_ONLY]);
    expect(await completed()).toBe(false);

    // EVERYTHING THE PLAN NEEDS, AND STILL REFUSED: the health question is
    // screen 8's own and screen 9's two are the food answers (4b-i, 4b-ii),
    // and setup does not end without any of the three. The plan itself is
    // complete — an unanswered screening applies no condition rule, and no
    // meal answer moves a calorie — so the number is on screen while the
    // finish is refused, naming only those.
    await patchOk(cookies, { sessionMinutes: 45 });
    expect((await get(cookies)).plan).toMatchObject(GOLDEN_LOSE);
    await refused({ onboardingCompleted: true }, SETUP_ONLY);
    expect(await completed()).toBe(false);

    // One food answer at a time: each one given stops being named, and the
    // other still holds the finish. Neither moves the number.
    expect((await patchOk(cookies, { diet: "vegan" })).plan).toMatchObject(GOLDEN_LOSE);
    await refused({ onboardingCompleted: true }, ["health", "mealsPerDay"]);
    expect((await patchOk(cookies, { mealsPerDay: 3 })).plan).toMatchObject(GOLDEN_LOSE);
    await refused({ onboardingCompleted: true }, ["health"]);
    expect(await completed()).toBe(false);

    // A food answer cleared afterwards holds the finish again, exactly as an
    // answer never given does.
    await patchOk(cookies, { diet: null });
    await refused({ onboardingCompleted: true }, ["health", "diet"]);
    await patchOk(cookies, { diet: "non_vegetarian" });

    // Answered on its own route, and the finish is taken.
    await answerHealth(cookies, { hasCondition: false });
    const done = await patchOk(cookies, { onboardingCompleted: true });
    expect(done.answers["onboardingCompleted"]).toBe(true);
    expect(done.plan).toMatchObject(GOLDEN_LOSE);
    expect(await completed()).toBe(true);

    // Changing an answer afterwards is allowed and does not undo the finish…
    expect((await patchOk(cookies, { dayActivity: null })).answers["onboardingCompleted"]).toBe(true);
    expect(await completed()).toBe(true);
    // …but finishing again reads the answers, not the flag's history, and a
    // refusal leaves the stored flag as it was.
    await refused({ onboardingCompleted: true }, ["dayActivity"]);
    expect(await completed()).toBe(true);
    // The save that brings the last answer back may finish in the same body.
    expect((await patchOk(cookies, { dayActivity: "sitting", onboardingCompleted: true })).answers["onboardingCompleted"]).toBe(true);
    expect(await completed()).toBe(true);

    // Going back to "not finished" is always allowed.
    expect((await patchOk(cookies, { onboardingCompleted: false })).answers["onboardingCompleted"]).toBe(false);
    expect(await completed()).toBe(false);
  });

  it("stamps every real save, and says honestly when there is nothing stamped yet", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ob-stamp@example.com");
    // Body weight lives in the weigh-in history, so a weight-only save creates
    // no profile row: there is no stamp, and the contract says null rather
    // than inventing one.
    const weightOnly = await patchOk(cookies, { weightKg: 70 });
    expect(weightOnly.answers["weightKg"]).toBe(70);
    expect(weightOnly.answers["updatedAt"]).toBeNull();

    const first = await patchOk(cookies, { weightGoal: "lose" });
    const firstAt = first.answers["updatedAt"];
    expect(typeof firstAt).toBe("string");
    await new Promise((r) => setTimeout(r, 20));
    const second = await patchOk(cookies, { fitnessLevel: "beginner" });
    // The screens read this to know a save landed, so it has to MOVE on a save.
    expect(new Date(String(second.answers["updatedAt"])).getTime()).toBeGreaterThan(
      new Date(String(firstAt)).getTime(),
    );

    // Clearing the typed weight is a real answer too, and it comes back empty.
    const cleared = await patchOk(cookies, { weightKg: null });
    expect(cleared.answers["weightKg"]).toBeNull();
    expect(cleared.missing).toContain("weightKg");
  });

  it("a stored answer outside the plan's rails fails loud — it never becomes a number", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-past-rails@example.com");
    await completeScreens(cookies);
    expect((await get(cookies)).plan).not.toBeNull();
    // The column is numeric(5,2) with no CHECK; the plan's rail is 50–300 cm.
    // Only a writer that skipped the contract could store this, which is what
    // the raw statement stands in for. The promise being pinned is the one
    // plan/answers.ts makes: fail loud, never serve a number nobody can explain.
    await sql`UPDATE user_fitness_profiles SET height_cm = 999.99 WHERE user_id = ${userId}`;
    const res = await inject({ method: "GET", url: path(), cookies });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as { error: string; message: string };
    expect(body.error).toBe("internal_error");
    // And the refusal says nothing about the stored value.
    expect(res.body).not.toContain("999");
    // The person is not stuck: answering through the contract restores it.
    expect((await patchOk(cookies, { heightCm: 165 })).plan).toMatchObject(GOLDEN_LOSE);
  });

  // ── body weight: the history is the one source (RULINGS 2026-09-10) ──────
  interface HistoryItem {
    id: string;
    measuredAt: string;
    weightKg: number | null;
    source: string;
  }
  /** The person's weigh-in history, newest first, off the real route. */
  const history = async (cookies: Record<string, string>): Promise<HistoryItem[]> => {
    const res = await inject({ method: "GET", url: "/v1/nutrition/body-measurements?limit=100", cookies });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { items: HistoryItem[] }).items;
  };
  /** `s` seconds after the newest TYPED row — fixtures are dated off the row
   *  they must outrank, never off this process's clock, so the test cannot
   *  pass by the clock skew it is supposed to rule out. */
  const afterTyped = async (cookies: Record<string, string>, s: number): Promise<string> => {
    const typed = (await history(cookies)).find((m) => m.source === "self_reported");
    if (typed === undefined) throw new Error("no typed row to date a fixture from");
    return new Date(Date.parse(typed.measuredAt) + s * 1000).toISOString();
  };
  const measureOk = async (cookies: Record<string, string>, body: unknown): Promise<string> => {
    const res = await inject({ method: "POST", url: "/v1/nutrition/body-measurements", body, cookies });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { measurement: { id: string } }).measurement.id;
  };
  const deleteOk = async (cookies: Record<string, string>, id: string): Promise<void> => {
    expect((await inject({ method: "DELETE", url: `/v1/nutrition/body-measurements/${id}`, cookies })).statusCode).toBe(204);
  };
  const ringsMissing = async (cookies: Record<string, string>): Promise<string[]> => {
    const res = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
    return (JSON.parse(res.body) as { missing: string[] }).missing;
  };
  /** Moves every typed row of this person back a day, so the next typed weight
   *  is "another day's" and appends instead of editing in place. */
  const ageTypedRows = async (userId: string): Promise<void> => {
    await sql`
      UPDATE body_measurements SET created_at = created_at - interval '1 day'
      WHERE user_id = ${userId} AND source = 'self_reported'`;
  };

  it("a body measurement that carries no weight leaves the typed weight, the plan and the rings alone", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-measure@example.com");
    expect((await completeScreens(cookies)).plan).toMatchObject(GOLDEN_LOSE);
    const measure = (body: unknown) =>
      inject({ method: "POST", url: "/v1/nutrition/body-measurements", body, cookies });
    const ringsAnswer = () => ringsMissing(cookies);
    // Weigh-ins dated a few seconds AFTER the typed weight: the number on
    // screen is the newest weight-bearing row BY DATE.
    const at = (s: number) => afterTyped(cookies, s);

    // A waist-only measurement says NOTHING about weight (weightKg is optional
    // on that contract), so it must not be able to erase screen 2's answer —
    // which would blank the plan and the macro rings in the same moment.
    const waist = await measure({ measuredAt: await at(1), metrics: { waist_cm: 80 } });
    expect(waist.statusCode).toBe(201);
    const waistId = (JSON.parse(waist.body) as { measurement: { id: string } }).measurement.id;
    const afterWaist = await get(cookies);
    expect(afterWaist.answers["weightKg"]).toBe(70);
    expect(afterWaist.missing).toEqual([]);
    expect(afterWaist.plan).toMatchObject(GOLDEN_LOSE);
    expect(await ringsAnswer()).toEqual([]);

    // Editing that row's waist alone does not disturb the weight either.
    expect(
      (
        await inject({
          method: "PATCH",
          url: `/v1/nutrition/body-measurements/${waistId}`,
          body: { metrics: { waist_cm: 79 } },
          cookies,
        })
      ).statusCode,
    ).toBe(200);
    expect((await get(cookies)).answers["weightKg"]).toBe(70);

    // Nor does deleting it.
    expect(
      (await inject({ method: "DELETE", url: `/v1/nutrition/body-measurements/${waistId}`, cookies })).statusCode,
    ).toBe(204);
    expect((await get(cookies)).answers["weightKg"]).toBe(70);

    // A weigh-in dated AFTER the typed weight sets the number.
    const weighed = await measure({ measuredAt: await at(2), weightKg: 68 });
    expect(weighed.statusCode).toBe(201);
    const weighedId = (JSON.parse(weighed.body) as { measurement: { id: string } }).measurement.id;
    expect((await get(cookies)).answers["weightKg"]).toBe(68);

    // And deleting it comes back to the typed 70, because the typed weight is
    // a weighed row of its own — not to a blank, not to the deleted 68.
    expect(
      (await inject({ method: "DELETE", url: `/v1/nutrition/body-measurements/${weighedId}`, cookies })).statusCode,
    ).toBe(204);
    expect((await get(cookies)).answers["weightKg"]).toBe(70);

    // A weigh-in the person dates BEFORE what they typed today does not outrank
    // it: the typed row is the newest, so the screen keeps saying 70.
    const earlier = await measure({ measuredAt: await at(-3600), weightKg: 64 });
    expect(earlier.statusCode).toBe(201);
    expect((await get(cookies)).answers["weightKg"]).toBe(70);

    // The person types a new weight, then logs a waist. Nothing in that waist
    // says anything about weight, so none of the three weightless writes may
    // move the number: the rule never picks a weightless row.
    expect((await patchOk(cookies, { weightKg: 72 })).answers["weightKg"]).toBe(72);
    const second = await measure({ measuredAt: await at(3), metrics: { waist_cm: 78 } });
    expect(second.statusCode).toBe(201);
    const secondId = (JSON.parse(second.body) as { measurement: { id: string } }).measurement.id;
    expect((await get(cookies)).answers["weightKg"], "creating a weightless row moved the weight").toBe(72);
    expect(
      (
        await inject({
          method: "PATCH",
          url: `/v1/nutrition/body-measurements/${secondId}`,
          body: { metrics: { waist_cm: 77 } },
          cookies,
        })
      ).statusCode,
    ).toBe(200);
    expect((await get(cookies)).answers["weightKg"], "editing a weightless row moved the weight").toBe(72);
    expect(
      (await inject({ method: "DELETE", url: `/v1/nutrition/body-measurements/${secondId}`, cookies })).statusCode,
    ).toBe(204);
    expect((await get(cookies)).answers["weightKg"], "deleting a weightless row moved the weight").toBe(72);
  });

  it("a deleted or cleared mis-entry falls back to the weight before it, never to itself and never to a blank", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("ob-measure-gone@example.com");
    const typed = await completeScreens(cookies);
    expect(typed.plan).toMatchObject(GOLDEN_LOSE);
    const at = (s: number) => afterTyped(cookies, s);
    const measure = (body: unknown) => measureOk(cookies, body);
    const del = (id: string) => deleteOk(cookies, id);
    const clearWeight = async (id: string) => {
      expect(
        (await inject({ method: "PATCH", url: `/v1/nutrition/body-measurements/${id}`, body: { weightKg: null }, cookies }))
          .statusCode,
      ).toBe(200);
    };

    // Two weigh-ins, and the number follows the newer one.
    const older = await measure({ measuredAt: await at(1), weightKg: 69 });
    const newer = await measure({ measuredAt: await at(2), weightKg: 68 });
    expect((await get(cookies)).answers["weightKg"]).toBe(68);

    // Deleting the newer one falls back to the one before it.
    await del(newer);
    const onOlder = await get(cookies);
    expect(onOlder.answers["weightKg"]).toBe(69);
    expect(onOlder.plan).not.toEqual(typed.plan);

    // Deleting the last weigh-in falls back to the TYPED weight — the fix this
    // test exists for. A COALESCE onto the column would have kept 69 here, the
    // very number the person just said was wrong; an empty subquery would have
    // blanked the plan and the rings. The plan is the one screen 2 produced.
    await del(older);
    const afterDelete = await get(cookies);
    expect(afterDelete.answers["weightKg"]).toBe(70);
    expect(afterDelete.missing).toEqual([]);
    expect(afterDelete.plan).toEqual(typed.plan);
    expect(await ringsMissing(cookies)).toEqual([]);

    // The same correction one step earlier: clearing the weight ON the row.
    const again = await measure({ measuredAt: await at(3), weightKg: 67 });
    expect((await get(cookies)).answers["weightKg"]).toBe(67);
    await clearWeight(again);
    const afterClear = await get(cookies);
    expect(afterClear.answers["weightKg"]).toBe(70);
    expect(afterClear.missing).toEqual([]);
    expect(afterClear.plan).toEqual(typed.plan);

    // And with an older weigh-in still present, clearing the newest moves the
    // number to THAT one — the recompute must run for a cleared weight, not
    // only for a row that still carries one.
    const sixtySix = await measure({ measuredAt: await at(4), weightKg: 66 });
    const top = await measure({ measuredAt: await at(5), weightKg: 65 });
    expect((await get(cookies)).answers["weightKg"]).toBe(65);
    await clearWeight(top);
    expect((await get(cookies)).answers["weightKg"]).toBe(66);

    // Nobody is stuck with a number they no longer want: screen 2 clears it
    // outright, and so does PATCH /v1/users/me. Emptying the weight is a thing
    // the person asks for, never something a delete does behind their back.
    const cleared = await patchOk(cookies, { weightKg: null });
    expect(cleared.answers["weightKg"]).toBeNull();
    expect(cleared.missing).toContain("weightKg");

    // The clear is a row of its own, the newest one, so deleting an OLDER
    // weigh-in afterwards cannot bring its number back: the person said
    // "no weight", and the history still says so.
    await del(sixtySix);
    expect((await get(cookies)).answers["weightKg"]).toBeNull();
    expect(await ringsMissing(cookies)).toContain("weightKg");
  });

  it("a weigh-in dated ahead of the clock never outranks the weight typed today, and retyping it stacks nothing", { timeout: 60_000 }, async () => {
    // The contract lets a weigh-in be dated up to 24 h ahead (a phone clock
    // that runs fast). Such a row must not swallow what the person types on
    // screen 2 — the screen and the plan would then show a number they did
    // not type — and a typed row that never became the newest one was being
    // re-inserted on every save of that screen.
    const { userId, cookies } = await makeUser("ob-measure-future@example.com");
    const ahead = await measureOk(cookies, {
      measuredAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      weightKg: 85,
    });
    expect((await get(cookies)).answers["weightKg"]).toBe(85);

    // Screen 2 types 70. The screen reads back 70 and the plan is built from 70.
    const done = await completeScreens(cookies);
    expect(done.answers["weightKg"]).toBe(70);
    expect(done.plan).toMatchObject(GOLDEN_LOSE);
    expect(await ringsMissing(cookies)).toEqual([]);

    // The typed row is the newest of everything, including the row dated ahead.
    const items = await history(cookies);
    expect(items.map((m) => [m.source, m.weightKg])).toEqual([["self_reported", 70], ["manual", 85]]);

    // The same 70 sent three more times (a save-as-you-go screen) adds nothing
    // — and neither does the same 70 on a LATER day, which is what a profile
    // form that echoes the weight it loaded sends on every save.
    for (let i = 0; i < 3; i += 1) expect((await patchOk(cookies, { weightKg: 70 })).answers["weightKg"]).toBe(70);
    expect((await history(cookies)).length).toBe(2);
    await ageTypedRows(userId);
    expect((await patchOk(cookies, { weightKg: 70 })).answers["weightKg"]).toBe(70);
    expect((await history(cookies)).length).toBe(2);

    // Deleting the typed row falls back to the weigh-in, the only weight left.
    const typed = items[0];
    if (typed === undefined) throw new Error("no typed row");
    await deleteOk(cookies, typed.id);
    expect((await get(cookies)).answers["weightKg"]).toBe(85);
    await deleteOk(cookies, ahead);
    expect((await get(cookies)).answers["weightKg"]).toBeNull();
  });

  it("typing the number already showing writes nothing; a same-day retype edits the entry; another day appends", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-measure-retype@example.com");
    // A weigh-in of 70 from nine days ago is the number showing.
    const old = await measureOk(cookies, {
      measuredAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      weightKg: 70,
    });
    expect((await get(cookies)).answers["weightKg"]).toBe(70);

    // Screen 2 types the same 70. The history already says 70, so nothing is
    // written: a "typed by me" copy of a weigh-in would outrank it, and
    // deleting that weigh-in as a mistake would then keep the mistake alive.
    await completeScreens(cookies);
    expect((await history(cookies)).map((m) => [m.source, m.weightKg])).toEqual([["manual", 70]]);

    // 71 → 72 on a save-as-you-go screen is ONE typed entry that ends at 72,
    // not two "weigh-ins" of which one is a number the person never had.
    // (Same day in the person's zone — UTC for a fixture with no zone set — so
    // this leg could only misfire within a second of UTC midnight.)
    expect((await patchOk(cookies, { weightKg: 71 })).answers["weightKg"]).toBe(71);
    expect((await history(cookies)).map((m) => [m.source, m.weightKg])).toEqual([["self_reported", 71], ["manual", 70]]);
    expect((await patchOk(cookies, { weightKg: 72 })).answers["weightKg"]).toBe(72);
    const sameDay = await history(cookies);
    expect(sameDay.map((m) => [m.source, m.weightKg])).toEqual([["self_reported", 72], ["manual", 70]]);

    // Another day, another number: that is a new entry, and the day before's
    // stays in the history as the weight the person had then.
    await ageTypedRows(userId);
    expect((await patchOk(cookies, { weightKg: 73 })).answers["weightKg"]).toBe(73);
    const nextDay = await history(cookies);
    expect(nextDay.map((m) => [m.source, m.weightKg])).toEqual([["self_reported", 73], ["self_reported", 72], ["manual", 70]]);

    // Deleting entries walks back through numbers the person actually had —
    // 72, then the weigh-in — and never lands on the 71 that was retyped away.
    const [newest, previous] = nextDay;
    if (newest === undefined || previous === undefined) throw new Error("history too short");
    await deleteOk(cookies, newest.id);
    expect((await get(cookies)).answers["weightKg"]).toBe(72);
    await deleteOk(cookies, previous.id);
    expect((await get(cookies)).answers["weightKg"]).toBe(70);
    await deleteOk(cookies, old);
    expect((await get(cookies)).answers["weightKg"]).toBeNull();
  });

  it("a weight the person cleared stays cleared, whatever happens to older entries", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-measure-cleared@example.com");
    await completeScreens(cookies); // types 70
    await ageTypedRows(userId);
    expect((await patchOk(cookies, { weightKg: 73 })).answers["weightKg"]).toBe(73);
    expect((await history(cookies)).map((m) => [m.source, m.weightKg])).toEqual([["self_reported", 73], ["self_reported", 70]]);

    // The clear lands on today's typed entry: it now says "no weight", and it
    // is the newest thing that says anything about weight.
    const cleared = await patchOk(cookies, { weightKg: null });
    expect(cleared.answers["weightKg"]).toBeNull();
    expect(cleared.missing).toContain("weightKg");
    const afterClear = await history(cookies);
    expect(afterClear.map((m) => [m.source, m.weightKg])).toEqual([["self_reported", null], ["self_reported", 70]]);
    // Clearing again changes nothing.
    await patchOk(cookies, { weightKg: null });
    expect((await history(cookies)).length).toBe(2);

    // Deleting the older 70 does not bring anything back; nor does a waist.
    const older = afterClear[1];
    if (older === undefined) throw new Error("no older row");
    await deleteOk(cookies, older.id);
    expect((await get(cookies)).answers["weightKg"]).toBeNull();
    await measureOk(cookies, { measuredAt: await afterTyped(cookies, 1), metrics: { waist_cm: 80 } });
    expect((await get(cookies)).answers["weightKg"]).toBeNull();

    // A NEW weigh-in dated after the clear sets the number, and deleting that
    // weigh-in falls back to the clear — never to the 70 that was cleared.
    const fresh = await measureOk(cookies, { measuredAt: await afterTyped(cookies, 2), weightKg: 74 });
    expect((await get(cookies)).answers["weightKg"]).toBe(74);
    await deleteOk(cookies, fresh);
    expect((await get(cookies)).answers["weightKg"]).toBeNull();
    expect(await ringsMissing(cookies)).toContain("weightKg");

    // And typing a number again the same day fills the cleared entry in.
    expect((await patchOk(cookies, { weightKg: 71 })).answers["weightKg"]).toBe(71);
    expect((await history(cookies)).filter((m) => m.source === "self_reported").map((m) => m.weightKg)).toEqual([71]);
  });

  it("the profile form echoing a weigh-in's number leaves no phantom typed entry, so deleting the weigh-in undoes it", { timeout: 60_000 }, async () => {
    // A profile form that loads the current weight into its box may send it
    // back with any save, even a name change. That echo is not a typed entry:
    // recorded as "typed by me" it would outrank the weigh-in it copied, and
    // deleting that weigh-in as a mistake would keep the mistake on screen.
    const { cookies } = await makeUser("ob-measure-echo@example.com");
    await completeScreens(cookies); // types 70
    const mistake = await measureOk(cookies, { measuredAt: await afterTyped(cookies, 1), weightKg: 90 });
    expect((await get(cookies)).answers["weightKg"]).toBe(90);

    // The profile form saves a new name — and, as it does, echoes the 90.
    const echoed = await inject({ method: "PATCH", url: "/v1/users/me", body: { displayName: "Renamed", weightKg: 90 }, cookies });
    expect(echoed.statusCode, echoed.body).toBe(200);
    expect((await history(cookies)).map((m) => [m.source, m.weightKg])).toEqual([["manual", 90], ["self_reported", 70]]);

    // The mistaken weigh-in is deleted: the previous true weight is back.
    await deleteOk(cookies, mistake);
    expect((await get(cookies)).answers["weightKg"]).toBe(70);
    const me = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect((JSON.parse(me.body) as { user: { weightKg: number | null; displayName: string } }).user).toMatchObject({ weightKg: 70, displayName: "Renamed" });
  });

  /** Resolves, with the waiting backend's pid, once `n` other connections are
   *  queued on a lock `holderPid` holds. A lock test must SEE the second
   *  transaction waiting before it lets the first go on: a fixed sleep lets a
   *  slow start run the second one after the first has committed, and then no
   *  conflict forms and a broken lock order passes. */
  const waitUntilQueuedBehind = async (holderPid: number, n = 1): Promise<number[]> => {
    for (let i = 0; i < 400; i += 1) {
      const rows = await sql<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND ${holderPid}::int = ANY(pg_blocking_pids(pid))`;
      if (rows.length >= n) return rows.map((r) => r.pid);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    throw new Error(`fewer than ${String(n)} queued behind backend ${String(holderPid)} within 10 s`);
  };

  /** Runs `first` in a transaction and holds it open at `hold` until `second`
   *  is seen queued behind it (`queued` sees the waiting backends then), then
   *  lets it finish. Both outcomes come back, errors included, so a deadlock
   *  reads as a failed expectation. */
  const interleave = async <T>(
    first: (tx: postgres.TransactionSql, hold: () => Promise<void>) => Promise<void>,
    second: () => Promise<T>,
    queued: (pids: number[]) => Promise<void> = () => Promise.resolve(),
    expectQueued = 1,
  ): Promise<{ firstError: unknown; secondError: unknown; second: T | null }> => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reportPid: (pid: number) => void = () => undefined;
    const pidOfFirst = new Promise<number>((resolve) => {
      reportPid = resolve;
    });
    let firstError: unknown = null;
    const firstDone = sql
      .begin(async (tx) => {
        await first(tx, async () => {
          const [me] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          reportPid(me?.pid ?? -1);
          await held;
        });
      })
      .catch((err: unknown) => {
        firstError = err;
      });
    const pid = await pidOfFirst;
    let secondError: unknown = null;
    const secondDone = second().catch((err: unknown) => {
      secondError = err;
      return null;
    });
    const pids = await waitUntilQueuedBehind(pid, expectQueued);
    // The holder is released whatever `queued` found, so a failed expectation
    // there never leaves a transaction open behind the next test.
    const queuedOutcome = await queued(pids).then(
      () => null,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    release();
    await firstDone;
    const result = await secondDone;
    if (queuedOutcome !== null) throw queuedOutcome;
    return { firstError, secondError, second: result };
  };

  /** Holds the person's users row the way every real save takes it. */
  const holdUsersRow = (userId: string) => async (tx: postgres.TransactionSql, hold: () => Promise<void>) => {
    await tx`SELECT id FROM users WHERE id = ${userId} AND status = 'active' FOR NO KEY UPDATE`;
    await hold();
  };

  /** Locks the waiting backends hold on the history TABLE: must be none. A
   *  row lock itself lives in the row's header, not in pg_locks — but every
   *  INSERT, UPDATE or DELETE first takes a table-level lock on the relation,
   *  and that one is listed. A writer that has not yet touched the history
   *  holds nothing on it. */
  const historyLocksHeldBy = async (pids: number[]): Promise<number> => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks
      WHERE pid = ANY(${pids}::int[]) AND relation = 'body_measurements'::regclass AND granted`;
    return row?.n ?? 0;
  };

  it("every real save takes the users row BEFORE any history row: none can deadlock with another", { timeout: 60_000 }, async () => {
    // ONE lock order, pinned on the REAL writers, not on a hand-written copy
    // of their shape. With the users row held, each of the five saves that
    // touch the history queues on it — and while it waits it holds NO row of
    // the history. A writer that took a history row first would be the
    // opposite order, and interleaved with any of the others a deadlock
    // (40P01 — a 500 on a save that was perfectly fine).
    const { userId, cookies } = await makeUser("ob-measure-lock-order@example.com");
    await completeScreens(cookies); // one typed row, today
    const typed = (await history(cookies)).find((m) => m.source === "self_reported");
    if (typed === undefined) throw new Error("no typed row");
    const input = { measuredAt: new Date().toISOString(), weightKg: 69, metrics: {}, source: "manual" as const };

    const writers: [string, () => Promise<unknown>][] = [
      ["screen 2", () => patchOnboarding(sql, userId, { weightKg: 71 })],
      ["the profile form", () => updateProfile(sql, userId, { weightKg: 72 })],
      ["an edit of the typed entry", () => updateMeasurement(sql, userId, typed.id, { weightKg: 73 })],
      ["a new weigh-in", () => createMeasurement(sql, userId, input)],
      ["a delete of the typed entry", () => deleteMeasurement(sql, userId, typed.id)],
    ];
    for (const [name, write] of writers) {
      const out = await interleave(holdUsersRow(userId), write, async (pids) => {
        expect(await historyLocksHeldBy(pids), `${name} took a history row before the users row`).toBe(0);
      });
      expect(out.firstError, `${name}: the holder was aborted`).toBeNull();
      expect(out.secondError, `${name} was aborted`).toBeNull();
    }
    // Every write ran after the holder committed, in order: the typed entry
    // ended at 73, then the weigh-in 69 was logged, then the typed entry was
    // deleted — so the weigh-in is what is left.
    expect((await history(cookies)).map((m) => [m.source, m.weightKg])).toEqual([["manual", 69]]);
    expect((await get(cookies)).answers["weightKg"]).toBe(69);
  });

  it("a history write that waits behind the account's deletion is refused with the same 401, whichever write it is", { timeout: 60_000 }, async () => {
    // It passes sign-in while the deletion is still uncommitted, then queues
    // on the users row. All three writes answer as sign-in does for every
    // request after a deletion, and nothing is saved into the closing account.
    // One person per write: the app's pool is a single connection, so only
    // one request can be seen waiting at a time.
    const writes: [string, (id: string) => { method: "POST" | "PATCH" | "DELETE"; url: string; body?: unknown }][] = [
      ["post", () => ({ method: "POST", url: "/v1/nutrition/body-measurements", body: { measuredAt: new Date().toISOString(), weightKg: 71 } })],
      ["patch", (id) => ({ method: "PATCH", url: `/v1/nutrition/body-measurements/${id}`, body: { weightKg: 72 } })],
      ["delete", (id) => ({ method: "DELETE", url: `/v1/nutrition/body-measurements/${id}` })],
    ];
    for (const [name, request] of writes) {
      const { userId, cookies } = await makeUser(`ob-measure-deleted-mid-${name}@example.com`);
      const id = await measureOk(cookies, { measuredAt: new Date().toISOString(), weightKg: 70 });
      const out = await interleave(
        async (tx, hold) => {
          // softDeleteUser's first statement.
          await tx`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${userId} AND status = 'active'`;
          await hold();
        },
        () => inject({ ...request(id), cookies }),
      );
      expect(out.firstError, name).toBeNull();
      expect(out.secondError, name).toBeNull();
      expect(out.second?.statusCode, `${name}: ${out.second?.body ?? ""}`).toBe(401);
      const rows = await sql<{ id: string; weight_kg: string | null }[]>`
        SELECT id, weight_kg FROM body_measurements WHERE user_id = ${userId}`;
      expect(rows, name).toEqual([{ id, weight_kg: "70.00" }]);
    }
  });

  it("no history write lands on an account that is not active", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("ob-measure-gone-history@example.com");
    const id = await measureOk(cookies, { measuredAt: new Date().toISOString(), weightKg: 70 });
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${userId}`;

    const input = { measuredAt: new Date().toISOString(), weightKg: 71, metrics: {}, source: "manual" as const };
    await expect(createMeasurement(sql, userId, input)).rejects.toBeInstanceOf(AccountNotActiveError);
    await expect(updateMeasurement(sql, userId, id, { weightKg: 72 })).rejects.toBeInstanceOf(AccountNotActiveError);
    await expect(deleteMeasurement(sql, userId, id)).rejects.toBeInstanceOf(AccountNotActiveError);

    const rows = await sql<{ id: string; weight_kg: string | null }[]>`
      SELECT id, weight_kg FROM body_measurements WHERE user_id = ${userId}`;
    expect(rows).toEqual([{ id, weight_kg: "70.00" }]);
  });

  it("a typed weight is never written for an account that is not active — not even the same-day edit", { timeout: 30_000 }, async () => {
    // Callers hold the users row, but the read inside recordTypedWeight asks
    // for an active account on its own. The account has a typed row from
    // TODAY, so the path a forgetful caller would reach is the in-place edit
    // — the one statement with no check of its own.
    const { userId, cookies } = await makeUser("ob-measure-gone-account@example.com");
    await completeScreens(cookies); // types 70 today
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${userId}`;
    await sql.begin(async (tx) => {
      await recordTypedWeight(tx, userId, 71);
      await recordTypedWeight(tx, userId, null);
    });
    const rows = await sql<{ weight_kg: string | null; source: string }[]>`
      SELECT weight_kg, source FROM body_measurements WHERE user_id = ${userId}`;
    expect(rows).toEqual([{ weight_kg: "70.00", source: "self_reported" }]);
  });

  it("a v1 profile write's key-share lock never blocks a v2 save", { timeout: 30_000 }, async () => {
    const { userId } = await makeUser("ob-locks@example.com");
    // WHAT THIS GUARDS: the v1 upsert takes the two rows in the OPPOSITE order
    // to this route — the profile row first, then the users row as FOR KEY
    // SHARE, which is what its foreign key check does. Holding the users row
    // with a lock that conflicts with FOR KEY SHARE therefore makes one person
    // saving on both screens at the same moment a deadlock (40P01 → a 500 on a
    // save that was perfectly fine). The lock below is exactly the one that FK
    // check takes; the save must not wait on it.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = sql.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id = ${userId} FOR KEY SHARE`;
      await held;
    });
    const save = patchOnboarding(sql, userId, { weightGoal: "maintain", weightKg: 71 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome = "blocked";
    try {
      outcome = await Promise.race([
        save.then(() => "saved"),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => {
            resolve("blocked");
          }, 5000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release();
      await holder;
      await save;
    }
    expect(outcome, "the v2 save waited on the lock the v1 write's FK check takes").toBe("saved");
  });
});
