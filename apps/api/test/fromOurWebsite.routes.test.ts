// A change is taken from a browser only when our own website sent it (ROADMAP Stage 4
// item 17), against real Postgres.
//
// THE WORST THING THIS JOB COULD DO: a page on another website changes a signed-in
// owner's account with their own cookies, or the check locks out what must get in: the
// console's own saves, a payment company's message, an unsubscribe. The first test is the
// first half of that; the rest is the second.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../src/modules/auth/tokens.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const WEB_ORIGIN = "http://localhost:5173";
const API_HOST = "localhost:3005";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN,
  JWT_SECRET: "fromourwebsite-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const TIMEOUT_MS = 60_000;

type App = Awaited<ReturnType<typeof buildApp>>;
type Res = Awaited<ReturnType<App["inject"]>>;

let ipCounter = 0;
const nextIp = () => `10.33.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const TAG = "fromourwebsite";
const run = String(Date.now() % 1_000_000);

/** What a browser on another website sends with the owner's cookies. */
const ANOTHER_SITE = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
/** What the console sends: our website, a different site from the api. */
const OUR_WEBSITE = { origin: WEB_ORIGIN, "sec-fetch-site": "cross-site" };

const refusedAsCrossSite = (res: Res) => {
  expect(res.statusCode, res.body).toBe(403);
  expect(res.json<{ error: string }>().error).toBe("cross_site_request");
  expect(res.cookies).toEqual([]);
};
const notRefusedAsCrossSite = (res: Res) => {
  expect(res.body).not.toContain("cross_site_request");
};

d("a change is taken only from our website (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}%`}`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${people})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${people})`;
    await sql`DELETE FROM users WHERE id IN (${people})`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv));
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  let personSeq = 0;
  const makeOwner = async (): Promise<{ userId: string; cookies: Record<string, string> }> => {
    const email = `${TAG}${run}p${String(personSeq++)}@gmail.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", ...OUR_WEBSITE },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "Own Name" }),
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", ...OUR_WEBSITE },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode, login.body).toBe(200);
    const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
    expect(Object.keys(cookies)).toEqual(expect.arrayContaining([ACCESS_COOKIE, REFRESH_COOKIE]));
    return { userId, cookies };
  };

  const nameOf = async (userId: string) =>
    (await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`)[0]?.display_name;
  const liveSessions = async (userId: string) =>
    Number((await sql<{ n: string }[]>`SELECT count(*) AS n FROM refresh_tokens WHERE user_id = ${userId} AND revoked_at IS NULL`)[0]?.n);

  it("another website cannot change a signed-in owner's account with their cookies, in any way a browser sends it", { timeout: TIMEOUT_MS }, async () => {
    const owner = await makeOwner();
    const sessionsBefore = await liveSessions(owner.userId);
    expect(sessionsBefore).toBeGreaterThan(0);
    const ways: { name: string; headers: Record<string, string> }[] = [
      { name: "a cross-site fetch", headers: ANOTHER_SITE },
      { name: "a page on another part of our own domain", headers: { origin: "https://blog.localhost", "sec-fetch-site": "same-site" } },
      { name: "a browser without Sec-Fetch-Site", headers: { origin: "https://evil.example" } },
      { name: "a sandboxed frame", headers: { origin: "null", "sec-fetch-site": "cross-site" } },
    ];
    for (const way of ways) {
      // A JSON save, as a script on the other page can send it.
      const save = await api().inject({
        method: "PATCH",
        url: "/v1/users/me",
        remoteAddress: nextIp(),
        cookies: owner.cookies,
        headers: { "content-type": "application/json", ...way.headers },
        payload: JSON.stringify({ displayName: "Changed by another website" }),
      });
      refusedAsCrossSite(save);
      // A plain form post, which needs no permission from the browser at all, to a
      // route that takes no body: signing the owner out.
      const form = await api().inject({
        method: "POST",
        url: "/v1/auth/logout",
        remoteAddress: nextIp(),
        cookies: owner.cookies,
        headers: { "content-type": "text/plain", ...way.headers },
        payload: "x",
      });
      refusedAsCrossSite(form);
    }
    expect(await nameOf(owner.userId)).toBe("Own Name");
    expect(await liveSessions(owner.userId)).toBe(sessionsBefore);
  });

  it("the console's own save goes through, and the same owner is still signed in", { timeout: TIMEOUT_MS }, async () => {
    const owner = await makeOwner();
    for (const headers of [OUR_WEBSITE, { origin: WEB_ORIGIN }]) {
      const save = await api().inject({
        method: "PATCH",
        url: "/v1/users/me",
        remoteAddress: nextIp(),
        cookies: owner.cookies,
        headers: { "content-type": "application/json", ...headers },
        payload: JSON.stringify({ displayName: "Saved From The Console" }),
      });
      expect(save.statusCode, save.body).toBe(200);
    }
    expect(await nameOf(owner.userId)).toBe("Saved From The Console");
    const me = await api().inject({ method: "GET", url: "/v1/users/me", remoteAddress: nextIp(), cookies: owner.cookies, headers: ANOTHER_SITE });
    expect(me.statusCode).toBe(200);
  });

  it("a payment company's or Resend's message reaches its own check, which refuses it for its own reason", { timeout: TIMEOUT_MS }, async () => {
    for (const path of ["/v1/webhooks/paddle", "/v1/webhooks/razorpay", "/v1/webhooks/square", "/v1/webhooks/resend"]) {
      // A server sends neither Origin nor Sec-Fetch-Site.
      const res = await api().inject({
        method: "POST",
        url: path,
        remoteAddress: nextIp(),
        headers: { host: API_HOST, "content-type": "application/json" },
        payload: JSON.stringify({ event_type: "nothing" }),
      });
      notRefusedAsCrossSite(res);
    }
  });

  // The Origin a browser puts on a form post from a page to its own address follows the
  // page's own referrer policy (the Fetch standard, "serializing a request origin"):
  // "null" under no-referrer, the page's own origin otherwise.
  const originAFormPostSends = (policy: string | undefined) => (policy === "no-referrer" ? "null" : `http://${API_HOST}`);

  it("an unsubscribe still reaches its own page: a mail program's one click, and the page's button in a signed-in browser, old or new", { timeout: TIMEOUT_MS }, async () => {
    const owner = await makeOwner();
    for (const path of ["/v1/email/unsubscribe?t=not-a-token", "/v1/email/leads/unsubscribe?t=not-a-token", "/v1/email/not-me?t=not-a-token"]) {
      const oneClick = await api().inject({
        method: "POST",
        url: path,
        remoteAddress: nextIp(),
        headers: { host: API_HOST, "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });
      notRefusedAsCrossSite(oneClick);
      const shown = await api().inject({ method: "GET", url: path, remoteAddress: nextIp(), headers: { host: API_HOST } });
      expect(shown.headers["content-type"]).toMatch(/text\/html/);
      const policy = shown.headers["referrer-policy"];
      const origin = originAFormPostSends(typeof policy === "string" ? policy : undefined);
      // A browser since 2023 adds Sec-Fetch-Site; Safari before 16.4 does not.
      for (const site of [{ "sec-fetch-site": "same-origin" }, {}]) {
        const button = await api().inject({
          method: "POST",
          url: path,
          remoteAddress: nextIp(),
          cookies: owner.cookies,
          headers: { origin, host: API_HOST, "content-type": "application/x-www-form-urlencoded", ...site },
          payload: "",
        });
        notRefusedAsCrossSite(button);
        expect(button.headers["content-type"]).toMatch(/text\/html/);
      }
    }
  });
});
