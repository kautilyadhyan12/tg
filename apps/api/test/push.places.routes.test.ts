// A place in a class or an event, told to the phone (ROADMAP Stage 5 item 18b-ii-a), against real
// Postgres: the class and event routes mark who is owed a notice as places change hands, and the
// worker's run tells each phone, reading the person's own page again just before it does.
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: tell somebody "you have a place" in a class
// they are not booked into, so they turn up to a full class; or move somebody in and never tell
// them, so they miss it and are counted a no-show. Those are first.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { gymPlacePushDataSchema, verifyCodePhoneResponseSchema, type PhoneSessionTokens } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { PushMessage, PushResult, PushSender } from "../src/modules/push/fcm.adapter.js";
import { sendPlaceNotifications } from "../src/modules/push/placesSweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const LIVE_PLAN = "zz_pushp_live";
const T = 120_000;
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "push-places-secret-0123456789abcdefghij", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
interface Person extends PhoneSessionTokens {
  userId: string;
  /** This person's phone's notification address. */
  phone: string;
}
interface Gym {
  id: string;
  owner: { userId: string; cookies: Record<string, string> };
}

/** Tuesday 10 November 2026, noon in India (06:30 UTC). */
const NOON = Date.parse("2026-11-10T06:30:00Z");
const HOUR = 3_600_000;

