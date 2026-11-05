// Record a run (ROADMAP 37a), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: a person's route, which starts at their front door,
// read by anybody else. Then the numbers the server works out itself, a run sent twice, what a
// refused send looks like, and a run keeping the streak and earning XP.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  runDetailSchema,
  runPageSchema,
  runSums,
  saveRunResponseSchema,
  type RunPoint,
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
function northRun(seconds: number, mps: number): RunPoint[] {
  const points: RunPoint[] = [];
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
      const own = runDetailSchema.parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: runner.cookies })).body).run);
      expect(own.distanceM).toBeGreaterThan(3000);
      const kept = await sql<{ name: string; user_id: string }[]>`SELECT name, user_id FROM runs WHERE id = ${run.runId}`;
      expect(kept).toEqual([{ name: "Morning Run", user_id: runner.id }]);
    });

    it("no gym's code reads the runs table: a gym never sees where its members run", () => {
      // Every file under src that reads `runs` is named here; a new reader must be added on purpose.
      // A query may name a part of itself `runs` (the gym board's weeks in a row): not the table.
      const readsRuns = (text: string) => /\b(FROM|JOIN|INTO)\s+runs\b/.test(text) && !/\bruns AS \(/.test(text);
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
        "modules/workouts/repo.ts",
      ]);
    });

    it("nobody signed in gets nothing", async () => {
      expect((await save({}, body())).statusCode).toBe(401);
    });
  });

  it("works every number out itself, from the points, with the same rules the phone shows", async () => {
    const me = await makeUser("numbers");
    const run = body({ points: northRun(1720, 5120 / 1720), elapsedMs: 1_900_000, pauses: [[1_720_000, 1_900_000]] });
    const res = await save(me.cookies, run);
    expect(res.statusCode, res.body).toBe(201);
    const saved = saveRunResponseSchema.parse(JSON.parse(res.body));
    const expected = runSums(run.points, run.pauses, run.elapsedMs, 70); // no weight kept: 70 kg, as workouts
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

  it("refuses a broken send: a bad point, a key that is not the run's, a start in the future", async () => {
    const me = await makeUser("refused");
    const bad = await save(me.cookies, { ...body(), points: [[0, 91, 0, 5]] });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain("91"); // what was sent is never echoed
    const run = body();
    expect((await save(me.cookies, run, randomUUID())).statusCode).toBe(400);
    expect((await save(me.cookies, body({ startedAt: new Date(Date.now() + 3_600_000).toISOString() }))).statusCode).toBe(400);
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
