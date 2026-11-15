// Google's reviewers sign in with ONE address whose code never changes (ROADMAP Stage 5 21c-i). Play Console's
// "Sign-in details" page: "if your app typically requires a 2-Step verification code or One-time password, make
// sure to provide reusable login credentials that can bypass these requirements", and "Your sign-in details must be
// accessible at all times, reusable, and valid regardless of user location."
//
// The worst thing it could do: open a real person's account with that code. So the first test sends the code at
// the addresses a real one differs from the reviewers' by (a plus tag, a dot, another ending, a letter more or less,
// a look-alike letter) and at a real person's account, and every one is refused. Real Postgres.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RobotCheckNeeded, redeemCode, requestCode } from "../src/modules/auth/codes.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

type App = Awaited<ReturnType<typeof buildApp>>;

const REVIEWER = "review-code-reviewer@example.com";
const FIXED: string = "406213";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "review-code-test-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const reviewEnv = { ...baseEnv, REVIEW_EMAIL: REVIEWER, REVIEW_CODE: FIXED };

let ipCounter = 0;
const nextIp = () => `10.41.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

d("the reviewers' sign-in code (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
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

  const post = (path: string, body: unknown) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
  const send = (email: string) => post("/v1/auth/code/send", { email });
  const verify = (email: string, code: string) => post("/v1/auth/code/verify", { email, code });
  const emailedTo = (email: string) => sent.filter((s) => s.email === email);
  const userIdOf = async (email: string): Promise<string | null> =>
    (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id ?? null;
  /** The rules read created_at, so moving it back IS the clock (as auth.code.test.ts does). */
  const ageCodes = (email: string, interval: string) =>
    sql`UPDATE sign_in_codes SET created_at = created_at - ${interval}::interval WHERE email = ${email}`;
  const deps = (env: Record<string, string>) => ({ sql, config: loadConfig(env), log: api().log });

  const cleanup = async () => {
    await sql`DELETE FROM sign_in_codes WHERE email LIKE '%review-code-%'`;
    await sql`DELETE FROM users WHERE email LIKE '%review-code-%'`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(reviewEnv), { emailSender: sender });
    await api().ready();
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  });

  it("opens no other account: a real person's, or an address that only looks like the reviewers'", async () => {
    // A real person with an account of her own, signed in once by her own emailed code.
    const asha = "review-code-asha@example.com";
    expect((await send(asha)).statusCode).toBe(200);
    const ashaCode = emailedTo(asha).at(-1)?.code ?? "";
    expect((await verify(asha, ashaCode)).statusCode).toBe(200);
    await ageCodes(asha, "61 seconds");

    const others = [
      asha,
      "review-code-reviewer+play@example.com", // a plus tag (Gmail, Outlook and Fastmail deliver it to the same inbox)
      "review-code-revie.wer@example.com", // a dot (Gmail ignores dots)
      "review-code-reviewer@example.co",
      "review-code-reviewer@example.com.au",
      "review-code-reviewer@mail.example.com",
      "areview-code-reviewer@example.com",
      "review-code-reviewe@example.com",
      "review-code-reviewers@example.com",
      "review-code-reviewеr@example.com", // a Cyrillic "е" where the "e" is
    ];
    for (const other of others) {
      const asked = await send(other);
      if (asked.statusCode !== 200) {
        // An address the server will not take at all signs nobody in either.
        expect(asked.statusCode, other).toBe(400);
        expect((await verify(other, FIXED)).statusCode, other).toBe(400);
        continue;
      }
      // An ordinary code went to the address, by email, as to anybody.
      const emailed = emailedTo(other).at(-1)?.code;
      expect(emailed, other).toMatch(/^\d{6}$/);
      // One chance in a million that the address's own code is the same six digits: then this case proves nothing.
      if (emailed === FIXED) continue;
      const tried = await verify(other, FIXED);
      expect(tried.statusCode, other).toBe(400);
      expect(tried.cookies.length, other).toBe(0);
    }
    // Nobody was made an account by the tries, and the real person's account is hers alone.
    const made = await sql<{ email: string }[]>`SELECT email FROM users WHERE email LIKE '%review-code-%' ORDER BY email`;
    expect(made.map((u) => u.email)).toEqual([asha]);
  });

  it("signs the reviewers' address in with its code, emails it nothing, and the same account every time", async () => {
    const before = sent.length;
    expect((await send(REVIEWER)).statusCode).toBe(200);
    expect(sent.length).toBe(before);
    const first = await verify(REVIEWER, FIXED);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.cookies.length).toBeGreaterThan(0);
    const id = await userIdOf(REVIEWER);
    expect(id).not.toBeNull();

    // Typed with capitals and spaces, as a reviewer might paste it: the same address, the same account.
    await ageCodes(REVIEWER, "61 seconds");
    const typed = "  Review-Code-Reviewer@Example.com ";
    expect((await send(typed)).statusCode).toBe(200);
    const again = await verify(typed, FIXED);
    expect(again.statusCode, again.body).toBe(200);
    expect(await userIdOf(REVIEWER)).toBe(id);
    expect(emailedTo(REVIEWER).length).toBe(0);
  });

  it("keeps every ordinary rule at the reviewers' address: one minute between codes, five wrong tries end a code", async () => {
    await ageCodes(REVIEWER, "61 seconds");
    expect((await send(REVIEWER)).statusCode).toBe(200);
    expect((await send(REVIEWER)).statusCode).toBe(429);

    const wrong = FIXED === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify(REVIEWER, wrong)).statusCode).toBe(400);
    // Five wrong tries ended this code: the right one no longer works until a new code is asked for.
    expect((await verify(REVIEWER, FIXED)).statusCode).toBe(400);
    await ageCodes(REVIEWER, "61 seconds");
    expect((await send(REVIEWER)).statusCode).toBe(200);
    expect((await verify(REVIEWER, FIXED)).statusCode).toBe(200);
  });

  it("keeps the day's limit at the reviewers' address: past three codes nobody used, the robot check", async () => {
    const capped = "review-code-capped@example.com";
    const own = deps({ ...baseEnv, REVIEW_EMAIL: capped, REVIEW_CODE: FIXED });
    const none = () => Promise.reject(new Error("nothing is emailed to the reviewers' address"));
    for (let i = 0; i < 3; i++) {
      await requestCode(own, { email: capped, purpose: "sign_in", robot: "not_passed" }, none);
      await ageCodes(capped, "61 seconds");
    }
    await expect(requestCode(own, { email: capped, purpose: "sign_in", robot: "not_passed" }, none)).rejects.toBeInstanceOf(RobotCheckNeeded);
  });

  it("is for signing in only: deleting an account and changing an email get an ordinary emailed code", async () => {
    const own = deps(reviewEnv);
    const reviewersOwn = await userIdOf(REVIEWER);
    const ashas = await userIdOf("review-code-asha@example.com");
    if (reviewersOwn === null || ashas === null) throw new Error("both accounts were made by the tests above");
    // Deleting is the reviewers' own account's code; changing email is another account moving onto the address.
    const bound = { delete_account: reviewersOwn, delete_account_web: undefined, change_email: ashas };
    for (const purpose of ["delete_account", "delete_account_web", "change_email"] as const) {
      const got: string[] = [];
      const boundTo = bound[purpose];
      await requestCode(own, { email: REVIEWER, purpose, ...(boundTo === undefined ? {} : { boundTo }) }, (_to, code) => {
        got.push(code);
        return Promise.resolve();
      });
      expect(got.length, purpose).toBe(1);
      if (got[0] === FIXED) continue;
      await expect(
        redeemCode(own, { email: REVIEWER, purpose, code: FIXED, ...(boundTo === undefined ? {} : { boundTo }) }),
        purpose,
      ).rejects.toThrow();
    }
  });

  it("never opens the admin's account, even when the setting names its address", async () => {
    const adminId = await userIdOf(REVIEWER);
    if (adminId === null) throw new Error("the reviewers' account was made by the test above");
    await ageCodes(REVIEWER, "61 seconds");
    const asAdmin = deps({ ...reviewEnv, ADMIN_USER_ID: adminId });
    const got: string[] = [];
    await requestCode(asAdmin, { email: REVIEWER, purpose: "sign_in", robot: "not_passed" }, (_to, code) => {
      got.push(code);
      return Promise.resolve();
    });
    expect(got.length).toBe(1);
    if (got[0] === FIXED) return;
    await expect(redeemCode(asAdmin, { email: REVIEWER, purpose: "sign_in", code: FIXED })).rejects.toThrow();
  });

  it("changes nothing when the server has no reviewers' address", async () => {
    await ageCodes(REVIEWER, "61 seconds");
    const plain = deps(baseEnv);
    const got: string[] = [];
    await requestCode(plain, { email: REVIEWER, purpose: "sign_in", robot: "not_passed" }, (_to, code) => {
      got.push(code);
      return Promise.resolve();
    });
    expect(got.length).toBe(1);
    if (got[0] === FIXED) return;
    await expect(redeemCode(plain, { email: REVIEWER, purpose: "sign_in", code: FIXED })).rejects.toThrow();
  });
});
