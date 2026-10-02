// A whole gym signing up at once, on ONE internet address (ROADMAP Stage 4 item 10):
// a gym's wi-fi, or a phone company's gateway that puts thousands of customers on one
// address. Real Postgres; a fake robot check and a fake Google, so no test asks
// Cloudflare or Google; the limits' own Redis, with a clock the tests move.
//
// The worst thing this could do to a real person: refuse a member at the desk because
// others share their address — or, the other way, let one busy address get past a
// person's OWN limits (two codes a day, five guesses a code, ten sends an hour) and
// guess their code. Those are the first tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { GoogleIdentity, GoogleVerifier } from "../src/modules/auth/google.js";
import { OAUTH_STATE_COOKIE } from "../src/modules/auth/tokens.js";
import type { RobotCheck, RobotCheckAnswer } from "../src/modules/orgs/gymPage/robotCheck.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

type App = Awaited<ReturnType<typeof buildApp>>;

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "burst-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

const sent: { email: string; code: string }[] = [];
const sender: EmailSender = {
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: (email, code) => {
    sent.push({ email, code });
    return Promise.resolve();
  },
};
const lastCodeFor = (email: string): string => {
  const hit = [...sent].reverse().find((s) => s.email === email);
  if (hit === undefined) throw new Error(`no code was sent to ${email}`);
  return hit.code;
};

/** "pass-…" passes, "down" is Cloudflare unreachable, anything else fails. Counts the asks. */
const robot: RobotCheck & { asked: number } = {
  siteKey: "burst-site-key",
  asked: 0,
  verify(token: string): Promise<RobotCheckAnswer> {
    robot.asked += 1;
    return Promise.resolve(token.startsWith("pass-") ? "passed" : token === "down" ? "unavailable" : "failed");
  },
};

