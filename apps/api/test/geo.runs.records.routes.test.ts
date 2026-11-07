// Running records (ROADMAP Stage 5 37c-ii), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: somebody else's run shown as your record, or a record you
// never ran (a car ride counted as your fastest 5K). Then the rule over every class of case: the fastest
// wins, a tie keeps the first, the best before it, a deleted record goes to the next best, only runs this
// app recorded count, the longest run from 200 m, and a run's own page.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runDetailResponseSchema, runRecordsSchema, type RunBests, type SaveRunRequest } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { insertRun } from "../src/modules/geo/repo.js";

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
type Method = "GET" | "POST" | "PATCH" | "DELETE";

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.47.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
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
  startedAt: "2026-10-25T01:00:00.000Z",
  elapsedMs: 600_000,
  name: "Morning Run",
  effort: 6,
  note: "Easy one",
  points: northRun(600, 3),
  pauses: [],
  ...over,
});

d("running records (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: Method; url: string; body?: unknown; cookies?: Cookies; key?: string; ip?: string }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: opts.ip ?? nextIp(),
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.key !== undefined ? { "idempotency-key": opts.key } : {}),
      },
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });
  const save = (cookies: Cookies, run: SaveRunRequest) => inject({ method: "POST", url: "/v1/geo/runs", body: run, cookies, key: run.runId });
  const open = (cookies: Cookies, id: string) => inject({ method: "GET", url: `/v1/geo/runs/${id}`, cookies });
  const remove = (cookies: Cookies, id: string, ip?: string) => inject({ method: "DELETE", url: `/v1/geo/runs/${id}`, cookies, ...(ip === undefined ? {} : { ip }) });

  const makeUser = async (name: string, timeZone = "Asia/Kolkata"): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runrec-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Run Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    await sql`UPDATE users SET timezone = ${timeZone} WHERE id = ${id}`;
    return { cookies: cookieMap(login), id };
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runrec-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM run_removed_ids WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runrec-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  }, 30_000);
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  }, 30_000);

  const records = async (cookies: Cookies) => {
    const res = await inject({ method: "GET", url: "/v1/geo/runs/records", cookies });
    expect(res.statusCode, res.body).toBe(200);
    return runRecordsSchema.parse(JSON.parse(res.body));
  };
  const none = { k1: null, mile: null, k5: null, k10: null };
  /** A run kept straight in the table, as a save keeps it, with its numbers given. */
  const keep = async (userId: string, at: string, distanceM: number, bests: Partial<RunBests>, opts: { old?: boolean } = {}) => {
    const id = randomUUID();
    await insertRun(sql, userId, {
      id, startedAt: new Date(at), name: `Run ${at.slice(5, 10)}`, effort: null, note: null, distanceM, movingS: Math.round(distanceM / 3),
      elapsedS: Math.round(distanceM / 3), leftOutM: 0, leftOutS: 0, kcal: 0, splits: { km: [], mi: [], starts: [0] }, polyline: "",
      calcVersion: 1, climb: { state: "none" }, shape: null, bests: { ...none, ...bests },
    });
    if (opts.old === true) await sql`UPDATE runs SET run_calc_version = NULL, source = 'mongo' WHERE id = ${id}`;
    return id;
  };

  describe("the worst thing: somebody else's run as your record, or a record you never ran", () => {
    it("my records come from my runs alone: a stranger's faster run is never mine, and mine never theirs", async () => {
      const me = await makeUser("runner");
      const stranger = await makeUser("stranger");
      const run = body({ points: northRun(1300, 4), elapsedMs: 1_300_000 }); // 5.2 km at 4:10 a kilometre
      expect((await save(me.cookies, run)).statusCode).toBe(201);
      const fast = await keep(stranger.id, "2026-10-26T01:00:00.000Z", 6000, { k1: 150, mile: 250, k5: 800 });

      const mine = await records(me.cookies);
      expect(mine.k5?.runId).toBe(run.runId);
      expect(Math.abs((mine.k5?.value ?? 0) - 1250)).toBeLessThanOrEqual(5);
      expect(mine.longest?.runId).toBe(run.runId);
      for (const r of Object.values(mine)) expect(r?.runId).not.toBe(fast);

      const theirs = await records(stranger.cookies);
      expect(theirs.k5?.runId).toBe(fast);
      expect(JSON.stringify(theirs)).not.toContain(run.runId);
      expect(JSON.stringify(theirs)).not.toContain("Morning Run");
      // A run's page names only its own owner's records, and a stranger cannot open it at all.
      expect((await open(stranger.cookies, run.runId)).statusCode).toBe(404);
      const page = runDetailResponseSchema.parse(JSON.parse((await open(me.cookies, run.runId)).body)).run;
      expect(page.records).toEqual(expect.arrayContaining(["k1", "mile", "k5", "longest"]));
    });

    it("a car ride inside a run is never a fastest 5K", async () => {
      const me = await makeUser("car");
      // 3 km on foot, 2 km in a car at 72 km/h, 3 km on foot: 6 km counted, never 5 km in one piece.
      const points: SaveRunRequest["points"] = [];
      let north = 0;
      const speeds = [...Array.from({ length: 600 }, () => 5), ...Array.from({ length: 100 }, () => 20), ...Array.from({ length: 600 }, () => 5)];
      for (let i = 0; i <= speeds.length; i++) {
        if (i > 0) north += speeds[i - 1] ?? 0;
        points.push([i * 1000, 26.1445 + north / 110_760, 91.7362, 5]);
      }
      const run = body({ points, elapsedMs: 1_300_000 });
      expect((await save(me.cookies, run)).statusCode).toBe(201);
      const kept = await sql<{ best_5k_s: number | null; best_1k_s: number | null; distance_m: number }[]>`SELECT best_5k_s, best_1k_s, distance_m FROM runs WHERE id = ${run.runId}`;
      expect(kept[0]?.distance_m).toBeGreaterThan(5000);
      expect(kept[0]?.best_5k_s).toBeNull();
      expect(Math.abs((kept[0]?.best_1k_s ?? 0) - 200)).toBeLessThanOrEqual(2);
      expect((await records(me.cookies)).k5).toBeNull();
    });

    it("nobody signed in reads nothing", async () => {
      expect((await inject({ method: "GET", url: "/v1/geo/runs/records" })).statusCode).toBe(401);
    });
  });

  describe("the records, every class of case", () => {
    it("nothing yet: every record empty", async () => {
      const me = await makeUser("empty");
      expect(await records(me.cookies)).toEqual({ k1: null, mile: null, k5: null, k10: null, longest: null });
    });

    it("the fastest wins, a tie keeps the run that set it first, and the best before it is said", async () => {
      const me = await makeUser("rule");
      await keep(me.id, "2026-10-01T01:00:00.000Z", 5200, { k1: 300, mile: 490, k5: 1700 });
      const better = await keep(me.id, "2026-10-05T01:00:00.000Z", 5100, { k1: 280, mile: 470, k5: 1620 });
      await keep(me.id, "2026-10-09T01:00:00.000Z", 5050, { k1: 280, k5: 1660 }); // ties the 1K later: no record
      const long = await keep(me.id, "2026-10-12T01:00:00.000Z", 10_400, { k1: 310, mile: 500, k5: 1750, k10: 3600 });
      const r = await records(me.cookies);
      expect(r.k1).toMatchObject({ runId: better, value: 280, before: 300, name: "Run 10-05", day: "2026-10-05" });
      expect(r.k5).toMatchObject({ runId: better, value: 1620, before: 1700 });
      expect(r.mile).toMatchObject({ runId: better, value: 470, before: 490 });
      expect(r.k10).toMatchObject({ runId: long, value: 3600, before: null });
      expect(r.longest).toMatchObject({ runId: long, value: 10_400, before: 5200 });
    });

    it("a record's run deleted: the next best takes over, as Strava's does", async () => {
      const me = await makeUser("delete");
      const first = await keep(me.id, "2026-10-01T01:00:00.000Z", 5200, { k1: 300, k5: 1700 });
      const best = await keep(me.id, "2026-10-05T01:00:00.000Z", 6000, { k1: 280, k5: 1620 });
      expect((await remove(me.cookies, best)).statusCode).toBe(204);
      const r = await records(me.cookies);
      expect(r.k5).toMatchObject({ runId: first, value: 1700, before: null });
      expect(r.longest).toMatchObject({ runId: first, value: 5200 });
    });

    it("only runs this app recorded count; one saved before records were kept counts for the longest run only", async () => {
      const me = await makeUser("old");
      await keep(me.id, "2026-09-01T01:00:00.000Z", 21_000, {}, { old: true }); // brought over from the old app
      const before = await keep(me.id, "2026-10-01T01:00:00.000Z", 7000, {}); // saved before 37c-ii: no times kept
      const r = await records(me.cookies);
      expect(r.longest).toMatchObject({ runId: before, value: 7000, before: null });
      expect([r.k1, r.mile, r.k5, r.k10]).toEqual([null, null, null, null]);
    });

    it("the longest run counts from 200 m, the streak's own line", async () => {
      const me = await makeUser("short");
      await keep(me.id, "2026-10-01T01:00:00.000Z", 150, {});
      expect((await records(me.cookies)).longest).toBeNull();
      const two = await keep(me.id, "2026-10-02T01:00:00.000Z", 200, {});
      expect((await records(me.cookies)).longest).toMatchObject({ runId: two, value: 200 });
    });

    it("a run's page gives its best efforts and the records it holds now", async () => {
      const me = await makeUser("ownpage");
      const a = await keep(me.id, "2026-10-01T01:00:00.000Z", 5200, { k1: 300, mile: 490, k5: 1700 });
      const b = await keep(me.id, "2026-10-05T01:00:00.000Z", 3000, { k1: 280, mile: 470 });
      const pageA = runDetailResponseSchema.parse(JSON.parse((await open(me.cookies, a)).body)).run;
      expect(pageA.bests).toEqual({ k1: 300, mile: 490, k5: 1700, k10: null });
      expect([...pageA.records].sort()).toEqual(["k5", "longest"]);
      const pageB = runDetailResponseSchema.parse(JSON.parse((await open(me.cookies, b)).body)).run;
      expect([...pageB.records].sort()).toEqual(["k1", "mile"]);
    });
  });
});
