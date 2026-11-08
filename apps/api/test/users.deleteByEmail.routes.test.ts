// 21b-ii: the website's Delete your account page, for somebody without the app. No sign-in: a code
// emailed to the address typed is the proof. Real Postgres.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DELETE_PAGE_WORDS } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "delete-by-email-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Reply = { statusCode: number; body: string };

const T = 180_000;
let ipCounter = 0;
const nextIp = () => `10.92.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const newAddress = () => `delweb-t-${uniq()}@example.com`;

d("the website's Delete your account page (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let redis: RedisLike | undefined;
  const deleteCodes = new Map<string, string>();
  const signInCodes = new Map<string, string>();
  const undoEmails: string[] = [];
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const people = sql`SELECT id FROM users WHERE email LIKE 'delweb-t-%@example.com'`;
  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'delweb-t-%@example.com'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'delweb-t-%@example.com'`;
  };

  const post = (path: string, payload: unknown, opts: { cookies?: Cookies; ip?: string } = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: opts.ip ?? nextIp(),
      cookies: opts.cookies ?? {},
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  const askCode = (email: string, ip?: string) => post("/v1/account-deletion/code", { email }, ip === undefined ? {} : { ip });
  const deleteWith = (email: string, code: string, ip?: string) => post("/v1/account-deletion", { email, code }, ip === undefined ? {} : { ip });

  interface Person {
    userId: string;
    cookies: Cookies;
    email: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = newAddress();
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), email };
  };
  const statusOf = async (who: Person): Promise<string | undefined> =>
    (await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${who.userId}`)[0]?.status;
  const errorOf = (res: Reply): { error: string; message: string } => JSON.parse(res.body) as { error: string; message: string };
  /** The address's code, emailed by a fresh ask. */
  const codeFor = async (email: string): Promise<string> => {
    deleteCodes.delete(email);
    // Past the minute's wait between codes, as a person asking again later is.
    await sql`UPDATE sign_in_codes SET created_at = created_at - interval '2 minutes' WHERE email = ${email}`;
    const asked = await askCode(email);
    expect(asked.statusCode, asked.body).toBe(200);
    const code = deleteCodes.get(email);
    if (code === undefined) throw new Error("no code was emailed");
    return code;
  };
  /** A code that is not the one emailed. */
  const otherThan = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  beforeAll(async () => {
    await cleanup();
    redis = createMemoryRedis();
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      robotCheck: { siteKey: "delete-page-site-key", verify: (token) => Promise.resolve(token === "pass" ? ("passed" as const) : ("failed" as const)) },
      emailSender: {
        sendSignInCodeEmail: (to: string, code: string) => {
          signInCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
      },
      usersEmailSender: {
        sendAccountDeleteCodeEmail: (to: string, code: string) => {
          deleteCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
        sendAccountDeletionEmail: (to: string) => {
          undoEmails.push(to.toLowerCase());
          return Promise.resolve();
        },
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: a stranger who types somebody's email never deletes their account, and asking never says whether the address has one",
    async () => {
      const victim = await signedIn("Vera Victim");

      // Asking for a code answers the same for an address with an account and one without.
      const known = await askCode(victim.email);
      const nobody = newAddress();
      const unknown = await askCode(nobody);
      expect(known.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(200);
      expect(JSON.parse(known.body.replace(victim.email, "X"))).toEqual(JSON.parse(unknown.body.replace(nobody, "X")));
      expect(JSON.parse(known.body)).toMatchObject({ message: DELETE_PAGE_WORDS.sent(victim.email) });

      // The stranger does not have the emailed code: every guess is refused in one sentence, and
      // the fifth wrong guess ends the code, so even the right one does nothing after it.
      const real = deleteCodes.get(victim.email);
      if (real === undefined) throw new Error("no code was emailed");
      for (let i = 0; i < 5; i += 1) {
        const guess = await deleteWith(victim.email, otherThan(String(Number(real) + i)));
        expect(guess.statusCode, guess.body).toBe(400);
        expect(errorOf(guess).error).toBe("invalid_code");
      }
      const late = await deleteWith(victim.email, real);
      expect(late.statusCode, late.body).toBe(400);
      expect(errorOf(late).error).toBe("invalid_code");

      // A code proved for the stranger's OWN address deletes nothing of the victim's.
      const stranger = newAddress();
      const theirs = await codeFor(stranger);
      const crossed = await deleteWith(victim.email, theirs);
      expect(crossed.statusCode, crossed.body).toBe(400);
      expect(errorOf(crossed).error).toBe("invalid_code");

      // A sign-in code for the victim's address is not a deletion code.
      signInCodes.delete(victim.email);
      const signIn = await post("/v1/auth/code/send", { email: victim.email });
      expect(signIn.statusCode, signIn.body).toBe(200);
      const signInCode = signInCodes.get(victim.email);
      if (signInCode === undefined) throw new Error("no sign-in code was emailed");
      const wrongKind = await deleteWith(victim.email, signInCode);
      expect(wrongKind.statusCode, wrongKind.body).toBe(400);

      expect(await statusOf(victim)).toBe("active");
      const me = await api().inject({ method: "GET", url: "/v1/users/me", cookies: victim.cookies, remoteAddress: nextIp() });
      expect(me.statusCode).toBe(200);
      expect(undoEmails).not.toContain(victim.email);
    },
    T,
  );

  it("the code emailed to the address deletes its account: signed out everywhere, out of the gym, and the undo emailed", async () => {
    const owner = await signedIn("Gym Owner Delweb");
    const gym = await post("/v1/orgs", { trainsHere: false, name: `Delweb Gym ${uniq()}`, city: "Leeds", country: "GB", timezone: "Europe/London" }, { cookies: owner.cookies });
    expect(gym.statusCode, gym.body).toBe(201);
    const { org } = JSON.parse(gym.body) as { org: { id: string } };
    const mia = await signedIn("Mia Member");
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${org.id}, ${mia.userId})`;

    // Any case the person types finds the account.
    const code = await codeFor(mia.email);
    const done = await deleteWith(mia.email.toUpperCase(), code);
    expect(done.statusCode, done.body).toBe(200);
    expect(JSON.parse(done.body)).toEqual({ message: DELETE_PAGE_WORDS.doneUndo, emailSent: true });
    expect(await statusOf(mia)).toBe("deleted");
    expect(undoEmails.filter((to) => to === mia.email)).toHaveLength(1);
    const me = await api().inject({ method: "GET", url: "/v1/users/me", cookies: mia.cookies, remoteAddress: nextIp() });
    expect(me.statusCode).toBe(401);
    const left = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${org.id} AND user_id = ${mia.userId} AND removed_at IS NULL`;
    expect(left[0]?.n).toBe(0);

    // The same press again (an answer lost on the way): the code is spent, and nothing more happens.
    const again = await deleteWith(mia.email, code);
    expect(again.statusCode, again.body).toBe(400);
    expect(undoEmails.filter((to) => to === mia.email)).toHaveLength(1);

    // Proved again, the address is told the account is already being deleted.
    const twice = await deleteWith(mia.email, await codeFor(mia.email));
    expect(twice.statusCode, twice.body).toBe(409);
    expect(errorOf(twice)).toMatchObject({ error: "already_deleting", message: DELETE_PAGE_WORDS.alreadyDeleting });
  }, T);

  it("only somebody who proved the address learns it has no account, or that it owns a gym, which is not deleted", async () => {
    const nobody = newAddress();
    const none = await deleteWith(nobody, await codeFor(nobody));
    expect(none.statusCode, none.body).toBe(404);
    expect(errorOf(none)).toMatchObject({ error: "no_account", message: DELETE_PAGE_WORDS.noAccount });

    const owner = await signedIn("Owen Owner");
    const name = `Owen Gym ${uniq()}`;
    const gym = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, { cookies: owner.cookies });
    expect(gym.statusCode, gym.body).toBe(201);
    // A wrong code says nothing of the gym.
    const code = await codeFor(owner.email);
    const guessed = await deleteWith(owner.email, otherThan(code));
    expect(errorOf(guessed).error).toBe("invalid_code");
    const refused = await deleteWith(owner.email, code);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused)).toMatchObject({ error: "owns_gym", message: `You own ${name}. Before you delete your account, make someone else its owner.` });
    expect(await statusOf(owner)).toBe("active");
  }, T);

  it("a body that is not an address and a code is refused, and nothing is sent", async () => {
    const before = deleteCodes.size;
    const bad = await askCode("not-an-email");
    expect(bad.statusCode).toBe(400);
    const extra = await post("/v1/account-deletion/code", { email: newAddress(), userId: randomUUID() });
    expect(extra.statusCode).toBe(400);
    expect(deleteCodes.size).toBe(before);
    const noCode = await post("/v1/account-deletion", { email: newAddress(), code: "12a456" });
    expect(noCode.statusCode).toBe(400);
  }, T);

  it("shares the sign-in page's walls: past an internet address's free sends, both doors ask for the robot check", async () => {
    const ip = "10.93.0.1";
    for (let i = 0; i < 20; i += 1) {
      const res = await post("/v1/auth/code/send", { email: newAddress() }, { ip });
      expect(res.statusCode, res.body).toBe(200);
    }
    const before = deleteCodes.size;
    const asked = await askCode(newAddress(), ip);
    expect(asked.statusCode, asked.body).toBe(403);
    expect(errorOf(asked)).toMatchObject({ error: "robot_check" });
    expect(deleteCodes.size).toBe(before);
    const email = newAddress();
    const passed = await post("/v1/account-deletion/code", { email, robotToken: "pass" }, { ip });
    expect(passed.statusCode, passed.body).toBe(200);
    expect(deleteCodes.has(email)).toBe(true);
  }, T);
});
