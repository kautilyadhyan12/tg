// Record a run (ROADMAP 37a), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: a person's route, which starts at their front door,
// read by anybody else. Then the numbers the server works out itself, a run sent twice, what a
// refused send looks like, and a run keeping the streak and earning XP.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import {
  RUN_MAX_PAUSES,
  RUN_MAX_POINTS,
  runDetailSchema,
  runPageSchema,
  runSums,
  saveRunResponseSchema,
  type SaveRunRequest,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "run-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.38.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const RAD = Math.PI / 180;
/** A run going north from a front door in Guwahati at `mps` metres a second, one point a second. */
function northRun(seconds: number, mps: number): SaveRunRequest["points"] {
  const points: SaveRunRequest["points"] = [];
  for (let i = 0; i <= seconds; i++) points.push([i * 1000, 26.1445 + (i * mps) / 110_760, 91.7362 + 0.00001 * Math.sin(i * RAD * 7), 5]);
  return points;
}

const body = (over: Partial<SaveRunRequest> = {}): SaveRunRequest => ({
  runId: randomUUID(),
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  elapsedMs: 1_200_000,
  name: "Morning Run",
  effort: 6,
  note: null,
  points: northRun(1200, 3),
  pauses: [],
  ...over,
});

d("record a run (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: "GET" | "POST"; url: string; body?: unknown; cookies?: Cookies; key?: string }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.key !== undefined ? { "idempotency-key": opts.key } : {}),
      },
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });
  const save = (cookies: Cookies, run: SaveRunRequest, key: string = run.runId) =>
    inject({ method: "POST", url: "/v1/geo/runs", body: run, cookies, key });

  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runrec-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Run Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies: cookieMap(login), id };
  };
  const xpOf = async (userId: string) => (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${userId}`)[0]?.total_xp ?? 0;

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runrec-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM body_measurements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runrec-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  });
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  describe("the worst thing: somebody's route, from their front door, read by anybody else", () => {
    it("another member gets nothing: not the run, not in their list, and cannot take its id", async () => {
      const runner = await makeUser("runner");
      const stranger = await makeUser("stranger");
      const run = body();
      expect((await save(runner.cookies, run)).statusCode).toBe(201);

      const read = await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: stranger.cookies });
      expect(read.statusCode).toBe(404);
      expect(read.body).not.toContain("polyline");
      const list = runPageSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs", cookies: stranger.cookies })).body));
      expect(list.items).toEqual([]);

      // The stranger sends their own run under the runner's id: refused as if it were not there,
      // and the runner's run is untouched.
      const taken = await save(stranger.cookies, body({ runId: run.runId, name: "Not yours", points: northRun(60, 3), elapsedMs: 60_000 }));
      expect(taken.statusCode).toBe(404);
      expect(taken.body).not.toContain("polyline");
      const own = z.object({ run: runDetailSchema }).parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: runner.cookies })).body)).run;
      expect(own.distanceM).toBeGreaterThan(3000);
      const kept = await sql<{ name: string; user_id: string }[]>`SELECT name, user_id FROM runs WHERE id = ${run.runId}`;
      expect(kept).toEqual([{ name: "Morning Run", user_id: runner.id }]);
    });

    it("no gym's code reads the runs table: a gym never sees where its members run", () => {
      // Every file under src that reads `runs` is named here; a new reader must be added on purpose.
      // A query may name a part of itself `runs` (the gym board's weeks in a row): not the table.
      const readsRuns = (text: string) =>
        /\b(FROM|JOIN|INTO|UPDATE)\s+(public\.)?"?runs"?\b|\.(from|insert|update|delete)\(\s*runs\b|schema\.runs\b/i.test(text) && !/\bruns AS \(/.test(text);
      const readers: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (/\.(ts|mjs)$/.test(name) && readsRuns(readFileSync(path, "utf8"))) readers.push(path.replace(/\\/g, "/").replace(/^.*\/src\//, ""));
        }
      };
      walk(join(__dirname, "..", "src"));
      expect(readers.sort()).toEqual([
        "modules/gamification/repo.ts",
        "modules/geo/repo.ts",
        "modules/privacy/exportRepo.ts",
        "modules/privacy/repo.ts",
        // The streak reminder and the Sunday summary (19e-ii) count the person's own runs for themselves: no
        // route, no place, no gym.
        "modules/reminders/nudgesRepo.ts",
        "modules/workouts/repo.ts",
      ]);
    });

    it("nobody signed in gets nothing", async () => {
      expect((await save({}, body())).statusCode).toBe(401);
    });

    it("who is asking and the limit come before the points are read, for the phone's sign-in and the browser's", async () => {
      // 21a-iii-c. A body that is not even JSON: a server that read it first would answer 400 to all.
      const broken = (headers: Record<string, string>, cookies: Cookies = {}) =>
        api().inject({ method: "POST", url: "/v1/geo/runs", remoteAddress: nextIp(), headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...headers }, cookies, payload: '{"points": ' });
      expect((await broken({})).statusCode).toBe(401);
      expect((await broken({ authorization: "Bearer not-a-token" })).statusCode).toBe(401);
      const me = await makeUser("before-the-body");
      const token = me.cookies["accessToken"] ?? "";
      expect(token).not.toBe("");
      // The phone signs in with its token, the browser with its cookie: both reach the reader.
      expect((await broken({ authorization: `Bearer ${token}` })).statusCode).toBe(400);
      expect((await broken({}, me.cookies)).statusCode).toBe(400);
      // Ten a minute each: two spent, eight more read, the eleventh refused unread.
      for (let i = 3; i <= 10; i++) expect({ i, status: (await broken({ authorization: `Bearer ${token}` })).statusCode }).toEqual({ i, status: 400 });
      expect((await broken({ authorization: `Bearer ${token}` })).statusCode).toBe(429);
    });
  });

  it("works every number out itself, from the points, with the same rules the phone shows", async () => {
    const me = await makeUser("numbers");
    await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg, metrics, source) VALUES (${me.id}, now() - interval '1 day', 82, ${sql.json({})}, 'manual')`;
    const run = body({ points: northRun(1720, 5120 / 1720), elapsedMs: 1_900_000, pauses: [[1_720_000, 1_900_000]] });
    const res = await save(me.cookies, run);
    expect(res.statusCode, res.body).toBe(201);
    const saved = saveRunResponseSchema.parse(JSON.parse(res.body));
    const expected = runSums(run.points, run.pauses, run.elapsedMs, 82); // the person's own weight
    expect(expected.kcal).not.toBe(runSums(run.points, run.pauses, run.elapsedMs, 70).kcal);
    expect(saved).toMatchObject({
      status: "created",
      run: {
        name: "Morning Run",
        effort: 6,
        note: null,
        distanceM: expected.distanceM,
        movingS: expected.movingS,
        elapsedS: 1900,
        leftOutM: 0,
        kcal: expected.kcal,
        splitsKm: expected.splitsKm,
        splitsMi: expected.splitsMi,
      },
    });
    expect(saved.run.distanceM).toBeGreaterThanOrEqual(5100);
    expect(saved.run.movingS).toBe(1720);
    // The Dashboard's list and the run's own page read the same row.
    const list = runPageSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs", cookies: me.cookies })).body));
    expect(list.items[0]).toMatchObject({ id: run.runId, distanceM: saved.run.distanceM, durationS: 1720, kcalPoint: saved.run.kcal });
  });

  it("the longest run a phone keeps, twelve hours of points and 2,000 pauses, is saved", async () => {
    const me = await makeUser("longest");
    const pauses: SaveRunRequest["pauses"] = [];
    for (let i = 0; i < RUN_MAX_PAUSES; i++) pauses.push([i * 20_000 + 1000, i * 20_000 + 2000]);
    const run = body({ points: northRun(RUN_MAX_POINTS - 1, 3), elapsedMs: RUN_MAX_POINTS * 1000, pauses });
    expect(run.points.length).toBe(RUN_MAX_POINTS);
    const res = await save(me.cookies, run);
    expect(res.statusCode, res.body).toBe(201);
    expect((await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).length).toBe(1);
  }, 30_000);

  it("one point past the longest run is refused by the list count, and nothing is saved", async () => {
    const me = await makeUser("past-longest");
    const pauses: SaveRunRequest["pauses"] = [];
    for (let i = 0; i < RUN_MAX_PAUSES; i++) pauses.push([i * 20_000 + 1000, i * 20_000 + 2000]);
    const run = body({ points: northRun(RUN_MAX_POINTS, 3), elapsedMs: RUN_MAX_POINTS * 1000, pauses });
    expect(run.points.length).toBe(RUN_MAX_POINTS + 1);
    const res = await save(me.cookies, run);
    expect([res.statusCode, (JSON.parse(res.body) as { error: string }).error]).toEqual([413, "too_many_items"]);
    expect((await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).length).toBe(0);
  }, 30_000);

  it("is saved once when sent twice, and the second send reads back the first", async () => {
    const me = await makeUser("twice");
    const run = body();
    const first = saveRunResponseSchema.parse(JSON.parse((await save(me.cookies, run)).body));
    const again = await save(me.cookies, { ...run, name: "Changed on the way" });
    expect(again.statusCode).toBe(200);
    const second = saveRunResponseSchema.parse(JSON.parse(again.body));
    expect(second).toEqual({ ...first, status: "duplicate" });
    expect((await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).length).toBe(1);
  });

  it("refuses a broken send: a bad point, a key that is not the run's", async () => {
    const me = await makeUser("refused");
    const bad = await save(me.cookies, { ...body(), points: [[0, 91, 0, 5]] });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain("91"); // what was sent is never echoed
    const run = body();
    expect((await save(me.cookies, run, randomUUID())).statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).length).toBe(0);
  });

  it("a run of 200 m or more keeps the streak and earns a workout's 50 XP; a few steps earn nothing", async () => {
    const me = await makeUser("streak");
    const before = await xpOf(me.id);
    expect((await save(me.cookies, body({ points: northRun(60, 1.5), elapsedMs: 60_000 }))).statusCode).toBe(201); // about 90 m
    expect(await xpOf(me.id)).toBe(before);
    expect((await save(me.cookies, body({ points: northRun(120, 3), elapsedMs: 120_000 }))).statusCode).toBe(201); // about 360 m
    expect(await xpOf(me.id)).toBe(before + 50);
    const streak = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${me.id}`;
    expect(streak[0]?.current).toBe(1);
  });
});

d("round one of 37a: nothing a person ran is refused for the phone's clock, and the server is never kept busy", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const post = (cookies: Cookies, run: unknown, key: string, ip = "10.39.0.1") =>
    api().inject({ method: "POST", url: "/v1/geo/runs", remoteAddress: ip, headers: { "content-type": "application/json", "idempotency-key": key }, cookies, payload: JSON.stringify(run) });
  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runrec-r1-${name}@example.com`;
    expect((await api().inject({ method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify({ email, password: PASSWORD, displayName: "Run Fixture" }) })).statusCode).toBe(201);
    const login = await api().inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify({ email, password: PASSWORD }) });
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies: cookieMap(login), id };
  };
  const mine = sql`SELECT id FROM users WHERE email LIKE 'runrec-r1-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runrec-r1-%@example.com'`;
  };
  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  });
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  it("H1: a phone clock an hour fast keeps the run, moved back to end now", async () => {
    const me = await makeUser("clock");
    const run = body({ startedAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await post(me.cookies, run, run.runId)).statusCode).toBe(201);
    const kept = await sql<{ started_at: Date }[]>`SELECT started_at FROM runs WHERE id = ${run.runId}`;
    expect(kept[0]?.started_at.getTime() ?? Infinity).toBeLessThanOrEqual(Date.now() - run.elapsedMs + 1000);
  });

  it("L2: a NUL in the name or the note is taken out, and the run is saved", async () => {
    const me = await makeUser("nul");
    const run = body({ name: "Morning\u0000 Run", note: "hill\u0000 repeats" });
    expect((await post(me.cookies, run, run.runId)).statusCode).toBe(201);
    expect(await sql`SELECT name, note FROM runs WHERE id = ${run.runId}`).toEqual([{ name: "Morning Run", note: "hill repeats" }]);
  });

  it("L3: the saved line says where it starts again after a pause", async () => {
    const me = await makeUser("starts");
    const run = body({ points: northRun(600, 3), elapsedMs: 600_000, pauses: [[200_000, 300_000]] });
    const saved = saveRunResponseSchema.parse(JSON.parse((await post(me.cookies, run, run.runId)).body));
    expect(saved.run.trackStarts).toHaveLength(2);
    expect(saved.run.trackStarts[0]).toBe(0);
  });

  it("H2: a run sent again is answered from the row, before its points are read", async () => {
    const me = await makeUser("repeat");
    const run = body();
    expect((await post(me.cookies, run, run.runId)).statusCode).toBe(201);
    // The same key with a body the server could never read: answered from the row, not refused.
    const again = await post(me.cookies, { nonsense: true }, run.runId);
    expect(again.statusCode).toBe(200);
    expect(saveRunResponseSchema.parse(JSON.parse(again.body)).status).toBe("duplicate");
  });

  it("H2: eleven sends in a minute from one person: the eleventh waits; somebody else at the same address does not", async () => {
    const me = await makeUser("loop");
    const other = await makeUser("loop-other");
    const run = body();
    for (let i = 0; i < 10; i++) expect((await post(me.cookies, run, run.runId)).statusCode).toBeLessThan(300);
    expect((await post(me.cookies, run, run.runId)).statusCode).toBe(429);
    const theirs = body();
    expect((await post(other.cookies, theirs, theirs.runId)).statusCode).toBe(201);
  });

  it("T3: one run sent four times at the same instant is one row; two people's first sends of one id give it to one", async () => {
    const me = await makeUser("instant");
    const run = body();
    const codes = (await Promise.all([1, 2, 3, 4].map(() => post(me.cookies, run, run.runId)))).map((r) => r.statusCode).sort();
    expect(codes[0]).toBe(200);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect((await sql`SELECT 1 FROM runs WHERE id = ${run.runId}`).length).toBe(1);

    const a = await makeUser("race-a");
    const b = await makeUser("race-b");
    const shared = body();
    const both = await Promise.all([post(a.cookies, shared, shared.runId), post(b.cookies, { ...shared, name: "Not theirs" }, shared.runId)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 404]);
    const owner = await sql<{ user_id: string }[]>`SELECT user_id FROM runs WHERE id = ${shared.runId}`;
    const winner = both[0].statusCode === 201 ? a.id : b.id;
    expect(owner).toEqual([{ user_id: winner }]);
  });
});

