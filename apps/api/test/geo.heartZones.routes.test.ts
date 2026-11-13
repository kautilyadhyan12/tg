// The heart rate chart and the five heart rate zones (ROADMAP 37f-ii-a), against REAL Postgres.
// DATABASE_URL-gated. The first block is the job's worst thing on the server: a run's zones worked from
// somebody else's maximum, or a person's maximum read or changed by anybody else. Then the zones as they
// were on the day, the line kept with the run, and the maximum's own route.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { heartMaxResponseSchema, runDetailSchema, saveRunResponseSchema, type SaveRunRequest } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { HeightMap } from "../src/modules/geo/heights.adapter.js";
import { buildUserExport } from "../src/modules/privacy/export.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "run-zones-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
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
const nextIp = () => `10.41.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A run going north at 3 m/s, one point a second. */
function northRun(seconds: number): SaveRunRequest["points"] {
  const points: SaveRunRequest["points"] = [];
  for (let i = 0; i <= seconds; i++) points.push([i * 1000, 26.1445 + (i * 3) / 110_760, 91.7362, 5]);
  return points;
}
const beats = (fromS: number, toS: number, bpm: (s: number) => number): [number, number][] => {
  const out: [number, number][] = [];
  for (let s = fromS; s < toS; s++) out.push([s * 1000, bpm(s)]);
  return out;
};

/** Twenty minutes: ten at 120, ten at 175. */
const body = (over: Partial<SaveRunRequest> = {}): SaveRunRequest => ({
  runId: randomUUID(),
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  elapsedMs: 1_200_000,
  name: "Morning Run",
  effort: null,
  note: null,
  points: northRun(1200),
  pauses: [],
  heart: beats(0, 1200, (s) => (s < 600 ? 120 : 175)),
  ...over,
});

d("the heart rate chart and zones (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: "GET" | "POST" | "PUT"; url: string; body?: unknown; cookies?: Cookies; key?: string }) =>
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
  const save = async (cookies: Cookies, run: SaveRunRequest) => {
    const res = await inject({ method: "POST", url: "/v1/geo/runs", body: run, cookies, key: run.runId });
    expect(res.statusCode, res.body).toBe(201);
    return saveRunResponseSchema.parse(JSON.parse(res.body)).run;
  };
  const detail = async (cookies: Cookies, id: string) =>
    z.object({ run: runDetailSchema }).parse(JSON.parse((await inject({ method: "GET", url: `/v1/geo/runs/${id}`, cookies })).body)).run;
  const getMax = async (cookies: Cookies) => heartMaxResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/geo/heart-max", cookies })).body));
  const putMax = (cookies: Cookies, payload: unknown) => inject({ method: "PUT", url: "/v1/geo/heart-max", body: payload, cookies });

  const makeUser = async (name: string, age: number | null): Promise<{ cookies: Cookies; id: string }> => {
    const email = `runzones-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Zones Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    if (age !== null) await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${id}, ${age})`;
    return { cookies: cookieMap(login), id };
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'runzones-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_heart_max WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'runzones-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    // A height map with no heights: the climb is not this file's, and no save waits on the internet.
    const heights: HeightMap = { heightsAt: (places) => Promise.resolve(places.map(() => null)) };
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), geo: { heights } });
  });
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  }, 30_000);

  describe("the worst thing: zones from somebody else's maximum, or a maximum anybody else can read or change", () => {
    it("a run's zones are worked from the runner's own age, never another member's typed maximum", async () => {
      const runner = await makeUser("runner", 30);
      const stranger = await makeUser("stranger", 30);
      expect((await putMax(stranger.cookies, { own: 120 })).statusCode).toBe(200);
      const saved = await save(runner.cookies, body());
      // 30 years old: 190. Ten minutes at 120 is Light (114 to 132), ten at 175 is Maximum (171 and up).
      expect(saved.heartZones).toEqual({ max: 190, seconds: [0, 600, 0, 0, 600] });
      expect((await detail(runner.cookies, saved.id)).heartZones).toEqual({ max: 190, seconds: [0, 600, 0, 0, 600] });
    });

    it("another member's maximum is neither read nor changed: each person's route is their own", async () => {
      const me = await makeUser("own", 40);
      const other = await makeUser("other", 25);
      expect((await putMax(me.cookies, { own: 199 })).statusCode).toBe(200);
      expect(await getMax(other.cookies)).toEqual({ own: null, fromAge: 195, max: 195 });
      // The body names nobody; anything more is refused.
      const sneaky = await putMax(other.cookies, { own: 150, userId: me.id });
      expect(sneaky.statusCode).toBe(400);
      expect(await getMax(me.cookies)).toEqual({ own: 199, fromAge: 180, max: 199 });
      expect((await sql`SELECT bpm FROM user_heart_max WHERE user_id = ${me.id}`)[0]).toEqual({ bpm: 199 });
    });

    it("nobody signed in gets nothing, and can change nothing", async () => {
      expect((await inject({ method: "GET", url: "/v1/geo/heart-max" })).statusCode).toBe(401);
      expect((await putMax({}, { own: 180 })).statusCode).toBe(401);
    });
  });

  it("with no age and no maximum of their own, a run keeps its chart and has no zones", async () => {
    const me = await makeUser("noage", null);
    expect(await getMax(me.cookies)).toEqual({ own: null, fromAge: null, max: null });
    const saved = await save(me.cookies, body());
    expect(saved.heartZones).toBeNull();
    const page = await detail(me.cookies, saved.id);
    expect(page.heartZones).toBeNull();
    expect(page.heartLine.length).toBe(page.paceLine.length);
  });

  it("a typed maximum wins, and the zones stay as they were on the day after it changes", async () => {
    const me = await makeUser("typed", 30);
    const put = await putMax(me.cookies, { own: 200 });
    expect(put.statusCode).toBe(200);
    expect(heartMaxResponseSchema.parse(JSON.parse(put.body))).toEqual({ own: 200, fromAge: 190, max: 200 });
    // At 200: 120 is Light (120 to 139), 175 is Hard (160 to 179).
    const first = await save(me.cookies, body());
    expect(first.heartZones).toEqual({ max: 200, seconds: [0, 600, 0, 600, 0] });
    // Back to the age's: the run saved before keeps its zones; the next is worked from 190.
    expect(heartMaxResponseSchema.parse(JSON.parse((await putMax(me.cookies, { own: null })).body))).toEqual({ own: null, fromAge: 190, max: 190 });
    expect((await sql`SELECT 1 FROM user_heart_max WHERE user_id = ${me.id}`).length).toBe(0);
    expect((await detail(me.cookies, first.id)).heartZones).toEqual({ max: 200, seconds: [0, 600, 0, 600, 0] });
    expect((await save(me.cookies, body())).heartZones).toEqual({ max: 190, seconds: [0, 600, 0, 0, 600] });
  });

  it("refuses a maximum no heart reaches, or not a whole number, and keeps what was there", async () => {
    const me = await makeUser("refused", 30);
    expect((await putMax(me.cookies, { own: 185 })).statusCode).toBe(200);
    for (const payload of [{ own: 99 }, { own: 231 }, { own: 185.5 }, { own: "185" }, {}, null]) {
      expect((await putMax(me.cookies, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await getMax(me.cookies)).own).toBe(185);
  });

  it("the same maximum sent twice leaves one row", async () => {
    const me = await makeUser("twice", 30);
    expect((await putMax(me.cookies, { own: 188 })).statusCode).toBe(200);
    expect((await putMax(me.cookies, { own: 188 })).statusCode).toBe(200);
    expect(await sql`SELECT bpm FROM user_heart_max WHERE user_id = ${me.id}`).toEqual([{ bpm: 188 }]);
  });

  it("keeps the line under the pace chart from the readings, not the readings themselves", async () => {
    const me = await makeUser("line", 30);
    const saved = await save(me.cookies, body());
    const page = await detail(me.cookies, saved.id);
    expect(page.heartLine.length).toBe(page.paceLine.length);
    expect(page.heartLine[0]).toBe(120);
    expect(page.heartLine[page.heartLine.length - 1]).toBe(175);
    const row = await sql<{ splits: { heart?: number[] } }[]>`SELECT splits FROM runs WHERE id = ${saved.id}`;
    expect(row[0]?.splits.heart).toEqual(page.heartLine);
    // Twelve hundred readings sent; no more than the chart's places kept.
    expect(JSON.stringify(row[0]?.splits).length).toBeLessThan(6000);
  });

  it("a run with no heart rate has no line and no zones", async () => {
    const me = await makeUser("nostrap", 30);
    const saved = await save(me.cookies, body({ heart: [] }));
    expect(saved.heartZones).toBeNull();
    const page = await detail(me.cookies, saved.id);
    expect([page.heartLine, page.heartZones]).toEqual([[], null]);
  });

  it("the maximum and a run's zones are in the person's own download of their data", async () => {
    const me = await makeUser("export", 30);
    expect((await putMax(me.cookies, { own: 191 })).statusCode).toBe(200);
    await save(me.cookies, body());
    const out = JSON.stringify(await buildUserExport({ sql }, me.id));
    expect(out).toContain('"bpm":191');
    expect(out).toContain('"zones":{"max":191');
  }, 30_000);
});
