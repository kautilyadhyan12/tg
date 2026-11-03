// Phone notifications for a gym's messages (ROADMAP Stage 5 item 18b-i; spec Part 6 §6), against real
// Postgres: the phone's address kept with its sign-in, and the worker's run that tells each phone
// about its own person's new messages, one notification a gym. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show one person's gym message on a phone that
// is now signed in as somebody else, or no longer signed in at all. Those are first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { verifyCodePhoneResponseSchema, type PhoneSessionTokens } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { PushMessage, PushResult, PushSender } from "../src/modules/push/fcm.adapter.js";
import { hourIn, sendGymMessageNotifications } from "../src/modules/push/sweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const LIVE_PLAN = "zz_push_live";
const TIMEOUT_MS = 60_000;
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "push-test-secret-0123456789abcdefghij", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Phone extends PhoneSessionTokens {
  userId: string;
}

let ipCounter = 0;
const nextIp = () => `10.48.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const email = (local: string) => `push-t-${local}-${uniq()}@example.com`;
/** A phone's notification address, as Firebase's are: long and with no spaces. */
const address = (name: string) => `fcm-${name}-${uniq()}:APA91b${"x".repeat(60)}`;

/** Noon in India today (06:30 UTC): the hours notifications go out. */
const noonIndia = (): Date => {
  const at = new Date();
  at.setUTCHours(6, 30, 0, 0);
  return at;
};
const minutes = (from: Date, n: number) => new Date(from.getTime() + n * 60_000);

d("phone notifications for a gym's messages (real Postgres)", () => {
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
  const gymIds: string[] = [];

  /** What Firebase was asked to show, and the answer each address gets. */
  const sent: PushMessage[] = [];
  const answers = new Map<string, PushResult>();
  const sender: PushSender = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve(answers.get(message.token) ?? "sent");
    },
  };
  const sweep = (at: Date, sizes?: { batch: number; page: number }) =>
    sendGymMessageNotifications({ sql, sender, now: () => at, gymIds, ...(sizes === undefined ? {} : { sizes }) });
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'push-t-%@example.com'`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM push_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'push-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'push-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const request = (
    method: "POST" | "PUT",
    path: string,
    opts: { payload?: unknown; cookies?: Cookies; bearer?: string } = {},
  ) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: opts.cookies ?? {},
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
  const phoneSignIn = async (to: string): Promise<Phone> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to), client: "phone" } });
    expect(res.statusCode).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    return { ...body.tokens, userId: body.user.id };
  };
  const browserSignIn = async (to: string): Promise<Cookies> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to) } });
    expect(res.statusCode).toBe(200);
    return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  };
  const giveAddress = (phone: { accessToken: string }, token: string) =>
    request("PUT", "/v1/push-tokens", { bearer: phone.accessToken, payload: { token, platform: "android" } });
  const signOut = async (phone: Phone) => {
    expect((await request("POST", "/v1/auth/logout", { payload: { refreshToken: phone.refreshToken } })).statusCode).toBe(200);
  };

  const makeGym = async (name: string, plan = true): Promise<string> => {
    const owner = await browserSignIn(email("owner"));
    const res = await request("POST", "/v1/orgs", {
      cookies: owner,
      payload: { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    gymIds.push(id);
    return id;
  };
  const join = async (gymId: string, userId: string) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gymId}, ${userId}, ${minutes(noonIndia(), -3 * 24 * 60)})`;
  };
  const message = async (gymId: string, userId: string, body: string, sentAt: Date, more: { readAt?: Date; expiresAt?: Date } = {}) => {
    await sql`
      INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, read_at, expires_at)
      VALUES (${gymId}, ${userId}, 'group', ${uniq()}, ${body}, ${sentAt.toISOString().slice(0, 10)}, ${sentAt},
              ${more.readAt ?? null}, ${more.expiresAt ?? minutes(sentAt, 30 * 24 * 60)})`;
  };
  const waiting = (userId: string) =>
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_messages WHERE user_id = ${userId} AND push_done_at IS NULL`;

  let gymA = "";
  let gymB = "";

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      emailSender,
      orgs: { gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
    });
    await api().ready();
    gymA = await makeGym("Lotus Yoga");
    gymB = await makeGym("Iron Works");
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  // ── The worst thing first ──

  it("a phone signed out, or signed in as somebody else, is never told the first person's messages", { timeout: TIMEOUT_MS }, async () => {
    const at = noonIndia();
    const phoneToken = address("shared-phone");
    const ashaEmail = email("asha");
    const asha = await phoneSignIn(ashaEmail);
    await join(gymA, asha.userId);
    expect((await giveAddress(asha, phoneToken)).statusCode).toBe(200);

    // Signed out: Asha's next message reaches nobody's phone.
    await signOut(asha);
    await message(gymA, asha.userId, "Class moved to 7 pm.", minutes(at, -5));
    await sweep(at);
    expect(sentTo(phoneToken)).toEqual([]);

    // Ravi signs in on the same phone, which gives the same address.
    const ravi = await phoneSignIn(email("ravi"));
    await join(gymB, ravi.userId);
    expect((await giveAddress(ravi, phoneToken)).statusCode).toBe(200);
    // Asha signs in again elsewhere (on the web): her messages still never reach Ravi's phone.
    await browserSignIn(ashaEmail);
    await message(gymA, asha.userId, "Your membership ends on Friday.", minutes(at, 1));
    await message(gymB, ravi.userId, "Welcome to Iron Works.", minutes(at, 1));
    await sweep(minutes(at, 2));
    expect(sentTo(phoneToken).map((m) => [m.title, m.body, m.tag])).toEqual([["Iron Works", "Welcome to Iron Works.", gymB]]);
  });

  it("a phone that Asha left without signing out, now signed in as Meera, is told only Meera's", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 10);
    const phoneToken = address("handed-on");
    const asha = await phoneSignIn(email("asha2"));
    await join(gymA, asha.userId);
    expect((await giveAddress(asha, phoneToken)).statusCode).toBe(200);
    // Asha's sign-in is still open; Meera signs in on the same phone.
    const meera = await phoneSignIn(email("meera"));
    await join(gymA, meera.userId);
    expect((await giveAddress(meera, phoneToken)).statusCode).toBe(200);
    await message(gymA, asha.userId, "Asha's private note.", minutes(at, -1));
    await message(gymA, meera.userId, "Meera's class is at 6.", minutes(at, -1));
    await sweep(at);
    expect(sentTo(phoneToken).map((m) => m.body)).toEqual(["Meera's class is at 6."]);
  });

  it("signed in on another phone, the first phone is told nothing more", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 20);
    const to = email("two-phones");
    const first = await phoneSignIn(to);
    await join(gymA, first.userId);
    const oldPhone = address("old-phone");
    expect((await giveAddress(first, oldPhone)).statusCode).toBe(200);
    const second = await phoneSignIn(to);
    const newPhone = address("new-phone");
    expect((await giveAddress(second, newPhone)).statusCode).toBe(200);
    await message(gymA, first.userId, "See you tomorrow.", minutes(at, -1));
    await sweep(at);
    expect(sentTo(oldPhone)).toEqual([]);
    expect(sentTo(newPhone).map((m) => m.body)).toEqual(["See you tomorrow."]);
  });

  it("a phone sign-in that ran out is told nothing, and cannot give an address", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 25);
    const phone = await phoneSignIn(email("ran-out"));
    await join(gymA, phone.userId);
    const token = address("ran-out");
    expect((await giveAddress(phone, token)).statusCode).toBe(200);
    // Ran out before the sweep's moment and before the real clock's, whatever the time of day the test runs.
    const ranOut = new Date(Math.min(minutes(at, -1).getTime(), Date.now() - 60_000));
    await sql`UPDATE refresh_tokens SET expires_at = ${ranOut} WHERE user_id = ${phone.userId}`;
    await message(gymA, phone.userId, "After it ran out.", minutes(at, -1));
    await sweep(at);
    expect(sentTo(token)).toEqual([]);
    expect((await giveAddress(phone, address("ran-out-2"))).statusCode).toBe(403);
  });

  // ── The phone's address ──

  it("a person may give an address 30 times an hour; the 31st is refused", { timeout: TIMEOUT_MS }, async () => {
    const phone = await phoneSignIn(email("limit"));
    for (let i = 0; i < 30; i += 1) expect((await giveAddress(phone, address(`limit${String(i)}`))).statusCode).toBe(200);
    expect((await giveAddress(phone, address("limit-31"))).statusCode).toBe(429);
  });

  it("only a phone sign-in may give an address; a bad one is refused", { timeout: TIMEOUT_MS }, async () => {
    const res = await request("PUT", "/v1/push-tokens", { payload: { token: address("nobody"), platform: "android" } });
    expect(res.statusCode).toBe(401);
    const browser = await browserSignIn(email("browser"));
    const fromWeb = await request("PUT", "/v1/push-tokens", { cookies: browser, payload: { token: address("web"), platform: "android" } });
    expect(fromWeb.statusCode).toBe(403);
    const phone = await phoneSignIn(email("phone"));
    for (const payload of [
      { token: "short", platform: "android" },
      { token: "has a space in it and is long enough to pass", platform: "android" },
      { token: address("ios"), platform: "ios" },
      { token: address("extra"), platform: "android", userId: phone.userId },
    ]) {
      expect((await request("PUT", "/v1/push-tokens", { bearer: phone.accessToken, payload })).statusCode).toBe(400);
    }
    expect(await sql`SELECT 1 FROM push_tokens WHERE user_id = ${phone.userId}`).toHaveLength(0);
  });

  it("a new address for the same sign-in replaces the old one", { timeout: TIMEOUT_MS }, async () => {
    const phone = await phoneSignIn(email("renewed"));
    const before = address("before");
    const after = address("after");
    expect((await giveAddress(phone, before)).statusCode).toBe(200);
    expect((await giveAddress(phone, before)).statusCode).toBe(200);
    expect((await giveAddress(phone, after)).statusCode).toBe(200);
    const rows = await sql<{ token: string }[]>`SELECT token FROM push_tokens WHERE user_id = ${phone.userId}`;
    expect(rows.map((r) => r.token)).toEqual([after]);
  });

  // ── One notification a gym ──

  it("three new messages from one gym are one notification with the count, sent once", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 30);
    const phone = await phoneSignIn(email("three"));
    await join(gymA, phone.userId);
    await join(gymB, phone.userId);
    const token = address("three");
    await giveAddress(phone, token);
    await message(gymA, phone.userId, "First.", minutes(at, -3));
    await message(gymA, phone.userId, "Second.", minutes(at, -2));
    await message(gymA, phone.userId, "Newest.", minutes(at, -1));
    await message(gymB, phone.userId, "From the other gym.", minutes(at, -1));
    // Two runs at the same instant send it once.
    await Promise.all([sweep(at), sweep(at)]);
    await sweep(minutes(at, 1));
    expect(sentTo(token).map((m) => [m.title, m.body, m.tag, m.channelId, m.data])).toEqual(
      expect.arrayContaining([
        ["Lotus Yoga · 3 new messages", "Newest.", gymA, "gym-messages", { kind: "gym_inbox", gymId: gymA }],
        ["Iron Works", "From the other gym.", gymB, "gym-messages", { kind: "gym_inbox", gymId: gymB }],
      ]),
    );
    expect(sentTo(token)).toHaveLength(2);
    // The next message replaces that gym's notification, with the count still unread.
    await message(gymA, phone.userId, "Fourth.", minutes(at, 2));
    await sweep(minutes(at, 3));
    expect(sentTo(token).at(-1)).toMatchObject({ title: "Lotus Yoga · 4 new messages", body: "Fourth.", tag: gymA });
  });

  it("at night it waits, and goes in the morning", { timeout: TIMEOUT_MS }, async () => {
    // 23:30 in India.
    const night = minutes(noonIndia(), 11 * 60 + 30);
    const phone = await phoneSignIn(email("night"));
    await join(gymA, phone.userId);
    const token = address("night");
    await giveAddress(phone, token);
    await message(gymA, phone.userId, "Late news.", minutes(night, -1));
    await sweep(night);
    expect(sentTo(token)).toEqual([]);
    expect((await waiting(phone.userId))[0]?.n).toBe(1);
    // 03:59 next day: still night. 04:00: sent.
    await sweep(minutes(night, 4 * 60 + 29));
    expect(sentTo(token)).toEqual([]);
    await sweep(minutes(night, 4 * 60 + 30));
    expect(sentTo(token).map((m) => m.body)).toEqual(["Late news."]);
  });

  it("the person's own clock decides night, when the phone told it", { timeout: TIMEOUT_MS }, async () => {
    // Noon in India is 02:30 in New York.
    const at = minutes(noonIndia(), 40);
    const phone = await phoneSignIn(email("travel"));
    await sql`UPDATE users SET timezone = 'America/New_York' WHERE id = ${phone.userId}`;
    await join(gymA, phone.userId);
    const token = address("travel");
    await giveAddress(phone, token);
    await message(gymA, phone.userId, "Hello from India.", minutes(at, -1));
    await sweep(at);
    expect(sentTo(token)).toEqual([]);
    // 08:00 in New York, whatever the season: then it goes.
    let morning = at;
    while (hourIn("America/New_York", morning) !== 8) morning = minutes(morning, 30);
    await sweep(morning);
    expect(sentTo(token).map((m) => m.body)).toEqual(["Hello from India."]);
  });

  it("more people waiting for their morning than a run reads never hold up a person whose day it is", { timeout: TIMEOUT_MS }, async () => {
    // 23:30 in India is 13:00 in New York in winter and 14:00 in summer: day there, night here.
    const at = minutes(noonIndia(), 11 * 60);
    expect(hourIn("Asia/Kolkata", at)).toBe(23);
    for (const name of ["late1", "late2", "late3"]) {
      const sleeper = await phoneSignIn(email(name));
      await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${sleeper.userId}`;
      await join(gymA, sleeper.userId);
      await giveAddress(sleeper, address(name));
      await message(gymA, sleeper.userId, "Late news.", minutes(at, -30));
    }
    const awake = await phoneSignIn(email("awake"));
    await sql`UPDATE users SET timezone = 'America/New_York' WHERE id = ${awake.userId}`;
    await join(gymA, awake.userId);
    const token = address("awake");
    await giveAddress(awake, token);
    await message(gymA, awake.userId, "Good afternoon.", minutes(at, -1));
    // Pages of two and a batch of two, with three people asleep ahead of the one awake.
    await sweep(at, { batch: 2, page: 2 });
    expect(sentTo(token).map((m) => m.body)).toEqual(["Good afternoon."]);
  });

  it("nothing is sent for a message read, gone, too old, from a gym left or on no plan, or with no phone", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 50);
    const phone = await phoneSignIn(email("none"));
    const token = address("none");
    await giveAddress(phone, token);
    const noPlan = await makeGym("Closed Studio", false);
    const left = await makeGym("Left Gym");
    await join(gymA, phone.userId);
    await join(noPlan, phone.userId);
    await join(left, phone.userId);
    await sql`UPDATE gym_members SET removed_at = ${minutes(at, -60)} WHERE gym_id = ${left} AND user_id = ${phone.userId}`;
    await message(gymA, phone.userId, "Read already.", minutes(at, -5), { readAt: minutes(at, -4) });
    await message(gymA, phone.userId, "Out of the inbox.", minutes(at, -5), { expiresAt: minutes(at, -1) });
    await message(gymA, phone.userId, "Two days old.", minutes(at, -48 * 60));
    await message(noPlan, phone.userId, "Studio closed.", minutes(at, -5));
    await message(left, phone.userId, "After you left.", minutes(at, -5));
    const nobody = await phoneSignIn(email("no-phone"));
    await join(gymA, nobody.userId);
    await message(gymA, nobody.userId, "No phone to tell.", minutes(at, -5));
    await sweep(at);
    expect(sentTo(token)).toEqual([]);
    expect((await waiting(phone.userId))[0]?.n).toBe(0);
    expect((await waiting(nobody.userId))[0]?.n).toBe(0);
  });

  it("when Firebase does not answer, the notification is sent on the next run, once", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 70);
    const phone = await phoneSignIn(email("blip"));
    await join(gymA, phone.userId);
    const token = address("blip");
    await giveAddress(phone, token);
    answers.set(token, "failed");
    await message(gymA, phone.userId, "Sent during a blip.", minutes(at, -1));
    await sweep(at);
    expect(sentTo(token)).toHaveLength(1);
    expect((await waiting(phone.userId))[0]?.n).toBe(1);
    answers.set(token, "sent");
    await sweep(minutes(at, 1));
    await sweep(minutes(at, 2));
    expect(sentTo(token).map((m) => m.body)).toEqual(["Sent during a blip.", "Sent during a blip."]);
    expect((await waiting(phone.userId))[0]?.n).toBe(0);
  });

  it("an address Firebase says is gone is forgotten", { timeout: TIMEOUT_MS }, async () => {
    const at = minutes(noonIndia(), 60);
    const phone = await phoneSignIn(email("gone"));
    await join(gymA, phone.userId);
    const token = address("gone");
    await giveAddress(phone, token);
    answers.set(token, "gone");
    await message(gymA, phone.userId, "Anyone there?", minutes(at, -1));
    await sweep(at);
    expect(await sql`SELECT 1 FROM push_tokens WHERE token = ${token}`).toHaveLength(0);
  });
});
