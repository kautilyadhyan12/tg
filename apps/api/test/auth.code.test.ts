// Sign-in by 6-digit email code (Kd 2026-09-07) against REAL Postgres (R9.2 —
// no SQL mocks). DATABASE_URL-gated; requires migration 0023. A capturing
// sender is the only way to a code — it is stored as an HMAC, by design.
//
// Every rule Kd set has a test that fails if the rule is deleted: ten-minute
// life · resend replaces · sixty-second gap · two a day per address · five
// wrong guesses kill the code · single use · asking never creates an account
// or reveals one · a code sent to one address opens no other account.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { UsersEmailSender } from "../src/modules/users/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

type App = Awaited<ReturnType<typeof buildApp>>;

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "code-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

/** Captures every code with the address it went to. `failNext` makes the
 *  next send throw, for the "email service is down" path. */
function capturingSender(): EmailSender & { sent: { email: string; code: string }[]; failNext: { on: boolean } } {
  const sent: { email: string; code: string }[] = [];
  const failNext = { on: false };
  return {
    sent,
    failNext,
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (email, code) => {
      if (failNext.on) {
        failNext.on = false;
        return Promise.reject(new Error("smtp is on fire"));
      }
      sent.push({ email, code });
      return Promise.resolve();
    },
  };
}

function capturingUsersSender(): UsersEmailSender & { codes: { email: string; code: string }[] } {
  const codes: { email: string; code: string }[] = [];
  return {
    codes,
    sendAccountDeletionEmail: () => Promise.resolve(),
    sendAccountDeleteCodeEmail: (email, code) => {
      codes.push({ email, code });
      return Promise.resolve();
    },
  };
}

