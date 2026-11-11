// Your own run plan (ROADMAP Stage 5 37d-iii-b), against REAL Postgres. DATABASE_URL-gated.
// The worst thing first: somebody in Safe mode shown a run from their own plan; then one person's pick or
// week read or changed by another. Then the routes' own rules: signed out, a bad week, the same week sent
// twice, the pick before and after, the suggested plan left as it was, the runs recorded and the 10 % line.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runPlanResponseSchema, type OwnWeek, type RunPlanAnswers, type RunPlanResponse } from "@app/shared";
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
const nextIp = () => `10.82.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const RUNNER: RunPlanAnswers = { doesRun: "yes", jog: "30plus", days: [1, 3, 5, 7], goal: "10k", weeklyM: 20_000, longestM: 8_000, race: null };
const REST: OwnWeek = [null, null, null, null, null, null, null];
// Monday 5 km easy, Wednesday a tempo run, Saturday 12 km long.
const WEEK: OwnWeek = [{ kind: "easy", m: 5000 }, null, { kind: "steady", m: 6000 }, null, null, { kind: "long", m: 12_000 }, null];

// Monday 9 November 2026, 10:00 in Kolkata.
let clock = new Date("2026-11-09T04:30:00.000Z");

d("your own run plan (real Postgres)", () => {
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
    const email = `ownrun-${name}@example.com`;
    expect((await api().inject({ method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(), payload: { email, password: PASSWORD, displayName: "Own Plan Fixture" } })).statusCode).toBe(201);
    const login = await api().inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${id}`;
    return { cookies: cookieMap(login), id };
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'ownrun-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM own_run_plans WHERE user_id IN (${mine})`;
    await sql`DELETE FROM run_plans WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ownrun-%@example.com'`;
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

  const okReply = (res: { statusCode: number; body: string }): RunPlanResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return runPlanResponseSchema.parse(JSON.parse(res.body));
  };
  const read = async (cookies: Cookies) => okReply(await inject({ method: "GET", url: "/v1/geo/run-plan", cookies }));
  const writeWeek = async (cookies: Cookies, days: unknown) => okReply(await inject({ method: "PUT", url: "/v1/geo/run-plan/own", body: { days }, cookies }));
  const pick = async (cookies: Cookies, choice: string) => okReply(await inject({ method: "PUT", url: "/v1/geo/run-plan/choice", body: { choice }, cookies }));
  const answer = async (cookies: Cookies, body: RunPlanAnswers) => okReply(await inject({ method: "PUT", url: "/v1/geo/run-plan", body, cookies }));
  const health = async (cookies: Cookies, body: Record<string, unknown>): Promise<void> => {
    expect((await api().inject({ method: "PUT", url: "/v1/users/me/health-screening", remoteAddress: nextIp(), payload: body, cookies })).statusCode).toBe(200);
  };
  const keep = async (userId: string, at: string, distanceM: number, movingS: number) => {
    await insertRun(sql, userId, {
      id: randomUUID(), startedAt: new Date(at), name: "Run", effort: null, note: null, distanceM, movingS, elapsedS: movingS, leftOutM: 0, leftOutS: 0, kcal: 0,
      splits: { km: [], mi: [], starts: [0], pace: [], hills: [] }, polyline: "", calcVersion: 2, climb: { state: "none" }, shape: null,
      bests: { k1: null, mile: null, k5: null, k10: null },
    });
  };
  /** Every run the reply holds, from either plan. */
  const runsIn = (r: RunPlanResponse): number => {
    const own = r.own?.days.filter((x) => x.session !== null).length ?? 0;
    const plan = r.plan !== null && r.plan.kind !== "none" ? r.plan.days.filter((x) => x.session !== null).length : 0;
    return own + plan;
  };

  describe("the worst thing: a run shown in Safe mode, or somebody else's plan", () => {
    it("Safe mode shows no run from one's own plan, picked or not, written before or during it; cleared, it comes back", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const { cookies } = await makeUser("safe");
      await writeWeek(cookies, WEEK);
      await answer(cookies, RUNNER);
      await health(cookies, { hasCondition: true, checkFirst: "not_yet" });
      for (const reply of [await read(cookies), await pick(cookies, "mine"), await pick(cookies, "suggested"), await writeWeek(cookies, WEEK)]) {
        expect(reply.own).toBeNull();
        expect(reply.capM).toBeNull();
        expect(reply.plan).toEqual({ kind: "none", why: "safe_mode" });
        expect(runsIn(reply)).toBe(0);
        expect(JSON.stringify(reply)).not.toContain("\"session\"");
      }
      await health(cookies, { hasCondition: true, checkFirst: "cleared" });
      const cleared = await read(cookies);
      expect(cleared.choice).toBe("mine");
      expect(cleared.own?.week).toEqual(WEEK);
    });

    it("one person's pick and week are never another's, and a second person's writes change only their own", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const me = await makeUser("me");
      const stranger = await makeUser("stranger");
      await writeWeek(me.cookies, WEEK);
      const theirs = await read(stranger.cookies);
      expect(theirs.own).toBeNull();
      expect(theirs.choice).toBe("suggested");
      await writeWeek(stranger.cookies, REST);
      await pick(stranger.cookies, "suggested");
      const mineNow = await read(me.cookies);
      expect(mineNow.own?.week).toEqual(WEEK);
      expect(mineNow.choice).toBe("mine");
      // My run ticks my Monday, never the stranger's.
      await keep(me.id, "2026-11-09T01:00:00.000Z", 5000, 1800);
      expect((await read(me.cookies)).own?.days[0]?.done).toBe(true);
      await writeWeek(stranger.cookies, WEEK);
      expect((await read(stranger.cookies)).own?.days[0]?.done).toBe(false);
      const rows = await sql<{ user_id: string }[]>`SELECT user_id FROM own_run_plans WHERE user_id IN (${me.id}, ${stranger.id}) ORDER BY user_id`;
      expect(rows.map((r) => r.user_id).sort()).toEqual([me.id, stranger.id].sort());
    });
  });

  describe("the routes", () => {
    it("signed out is refused", async () => {
      expect((await inject({ method: "PUT", url: "/v1/geo/run-plan/own", body: { days: WEEK } })).statusCode).toBe(401);
      expect((await inject({ method: "PUT", url: "/v1/geo/run-plan/choice", body: { choice: "mine" } })).statusCode).toBe(401);
    });

    it("a bad week or pick is refused and changes nothing", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("bad");
      await writeWeek(cookies, WEEK);
      for (const body of [{ days: WEEK.slice(0, 6) }, { days: [{ kind: "easy", m: 500 }, ...REST.slice(1)] }, { days: WEEK, userId: randomUUID() }, "x"]) {
        const res = await inject({ method: "PUT", url: "/v1/geo/run-plan/own", body, cookies });
        expect(res.statusCode).toBe(400);
      }
      for (const body of [{ choice: "gym" }, { choice: "mine", userId: randomUUID() }, {}]) {
        expect((await inject({ method: "PUT", url: "/v1/geo/run-plan/choice", body, cookies })).statusCode).toBe(400);
      }
      const after = await read(cookies);
      expect(after.own?.week).toEqual(WEEK);
      expect(after.choice).toBe("mine");
    });

    it("the same week sent twice leaves one row and the same reply; writing it picks My plan; Suggested keeps the week", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const me = await makeUser("twice");
      await pick(me.cookies, "suggested");
      const first = await writeWeek(me.cookies, WEEK);
      expect(first.choice).toBe("mine");
      expect(await writeWeek(me.cookies, WEEK)).toEqual(first);
      const rows = await sql<{ n: string }[]>`SELECT count(*) AS n FROM own_run_plans WHERE user_id = ${me.id}`;
      expect(Number(rows[0]?.n)).toBe(1);
      const back = await pick(me.cookies, "suggested");
      expect(back.choice).toBe("suggested");
      expect(back.own?.week).toEqual(WEEK);
      // A week of rest days is no plan of one's own; My plan stays picked.
      const empty = await writeWeek(me.cookies, REST);
      expect(empty.own).toBeNull();
      expect(empty.choice).toBe("mine");
      // Before any pick: My plan where there is one, else Suggested.
      await writeWeek(me.cookies, WEEK);
      await sql`UPDATE own_run_plans SET choice = NULL WHERE user_id = ${me.id}`;
      expect((await read(me.cookies)).choice).toBe("mine");
      await sql`UPDATE own_run_plans SET choice = NULL, days = NULL WHERE user_id = ${me.id}`;
      expect((await read(me.cookies)).choice).toBe("suggested");
    });

    it("the suggested plan is the same with or without a week of one's own", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-09T04:30:00.000Z");
      const me = await makeUser("same");
      const before = (await answer(me.cookies, RUNNER)).plan;
      expect(before?.kind).toBe("runner");
      const after = await writeWeek(me.cookies, WEEK);
      expect(after.plan).toEqual(before);
      expect(after.answers).toEqual(RUNNER);
    });

    it("the 10 % line comes from the runs this app recorded in the last 30 days, in the person's own day", { timeout: 60_000 }, async () => {
      clock = new Date("2026-11-11T04:30:00.000Z");
      const me = await makeUser("cap");
      // Before any week of one's own, for the week being written; then with it.
      expect((await read(me.cookies)).capM).toBeNull();
      expect((await writeWeek(me.cookies, WEEK)).capM).toBeNull();
      // 31 days before Wednesday 11 November, in Kolkata: too old.
      await keep(me.id, "2026-10-11T06:00:00.000Z", 15_000, 5400);
      expect((await read(me.cookies)).capM).toBeNull();
      // 30 days before: it counts.
      await keep(me.id, "2026-10-12T06:00:00.000Z", 8000, 2900);
      expect((await read(me.cookies)).capM).toBe(8800);
      // The answers' longest run, given today, counts as well.
      await answer(me.cookies, { ...RUNNER, longestM: 10_000 });
      expect((await read(me.cookies)).capM).toBe(11_000);
    });
  });
});
