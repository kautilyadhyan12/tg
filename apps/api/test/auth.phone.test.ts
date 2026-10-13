// The phone app's sign-in, and one phone at a time (ROADMAP Stage 5 item 12a; spec
// Part 3 §10.5), against real Postgres. DATABASE_URL-gated; requires migration 0105.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  SIGNED_IN_ELSEWHERE,
  phoneRefreshResponseSchema,
  verifyCodePhoneResponseSchema,
  type PhoneSessionTokens,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { startPhoneSession } from "../src/modules/auth/repo.js";
import { PHONE_REFRESH_GRACE_SECONDS } from "../src/modules/auth/service.js";
import { mintOpaqueToken, newFamilyId, sha256Hex } from "../src/modules/auth/tokens.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

type App = Awaited<ReturnType<typeof buildApp>>;

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "phone-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

let ipCounter = 0;
const nextIp = () => `10.31.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

d("the phone app's sign-in: one phone at a time (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 12 });
  let app: App | undefined;
  const sent: { email: string; code: string }[] = [];
  const sender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (email, code) => {
      sent.push({ email, code });
      return Promise.resolve();
    },
  };
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  /** `origin`: the header every browser puts on these POSTs and the phone app never does. */
  const post = (path: string, body: unknown, opts: { cookies?: Record<string, string>; bearer?: string; origin?: string } = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: {
        "content-type": "application/json",
        ...(opts.bearer === undefined ? {} : { authorization: `Bearer ${opts.bearer}` }),
        ...(opts.origin === undefined ? {} : { origin: opts.origin }),
      },
      cookies: opts.cookies ?? {},
      payload: JSON.stringify(body),
    });

  /** A fresh code for the address, by the real send route. */
  const codeFor = async (email: string): Promise<string> => {
    // The rules read created_at (a sixty-second gap, two a day), so moving it is the clock.
    await sql`UPDATE sign_in_codes SET created_at = created_at - interval '2 days' WHERE email = ${email}`;
    const res = await post("/v1/auth/code/send", { email });
    expect(res.statusCode).toBe(200);
    const hit = [...sent].reverse().find((s) => s.email === email);
    if (hit === undefined) throw new Error(`no code was sent to ${email}`);
    return hit.code;
  };

  const phoneSignIn = async (email: string): Promise<PhoneSessionTokens> => {
    const res = await post("/v1/auth/code/verify", { email, code: await codeFor(email), client: "phone" });
    expect(res.statusCode).toBe(200);
    return verifyCodePhoneResponseSchema.parse(JSON.parse(res.body)).tokens;
  };

  /** A browser's sign-in: its refresh cookie. */
  const browserSignIn = async (email: string): Promise<string> => {
    const res = await post("/v1/auth/code/verify", { email, code: await codeFor(email) });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "refreshToken")?.value;
    if (cookie === undefined) throw new Error("the browser sign-in set no refresh cookie");
    return cookie;
  };

  const phoneRefresh = (refreshToken: string) => post("/v1/auth/refresh", { refreshToken });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string; message: string });
  const userIdOf = async (email: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no account for ${email}`);
    return id;
  };
  const tokensIn = (res: { statusCode: number; body: string }): PhoneSessionTokens => {
    expect(res.statusCode).toBe(200);
    return phoneRefreshResponseSchema.parse(JSON.parse(res.body)).tokens;
  };
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const newPhoneRow = (userId: string) => {
    const refreshToken = mintOpaqueToken();
    const familyId = newFamilyId();
    return {
      refreshToken,
      familyId,
      row: { userId, familyId, tokenHash: sha256Hex(refreshToken), expiresAt: new Date(Date.now() + 60_000), ip: null, userAgent: null },
    };
  };
  const livePhoneFamilies = async (userId: string): Promise<string[]> => {
    const rows = await sql<{ family_id: string }[]>`
      SELECT DISTINCT family_id FROM refresh_tokens
      WHERE user_id = ${userId} AND client = 'phone' AND revoked_at IS NULL`;
    return rows.map((r) => r.family_id);
  };

  beforeAll(async () => {
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'phone12a-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'phone12a-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), { emailSender: sender });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  // THE WORST THING: a lost or lent phone stays signed in after its owner signs in on a
  // new one.
  it("signing in on a new phone signs the old phone out, and tells it why", { timeout: 30_000 }, async () => {
    const email = "phone12a-worst@example.com";
    const oldPhone = await phoneSignIn(email);
    const newPhone = await phoneSignIn(email);

    const refused = await phoneRefresh(oldPhone.refreshToken);
    expect(refused.statusCode).toBe(401);
    expect(errorOf(refused).error).toBe(SIGNED_IN_ELSEWHERE.error);
    expect(errorOf(refused).message).toBe("You were signed out because your account was signed in on another phone.");
    expect(refused.cookies).toEqual([]);
    // Asking again changes nothing: still out, still told why.
    expect(errorOf(await phoneRefresh(oldPhone.refreshToken)).error).toBe(SIGNED_IN_ELSEWHERE.error);

    // The new phone is untouched by the old phone's tries.
    const kept = await phoneRefresh(newPhone.refreshToken);
    expect(kept.statusCode).toBe(200);
    expect(await livePhoneFamilies(await userIdOf(email))).toHaveLength(1);
  });

  it("an old phone that had refreshed many times is signed out all the same", { timeout: 30_000 }, async () => {
    const email = "phone12a-rotated@example.com";
    let oldPhone = await phoneSignIn(email);
    for (let i = 0; i < 3; i += 1) {
      oldPhone = phoneRefreshResponseSchema.parse(JSON.parse((await phoneRefresh(oldPhone.refreshToken)).body)).tokens;
    }
    await phoneSignIn(email);
    expect(errorOf(await phoneRefresh(oldPhone.refreshToken)).error).toBe(SIGNED_IN_ELSEWHERE.error);
  });

  it("a phone sign-in never signs a browser out, and a browser sign-in never signs a phone out", { timeout: 30_000 }, async () => {
    const email = "phone12a-browser@example.com";
    const browserBefore = await browserSignIn(email);
    const phone = await phoneSignIn(email);
    const browserAfter = await browserSignIn(email);

    expect((await post("/v1/auth/refresh", {}, { cookies: { refreshToken: browserBefore } })).statusCode).toBe(204);
    expect((await post("/v1/auth/refresh", {}, { cookies: { refreshToken: browserAfter } })).statusCode).toBe(204);
    expect((await phoneRefresh(phone.refreshToken)).statusCode).toBe(200);
  });

  it("one person's new phone signs nobody else out", { timeout: 30_000 }, async () => {
    const other = await phoneSignIn("phone12a-other@example.com");
    await phoneSignIn("phone12a-mine@example.com");
    await phoneSignIn("phone12a-mine@example.com");
    expect((await phoneRefresh(other.refreshToken)).statusCode).toBe(200);
  });

  it("phones signing in at the same instant leave exactly one signed in", { timeout: 30_000 }, async () => {
    const email = "phone12a-race@example.com";
    await phoneSignIn(email);
    const userId = await userIdOf(email);
    const together = Array.from({ length: 8 }, () =>
      startPhoneSession(sql, {
        userId,
        familyId: newFamilyId(),
        tokenHash: sha256Hex(mintOpaqueToken()),
        expiresAt: new Date(Date.now() + 60_000),
        ip: null,
        userAgent: null,
      }),
    );
    await Promise.all(together);
    expect(await livePhoneFamilies(userId)).toHaveLength(1);
  });

  it("an old phone refreshing while a new phone signs in ends signed out", { timeout: 60_000 }, async () => {
    const email = "phone12a-midrefresh@example.com";
    let oldPhone = await phoneSignIn(email);
    const userId = await userIdOf(email);
    for (let round = 0; round < 6; round += 1) {
      const newFamily = newFamilyId();
      const newToken = mintOpaqueToken();
      const [refreshed] = await Promise.all([
        phoneRefresh(oldPhone.refreshToken),
        startPhoneSession(sql, {
          userId,
          familyId: newFamily,
          tokenHash: sha256Hex(newToken),
          expiresAt: new Date(Date.now() + 60_000),
          ip: null,
          userAgent: null,
        }),
      ]);
      // Whichever came first, only the new phone is left.
      expect(await livePhoneFamilies(userId)).toEqual([newFamily]);
      if (refreshed.statusCode === 200) {
        const rotated = phoneRefreshResponseSchema.parse(JSON.parse(refreshed.body)).tokens;
        expect(errorOf(await phoneRefresh(rotated.refreshToken)).error).toBe(SIGNED_IN_ELSEWHERE.error);
      } else {
        expect(errorOf(refreshed).error).toBe(SIGNED_IN_ELSEWHERE.error);
      }
      oldPhone = { accessToken: "", refreshToken: newToken };
    }
  });

  it("an old phone's refresh that waited behind the new phone's sign-in is told why", { timeout: 30_000 }, async () => {
    const email = "phone12a-waited@example.com";
    const oldPhone = await phoneSignIn(email);
    const userId = await userIdOf(email);
    let refreshing: ReturnType<typeof phoneRefresh> | undefined;
    // The new phone's sign-in, held open: it has the person's row, and the old phone's
    // refresh arrives and waits behind it.
    await sql.begin(async (tx) => {
      await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
      refreshing = phoneRefresh(oldPhone.refreshToken);
      await pause(1500);
      await tx`
        UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'signed_in_elsewhere'
        WHERE user_id = ${userId} AND client = 'phone' AND revoked_at IS NULL`;
    });
    if (refreshing === undefined) throw new Error("the refresh was never sent");
    const refused = await refreshing;
    expect(refused.statusCode).toBe(401);
    expect(errorOf(refused).error).toBe(SIGNED_IN_ELSEWHERE.error);
    expect(await livePhoneFamilies(userId)).toEqual([]);
  });

  it("a new phone's sign-in waits for the old phone's refresh in flight, then ends what it made", { timeout: 30_000 }, async () => {
    const email = "phone12a-inflight@example.com";
    const oldPhone = await phoneSignIn(email);
    const userId = await userIdOf(email);
    const successor = mintOpaqueToken();
    const newPhone = newPhoneRow(userId);
    let signedIn = false;
    let signingIn: Promise<void> | undefined;
    // The old phone's rotation, held open after its successor is written.
    await sql.begin(async (tx) => {
      const made = await tx<{ id: string }[]>`
        INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, client)
        SELECT user_id, family_id, ${sha256Hex(successor)}, expires_at, 'phone'
        FROM refresh_tokens WHERE token_hash = ${sha256Hex(oldPhone.refreshToken)}
        RETURNING id`;
      signingIn = startPhoneSession(sql, newPhone.row).then(() => {
        signedIn = true;
      });
      await pause(1500);
      expect(signedIn).toBe(false);
      await tx`
        UPDATE refresh_tokens SET revoked_at = now(), replaced_by = ${made[0]?.id ?? null}
        WHERE token_hash = ${sha256Hex(oldPhone.refreshToken)}`;
    });
    await signingIn;
    expect(signedIn).toBe(true);
    expect(errorOf(await phoneRefresh(successor)).error).toBe(SIGNED_IN_ELSEWHERE.error);
    expect(await livePhoneFamilies(userId)).toEqual([newPhone.familyId]);
  });

  it("a script in a browser is never handed a token: the phone's way is refused to a request with an Origin", { timeout: 30_000 }, async () => {
    const email = "phone12a-origin@example.com";
    const phone = await phoneSignIn(email);
    for (const origin of ["http://localhost:5173", "https://evil.example", "null"]) {
      const code = await codeFor(email);
      const signIn = await post("/v1/auth/code/verify", { email, code, client: "phone" }, { origin });
      expect(signIn.statusCode).toBe(400);
      expect(signIn.body).not.toMatch(/token/i);
      expect(signIn.cookies).toEqual([]);
      const refresh = await post("/v1/auth/refresh", { refreshToken: phone.refreshToken }, { origin });
      expect(refresh.statusCode).toBe(400);
      expect(refresh.body).not.toMatch(/token/i);
      expect((await post("/v1/auth/logout", { refreshToken: phone.refreshToken }, { origin })).statusCode).toBe(400);
      // The refusal used nothing up: the same code signs the browser in its own way.
      const browser = await post("/v1/auth/code/verify", { email, code }, { origin });
      expect(browser.statusCode).toBe(200);
      expect(browser.body).not.toMatch(/token/i);
    }
    // The real phone was not signed out by any of it.
    tokensIn(await phoneRefresh(phone.refreshToken));
  });

  it("a phone is sent its tokens in the reply and no cookie; a browser gets cookies and no token in the reply", { timeout: 30_000 }, async () => {
    const email = "phone12a-reply@example.com";
    const phone = await post("/v1/auth/code/verify", { email, code: await codeFor(email), client: "phone" });
    expect(phone.statusCode).toBe(200);
    expect(phone.cookies).toEqual([]);
    expect(phone.headers["cache-control"]).toBe("no-store");
    const tokens = verifyCodePhoneResponseSchema.parse(JSON.parse(phone.body)).tokens;
    const refreshed = await phoneRefresh(tokens.refreshToken);
    expect(refreshed.headers["cache-control"]).toBe("no-store");
    tokens.refreshToken = tokensIn(refreshed).refreshToken;

    const browser = await post("/v1/auth/code/verify", { email, code: await codeFor(email) });
    expect(browser.statusCode).toBe(200);
    expect(Object.keys(JSON.parse(browser.body) as object).sort()).toEqual(["isNewAccount", "user"]);
    expect(browser.body).not.toMatch(/token/i);
    expect(browser.cookies.map((c) => c.name).sort()).toEqual(["accessToken", "refreshToken"]);

    // The phone's access token opens the account with no cookie at all.
    const me = await api().inject({
      method: "GET",
      url: "/v1/auth/me",
      remoteAddress: nextIp(),
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect((JSON.parse(me.body) as { user: { email: string } }).user.email).toBe(email);

    // Only the hash of the phone's refresh token is kept.
    const rows = await sql<{ token_hash: string; client: string }[]>`
      SELECT token_hash, client FROM refresh_tokens WHERE token_hash = ${sha256Hex(tokens.refreshToken)}`;
    expect(rows.map((r) => r.client)).toEqual(["phone"]);
  });

  it("a token is taken only the way its sign-in was made, and a wrong way ends nothing", { timeout: 30_000 }, async () => {
    const email = "phone12a-crossed@example.com";
    const browser = await browserSignIn(email);
    const phone = await phoneSignIn(email);

    // A phone's token as a browser's cookie: no cookies come back.
    const asCookie = await post("/v1/auth/refresh", {}, { cookies: { refreshToken: phone.refreshToken } });
    expect(asCookie.statusCode).toBe(401);
    expect(errorOf(asCookie).error).toBe("invalid_refresh");
    expect(asCookie.cookies).toEqual([]);
    // A browser's token in a body: no tokens come back.
    const asBody = await phoneRefresh(browser);
    expect(asBody.statusCode).toBe(401);
    expect(errorOf(asBody).error).toBe("invalid_refresh");
    expect(asBody.body).not.toMatch(/accessToken/);
    // Sign-out the wrong way answers as ever and ends nothing.
    expect((await post("/v1/auth/logout", { refreshToken: browser })).statusCode).toBe(200);
    expect((await post("/v1/auth/logout", {}, { cookies: { refreshToken: phone.refreshToken } })).statusCode).toBe(200);

    expect((await phoneRefresh(phone.refreshToken)).statusCode).toBe(200);
    expect((await post("/v1/auth/refresh", {}, { cookies: { refreshToken: browser } })).statusCode).toBe(204);
  });

  it("a refresh whose reply was lost does not sign the phone out: the same token again is answered", { timeout: 30_000 }, async () => {
    const email = "phone12a-lost@example.com";
    const first = await phoneSignIn(email);
    const lost = await phoneRefresh(first.refreshToken);
    expect(lost.statusCode).toBe(200);
    expect(lost.cookies).toEqual([]);
    // The reply never arrived, twice over.
    const again = tokensIn(await phoneRefresh(first.refreshToken));
    const third = tokensIn(await phoneRefresh(first.refreshToken));
    expect(new Set([first.refreshToken, tokensIn(lost).refreshToken, again.refreshToken, third.refreshToken]).size).toBe(4);
    // Only the last one received is live, and it carries on.
    expect(await livePhoneFamilies(await userIdOf(email))).toHaveLength(1);
    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM refresh_tokens
      WHERE user_id = ${await userIdOf(email)} AND client = 'phone' AND revoked_at IS NULL`;
    expect(live[0]?.n).toBe(1);
    tokensIn(await phoneRefresh(third.refreshToken));
  });

  it("two tries of one refresh at the same instant both get an answer, and one sign-in is left", { timeout: 30_000 }, async () => {
    const email = "phone12a-twice@example.com";
    const first = await phoneSignIn(email);
    const answers = await Promise.all([phoneRefresh(first.refreshToken), phoneRefresh(first.refreshToken)]);
    expect(answers.map((a) => a.statusCode)).toEqual([200, 200]);
    const live = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM refresh_tokens
      WHERE user_id = ${await userIdOf(email)} AND client = 'phone' AND revoked_at IS NULL`;
    expect(live).toHaveLength(1);
    expect(answers.map((a) => sha256Hex(tokensIn(a).refreshToken))).toContain(live[0]?.token_hash);
  });

  it("a stolen phone token is still caught: after the grace, or once the token that replaced it is used", { timeout: 30_000 }, async () => {
    // After the minute: the used token again is reuse, and ends the sign-in.
    const late = await phoneSignIn("phone12a-late@example.com");
    const lateNext = tokensIn(await phoneRefresh(late.refreshToken));
    await sql`
      UPDATE refresh_tokens SET revoked_at = revoked_at - make_interval(secs => ${PHONE_REFRESH_GRACE_SECONDS + 1})
      WHERE token_hash = ${sha256Hex(late.refreshToken)}`;
    const reuse = await phoneRefresh(late.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(errorOf(reuse).error).toBe("invalid_refresh");
    expect(errorOf(await phoneRefresh(lateNext.refreshToken)).error).toBe("invalid_refresh");

    // Once its successor has been used, the first token is past any lost reply.
    const used = await phoneSignIn("phone12a-used@example.com");
    const usedNext = tokensIn(await phoneRefresh(used.refreshToken));
    const usedThird = tokensIn(await phoneRefresh(usedNext.refreshToken));
    expect(errorOf(await phoneRefresh(used.refreshToken)).error).toBe("invalid_refresh");
    expect(errorOf(await phoneRefresh(usedThird.refreshToken)).error).toBe("invalid_refresh");

    // A thief sends the old token inside the minute and is answered; the phone, holding
    // the token that answer ended, refreshes next, and that ends the thief's too.
    const owner = await phoneSignIn("phone12a-thief@example.com");
    const ownerNext = tokensIn(await phoneRefresh(owner.refreshToken));
    const thief = tokensIn(await phoneRefresh(owner.refreshToken));
    expect(errorOf(await phoneRefresh(ownerNext.refreshToken)).error).toBe("invalid_refresh");
    expect(errorOf(await phoneRefresh(thief.refreshToken)).error).toBe("invalid_refresh");
    expect(await livePhoneFamilies(await userIdOf("phone12a-thief@example.com"))).toEqual([]);
  });

  it("a browser's refresh has no such grace", { timeout: 30_000 }, async () => {
    const browser = await browserSignIn("phone12a-nograce@example.com");
    expect((await post("/v1/auth/refresh", {}, { cookies: { refreshToken: browser } })).statusCode).toBe(204);
    expect((await post("/v1/auth/refresh", {}, { cookies: { refreshToken: browser } })).statusCode).toBe(401);
  });

  it("sign out on the phone ends that sign-in, and is safe to send twice", { timeout: 30_000 }, async () => {
    const email = "phone12a-signout@example.com";
    const browser = await browserSignIn(email);
    const phone = await phoneSignIn(email);
    for (let i = 0; i < 2; i += 1) {
      const out = await post("/v1/auth/logout", { refreshToken: phone.refreshToken });
      expect(out.statusCode).toBe(200);
      expect(out.cookies).toEqual([]);
    }
    const dead = await phoneRefresh(phone.refreshToken);
    expect(dead.statusCode).toBe(401);
    // Signed out by the person, not by another phone.
    expect(errorOf(dead).error).toBe("invalid_refresh");
    expect((await post("/v1/auth/refresh", {}, { cookies: { refreshToken: browser } })).statusCode).toBe(204);
  });

  it("refuses a body that is not the phone's shape, and a token nobody holds", { timeout: 30_000 }, async () => {
    for (const body of [{ refreshToken: 5 }, { refreshToken: "" }, { refreshToken: "a".repeat(129) }, { refreshToken: "ff".repeat(32), extra: 1 }]) {
      expect((await post("/v1/auth/refresh", body)).statusCode).toBe(400);
      expect((await post("/v1/auth/logout", body)).statusCode).toBe(400);
    }
    const unknown = await phoneRefresh("ff".repeat(32));
    expect(unknown.statusCode).toBe(401);
    expect(errorOf(unknown).error).toBe("invalid_refresh");

    const email = "phone12a-shape@example.com";
    const tablet = await post("/v1/auth/code/verify", { email, code: await codeFor(email), client: "tablet" });
    expect(tablet.statusCode).toBe(400);
    const web = await post("/v1/auth/code/verify", { email, code: "000000", client: "web" });
    expect(web.statusCode).toBe(400);
  });

  it("the database refuses a sign-in from anywhere else, and a reason on a live one", async () => {
    await phoneSignIn("phone12a-checks@example.com");
    const userId = await userIdOf("phone12a-checks@example.com");
    const insert = (client: string, reason: string | null, revoked: boolean) => sql`
      INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, client, revoked_reason, revoked_at)
      VALUES (${userId}, ${newFamilyId()}, ${sha256Hex(mintOpaqueToken())}, now(), ${client}, ${reason},
              ${revoked ? sql`now()` : null})`;
    await expect(insert("tablet", null, false)).rejects.toThrow(/refresh_tokens_client_check/);
    await expect(insert("phone", "bored", true)).rejects.toThrow(/refresh_tokens_revoked_reason_check/);
    await expect(insert("phone", "signed_in_elsewhere", false)).rejects.toThrow(/refresh_tokens_revoked_reason_check/);
  });
});