const identities = new Map<string, GoogleIdentity>();
const google: GoogleVerifier = {
  authUrl: (state) => `https://accounts.google.test/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
  exchange: (code) => {
    const id = identities.get(code);
    return id === undefined ? Promise.reject(new Error("unknown code")) : Promise.resolve(id);
  },
};

let now = Date.now();
const redis = createMemoryRedis(() => now);

/** Each test is its own gym's address, so no test spends another's allowance. */
let gymCounter = 0;
const gymAddress = () => `10.61.${String(Math.floor(gymCounter / 250))}.${String((gymCounter++ % 250) + 1)}`;
let otherCounter = 0;
const elsewhere = () => `10.62.${String(Math.floor(otherCounter / 250))}.${String((otherCounter++ % 250) + 1)}`;

const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error?: string }).error;

d("a whole gym signing up on one internet address (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const post = (ip: string, path: string, body: unknown) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
  const get = (ip: string, path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: ip, cookies });

  /** What the sign-in page does: ask for a code; if the server asks for the robot
   *  check, answer it and ask again. */
  const askForCode = async (ip: string, email: string) => {
    const first = await post(ip, "/v1/auth/code/send", { email });
    if (first.statusCode !== 403 || errorOf(first) !== "robot_check") return first;
    return post(ip, "/v1/auth/code/send", { email, robotToken: `pass-${email}` });
  };
  const signInByCode = async (ip: string, email: string) => {
    const asked = await askForCode(ip, email);
    if (asked.statusCode !== 200) return asked;
    return post(ip, "/v1/auth/code/verify", { email, code: lastCodeFor(email) });
  };
  const signInWithGoogle = async (ip: string, identity: GoogleIdentity) => {
    identities.set(identity.subject, identity);
    const start = await get(ip, "/v1/auth/google");
    const state = start.cookies.find((c) => c.name === OAUTH_STATE_COOKIE)?.value;
    if (state === undefined) return start;
    return get(ip, `/v1/auth/google/callback?code=${identity.subject}&state=${encodeURIComponent(state)}`, {
      [OAUTH_STATE_COOKIE]: state,
    });
  };
  /** The address has already sent its first 20 codes this hour: every send now needs the check. */
  const makeBusy = async (ip: string) => {
    for (let i = 0; i < 20; i++) await redis.incrWithTtl(`rl:code_send_free:ip:${ip}`, 3600);
  };
  const ageCodes = (email: string, interval: string) =>
    sql`UPDATE sign_in_codes SET created_at = created_at - ${interval}::interval WHERE email = ${email}`;
  const codesFor = async (email: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sign_in_codes WHERE email = ${email}`)[0]?.n;

  beforeAll(async () => {
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'burst-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'burst-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), { emailSender: sender, robotCheck: robot, googleVerifier: google, redis });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'burst-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'burst-%@example.com'`;
    await sql.end({ timeout: 5 });
  });

  // ── the worst thing, first ────────────────────────────────────────────────

  it("200 different people on ONE address all sign in by code; past the 20th each passes the robot check first", { timeout: 180_000 }, async () => {
    const ip = gymAddress();
    const askedBefore = robot.asked;
    const refused: string[] = [];
    for (let i = 0; i < 200; i++) {
      const email = `burst-code-${String(i)}@example.com`;
      const res = await signInByCode(ip, email);
      if (res.statusCode !== 200) refused.push(`${email}: ${String(res.statusCode)} ${res.body}`);
    }
    expect(refused).toEqual([]);
    const accounts = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE email LIKE 'burst-code-%@example.com'`)[0]?.n;
    expect(accounts).toBe(200);
    // The first 20 needed no check; each of the other 180 was checked once.
    expect(robot.asked - askedBefore).toBe(180);
  });

  it("200 different people on ONE address all sign in with Google", { timeout: 180_000 }, async () => {
    const ip = gymAddress();
    const refused: string[] = [];
    for (let i = 0; i < 200; i++) {
      const res = await signInWithGoogle(ip, { subject: `burst-g-${String(i)}`, email: `burst-g-${String(i)}@example.com`, name: `Member ${String(i)}` });
      if (res.headers.location !== `${baseEnv.WEB_ORIGIN}/auth/google/success`) refused.push(`${String(i)}: ${String(res.statusCode)} ${String(res.headers.location)}`);
    }
    expect(refused).toEqual([]);
  });

  it("on a busy address, ONE person still gets two codes a day, and the third is refused", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    await makeBusy(ip);
    const email = "burst-daycap@example.com";
    expect((await askForCode(ip, email)).statusCode).toBe(200);
    await ageCodes(email, "61 seconds");
    expect((await askForCode(ip, email)).statusCode).toBe(200);
    await ageCodes(email, "61 seconds");
    const third = await askForCode(ip, email);
    expect(third.statusCode).toBe(429);
    expect(errorOf(third)).toBe("code_limit");
    expect(await codesFor(email)).toBe(2);
  });

  it("on a busy address, five wrong guesses still kill ONE person's code; the right one is then refused", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    await makeBusy(ip);
    const email = "burst-guess@example.com";
    expect((await askForCode(ip, email)).statusCode).toBe(200);
    const code = lastCodeFor(email);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect((await post(ip, "/v1/auth/code/verify", { email, code: wrong })).statusCode).toBe(400);
    const right = await post(ip, "/v1/auth/code/verify", { email, code });
    expect(right.statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM users WHERE email = ${email}`).length).toBe(0);
  });

  it("on a busy address, ONE person still gets ten sends an hour, and the eleventh is refused", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    await makeBusy(ip);
    const email = "burst-hourly@example.com";
    // Inside the sixty-second gap every send after the first is "too soon"; each still counts.
    for (let i = 0; i < 10; i++) expect(errorOf(await askForCode(ip, email)) ?? "sent").not.toBe("rate_limited");
    const eleventh = await askForCode(ip, email);
    expect(eleventh.statusCode).toBe(429);
    expect(errorOf(eleventh)).toBe("rate_limited");
  });

  // ── the robot check ───────────────────────────────────────────────────────

  it("the 21st send from one address without the check: asked for it, nothing sent, and nobody's allowance spent", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    for (let i = 0; i < 20; i++) expect((await post(ip, "/v1/auth/code/send", { email: `burst-free-${String(i)}@example.com` })).statusCode).toBe(200);
    const askedBefore = robot.asked;
    const email = "burst-free-21@example.com";
    const res = await post(ip, "/v1/auth/code/send", { email });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: string; message: string; robotCheckKey: string };
    expect(body).toMatchObject({ error: "robot_check", robotCheckKey: "burst-site-key" });
    expect(body.message).toMatch(/not a robot/);
    expect(robot.asked).toBe(askedBefore);
    expect(await codesFor(email)).toBe(0);
    // The same person's own ten an hour are untouched: robots typing their address
    // at a busy address cannot lock them out.
    for (let i = 0; i < 30; i++) await post(ip, "/v1/auth/code/send", { email });
    expect((await post(elsewhere(), "/v1/auth/code/send", { email })).statusCode).toBe(200);
  });

  it("a failed check sends nothing; Cloudflare unreachable is a plain 503; 30 failures and the address is refused before Cloudflare is asked", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    await makeBusy(ip);
    const email = "burst-robot@example.com";
    const failed = await post(ip, "/v1/auth/code/send", { email, robotToken: "made-up" });
    expect(failed.statusCode).toBe(403);
    expect(JSON.parse(failed.body)).toMatchObject({ error: "robot_failed", robotCheckKey: "burst-site-key" });
    const down = await post(ip, "/v1/auth/code/send", { email, robotToken: "down" });
    expect(down.statusCode).toBe(503);
    expect(errorOf(down)).toBe("robot_unavailable");
    expect(await codesFor(email)).toBe(0);

    for (let i = 1; i < 30; i++) await post(ip, "/v1/auth/code/send", { email, robotToken: "made-up" });
    const askedBefore = robot.asked;
    const refused = await post(ip, "/v1/auth/code/send", { email, robotToken: `pass-${email}` });
    expect(refused.statusCode).toBe(429);
    expect(robot.asked).toBe(askedBefore);
    expect(await codesFor(email)).toBe(0);
  });

  it("an answer sent while the address is under 20 is never asked about; one too long is a 400", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    const askedBefore = robot.asked;
    expect((await post(ip, "/v1/auth/code/send", { email: "burst-early@example.com", robotToken: "made-up" })).statusCode).toBe(200);
    expect(robot.asked).toBe(askedBefore);
    const long = await post(ip, "/v1/auth/code/send", { email: "burst-long@example.com", robotToken: "x".repeat(2049) });
    expect(long.statusCode).toBe(400);
  });

  it("the hour ends: the address's first 20 go straight through again", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    await makeBusy(ip);
    expect(errorOf(await post(ip, "/v1/auth/code/send", { email: "burst-hour-1@example.com" }))).toBe("robot_check");
    now += 3601 * 1000;
    expect((await post(ip, "/v1/auth/code/send", { email: "burst-hour-2@example.com" })).statusCode).toBe(200);
  });

  // ── each door's ceiling for one address ──────────────────────────────────

  it("sends: 500 an hour from one address even with the check; the 501st is refused", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    await makeBusy(ip);
    for (let i = 0; i < 499; i++) await redis.incrWithTtl(`rl:code_send:ip:${ip}`, 3600);
    expect((await askForCode(ip, "burst-ceiling-500@example.com")).statusCode).toBe(200);
    const over = await askForCode(ip, "burst-ceiling-501@example.com");
    expect(over.statusCode).toBe(429);
    expect(errorOf(over)).toBe("rate_limited");
    expect(await codesFor("burst-ceiling-501@example.com")).toBe(0);
  });

  it("code checks: 1,000 an hour from one address; the 1,001st is refused", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    for (let i = 0; i < 999; i++) await redis.incrWithTtl(`rl:code_verify:ip:${ip}`, 3600);
    const thousandth = await post(ip, "/v1/auth/code/verify", { email: "burst-nocode@example.com", code: "123456" });
    expect(thousandth.statusCode).toBe(400);
    const over = await post(ip, "/v1/auth/code/verify", { email: "burst-nocode-2@example.com", code: "123456" });
    expect(over.statusCode).toBe(429);
    expect(errorOf(over)).toBe("rate_limited");
  });

  it("Google: 600 steps an hour from one address; the 601st is refused", { timeout: 30_000 }, async () => {
    const ip = gymAddress();
    for (let i = 0; i < 599; i++) await redis.incrWithTtl(`rl:google:ip:${ip}`, 3600);
    expect((await get(ip, "/v1/auth/google")).statusCode).toBe(302);
    const over = await get(ip, "/v1/auth/google");
    expect(over.statusCode).toBe(429);
    expect(errorOf(over)).toBe("rate_limited");
  });
});
