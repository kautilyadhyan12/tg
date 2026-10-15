// A CHALLENGE ABOUT AN EXERCISE, AND THE LIST THE FORM READS (ROADMAP 19d-iii-a-ii; spec Part 3
// §15.10.1, §15.10.6). DATABASE_URL-gated.
//
// The worst thing 19d-iii-a-ii could do to a real person: somebody wins a prize by a number
// nobody earned, because the server let the app "count" an exercise it cannot count, or kept
// another exercise than the one the staff picked. So: an exercise counted by the app is
// refused, an exercise the library does not offer is refused, and the one picked is the one
// kept, read back by members and staff, and locked once the challenge has started.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ChallengeSubjectsResponse, GymChallengesResponse, StaffGymChallenge, StaffGymChallengeBoardResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-challenge-exercise-test-secret-012345678", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_chex_live";
/** An exercise the library keeps but does not offer: hidden, made by this file. */
const HIDDEN = "zz_chex_hidden";
/** Wednesday 7 October 2026, noon in Kolkata. */
const WEDNESDAY = new Date("2026-10-07T06:30:00Z");

let ipCounter = 0;
const nextIp = () => `10.84.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const codeOf = (res: { body: string }): string => (JSON.parse(res.body) as { error?: string }).error ?? "";

d("a challenge about an exercise, and the list the form reads (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const clock = WEDNESDAY;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chex-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chex-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_challenges WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'chex-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
    await sql`DELETE FROM exercises WHERE slug = ${HIDDEN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `chex-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  interface Gym {
    id: string;
    name: string;
    owner: Person;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, name, owner };
  };
  const inGym = async (gymId: string, userId: string): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gymId}, ${userId}, '2026-01-01T00:00:00Z')`;
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/challenges`;
  const fields = (over: Record<string, unknown> = {}) => ({
    name: "Squat month",
    details: "",
    prize: "",
    subject: "exercise",
    measure: null,
    countedBy: "staff",
    exercises: ["squat"],
    unit: "squats",
    startsOn: "2026-10-05",
    endsOn: "2026-10-31",
    target: null,
    who: "everyone",
    ...over,
  });
  const post = (gym: Gym, over: Record<string, unknown> = {}) => inject("POST", base(gym.id), gym.owner.cookies, { challengeKey: randomUUID(), ...fields(over) });
  const added = async (gym: Gym, over: Record<string, unknown> = {}): Promise<StaffGymChallenge> => {
    const res = await post(gym, over);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { challenge: StaffGymChallenge }).challenge;
  };
  /** The exercises kept for a challenge, read from the table itself. */
  const keptExercises = async (challengeId: string): Promise<string[]> => {
    const rows = await sql<{ slug: string }[]>`
      SELECT e.slug FROM gym_challenge_exercises ce JOIN exercises e ON e.id = ce.exercise_id WHERE ce.challenge_id = ${challengeId} ORDER BY e.slug`;
    return rows.map((r) => r.slug);
  };
  const challengeRows = async (gym: Gym): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_challenges WHERE gym_id = ${gym.id}`;
    return rows[0]?.n ?? -1;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    await sql`INSERT INTO exercises (slug, name_key, family, tier, tracking, status, met) VALUES (${HIDDEN}, 'exercise.zz', 'F1', 'T3', 'pose', 'hidden', 3.0)`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "WORST THING: the app never counts an exercise, only an exercise the library offers is kept, and the one picked is the one kept",
    async () => {
      const gym = await makeGym(`Chex Gym ${uniq()}`);

      // Counted by the app: there is nothing the app counts for an exercise yet.
      for (const measure of ["reps", "days"]) {
        const res = await post(gym, { countedBy: "app", measure, unit: "" });
        expect([res.statusCode, codeOf(res)], `app counts ${measure}`).toEqual([400, "validation_error"]);
      }
      // An exercise the library does not offer: unknown, hidden, none, two; or an exercise
      // sent with something that is not about one.
      const refusals: [string, Record<string, unknown>][] = [
        ["an unknown exercise", { exercises: ["no_such_exercise"] }],
        ["a hidden exercise", { exercises: [HIDDEN] }],
        ["no exercise", { exercises: [] }],
        ["two exercises", { exercises: ["squat", "push_up"] }],
        ["the same exercise twice", { exercises: ["squat", "squat"] }],
        ["gym visits with an exercise", { subject: "gym_visits", measure: "days", countedBy: "app", unit: "" }],
        ["something else with an exercise", { subject: "own", unit: "push-ups" }],
      ];
      for (const [what, over] of refusals) {
        const res = await post(gym, over);
        expect(res.statusCode, what).toBe(400);
      }
      expect(await challengeRows(gym)).toBe(0);

      // The one picked is the one kept, and members and staff read it.
      const c = await added(gym);
      expect(await keptExercises(c.id)).toEqual(["squat"]);
      expect([c.subject, c.measure, c.countedBy, c.exercises]).toEqual(["exercise", null, "staff", ["squat"]]);
      expect([c.words.about, c.words.howLine, c.words.many, c.words.one]).toEqual(["Squats", `Counted by the staff at ${gym.name}`, "squats", "squat"]);
      const member = await signedIn("Mira Member");
      await inGym(gym.id, member.userId);
      const list = await inject("GET", base(gym.id), member.cookies);
      expect(list.statusCode, list.body).toBe(200);
      const seen = (JSON.parse(list.body) as GymChallengesResponse).challenges.find((x) => x.id === c.id);
      expect([seen?.exercises, seen?.words.about, seen?.words.howLine]).toEqual([["squat"], "Squats", `Counted by the staff at ${gym.name}`]);

      // Only the staff's numbers count: typed, they are the board.
      const typed = await inject("PUT", `${base(gym.id)}/${c.id}/scores`, gym.owner.cookies, { scores: [{ userId: member.userId, value: 140 }] });
      expect(typed.statusCode, typed.body).toBe(200);
      const board = await inject("GET", `${base(gym.id)}/${c.id}/board/staff`, gym.owner.cookies);
      expect((JSON.parse(board.body) as StaffGymChallengeBoardResponse).rows.map((r) => [r.userId, r.value])).toEqual([[member.userId, 140]]);

      // Started (5 October, today the 7th): the exercise stays as it was.
      const moved = await inject("PUT", `${base(gym.id)}/${c.id}`, gym.owner.cookies, fields({ exercises: ["chair_squat"] }));
      expect([moved.statusCode, codeOf(moved)]).toEqual([409, "challenge_started"]);
      expect(await keptExercises(c.id)).toEqual(["squat"]);
      // Its name can still change, and the exercise is kept with it.
      const renamed = await inject("PUT", `${base(gym.id)}/${c.id}`, gym.owner.cookies, fields({ name: "Squat October" }));
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(await keptExercises(c.id)).toEqual(["squat"]);

      // Not started: another exercise takes its place, and only it is kept.
      const coming = await added(gym, { startsOn: "2026-10-20", endsOn: "2026-10-31" });
      const changed = await inject("PUT", `${base(gym.id)}/${coming.id}`, gym.owner.cookies, fields({ startsOn: "2026-10-20", exercises: ["chair_squat"], unit: "chair squats" }));
      expect(changed.statusCode, changed.body).toBe(200);
      expect(await keptExercises(coming.id)).toEqual(["chair_squat"]);
      expect((JSON.parse(changed.body) as { challenge: StaffGymChallenge }).challenge.words.about).toBe("Chair Squats");
      // Made about something else, it keeps no exercise.
      const other = await inject("PUT", `${base(gym.id)}/${coming.id}`, gym.owner.cookies, fields({ startsOn: "2026-10-20", subject: "own", exercises: [], unit: "push-ups" }));
      expect(other.statusCode, other.body).toBe(200);
      expect(await keptExercises(coming.id)).toEqual([]);
      // Refused on a change too: an exercise counted by the app.
      const appCounted = await inject("PUT", `${base(gym.id)}/${coming.id}`, gym.owner.cookies, fields({ startsOn: "2026-10-20", countedBy: "app", measure: "reps", unit: "" }));
      expect(appCounted.statusCode).toBe(400);
      const hidden = await inject("PUT", `${base(gym.id)}/${coming.id}`, gym.owner.cookies, fields({ startsOn: "2026-10-20", exercises: [HIDDEN] }));
      expect(hidden.statusCode).toBe(400);
      expect(await keptExercises(coming.id)).toEqual([]);

      // At the database: an exercise row names its own gym's challenge, never another's.
      const theirs = await makeGym(`Chex Theirs ${uniq()}`);
      const plank = (await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'plank'`)[0]?.id ?? "";
      await expect(sql`INSERT INTO gym_challenge_exercises (gym_id, challenge_id, exercise_id) VALUES (${theirs.id}, ${c.id}, ${plank})`).rejects.toThrow(/gym_challenge_exercises_challenge_fk/u);
    },
    T,
  );

  it(
    "the list the form reads: what this gym can pick and who can count it, for its staff only",
    async () => {
      const gym = await makeGym(`Chex List ${uniq()}`);
      const res = await inject("GET", `${base(gym.id)}/subjects`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as ChallengeSubjectsResponse;
      expect(body.subjects.map((s) => [s.id, s.title, s.pickExercise, s.appCounts.map((m) => m.measure)])).toEqual([
        ["gym_visits", "Gym visits", false, ["days"]],
        ["workouts", "Workouts in the app", false, ["days"]],
        ["exercise", "An exercise", true, []],
        ["own", "Something else", false, []],
      ]);
      expect(body.subjects.every((s) => s.hint.length > 0)).toBe(true);
      const slugs = body.exercises.map((e) => e.slug);
      expect(slugs).toContain("squat");
      expect(slugs).not.toContain(HIDDEN);
      expect(body.exercises.find((e) => e.slug === "squat")).toEqual({ slug: "squat", name: "Squats", appCounts: false });
      // Nothing the app cannot count is offered as counted by it.
      expect(body.exercises.some((e) => e.appCounts)).toBe(false);
      // In name order, each once.
      const names = body.exercises.map((e) => e.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
      expect(new Set(slugs).size).toBe(slugs.length);

      // A member, another gym's owner, a stranger: not found. A trainer without the tick:
      // refused. Signed out: 401.
      const member = await signedIn("Mo Member");
      await inGym(gym.id, member.userId);
      const other = await makeGym(`Chex Other ${uniq()}`);
      const stranger = await signedIn("Sam Stranger");
      for (const who of [member, other.owner, stranger]) {
        expect((await inject("GET", `${base(gym.id)}/subjects`, who.cookies)).statusCode).toBe(404);
      }
      const trainer = await signedIn("Tia Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gym.id}, ${trainer.userId}, 'trainer')`;
      const refused = await inject("GET", `${base(gym.id)}/subjects`, trainer.cookies);
      expect([refused.statusCode, codeOf(refused)]).toEqual([403, "forbidden"]);
      expect((await inject("GET", `${base(gym.id)}/subjects`, {})).statusCode).toBe(401);
    },
    T,
  );
});
