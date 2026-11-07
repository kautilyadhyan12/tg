// Your runs (ROADMAP Stage 5 37c-i), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: somebody else's run, with the route from their front door,
// shown to another person, or changed or deleted by them; and a deleted run brought back by a phone
// that sends it again. Then the list (its months whole, the person's own days, a day picked on the
// calendar), the calendar's month, a run changed, and a run deleted taking its streak and XP with it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  RUN_SHAPE_MOST_POINTS,
  RUN_WORDS,
  decodeShape,
  runDaysResponseSchema,
  runDetailResponseSchema,
  runPageSchema,
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

d("your runs (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: Method; url: string; body?: unknown; cookies?: Cookies; key?: string }) =>
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
  const list = async (cookies: Cookies, query = "") => {
    const res = await inject({ method: "GET", url: `/v1/geo/runs${query}`, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return runPageSchema.parse(JSON.parse(res.body));
  };
  const open = (cookies: Cookies, id: string) => inject({ method: "GET", url: `/v1/geo/runs/${id}`, cookies });
  const change = (cookies: Cookies, id: string, to: unknown) => inject({ method: "PATCH", url: `/v1/geo/runs/${id}`, body: to, cookies });
  const remove = (cookies: Cookies, id: string) => inject({ method: "DELETE", url: `/v1/geo/runs/${id}`, cookies });

  const makeUser = async (name: string, timeZone = "Asia/Kolkata"): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runyou-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Run Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    await sql`UPDATE users SET timezone = ${timeZone} WHERE id = ${id}`;
    return { cookies: cookieMap(login), id };
  };
  const xpOf = async (userId: string) => (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${userId}`)[0]?.total_xp ?? 0;

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runyou-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM run_removed_ids WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runyou-%@example.com'`;
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

  describe("the worst thing: somebody else's run shown, changed or deleted, or a deleted run brought back", () => {
    it("another member cannot list, open, change or delete my run, nor see its day on their calendar", async () => {
      const runner = await makeUser("runner");
      const stranger = await makeUser("stranger");
      const run = body();
      expect((await save(runner.cookies, run)).statusCode).toBe(201);

      const theirs = await list(stranger.cookies);
      expect(theirs.items).toEqual([]);
      expect(theirs.total).toEqual({ runs: 0, distanceM: 0 });
      expect(theirs.months).toEqual([]);
      const read = await open(stranger.cookies, run.runId);
      expect(read.statusCode).toBe(404);
      expect(read.body).not.toContain("polyline");
      expect(read.body).not.toContain("Morning Run");
      expect((await change(stranger.cookies, run.runId, { name: "Mine now", note: null })).statusCode).toBe(404);
      expect((await remove(stranger.cookies, run.runId)).statusCode).toBe(404);
      const calendar = runDaysResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs/days?month=2026-10", cookies: stranger.cookies })).body));
      expect(calendar).toEqual({ month: "2026-10", days: [], first: null });

      // The runner's run is as they saved it, and theirs alone.
      const kept = await sql<{ name: string; effort: number; note: string; user_id: string }[]>`SELECT name, effort, note, user_id FROM runs WHERE id = ${run.runId}`;
      expect(kept).toEqual([{ name: "Morning Run", effort: 6, note: "Easy one", user_id: runner.id }]);
      expect((await sql`SELECT 1 FROM run_removed_ids WHERE id = ${run.runId}`).length).toBe(0);
      const own = runDetailResponseSchema.parse(JSON.parse((await open(runner.cookies, run.runId)).body)).run;
      expect(own.name).toBe("Morning Run");
      expect(own.polyline?.length ?? 0).toBeGreaterThan(10);
    });

    it("a deleted run sent again by a phone stays deleted, and so does one whose send was on its way", async () => {
      const me = await makeUser("again");
      const run = body();
      expect((await save(me.cookies, run)).statusCode).toBe(201);
      expect((await remove(me.cookies, run.runId)).statusCode).toBe(204);
      const again = await save(me.cookies, run);
      expect(again.statusCode).toBe(410);
      expect(JSON.parse(again.body)).toMatchObject({ error: "run_deleted", message: RUN_WORDS.run_deleted });
      expect((await sql`SELECT 1 FROM runs WHERE id = ${run.runId}`).length).toBe(0);
      expect((await open(me.cookies, run.runId)).statusCode).toBe(404);
      // A second Delete (its answer lost) finds nothing, and says so.
      const twice = await remove(me.cookies, run.runId);
      expect(twice.statusCode).toBe(404);
      expect(JSON.parse(twice.body)).toMatchObject({ message: RUN_WORDS.not_found });

      // A delete and a send of the same run at the same instant: whichever comes first, it stays deleted.
      const raced = body();
      expect((await save(me.cookies, raced)).statusCode).toBe(201);
      const [gone, late] = await Promise.all([remove(me.cookies, raced.runId), save(me.cookies, raced)]);
      expect(gone.statusCode).toBe(204);
      expect([200, 410]).toContain(late.statusCode);
      expect((await save(me.cookies, raced)).statusCode).toBe(410);
      expect((await sql`SELECT 1 FROM runs WHERE id = ${raced.runId}`).length).toBe(0);
    });

    it("nobody signed in gets nothing", async () => {
      const id = randomUUID();
      for (const [method, path] of [["GET", "/v1/geo/runs"], ["GET", "/v1/geo/runs/days?month=2026-10"], ["GET", `/v1/geo/runs/${id}`], ["PATCH", `/v1/geo/runs/${id}`], ["DELETE", `/v1/geo/runs/${id}`]] as const) {
        expect((await inject({ method, url: path, ...(method === "PATCH" ? { body: { name: "x" } } : {}) })).statusCode, `${method} ${path}`).toBe(401);
      }
    });
  });

  it("lists each run with its name, its own day, its route small, and each month whole though the page holds part of it", async () => {
    const me = await makeUser("list");
    // 20:00 on 31 October in London is 01:30 on 1 November in Guwahati: the person's own day counts.
    const late = body({ startedAt: "2026-10-31T20:00:00.000Z", name: "Late run" });
    const early = body({ startedAt: "2026-11-03T01:00:00.000Z", name: "Early run", points: northRun(1300, 3), elapsedMs: 1_300_000, pauses: [[600_000, 700_000]] });
    const october = body({ startedAt: "2026-10-25T01:00:00.000Z", name: "October run" });
    for (const run of [late, early, october]) expect((await save(me.cookies, run)).statusCode).toBe(201);

    const first = await list(me.cookies, "?limit=1");
    expect(first.items.map((r) => [r.name, r.day])).toEqual([["Early run", "2026-11-03"]]);
    // November holds two runs; the page shows one of them and the month's line counts both.
    expect(first.months).toHaveLength(1);
    expect(first.months[0]).toMatchObject({ month: "2026-11", runs: 2 });
    const distances = await sql<{ id: string; distance_m: number }[]>`SELECT id, distance_m FROM runs WHERE user_id = ${me.id}`;
    const metres = (id: string) => distances.find((r) => r.id === id)?.distance_m ?? -1;
    expect(first.months[0]?.distanceM).toBe(metres(late.runId) + metres(early.runId));
    expect(first.total).toEqual({ runs: 3, distanceM: metres(late.runId) + metres(early.runId) + metres(october.runId) });
    const item = first.items[0];
    expect(item?.elapsedS).toBe(1300);
    expect(item?.durationS).toBeLessThan(1300);
    // Its route made small: two stretches either side of the pause, never past the picture's most points.
    const shape = decodeShape(item?.shape ?? "");
    expect(shape.starts).toHaveLength(2);
    expect(shape.track.length).toBeGreaterThan(3);
    expect(shape.track.length).toBeLessThanOrEqual(RUN_SHAPE_MOST_POINTS);
    expect(JSON.stringify(first)).not.toContain("polyline");

    const rest = await list(me.cookies, `?limit=1&cursor=${first.nextCursor ?? ""}`);
    expect(rest.items.map((r) => [r.name, r.day])).toEqual([["Late run", "2026-11-01"]]);
    const last = await list(me.cookies, `?limit=5&cursor=${rest.nextCursor ?? ""}`);
    expect(last.items.map((r) => r.name)).toEqual(["October run"]);
    expect(last.nextCursor).toBeNull();
    expect(last.months).toEqual([{ month: "2026-10", runs: 1, distanceM: metres(october.runId) }]);

    // A day picked on the calendar: the runs of that day and before, in the person's own time zone.
    const picked = await list(me.cookies, "?upTo=2026-11-01");
    expect(picked.items.map((r) => r.name)).toEqual(["Late run", "October run"]);
    expect((await list(me.cookies, "?upTo=2026-10-31")).items.map((r) => r.name)).toEqual(["October run"]);
    expect((await list(me.cookies, "?upTo=2026-10-24")).items).toEqual([]);
    expect((await inject({ method: "GET", url: "/v1/geo/runs?upTo=1-11-2026", cookies: me.cookies })).statusCode).toBe(400);
  });

  it("a run saved before Your runs gets its route small the first time the list reads it, and keeps it", async () => {
    const me = await makeUser("older");
    const run = body();
    expect((await save(me.cookies, run)).statusCode).toBe(201);
    await sql`UPDATE runs SET shape = NULL WHERE id = ${run.runId}`;
    const [read] = (await list(me.cookies)).items;
    expect(decodeShape(read?.shape ?? "").track.length).toBeGreaterThan(1);
    const kept = await sql<{ shape: string | null }[]>`SELECT shape FROM runs WHERE id = ${run.runId}`;
    expect(kept[0]?.shape).toBe(read?.shape);
  });

  it("opens a run with everything its summary showed after Finish", async () => {
    const me = await makeUser("open");
    const run = body({ points: northRun(1200, 3.4), elapsedMs: 1_260_000, pauses: [[1_200_000, 1_260_000]] });
    const saved = JSON.parse((await save(me.cookies, run)).body) as { run: Record<string, unknown> };
    const res = await open(me.cookies, run.runId);
    expect(res.statusCode).toBe(200);
    const page = runDetailResponseSchema.parse(JSON.parse(res.body)).run;
    expect(page).toMatchObject({
      id: run.runId,
      name: "Morning Run",
      effort: 6,
      note: "Easy one",
      day: "2026-10-25",
      distanceM: saved.run["distanceM"],
      durationS: saved.run["movingS"],
      elapsedS: 1260,
      splitsKm: saved.run["splitsKm"],
      splitsMi: saved.run["splitsMi"],
      trackStarts: saved.run["trackStarts"],
      polyline: saved.run["polyline"],
    });
    expect((await open(me.cookies, "not-a-run")).statusCode).toBe(404);
  });

  it("changes the name, how it felt and the note, and never the numbers; refuses what it cannot keep", async () => {
    const me = await makeUser("change");
    const run = body();
    expect((await save(me.cookies, run)).statusCode).toBe(201);
    const before = await sql`SELECT distance_m, duration_s, elapsed_s, kcal_point, polyline, splits FROM runs WHERE id = ${run.runId}`;

    const res = await change(me.cookies, run.runId, { name: "  Hill repeats ", effort: 9, note: "Legs heavy" });
    expect(res.statusCode, res.body).toBe(200);
    expect(runDetailResponseSchema.parse(JSON.parse(res.body)).run).toMatchObject({ name: "Hill repeats", effort: 9, note: "Legs heavy" });
    // Each field left out stays; how it felt can be cleared; an empty note is no note.
    expect(runDetailResponseSchema.parse(JSON.parse((await change(me.cookies, run.runId, { effort: null, note: "" })).body)).run).toMatchObject({ name: "Hill repeats", effort: null, note: null });
    expect(await sql`SELECT name, effort, note FROM runs WHERE id = ${run.runId}`).toEqual([{ name: "Hill repeats", effort: null, note: null }]);
    expect(await sql`SELECT distance_m, duration_s, elapsed_s, kcal_point, polyline, splits FROM runs WHERE id = ${run.runId}`).toEqual(before);

    for (const bad of [{}, { name: "" }, { name: "x".repeat(61) }, { effort: 11 }, { effort: 0 }, { note: "x".repeat(1001) }, { distanceM: 42195 }, { name: "Fine", polyline: "abc" }]) {
      expect((await change(me.cookies, run.runId, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(await sql`SELECT name FROM runs WHERE id = ${run.runId}`).toEqual([{ name: "Hill repeats" }]);
  });

  it("deleting a run takes its streak day and its 50 XP with it, and its route for good", async () => {
    const me = await makeUser("delete");
    const run = body({ startedAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect((await save(me.cookies, run)).statusCode).toBe(201);
    const xp = await xpOf(me.id);
    expect((await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${me.id}`)[0]?.current).toBe(1);

    expect((await remove(me.cookies, run.runId)).statusCode).toBe(204);
    expect(await xpOf(me.id)).toBe(xp - 50);
    expect((await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${me.id}`)[0]?.current).toBe(0);
    expect(await sql`SELECT 1 FROM runs WHERE id = ${run.runId}`).toHaveLength(0);
    expect(await sql`SELECT user_id FROM run_removed_ids WHERE id = ${run.runId}`).toEqual([{ user_id: me.id }]);
    const after = await list(me.cookies);
    expect(after.items).toEqual([]);
    expect(after.total).toEqual({ runs: 0, distanceM: 0 });
  });

  it("the calendar's month: each day ran, in the person's own time zone, and the day of the first run", async () => {
    const me = await makeUser("calendar");
    const runs = [
      body({ startedAt: "2026-10-31T20:00:00.000Z" }), // 1 November in Guwahati
      body({ startedAt: "2026-11-03T01:00:00.000Z" }),
      body({ startedAt: "2026-11-03T12:00:00.000Z" }),
      body({ startedAt: "2026-09-02T01:00:00.000Z" }),
    ];
    for (const run of runs) expect((await save(me.cookies, run)).statusCode).toBe(201);
    const metres = Object.fromEntries((await sql<{ id: string; distance_m: number }[]>`SELECT id, distance_m FROM runs WHERE user_id = ${me.id}`).map((r) => [r.id, r.distance_m]));
    const of = (i: number) => metres[runs[i]?.runId ?? ""] ?? -1;
    const res = await inject({ method: "GET", url: "/v1/geo/runs/days?month=2026-11", cookies: me.cookies });
    expect(res.statusCode).toBe(200);
    expect(runDaysResponseSchema.parse(JSON.parse(res.body))).toEqual({
      month: "2026-11",
      days: [
        { day: "2026-11-01", runs: 1, distanceM: of(0) },
        { day: "2026-11-03", runs: 2, distanceM: of(1) + of(2) },
      ],
      first: "2026-09-02",
    });
    expect(runDaysResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/runs/days?month=2026-10", cookies: me.cookies })).body)).days).toEqual([]);
    for (const bad of ["", "?month=2026-13", "?month=2026-1", "?month=11-2026", "?month=2026-11&x=1"]) {
      expect((await inject({ method: "GET", url: `/v1/geo/runs/days${bad}`, cookies: me.cookies })).statusCode, bad).toBe(400);
    }
  });

  it("thirty changes or deletes a minute for a person; somebody else at the same address goes on", async () => {
    const me = await makeUser("limit");
    const other = await makeUser("limit-other");
    const run = body();
    expect((await save(me.cookies, run)).statusCode).toBe(201);
    for (let i = 0; i < 30; i++) expect((await change(me.cookies, run.runId, { effort: (i % 10) + 1 })).statusCode).toBe(200);
    expect((await change(me.cookies, run.runId, { effort: 5 })).statusCode).toBe(429);
    expect((await remove(me.cookies, run.runId)).statusCode).toBe(429);
    const theirs = body();
    expect((await save(other.cookies, theirs)).statusCode).toBe(201);
    expect((await change(other.cookies, theirs.runId, { effort: 5 })).statusCode).toBe(200);
  });
});
