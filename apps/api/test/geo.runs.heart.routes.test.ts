// Heart rate with a run (ROADMAP 37f-i), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing on the server: a person's heart rate read by anybody else.
// Then the numbers the server works out itself from the readings, never the phone's, a run sent twice,
// and the longest run a phone keeps with its heart rate.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { RUN_MAX_POINTS, heartSums, runDetailSchema, saveRunResponseSchema, type SaveRunRequest } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { buildUserExport } from "../src/modules/privacy/export.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "run-heart-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
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

/** A run going north at 3 m/s, one point a second. */
function northRun(seconds: number): SaveRunRequest["points"] {
  const points: SaveRunRequest["points"] = [];
  for (let i = 0; i <= seconds; i++) points.push([i * 1000, 26.1445 + (i * 3) / 110_760, 91.7362, 5]);
  return points;
}
/** One reading a second from `fromS` to `toS`. */
const beats = (fromS: number, toS: number, bpm: (s: number) => number): [number, number][] => {
  const out: [number, number][] = [];
  for (let s = fromS; s < toS; s++) out.push([s * 1000, bpm(s)]);
  return out;
};

const body = (over: Partial<SaveRunRequest> = {}): SaveRunRequest => ({
  runId: randomUUID(),
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  elapsedMs: 1_200_000,
  name: "Morning Run",
  effort: null,
  note: null,
  points: northRun(1200),
  pauses: [],
  heart: beats(0, 1200, (s) => 120 + Math.floor(s / 20)),
  ...over,
});

d("heart rate with a run (real Postgres)", () => {
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
  const save = (cookies: Cookies, run: unknown, key: string) => inject({ method: "POST", url: "/v1/geo/runs", body: run, cookies, key });
  const detail = async (cookies: Cookies, id: string) =>
    z.object({ run: runDetailSchema }).parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${id}`, cookies })).body)).run;

  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runheart-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Heart Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies: cookieMap(login), id };
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runheart-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runheart-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  });
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  }, 30_000);

  describe("the worst thing: a person's heart rate read by anybody else", () => {
    it("another member gets nothing of it: not the run, not its heart rate", async () => {
      const runner = await makeUser("runner");
      const stranger = await makeUser("stranger");
      const run = body();
      expect((await save(runner.cookies, run, run.runId)).statusCode).toBe(201);
      const read = await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: stranger.cookies });
      expect(read.statusCode).toBe(404);
      expect(read.body).not.toMatch(/heart/i);
      const list = await inject({ method: "GET", url: "/v1/geo/runs", cookies: stranger.cookies });
      expect(list.body).not.toContain(run.runId);
      // Their own: there.
      expect((await detail(runner.cookies, run.runId)).heartAvg).not.toBeNull();
    });

    it("nobody signed in gets nothing", async () => {
      const run = body();
      expect((await save({}, run, run.runId)).statusCode).toBe(401);
    });
  });

  it("works the average and highest out itself from the readings, leaving the pauses out", async () => {
    const me = await makeUser("numbers");
    // Ten minutes at 140, standing paused for five at 95, ten more at 160 with one reading of 175.
    const heart = [...beats(0, 600, () => 140), ...beats(600, 900, () => 95), ...beats(900, 1500, (s) => (s === 1000 ? 175 : 160))];
    const run = body({ elapsedMs: 1_500_000, points: northRun(1500), pauses: [[600_000, 900_000]], heart });
    const res = await save(me.cookies, run, run.runId);
    expect(res.statusCode, res.body).toBe(201);
    const expected = heartSums(heart, run.pauses, run.elapsedMs);
    expect(expected).toEqual({ avg: 150, max: 175 });
    const saved = saveRunResponseSchema.parse(JSON.parse(res.body)).run;
    expect([saved.heartAvg, saved.heartMax]).toEqual([150, 175]);
    const page = await detail(me.cookies, run.runId);
    expect([page.heartAvg, page.heartMax]).toEqual([150, 175]);
    // The readings are not kept: only the two numbers.
    const row = await sql<{ heart_avg: number; heart_max: number }[]>`SELECT heart_avg, heart_max FROM runs WHERE id = ${run.runId}`;
    expect(row).toEqual([{ heart_avg: 150, heart_max: 175 }]);
  });

  it("never takes the phone's own numbers: a sent average is refused", async () => {
    const me = await makeUser("typed");
    const run = { ...body(), heartAvg: 60, heartMax: 61 };
    const res = await save(me.cookies, run, run.runId);
    expect(res.statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).length).toBe(0);
  });

  it("refuses a reading no heart beats, and saves nothing", async () => {
    const me = await makeUser("zero");
    const run = body({ heart: [[0, 0], ...beats(1, 200, () => 140)] });
    expect((await save(me.cookies, run, run.runId)).statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).length).toBe(0);
  });

  it("a run with no strap, or under a minute of it, has no heart rate", async () => {
    const me = await makeUser("none");
    const without = body({ heart: [] });
    // A phone from before 37f sends no heart rate at all.
    const old: Partial<SaveRunRequest> = body();
    delete old.heart;
    const short = body({ heart: beats(0, 50, () => 150) });
    for (const run of [without, { ...old, runId: randomUUID() }, short]) {
      const res = await save(me.cookies, run, run.runId);
      expect(res.statusCode, res.body).toBe(201);
      const saved = saveRunResponseSchema.parse(JSON.parse(res.body)).run;
      expect([saved.heartAvg, saved.heartMax]).toEqual([null, null]);
    }
  });

  it("is saved once when sent twice: the second send's readings change nothing", async () => {
    const me = await makeUser("twice");
    const run = body();
    const first = saveRunResponseSchema.parse(JSON.parse((await save(me.cookies, run, run.runId)).body));
    const again = await save(me.cookies, { ...run, heart: beats(0, 1200, () => 200) }, run.runId);
    expect(again.statusCode).toBe(200);
    expect(saveRunResponseSchema.parse(JSON.parse(again.body))).toEqual({ ...first, status: "duplicate" });
    expect((await sql`SELECT heart_avg FROM runs WHERE user_id = ${me.id}`).length).toBe(1);
  });

  it("the longest run a phone keeps, twelve hours of points and of heart rate, is saved", async () => {
    const me = await makeUser("longest");
    const run = body({ points: northRun(RUN_MAX_POINTS - 1), elapsedMs: RUN_MAX_POINTS * 1000, heart: beats(0, RUN_MAX_POINTS, () => 239) });
    expect(run.heart?.length).toBe(RUN_MAX_POINTS);
    const res = await save(me.cookies, run, run.runId);
    expect(res.statusCode, res.body).toBe(201);
    expect(saveRunResponseSchema.parse(JSON.parse(res.body)).run.heartMax).toBe(239);
  }, 30_000);

  it("is in the person's own download of their data", async () => {
    const me = await makeUser("export");
    const run = body({ heart: beats(0, 1200, () => 133) });
    expect((await save(me.cookies, run, run.runId)).statusCode).toBe(201);
    const out = await buildUserExport({ sql }, me.id);
    expect(JSON.stringify(out)).toContain('"heart_avg":133');
  }, 30_000);
});