let ipCounter = 0;
const nextIp = () => `10.53.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a place in a class or an event, told to the phone (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOON;
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

  const sent: PushMessage[] = [];
  const answers = new Map<string, PushResult>();
  const sender: PushSender = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve(answers.get(message.token) ?? "sent");
    },
  };
  const sweep = (at = clock) => sendPlaceNotifications({ sql, sender, now: () => new Date(at), gymIds });
  const sentTo = (who: Person) => sent.filter((m) => m.token === who.phone);
  const fresh = () => {
    sent.length = 0;
  };

  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'pushp-t-%@example.com'`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_event_places WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_events WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM push_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'pushp-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'pushp-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const request = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, opts: { payload?: unknown; bearer?: string; cookies?: Record<string, string> } = {}) =>
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
    const res = await request("POST", "/v1/auth/code/send", { payload: { email: to } });
    expect(res.statusCode, res.body).toBe(200);
    const hit = [...codes].reverse().find((c) => c.email === to);
    if (hit === undefined) throw new Error(`no code was sent to ${to}`);
    return hit.code;
  };
  /** Signed in on a phone, with its notification address given. */
  const person = async (name: string): Promise<Person> => {
    const to = `pushp-t-${name}-${uniq()}@example.com`;
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to), client: "phone" } });
    expect(res.statusCode, res.body).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    const phone = `fcm-${name}-${uniq()}:APA91b${"x".repeat(60)}`;
    const given = await request("PUT", "/v1/push-tokens", { bearer: body.tokens.accessToken, payload: { token: phone, platform: "android" } });
    expect(given.statusCode, given.body).toBe(200);
    return { ...body.tokens, userId: body.user.id, phone };
  };
  /** The gym's owner, signed in in the browser as the console is. */
  const browser = async (): Promise<Gym["owner"]> => {
    const to = `pushp-t-owner-${uniq()}@example.com`;
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to) } });
    expect(res.statusCode, res.body).toBe(200);
    const userId = (JSON.parse(res.body) as { user: { id: string } }).user.id;
    return { userId, cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])) };
  };
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await browser();
    const res = await request("POST", "/v1/orgs", {
      cookies: owner.cookies,
      payload: { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    await sql`UPDATE gyms SET clock_format = '12h' WHERE id = ${id}`;
    gymIds.push(id);
    return { id, owner };
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const who = await person(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${who.userId}, '2026-01-01T00:00:00Z')`;
    return who;
  };

  /** A class `hours` from now on the gym's clock, with its own class type. */
  const classAt = async (gym: Gym, hours: number, places: number, name = "Morning Flow"): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`${name} ${uniq()}`}, 45, ${places}, 'blue', false) RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    await sql`UPDATE gym_class_types SET name = ${name} WHERE id = ${type.id}`;
    const startsAt = new Date(clock + hours * HOUR);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, ${places}, 'scheduled'
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'Asia/Kolkata' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };
  const bookingPath = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = async (gym: Gym, who: Person, sessionId: string, joinWaitlist = false) => {
    const res = await request("POST", bookingPath(gym, sessionId), { bearer: who.accessToken, payload: { requestKey: randomUUID(), joinWaitlist } });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: { mine: { status: string } | null } }).booking.mine?.status;
  };
  const cancel = async (gym: Gym, who: Person, sessionId: string) => {
    const res = await request("POST", `${bookingPath(gym, sessionId)}/cancel`, { bearer: who.accessToken, payload: { lateOk: true } });
    expect(res.statusCode, res.body).toBe(200);
  };

  /** An event `hours` from now, three hours long, inserted as the console would save it. */
  const eventAt = async (gym: Gym, hours: number, places: number): Promise<string> => {
    const startsAt = new Date(clock + hours * HOUR);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_events (gym_id, event_key, name, details, place, starts_on, start_minute, ends_on, end_minute, starts_at, ends_at, places, created_by_user_id, created_at, updated_at)
      SELECT ${gym.id}, ${randomUUID()}, 'Saturday Open Day', 'Bring a friend.', 'Main hall',
             l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, l::date, LEAST(1439, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int + 180),
             ${startsAt}, ${new Date(startsAt.getTime() + 3 * HOUR)}, ${places}, ${gym.owner.userId}, ${new Date(clock)}, ${new Date(clock)}
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'Asia/Kolkata' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no event");
    return row.id;
  };
  const comePath = (gym: Gym, eventId: string) => `/v1/orgs/${gym.id}/events/${eventId}/coming`;
  const come = async (gym: Gym, who: Person, eventId: string, joinWaitlist = false) => {
    const res = await request("POST", comePath(gym, eventId), { bearer: who.accessToken, payload: { requestKey: randomUUID(), joinWaitlist } });
    expect(res.statusCode, res.body).toBe(200);
  };
  const cantCome = async (gym: Gym, who: Person, eventId: string) => {
    const res = await request("DELETE", comePath(gym, eventId), { bearer: who.accessToken });
    expect(res.statusCode, res.body).toBe(200);
  };

  let gym: Gym;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      emailSender,
      orgs: { now: () => new Date(clock), gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
    });
    await api().ready();
    gym = await makeGym("Lotus Yoga");
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  // ── The worst thing first ──

  it("moved in off the waitlist: told on their own phone, and nobody else is told they have it", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    // Friday 13 November, 18:00 in India: more than a day away, so a free place goes to the first in line.
    const flow = await classAt(gym, 3 * 24 + 6, 1);
    expect(await book(gym, asha, flow)).toBe("booked");
    expect(await book(gym, bina, flow, true)).toBe("waitlisted");
    expect(await book(gym, chen, flow, true)).toBe("waitlisted");
    await cancel(gym, asha, flow);

    const run = await sweep();
    expect(run.sent).toBe(1);
    expect(sentTo(bina)).toHaveLength(1);
    expect(sentTo(bina)[0]).toMatchObject({
      title: "Lotus Yoga",
      body: "You have a place in Morning Flow on Friday 13 November at 6:00 PM. You were next on the waitlist.",
      channelId: "gym-places",
      tag: `place:${flow}`,
    });
    expect(gymPlacePushDataSchema.parse(sentTo(bina)[0]?.data)).toEqual({ kind: "gym_place", gymId: gym.id, what: "class", id: flow, week: 0 });
    expect(sentTo(asha)).toHaveLength(0);
    expect(sentTo(chen)).toHaveLength(0);
    // Told once.
    expect((await sweep()).sent).toBe(1 - 1);
  });

  it("moved in, then the place is gone before the run: told nothing", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina] = [await member(gym, "asha"), await member(gym, "bina")];
    const flow = await classAt(gym, 3 * 24, 1);
    await book(gym, asha, flow);
    await book(gym, bina, flow, true);
    await cancel(gym, asha, flow);
    // Bina gives the place up before the worker runs.
    await cancel(gym, bina, flow);
    await sweep();
    expect(sent).toHaveLength(0);

    // And a class staff cancel after somebody was moved in: told nothing.
    const yin = await classAt(gym, 4 * 24, 1);
    await book(gym, asha, yin);
    await book(gym, bina, yin, true);
    await cancel(gym, asha, yin);
    await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${yin}`;
    await sweep();
    expect(sent).toHaveLength(0);
  });

  it("a place free in the last day: everybody waiting is told once, and the person who gave it up is not", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    // Today 18:00: inside the last day, so the place is not handed over by itself.
    const flow = await classAt(gym, 6, 1);
    await book(gym, asha, flow);
    await book(gym, bina, flow, true);
    await book(gym, chen, flow, true);
    await cancel(gym, asha, flow);

    expect((await sweep()).sent).toBe(2);
    for (const who of [bina, chen]) {
      expect(sentTo(who).map((m) => m.body)).toEqual(["A place is free in Morning Flow today at 6:00 PM. The first to claim it gets it."]);
    }
    expect(sentTo(asha)).toHaveLength(0);
    // The same free place, seen again by another change, is told to nobody twice: a shorter hand-over
    // time (20 hours, the class still inside it) makes the gym look at every class's free places.
    fresh();
    const settings = await request("GET", `/v1/orgs/${gym.id}/booking-settings`, { cookies: gym.owner.cookies });
    expect(settings.statusCode, settings.body).toBe(200);
    const read = JSON.parse(settings.body) as { settings: Record<string, unknown>; pt: object };
    const put = (handoverMinutes: number) =>
      request("PUT", `/v1/orgs/${gym.id}/booking-settings`, { cookies: gym.owner.cookies, payload: { ...read.settings, handoverMinutes, pt: read.pt } });
    expect((await put(1200)).statusCode).toBe(200);
    await sweep();
    expect(sent).toHaveLength(0);
    expect((await put(1440)).statusCode).toBe(200);
  });

  it("a free place claimed before the run: nobody is told it is free", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    const flow = await classAt(gym, 4, 1);
    await book(gym, asha, flow);
    await book(gym, bina, flow, true);
    await book(gym, chen, flow, true);
    await cancel(gym, asha, flow);
    expect(await book(gym, bina, flow)).toBe("booked");
    await sweep();
    expect(sent).toHaveLength(0);
    // A second free place later is a new one: Chen is told about it.
    await cancel(gym, bina, flow);
    await sweep();
    expect(sentTo(chen)).toHaveLength(1);
    expect(sentTo(bina)).toHaveLength(0);
  });

  it("somebody waiting who has left the gym is not told", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    const flow = await classAt(gym, 4, 1);
    await book(gym, asha, flow);
    await book(gym, bina, flow, true);
    await book(gym, chen, flow, true);
    await sql`UPDATE gym_members SET removed_at = ${new Date(clock)} WHERE gym_id = ${gym.id} AND user_id = ${bina.userId}`;
    await cancel(gym, asha, flow);
    await sweep();
    expect(sentTo(bina)).toHaveLength(0);
    expect(sentTo(chen)).toHaveLength(1);
  });

  it("at night it waits for 07:00, and is read again then", { timeout: T }, async () => {
    // 23:30 in India.
    clock = Date.parse("2026-11-10T18:00:00Z");
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    // 10:00 tomorrow: inside the last day.
    const early = await classAt(gym, 10.5, 1, "Sunrise Flow");
    await book(gym, asha, early);
    await book(gym, bina, early, true);
    await book(gym, chen, early, true);
    await cancel(gym, asha, early);
    const night = await sweep();
    expect(night.waiting).toBe(2);
    expect(sent).toHaveLength(0);
    // 06:59, then 07:00.
    expect((await sweep(Date.parse("2026-11-11T01:29:00Z"))).sent).toBe(0);
    // Chen takes the place in the night: at 07:00 nobody is told it is free.
    clock = Date.parse("2026-11-11T01:00:00Z");
    expect(await book(gym, chen, early)).toBe("booked");
    await sweep(Date.parse("2026-11-11T01:30:00Z"));
    expect(sent).toHaveLength(0);
  });

  it("an event: moved in is told, and a place free in the last day is told to those waiting", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    const later = await eventAt(gym, 3 * 24, 1);
    await come(gym, asha, later);
    await come(gym, bina, later, true);
    await cantCome(gym, asha, later);
    await sweep();
    expect(sentTo(bina).map((m) => m.body)).toEqual(["You have a place in Saturday Open Day on Friday 13 November at 12:00 PM. You were next on the waitlist."]);
    expect(gymPlacePushDataSchema.parse(sentTo(bina)[0]?.data)).toMatchObject({ what: "event", id: later });

    fresh();
    const soon = await eventAt(gym, 5, 1);
    await come(gym, asha, soon);
    await come(gym, chen, soon, true);
    await cantCome(gym, asha, soon);
    await sweep();
    expect(sentTo(chen).map((m) => m.body)).toEqual(["A place is free in Saturday Open Day today at 5:00 PM. The first to claim it gets it."]);
    expect(sentTo(asha)).toHaveLength(0);
  });

  it("staff take somebody off a class, and the gym shortens its hand-over time: the same notices", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina, chen] = [await member(gym, "asha"), await member(gym, "bina"), await member(gym, "chen")];
    const flow = await classAt(gym, 6, 1);
    await book(gym, asha, flow);
    await book(gym, bina, flow, true);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_class_bookings WHERE session_id = ${flow} AND user_id = ${asha.userId} AND status = 'booked'`;
    const removed = await request("POST", `/v1/orgs/${gym.id}/class-sessions/${flow}/bookings/${row?.id ?? ""}/remove`, { cookies: gym.owner.cookies });
    expect(removed.statusCode, removed.body).toBe(200);
    await sweep();
    expect(sentTo(bina).map((m) => m.body)).toEqual(["A place is free in Morning Flow today at 6:00 PM. The first to claim it gets it."]);
    expect(sentTo(asha)).toHaveLength(0);

    // Ten hours away with a free place and somebody waiting: a hand-over time of one hour gives it to them.
    fresh();
    const later = await classAt(gym, 10, 1);
    await book(gym, asha, later);
    await book(gym, chen, later, true);
    await cancel(gym, asha, later);
    await sweep();
    fresh();
    const settings = await request("GET", `/v1/orgs/${gym.id}/booking-settings`, { cookies: gym.owner.cookies });
    const read = JSON.parse(settings.body) as { settings: Record<string, unknown>; pt: object };
    const put = (handoverMinutes: number) =>
      request("PUT", `/v1/orgs/${gym.id}/booking-settings`, { cookies: gym.owner.cookies, payload: { ...read.settings, handoverMinutes, pt: read.pt } });
    expect((await put(60)).statusCode).toBe(200);
    await sweep();
    expect(sentTo(chen).map((m) => m.body)).toEqual(["You have a place in Morning Flow today at 10:00 PM. You were next on the waitlist."]);
    expect((await put(1440)).statusCode).toBe(200);
  });

  it("Firebase does not answer: tried again on the next run; an address it says is gone is forgotten", { timeout: T }, async () => {
    clock = NOON;
    fresh();
    const [asha, bina] = [await member(gym, "asha"), await member(gym, "bina")];
    const flow = await classAt(gym, 3 * 24, 1);
    await book(gym, asha, flow);
    await book(gym, bina, flow, true);
    await cancel(gym, asha, flow);
    answers.set(bina.phone, "failed");
    expect((await sweep()).failed).toBe(1);
    answers.delete(bina.phone);
    expect((await sweep()).sent).toBe(1);

    const yin = await classAt(gym, 4 * 24, 1);
    await book(gym, bina, yin);
    await book(gym, asha, yin, true);
    answers.set(asha.phone, "gone");
    await cancel(gym, bina, yin);
    await sweep();
    expect((await sql`SELECT 1 FROM push_tokens WHERE token = ${asha.phone}`).length).toBe(0);
    answers.delete(asha.phone);
  });
});
