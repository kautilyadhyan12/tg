// The workout and meal reminders (ROADMAP Stage 5 item 19e-i), against real Postgres: the person's own
// routes, and the worker's run that sends what is due on each person's own clock. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a reminder reaching a phone after its owner
// switched it off, or reaching somebody else's phone. Those are first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { remindersResponseSchema, verifyCodePhoneResponseSchema, type PhoneSessionTokens, type ReminderKind } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { PushMessage, PushResult, PushSender } from "../src/modules/push/fcm.adapter.js";
import { sendTrainingReminders } from "../src/modules/reminders/sweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const TIMEOUT_MS = 60_000;
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "reminders-secret-0123456789abcdefghijk", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
interface Phone extends PhoneSessionTokens {
  userId: string;
  token: string;
}

let ipCounter = 0;
const nextIp = () => `10.53.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const email = (local: string) => `remind-t-${local}-${uniq()}@example.com`;
const address = (name: string) => `fcm-${name}-${uniq()}:APA91b${"x".repeat(60)}`;

/** Monday 2 November 2026 in India, at hh:mm (India is UTC+5:30, no clock change). */
const india = (hh: number, mm: number, dayOffset = 0): Date => new Date(Date.UTC(2026, 10, 2 + dayOffset, hh, mm) - 330 * 60_000);

d("the workout and meal reminders (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const codes: { email: string; code: string }[] = [];
  const emailSender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (to, code) => {
      codes.push({ email: to, code });
      return Promise.resolve();
    },
  };
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const people: string[] = [];
  const sent: PushMessage[] = [];
  const answers = new Map<string, PushResult>();
  /** Addresses whose next send throws, as a dropped connection would. */
  const throwOnce = new Set<string>();
  const sender: PushSender = {
    send: (message) => {
      if (throwOnce.delete(message.token)) return Promise.reject(new Error("connection dropped"));
      sent.push(message);
      return Promise.resolve(answers.get(message.token) ?? "sent");
    },
  };
  /** The moment the routes read "today" from; the real clock unless a test sets it. */
  let routesNow: Date | null = null;
  const sweep = (at: Date) => sendTrainingReminders({ sql, sender, now: () => at, userIds: people });
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  const cleanup = async () => {
    const mine = sql`SELECT id FROM users WHERE email LIKE 'remind-t-%@example.com'`;
    const gyms = sql`SELECT id FROM gyms WHERE owner_user_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gyms WHERE id IN (${gyms})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM training_reminders WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_health_screenings WHERE user_id IN (${mine})`;
    await sql`DELETE FROM push_tokens WHERE user_id IN (${mine})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'remind-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'remind-t-%@example.com'`;
  };

  const request = (method: "GET" | "PUT" | "POST", path: string, opts: { payload?: unknown; bearer?: string } = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      headers: {
        ...(opts.payload === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.bearer === undefined ? {} : { authorization: `Bearer ${opts.bearer}` }),
      },
      ...(opts.payload === undefined ? {} : { payload: JSON.stringify(opts.payload) }),
    });

  const codeFor = async (to: string): Promise<string> => {
    await sql`UPDATE sign_in_codes SET created_at = created_at - interval '2 days' WHERE email = ${to}`;
    const res = await request("POST", "/v1/auth/code/send", { payload: { email: to } });
    expect(res.statusCode).toBe(200);
    const hit = [...codes].reverse().find((c) => c.email === to);
    if (hit === undefined) throw new Error(`no code was sent to ${to}`);
    return hit.code;
  };
  /** Somebody signed in on a phone that gave its notification address, on `zone`'s clock. */
  const phone = async (name: string, zone: string | null = "Asia/Kolkata", to = email(name)): Promise<Phone> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to), client: "phone" } });
    expect(res.statusCode).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    await sql`UPDATE users SET timezone = ${zone} WHERE id = ${body.user.id}`;
    if (!people.includes(body.user.id)) people.push(body.user.id);
    const token = address(name);
    expect((await request("PUT", "/v1/push-tokens", { bearer: body.tokens.accessToken, payload: { token, platform: "android" } })).statusCode).toBe(200);
    return { ...body.tokens, userId: body.user.id, token };
  };
  const save = (who: { accessToken: string }, kind: string, body: unknown) => request("PUT", `/v1/users/me/reminders/${kind}`, { bearer: who.accessToken, payload: body });
  /** A reminder as it stands, written straight in, owed today (no day sent yet). */
  const set = async (who: Phone, kind: ReminderKind, time: string, days = 127) => {
    const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    await sql`
      INSERT INTO training_reminders (user_id, kind, is_on, minute, days)
      VALUES (${who.userId}, ${kind}, true, ${minute}, ${days})
      ON CONFLICT (user_id, kind) DO UPDATE SET is_on = true, minute = ${minute}, days = ${days}, sent_day = NULL, paused_at = NULL`;
  };
  const read = async (who: { accessToken: string }) => {
    const res = await request("GET", "/v1/users/me/reminders", { bearer: who.accessToken });
    expect(res.statusCode, res.body).toBe(200);
    return remindersResponseSchema.parse(JSON.parse(res.body)).reminders;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis(), emailSender, reminders: { now: () => routesNow ?? new Date() } });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  // ── The worst thing first ──

  it("a reminder switched off reaches nobody, and one person's reminder never reaches another's phone", async () => {
    const asha = await phone("asha");
    const ravi = await phone("ravi");
    await set(asha, "workout", "18:30");
    await set(ravi, "workout", "18:30");
    // Asha switches hers off in Settings.
    const off = await save(asha, "workout", { on: false, time: "18:30", days: [1, 2, 3, 4, 5, 6, 7] });
    expect(off.statusCode, off.body).toBe(200);
    // Owed today as far as the day goes: only the switch may keep it from her phone.
    await sql`UPDATE training_reminders SET sent_day = NULL WHERE user_id = ${asha.userId}`;
    sent.length = 0;
    await sweep(india(18, 30));
    expect(sentTo(asha.token)).toEqual([]);
    expect(sentTo(ravi.token)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  }, TIMEOUT_MS);

  it("after a sign-out, and with somebody else signed in on that phone, the reminder goes nowhere", async () => {
    const meera = await phone("meera");
    await set(meera, "lunch", "13:00");
    expect((await request("POST", "/v1/auth/logout", { payload: { refreshToken: meera.refreshToken } })).statusCode).toBe(200);
    sent.length = 0;
    await sweep(india(13, 0));
    expect(sentTo(meera.token)).toEqual([]);
    // Somebody else signs in on Meera's phone, which gives the same address: hers are still not theirs.
    const kabir = await phone("kabir");
    const res = await request("PUT", "/v1/push-tokens", { bearer: kabir.accessToken, payload: { token: meera.token, platform: "android" } });
    expect(res.statusCode).toBe(200);
    await sql`UPDATE training_reminders SET sent_day = NULL WHERE user_id = ${meera.userId}`;
    await sweep(india(13, 1));
    expect(sentTo(meera.token)).toEqual([]);
    // A phone sign-in that ran out keeps its address on the server, and is told nothing.
    const ranOut = await phone("ranout");
    await set(ranOut, "lunch", "13:00");
    await sql`UPDATE refresh_tokens SET expires_at = ${india(9, 0, -1)} WHERE user_id = ${ranOut.userId}`;
    expect((await sql`SELECT 1 FROM push_tokens WHERE token = ${ranOut.token}`).length).toBe(1);
    await sweep(india(13, 0));
    expect(sentTo(ranOut.token)).toEqual([]);
  }, TIMEOUT_MS);

  // ── The routes ──

  it("reads all four, off at the start; saves one whole; refuses what is not a reminder; and needs a sign-in", async () => {
    const neha = await phone("neha");
    const start = await read(neha);
    expect(start.map((r) => [r.kind, r.on, r.time, r.paused])).toEqual([
      ["workout", false, "18:00", false],
      ["breakfast", false, "08:00", false],
      ["lunch", false, "13:00", false],
      ["dinner", false, "19:30", false],
    ]);
    const saved = await save(neha, "workout", { on: true, time: "06:45", days: [1, 3, 5] });
    expect(saved.statusCode, saved.body).toBe(200);
    const after = remindersResponseSchema.parse(JSON.parse(saved.body)).reminders[0];
    expect(after).toEqual({ kind: "workout", on: true, time: "06:45", days: [1, 3, 5], paused: false });
    // A meal's days are every day, whatever is sent.
    await save(neha, "lunch", { on: true, time: "12:30", days: [2] });
    expect((await read(neha))[2]?.days).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const [kind, body] of [
      ["workout", { on: true, time: "18:31", days: [1] }],
      ["workout", { on: true, time: "24:00", days: [1] }],
      ["workout", { on: true, time: "18:30", days: [] }],
      ["workout", { on: true, time: "18:30", days: [8] }],
      ["workout", { on: true, time: "18:30", days: [1, 1] }],
      ["workout", { on: true, time: "18:30", days: [1], extra: 1 }],
      ["snack", { on: true, time: "18:30", days: [1] }],
    ] as const) {
      expect((await save(neha, kind, body)).statusCode).toBe(400);
    }
    expect((await request("GET", "/v1/users/me/reminders")).statusCode).toBe(401);
    expect((await request("PUT", "/v1/users/me/reminders/workout", { payload: { on: true, time: "18:30", days: [1] } })).statusCode).toBe(401);
  }, TIMEOUT_MS);

  it("a stranger reads only their own, and their save changes nobody else's", async () => {
    const owner = await phone("owner");
    const stranger = await phone("stranger");
    await save(owner, "dinner", { on: true, time: "20:00", days: [1, 2, 3, 4, 5, 6, 7] });
    expect((await read(stranger)).every((r) => !r.on)).toBe(true);
    await save(stranger, "dinner", { on: false, time: "21:00", days: [1, 2, 3, 4, 5, 6, 7] });
    expect((await read(owner))[3]).toMatchObject({ on: true, time: "20:00" });
  }, TIMEOUT_MS);

  // ── When it goes ──

  it("goes on the person's own clock, only on their days, at most once a day", async () => {
    const tara = await phone("tara");
    await set(tara, "workout", "18:30", 1 | 4 | 16); // Mon, Wed, Fri
    sent.length = 0;
    await sweep(india(18, 29));
    expect(sentTo(tara.token)).toEqual([]);
    await sweep(india(18, 30));
    expect(sentTo(tara.token).map((m) => [m.title, m.body, m.data])).toEqual([["Time to train", "It's time for your workout.", { kind: "training_reminder", open: "workout" }]]);
    await sweep(india(18, 31));
    await sweep(india(18, 45));
    expect(sentTo(tara.token)).toHaveLength(1);
    // Tuesday is not one of her days; Wednesday is.
    await sweep(india(18, 30, 1));
    expect(sentTo(tara.token)).toHaveLength(1);
    await sweep(india(18, 30, 2));
    expect(sentTo(tara.token)).toHaveLength(2);
  }, TIMEOUT_MS);

  it("New York's 8:00 is 8:00 on both sides of the clock change, and a late run does not send it late", async () => {
    const sam = await phone("sam", "America/New_York");
    await set(sam, "breakfast", "08:00");
    sent.length = 0;
    // Saturday 31 October: New York is UTC-4; Sunday 1 November, after the change, UTC-5.
    await sweep(new Date(Date.UTC(2026, 9, 31, 12, 0)));
    expect(sentTo(sam.token).map((m) => m.title)).toEqual(["Breakfast"]);
    await sweep(new Date(Date.UTC(2026, 10, 1, 12, 0))); // 07:00 in New York now
    expect(sentTo(sam.token)).toHaveLength(1);
    await sweep(new Date(Date.UTC(2026, 10, 1, 13, 0))); // 08:00
    expect(sentTo(sam.token)).toHaveLength(2);
    // Monday the worker was down until 08:40: too late, nothing is sent that day.
    await sweep(new Date(Date.UTC(2026, 10, 2, 13, 40)));
    expect(sentTo(sam.token)).toHaveLength(2);
  }, TIMEOUT_MS);

  it("a zone that is not a real one is read as UTC, and breaks nobody else's run", async () => {
    const odd = await phone("odd", "+05:30");
    const ok = await phone("ok");
    await set(odd, "lunch", "13:00");
    await set(ok, "lunch", "13:00");
    sent.length = 0;
    await sweep(new Date(Date.UTC(2026, 10, 2, 13, 0)));
    expect(sentTo(odd.token)).toHaveLength(1);
    await sweep(india(13, 0));
    expect(sentTo(ok.token)).toHaveLength(1);
  }, TIMEOUT_MS);

  it("is skipped on a day already done: a workout, a visit, or that meal logged (a meal with no kind counts by its hour)", async () => {
    const gymOwner = await phone("gymowner");
    const gymRes = await api().inject({
      method: "POST",
      url: "/v1/orgs",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", authorization: `Bearer ${gymOwner.accessToken}` },
      payload: JSON.stringify({ trainsHere: false, name: "Iron House", city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" }),
    });
    expect(gymRes.statusCode, gymRes.body).toBe(201);
    const gymId = (JSON.parse(gymRes.body) as { org: { id: string } }).org.id;

    const worked = await phone("worked");
    const visited = await phone("visited");
    const ate = await phone("ate");
    const lunchNoKind = await phone("lunchnokind");
    for (const who of [worked, visited]) await set(who, "workout", "18:30");
    await set(ate, "dinner", "19:30");
    await set(lunchNoKind, "lunch", "13:00");
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version)
      VALUES (${randomUUID()}, ${worked.userId}, ${india(7, 0)}, 'android', 'test')`;
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
      VALUES (${gymId}, ${visited.userId}, ${visited.userId}, '2026-11-02', 'manual', 'hours_unset', 'hours_unset')`;
    const meal = (who: Phone, type: string | null, at: Date) => sql`
      INSERT INTO meal_logs (user_id, taken_at, meal_type, items, kcal_point, kcal_low, kcal_high, portion_source, nutrition_sources, calc_version)
      VALUES (${who.userId}, ${at}, ${type}, '[]'::jsonb, 500, 400, 600, 'default', '{usda}', 1)`;
    await meal(ate, "dinner", india(19, 10));
    await meal(lunchNoKind, null, india(12, 40));
    // A workout yesterday does not count for today.
    const yesterday = await phone("yesterday");
    await set(yesterday, "workout", "18:30");
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version)
      VALUES (${randomUUID()}, ${yesterday.userId}, ${india(18, 0, -1)}, 'android', 'test')`;
    sent.length = 0;
    await sweep(india(13, 0));
    await sweep(india(18, 30));
    await sweep(india(19, 30));
    expect(sentTo(worked.token)).toEqual([]);
    expect(sentTo(visited.token)).toEqual([]);
    expect(sentTo(ate.token)).toEqual([]);
    expect(sentTo(lunchNoKind.token)).toEqual([]);
    expect(sentTo(yesterday.token)).toHaveLength(1);
  }, TIMEOUT_MS);

  it("two due within the hour arrive as one, and the second is not sent again at its own time", async () => {
    const dev = await phone("dev");
    await set(dev, "workout", "18:30");
    await set(dev, "dinner", "19:00");
    sent.length = 0;
    await sweep(india(18, 30));
    expect(sentTo(dev.token).map((m) => [m.title, m.body])).toEqual([["Time to train", "Your workout, then log your dinner."]]);
    await sweep(india(19, 0));
    expect(sentTo(dev.token)).toHaveLength(1);
  }, TIMEOUT_MS);

  it("not opened for a week: nothing goes, it reads paused, and turning it on again ends the pause", async () => {
    const gone = await phone("gone");
    await set(gone, "workout", "18:30");
    await sql`UPDATE users SET last_active_at = ${india(9, 0, -8)}, created_at = ${india(9, 0, -30)} WHERE id = ${gone.userId}`;
    sent.length = 0;
    await sweep(india(18, 30));
    expect(sentTo(gone.token)).toEqual([]);
    expect((await read(gone))[0]).toMatchObject({ on: true, paused: true });
    await sweep(india(18, 30, 2));
    expect(sentTo(gone.token)).toEqual([]);
    const on = await save(gone, "workout", { on: true, time: "18:30", days: [1, 2, 3, 4, 5, 6, 7] });
    expect(remindersResponseSchema.parse(JSON.parse(on.body)).reminders[0]?.paused).toBe(false);
  }, TIMEOUT_MS);

  it("two runs at the same instant send it once; a run Firebase did not answer leaves it owed for the next minute", async () => {
    const twin = await phone("twin");
    await set(twin, "lunch", "13:00");
    sent.length = 0;
    await Promise.all([sweep(india(13, 0)), sweep(india(13, 0)), sweep(india(13, 0))]);
    expect(sentTo(twin.token)).toHaveLength(1);

    const flaky = await phone("flaky");
    await set(flaky, "lunch", "13:00");
    answers.set(flaky.token, "failed");
    await sweep(india(13, 0));
    answers.delete(flaky.token);
    await sweep(india(13, 1));
    expect(sentTo(flaky.token)).toHaveLength(2);
    await sweep(india(13, 2));
    expect(sentTo(flaky.token)).toHaveLength(2);
  }, TIMEOUT_MS);

  it("saved at a time already past today, it waits for tomorrow; a time still to come goes today", async () => {
    const late = await phone("late");
    routesNow = india(9, 0);
    try {
      expect((await save(late, "breakfast", { on: true, time: "08:00", days: [1, 2, 3, 4, 5, 6, 7] })).statusCode).toBe(200);
      expect((await save(late, "lunch", { on: true, time: "13:00", days: [1, 2, 3, 4, 5, 6, 7] })).statusCode).toBe(200);
    } finally {
      routesNow = null;
    }
    sent.length = 0;
    await sweep(india(9, 1));
    await sweep(india(13, 0));
    expect(sentTo(late.token).map((m) => m.title)).toEqual(["Lunch"]);
    await sweep(india(8, 0, 1));
    expect(sentTo(late.token).map((m) => m.title)).toEqual(["Lunch", "Breakfast"]);
  }, TIMEOUT_MS);

  // ── Round one (reviews/19e-i-2-findings.md) ──

  it("the one due now already done: nothing goes early, and the later one goes at its own time (H1)", async () => {
    const trained = await phone("trainedearly");
    await set(trained, "workout", "18:30");
    await set(trained, "dinner", "19:30");
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version)
      VALUES (${randomUUID()}, ${trained.userId}, ${india(7, 0)}, 'android', 'test')`;
    const lunched = await phone("lunchedearly");
    await set(lunched, "lunch", "13:00");
    await set(lunched, "workout", "13:45");
    await sql`
      INSERT INTO meal_logs (user_id, taken_at, meal_type, items, kcal_point, kcal_low, kcal_high, portion_source, nutrition_sources, calc_version)
      VALUES (${lunched.userId}, ${india(12, 40)}, 'lunch', '[]'::jsonb, 500, 400, 600, 'default', '{usda}', 1)`;
    sent.length = 0;
    await sweep(india(13, 0));
    await sweep(india(18, 30));
    expect(sentTo(trained.token)).toEqual([]);
    expect(sentTo(lunched.token)).toEqual([]);
    await sweep(india(13, 45));
    await sweep(india(19, 30));
    expect(sentTo(lunched.token).map((m) => [m.title, m.body])).toEqual([["Time to train", "It's time for your workout."]]);
    expect(sentTo(trained.token).map((m) => [m.title, m.body])).toEqual([["Dinner", "Log what you ate."]]);
  }, TIMEOUT_MS);

  it("Safe mode: no workout reminder, the meals still go, and the list says Safe mode (H3)", async () => {
    const safe = await phone("safemode");
    await sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${safe.userId}, true, 'not_yet')`;
    await set(safe, "workout", "18:30");
    await set(safe, "dinner", "19:00");
    sent.length = 0;
    await sweep(india(18, 30));
    await sweep(india(19, 0));
    expect(sentTo(safe.token).map((m) => m.title)).toEqual(["Dinner"]);
    const res = await request("GET", "/v1/users/me/reminders", { bearer: safe.accessToken });
    const body = remindersResponseSchema.parse(JSON.parse(res.body));
    expect(body.safeMode).toBe(true);
    expect(body.reminders[0]).toMatchObject({ kind: "workout", on: true });
    // Cleared by a professional: the workout reminder goes again.
    await sql`UPDATE user_health_screenings SET check_first = 'cleared' WHERE user_id = ${safe.userId}`;
    await sweep(india(18, 30, 2));
    expect(sentTo(safe.token).map((m) => m.title)).toEqual(["Dinner", "Time to train"]);
    expect(remindersResponseSchema.parse(JSON.parse((await request("GET", "/v1/users/me/reminders", { bearer: safe.accessToken })).body)).safeMode).toBe(false);
  }, TIMEOUT_MS);

  it("a send that throws is owed again on the next run, and goes once", async () => {
    const dropped = await phone("dropped");
    await set(dropped, "lunch", "13:00");
    throwOnce.add(dropped.token);
    sent.length = 0;
    await sweep(india(13, 0));
    expect(sentTo(dropped.token)).toEqual([]);
    await sweep(india(13, 1));
    await sweep(india(13, 2));
    expect(sentTo(dropped.token)).toHaveLength(1);
  }, TIMEOUT_MS);
});
