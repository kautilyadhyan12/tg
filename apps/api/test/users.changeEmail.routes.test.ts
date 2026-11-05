// Change email (ROADMAP Stage 5 19c; RULINGS 2026-09-23, E): a code goes to the NEW address, and the
// account moves to it only when that code comes back from the same account. Real Postgres; people
// signed in through the real code door, Google through the real phone route with a stand-in verifier.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { changeEmailResponseSchema, sendCodeResponseSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { emailChangedEmail, maskedAddress } from "../src/email/templates.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "change-email-test-secret-0123456789abc", // dummy test value, gitleaks:allow
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
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const address = (who: string): string => `chem-t-${who}-${String(Date.now())}${String(seq++)}@example.com`;

d("change email (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let redis: RedisLike | undefined;
  /** What each inbox received, newest last. */
  const inbox = new Map<string, string[]>();
  const signInCodes = new Map<string, string>();
  const changeCodes = new Map<string, string>();
  const told: { oldEmail: string; newEmail: string }[] = [];
  const receive = (to: string, what: string) => {
    inbox.set(to.toLowerCase(), [...(inbox.get(to.toLowerCase()) ?? []), what]);
  };
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'chem-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'chem-t-%@example.com'`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, headers: Record<string, string> = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    email: string;
  }
  /** The sixty seconds between two codes to one address, gone by. */
  const pastTheGap = async (email: string) => {
    await sql`UPDATE sign_in_codes SET created_at = created_at - interval '2 minutes' WHERE email = ${email}`;
  };
  /** Signs in through the code door, as the phone and the browser do; a new address makes an account. */
  const codeSignIn = async (email: string): Promise<{ userId: string; cookies: Cookies; isNewAccount: boolean }> => {
    await pastTheGap(email);
    signInCodes.delete(email);
    const sent = await inject("POST", "/v1/auth/code/send", {}, { email });
    expect(sent.statusCode, sent.body).toBe(200);
    const code = signInCodes.get(email);
    if (code === undefined) throw new Error("no sign-in code was sent");
    const res = await inject("POST", "/v1/auth/code/verify", {}, { email, code });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { user: { id: string }; isNewAccount: boolean };
    return { userId: body.user.id, cookies: cookieMap(res), isNewAccount: body.isNewAccount };
  };
  const person = async (who: string): Promise<Person> => {
    const email = address(who);
    const { userId, cookies } = await codeSignIn(email);
    return { userId, cookies, email };
  };

  const askCode = (who: Person, email: string) => inject("POST", "/v1/users/me/email-code", who.cookies, { email });
  const confirm = (who: Person, email: string, code: string) => inject("POST", "/v1/users/me/email", who.cookies, { email, code });
  const emailOf = async (userId: string): Promise<string | undefined> =>
    (await sql<{ email: string }[]>`SELECT email::text AS email FROM users WHERE id = ${userId}`)[0]?.email;
  const nameOf = async (userId: string): Promise<string | undefined> =>
    (await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`)[0]?.display_name;
  const errorOf = (res: Reply): string => (JSON.parse(res.body) as { error: string }).error;
  /** Both steps, as the phone takes them. */
  const change = async (who: Person, email: string): Promise<Reply> => {
    await pastTheGap(email);
    changeCodes.delete(email);
    const asked = await askCode(who, email);
    expect(asked.statusCode, asked.body).toBe(200);
    const code = changeCodes.get(email);
    if (code === undefined) throw new Error("no change code was sent");
    return await confirm(who, email, code);
  };

  /** Google on the phone: the stand-in verifier reads the claims it is handed, the route does the rest. */
  const google = async (subject: string, email: string): Promise<{ userId: string; isNewAccount: boolean }> => {
    const start = await inject("POST", "/v1/auth/google/phone/start", {}, {});
    expect(start.statusCode, start.body).toBe(200);
    const { nonce } = JSON.parse(start.body) as { nonce: string };
    const res = await inject("POST", "/v1/auth/google/phone", {}, { idToken: JSON.stringify({ subject, email, name: null, nonce }) });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { user: { id: string }; isNewAccount: boolean };
    return { userId: body.user.id, isNewAccount: body.isNewAccount };
  };

  beforeAll(async () => {
    await cleanup();
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`chem-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: (to, code) => {
          signInCodes.set(to.toLowerCase(), code);
          receive(to, "sign-in code");
          return Promise.resolve();
        },
      },
      changeEmailSender: {
        sendCode: (to, code) => {
          changeCodes.set(to.toLowerCase(), code);
          receive(to, "change code");
          return Promise.resolve();
        },
        sendInUse: (to) => {
          receive(to, "in use");
          return Promise.resolve();
        },
        sendChanged: (oldEmail, newEmail) => {
          told.push({ oldEmail, newEmail });
          receive(oldEmail, "changed");
          return Promise.resolve();
        },
      },
      googlePhoneVerifier: {
        clientId: "change-email-test-client",
        verify: (idToken) => Promise.resolve(JSON.parse(idToken) as { subject: string; email: string; name: null; nonce: string }),
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
    "THE WORST THING: an account never moves onto an address it did not prove, nor onto another person's: another account's code, a wrong code and a taken address all leave both accounts as they were",
    async () => {
      const ann = await person("ann");
      const bob = await person("bob");
      const cara = await person("cara");
      const annNew = address("ann-new");

      // Ann asks for her new address; Bob, who never asked, presents her code for it.
      changeCodes.delete(annNew);
      expect((await askCode(ann, annNew)).statusCode).toBe(200);
      const annsCode = changeCodes.get(annNew);
      if (annsCode === undefined) throw new Error("no code was sent to Ann's new address");
      const bobTries = await confirm(bob, annNew, annsCode);
      expect([bobTries.statusCode, errorOf(bobTries)]).toEqual([400, "invalid_code"]);
      expect(await emailOf(bob.userId)).toBe(bob.email);

      // A wrong code moves nothing.
      const wrong = annsCode === "000000" ? "111111" : "000000";
      const wrongTry = await confirm(ann, annNew, wrong);
      expect([wrongTry.statusCode, errorOf(wrongTry)]).toEqual([400, "invalid_code"]);
      expect(await emailOf(ann.userId)).toBe(ann.email);

      // Cara's address: the same answer as a free one, a note in Cara's inbox and no code.
      changeCodes.delete(cara.email);
      const takenAsk = await askCode(ann, cara.email);
      const freeAsk = await askCode(bob, address("bob-new"));
      expect(takenAsk.statusCode).toBe(200);
      const shape = (res: Reply) => {
        const body = sendCodeResponseSchema.parse(JSON.parse(res.body));
        return { ...body, message: body.message.replace(/to .+\.$/, "to {address}.") };
      };
      expect(shape(takenAsk)).toEqual(shape(freeAsk));
      expect(changeCodes.has(cara.email)).toBe(false);
      expect(inbox.get(cara.email)).toEqual(["sign-in code", "in use"]);
      // No code Ann can type moves her there, and Cara keeps her address.
      for (const guess of ["123456", "000000"]) {
        const res = await confirm(ann, cara.email, guess);
        expect([res.statusCode, errorOf(res)]).toEqual([400, "invalid_code"]);
      }
      expect([await emailOf(ann.userId), await emailOf(cara.userId)]).toEqual([ann.email, cara.email]);

      // Her own code from her own new inbox: she moves, and she alone.
      const moved = await change(ann, annNew);
      expect(moved.statusCode, moved.body).toBe(200);
      expect(changeEmailResponseSchema.parse(JSON.parse(moved.body))).toMatchObject({ email: annNew, message: `Your email is now ${annNew}.` });
      expect([await emailOf(ann.userId), await emailOf(bob.userId), await emailOf(cara.userId)]).toEqual([annNew, bob.email, cara.email]);
    },
  );

  it("the account is the same account at its new address: the session goes on, a sign-in there opens it, and the old address opens a new, empty one", async () => {
    const dev = await person("dev");
    const devNew = address("dev-new");
    expect((await change(dev, devNew)).statusCode).toBe(200);

    const me = await inject("GET", "/v1/users/me", dev.cookies);
    expect(me.statusCode).toBe(200);
    expect((JSON.parse(me.body) as { user: { id: string; email: string } }).user).toMatchObject({ id: dev.userId, email: devNew });

    const atNew = await codeSignIn(devNew);
    expect([atNew.userId, atNew.isNewAccount]).toEqual([dev.userId, false]);
    const atOld = await codeSignIn(dev.email);
    expect(atOld.isNewAccount).toBe(true);
    expect(atOld.userId).not.toBe(dev.userId);
  });

  it("the old address is told, with the new one partly hidden; the change code is no sign-in code", async () => {
    const eve = await person("eve");
    const eveNew = address("eve-new");
    changeCodes.delete(eveNew);
    expect((await askCode(eve, eveNew)).statusCode).toBe(200);
    const code = changeCodes.get(eveNew);
    if (code === undefined) throw new Error("no change code was sent");
    // The change code at the sign-in door: refused, and no account is made at the address.
    const door = await inject("POST", "/v1/auth/code/verify", {}, { email: eveNew, code });
    expect([door.statusCode, errorOf(door)]).toEqual([400, "invalid_code"]);
    expect((await sql`SELECT 1 FROM users WHERE email = ${eveNew}`).length).toBe(0);

    expect((await confirm(eve, eveNew, code)).statusCode).toBe(200);
    expect(told.filter((t) => t.oldEmail === eve.email)).toEqual([{ oldEmail: eve.email, newEmail: eveNew }]);
    const note = emailChangedEmail({ to: eve.email, newAddress: eveNew, supportEmail: "help@example.com" });
    expect(note.text).toContain(maskedAddress(eveNew));
    expect(note.text).not.toContain(eveNew);
    expect(maskedAddress("kate.smith@gmail.com")).toBe("k***@gmail.com");
  });

  it("a name that was only the old address's first part becomes the new one's; a name the person chose is kept", async () => {
    const fay = await person("fay");
    expect(await nameOf(fay.userId)).toBe(fay.email.split("@")[0]);
    const fayNew = address("fay-new");
    const res = await change(fay, fayNew);
    expect(changeEmailResponseSchema.parse(JSON.parse(res.body)).displayName).toBe(fayNew.split("@")[0]);
    expect(await nameOf(fay.userId)).toBe(fayNew.split("@")[0]);

    const gus = await person("gus");
    await sql`UPDATE users SET display_name = 'Gus Grant' WHERE id = ${gus.userId}`;
    const gusRes = await change(gus, address("gus-new"));
    expect(changeEmailResponseSchema.parse(JSON.parse(gusRes.body)).displayName).toBe("Gus Grant");
  });

  it("Google tied to the old address no longer opens the account; Google at the new address does", async () => {
    const hal = await person("hal");
    const oldGoogle = `google-hal-old-${randomUUID()}`;
    expect(await google(oldGoogle, hal.email)).toEqual({ userId: hal.userId, isNewAccount: false });

    const halNew = address("hal-new");
    expect((await change(hal, halNew)).statusCode).toBe(200);
    expect((await sql`SELECT 1 FROM auth_identities WHERE user_id = ${hal.userId}`).length).toBe(0);

    const oldOne = await google(oldGoogle, hal.email);
    expect(oldOne.userId).not.toBe(hal.userId);
    expect(oldOne.isNewAccount).toBe(true);
    expect(await google(`google-hal-new-${randomUUID()}`, halNew)).toEqual({ userId: hal.userId, isNewAccount: false });
  });

  it("refuses the same address, an address held by an account being deleted, a body that is not an address, and anybody signed out", async () => {
    const ivy = await person("ivy");
    const same = await askCode(ivy, ivy.email.toUpperCase());
    expect([same.statusCode, errorOf(same)]).toEqual([400, "same_email"]);
    expect([(await askCode(ivy, "not-an-address")).statusCode, (await confirm(ivy, ivy.email, "12345")).statusCode]).toEqual([400, 400]);

    const jon = await person("jon");
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${jon.userId}`;
    changeCodes.delete(jon.email);
    expect((await askCode(ivy, jon.email)).statusCode).toBe(200);
    expect(changeCodes.has(jon.email)).toBe(false);
    expect(inbox.get(jon.email)?.at(-1)).toBe("in use");

    expect((await inject("POST", "/v1/users/me/email-code", {}, { email: address("nobody") })).statusCode).toBe(401);
    expect((await inject("POST", "/v1/users/me/email", {}, { email: address("nobody"), code: "123456" })).statusCode).toBe(401);
  });

  it("an address another account takes between the code and the move: the person who proved it is told it is taken, and nothing moves", async () => {
    const kim = await person("kim");
    const wanted = address("kim-new");
    changeCodes.delete(wanted);
    expect((await askCode(kim, wanted)).statusCode).toBe(200);
    const code = changeCodes.get(wanted);
    if (code === undefined) throw new Error("no change code was sent");
    const other = await codeSignIn(wanted);
    expect(other.isNewAccount).toBe(true);
    const res = await confirm(kim, wanted, code);
    expect([res.statusCode, errorOf(res)]).toEqual([409, "email_in_use"]);
    expect([await emailOf(kim.userId), await emailOf(other.userId)]).toEqual([kim.email, wanted]);
  });

  it("the right code sent twice at once moves the account once and tells the old address once", async () => {
    const lee = await person("lee");
    const leeNew = address("lee-new");
    changeCodes.delete(leeNew);
    expect((await askCode(lee, leeNew)).statusCode).toBe(200);
    const code = changeCodes.get(leeNew);
    if (code === undefined) throw new Error("no change code was sent");
    const both = await Promise.all([confirm(lee, leeNew, code), confirm(lee, leeNew, code)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect(await emailOf(lee.userId)).toBe(leeNew);
    expect(told.filter((t) => t.oldEmail === lee.email)).toHaveLength(1);
  });

  it("a person may ask for ten addresses' codes a day; the eleventh waits", async () => {
    const max = await person("max");
    for (let i = 0; i < 10; i++) expect((await askCode(max, address(`max-${String(i)}`))).statusCode).toBe(200);
    const eleventh = await askCode(max, address("max-10"));
    expect(eleventh.statusCode).toBe(429);
  });
});
