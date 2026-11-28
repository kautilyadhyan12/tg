// An indoor run (ROADMAP Stage 5 job 37q-i), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: a treadmill's distance typed ten times too big (54 for 5.4 km) becoming
// somebody's run, or a run nobody's GPS measured beating the runs that were measured, as a record. Then a stranger, an
// indoor run as Your runs shows it, a run sent twice, what a treadmill teaches the next run, and what is refused.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  indoorSums,
  runDetailSchema,
  runPageSchema,
  runRecordsSchema,
  saveRunResponseSchema,
  stepBasisOf,
  stepLengthResponseSchema,
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
const nextIp = () => `10.39.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A phone's counts once a second for `seconds`, stepping `perMinute` times a minute. */
function steady(seconds: number, perMinute: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= seconds; i++) out.push([i * 1000, Math.round((i * perMinute) / 60)]);
  return out;
}

const RAD = Math.PI / 180;
/** A run outdoors, going north at `mps` metres a second, one point a second. */
function northRun(seconds: number, mps: number): SaveRunRequest["points"] {
  const points: SaveRunRequest["points"] = [];
  for (let i = 0; i <= seconds; i++) points.push([i * 1000, 26.1445 + (i * mps) / 110_760, 91.7362 + 0.00001 * Math.sin(i * RAD * 7), 5]);
  return points;
}

/** Thirty minutes on a treadmill at 165 steps a minute, with the treadmill's distance typed after Finish. */
const indoorBody = (treadmillM: number | null, over: Partial<SaveRunRequest> = {}): SaveRunRequest => ({
  runId: randomUUID(),
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  elapsedMs: 1_800_000,
  name: "Treadmill",
  effort: null,
  note: null,
  points: [],
  pauses: [],
  indoor: { counts: steady(1800, 165), treadmillM },
  ...over,
});

d("an indoor run (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: "GET" | "POST" | "DELETE"; url: string; body?: unknown; cookies?: Cookies; key?: string }) =>
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
  const save = (cookies: Cookies, run: SaveRunRequest) => inject({ method: "POST", url: "/v1/geo/runs", body: run, cookies, key: run.runId });
  const saved = async (cookies: Cookies, run: SaveRunRequest, status = 201) => {
    const res = await save(cookies, run);
    expect(res.statusCode, res.body).toBe(status);
    return saveRunResponseSchema.parse(JSON.parse(res.body)).run;
  };
  const detail = async (cookies: Cookies, id: string) => runDetailSchema.parse((JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${id}`, cookies })).body) as { run: unknown }).run);
  const stepLength = async (cookies: Cookies) => {
    const res = await inject({ method: "GET", url: "/v1/geo/runs/step-length", cookies });
    expect(res.statusCode).toBe(200);
    return stepLengthResponseSchema.parse(JSON.parse(res.body)).stepLength;
  };

  const makeUser = async (name: string, heightCm: number | null = null): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runin-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Indoor Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    if (heightCm !== null) await sql`INSERT INTO user_fitness_profiles (user_id, height_cm) VALUES (${id}, ${heightCm})`;
    return { cookies: cookieMap(login), id };
  };
  const xpOf = async (userId: string) => (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${userId}`)[0]?.total_xp ?? 0;

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runin-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM run_removed_ids WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runin-%@example.com'`;
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

  describe("the worst thing: a treadmill's distance typed ten times too big, or a run nobody measured, as a record", () => {
    it("54 typed for 5.4 km on a 30-minute run: saved as the distance her steps made, and her page says so", async () => {
      const maya = await makeUser("maya");
      const run = indoorBody(54_000);
      const kept = await saved(maya.cookies, run);
      const steps = indoorSums(steady(1800, 165), [], 1_800_000, 0, stepBasisOf(null, []), null);
      expect(kept.distanceM).toBe(steps.distanceM);
      expect(kept.distanceM).toBeLessThan(6000);
      expect(kept.distanceFrom).toBe("steps");
      const row = await sql<{ treadmill_m: number | null; distance_m: number }[]>`SELECT treadmill_m, distance_m FROM runs WHERE id = ${run.runId}`;
      expect(row[0]).toEqual({ treadmill_m: null, distance_m: steps.distanceM });
      const page = await detail(maya.cookies, run.runId);
      expect(page.distanceM).toBe(steps.distanceM);
      expect(page.distanceFrom).toBe("steps");
      // Typed as she meant it, it is the run's.
      const right = await saved(maya.cookies, indoorBody(5400));
      expect(right.distanceM).toBe(5400);
      expect(right.distanceFrom).toBe("treadmill");
    });

    it("Finish forgotten on the treadmill for 2.5 hours, 5.4 typed as 54: saved at its steps' distance (round one, H3)", async () => {
      const runner = await makeUser("forgot");
      const honest = indoorSums(steady(1800, 165), [], 1_800_000, 0, stepBasisOf(null, []), null);
      const kept = await saved(runner.cookies, indoorBody(54_000, { elapsedMs: 1_800_000 + 9_000_000 }));
      expect(kept.distanceFrom).toBe("steps");
      expect(kept.distanceM).toBe(honest.distanceM);
      const list = runPageSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs", cookies: runner.cookies })).body));
      expect(list.total.distanceM).toBe(honest.distanceM);
    });

    it("the walk to the changing room after Finish is not the run's (round one, H2)", async () => {
      const runner = await makeUser("after");
      const late = indoorBody(null, { indoor: { counts: [...steady(1800, 165), [1_800_001, 4951], [1_980_000, 5280]], treadmillM: null } });
      const kept = await saved(runner.cookies, late);
      expect(kept.steps).toBe(4950);
      expect(kept.distanceM).toBe(indoorSums(steady(1800, 165), [], 1_800_000, 0, stepBasisOf(null, []), null).distanceM);
    });

    it("an indoor run longer than every run outdoors sets no record, and its page holds none", async () => {
      const runner = await makeUser("records");
      const outdoor = await saved(runner.cookies, {
        runId: randomUUID(),
        startedAt: new Date(Date.now() - 7_200_000).toISOString(),
        elapsedMs: 1_200_000,
        name: "Outdoors",
        effort: null,
        note: null,
        points: northRun(1200, 3),
        pauses: [],
      });
      // Two hours on a treadmill at 2.8 m/s, 20 km typed: taken as the run's own distance, faster over every distance.
      const long = indoorBody(20_000, { elapsedMs: 7_200_000, indoor: { counts: steady(7200, 165), treadmillM: 20_000 } });
      const kept = await saved(runner.cookies, long);
      expect(kept.distanceM).toBe(20_000);
      const records = runRecordsSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs/records", cookies: runner.cookies })).body));
      expect(records.longest?.runId).toBe(outdoor.id);
      expect(records.k1?.runId).toBe(outdoor.id);
      expect(records.k5).toBeNull();
      const page = await detail(runner.cookies, long.runId);
      expect(page.records).toEqual([]);
      expect(page.bests).toEqual({ k1: null, mile: null, k5: null, k10: null });
      expect(page.polyline).toBeNull();
      expect(page.shape).toBeNull();
    });

    it("a stranger gets nothing: not the run, not in their list, and their step length is their own", async () => {
      const runner = await makeUser("teacher", 175);
      const stranger = await makeUser("stranger", 160);
      const run = indoorBody(5400);
      await saved(runner.cookies, run);
      expect((await stepLength(runner.cookies)).learnedFrom).toBe(1);

      const read = await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: stranger.cookies });
      expect(read.statusCode).toBe(404);
      const list = runPageSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs", cookies: stranger.cookies })).body));
      expect(list.items).toEqual([]);
      expect(await stepLength(stranger.cookies)).toEqual({ heightCm: 160, heightKnown: true, factor: 1, learnedFrom: 0 });
      // Nor can they delete it, or save their own run under its id.
      expect((await inject({ method: "DELETE", url: `/v1/geo/runs/${run.runId}`, cookies: stranger.cookies })).statusCode).toBe(404);
      expect((await save(stranger.cookies, indoorBody(null, { runId: run.runId }))).statusCode).toBe(404);
      expect((await detail(runner.cookies, run.runId)).distanceM).toBe(5400);
    });
  });

  describe("an indoor run, saved", () => {
    it("Your runs shows it with no route, and its total counts it", async () => {
      const walker = await makeUser("list", 175);
      const run = indoorBody(null);
      const kept = await saved(walker.cookies, run);
      expect(kept.indoor).toBe(true);
      expect(kept.polyline).toBe("");
      expect(kept.climbM).toBeNull();
      expect(kept.steps).toBe(4950);
      const list = runPageSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs", cookies: walker.cookies })).body));
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.indoor).toBe(true);
      expect(list.items[0]?.shape).toBeNull();
      expect(list.total).toEqual({ runs: 1, distanceM: kept.distanceM });
      const page = await detail(walker.cookies, run.runId);
      expect(page).toMatchObject({ indoor: true, distanceFrom: "steps", steps: 4950, polyline: null, durationS: 1800 });
      expect(page.splitsKm.length).toBeGreaterThan(3);
      expect(page.paceLine.length).toBeGreaterThan(100);
    });

    it("counts for the streak and XP, as any run does", async () => {
      const walker = await makeUser("xp");
      expect(await xpOf(walker.id)).toBe(0);
      await saved(walker.cookies, indoorBody(null));
      expect(await xpOf(walker.id)).toBeGreaterThan(0);
      const streak = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${walker.id}`;
      expect(streak[0]?.current).toBe(1);
    });

    it("sent twice: saved once, and the second answer is the first's", async () => {
      const walker = await makeUser("twice");
      const run = indoorBody(5400);
      const first = await saved(walker.cookies, run);
      const again = await save(walker.cookies, run);
      expect(again.statusCode).toBe(200);
      const second = saveRunResponseSchema.parse(JSON.parse(again.body));
      expect(second.status).toBe("duplicate");
      expect(second.run).toEqual(first);
      expect((await sql`SELECT 1 FROM runs WHERE id = ${run.runId}`).length).toBe(1);
    });

    it("a treadmill's distance teaches the next indoor run, and stops when its run is deleted", async () => {
      const runner = await makeUser("learner", 175);
      expect(await stepLength(runner.cookies)).toEqual({ heightCm: 175, heightKnown: true, factor: 1, learnedFrom: 0 });
      const plain = indoorSums(steady(1800, 165), [], 1_800_000, 0, stepBasisOf(175, []), null);
      const lesson = indoorBody(5400);
      await saved(runner.cookies, lesson);
      const taught = await stepLength(runner.cookies);
      expect(taught.learnedFrom).toBe(1);
      expect(taught.factor).toBeCloseTo(5400 / plain.plainM, 10);
      // The same thirty minutes again, with no treadmill to type: now near what the treadmill said.
      const next = await saved(runner.cookies, indoorBody(null));
      expect(next.distanceFrom).toBe("steps");
      expect(Math.abs(next.distanceM - 5400)).toBeLessThanOrEqual(2);
      // The treadmill run deleted: it teaches nothing any more.
      expect((await inject({ method: "DELETE", url: `/v1/geo/runs/${lesson.runId}`, cookies: runner.cookies })).statusCode).toBe(204);
      expect(await stepLength(runner.cookies)).toEqual({ heightCm: 175, heightKnown: true, factor: 1, learnedFrom: 0 });
    });

    it("a phone left on the treadmill counts no step: the treadmill's distance, and it teaches nothing", async () => {
      const runner = await makeUser("console");
      const kept = await saved(runner.cookies, indoorBody(5000, { indoor: { counts: [], treadmillM: 5000 } }));
      expect(kept).toMatchObject({ distanceM: 5000, distanceFrom: "treadmill", steps: 0, splitsKm: [] });
      expect((await stepLength(runner.cookies)).learnedFrom).toBe(0);
    });
  });

  describe("refused", () => {
    it("an indoor run with a route: 400, and nothing is kept", async () => {
      const walker = await makeUser("route");
      const run = indoorBody(null, { points: northRun(10, 3) });
      const res = await save(walker.cookies, run);
      expect(res.statusCode).toBe(400);
      expect((await sql`SELECT 1 FROM runs WHERE id = ${run.runId}`).length).toBe(0);
    });

    it("the database keeps no indoor run without its steps, and no outdoor run with them (round one, L1)", async () => {
      const owner = await makeUser("check");
      const row = (kind: string, steps: number | null, stepsM: number | null) =>
        sql`INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, kind, steps, steps_m)
            VALUES (${randomUUID()}, ${owner.id}, now(), 60, 100, ${kind}, ${steps}, ${stepsM})`;
      await expect(row("indoor", null, null)).rejects.toThrow(/runs_indoor_check/);
      await expect(row("indoor", 100, null)).rejects.toThrow(/runs_indoor_check/);
      await expect(row("outdoor", 100, 80)).rejects.toThrow(/runs_indoor_check/);
      // Both checks refuse it; Postgres names whichever it tried first.
      await expect(row("treadmill", null, null)).rejects.toThrow(/runs_(kind|indoor)_check/);
      await row("indoor", 100, 80);
    });

    it("the step length to nobody signed in: 401", async () => {
      expect((await inject({ method: "GET", url: "/v1/geo/runs/step-length" })).statusCode).toBe(401);
    });
  });
});
