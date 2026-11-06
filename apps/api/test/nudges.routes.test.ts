// The streak reminder, badges and the Sunday summary (ROADMAP Stage 5 item 19e-ii), against real Postgres:
// the worker's run that sends them on each person's own clock, and the three switches on the account.
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: somebody in Safe mode told to go and train, or one
// person's streak and numbers on another person's phone. Those are first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { userProfileResponseSchema, verifyCodePhoneResponseSchema, type PhoneSessionTokens } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { PushMessage, PushResult, PushSender } from "../src/modules/push/fcm.adapter.js";
import { sendTrainingNudges } from "../src/modules/reminders/nudges.js";
import { sendTrainingReminders } from "../src/modules/reminders/sweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const TIMEOUT_MS = 60_000;
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "nudges-secret-0123456789abcdefghijklmn", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
interface Phone extends PhoneSessionTokens {
  userId: string;
  token: string;
}

let ipCounter = 0;
const nextIp = () => `10.54.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const email = (local: string) => `nudge-t-${local}-${uniq()}@example.com`;
const address = (name: string) => `fcm-${name}-${uniq()}:APA91b${"x".repeat(60)}`;

/** Monday 2 November 2026 in India, at hh:mm, `day` days on (6 is Sunday 8 November). India is UTC+5:30
 *  with no clock change. */
const india = (hh: number, mm: number, day = 0): Date => new Date(Date.UTC(2026, 10, 2 + day, hh, mm) - 330 * 60_000);
const TUE = 1;
const SUN = 6;
const dayText = (day: number): string => `2026-11-${String(2 + day).padStart(2, "0")}`;

d("the streak reminder, badges and the Sunday summary (real Postgres)", () => {
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
  const throwOnce = new Set<string>();
  const sender: PushSender = {
    send: (message) => {
      if (throwOnce.delete(message.token)) return Promise.reject(new Error("connection dropped"));
      sent.push(message);
      return Promise.resolve(answers.get(message.token) ?? "sent");
    },
  };
  const sweep = (at: Date) => sendTrainingNudges({ sql, sender, now: () => at, userIds: people });
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  const cleanup = async () => {
    const mine = sql`SELECT id FROM users WHERE email LIKE 'nudge-t-%@example.com'`;
    const gyms = sql`SELECT id FROM gyms WHERE owner_user_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gyms WHERE id IN (${gyms})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM training_reminders WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_health_screenings WHERE user_id IN (${mine})`;
    await sql`DELETE FROM push_tokens WHERE user_id IN (${mine})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'nudge-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'nudge-t-%@example.com'`;
  };

  const request = (method: "GET" | "PUT" | "POST" | "PATCH", path: string, opts: { payload?: unknown; bearer?: string } = {}) =>
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
  /** Somebody signed in on a phone that gave its notification address, on India's clock, who last opened the
   *  app at `opened`. */
  const phone = async (name: string, opened: Date): Promise<Phone> => {
    const to = email(name);
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to), client: "phone" } });
    expect(res.statusCode).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    await sql`UPDATE users SET timezone = 'Asia/Kolkata', last_active_at = ${opened}, created_at = ${new Date(opened.getTime() - 30 * 86_400_000)} WHERE id = ${body.user.id}`;
    if (!people.includes(body.user.id)) people.push(body.user.id);
    const token = address(name);
    expect((await request("PUT", "/v1/push-tokens", { bearer: body.tokens.accessToken, payload: { token, platform: "android" } })).statusCode).toBe(200);
    return { ...body.tokens, userId: body.user.id, token };
  };
  /** A streak of `days` that last counted on `last` (a day number), with `freezes` saved. */
  const streak = (who: Phone, days: number, last: number, freezes = 0) => sql`
    INSERT INTO streaks (user_id, current, longest, last_activity_date, freezes_available)
    VALUES (${who.userId}, ${days}, ${days}, ${dayText(last)}::date, ${freezes})
    ON CONFLICT (user_id) DO UPDATE SET current = EXCLUDED.current, longest = EXCLUDED.longest,
      last_activity_date = EXCLUDED.last_activity_date, freezes_available = EXCLUDED.freezes_available`;
  const badge = (who: Phone, code: string, at: Date) => sql`
    INSERT INTO user_achievements (user_id, code, earned_at) VALUES (${who.userId}, ${code}, ${at})`;
  const workout = (who: Phone, at: Date) => sql`
    INSERT INTO workouts (id, user_id, started_at, platform, engine_version) VALUES (${randomUUID()}, ${who.userId}, ${at}, 'android', 'test')`;
  const safeMode = (who: Phone) => sql`
    INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${who.userId}, true, 'not_yet')`;

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis(), emailSender });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  // ── The worst thing first ──

  it("somebody in Safe mode is never told to train; each phone gets only its own person's streak", async () => {
    const safe = await phone("safe", india(9, 0, TUE));
    const asha = await phone("asha", india(9, 0, TUE));
    const ravi = await phone("ravi", india(9, 0, TUE));
    await safeMode(safe);
    await streak(safe, 5, 0);
    await streak(asha, 4, 0);
    await streak(ravi, 9, 0);
    sent.length = 0;
    await sweep(india(19, 0, TUE));
    expect(sentTo(safe.token)).toEqual([]);
    expect(sentTo(asha.token).map((m) => [m.userId, m.body])).toEqual([[asha.userId, "Your 4-day streak ends at midnight. Even a short run counts."]]);
    expect(sentTo(ravi.token).map((m) => [m.userId, m.body])).toEqual([[ravi.userId, "Your 9-day streak ends at midnight. Even a short run counts."]]);
    expect(sent).toHaveLength(2);
    // Safe mode's summary still goes, and says only what was done: never a push to train.
    await workout(safe, india(10, 0, TUE));
    sent.length = 0;
    await sweep(india(18, 0, SUN));
    expect(sentTo(safe.token).map((m) => m.body)).toEqual(["This week: 1 workout."]);
  }, TIMEOUT_MS);

  it("two people's new badges at the same minute: each phone names only its own person's", async () => {
    const neha = await phone("nehabadge", india(9, 0, TUE));
    const omar = await phone("omarbadge", india(9, 0, TUE));
    await badge(neha, "ten_workouts", india(9, 30, TUE));
    await badge(omar, "night_owl", india(9, 30, TUE));
    // Omar's notifications wait behind another one, so the run reaches Neha with Omar's badge still untold.
    await sql`UPDATE users SET recent_pushes = ${sql.array([india(9, 45, TUE)])}::timestamptz[] WHERE id = ${omar.userId}`;
    sent.length = 0;
    await sweep(india(10, 0, TUE));
    expect(sentTo(neha.token).map((m) => [m.userId, m.body])).toEqual([[neha.userId, "You earned 10 Workouts."]]);
    expect(sentTo(omar.token)).toEqual([]);
    await sweep(india(11, 45, TUE));
    expect(sentTo(omar.token).map((m) => [m.userId, m.body])).toEqual([[omar.userId, "You earned Night Owl."]]);
  }, TIMEOUT_MS);

  it("after a sign-out, and with somebody else signed in on that phone, nothing goes to it", async () => {
    const meera = await phone("meera", india(9, 0, TUE));
    await streak(meera, 6, 0);
    expect((await request("POST", "/v1/auth/logout", { payload: { refreshToken: meera.refreshToken } })).statusCode).toBe(200);
    const kabir = await phone("kabir", india(9, 0, TUE));
    expect((await request("PUT", "/v1/push-tokens", { bearer: kabir.accessToken, payload: { token: meera.token, platform: "android" } })).statusCode).toBe(200);
    sent.length = 0;
    await sweep(india(19, 0, TUE));
    // Kabir has no streak: Meera's 6 days reach nobody, on her old address or anywhere.
    expect(sent.filter((m) => m.userId === meera.userId || m.body.includes("6-day"))).toEqual([]);
  }, TIMEOUT_MS);

  // ── The streak reminder ──

  it("goes at 7 pm on a day with nothing done yet, once; not for a short streak, a day already done, or after 5 pm in the app", async () => {
    const due = await phone("due", india(9, 0, TUE));
    const short = await phone("short", india(9, 0, TUE));
    const trained = await phone("trained", india(9, 0, TUE));
    const looked = await phone("looked", india(17, 30, TUE));
    const freeze = await phone("freeze", india(9, 0, TUE));
    await streak(due, 3, 0);
    await streak(short, 2, 0);
    await streak(trained, 8, 0);
    await workout(trained, india(7, 0, TUE));
    await streak(looked, 8, 0);
    await streak(freeze, 12, 0, 1);
    sent.length = 0;
    await sweep(india(18, 59, TUE));
    expect(sent).toEqual([]);
    await sweep(india(19, 0, TUE));
    expect(sentTo(due.token).map((m) => [m.title, m.body, m.data])).toEqual([
      ["Keep your streak going", "Your 3-day streak ends at midnight. Even a short run counts.", { kind: "training_nudge", open: "running" }],
    ]);
    expect(sentTo(freeze.token).map((m) => m.body)).toEqual(["Nothing done yet today. A freeze will keep your 12-day streak safe, but a short run keeps it going."]);
    for (const who of [short, trained, looked]) expect(sentTo(who.token)).toEqual([]);
    // Once a day: the next minutes send nothing again.
    await sweep(india(19, 1, TUE));
    await sweep(india(19, 29, TUE));
    expect(sentTo(due.token)).toHaveLength(1);
    // A visit keeps a streak too: the reminder is not sent after one.
    const visitor = await phone("visitor", india(9, 0, TUE));
    await streak(visitor, 5, 0);
    const owner = await phone("owner", india(9, 0, TUE));
    const gymRes = await request("POST", "/v1/orgs", { bearer: owner.accessToken, payload: { trainsHere: false, name: "Iron House", city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" } });
    expect(gymRes.statusCode, gymRes.body).toBe(201);
    const gymId = (JSON.parse(gymRes.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
      VALUES (${gymId}, ${visitor.userId}, ${visitor.userId}, ${dayText(TUE)}::date, 'manual', 'hours_unset', 'hours_unset')`;
    await sweep(india(19, 2, TUE));
    expect(sentTo(visitor.token)).toEqual([]);
  }, TIMEOUT_MS);

  it("its switch off sends none; somebody who has not opened the app for a week gets none", async () => {
    const off = await phone("off", india(9, 0, TUE));
    const away = await phone("away", india(9, 0, TUE - 8));
    await streak(off, 5, 0);
    await streak(away, 5, 0);
    const res = await request("PATCH", "/v1/users/me", { bearer: off.accessToken, payload: { pushStreak: false } });
    expect(res.statusCode, res.body).toBe(200);
    expect(userProfileResponseSchema.parse(JSON.parse(res.body)).user.pushStreak).toBe(false);
    await sql`UPDATE users SET last_active_at = ${india(9, 0, TUE)} WHERE id = ${off.userId}`;
    sent.length = 0;
    await sweep(india(19, 0, TUE));
    expect(sentTo(off.token)).toEqual([]);
    expect(sentTo(away.token)).toEqual([]);
  }, TIMEOUT_MS);

  // ── Giving way to the other notifications ──

  it("waits 2 hours after any other notification, and sends none on a day 3 have reached the phone", async () => {
    const recent = await phone("recent", india(9, 0, TUE));
    const busy = await phone("busy", india(9, 0, TUE));
    await streak(recent, 5, 0);
    await streak(busy, 5, 0);
    await sql`UPDATE users SET recent_pushes = ${sql.array([india(17, 5, TUE)])}::timestamptz[] WHERE id = ${recent.userId}`;
    await sql`UPDATE users SET recent_pushes = ${sql.array([india(16, 0, TUE), india(12, 0, TUE), india(8, 0, TUE)])}::timestamptz[] WHERE id = ${busy.userId}`;
    sent.length = 0;
    await sweep(india(19, 0, TUE));
    expect(sentTo(recent.token)).toEqual([]);
    expect(sentTo(busy.token)).toEqual([]);
    // Two hours after the other one, still within its half hour: it goes. The busy day stays quiet.
    await sweep(india(19, 5, TUE));
    expect(sentTo(recent.token)).toHaveLength(1);
    await sweep(india(19, 20, TUE));
    expect(sentTo(busy.token)).toEqual([]);
    // Three from yesterday do not count today.
    await sweep(india(19, 0, TUE + 1));
    expect(sentTo(busy.token)).toEqual([]);
    await sql`UPDATE streaks SET last_activity_date = ${dayText(TUE)}::date WHERE user_id = ${busy.userId}`;
    await sweep(india(19, 1, TUE + 1));
    expect(sentTo(busy.token)).toHaveLength(1);
  }, TIMEOUT_MS);

  it("a workout reminder that reaches the phone is kept, and the streak reminder waits behind it", async () => {
    const both = await phone("both", india(9, 0, TUE));
    await streak(both, 5, 0);
    await sql`INSERT INTO training_reminders (user_id, kind, is_on, minute) VALUES (${both.userId}, 'workout', true, ${18 * 60 + 30})`;
    sent.length = 0;
    await sendTrainingReminders({ sql, sender, now: () => india(18, 30, TUE), userIds: people });
    expect(sentTo(both.token).map((m) => m.title)).toEqual(["Time to train"]);
    const [row] = await sql<{ recent_pushes: Date[] }[]>`SELECT recent_pushes FROM users WHERE id = ${both.userId}`;
    expect(row?.recent_pushes.map((at) => at.toISOString())).toEqual([india(18, 30, TUE).toISOString()]);
    await sweep(india(19, 0, TUE));
    expect(sentTo(both.token)).toHaveLength(1);
  }, TIMEOUT_MS);

  // ── Badges ──

  it("a new badge is told by day, once, several together; one earned at night waits for 8 am", async () => {
    const day = await phone("badgeday", india(9, 0, TUE));
    const night = await phone("badgenight", india(9, 0, TUE));
    await badge(day, "first_workout", india(10, 0, TUE));
    await badge(day, "first_meal", india(10, 5, TUE));
    sent.length = 0;
    await sweep(india(10, 10, TUE));
    expect(sentTo(day.token).map((m) => [m.title, m.body, m.data])).toEqual([
      ["2 new badges", "You earned First Workout and First Meal Logged.", { kind: "training_nudge", open: "achievements" }],
    ]);
    await sweep(india(15, 0, TUE));
    await sweep(india(12, 0, TUE + 1));
    expect(sentTo(day.token)).toHaveLength(1);
    await badge(night, "streak_7", india(22, 0, TUE));
    await sweep(india(22, 1, TUE));
    await sweep(india(7, 59, TUE + 1));
    expect(sentTo(night.token)).toEqual([]);
    await sweep(india(8, 0, TUE + 1));
    expect(sentTo(night.token).map((m) => m.body)).toEqual(["You earned 7-Day Streak."]);
  }, TIMEOUT_MS);

  it("badges switched off are never told, even once switched on again; a badge a week old is not told", async () => {
    const off = await phone("badgeoff", india(9, 0, TUE));
    const old = await phone("badgeold", india(9, 0, TUE));
    await badge(off, "ten_workouts", india(9, 30, TUE));
    expect((await request("PATCH", "/v1/users/me", { bearer: off.accessToken, payload: { pushBadges: false } })).statusCode).toBe(200);
    expect((await request("PATCH", "/v1/users/me", { bearer: off.accessToken, payload: { pushBadges: true } })).statusCode).toBe(200);
    await sql`UPDATE users SET last_active_at = ${india(9, 0, TUE)} WHERE id = ${off.userId}`;
    await badge(old, "night_owl", india(9, 0, TUE - 8));
    sent.length = 0;
    await sweep(india(11, 0, TUE));
    expect(sentTo(off.token)).toEqual([]);
    expect(sentTo(old.token)).toEqual([]);
  }, TIMEOUT_MS);

  it("a failed send gives the day and the badge back, so the next run tells it", async () => {
    const flaky = await phone("flaky", india(9, 0, TUE));
    await badge(flaky, "early_bird", india(9, 30, TUE));
    throwOnce.add(flaky.token);
    sent.length = 0;
    await sweep(india(10, 0, TUE));
    expect(sentTo(flaky.token)).toEqual([]);
    await sweep(india(10, 1, TUE));
    expect(sentTo(flaky.token).map((m) => m.body)).toEqual(["You earned Early Bird."]);
  }, TIMEOUT_MS);

  // ── The Sunday summary ──

  it("Sunday at 6 pm: the week's numbers, beside last week's only when more, with the week's new badge; the streak reminder gives way", async () => {
    const sum = await phone("summary", india(9, 0, SUN));
    for (const day of [0, 2, 4]) await workout(sum, india(7, 0, day));
    await workout(sum, india(7, 0, -3));
    await streak(sum, 5, SUN - 1);
    await badge(sum, "streak_3", india(9, 0, SUN));
    sent.length = 0;
    // The badge earned this Sunday waits for the summary.
    await sweep(india(10, 0, SUN));
    expect(sentTo(sum.token)).toEqual([]);
    await sweep(india(18, 0, SUN));
    expect(sentTo(sum.token).map((m) => [m.title, m.body, m.data])).toEqual([
      [
        "Your week",
        "This week: 3 workouts. That’s 2 workouts more than last week. Your streak: 5 days. New badge: 3-Day Streak.",
        { kind: "training_nudge", open: "dashboard" },
      ],
    ]);
    // Its streak reminder at 7 pm does not go: one a day.
    await sweep(india(19, 0, SUN));
    expect(sentTo(sum.token)).toHaveLength(1);
    const [told] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_achievements WHERE user_id = ${sum.userId} AND told_at IS NULL`;
    expect(told?.n).toBe(0);
  }, TIMEOUT_MS);

  it("no summary for a week with nothing done, even after a busy one: it never tells somebody of a fall", async () => {
    const idle = await phone("idle", india(9, 0, SUN));
    const quiet = await phone("quiet", india(9, 0, SUN));
    await workout(quiet, india(7, 0, -4));
    await workout(quiet, india(7, 0, -2));
    sent.length = 0;
    await sweep(india(18, 0, SUN));
    expect(sentTo(idle.token)).toEqual([]);
    expect(sentTo(quiet.token)).toEqual([]);
    const rows = await sql<{ summary_week: string | null }[]>`SELECT summary_week::text FROM users WHERE id IN ${sql([idle.userId, quiet.userId])}`;
    expect(rows.map((r) => r.summary_week)).toEqual([dayText(0), dayText(0)]);
  }, TIMEOUT_MS);

  // ── Round one's findings ──

  it("a badge earned while Badges was off is never told once it is on again (H1)", async () => {
    const back = await phone("badgeback", india(9, 0, TUE));
    expect((await request("PATCH", "/v1/users/me", { bearer: back.accessToken, payload: { pushBadges: false } })).statusCode).toBe(200);
    await badge(back, "ten_workouts", india(9, 30, TUE));
    expect((await request("PATCH", "/v1/users/me", { bearer: back.accessToken, payload: { pushBadges: true } })).statusCode).toBe(200);
    await sql`UPDATE users SET last_active_at = ${india(9, 0, TUE)} WHERE id = ${back.userId}`;
    sent.length = 0;
    await sweep(india(11, 0, TUE));
    await sweep(india(12, 0, TUE + 1));
    expect(sentTo(back.token)).toEqual([]);
    // Saving Badges on while it is already on takes nothing from a badge still owed.
    await badge(back, "early_bird", india(13, 0, TUE + 1));
    expect((await request("PATCH", "/v1/users/me", { bearer: back.accessToken, payload: { pushBadges: true } })).statusCode).toBe(200);
    await sql`UPDATE users SET last_active_at = ${india(9, 0, TUE + 1)} WHERE id = ${back.userId}`;
    await sweep(india(14, 0, TUE + 2));
    expect(sentTo(back.token).map((m) => m.body)).toEqual(["You earned Early Bird."]);
  }, TIMEOUT_MS);

  it("with Badges off, the Sunday summary names no badge (H2)", async () => {
    const quietBadges = await phone("summarynobadge", india(9, 0, SUN));
    await workout(quietBadges, india(7, 0, 2));
    expect((await request("PATCH", "/v1/users/me", { bearer: quietBadges.accessToken, payload: { pushBadges: false } })).statusCode).toBe(200);
    await badge(quietBadges, "first_workout", india(9, 0, SUN));
    await sql`UPDATE users SET last_active_at = ${india(9, 0, SUN)} WHERE id = ${quietBadges.userId}`;
    sent.length = 0;
    await sweep(india(18, 0, SUN));
    expect(sentTo(quietBadges.token).map((m) => m.body)).toEqual(["This week: 1 workout."]);
  }, TIMEOUT_MS);

  it("two runs at the same instant send one notification", async () => {
    const twice = await phone("twice", india(9, 0, TUE));
    await badge(twice, "photo_meal", india(9, 30, TUE));
    sent.length = 0;
    await Promise.all([sweep(india(10, 0, TUE)), sweep(india(10, 0, TUE))]);
    expect(sentTo(twice.token)).toHaveLength(1);
  }, TIMEOUT_MS);

  it("Firebase reaching no phone gives the day and the badge back, so the next run tells it", async () => {
    const unreached = await phone("unreached", india(9, 0, TUE));
    await badge(unreached, "variety_5", india(9, 30, TUE));
    answers.set(unreached.token, "failed");
    sent.length = 0;
    await sweep(india(10, 0, TUE));
    answers.delete(unreached.token);
    const [row] = await sql<{ nudge_day: string | null }[]>`SELECT nudge_day::text FROM users WHERE id = ${unreached.userId}`;
    expect(row?.nudge_day).toBeNull();
    await sweep(india(10, 1, TUE));
    expect(sentTo(unreached.token).map((m) => m.body)).toEqual(["You earned 5 Kinds of Exercise.", "You earned 5 Kinds of Exercise."]);
  }, TIMEOUT_MS);

  it("a zone the app cannot read gets none of the three, never one at night; nor does a phone signed in no more (L3, L5)", async () => {
    const offset = await phone("offsetzone", india(9, 0, TUE));
    await sql`UPDATE users SET timezone = '+05:30' WHERE id = ${offset.userId}`;
    await badge(offset, "night_owl", india(9, 30, TUE));
    const ranOut = await phone("ranoutbadge", india(9, 0, TUE));
    await badge(ranOut, "early_bird", india(9, 30, TUE));
    await sql`UPDATE refresh_tokens SET expires_at = ${india(9, 0, TUE - 1)} WHERE user_id = ${ranOut.userId}`;
    sent.length = 0;
    // 00:30 in India is 19:00 on UTC's clock: a day hour there, the middle of the night here.
    await sweep(new Date(Date.UTC(2026, 10, 3, 19, 0)));
    await sweep(india(11, 0, TUE));
    expect(sentTo(offset.token)).toEqual([]);
    expect(sentTo(ranOut.token)).toEqual([]);
    const rows = await sql<{ nudge_day: string | null }[]>`SELECT nudge_day::text FROM users WHERE id IN ${sql([offset.userId, ranOut.userId])}`;
    expect(rows.map((r) => r.nudge_day)).toEqual([null, null]);
  }, TIMEOUT_MS);

  // ── The switches on the account ──

  it("the three start on, and one person's switch never changes another's", async () => {
    const a = await phone("switcha", india(9, 0, TUE));
    const b = await phone("switchb", india(9, 0, TUE));
    const read = async (who: Phone) => userProfileResponseSchema.parse(JSON.parse((await request("GET", "/v1/users/me", { bearer: who.accessToken })).body)).user;
    expect([(await read(a)).pushStreak, (await read(a)).pushBadges, (await read(a)).pushSummary]).toEqual([true, true, true]);
    expect((await request("PATCH", "/v1/users/me", { bearer: a.accessToken, payload: { pushSummary: false, pushBadges: false } })).statusCode).toBe(200);
    const after = await read(a);
    expect([after.pushStreak, after.pushBadges, after.pushSummary]).toEqual([true, false, false]);
    const other = await read(b);
    expect([other.pushStreak, other.pushBadges, other.pushSummary]).toEqual([true, true, true]);
    expect((await request("PATCH", "/v1/users/me", { payload: { pushSummary: false } })).statusCode).toBe(401);
    expect((await request("PATCH", "/v1/users/me", { bearer: a.accessToken, payload: { pushSummary: "no" } })).statusCode).toBe(400);
  }, TIMEOUT_MS);
});