d("which runs count for the streak and XP (round one of 37a, T1, T2, L6)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const USER = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
  const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const putRun = async (day: string, hour: number, metres: number, recorded = true) => {
    await sql`
      INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, source, run_calc_version)
      VALUES (${randomUUID()}, ${USER}, ${at(day, hour)}, 600, ${metres}, 'mobile', ${recorded ? 1 : null})`;
  };
  const clear = async () => {
    await sql`DELETE FROM runs WHERE user_id = ${USER}`;
    await sql`DELETE FROM workouts WHERE user_id = ${USER}`;
    await sql`DELETE FROM users WHERE id = ${USER}`;
  };
  beforeAll(async () => {
    await clear();
    await sql`INSERT INTO users (id, email, display_name) VALUES (${USER}, 'runrec-days@example.com', 'Days Fixture')`;
  });
  afterAll(async () => {
    await clear();
    await sql.end();
  });

  it("a short run, alone on a day between two counted ones, keeps no streak and earns nothing; nor does a run from before", async () => {
    await putRun("2026-10-01", 7, 5000);
    await putRun("2026-10-02", 7, 120); // a few steps
    await putRun("2026-10-03", 7, 4000);
    await putRun("2026-10-04", 7, 9000, false); // imported from before: never recorded by this app
    const { getActivityDays, getStreakDays, getXpAccrualCounts } = await import("../src/modules/gamification/repo.js");
    await sql.begin(async (tx) => {
      expect(await getStreakDays(tx, USER, "UTC")).toEqual(["2026-10-01", "2026-10-03"]);
      expect(await getActivityDays(tx, USER, "UTC")).toEqual(["2026-10-01", "2026-10-03"]);
      expect((await getXpAccrualCounts(tx, USER)).runCount).toBe(2);
    });
  });

  it("a counted run earlier the same day takes the day's streak bonus from a workout after it; a later or short one does not", async () => {
    const { hasEarlierWorkoutOnDay } = await import("../src/modules/workouts/repo.js");
    const workoutAt = at("2026-10-10", 9);
    const workoutId = randomUUID();
    expect(await hasEarlierWorkoutOnDay(sql, USER, workoutId, workoutAt, "UTC")).toBe(false);
    await putRun("2026-10-10", 10, 5000); // after the workout
    expect(await hasEarlierWorkoutOnDay(sql, USER, workoutId, workoutAt, "UTC")).toBe(false);
    await putRun("2026-10-10", 7, 150); // before, but a few steps
    expect(await hasEarlierWorkoutOnDay(sql, USER, workoutId, workoutAt, "UTC")).toBe(false);
    await putRun("2026-10-10", 8, 3000); // before, and counted
    expect(await hasEarlierWorkoutOnDay(sql, USER, workoutId, workoutAt, "UTC")).toBe(true);
  });
});