let ipCounter = 0;
const nextIp = () =>
  `10.23.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("sign-in by email code (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const sender = capturingSender();
  const usersSender = capturingUsersSender();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "DELETE";
    url: string;
    body?: unknown;
    cookies?: Record<string, string>;
  }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const send = (email: string) => inject({ method: "POST", url: "/v1/auth/code/send", body: { email } });
  const verify = (email: string, code: string) =>
    inject({ method: "POST", url: "/v1/auth/code/verify", body: { email, code } });
  const lastCodeFor = (email: string): string => {
    const hit = [...sender.sent].reverse().find((s) => s.email === email);
    if (hit === undefined) throw new Error(`no code was sent to ${email}`);
    return hit.code;
  };
  /** Age this address's codes so the sixty-second gap and the day cap can be
   *  crossed without waiting — the rules read created_at, so moving it IS the
   *  clock. */
  const ageCodes = (email: string, interval: string) =>
    sql`UPDATE sign_in_codes SET created_at = created_at - ${interval}::interval WHERE email = ${email}`;

  beforeAll(async () => {
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'code-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'code-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), { emailSender: sender, usersEmailSender: usersSender });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  // ── the happy path ──────────────────────────────────────────────────────

  it("emails a six-digit code, stores only its hash, and creates no account by asking", { timeout: 30_000 }, async () => {
    const email = "code-new@example.com";
    const res = await send(email);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { message: string; resendAfterSeconds: number; expiresInSeconds: number };
    expect(body.resendAfterSeconds).toBe(60);
    expect(body.expiresInSeconds).toBe(600);

    const code = lastCodeFor(email);
    expect(code).toMatch(/^\d{6}$/);

    const rows = await sql<{ code_hash: string; purpose: string; expires_at: Date; used_at: Date | null }[]>`
      SELECT code_hash, purpose, expires_at, used_at FROM sign_in_codes WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.purpose).toBe("sign_in");
    expect(rows[0]?.code_hash).not.toContain(code); // hashed, never the code
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.used_at).toBeNull();
    // Ten minutes, give or take the round trip.
    const life = (rows[0]?.expires_at.getTime() ?? 0) - Date.now();
    expect(life).toBeGreaterThan(9 * 60 * 1000);
    expect(life).toBeLessThanOrEqual(10 * 60 * 1000);

    // Asking does NOT create the account.
    expect((await sql`SELECT 1 FROM users WHERE email = ${email}`).length).toBe(0);
  });

  it("the right code signs in, creates the account on first use, sets the cookies, and is single use", { timeout: 30_000 }, async () => {
    const email = "code-first@example.com";
    await send(email);
    const code = lastCodeFor(email);

    const ok = await verify(email, code);
    expect(ok.statusCode).toBe(200);
    const body = JSON.parse(ok.body) as { user: { email: string; displayName: string; emailVerified: boolean }; isNewAccount: boolean };
    expect(body.isNewAccount).toBe(true);
    expect(body.user.email).toBe(email);
    expect(body.user.displayName).toBe("code-first"); // the person's own address, not an invented name
    expect(body.user.emailVerified).toBe(true); // a code proves the address
    const cookies = cookieMap(ok);
    expect(cookies["accessToken"]).toBeTruthy();
    expect(cookies["refreshToken"]).toBeTruthy();
    // No password on the row.
    const row = (await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE email = ${email}`)[0];
    expect(row?.password_hash).toBeNull();

    // The session works.
    const me = await inject({ method: "GET", url: "/v1/auth/me", cookies });
    expect(me.statusCode).toBe(200);

    // Single use: the same code again is refused.
    const replay = await verify(email, code);
    expect(replay.statusCode).toBe(400);
    expect((JSON.parse(replay.body) as { error: string }).error).toBe("invalid_code");
  });

  it("a second sign-in for a known address is NOT a new account, and it is the same user", { timeout: 30_000 }, async () => {
    const email = "code-again@example.com";
    await send(email);
    const first = await verify(email, lastCodeFor(email));
    expect(first.statusCode).toBe(200);
    const firstId = (JSON.parse(first.body) as { user: { id: string } }).user.id;

    await ageCodes(email, "61 seconds");
    await send(email);
    const second = await verify(email, lastCodeFor(email));
    expect(second.statusCode).toBe(200);
    const body = JSON.parse(second.body) as { user: { id: string }; isNewAccount: boolean };
    expect(body.isNewAccount).toBe(false);
    expect(body.user.id).toBe(firstId);
  });

  // ── the refusals ────────────────────────────────────────────────────────

  it("five wrong guesses kill the code — the right one is then refused too", { timeout: 30_000 }, async () => {
    const email = "code-guess@example.com";
    await send(email);
    const code = lastCodeFor(email);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let i = 1; i <= 4; i++) {
      const res = await verify(email, wrong);
      expect(res.statusCode).toBe(400);
      expect((JSON.parse(res.body) as { message: string }).message).toContain(`${String(5 - i)} `);
    }
    const fifth = await verify(email, wrong);
    expect(fifth.statusCode).toBe(400);
    expect((JSON.parse(fifth.body) as { message: string }).message).toMatch(/too many wrong tries/i);
    // Dead IN THE DATABASE, not merely refused by the app: the fifth guess
    // expired the row in the same statement that counted it (mutant A3).
    const row = (await sql<{ attempts: number; dead: boolean }[]>`
      SELECT attempts, expires_at <= now() AS dead FROM sign_in_codes WHERE email = ${email}`)[0];
    expect(row?.attempts).toBe(5);
    expect(row?.dead).toBe(true);

    const right = await verify(email, code);
    expect(right.statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM users WHERE email = ${email}`).length).toBe(0);
  });

  it("an expired code is refused — and an expired code is not a code you can guess against", { timeout: 30_000 }, async () => {
    const email = "code-expired@example.com";
    await send(email);
    const code = lastCodeFor(email);
    await sql`UPDATE sign_in_codes SET expires_at = now() - interval '1 second' WHERE email = ${email}`;
    // A wrong guess against an expired code is "expired", never "4 tries
    // left": the live-code read must not find it at all (mutant A6).
    const wrong = code === "000000" ? "000001" : "000000";
    const guess = await verify(email, wrong);
    expect(guess.statusCode).toBe(400);
    expect((JSON.parse(guess.body) as { message: string }).message).toMatch(/expired/i);
    expect((JSON.parse(guess.body) as { message: string }).message).not.toMatch(/tries left/i);
    const res = await verify(email, code);
    expect(res.statusCode).toBe(400);
  });

  it("two presentations of the right code at once: exactly one wins", { timeout: 30_000 }, async () => {
    const email = "code-race@example.com";
    await send(email);
    const code = lastCodeFor(email);
    // Both read the live row before either consumes it; the consume's own
    // WHERE is the arbiter (mutant A5 — the repo's single-use clause).
    const [a, b] = await Promise.all([verify(email, code), verify(email, code)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
  });

  it("a resend inside sixty seconds is refused; after it, the new code REPLACES the old one", { timeout: 30_000 }, async () => {
    const email = "code-resend@example.com";
    await send(email);
    const first = lastCodeFor(email);

    const tooSoon = await send(email);
    expect(tooSoon.statusCode).toBe(429);
    expect((JSON.parse(tooSoon.body) as { error: string }).error).toBe("code_too_soon");

    await ageCodes(email, "61 seconds");
    const again = await send(email);
    expect(again.statusCode).toBe(200);
    const second = lastCodeFor(email);
    expect(second).not.toBe(first); // (one-in-a-million flake accepted over a fixed code)

    // The replaced code no longer opens the door…
    expect((await verify(email, first)).statusCode).toBe(400);
    // …and stays shut even once the NEW code is dead. Without the retirement
    // the old row would be "live" again the moment the newest one is spent —
    // the live-code read takes the newest, so a test that only checks the old
    // code while the new one is alive proves nothing (mutant A12).
    const wrong = second === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await verify(email, wrong);
    expect((await verify(email, first)).statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM users WHERE email = ${email}`).length).toBe(0);
  });

  it("two codes a day per address: the third is refused until the day has passed", { timeout: 30_000 }, async () => {
    const email = "code-daycap@example.com";
    expect((await send(email)).statusCode).toBe(200);
    await ageCodes(email, "61 seconds");
    expect((await send(email)).statusCode).toBe(200);
    await ageCodes(email, "61 seconds");

    const third = await send(email);
    expect(third.statusCode).toBe(429);
    expect((JSON.parse(third.body) as { error: string; message: string }).error).toBe("code_limit");
    expect((JSON.parse(third.body) as { message: string }).message).toMatch(/too many codes today/i);

    // Tomorrow: the two old ones fall out of the window.
    await ageCodes(email, "24 hours");
    expect((await send(email)).statusCode).toBe(200);
  });

  it("a code sent to one address opens NO other account (the address is the tenant)", { timeout: 30_000 }, async () => {
    const alice = "code-alice@example.com";
    const mallory = "code-mallory@example.com";
    await send(alice);
    const aliceCode = lastCodeFor(alice);

    // Mallory presents Alice's code under her own address, and under Alice's
    // address with a code of her own.
    expect((await verify(mallory, aliceCode)).statusCode).toBe(400);
    await send(mallory);
    expect((await verify(alice, lastCodeFor(mallory))).statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM users WHERE email IN (${alice}, ${mallory})`).length).toBe(0);

    // Alice's own code still works for Alice.
    expect((await verify(alice, aliceCode)).statusCode).toBe(200);
  });

  it("when the email cannot be sent: a plain 503, and the failed send does not count against the day", { timeout: 30_000 }, async () => {
    const email = "code-outage@example.com";
    sender.failNext.on = true;
    const down = await send(email);
    expect(down.statusCode).toBe(503);
    expect((JSON.parse(down.body) as { error: string }).error).toBe("code_send_failed");
    expect((await sql`SELECT 1 FROM sign_in_codes WHERE email = ${email}`).length).toBe(0);

    // Straight away, no sixty-second wait: nothing was sent.
    expect((await send(email)).statusCode).toBe(200);
  });

  it("an account mid-deletion cannot be entered by code, and is told so", { timeout: 30_000 }, async () => {
    const email = "code-deleted@example.com";
    await sql`INSERT INTO users (email, display_name, status, deleted_at) VALUES (${email}, 'gone', 'deleted', now())`;
    await send(email);
    const res = await verify(email, lastCodeFor(email));
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: string }).error).toBe("account_unavailable");
    expect(cookieMap(res)["accessToken"]).toBeUndefined();
  });

  it("validation: a bad address, a non-six-digit code, and an unknown key are 400s that never reach the sender", { timeout: 30_000 }, async () => {
    const before = sender.sent.length;
    expect((await send("not-an-email")).statusCode).toBe(400);
    expect((await inject({ method: "POST", url: "/v1/auth/code/send", body: { email: "code-x@example.com", extra: 1 } })).statusCode).toBe(400);
    expect((await verify("code-x@example.com", "12345")).statusCode).toBe(400);
    expect((await verify("code-x@example.com", "abcdef")).statusCode).toBe(400);
    expect(sender.sent.length).toBe(before);
  });

  it("old rows are pruned on the next send, so an address does not live in the table for ever", { timeout: 30_000 }, async () => {
    const stale = "code-stale@example.com";
    await sql`
      INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at, created_at)
      VALUES (${stale}, 'sign_in', repeat('0', 64), now() - interval '3 days', now() - interval '3 days')`;
    await send("code-pruner@example.com");
    expect((await sql`SELECT 1 FROM sign_in_codes WHERE email = ${stale}`).length).toBe(0);
  });

  // ── deleting an account is confirmed with its own code ────────────────────

  it("delete-account: the code goes to the account's OWN address, is counted apart from sign-in, and another user's code never deletes you", { timeout: 30_000 }, async () => {
    const alice = "code-del-alice@example.com";
    const bob = "code-del-bob@example.com";
    await send(alice);
    const aliceCookies = cookieMap(await verify(alice, lastCodeFor(alice)));
    await send(bob);
    const bobCookies = cookieMap(await verify(bob, lastCodeFor(bob)));

    // Alice has spent one sign-in code; the deletion code is a separate count
    // and a separate purpose, so it goes out at once.
    const sent = await inject({ method: "POST", url: "/v1/users/me/delete-code", cookies: aliceCookies });
    expect(sent.statusCode).toBe(200);
    const aliceDelete = usersSender.codes[usersSender.codes.length - 1];
    expect(aliceDelete?.email).toBe(alice);
    const purposes = await sql<{ purpose: string }[]>`SELECT purpose FROM sign_in_codes WHERE email = ${alice} ORDER BY created_at`;
    expect(purposes.map((p) => p.purpose)).toEqual(["sign_in", "delete_account"]);

    // A SIGN-IN code is not a deletion code, even for the same address.
    await ageCodes(alice, "61 seconds");
    await send(alice);
    const wrongPurpose = await inject({ method: "DELETE", url: "/v1/users/me", cookies: aliceCookies, body: { code: lastCodeFor(alice) } });
    expect(wrongPurpose.statusCode).toBe(400);

    // Bob, holding Alice's deletion code, deletes nobody — least of all Alice.
    const bobTries = await inject({ method: "DELETE", url: "/v1/users/me", cookies: bobCookies, body: { code: aliceDelete?.code ?? "" } });
    expect(bobTries.statusCode).toBe(400);
    const statuses = await sql<{ email: string; status: string }[]>`
      SELECT email, status FROM users WHERE email IN (${alice}, ${bob}) ORDER BY email`;
    expect(statuses.map((s) => s.status)).toEqual(["active", "active"]);

    // Alice, with her own code, is deleted.
    const del = await inject({ method: "DELETE", url: "/v1/users/me", cookies: aliceCookies, body: { code: aliceDelete?.code ?? "" } });
    expect(del.statusCode).toBe(200);
    expect((await sql<{ status: string }[]>`SELECT status FROM users WHERE email = ${alice}`)[0]?.status).toBe("deleted");
  });
});
