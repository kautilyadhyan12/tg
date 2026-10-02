// The gym page's robot check (ROADMAP 20c-iv-a): what is sent to Cloudflare, and how
// each of its replies is read. The real Siteverify is not called here.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createRobotCheck, TEST_SECRET_KEY, TEST_SITE_KEY } from "../src/modules/orgs/gymPage/robotCheck.js";

describe("the robot check's keys", () => {
  const prod = {
    DATABASE_URL: "postgres://x:y@localhost:5432/z",
    WEB_ORIGIN: "http://localhost:5173",
    JWT_SECRET: "config-test-secret-0123456789abcdef-32", // gitleaks:allow
    REDIS_URL: "redis://localhost:6379",
    NODE_ENV: "production",
    RESEND_API_KEY: "re_x",
    EMAIL_FROM: "AI Home Gym <hi@example.com>",
    PHOTO_DIR: "/srv/aihg/photos",
  };

  it("production refuses to start without them, so the always-pass test pair can never be live", () => {
    expect(() => loadConfig(prod)).toThrow(/TURNSTILE_SECRET_KEY is required in production/);
    expect(loadConfig({ ...prod, TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" }).TURNSTILE_SECRET_KEY).toBe("secret");
  });

  it("the two are set together, in every environment", () => {
    const dev = { ...prod, NODE_ENV: "development" };
    expect(() => loadConfig({ ...dev, TURNSTILE_SITE_KEY: "site" })).toThrow(/set together/);
    expect(() => loadConfig({ ...dev, TURNSTILE_SECRET_KEY: "secret" })).toThrow(/set together/);
    expect(loadConfig(dev).TURNSTILE_SECRET_KEY).toBeUndefined();
  });
});

interface Sent {
  url: string;
  body: unknown;
}

const fetchAnswering = (answer: () => Promise<{ ok: boolean; json(): Promise<unknown> }>, sent: Sent[]) =>
  (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) as unknown });
    return answer();
  };

const reply = (ok: boolean, body: unknown) => () => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe("the gym page's robot check", () => {
  it("sends only our secret and the token, to Cloudflare's Siteverify", async () => {
    const sent: Sent[] = [];
    const check = createRobotCheck(
      { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" },
      fetchAnswering(reply(true, { success: true, action: "enquiry" }), sent),
    );
    expect(check.siteKey).toBe("site-key");
    expect(await check.verify("the-token", "enquiry")).toBe("passed");
    expect(sent).toEqual([
      { url: "https://challenges.cloudflare.com/turnstile/v0/siteverify", body: { secret: "secret-key", response: "the-token" } },
    ]);
  });

  it("uses Cloudflare's always-pass test pair when no keys are set", async () => {
    const sent: Sent[] = [];
    const check = createRobotCheck({}, fetchAnswering(reply(true, { success: true }), sent));
    expect(check.siteKey).toBe(TEST_SITE_KEY);
    await check.verify("XXXX.DUMMY.TOKEN.XXXX", "enquiry");
    expect(sent[0]?.body).toEqual({ secret: TEST_SECRET_KEY, response: "XXXX.DUMMY.TOKEN.XXXX" });
  });

  it.each([
    ["a failed check", reply(true, { success: false, "error-codes": ["invalid-input-response"] }), "failed"],
    ["a spent token", reply(true, { success: false, "error-codes": ["timeout-or-duplicate"] }), "failed"],
    ["Cloudflare's own fault", reply(true, { success: false, "error-codes": ["internal-error"] }), "unavailable"],
    ["an error status", reply(false, {}), "unavailable"],
    ["a reply of another shape", reply(true, { ok: "yes" }), "unavailable"],
    ["a reply that is not JSON", () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("bad")) }), "unavailable"],
    ["no answer at all", () => Promise.reject(new TypeError("fetch failed")), "unavailable"],
  ] as const)("reads %s as %s", async (_name, answer, expected) => {
    const check = createRobotCheck({ TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" }, fetchAnswering(answer, []));
    expect(await check.verify("token", "enquiry")).toBe(expected);
  });

  // One site key serves the gym page's form and sign-in, so an answer solved on one is
  // refused on the other (Cloudflare's own guidance: check the reply's `action`).
  it("with our keys, an answer solved for another form is refused", async () => {
    const check = createRobotCheck({ TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" }, fetchAnswering(reply(true, { success: true, action: "enquiry" }), []));
    expect(await check.verify("token", "sign_in")).toBe("failed");
    expect(await check.verify("token", "enquiry")).toBe("passed");
    const none = createRobotCheck({ TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" }, fetchAnswering(reply(true, { success: true }), []));
    expect(await none.verify("token", "sign_in")).toBe("failed");
  });

  it("with Cloudflare's test pair, whose replies name no form, the action is not checked", async () => {
    const check = createRobotCheck({}, fetchAnswering(reply(true, { success: true, action: "" }), []));
    expect(await check.verify("token", "sign_in")).toBe("passed");
  });
});
