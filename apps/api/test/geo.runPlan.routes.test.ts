// The run plan (ROADMAP Stage 5 37d-i), against REAL Postgres. DATABASE_URL-gated.
// The worst thing first: somebody in Safe mode handed a run, or a run planned past 10 % over the longest
// of the last month; and one person's answers or plan read or changed by another. Then the route's own
// rules: signed out, a bad answer, the same answers sent twice, the runs this app recorded counting.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runPlanResponseSchema, type RunPlanAnswers, type RunPlanResponse } from "@app/shared";
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

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.48.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const RUNNER: RunPlanAnswers = { doesRun: "yes", jog: "30plus", days: [1, 3, 5, 7], goal: "10k", weeklyM: 20_000, longestM: 8_000, race: { distanceM: 5000, timeS: 1500 } };
const BEGINNER: RunPlanAnswers = { doesRun: "start", jog: "none", days: [1, 3, 5], goal: "5k", weeklyM: null, longestM: null, race: null };

// Monday 9 November 2026, 10:00 in Kolkata.
let clock = new Date("2026-11-09T04:30:00.000Z");

d("the run plan (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: "GET" | "PUT"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runplan-${name}@example.com`;
    expect((await api().inject({ method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(), payload: { email, password: PASSWORD, displayName: "Plan Fixture" } })).statusCode).toBe(201);
    const login = await api().inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${id}`;
    return { cookies: cookieMap(login), id };
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runplan-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM run_plans WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runplan-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), geo: { now: () => clock } });
  }, 30_000);
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  }, 30_000);

  const read = async (cookies: Cookies): Promise<RunPlanResponse> => {
    const res = await inject({ method: "GET", url: "/v1/geo/run-plan", cookies });
    expect(res.statusCode, res.body).toBe(200);
    return runPlanResponseSchema.parse(JSON.parse(res.body));
  };
  const answer = async (cookies: Cookies, body: unknown): Promise<RunPlanResponse> => {
    const res = await inject({ method: "PUT", url: "/v1/geo/run-plan", body, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return runPlanResponseSchema.parse(JSON.parse(res.body));
  };
  const health = async (cookies: Cookies, body: Record<string, unknown>): Promise<void> => {
    expect((await api().inject({ method: "PUT", url: "/v1/users/me/health-screening", remoteAddress: nextIp(), payload: body, cookies })).statusCode).toBe(200);
  };
  /** A run kept straight in the table, as a save keeps it. */
  const keep = async (userId: string, at: string, distanceM: number, movingS: number, opts: { old?: boolean } = {}) => {
    const id = randomUUID();
    await insertRun(sql, userId, {
      id, startedAt: new Date(at), name: "Run", effort: null, note: null, distanceM, movingS, elapsedS: movingS, leftOutM: 0, leftOutS: 0, kcal: 0,
      splits: { km: [], mi: [], starts: [0], pace: [], hills: [] }, polyline: "", calcVersion: 2, climb: { state: "none" }, shape: null,
      bests: { k1: null, mile: null, k5: null, k10: null },
    });
    if (opts.old === true) await sql`UPDATE runs SET run_calc_version = NULL, source = 'mongo' WHERE id = ${id}`;
  };
  const metres = (r: RunPlanResponse): number[] =>
    r.plan !== null && r.plan.kind !== "none" ? r.plan.days.map((day) => (day.session !== null && day.session.kind !== "walk_run" ? day.session.m : 0)) : [];

  describe("the worst thing: a run that hurts somebody, or somebody else's plan", () => {
    it("Safe mode makes no plan, before or after answering, and shows why", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const { cookies } = await makeUser("safe");
      await health(cookies, { hasCondition: true, checkFirst: "not_yet" });
      expect((await read(cookies)).plan).toEqual({ kind: "none", why: "safe_mode" });
      const after = await answer(cookies, RUNNER);
      expect(after.plan).toEqual({ kind: "none", why: "safe_mode" });
      // Cleared by a professional: the plan.
      await health(cookies, { hasCondition: true, checkFirst: "cleared" });
      expect((await read(cookies)).plan?.kind).toBe("runner");
    });

    it("no planned run is past 10 % over the longest of the last month, the runs recorded included", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const me = await makeUser("cap");
      await answer(me.cookies, { ...RUNNER, weeklyM: 60_000, longestM: 8_000, goal: "half" });
      expect(Math.max(...metres(await read(me.cookies)))).toBeLessThanOrEqual(8_800);
      // A 10 km run recorded on Tuesday: the cap is 11 km now, never more.
      await keep(me.id, "2026-11-10T01:00:00.000Z", 10_000, 3600);
      clock = new Date("2026-11-11T04:30:00.000Z");
      expect(Math.max(...metres(await read(me.cookies)))).toBeLessThanOrEqual(11_000);
    });

    it("one person's answers and plan are never another's, and a second person cannot change them", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const me = await makeUser("me");
      const stranger = await makeUser("stranger");
      await answer(me.cookies, RUNNER);
      await keep(me.id, "2026-11-09T01:00:00.000Z", 5_000, 1800);
      expect(await read(stranger.cookies)).toEqual({ answers: null, plan: null });
      // The stranger answers: only their own row changes.
      await answer(stranger.cookies, BEGINNER);
      expect((await read(me.cookies)).answers).toEqual(RUNNER);
      expect((await read(stranger.cookies)).plan?.kind).toBe("c25k");
      // My recorded run ticks my Monday, never the stranger's.
      expect((await read(me.cookies)).plan?.kind === "runner").toBe(true);
      const theirs = await read(stranger.cookies);
      expect(theirs.plan !== null && theirs.plan.kind === "c25k" && theirs.plan.days.some((day) => day.done)).toBe(false);
      const count = await sql<{ n: string }[]>`SELECT count(*) AS n FROM run_plans WHERE user_id IN (${me.id}, ${stranger.id})`;
      expect(Number(count[0]?.n)).toBe(2);
    });
  });

  describe("the route", () => {
    it("signed out is refused", async () => {
      expect((await inject({ method: "GET", url: "/v1/geo/run-plan" })).statusCode).toBe(401);
      expect((await inject({ method: "PUT", url: "/v1/geo/run-plan", body: RUNNER })).statusCode).toBe(401);
    });

    it("a bad answer is refused and changes nothing; an id sent beside the answers is refused", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("bad");
      await answer(cookies, BEGINNER);
      for (const body of [{ ...RUNNER, days: [2] }, { ...RUNNER, weeklyM: null }, { ...BEGINNER, weeklyM: 5000 }, { ...RUNNER, race: { distanceM: 5000, timeS: 500 } }, { ...RUNNER, userId: randomUUID() }, "x"]) {
        const res = await inject({ method: "PUT", url: "/v1/geo/run-plan", body, cookies });
        expect(res.statusCode).toBe(400);
        expect(res.body).not.toContain("500");
      }
      expect((await read(cookies)).answers).toEqual(BEGINNER);
    });

    it("the same answers sent twice leave one row; Not for me makes no plan", { timeout: 60_000 }, async () => {
      const me = await makeUser("twice");
      const first = await answer(me.cookies, RUNNER);
      expect(await answer(me.cookies, RUNNER)).toEqual(first);
      const no: RunPlanAnswers = { doesRun: "no", jog: null, days: [], goal: null, weeklyM: null, longestM: null, race: null };
      expect((await answer(me.cookies, no)).plan).toEqual({ kind: "none", why: "not_for_me" });
      const rows = await sql<{ n: string }[]>`SELECT count(*) AS n FROM run_plans WHERE user_id = ${me.id}`;
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it("Couch to 5K: a run this app recorded ticks the run off in the person's own day; an imported run counts for nothing", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const me = await makeUser("c25k");
      await answer(me.cookies, BEGINNER);
      // 23:50 on Monday in Kolkata is Monday there, though Monday 18:20 UTC.
      await keep(me.id, "2026-11-09T18:20:00.000Z", 2_500, 1500, { old: true });
      clock = new Date("2026-11-10T04:30:00.000Z");
      let plan = (await read(me.cookies)).plan;
      expect(plan !== null && plan.kind === "c25k" && plan.days[0]?.done).toBe(false);
      await keep(me.id, "2026-11-09T18:20:00.000Z", 2_500, 1500);
      plan = (await read(me.cookies)).plan;
      expect(plan !== null && plan.kind === "c25k" && plan.days[0]?.done).toBe(true);
      const next = plan !== null && plan.kind === "c25k" ? plan.days.find((day) => !day.done && day.session !== null) : undefined;
      expect(next?.session?.kind === "walk_run" ? next.session.run : 0).toBe(2);
      expect(next?.weekday).toBe(3);
    });
  });
});
