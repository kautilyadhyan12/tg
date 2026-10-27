// Sign in with Google on the phone (ROADMAP Stage 5 item 12d), against real Postgres.
// DATABASE_URL-gated. Google's answers are real signed tokens made here with a test key,
// checked by the REAL verifier (the SDK's own signature, issuer, audience and time check),
// handed that key in place of Google's: nothing here calls Google.
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { googlePhoneStartResponseSchema, verifyCodePhoneResponseSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createGooglePhoneVerifier } from "../src/modules/auth/google.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

type App = Awaited<ReturnType<typeof buildApp>>;

const CLIENT_ID = "our-app.apps.googleusercontent.com";
const OTHER_APP = "somebody-elses-app.apps.googleusercontent.com";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gphone-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

let ipCounter = 0;
const nextIp = () => `10.42.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const googleKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const strangerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-google-key";
const keys = () => Promise.resolve({ [KID]: googleKey.publicKey.export({ type: "spki", format: "pem" }).toString() });

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** A signed id token in Google's shape. */
function idToken(claims: Record<string, unknown>, key: KeyObject = googleKey.privateKey): string {
  const signed = `${b64url({ alg: "RS256", typ: "JWT", kid: KID })}.${b64url(claims)}`;
  const signature = createSign("RSA-SHA256").update(signed).sign(key).toString("base64url");
  return `${signed}.${signature}`;
}

const nowS = () => Math.floor(Date.now() / 1000);
const claimsFor = (email: string, nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  azp: "our-android-client.apps.googleusercontent.com",
  sub: `google-${email}`,
  email,
  email_verified: true,
  name: "Test Person",
  iat: nowS(),
  exp: nowS() + 3600,
  nonce,
  ...extra,
});

d("sign in with Google on the phone (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  let app: App | undefined;
  let unconfigured: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const post = (path: string, body: unknown, opts: { ip?: string; origin?: string; to?: App } = {}) =>
    (opts.to ?? api()).inject({
      method: "POST",
      url: path,
      remoteAddress: opts.ip ?? nextIp(),
      headers: { "content-type": "application/json", ...(opts.origin === undefined ? {} : { origin: opts.origin }) },
      payload: JSON.stringify(body),
    });

  const nonce = async (ip?: string): Promise<string> => {
    const res = await post("/v1/auth/google/phone/start", {}, ip === undefined ? {} : { ip });
    expect(res.statusCode).toBe(200);
    return googlePhoneStartResponseSchema.parse(JSON.parse(res.body)).nonce;
  };
  const signIn = (token: string, ip?: string) => post("/v1/auth/google/phone", { idToken: token }, ip === undefined ? {} : { ip });
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };
  const accounts = async (email: string) => (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`).map((r) => r.id);

  beforeAll(async () => {
    await sql`DELETE FROM users WHERE email LIKE 'gphone12d-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), { googlePhoneVerifier: createGooglePhoneVerifier({ GOOGLE_CLIENT_ID: CLIENT_ID }, keys) });
    unconfigured = await buildApp(loadConfig(baseEnv), { googlePhoneVerifier: null });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (unconfigured !== undefined) await unconfigured.close();
    await sql.end({ timeout: 5 });
  });

  // THE WORST THING: somebody gets into another person's account with a Google answer that
  // was made for another app, carries an email Google has not confirmed, or is used again.
  describe("the worst thing: nobody gets into an account that is not theirs", () => {
    const owner = "gphone12d-owner@example.com";
    let ownerId = "";

    beforeAll(async () => {
      const res = await signIn(idToken(claimsFor(owner, await nonce())));
      expect(res.statusCode).toBe(200);
      ownerId = (await accounts(owner))[0] ?? "";
      expect(ownerId).not.toBe("");
    });

    const refusedCases: [string, (n: string) => string][] = [
      ["made for another app", (n) => idToken(claimsFor(owner, n, { aud: OTHER_APP, sub: "attacker" }))],
      ["an email Google has not confirmed", (n) => idToken(claimsFor(owner, n, { email_verified: false, sub: "attacker" }))],
      ["no word on whether the email is confirmed", (n) => idToken(claimsFor(owner, n, { email_verified: undefined, sub: "attacker" }))],
      ["the confirmation sent as the word \"true\"", (n) => idToken(claimsFor(owner, n, { email_verified: "true", sub: "attacker" }))],
      ["signed by a key that is not Google's", (n) => idToken(claimsFor(owner, n, { sub: "attacker" }), strangerKey.privateKey)],
      ["not issued by Google", (n) => idToken(claimsFor(owner, n, { iss: "https://accounts.evil.example", sub: "attacker" }))],
      ["out of date", (n) => idToken(claimsFor(owner, n, { iat: nowS() - 7200, exp: nowS() - 3600, sub: "attacker" }))],
      ["no one-time word", () => idToken(claimsFor(owner, "", { nonce: undefined, sub: "attacker" }))],
      ["a one-time word the server never gave", () => idToken(claimsFor(owner, "a".repeat(64), { sub: "attacker" }))],
      ["a signature cut off", (n) => idToken(claimsFor(owner, n, { sub: "attacker" })).slice(0, -10)],
    ];
    it.each(refusedCases)("an answer %s is refused and signs nobody in", async (_name, make) => {
      const res = await signIn(make(await nonce()));
      expect(res.statusCode).toBe(401);
      expect(errorOf(res)).toMatchObject({ error: "google_failed", message: "Google sign-in didn't work. Try again, or sign in with your email." });
      expect(res.body).not.toContain("refreshToken");
      const linked = await sql`SELECT 1 FROM auth_identities WHERE provider = 'google' AND subject = 'attacker'`;
      expect(linked).toHaveLength(0);
    });

    it("the same answer used a second time is refused", async () => {
      const token = idToken(claimsFor(owner, await nonce()));
      expect((await signIn(token)).statusCode).toBe(200);
      const again = await signIn(token);
      expect(again.statusCode).toBe(401);
      expect(errorOf(again).error).toBe("google_failed");
    });

    it("a known address is matched to its own account, never a second one", async () => {
      const res = await signIn(idToken(claimsFor(owner, await nonce())));
      const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
      expect(body.user.id).toBe(ownerId);
      expect(body.isNewAccount).toBe(false);
      expect(await accounts(owner)).toEqual([ownerId]);
    });

    it("an account that is no longer open is refused", async () => {
      const email = "gphone12d-closed@example.com";
      expect((await signIn(idToken(claimsFor(email, await nonce())))).statusCode).toBe(200);
      await sql`UPDATE users SET status = 'deleted' WHERE email = ${email}`;
      const res = await signIn(idToken(claimsFor(email, await nonce())));
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("refreshToken");
    });
  });

  it("a new address gets its account and a phone's session", async () => {
    const email = "gphone12d-new@example.com";
    const res = await signIn(idToken(claimsFor(email, await nonce())));
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.cookies).toEqual([]);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    expect(body.isNewAccount).toBe(true);
    expect(body.user.email).toBe(email);
    const rows = await sql`SELECT client FROM refresh_tokens WHERE user_id = ${body.user.id} AND revoked_at IS NULL`;
    expect(rows.map((r) => r["client"] as string)).toEqual(["phone"]);
  });

  it("signing in with Google on a second phone signs the first one out", async () => {
    const email = "gphone12d-twophones@example.com";
    const first = verifyCodePhoneResponseSchema.parse(JSON.parse((await signIn(idToken(claimsFor(email, await nonce())))).body));
    expect((await signIn(idToken(claimsFor(email, await nonce())))).statusCode).toBe(200);
    const refused = await post("/v1/auth/refresh", { refreshToken: first.tokens.refreshToken });
    expect(refused.statusCode).toBe(401);
  });

  it("a body without Google's answer is refused", async () => {
    const res = await post("/v1/auth/google/phone", { token: "x" });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).error).toBe("validation_error");
  });

  it("a browser is refused both routes: it never holds a token a script can read", async () => {
    const origin = "http://localhost:5173";
    expect((await post("/v1/auth/google/phone/start", {}, { origin })).statusCode).toBe(400);
    const res = await post("/v1/auth/google/phone", { idToken: idToken(claimsFor("gphone12d-browser@example.com", await nonce())) }, { origin });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("refreshToken");
  });

  it("with Google not set up, the phone is told so in words", async () => {
    if (unconfigured === undefined) throw new Error("beforeAll did not build the app");
    const res = await post("/v1/auth/google/phone/start", {}, { to: unconfigured });
    expect(res.statusCode).toBe(503);
    expect(errorOf(res)).toMatchObject({ error: "google_not_configured", message: "Google sign-in isn't available. Sign in with your email." });
  });

  it("a whole gym on one wi-fi signs in, and one person's refused tries do not stop them", { timeout: 60_000 }, async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      expect((await signIn(idToken(claimsFor("gphone12d-owner@example.com", await nonce(ip), { aud: OTHER_APP })), ip)).statusCode).toBe(401);
    }
    for (let i = 0; i < 30; i++) {
      const res = await signIn(idToken(claimsFor(`gphone12d-gym-${String(i)}@example.com`, await nonce(ip))), ip);
      expect(res.statusCode).toBe(200);
    }
  });

  it("an address that keeps sending refused answers waits a minute", { timeout: 60_000 }, async () => {
    const ip = nextIp();
    const bad = idToken(claimsFor("gphone12d-owner@example.com", "b".repeat(64)));
    for (let i = 0; i < 60; i++) expect((await signIn(bad, ip)).statusCode).toBe(401);
    const res = await signIn(idToken(claimsFor("gphone12d-late@example.com", await nonce(ip))), ip);
    expect(res.statusCode).toBe(429);
    expect(errorOf(res).error).toBe("google_busy");
  });
});
