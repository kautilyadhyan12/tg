// Change email (ROADMAP Stage 5 19c; RULINGS 2026-09-23, E): a code goes to the NEW address, and the
// account moves to it only when that code comes back from the same account. Real Postgres; people
// signed in through the real code door, Google through the real phone route with a stand-in verifier.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Redis } from "ioredis";
import { changeEmailResponseSchema, sendCodeResponseSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { emailChangedEmail, maskedAddress } from "../src/email/templates.js";
import { liveChannel } from "../src/modules/live/news.js";
import { changeEmailSenderFor, type ChangeEmailSender } from "../src/modules/users/changeEmailSender.js";

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
  /** A second app's sender, apart from the first's. */
  const quietCodes = new Map<string, string>();
  const quiet: ChangeEmailSender = {
    sendCode: (to, code) => {
      quietCodes.set(to.toLowerCase(), code);
      return Promise.resolve();
    },
    sendInUse: () => Promise.resolve(),
    sendChanged: () => Promise.resolve(),
  };
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
    const sameAtTheMove = await confirm(ivy, ivy.email, "123456");
    expect([sameAtTheMove.statusCode, errorOf(sameAtTheMove)]).toEqual([400, "same_email"]);
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
    // The one that lost the code is told the move worked once the move is in, else that the code was used.
    expect(both.map((r) => (r.statusCode === 200 ? "moved" : errorOf(r))).sort()).toContain("moved");
    expect(both.filter((r) => r.statusCode !== 200).map(errorOf)).not.toContain("same_email");
    expect(await emailOf(lee.userId)).toBe(leeNew);
    expect(told.filter((t) => t.oldEmail === lee.email)).toHaveLength(1);
  });

  it("a person may ask for ten addresses' codes a day; the eleventh waits", async () => {
    const max = await person("max");
    for (let i = 0; i < 10; i++) expect((await askCode(max, address(`max-${String(i)}`))).statusCode).toBe(200);
    const eleventh = await askCode(max, address("max-10"));
    expect(eleventh.statusCode).toBe(429);
  });

  it("another account asking for the same address never cancels, uses up or burns a person's code: hers still moves her", async () => {
    const nia = await person("nia");
    const mal = await person("mal");
    const target = address("nia-new");
    /** One ask, and the code it sent, read before anybody else asks for the address. */
    const ask = async (who: Person): Promise<{ status: number; code: string | undefined }> => {
      await pastTheGap(target);
      changeCodes.delete(target);
      const res = await askCode(who, target);
      return { status: res.statusCode, code: changeCodes.get(target) };
    };
    const first = await ask(nia);
    expect(first.status).toBe(200);
    // Mal asks for her address three times, Mal's whole day for it, and a fourth is refused to Mal alone.
    for (let i = 0; i < 3; i++) expect((await ask(mal)).status).toBe(200);
    expect((await ask(mal)).status).toBe(429);
    // Five wrong tries from Mal burn Mal's code, never hers.
    for (let i = 0; i < 5; i++) expect(errorOf(await confirm(mal, target, "000000"))).toBe("invalid_code");
    // Nia may still ask again, and her newest code moves her.
    const again = await ask(nia);
    expect(again.status).toBe(200);
    if (again.code === undefined) throw new Error("no change code was sent");
    const moved = await confirm(nia, target, again.code);
    expect(moved.statusCode, moved.body).toBe(200);
    expect([await emailOf(nia.userId), await emailOf(mal.userId)]).toEqual([target, mal.email]);
  });

  it("however many accounts ask, one address is sent ten change-email emails a day, taken or free, and the refusal names the address", async () => {
    const crowd = await Promise.all(["ra", "rb", "rc", "rd"].map((who) => person(who)));
    const free = address("crowd-free");
    const taken = (await person("crowd-taken")).email;
    for (const target of [free, taken]) {
      const before = inbox.get(target)?.length ?? 0;
      const answers: { status: number; error: string | null }[] = [];
      for (let round = 0; round < 3; round++) {
        for (const who of crowd) {
          await pastTheGap(target);
          const res = await askCode(who, target);
          answers.push({ status: res.statusCode, error: res.statusCode === 200 ? null : errorOf(res) });
        }
      }
      expect(answers.filter((a) => a.status === 200)).toHaveLength(10);
      expect(answers.slice(10)).toEqual([
        { status: 429, error: "address_limit" },
        { status: 429, error: "address_limit" },
      ]);
      expect((inbox.get(target)?.length ?? 0) - before).toBe(10);
    }
    await pastTheGap(free);
    const refused = await askCode(await person("re"), free);
    expect(JSON.parse(refused.body)).toMatchObject({ message: "This address has had too many codes today. Try again tomorrow." });
  });

  it("two moves at once to two addresses: one moves the account, the other is told its address changed, and the old address is told once", async () => {
    const ola = await person("ola");
    const [one, two] = [address("ola-one"), address("ola-two")];
    const codes: string[] = [];
    for (const to of [one, two]) {
      changeCodes.delete(to);
      expect((await askCode(ola, to)).statusCode).toBe(200);
      const code = changeCodes.get(to);
      if (code === undefined) throw new Error("no change code was sent");
      codes.push(code);
    }
    const both = await Promise.all([confirm(ola, one, codes[0] ?? ""), confirm(ola, two, codes[1] ?? "")]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(both.map((r) => (r.statusCode === 409 ? errorOf(r) : "moved")).sort()).toEqual(["email_changed", "moved"]);
    const won = both[0].statusCode === 200 ? one : two;
    expect(await emailOf(ola.userId)).toBe(won);
    expect(told.filter((t) => t.oldEmail === ola.email)).toEqual([{ oldEmail: ola.email, newEmail: won }]);
  });

  it("thirty tries at the code an hour; the thirty-first waits", async () => {
    const pat = await person("pat");
    const to = address("pat-new");
    expect((await askCode(pat, to)).statusCode).toBe(200);
    for (let i = 0; i < 30; i++) expect((await confirm(pat, to, "000000")).statusCode).toBe(400);
    expect((await confirm(pat, to, "000000")).statusCode).toBe(429);
  });

  it("the app's own sender gives the old address the address members write to for help", async () => {
    const sent: { to: string; text: string }[] = [];
    const transport = { send: (message: { to: string; text: string }) => { sent.push(message); return Promise.resolve(); } };
    const sender = changeEmailSenderFor(loadConfig({ ...baseEnv, SUPPORT_EMAIL: "help@kwazo.example" }), transport, api().log);
    await sender.sendChanged("old@example.com", "new.person@example.com");
    expect(sent.map((m) => m.to)).toEqual(["old@example.com"]);
    expect(sent[0]?.text).toContain("write to us at help@kwazo.example");
    expect(sent[0]?.text).toContain("n***@example.com");
  });

  // ── Item 19's data-integrity pass (reviews/19-integrity-findings.md) ──

  /** Holds the person's row, as a request inside its own work would; the returned call lets it go. */
  const holdRow = async (userId: string): Promise<() => Promise<void>> => {
    const held = await sql.reserve();
    await held`BEGIN`;
    await held`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    return async () => {
      await held`COMMIT`;
      held.release();
    };
  };
  /** Waits until `count` requests are queued behind that held row. */
  const queuedOn = async (count: number) => {
    await expect
      .poll(
        async () =>
          (await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FROM users%FOR UPDATE%'`)[0]?.n ?? 0,
        { timeout: 10_000, interval: 25 },
      )
      .toBeGreaterThanOrEqual(count);
  };

  it("a Google sign-in at the old address while the account moves off it never links Google to the moved account (H1)", async () => {
    const rae = await person("rae");
    const raeNew = address("rae-new");
    changeCodes.delete(raeNew);
    expect((await askCode(rae, raeNew)).statusCode).toBe(200);
    const code = changeCodes.get(raeNew);
    if (code === undefined) throw new Error("no change code was sent");
    const oldGoogle = `google-rae-old-${randomUUID()}`;

    const release = await holdRow(rae.userId);
    const moving = confirm(rae, raeNew, code);
    await queuedOn(1);
    const signingIn = google(oldGoogle, rae.email);
    await queuedOn(2);
    await release();
    const [moved, signedIn] = await Promise.all([moving, signingIn]);

    expect(moved.statusCode, moved.body).toBe(200);
    expect(await emailOf(rae.userId)).toBe(raeNew);
    expect(signedIn.userId).not.toBe(rae.userId);
    expect((await sql`SELECT 1 FROM auth_identities WHERE user_id = ${rae.userId}`).length).toBe(0);
    expect((await google(oldGoogle, rae.email)).userId).not.toBe(rae.userId);
  });

  it("a sign-in by code at the old address while the account moves off it opens a new account, never the moved one (L2)", async () => {
    const sam = await person("sam");
    const samNew = address("sam-new");
    changeCodes.delete(samNew);
    expect((await askCode(sam, samNew)).statusCode).toBe(200);
    const code = changeCodes.get(samNew);
    if (code === undefined) throw new Error("no change code was sent");
    await pastTheGap(sam.email);
    signInCodes.delete(sam.email);
    expect((await inject("POST", "/v1/auth/code/send", {}, { email: sam.email })).statusCode).toBe(200);
    const signInCode = signInCodes.get(sam.email);
    if (signInCode === undefined) throw new Error("no sign-in code was sent");

    const release = await holdRow(sam.userId);
    const moving = confirm(sam, samNew, code);
    await queuedOn(1);
    const signingIn = inject("POST", "/v1/auth/code/verify", {}, { email: sam.email, code: signInCode });
    await queuedOn(2);
    await release();
    const [moved, signedIn] = await Promise.all([moving, signingIn]);

    expect(moved.statusCode, moved.body).toBe(200);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const body = JSON.parse(signedIn.body) as { user: { id: string; email: string }; isNewAccount: boolean };
    expect(body).toMatchObject({ user: { email: sam.email }, isNewAccount: true });
    expect(body.user.id).not.toBe(sam.userId);
  });

  it("Confirm sent again after its answer was lost says the move worked, and tells the old address once (H2)", async () => {
    const tia = await person("tia");
    const tiaNew = address("tia-new");
    changeCodes.delete(tiaNew);
    expect((await askCode(tia, tiaNew)).statusCode).toBe(200);
    const code = changeCodes.get(tiaNew);
    if (code === undefined) throw new Error("no change code was sent");
    const first = await confirm(tia, tiaNew, code);
    expect(first.statusCode, first.body).toBe(200);
    const again = await confirm(tia, tiaNew, code);
    expect(again.statusCode, again.body).toBe(200);
    expect(JSON.parse(again.body)).toEqual(JSON.parse(first.body));
    expect(told.filter((t) => t.oldEmail === tia.email)).toHaveLength(1);
    // Fifteen minutes later the address is simply hers already.
    await sql`UPDATE sign_in_codes SET used_at = used_at - interval '16 minutes' WHERE email = ${tiaNew}`;
    expect(errorOf(await confirm(tia, tiaNew, code))).toBe("same_email");
  });

  // The person's gyms read again: their page shows the address, and the name where it changed with it.
  it.skipIf(redisUrl === undefined || redisUrl === "")("the person's gyms are told to read their people again", async () => {
    const owner = await person("gymowner");
    const made = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name: "Chem Gym", city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(made.statusCode, made.body).toBe(201);
    const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
    const quinn = await person("quinn");
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${quinn.userId})`;
    const withNews = await buildApp(loadConfig({ ...baseEnv, REDIS_URL: redisUrl ?? "" }), { redis: redis ?? createMemoryRedis(), changeEmailSender: quiet });
    const ear = new Redis(redisUrl ?? "");
    const heard: unknown[] = [];
    try {
      await ear.subscribe(liveChannel(url ?? ""));
      ear.on("message", (_channel: string, raw: string) => heard.push(JSON.parse(raw)));
      await withNews.ready();
      const to = address("quinn-new");
      const asked = await withNews.inject({ method: "POST", url: "/v1/users/me/email-code", remoteAddress: nextIp(), cookies: quinn.cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify({ email: to }) });
      expect(asked.statusCode, asked.body).toBe(200);
      const code = quietCodes.get(to);
      if (code === undefined) throw new Error("no change code was sent");
      const moved = await withNews.inject({ method: "POST", url: "/v1/users/me/email", remoteAddress: nextIp(), cookies: quinn.cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify({ email: to, code }) });
      expect(moved.statusCode, moved.body).toBe(200);
      await expect.poll(() => heard.filter((m) => (m as { gymId: string }).gymId === gymId)).toEqual([{ gymId, news: { what: "people" } }]);
    } finally {
      await ear.quit();
      await withNews.close();
      await sql`DELETE FROM gym_members WHERE gym_id = ${gymId}`;
      await sql`DELETE FROM gym_staff WHERE gym_id = ${gymId}`;
      await sql`DELETE FROM audit_log WHERE gym_id = ${gymId}`;
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
      await sql`DELETE FROM gyms WHERE id = ${gymId}`;
    }
  });
});
