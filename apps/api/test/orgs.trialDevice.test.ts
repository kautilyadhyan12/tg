// One device, one free trial: the browser mark (ROADMAP Stage 3 item 2c; RULINGS 2026-09-08),
// against real Postgres.
//
// THE WORST THING THIS JOB COULD DO: refuse a free trial to an honest owner whose browser
// never started one, because another browser did. The first test is that. A "browser" here
// is the one cookie it carries; a sign-in is the person's own cookies beside it.
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { cookieOptions } from "../src/modules/auth/tokens.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "trialdevice-test-secret-0123456789", // dummy test value, gitleaks:allow
  // Loud on purpose: the last test reads every line written and finds no mark in it.
  LOG_LEVEL: "info",
};
const TIMEOUT_MS = 60_000;
const MARK = "trial_mark";

type App = Awaited<ReturnType<typeof buildApp>>;
type Account = { userId: string; cookies: Record<string, string> };
/** A browser: the mark its cookie holds, or none. */
type Browser = { mark: string | null };
type Res = Awaited<ReturnType<App["inject"]>>;

let ipCounter = 0;
const nextIp = () => `10.28.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

const TAG = "trialdevice";
const run = String(Date.now() % 1_000_000);

// The web and the api are on two sites in production, so a cookie without SameSite=None and
// Secure is never sent with the console's requests and the mark would quietly never refuse.
describe("the mark's cookie in production", () => {
  it("is sent cross-site, only over https, and never to page scripts", () => {
    expect(cookieOptions({ NODE_ENV: "production" }, 60, "/v1/orgs")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/v1/orgs",
      maxAge: 60,
    });
  });
});

d("one device, one free trial (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  // Every byte the app writes while this file runs, for the last test.
  let written = "";
  let restore: (() => void) | undefined;
  // Every mark a browser was given here.
  const marksSeen: string[] = [];

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}%`}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE id IN (${people})`;
  };

  beforeAll(async () => {
    await cleanup();
    const real = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      written += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return Reflect.apply(real, process.stdout, [chunk, ...rest]) as boolean;
    });
    restore = () => {
      process.stdout.write = real;
    };
    app = await buildApp(loadConfig(baseEnv));
  }, TIMEOUT_MS);

  afterAll(async () => {
    restore?.();
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  const send = (method: "GET" | "POST", path: string, cookies: Record<string, string>) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      cookies,
      ...(method === "POST" ? { payload: "{}" } : {}),
    });

  let personSeq = 0;
  /** A person with a confirmed address on a real provider's domain, signed in. */
  const makeOwner = async (): Promise<Account> => {
    const email = `${TAG}${run}p${String(personSeq++)}@gmail.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "Trial Device" }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
  };

  let gymSeq = 0;
  const makeGym = async (owner: Account): Promise<string> => {
    const res = await api().inject({
      method: "POST",
      url: "/v1/orgs",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies: owner.cookies,
      payload: JSON.stringify({
        trainsHere: false,
        name: `Trial Device Gym ${run} ${String(gymSeq++)}`,
        city: "Pune",
        country: "IN",
        timezone: "Asia/Kolkata",
      }),
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { org: { id: string } }).org.id;
  };

  const cookiesFor = (who: Account, browser: Browser) =>
    browser.mark === null ? who.cookies : { ...who.cookies, [MARK]: browser.mark };

  /** Press "Start free trial" in this browser; a mark the answer sets is kept by the browser. */
  const startTrial = async (who: Account, browser: Browser, gymId: string): Promise<Res> => {
    const res = await send("POST", `/v1/orgs/${gymId}/trial`, cookiesFor(who, browser));
    const set = res.cookies.find((c) => c.name === MARK);
    if (set !== undefined) {
      browser.mark = set.value;
      marksSeen.push(set.value);
    }
    return res;
  };
  const onScreen = async (who: Account, browser: Browser, gymId: string) => {
    const res = await send("GET", "/v1/orgs/mine", cookiesFor(who, browser));
    expect(res.statusCode).toBe(200);
    const org = (
      JSON.parse(res.body) as { orgs: { id: string; ownerTrialUsed: boolean | null; deviceTrialUsed: boolean | null }[] }
    ).orgs.find((o) => o.id === gymId);
    if (org === undefined) throw new Error("gym missing from /v1/orgs/mine");
    return { ownerTrialUsed: org.ownerTrialUsed, deviceTrialUsed: org.deviceTrialUsed };
  };
  const body = (res: Res) => JSON.parse(res.body) as { error?: string; message?: string };

  it(
    "WORST THING: a browser that never started a trial is never refused because another browser did",
    async () => {
      const first: Browser = { mark: null };
      const a = await makeOwner();
      expect((await startTrial(a, first, await makeGym(a))).statusCode).toBe(200);
      expect(first.mark).not.toBeNull();

      // A second browser, with no mark at all.
      const second: Browser = { mark: null };
      const b = await makeOwner();
      const bGym = await makeGym(b);
      expect(await onScreen(b, second, bGym)).toEqual({ ownerTrialUsed: false, deviceTrialUsed: false });
      expect((await startTrial(b, second, bGym)).statusCode).toBe(200);
      expect(second.mark).not.toBe(first.mark);

      // A third browser carrying a well-formed mark that never started anything.
      const third: Browser = { mark: randomBytes(32).toString("hex") };
      const c = await makeOwner();
      const cGym = await makeGym(c);
      expect(await onScreen(c, third, cGym)).toEqual({ ownerTrialUsed: false, deviceTrialUsed: false });
      expect((await startTrial(c, third, cGym)).statusCode).toBe(200);
    },
    TIMEOUT_MS * 2,
  );

  it("a browser that started a trial starts no other, under another person's account, and the screen says so first", async () => {
    const browser: Browser = { mark: null };
    const a = await makeOwner();
    expect((await startTrial(a, browser, await makeGym(a))).statusCode).toBe(200);

    const b = await makeOwner();
    const bGym = await makeGym(b);
    expect(await onScreen(b, browser, bGym)).toEqual({ ownerTrialUsed: false, deviceTrialUsed: true });
    const refused = await startTrial(b, browser, bGym);
    expect(refused.statusCode).toBe(409);
    expect(body(refused).error).toBe("trial_used_on_device");
    expect(body(refused).message).toBe(
      "A free trial has already been used on this computer, so this gym needs a plan to start.",
    );
    expect((await sql`SELECT 1 FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${bGym}`).length).toBe(0);

    // The same person in another browser still has their own trial.
    const elsewhere: Browser = { mark: null };
    expect(await onScreen(b, elsewhere, bGym)).toEqual({ ownerTrialUsed: false, deviceTrialUsed: false });
    expect((await startTrial(b, elsewhere, bGym)).statusCode).toBe(200);
  });

  it("the mark: a cookie no page can read, only for the trial's routes, kept 400 days; the database holds only its hash", async () => {
    const a = await makeOwner();
    const gymId = await makeGym(a);
    const res = await send("POST", `/v1/orgs/${gymId}/trial`, a.cookies);
    expect(res.statusCode).toBe(200);
    const set = res.cookies.find((c) => c.name === MARK);
    if (set === undefined) throw new Error("no mark was set");
    marksSeen.push(set.value);
    expect(set.value).toMatch(/^[0-9a-f]{64}$/);
    expect(set.httpOnly).toBe(true);
    expect(set.path).toBe("/v1/orgs");
    expect(set.maxAge).toBe(400 * 24 * 60 * 60);
    const rows = await sql<{ trial_device_hash: string | null }[]>`
      SELECT trial_device_hash FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    expect(rows.map((r) => r.trial_device_hash)).toEqual([sha256(set.value)]);
    const raw = await sql`SELECT 1 FROM subscriptions WHERE trial_device_hash = ${set.value}`;
    expect(raw.length).toBe(0);
  });

  it("a browser keeps the mark it has; a cookie that is not a mark is no mark", async () => {
    const kept: Browser = { mark: randomBytes(32).toString("hex") };
    const before = kept.mark;
    const a = await makeOwner();
    expect((await startTrial(a, kept, await makeGym(a))).statusCode).toBe(200);
    expect(kept.mark).toBe(before);

    // A made-up value refuses nobody and is replaced by a real mark.
    const forged: Browser = { mark: "not-a-mark" };
    const b = await makeOwner();
    const bGym = await makeGym(b);
    expect(await onScreen(b, forged, bGym)).toEqual({ ownerTrialUsed: false, deviceTrialUsed: false });
    expect((await startTrial(b, forged, bGym)).statusCode).toBe(200);
    expect(forged.mark).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a request that carries no mark is refused by nobody's mark, and its trial is marked with a new one", async () => {
    const browser: Browser = { mark: null };
    const a = await makeOwner();
    expect((await startTrial(a, browser, await makeGym(a))).statusCode).toBe(200);
    const b = await makeOwner();
    const bGym = await makeGym(b);
    const res = await send("POST", `/v1/orgs/${bGym}/trial`, b.cookies);
    expect(res.statusCode).toBe(200);
    const given = res.cookies.find((c) => c.name === MARK);
    if (given === undefined) throw new Error("a request with no mark was given none");
    marksSeen.push(given.value);
    expect(given.value).not.toBe(browser.mark);
    const rows = await sql<{ trial_device_hash: string | null }[]>`
      SELECT trial_device_hash FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${bGym}`;
    expect(rows.map((r) => r.trial_device_hash)).toEqual([sha256(given.value)]);
  });

  it("the person's own rule speaks first: an owner's second gym in the same browser is told it is one per person", async () => {
    const browser: Browser = { mark: null };
    const a = await makeOwner();
    expect((await startTrial(a, browser, await makeGym(a))).statusCode).toBe(200);
    const second = await makeGym(a);
    expect(await onScreen(a, browser, second)).toEqual({ ownerTrialUsed: true, deviceTrialUsed: true });
    const refused = await startTrial(a, browser, second);
    expect(refused.statusCode).toBe(409);
    expect(body(refused).error).toBe("trial_already_used");
  });

  it("a stranger in a marked browser pressing another gym's trial learns nothing: 404, and nothing is written", async () => {
    const browser: Browser = { mark: null };
    const stranger = await makeOwner();
    expect((await startTrial(stranger, browser, await makeGym(stranger))).statusCode).toBe(200);
    const owner = await makeOwner();
    const gymId = await makeGym(owner);
    const res = await startTrial(stranger, browser, gymId);
    expect(res.statusCode).toBe(404);
    expect(body(res).error).toBe("org_not_found");
    expect((await sql`SELECT 1 FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`).length).toBe(0);
    // The gym's own owner, in their own browser, still starts it.
    expect((await startTrial(owner, { mark: null }, gymId)).statusCode).toBe(200);
  });

  it("two owners pressing at once in one browser: one trial starts, the other is refused", async () => {
    const mark = randomBytes(32).toString("hex");
    const a = await makeOwner();
    const b = await makeOwner();
    const [aGym, bGym] = [await makeGym(a), await makeGym(b)];
    const [one, two] = await Promise.all([
      send("POST", `/v1/orgs/${aGym}/trial`, { ...a.cookies, [MARK]: mark }),
      send("POST", `/v1/orgs/${bGym}/trial`, { ...b.cookies, [MARK]: mark }),
    ]);
    marksSeen.push(mark);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 409]);
    const refused = one.statusCode === 409 ? one : two;
    expect(body(refused).error).toBe("trial_used_on_device");
    const rows = await sql`SELECT 1 FROM subscriptions WHERE trial_device_hash = ${sha256(mark)}`;
    expect(rows.length).toBe(1);
  });

  it("no mark, and no hash of one, is ever written to the log", async () => {
    // A second server with request logging on (it is off under NODE_ENV test), so every
    // request line, with its cookie and Set-Cookie, is really written and read here.
    const loud = await buildApp(loadConfig({ ...baseEnv, NODE_ENV: "development", LOG_LEVEL: "trace" }));
    try {
      const a = await makeOwner();
      const gymId = await makeGym(a);
      const mark = randomBytes(32).toString("hex");
      marksSeen.push(mark);
      const before = written.length;
      const started = await loud.inject({
        method: "POST",
        url: `/v1/orgs/${gymId}/trial`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        cookies: { ...a.cookies, [MARK]: mark },
        payload: "{}",
      });
      expect(started.statusCode).toBe(200);
      expect(started.cookies.find((c) => c.name === MARK)?.value).toBe(mark);
      const mine = await loud.inject({ method: "GET", url: "/v1/orgs/mine", remoteAddress: nextIp(), cookies: { ...a.cookies, [MARK]: mark } });
      expect(mine.statusCode).toBe(200);
      const lines = written.slice(before);
      expect(lines).toContain(`/v1/orgs/${gymId}/trial`);
      expect(lines).toContain("/v1/orgs/mine");
    } finally {
      await loud.close();
    }
    expect(marksSeen.length).toBeGreaterThan(5);
    for (const mark of marksSeen) {
      expect(written).not.toContain(mark);
      expect(written).not.toContain(sha256(mark));
    }
  });
});
