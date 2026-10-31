// A pass the phone makes with no signal (ROADMAP Stage 5 item 15c; spec Part 3 §12.2), against
// real Postgres, and the real Redis where TEST_REDIS_URL is set (`test:local` and CI's database
// job): the phone's keys, and the desk taking the pass the phone signed with them.
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: let a stranger in on a member's pass made
// by a phone that was signed out or replaced, or made ahead for a friend, or let one offline pass
// in twice. Those are first.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  checkinPhoneKeyResponseSchema,
  verifyCodePhoneResponseSchema,
  type CheckinPhoneDayKey,
  type PhoneSessionTokens,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { WINDOWS_A_DAY, makePass, makePhonePass, passDay, passWindow, windowEndsAt } from "../src/modules/orgs/checkin/pass.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const redisUrl = process.env["TEST_REDIS_URL"];

const PASS_SECRET = "phone-pass-test-secret-0123456789abcdef"; // dummy test value, gitleaks:allow
const KEY = Buffer.from(PASS_SECRET, "utf8");
const LIVE_PLAN = "zz_chk_phone";
const KEY_PATH = "/v1/users/me/checkin-pass/phone-key";
const TIMEOUT_MS = 60_000;

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "phone-pass-test-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: PASS_SECRET,
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

let ipCounter = 0;
const nextIp = () => `10.47.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

/** The phone's key for the day a window falls in, as the phone picks it. */
const keyFor = (keys: readonly CheckinPhoneDayKey[], window: number): Buffer => {
  const held = keys.find((one) => one.day === passDay(window));
  if (held === undefined) throw new Error(`no key for day ${String(passDay(window))}`);
  return Buffer.from(held.key, "base64url");
};

d("a pass the phone makes with no signal (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let redis: RedisLike = createMemoryRedis();
  const sent: { email: string; code: string }[] = [];
  const sender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (email, code) => {
      sent.push({ email, code });
      return Promise.resolve();
    },
  };
  // The desk's clock: the real one, moved on by a test that needs a later day.
  let ahead = 0;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chkph-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chkph-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM org_daily_stats WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'chkph-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'chkph-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const request = (
    method: "GET" | "POST",
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

  /** A fresh code for the address, by the real send route. */
  const codeFor = async (email: string): Promise<string> => {
    // The rules read created_at (a sixty-second gap, three a day), so moving it is the clock.
    await sql`UPDATE sign_in_codes SET created_at = created_at - interval '2 days' WHERE email = ${email}`;
    const res = await request("POST", "/v1/auth/code/send", { payload: { email } });
    expect(res.statusCode).toBe(200);
    const hit = [...sent].reverse().find((s) => s.email === email);
    if (hit === undefined) throw new Error(`no code was sent to ${email}`);
    return hit.code;
  };

  const phoneSignIn = async (email: string): Promise<PhoneSessionTokens & { userId: string }> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email, code: await codeFor(email), client: "phone" } });
    expect(res.statusCode).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    return { ...body.tokens, userId: body.user.id };
  };

  const browserSignIn = async (email: string): Promise<Cookies> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email, code: await codeFor(email) } });
    expect(res.statusCode).toBe(200);
    return cookieMap(res);
  };

  /** What the phone keeps while it has signal. */
  const phoneKeysOf = async (phone: { accessToken: string }): Promise<CheckinPhoneDayKey[]> => {
    const res = await request("GET", KEY_PATH, { bearer: phone.accessToken });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    return checkinPhoneKeyResponseSchema.parse(JSON.parse(res.body)).keys;
  };

  const scan = async (desk: Cookies, code: string): Promise<{ result: string; person?: { name: string } }> => {
    const res = await request("POST", "/v1/checkin/scan", { payload: { code }, cookies: desk });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as { result: string; person?: { name: string } };
  };

  const visitsOf = (gymId: string, userId: string) =>
    sql<{ method: string }[]>`SELECT method FROM gym_attendance WHERE gym_id = ${gymId} AND user_id = ${userId}`;

  const now = () => passWindow(new Date(Date.now() + ahead));

  let gym = "";
  let desk: Cookies = {};
  let gymB = "";
  let deskB: Cookies = {};
  const email = (local: string) => `chkph-t-${local}-${uniq()}@example.com`;

  /** A member of the gym (and of \`more\`), signed in on a phone. */
  const member = async (local: string, name: string, more: string[] = []) => {
    const address = email(local);
    const phone = await phoneSignIn(address);
    await sql`UPDATE users SET display_name = ${name} WHERE id = ${phone.userId}`;
    for (const each of [gym, ...more]) await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${each}, ${phone.userId})`;
    return { email: address, phone };
  };

  /** A gym with a live plan and one desk, set up the way a gym does it. */
  const gymWithDesk = async (name: string): Promise<{ gymId: string; desk: Cookies }> => {
    const owner = await browserSignIn(email("owner"));
    const made = await request("POST", "/v1/orgs", {
      cookies: owner,
      payload: { trainsHere: true, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" },
    });
    expect(made.statusCode).toBe(201);
    const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const added = await request("POST", `/v1/orgs/${gymId}/checkin-devices`, { cookies: owner, payload: { name: "Front desk" } });
    expect(added.statusCode).toBe(201);
    const token = (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "";
    const claimed = await request("POST", "/v1/checkin/device/claim", { payload: { token } });
    expect(claimed.statusCode).toBe(200);
    return { gymId, desk: cookieMap(claimed) };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    if (redisUrl !== undefined && redisUrl !== "") {
      redis = createIoRedis(redisUrl);
      for (let tries = 0; (await redis.incrWithTtl(`chkph-ready:${randomUUID()}`, 30)) === null; tries++) {
        if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      emailSender: sender,
      orgs: { gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 }, now: () => new Date(Date.now() + ahead) },
    });
    await api().ready();
    ({ gymId: gym, desk } = await gymWithDesk("Lotus Yoga"));
    ({ gymId: gymB, desk: deskB } = await gymWithDesk("Iron House"));
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await redis.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  it(
    "THE WORST THING: a phone's pass lets its member in once, and never once that phone is replaced",
    async () => {
      ahead = 0;
      const asha = await member("asha", "Asha Walk");
      const keys = await phoneKeysOf(asha.phone);
      const w = now();

      // No signal: the phone signs this window's pass itself. In once; the same pass again,
      // or the server's own pass for the same window, is grey.
      const pass = makePhonePass(keyFor(keys, w), asha.phone.userId, w);
      const first = await scan(desk, pass);
      expect(first.result).toBe("checked_in");
      expect(first.person).toEqual({ name: "Asha Walk" });
      expect((await scan(desk, pass)).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePass(KEY, asha.phone.userId, w))).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, asha.phone.userId)).toEqual([{ method: "pass" }]);

      // A newer phone signs in: the old phone's pass for the window before, made with the key it
      // still holds and never used, is dead.
      const newPhone = await phoneSignIn(asha.email);
      expect((await scan(deskB, makePhonePass(keyFor(keys, w - 1), asha.phone.userId, w - 1))).result).toBe("fresh_pass_needed");
      // The new phone has keys of its own, and its pass for that window works where she is a member.
      const newKeys = await phoneKeysOf(newPhone);
      expect(newKeys[0]?.key).not.toBe(keys[0]?.key);
      await sql`DELETE FROM gym_attendance WHERE gym_id = ${gym} AND user_id = ${asha.phone.userId}`;
      expect((await scan(desk, makePhonePass(keyFor(newKeys, w - 1), asha.phone.userId, w - 1))).result).toBe("checked_in");
    },
    TIMEOUT_MS,
  );

  it(
    "THE WORST THING: a phone signed out makes passes nobody takes",
    async () => {
      ahead = 0;
      const fay = await member("fay", "Fay Moss");
      const keys = await phoneKeysOf(fay.phone);
      const out = await request("POST", "/v1/auth/logout", { payload: { refreshToken: fay.phone.refreshToken } });
      expect(out.statusCode).toBeLessThan(300);
      // This window and the next are unused, and good for 60 seconds: only the sign-out stops them.
      const w = now();
      expect((await scan(desk, makePhonePass(keyFor(keys, w), fay.phone.userId, w))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePhonePass(keyFor(keys, w + 1), fay.phone.userId, w + 1))).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, fay.phone.userId)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "THE WORST THING: a pass made ahead for a friend works only until tomorrow ends; a week on it is grey",
    async () => {
      ahead = 0;
      const gil = await member("gil", "Gil Hart");
      const keys = await phoneKeysOf(gil.phone);
      expect(keys.map((one) => one.day)).toEqual([passDay(now()), passDay(now()) + 1]);
      // The phone's clock moved a week on: it has no key for that day, and today's makes nothing good then.
      const weekOn = now() + 7 * WINDOWS_A_DAY;
      const madeWithToday = makePhonePass(keyFor(keys, now()), gil.phone.userId, weekOn);
      ahead = 7 * 86_400_000;
      expect((await scan(desk, madeWithToday)).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, gil.phone.userId)).toEqual([]);
      // Tomorrow's key, used tomorrow, is good: the day the phone was told about.
      ahead = 86_400_000;
      expect((await scan(desk, makePhonePass(keyFor(keys, now()), gil.phone.userId, now()))).result).toBe("checked_in");
      ahead = 0;
    },
    TIMEOUT_MS,
  );

  it(
    "THE WORST THING: one member's phone key makes nobody else's pass, and a stranger's is red",
    async () => {
      ahead = 0;
      const ben = await member("ben", "Ben Row");
      const cara = await member("cara", "Cara Lane");
      const bensKeys = await phoneKeysOf(ben.phone);
      const w = now();
      expect((await scan(desk, makePhonePass(keyFor(bensKeys, w), cara.phone.userId, w))).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, cara.phone.userId)).toEqual([]);

      // Somebody with the app who is not a member: their own phone's pass is read, and is red.
      const stranger = await phoneSignIn(email("stranger"));
      const strangersPass = makePhonePass(keyFor(await phoneKeysOf(stranger), w), stranger.userId, w);
      expect((await scan(desk, strangersPass)).result).toBe("not_a_member");
    },
    TIMEOUT_MS,
  );

  it(
    "THE WORST THING: one pass at two gyms' desks at the same instant lets one person in, and the phone's and the server's pass for one window are one use",
    async () => {
      ahead = 0;
      for (let round = 0; round < 3; round++) {
        const dev = await member(`dev${String(round)}`, "Dev Rao", [gymB]);
        const keys = await phoneKeysOf(dev.phone);
        // The desk's clock at the very start of a window: a slow machine crossing into the next
        // would make the pass of the window before too old, and neither desk would let anyone in.
        ahead = windowEndsAt(now()).getTime() - Date.now();
        const w = now();
        const pass = makePhonePass(keyFor(keys, w), dev.phone.userId, w);
        const same = await Promise.all([scan(desk, pass), scan(deskB, pass)]);
        expect(same.map((one) => one.result).sort()).toEqual(["checked_in", "fresh_pass_needed"]);
        // A day's second visit to the same gym says "already"; cleared, the winner is plain to see.
        await sql`DELETE FROM gym_attendance WHERE user_id = ${dev.phone.userId}`;
        const both = await Promise.all([
          scan(desk, makePhonePass(keyFor(keys, w - 1), dev.phone.userId, w - 1)),
          scan(deskB, makePass(KEY, dev.phone.userId, w - 1)),
        ]);
        expect(both.map((one) => one.result).sort()).toEqual(["checked_in", "fresh_pass_needed"]);
      }
      ahead = 0;
    },
    TIMEOUT_MS,
  );

  it(
    "a pass a window early takes the desk's window too: two windows at most are open for one person, as with the server's pass",
    async () => {
      ahead = 0;
      const eve = await member("eve", "Eve Kim", [gymB]);
      const keys = await phoneKeysOf(eve.phone);
      const w = now();
      expect((await scan(desk, makePhonePass(keyFor(keys, w + 1), eve.phone.userId, w + 1))).result).toBe("checked_in");
      // Her pass for the desk's own window, at the other gym, is now grey: one of the two is used.
      expect((await scan(deskB, makePhonePass(keyFor(keys, w), eve.phone.userId, w))).result).toBe("fresh_pass_needed");
      // The window before is the second, and still good.
      expect((await scan(deskB, makePhonePass(keyFor(keys, w - 1), eve.phone.userId, w - 1))).result).toBe("checked_in");
    },
    TIMEOUT_MS,
  );

  it(
    "a phone whose clock is up to 30 seconds out, either way, still gets in; further out is grey",
    async () => {
      ahead = 0;
      const hal = await member("hal", "Hal Rao");
      const keys = await phoneKeysOf(hal.phone);
      const w = now();
      expect((await scan(desk, makePhonePass(keyFor(keys, w + 3), hal.phone.userId, w + 3))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePhonePass(keyFor(keys, w - 3), hal.phone.userId, w - 3))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePhonePass(keyFor(keys, w - 1), hal.phone.userId, w - 1))).result).toBe("checked_in");
      await sql`DELETE FROM gym_attendance WHERE gym_id = ${gym} AND user_id = ${hal.phone.userId}`;
      expect((await scan(desk, makePhonePass(keyFor(keys, w + 1), hal.phone.userId, w + 1))).result).toBe("checked_in");
    },
    TIMEOUT_MS,
  );

  it(
    "the keys are a phone's alone: a browser's sign-in gets 403, nobody signed in 401, and they are never cached",
    async () => {
      ahead = 0;
      const address = email("ivy");
      const browser = await browserSignIn(address);
      const refused = await request("GET", KEY_PATH, { cookies: browser });
      expect(refused.statusCode).toBe(403);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "phone_only" });
      expect(refused.body).not.toMatch(/key"/);
      expect((await request("GET", KEY_PATH)).statusCode).toBe(401);

      // The same person on a phone gets them; a second phone sign-in gets others, and the first
      // phone's access token, still inside its fifteen minutes, gets nothing more.
      const phone = await phoneSignIn(address);
      const first = await phoneKeysOf(phone);
      const second = await phoneSignIn(address);
      expect((await phoneKeysOf(second))[0]?.key).not.toBe(first[0]?.key);
      const stale = await request("GET", KEY_PATH, { bearer: phone.accessToken });
      expect(stale.statusCode).toBe(403);
    },
    TIMEOUT_MS,
  );
});
