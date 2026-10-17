// The free trial's two extra passes (ROADMAP Stage 3 item 2h), the fixes at the trial's doors,
// against real Postgres: a press with no body, what a manager is told, presses given back,
// the browser's mark given before the press, Create sent twice, and a purged person's
// second-trial codes. The first-people rule's fixes are in orgs.trialGym.test.ts.
//
// THE WORST THING THESE DOORS COULD DO: spend a signed-in owner's one free trial from another
// website, by a press with no body that the browser sends without asking. The first test.
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { deleteAddressKeyedRows } from "../src/modules/privacy/repo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "trialpasses-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const TIMEOUT_MS = 60_000;
const MARK = "trial_mark";

type App = Awaited<ReturnType<typeof buildApp>>;
type Account = { userId: string; email: string; cookies: Record<string, string> };
type Res = Awaited<ReturnType<App["inject"]>>;

let ipCounter = 0;
const nextIp = () => `10.29.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

const TAG = "trialpasses";
const run = String(Date.now() % 1_000_000);

d("the free trial's doors after the two passes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const codesMade: string[] = [];

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}%`}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM second_trial_codes WHERE code_hash = ANY(${codesMade})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine}) OR user_id IN (${people})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE id IN (${people})`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv), { redis });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  let personSeq = 0;
  const makeUser = async (): Promise<Account> => {
    const email = `${TAG}${run}p${String(personSeq++)}@gmail.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "Trial Passes" }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
  };

  let gymSeq = 0;
  const createGym = (owner: Account, opts: { createKey?: string; ip?: string } = {}) =>
    api().inject({
      method: "POST",
      url: "/v1/orgs",
      remoteAddress: opts.ip ?? nextIp(),
      headers: { "content-type": "application/json" },
      cookies: owner.cookies,
      payload: JSON.stringify({
        trainsHere: false,
        name: `Trial Passes Gym ${run} ${String(gymSeq++)}`,
        city: "Pune",
        country: "IN",
        timezone: "Asia/Kolkata",
        ...(opts.createKey === undefined ? {} : { createKey: opts.createKey }),
      }),
    });
  const makeGym = async (owner: Account): Promise<string> => {
    const res = await createGym(owner);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { org: { id: string } }).org.id;
  };
  const press = (who: Account, gymId: string, opts: { ip?: string; mark?: string } = {}): Promise<Res> =>
    api().inject({
      method: "POST",
      url: `/v1/orgs/${gymId}/trial`,
      remoteAddress: opts.ip ?? nextIp(),
      headers: { "content-type": "application/json" },
      cookies: opts.mark === undefined ? who.cookies : { ...who.cookies, [MARK]: opts.mark },
      payload: "{}",
    });
  const body = (res: Res) => JSON.parse(res.body) as { outcome?: string; error?: string; message?: string };
  const trials = async (gymId: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`)[0]?.n;

  it(
    "WORST THING: a press with no body, as another website can send, starts no trial; the console's press does",
    async () => {
      const owner = await makeUser();
      const gymId = await makeGym(owner);
      // No body and no content type: a "simple" request a browser sends from any page with
      // the owner's cookies, and no preflight asks first.
      const bare = await api().inject({
        method: "POST",
        url: `/v1/orgs/${gymId}/trial`,
        remoteAddress: nextIp(),
        cookies: owner.cookies,
      });
      expect(bare.statusCode, bare.body).toBe(400);
      expect(bare.cookies.find((c) => c.name === MARK)).toBeUndefined();
      expect(await trials(gymId)).toBe(0);
      // A form post's plain text is not read either.
      const form = await api().inject({
        method: "POST",
        url: `/v1/orgs/${gymId}/trial`,
        remoteAddress: nextIp(),
        headers: { "content-type": "text/plain" },
        cookies: owner.cookies,
        payload: "{}",
      });
      expect([400, 415]).toContain(form.statusCode);
      expect(await trials(gymId)).toBe(0);
      // The console sends `{}` as JSON, which only a page of its own origin can.
      const real = await press(owner, gymId);
      expect(real.statusCode, real.body).toBe(200);
      expect(body(real).outcome).toBe("started");
    },
    TIMEOUT_MS,
  );

  it(
    "a manager who can pay is told the owner's trial was used, never that they used theirs",
    async () => {
      const owner = await makeUser();
      expect((await press(owner, await makeGym(owner))).statusCode).toBe(200);
      const second = await makeGym(owner);
      const manager = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${second}, ${manager.userId}, 'manager', ${["billing.manage"]})`;

      const byManager = await press(manager, second);
      expect(byManager.statusCode).toBe(409);
      expect(body(byManager)).toMatchObject({
        error: "trial_already_used",
        message: "This gym's owner has already used their free trial, so this gym needs a plan to start.",
      });
      const byOwner = await press(owner, second);
      expect(body(byOwner)).toMatchObject({
        error: "trial_already_used",
        message: "You've already used your free trial. It's one per person, not one per gym.",
      });
    },
    TIMEOUT_MS,
  );

  it(
    "presses on a gym the caller may not pay for are given back, so strangers at one address cannot use up its presses",
    async () => {
      const desk = nextIp();
      const key = `rl:orgs_trial:ip:${desk}`;
      // 59 of the address's 60 an hour already used.
      for (let i = 0; i < 59; i++) await redis.incrWithTtl(key, 3600);
      const stranger = await makeUser();
      const owner = await makeUser();
      const gymId = await makeGym(owner);
      const madeUp = "00000000-0000-4000-8000-000000000000";
      expect((await press(stranger, madeUp, { ip: desk })).statusCode).toBe(404);
      expect((await press(stranger, gymId, { ip: desk })).statusCode).toBe(404);
      const trainer = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${trainer.userId}, 'trainer')`;
      expect((await press(trainer, gymId, { ip: desk })).statusCode).toBe(403);
      expect(await redis.get(key)).toBe("59");

      // The owner at the same address still gets in, and that press counts.
      const real = await press(owner, gymId, { ip: desk });
      expect(real.statusCode, real.body).toBe(200);
      expect(await redis.get(key)).toBe("60");
      expect((await press(stranger, madeUp, { ip: desk })).statusCode).toBe(429);
    },
    TIMEOUT_MS,
  );

  it(
    "a browser is given its mark when it reads its gyms, so a press whose answer was lost, and the next account, carry it",
    async () => {
      const owner = await makeUser();
      const gymId = await makeGym(owner);
      const mine = await api().inject({ method: "GET", url: "/v1/orgs/mine", remoteAddress: nextIp(), cookies: owner.cookies });
      expect(mine.statusCode).toBe(200);
      const given = mine.cookies.find((c) => c.name === MARK);
      expect(given?.httpOnly).toBe(true);
      expect(given?.path).toBe("/v1/orgs");
      const mark = given?.value ?? "";
      expect(mark).toMatch(/^[0-9a-f]{64}$/);
      // Nothing is stored for it until a trial starts.
      expect(await sql`SELECT 1 FROM subscriptions WHERE trial_device_hash = ${sha256(mark)}`).toHaveLength(0);
      // A browser that has a mark is given no other.
      const again = await api().inject({ method: "GET", url: "/v1/orgs/mine", remoteAddress: nextIp(), cookies: { ...owner.cookies, [MARK]: mark } });
      expect(again.cookies.find((c) => c.name === MARK)).toBeUndefined();

      // The press is answered, the answer is lost, the press is sent again.
      expect(body(await press(owner, gymId, { mark })).outcome).toBe("started");
      expect(body(await press(owner, gymId, { mark })).outcome).toBe("already_subscribed");
      const other = await makeUser();
      const refused = await press(other, await makeGym(other), { mark });
      expect(body(refused).error).toBe("trial_used_on_device");
    },
    TIMEOUT_MS,
  );

  it(
    "Create sent twice with one key makes one gym, answers it twice, and counts once toward the hour",
    async () => {
      const owner = await makeUser();
      const createKey = randomUUID();
      const ip = nextIp();
      const first = await createGym(owner, { createKey, ip });
      const second = await createGym(owner, { createKey, ip });
      expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
      const ids = [first, second].map((r) => (JSON.parse(r.body) as { org: { id: string } }).org.id);
      expect(ids[1]).toBe(ids[0]);
      expect(await sql`SELECT 1 FROM gyms WHERE owner_user_id = ${owner.userId}`).toHaveLength(1);
      expect(await redis.get(`rl:orgs_create:id:${owner.userId}`)).toBe("1");
      // At once, on one key: one gym.
      const key2 = randomUUID();
      const both = await Promise.all([createGym(owner, { createKey: key2 }), createGym(owner, { createKey: key2 })]);
      expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(await sql`SELECT 1 FROM gyms WHERE owner_user_id = ${owner.userId}`).toHaveLength(2);
      // Another owner's key is theirs alone.
      const other = await makeUser();
      const theirs = await createGym(other, { createKey });
      expect(theirs.statusCode).toBe(201);
      expect((JSON.parse(theirs.body) as { org: { id: string } }).org.id).not.toBe(ids[0]);
      // A form with no key is a gym each time, as before.
      await makeGym(owner);
      await makeGym(owner);
      expect(await sql`SELECT 1 FROM gyms WHERE owner_user_id = ${owner.userId}`).toHaveLength(4);
    },
    TIMEOUT_MS,
  );

  it(
    "a purged person's second-trial codes keep nothing their address can be checked against",
    async () => {
      const person = await makeUser();
      const bystander = await makeUser();
      const hashOf = async (email: string) =>
        (await sql<{ h: string }[]>`SELECT encode(sha256(convert_to(trial_person_key(${email}), 'UTF8')), 'hex') AS h`)[0]?.h ?? "";
      const code = async (email: string, used: boolean) => {
        const codeHash = sha256(`${email}${String(used)}${run}`);
        codesMade.push(codeHash);
        const gymId = used ? await makeGym(person) : null;
        if (gymId !== null) expect((await press(person, gymId)).statusCode).toBe(200);
        const subId = gymId === null ? null : (await sql<{ id: string }[]>`SELECT id FROM subscriptions WHERE owner_id = ${gymId}`)[0]?.id ?? null;
        await sql`
          INSERT INTO second_trial_codes (code_hash, person_hash, expires_at, used_at, subscription_id)
          VALUES (${codeHash}, ${await hashOf(email)}, now() + INTERVAL '14 days', ${used ? new Date() : null}, ${subId})`;
        return codeHash;
      };
      // Another spelling of the person's own address: the code Kd made for it is theirs.
      const unused = await code(person.email.replace("@", "+gym2@"), false);
      const used = await code(person.email, true);
      const kept = await code(bystander.email, false);

      await sql.begin((tx) => deleteAddressKeyedRows(tx, person.userId));

      expect(await sql`SELECT 1 FROM second_trial_codes WHERE code_hash = ${unused}`).toHaveLength(0);
      const usedRow = (await sql<{ id: string; person_hash: string; subscription_id: string | null }[]>`
        SELECT id, person_hash, subscription_id FROM second_trial_codes WHERE code_hash = ${used}`)[0];
      expect(usedRow?.person_hash).toBe(sha256(usedRow?.id ?? ""));
      expect(usedRow?.subscription_id).not.toBeNull();
      expect(await sql`SELECT 1 FROM second_trial_codes WHERE person_hash = ${await hashOf(person.email)}`).toHaveLength(0);
      const bystanders = await sql<{ person_hash: string }[]>`SELECT person_hash FROM second_trial_codes WHERE code_hash = ${kept}`;
      expect(bystanders[0]?.person_hash).toBe(await hashOf(bystander.email));
    },
    TIMEOUT_MS,
  );
});
