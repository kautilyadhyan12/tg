// A run's elevation gain (ROADMAP 37b-ii), against REAL Postgres. DATABASE_URL-gated. The height map
// is the test's own (its reading of real files is `geo.heights.unit.test.ts`): a hill rising 2 m in
// every 100 m north of a front door in Guwahati. The first block is the job's worst thing on this
// side: the summary's ask keeps nothing and says nothing but a number.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PACE_LINE_MOST, RUN_MAX_PAUSES, RUN_MAX_POINTS, runClimbResponseSchema, runDetailResponseSchema, saveRunResponseSchema, type RunClimbRequest, type SaveRunRequest } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { HeightMap } from "../src/modules/geo/heights.adapter.js";
import { keepWaitingClimb, listWaitingClimbs } from "../src/modules/geo/repo.js";
import { workOutWaitingClimbs } from "../src/modules/geo/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "climb-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
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

const START_LAT = 26.1445;
const M_PER_DEG = 110_760;
/** A run going north at `mps` metres a second, one point a second. */
function northRun(seconds: number, mps: number): SaveRunRequest["points"] {
  const points: SaveRunRequest["points"] = [];
  for (let i = 0; i <= seconds; i++) points.push([i * 1000, START_LAT + (i * mps) / M_PER_DEG, 91.7362, 5]);
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
const askOf = (run: SaveRunRequest): RunClimbRequest => ({ elapsedMs: run.elapsedMs, points: run.points, pauses: run.pauses });

/** The test's height map: "hill" rises 2 m every 100 m north; the others say a piece is still coming,
 *  the map has nothing here, or the map breaks. */
type Mode = "hill" | "waiting" | "none" | "broken";
function testMap(): HeightMap & { mode: Mode; asked: number } {
  const map = {
    mode: "hill" as Mode,
    asked: 0,
    heightsAt(places: readonly (readonly [number, number])[]) {
      map.asked++;
      if (map.mode === "broken") return Promise.reject(new Error("disk gone"));
      if (map.mode === "waiting") return Promise.resolve("waiting" as const);
      if (map.mode === "none") return Promise.resolve(places.map(() => null));
      return Promise.resolve(places.map(([lat]) => 50 + (lat - START_LAT) * M_PER_DEG * 0.02));
    },
  };
  return map;
}

d("a run's elevation gain (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const heights = testMap();
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
  const ask = (cookies: Cookies, b: unknown) => inject({ method: "POST", url: "/v1/geo/runs/climb", body: b, cookies });
  const save = (cookies: Cookies, run: SaveRunRequest) => inject({ method: "POST", url: "/v1/geo/runs", body: run, cookies, key: run.runId });
  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runclimb-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Climb Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies: cookieMap(login), id };
  };
  const mine = sql`SELECT id FROM users WHERE email LIKE 'runclimb-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runclimb-%@example.com'`;
  };
  const row = async (id: string) => (await sql<{ climb_m: number | null; climb_state: string | null }[]>`SELECT climb_m, climb_state FROM runs WHERE id = ${id}`)[0];

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), geo: { heights } });
  });
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  describe("the worst thing on this side: the summary's ask keeps nothing and says nothing but a number", () => {
    it("asked before Save, the run is kept nowhere, and the answer holds the climb alone", async () => {
      heights.mode = "hill";
      const me = await makeUser("ask");
      const run = body();
      const res = await ask(me.cookies, askOf(run));
      expect(res.statusCode).toBe(200);
      // The climb, and the hills behind the pace chart (37c-iii): heights, nothing of where they are.
      expect(JSON.parse(res.body)).toEqual({ climb: { state: "done", m: 72, hills: expect.any(Array) as unknown } });
      const hills = runClimbResponseSchema.parse(JSON.parse(res.body)).climb;
      expect(hills.state === "done" ? hills.hills : []).toHaveLength(PACE_LINE_MOST);
      expect(await sql`SELECT 1 FROM runs WHERE id = ${run.runId}`).toHaveLength(0);
      expect(await sql`SELECT 1 FROM runs WHERE user_id = ${me.id}`).toHaveLength(0);
    });

    it("nobody signed in gets nothing", async () => {
      expect((await ask({}, askOf(body()))).statusCode).toBe(401);
    });

    it("who is asking and the limit come before the points are read, for the phone's sign-in and the browser's", async () => {
      // 21a-iii-c. A body that is not even JSON: a server that read it first would answer 400 to all.
      const broken = (headers: Record<string, string>, cookies: Cookies = {}) =>
        api().inject({ method: "POST", url: "/v1/geo/runs/climb", remoteAddress: nextIp(), headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...headers }, cookies, payload: '{"points": ' });
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

    it("the longest run a phone keeps is answered; one point more is refused by the list count", async () => {
      const me = await makeUser("longest-climb");
      const pauses: SaveRunRequest["pauses"] = [];
      for (let i = 0; i < RUN_MAX_PAUSES; i++) pauses.push([i * 20_000 + 1000, i * 20_000 + 2000]);
      const longest = body({ points: northRun(RUN_MAX_POINTS - 1, 3), elapsedMs: RUN_MAX_POINTS * 1000, pauses });
      expect(longest.points.length).toBe(RUN_MAX_POINTS);
      const res = await ask(me.cookies, askOf(longest));
      expect(res.statusCode, res.body).toBe(200);
      const past = await ask(me.cookies, askOf({ ...longest, points: northRun(RUN_MAX_POINTS, 3) }));
      expect([past.statusCode, (JSON.parse(past.body) as { error: string }).error]).toEqual([413, "too_many_items"]);
    }, 30_000);

    it("a body that is not a run's points is refused, and says which field, never its values", async () => {
      const me = await makeUser("bad");
      const run = body();
      const withName = await ask(me.cookies, { ...askOf(run), name: "Morning Run" });
      expect(withName.statusCode).toBe(400);
      const nowhere = await ask(me.cookies, { ...askOf(run), points: [[0, 95, 91.7, 5]] });
      expect(nowhere.statusCode).toBe(400);
      expect(nowhere.body).not.toContain("95");
    });
  });

  describe("the summary's number and the saved number are one", () => {
    it("asked and then saved, the same points climb the same metres, kept with the run", async () => {
      heights.mode = "hill";
      const me = await makeUser("same");
      // 1.2 km north with a pause, the line starting again 150 m on: 1,050 m of a 2 % hill.
      const run = body({ points: northRun(400, 3), elapsedMs: 400_000, pauses: [[150_000, 200_000]] });
      const asked = runClimbResponseSchema.parse(JSON.parse((await ask(me.cookies, askOf(run))).body)).climb;
      expect(asked).toMatchObject({ state: "done", m: 21 });
      const saved = saveRunResponseSchema.parse(JSON.parse((await save(me.cookies, run)).body));
      expect(saved.run.climbM).toBe(21);
      expect(await row(run.runId)).toEqual({ climb_m: 21, climb_state: "done" });
      // Sent again: answered from the row, the climb with it, the map not asked.
      const before = heights.asked;
      expect(saveRunResponseSchema.parse(JSON.parse((await save(me.cookies, run)).body)).run.climbM).toBe(21);
      expect(heights.asked).toBe(before);
      // The run's page draws the pace chart from what was kept: the same hills the summary was given.
      const page = runDetailResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: me.cookies })).body)).run;
      expect(page.hillLine).toEqual(asked.state === "done" ? asked.hills : null);
      expect(page.paceLine.length).toBe(page.hillLine.length);
      expect(page.paceLine.every((v) => Math.abs(v - 300) <= 10)).toBe(true);
      // The hill rises 2 m every 100 m north: from the start to the finish, higher.
      expect((page.hillLine[page.hillLine.length - 1] ?? 0) - (page.hillLine[0] ?? 0)).toBeGreaterThan(15);
    });

    it("a flat run climbs nothing, and a run of one point climbs nothing", async () => {
      heights.mode = "hill";
      const me = await makeUser("flat");
      const east: SaveRunRequest["points"] = Array.from({ length: 600 }, (_, i) => [i * 1000, START_LAT, 91.7362 + (i * 3) / 100_000, 5]);
      const flat = body({ points: east, elapsedMs: 600_000 });
      expect(JSON.parse((await ask(me.cookies, askOf(flat))).body)).toMatchObject({ climb: { state: "done", m: 0 } });
      const one = body({ points: [[0, START_LAT, 91.7362, 5]], elapsedMs: 1000 });
      expect(JSON.parse((await ask(me.cookies, askOf(one))).body)).toEqual({ climb: { state: "done", m: 0, hills: [] } });
    });

    it("where the map has no heights the run has no number, and says so", async () => {
      heights.mode = "none";
      const me = await makeUser("none");
      const run = body();
      expect(JSON.parse((await ask(me.cookies, askOf(run))).body)).toEqual({ climb: { state: "none" } });
      expect(saveRunResponseSchema.parse(JSON.parse((await save(me.cookies, run)).body)).run.climbM).toBeNull();
      expect(await row(run.runId)).toEqual({ climb_m: null, climb_state: "none" });
      // No hills behind its pace chart, never a made-up line; the pace line itself is kept.
      const page = runDetailResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: me.cookies })).body)).run;
      expect(page.hillLine).toEqual([]);
      expect(page.paceLine).toHaveLength(PACE_LINE_MOST);
    });
  });

  describe("a run is saved whatever the height map does", () => {
    it("a piece of the map still coming: saved waiting, then worked out by the worker once, and only once", async () => {
      heights.mode = "waiting";
      const me = await makeUser("wait");
      const run = body();
      expect(JSON.parse((await ask(me.cookies, askOf(run))).body)).toEqual({ climb: { state: "waiting" } });
      const saved = await save(me.cookies, run);
      expect(saved.statusCode).toBe(201);
      expect(saveRunResponseSchema.parse(JSON.parse(saved.body)).run.climbM).toBeNull();
      expect(await row(run.runId)).toEqual({ climb_m: null, climb_state: "waiting" });

      // Still waiting when the worker comes: left waiting.
      const log = { error: () => undefined };
      const first = await workOutWaitingClimbs({ sql, heights, log }, { limit: 500, waitMs: 1000, mostMs: 60_000 });
      expect(first.stillWaiting).toBeGreaterThanOrEqual(1);
      expect(await row(run.runId)).toEqual({ climb_m: null, climb_state: "waiting" });

      heights.mode = "hill";
      // Two workers at once keep it once.
      const [a, b] = await Promise.all([
        workOutWaitingClimbs({ sql, heights, log }, { limit: 500, waitMs: 1000, mostMs: 60_000 }),
        workOutWaitingClimbs({ sql, heights, log }, { limit: 500, waitMs: 1000, mostMs: 60_000 }),
      ]);
      expect(await row(run.runId)).toEqual({ climb_m: 72, climb_state: "done" });
      expect(a.kept + b.kept).toBeGreaterThanOrEqual(1);
      // Its pace chart's hills come with the climb, at the pace line's places, the line itself unchanged.
      const page = runDetailResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${run.runId}`, cookies: me.cookies })).body)).run;
      expect(page.paceLine).toHaveLength(PACE_LINE_MOST);
      expect(page.hillLine).toHaveLength(PACE_LINE_MOST);
      expect(page.splitsKm.length).toBeGreaterThan(0);
      // This run's own hills: the very ones the summary's ask gives for its points.
      const asked = runClimbResponseSchema.parse(JSON.parse((await ask(me.cookies, askOf(run))).body)).climb;
      expect(page.hillLine).toEqual(asked.state === "done" ? asked.hills : null);
      expect((page.hillLine[page.hillLine.length - 1] ?? 0) - (page.hillLine[0] ?? 0)).toBeGreaterThan(15);
      const mineKept = await sql`SELECT 1 FROM runs WHERE user_id = ${me.id} AND climb_state = 'done'`;
      expect(mineKept).toHaveLength(1);
      // The phone, sending it again, now reads the climb.
      expect(saveRunResponseSchema.parse(JSON.parse((await save(me.cookies, run)).body)).run.climbM).toBe(72);
    });

    it("the sweep takes the newest waiting runs first, stops at its time, and gives up on a run waiting past three days", async () => {
      heights.mode = "waiting";
      const me = await makeUser("sweep");
      const old = body();
      const newer = body();
      expect((await save(me.cookies, old)).statusCode).toBe(201);
      expect((await save(me.cookies, newer)).statusCode).toBe(201);
      await sql`UPDATE runs SET created_at = now() - interval '4 days' WHERE id = ${old.runId}`;
      heights.mode = "hill";
      const log = { error: () => undefined };
      // No time at all: nothing is worked out, and the old run gives up.
      const none = await workOutWaitingClimbs({ sql, heights, log }, { limit: 500, waitMs: 1000, mostMs: 0 });
      expect(none.kept).toBe(0);
      expect(none.gaveUp).toBeGreaterThanOrEqual(1);
      expect(await row(old.runId)).toEqual({ climb_m: null, climb_state: "none" });
      expect(await row(newer.runId)).toEqual({ climb_m: null, climb_state: "waiting" });
      // Newest first: a run saved a day before the newer one comes after it in the list.
      const middle = body();
      expect((await save(me.cookies, { ...middle })).statusCode).toBe(201);
      await sql`UPDATE runs SET climb_m = NULL, climb_state = 'waiting', created_at = now() - interval '1 day' WHERE id = ${middle.runId}`;
      const order = (await listWaitingClimbs(sql, 100_000)).map((r) => r.id).filter((id) => id === newer.runId || id === middle.runId);
      expect(order).toEqual([newer.runId, middle.runId]);
      await workOutWaitingClimbs({ sql, heights, log }, { limit: 100_000, waitMs: 1000, mostMs: 60_000 });
      expect(await row(newer.runId)).toEqual({ climb_m: 72, climb_state: "done" });
    });

    it("a height map that breaks: the run is saved, its climb waiting", async () => {
      heights.mode = "broken";
      const me = await makeUser("broken");
      const run = body();
      expect((await save(me.cookies, run)).statusCode).toBe(201);
      expect(await row(run.runId)).toEqual({ climb_m: null, climb_state: "waiting" });
      heights.mode = "hill";
    });

    it("a waiting run is kept only for its own person", async () => {
      heights.mode = "waiting";
      const me = await makeUser("owner");
      const stranger = await makeUser("not-owner");
      const run = body();
      expect((await save(me.cookies, run)).statusCode).toBe(201);
      expect(await keepWaitingClimb(sql, { id: run.runId, userId: stranger.id }, { state: "done", m: 999, hills: [] })).toBe(false);
      expect(await row(run.runId)).toEqual({ climb_m: null, climb_state: "waiting" });
      expect(await keepWaitingClimb(sql, { id: run.runId, userId: me.id }, { state: "done", m: 5, hills: [] })).toBe(true);
      expect(await keepWaitingClimb(sql, { id: run.runId, userId: me.id }, { state: "done", m: 6, hills: [] })).toBe(false);
      expect(await row(run.runId)).toEqual({ climb_m: 5, climb_state: "done" });
      heights.mode = "hill";
    });

    it("the table refuses a climb that contradicts its state", async () => {
      const me = await makeUser("check");
      const run = body();
      heights.mode = "hill";
      expect((await save(me.cookies, run)).statusCode).toBe(201);
      await expect(sql`UPDATE runs SET climb_state = 'waiting' WHERE id = ${run.runId}`).rejects.toThrow(/runs_climb_check/);
      await expect(sql`UPDATE runs SET climb_m = -1 WHERE id = ${run.runId}`).rejects.toThrow(/runs_climb_check/);
      await expect(sql`UPDATE runs SET climb_state = 'maybe', climb_m = NULL WHERE id = ${run.runId}`).rejects.toThrow(/runs_climb_check/);
    });
  });

  it("ten asks a minute for a person: the eleventh waits; somebody else at the same address does not", async () => {
    heights.mode = "hill";
    const me = await makeUser("loop");
    const other = await makeUser("loop-other");
    const run = body({ points: northRun(60, 3), elapsedMs: 60_000 });
    const at = "10.39.200.1";
    const askAt = (cookies: Cookies) =>
      api().inject({ method: "POST", url: "/v1/geo/runs/climb", remoteAddress: at, headers: { "content-type": "application/json" }, cookies, payload: JSON.stringify(askOf(run)) });
    for (let i = 0; i < 10; i++) expect((await askAt(me.cookies)).statusCode).toBe(200);
    expect((await askAt(me.cookies)).statusCode).toBe(429);
    expect((await askAt(other.cookies)).statusCode).toBe(200);
  });
});
