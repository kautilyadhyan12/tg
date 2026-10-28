// A pass the phone makes with no signal (ROADMAP Stage 5 item 15c; spec Part 3 §12.2), against
// real Postgres: the phone's key, and the desk taking the pass the phone signed with it.
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: let a stranger in on a member's pass made
// by a phone that was signed out or replaced, or let one offline pass in twice. Those are first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { checkinPhoneKeyResponseSchema, verifyCodePhoneResponseSchema, type PhoneSessionTokens } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { makePass, makePhonePass, passWindow } from "../src/modules/orgs/checkin/pass.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

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

d("a pass the phone makes with no signal (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const sent: { email: string; code: string }[] = [];
  const sender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (email, code) => {
      sent.push({ email, code });
      return Promise.resolve();
    },
  };
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
  const phoneKeyOf = async (phone: { accessToken: string }): Promise<Buffer> => {
    const res = await request("GET", KEY_PATH, { bearer: phone.accessToken });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    return Buffer.from(checkinPhoneKeyResponseSchema.parse(JSON.parse(res.body)).key, "base64url");
  };

  const scan = async (desk: Cookies, code: string): Promise<{ result: string; person?: { name: string } }> => {
    const res = await request("POST", "/v1/checkin/scan", { payload: { code }, cookies: desk });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as { result: string; person?: { name: string } };
  };

  const visitsOf = (gymId: string, userId: string) =>
    sql<{ method: string }[]>`SELECT method FROM gym_attendance WHERE gym_id = ${gymId} AND user_id = ${userId}`;

  let gym = "";
  let desk: Cookies = {};
  const email = (local: string) => `chkph-t-${local}-${uniq()}@example.com`;

  /** A member of the gym, signed in on a phone. */
  const member = async (local: string, name: string) => {
    const address = email(local);
    const phone = await phoneSignIn(address);
    await sql`UPDATE users SET display_name = ${name} WHERE id = ${phone.userId}`;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gym}, ${phone.userId})`;
    return { email: address, phone };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      emailSender: sender,
      orgs: { gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
    });
    await api().ready();
    const owner = await browserSignIn(email("owner"));
    const made = await request("POST", "/v1/orgs", {
      cookies: owner,
      payload: { trainsHere: true, name: "Lotus Yoga", city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" },
    });
    expect(made.statusCode).toBe(201);
    gym = (JSON.parse(made.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gym}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const added = await request("POST", `/v1/orgs/${gym}/checkin-devices`, { cookies: owner, payload: { name: "Front desk" } });
    expect(added.statusCode).toBe(201);
    const token = (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "";
    const claimed = await request("POST", "/v1/checkin/device/claim", { payload: { token } });
    expect(claimed.statusCode).toBe(200);
    desk = cookieMap(claimed);
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  it(
    "THE WORST THING: a phone's pass lets its member in once, and never once that phone is signed out or replaced",
    async () => {
      const asha = await member("asha", "Asha Walk");
      const key = await phoneKeyOf(asha.phone);
      const now = passWindow(new Date());

      // No signal: the phone signs this window's pass itself. In once; the same pass again,
      // or the server's own pass for the same window, is grey.
      const pass = makePhonePass(key, asha.phone.userId, now);
      const first = await scan(desk, pass);
      expect(first.result).toBe("checked_in");
      expect(first.person).toEqual({ name: "Asha Walk" });
      expect((await scan(desk, pass)).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePass(KEY, asha.phone.userId, now))).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, asha.phone.userId)).toEqual([{ method: "pass" }]);

      // A newer phone signs in: the old phone's next pass, made with the key it still holds, is dead.
      const newPhone = await phoneSignIn(asha.email);
      const oldPhonesPass = makePhonePass(key, asha.phone.userId, now + 1);
      expect((await scan(desk, oldPhonesPass)).result).toBe("fresh_pass_needed");
      // The new phone has a key of its own, and its pass works.
      const newKey = await phoneKeyOf(newPhone);
      expect(newKey.equals(key)).toBe(false);
      await sql`DELETE FROM gym_attendance WHERE gym_id = ${gym} AND user_id = ${asha.phone.userId}`;
      expect((await scan(desk, makePhonePass(newKey, asha.phone.userId, now + 1))).result).toBe("checked_in");

    },
    TIMEOUT_MS,
  );

  it(
    "THE WORST THING: a phone signed out makes passes nobody takes",
    async () => {
      const fay = await member("fay", "Fay Moss");
      const key = await phoneKeyOf(fay.phone);
      const out = await request("POST", "/v1/auth/logout", { payload: { refreshToken: fay.phone.refreshToken } });
      expect(out.statusCode).toBeLessThan(300);
      // This window and the next are unused, and good for 60 seconds: only the sign-out stops them.
      const now = passWindow(new Date());
      expect((await scan(desk, makePhonePass(key, fay.phone.userId, now))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePhonePass(key, fay.phone.userId, now + 1))).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, fay.phone.userId)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "THE WORST THING: one member's phone key makes nobody else's pass, and a stranger's is red",
    async () => {
      const ben = await member("ben", "Ben Row");
      const cara = await member("cara", "Cara Lane");
      const bensKey = await phoneKeyOf(ben.phone);
      const now = passWindow(new Date());
      expect((await scan(desk, makePhonePass(bensKey, cara.phone.userId, now))).result).toBe("fresh_pass_needed");
      expect(await visitsOf(gym, cara.phone.userId)).toEqual([]);

      // Somebody with the app who is not a member: their own phone's pass is read, and is red.
      const stranger = await phoneSignIn(email("stranger"));
      const strangersPass = makePhonePass(await phoneKeyOf(stranger), stranger.userId, now);
      expect((await scan(desk, strangersPass)).result).toBe("not_a_member");
    },
    TIMEOUT_MS,
  );

  it(
    "a phone whose clock is up to 30 seconds out still gets in; further out is grey",
    async () => {
      const dev = await member("dev", "Dev Rao");
      const key = await phoneKeyOf(dev.phone);
      const now = passWindow(new Date());
      expect((await scan(desk, makePhonePass(key, dev.phone.userId, now + 3))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePhonePass(key, dev.phone.userId, now - 3))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePhonePass(key, dev.phone.userId, now + 1))).result).toBe("checked_in");
    },
    TIMEOUT_MS,
  );

  it(
    "the key is a phone's alone: a browser's sign-in gets 403, nobody signed in 401, and it is never cached",
    async () => {
      const address = email("eve");
      const browser = await browserSignIn(address);
      const refused = await request("GET", KEY_PATH, { cookies: browser });
      expect(refused.statusCode).toBe(403);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "phone_only" });
      expect(refused.body).not.toMatch(/key"/);
      expect((await request("GET", KEY_PATH)).statusCode).toBe(401);

      // The same person on a phone gets it; a second phone sign-in gets another, and the first
      // phone's access token, still inside its fifteen minutes, gets nothing more.
      const phone = await phoneSignIn(address);
      const first = await phoneKeyOf(phone);
      const second = await phoneSignIn(address);
      expect((await phoneKeyOf(second)).equals(first)).toBe(false);
      const stale = await request("GET", KEY_PATH, { bearer: phone.accessToken });
      expect(stale.statusCode).toBe(403);
    },
    TIMEOUT_MS,
  );
});
