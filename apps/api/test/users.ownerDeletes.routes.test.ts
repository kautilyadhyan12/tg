// 19b-ii (Kd, 2026-11-04): an account that owns an open gym is not deleted until the gym is
// handed over, so no gym is left with nobody able to run it; everybody else deletes as before.
// Real Postgres, two api instances for the races.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { myOrgsResponseSchema, myOwnerRequestResponseSchema, type MyOrgsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { restoreGym } from "../src/modules/orgs/repo.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "owner-deletes-account-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Reply = { statusCode: number; body: string };

const T = 180_000;
let ipCounter = 0;
const nextIp = () => `10.91.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("an owner hands the gym over before deleting their account (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const deleteCodes = new Map<string, string>();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();

  const people = sql`SELECT id FROM users WHERE email LIKE 'owndel-t-%@example.com'`;
  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_co_owner_requests WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'owndel-t-%@example.com'`;
  };

  const inject = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
    email: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `owndel-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name: displayName, email };
  };
  const createGym = (owner: Person, name: string, target = api()) =>
    inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, target);
  interface Gym {
    id: string;
    slug: string;
    name: string;
    owner: Person;
  }
  const gymOf = async (owner: Person, name: string): Promise<Gym> => {
    const res = await createGym(owner, name);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; slug: string } };
    return { id: org.id, slug: org.slug, name, owner };
  };
  const makeGym = async (name: string): Promise<Gym> => gymOf(await signedIn(`${name} Owner`), name);
  const onStaff = async (gym: Gym, name: string, role: "owner" | "manager" | "trainer"): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${null})`;
    return person;
  };
  const asMember = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gym.id}, ${person.userId})`;
    return person;
  };

  const askCode = (who: Person, target = api()) => inject("POST", "/v1/users/me/delete-code", who.cookies, {}, target);
  const deleteWith = (who: Person, code: string, target = api()) => inject("DELETE", "/v1/users/me", who.cookies, { code }, target);
  /** Both steps, as the phone and the browser take them. */
  const tryDelete = async (who: Person): Promise<{ asked: Reply; deleted: Reply | null }> => {
    deleteCodes.delete(who.email);
    const asked = await askCode(who);
    const code = deleteCodes.get(who.email);
    return { asked, deleted: code === undefined ? null : await deleteWith(who, code) };
  };
  const statusOf = async (who: Person): Promise<string | undefined> =>
    (await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${who.userId}`)[0]?.status;
  const ownerOf = async (gym: Gym): Promise<string | undefined> =>
    (await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gym.id}`)[0]?.owner_user_id;
  const refusal = (res: Reply): { error: string; message: string } => {
    expect(res.statusCode, res.body).toBe(409);
    return JSON.parse(res.body) as { error: string; message: string };
  };
  const mine = async (who: Person): Promise<MyOrgsResponse["orgs"]> => {
    const res = await inject("GET", "/v1/orgs/mine", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myOrgsResponseSchema.parse(JSON.parse(res.body)).orgs;
  };
  const handOverOf = async (who: Person, gym: Gym) => (await mine(who)).find((org) => org.id === gym.id)?.handOver;
  const ask = (gym: Gym, to: Person) => inject("POST", `/v1/orgs/${gym.id}/staff/${to.userId}/owner-request`, gym.owner.cookies, {});
  /** The request waiting for `to` at this gym, read before anything races it. */
  const waitingFor = async (gym: Gym, to: Person): Promise<string> => {
    const waiting = myOwnerRequestResponseSchema.parse(JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/owner-request`, to.cookies)).body)).request;
    if (waiting === null) throw new Error("no request is waiting");
    return waiting.id;
  };
  const acceptRequest = (gym: Gym, to: Person, requestId: string, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/owner-request/${requestId}/accept`, to.cookies, {}, target);
  const accept = async (gym: Gym, to: Person, target = api()) => acceptRequest(gym, to, await waitingFor(gym, to), target);

  beforeAll(async () => {
    await cleanup();
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`owndel-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = {
      redis,
      coOwnerEmailSender: { sendCoOwnerRequest: () => Promise.resolve(), sendOwnerRequest: () => Promise.resolve() },
      usersEmailSender: {
        sendAccountDeleteCodeEmail: (to: string, code: string) => {
          deleteCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
        sendAccountDeletionEmail: () => Promise.resolve(),
      },
    };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: a gym's own owner is never deleted, at either step, and nobody else at that gym is stopped: a co-owner, a manager, a trainer and a member each delete their account",
    async () => {
      const gym = await makeGym("Iron House Owndel");
      const cora = await onStaff(gym, "Cora Co-owner", "owner");
      const mona = await onStaff(gym, "Mona Manager", "manager");
      const tom = await onStaff(gym, "Tom Trainer", "trainer");
      const mia = await asMember(gym, "Mia Member");

      // The owner: no code is emailed, and a DELETE with any code is refused before it is read.
      const { asked } = await tryDelete(gym.owner);
      expect(refusal(asked)).toMatchObject({
        error: "owns_gym",
        message: "You own Iron House Owndel. Before you delete your account, make someone else its owner.",
      });
      expect(deleteCodes.has(gym.owner.email)).toBe(false);
      expect(refusal(await deleteWith(gym.owner, "123456")).error).toBe("owns_gym");
      expect([await statusOf(gym.owner), await ownerOf(gym)]).toEqual(["active", gym.owner.userId]);
      expect((await inject("GET", `/v1/orgs/${gym.id}/staff`, gym.owner.cookies)).statusCode).toBe(200);

      // Everybody else at the gym.
      for (const who of [cora, mona, tom, mia]) {
        const { asked: theirAsk, deleted } = await tryDelete(who);
        expect([theirAsk.statusCode, deleted?.statusCode, await statusOf(who)], who.name).toEqual([200, 200, "deleted"]);
      }
      expect([await statusOf(gym.owner), await ownerOf(gym)]).toEqual(["active", gym.owner.userId]);
    },
    T,
  );

  it(
    "every kind of person: an owner of two gyms is told both; an archived gym's owner, and somebody in no gym at all, delete; a waiting hand-over is not one",
    async () => {
      // Two gyms of one owner, named in the one sentence.
      const two = await makeGym("Alpha Owndel");
      await gymOf(two.owner, "Beta Owndel");
      expect(refusal((await tryDelete(two.owner)).asked).message).toBe(
        "You own Alpha Owndel and Beta Owndel. Before you delete your account, make someone else the owner of each.",
      );

      // An archived gym has nobody left to run, so it stops nobody.
      const archived = await makeGym("Shut Owndel");
      await sql`UPDATE gyms SET status = 'archived', archived_at = now() WHERE id = ${archived.id}`;
      const shut = await tryDelete(archived.owner);
      expect([shut.asked.statusCode, shut.deleted?.statusCode, await statusOf(archived.owner)]).toEqual([200, 200, "deleted"]);
      // And it is not re-opened by hand with nobody to run it (round one, L-4).
      expect((await restoreGym(sql, { gymId: archived.id, actorUserId: null, via: "test" })).kind).toBe("owner_gone");
      expect((await sql<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${archived.id}`)[0]?.status).toBe("archived");

      // Somebody with no gym.
      const nobody = await signedIn("Nadia Nowhere");
      const alone = await tryDelete(nobody);
      expect([alone.asked.statusCode, alone.deleted?.statusCode]).toEqual([200, 200]);

      // A hand-over asked and not answered: still the owner, still refused.
      const gym = await makeGym("Waiting Owndel");
      const priya = await onStaff(gym, "Priya Shah", "owner");
      expect((await ask(gym, priya)).statusCode).toBe(201);
      expect(refusal((await tryDelete(gym.owner)).asked).error).toBe("owns_gym");
      expect(await statusOf(gym.owner)).toBe("active");
    },
    T,
  );

  it(
    "the hand-over: the owner's link opens the console's Your account page and names who was asked; once they accept, the old owner deletes and the new one is the one refused",
    async () => {
      const gym = await makeGym("Lotus Owndel");
      const priya = await onStaff(gym, "Priya Shah", "owner");
      const mia = await asMember(gym, "Mia Member");
      const link = `http://localhost:5173/console/${gym.slug}/account`;

      // The owner alone carries it; a co-owner, a member and a stranger do not.
      expect(await handOverOf(gym.owner, gym)).toEqual({ url: link, askedName: null });
      expect(await handOverOf(priya, gym)).toBeUndefined();
      expect(await handOverOf(mia, gym)).toBeUndefined();
      const stranger = await makeGym("Stranger Owndel");
      expect((await mine(stranger.owner)).map((org) => org.id)).not.toContain(gym.id);

      expect((await ask(gym, priya)).statusCode).toBe(201);
      expect(await handOverOf(gym.owner, gym)).toEqual({ url: link, askedName: "Priya Shah" });

      const res = await accept(gym, priya);
      expect(res.statusCode, res.body).toBe(200);
      expect(await ownerOf(gym)).toBe(priya.userId);
      // The old owner is a co-owner now: no link, and their account goes.
      expect(await handOverOf(gym.owner, gym)).toBeUndefined();
      expect(await handOverOf(priya, gym)).toEqual({ url: link, askedName: null });
      const gone = await tryDelete(gym.owner);
      expect([gone.asked.statusCode, gone.deleted?.statusCode, await statusOf(gym.owner)]).toEqual([200, 200, "deleted"]);
      expect(refusal((await tryDelete(priya)).asked).error).toBe("owns_gym");
      expect([await statusOf(priya), await ownerOf(gym)]).toEqual(["active", priya.userId]);
    },
    T,
  );

  it(
    "AT ONE INSTANT, on two servers: a deletion and a gym made by the same person, or a deletion and their Accept of a hand-over, never leave a gym owned by a deleted account",
    async () => {
      for (let round = 0; round < 6; round++) {
        const who = await signedIn(`Rae Round ${String(round)}`);
        expect((await askCode(who)).statusCode).toBe(200);
        const code = deleteCodes.get(who.email) ?? "";
        const [gone, made] = await Promise.all([
          deleteWith(who, code, round % 2 === 0 ? api() : other()),
          createGym(who, `Race Owndel ${String(round)}`, round % 2 === 0 ? other() : api()),
        ]);
        const owned = await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id = ${who.userId}`;
        // One of the two lands, never both.
        if (gone.statusCode === 200) {
          expect([made.statusCode, owned.length, await statusOf(who)], `create round ${String(round)}`).toEqual([401, 0, "deleted"]);
        } else {
          expect([refusal(gone).error, made.statusCode, owned.length, await statusOf(who)], `create round ${String(round)}`).toEqual([
            "owns_gym",
            201,
            1,
            "active",
          ]);
        }
      }
      for (let round = 0; round < 6; round++) {
        const gym = await makeGym(`Accept Race Owndel ${String(round)}`);
        const cora = await onStaff(gym, `Cora Round ${String(round)}`, "owner");
        expect((await ask(gym, cora)).statusCode).toBe(201);
        expect((await askCode(cora)).statusCode).toBe(200);
        const code = deleteCodes.get(cora.email) ?? "";
        // Read before the race: a deletion that wins first leaves nothing to look up.
        const requestId = await waitingFor(gym, cora);
        const [gone, took] = await Promise.all([
          deleteWith(cora, code, round % 2 === 0 ? api() : other()),
          acceptRequest(gym, cora, requestId, round % 2 === 0 ? other() : api()),
        ]);
        expect([gone.statusCode, took.statusCode], `accept round ${String(round)}`).not.toEqual([200, 200]);
        const [owner] = await sql<{ status: string }[]>`
          SELECT u.status FROM gyms g JOIN users u ON u.id = g.owner_user_id WHERE g.id = ${gym.id}`;
        expect(owner?.status, `accept round ${String(round)}`).toBe("active");
      }
    },
    T,
  );
});
