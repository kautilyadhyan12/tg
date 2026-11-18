// WHAT WAITS: the menu's counts and the bell's "Needs attention" (ROADMAP V1-d; spec Part 3
// §17.11), through the route against real Postgres. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show staff a count or a money total
// from a page they may not open (a trainer reading failed payments), or one business's
// numbers to another. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ORG_PRIVILEGES, attentionResponseSchema, atRiskResponseSchema, gymWeekResponseSchema, type Attention, type OrgPrivilege } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";
import { expectAttentionMatchesPages } from "./attentionMatches.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "attention-test-secret-0123456789abcdef-xyz", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Kind = keyof Attention;

const T = 240_000;
const LIVE_PLAN = "zz_attention_live";

let ipCounter = 0;
const nextIp = () => `10.95.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const THIRTY_DAYS = {
  name: "Thirty days",
  kind: "one_time",
  priceMinor: 3000,
  termCount: 30,
  termUnit: "day",
  description: null,
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
};

d("What waits: the menu's counts and the bell, whose, to whom, and each its own page's (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const clock = new Date();
  let today = "";
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const day = (n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'attn-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'attn-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'attn-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `attn-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    const deviceId = dev[0]?.id;
    if (deviceId === undefined) throw new Error("no device");
    return { id, owner, deviceId };
  };
  const withTicks = async (gym: Gym, ticks: readonly OrgPrivilege[] | null, role: "manager" | "trainer" = "manager"): Promise<Person> => {
    const person = await signedIn(`Attn ${role} ${(ticks ?? ["default"]).join(" ")}`);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${ticks === null ? null : sql.array([...ticks])})`;
    return person;
  };

  const record = async (gym: Gym, fullName: string, paymentWord: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, payment_status, created_at)
      VALUES (${gym.id}, ${fullName}, ${`attn-r-${uniq()}@example.com`}, encode(sha256(${`attn-${uniq()}`}::bytea), 'hex'), 'typed', ${paymentWord},
              (${day(-200)}::date + interval '12 hours') AT TIME ZONE 'Asia/Kolkata')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  const visit = async (gym: Gym, entryId: string, n: number): Promise<void> => {
    const on = day(n);
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, device_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, NULL, ${entryId}, NULL, ${gym.deviceId}, ${on}::date, 'pass', 'hours_unset', 'hours_unset', ${`${on}T05:00:00Z`}::timestamptz)`;
  };
  const deskOpen = async (gym: Gym): Promise<void> => {
    const walkIn = await record(gym, `Desk Regular ${uniq()}`);
    for (let n = -60; n <= 0; n += 1) await visit(gym, walkIn, n);
  };
  const lead = async (gym: Gym, name: string): Promise<void> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/leads`, gym.owner.cookies, { fullName: name, email: `attn-l-${uniq()}@example.com`, source: "walk_in", mayEmail: false });
    expect(res.statusCode, res.body).toBe(201);
  };
  const unpaid = async (gym: Gym, name: string): Promise<void> => {
    const types = await inject("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, THIRTY_DAYS);
    expect(types.statusCode, types.body).toBe(201);
    const typeId = (JSON.parse(types.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === THIRTY_DAYS.name)?.id;
    if (typeId === undefined) throw new Error("no type");
    const entryId = await record(gym, name);
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn: day(-5), paid: false });
    expect(res.statusCode, res.body).toBe(201);
  };

  /** A business with something of most kinds waiting: 2 new leads, 1 at risk, 2 payments due. */
  const busyGym = async (name: string): Promise<Gym> => {
    const gym = await makeGym(name);
    await deskOpen(gym);
    const stan = await record(gym, "Stan Stopped");
    for (const n of [-20, -27, -34]) await visit(gym, stan, n);
    await unpaid(gym, "Una Unpaid");
    await record(gym, "Wes Word", "PAYMENT DUE");
    await lead(gym, "Lena Lead");
    await lead(gym, "Leo Lead");
    return gym;
  };

  const attentionUrl = (gym: Gym) => `/v1/orgs/${gym.id}/attention`;
  const read = async (gym: Gym, who: Person = gym.owner): Promise<Attention> => {
    const res = await inject("GET", attentionUrl(gym), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return attentionResponseSchema.parse(JSON.parse(res.body)).attention;
  };

  /** Each kind's own page or box: the route it reads, for whether this person may open it. */
  const PAGE_ROUTES: Record<Kind, string[]> = {
    chargebacks: ["/chargebacks?from=0"],
    failedPayments: ["/failed-payments/summary"],
    paymentDue: ["/member-list", "/week"],
    refunds: ["/refunds-to-review?from=0"],
    appPayments: ["/app-payment-checks"],
    appCancels: ["/app-cancels"],
    newLeads: ["/leads"],
    atRisk: ["/at-risk"],
    reported: ["/posts/reported", "/post-comments/reported"],
  };
  const mayOpen = async (gym: Gym, who: Person, kind: Kind): Promise<boolean> => {
    if (kind === "paymentDue") {
      // Members' payment words are read under `members.confirm`, as the week box's part is.
      const res = await inject("GET", `/v1/orgs/${gym.id}/week`, who.cookies);
      return res.statusCode === 200 && gymWeekResponseSchema.parse(JSON.parse(res.body)).week.paymentDue !== null;
    }
    const codes = await Promise.all(PAGE_ROUTES[kind].map(async (path) => (await inject("GET", `/v1/orgs/${gym.id}${path}`, who.cookies)).statusCode));
    for (const code of codes) expect([200, 403, 404]).toContain(code);
    return codes.every((code) => code === 200);
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    today = (await sql<{ d: string }[]>`SELECT (${clock}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)[0]?.d ?? "";
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: each business reads only its own counts, staff only those of pages they may open, nobody else any",
    async () => {
      const gym = await busyGym("Attn Iron House");
      // Next door: one new lead and nothing else waiting.
      const next = await makeGym("Attn Next Door");
      await lead(next, "Nora Next");

      const mine = await read(gym);
      expect(mine.newLeads).toEqual({ count: 2 });
      expect(mine.atRisk).toEqual({ count: 1 });
      expect(mine.paymentDue).toEqual({ count: 2, past: 0 });
      expect(mine).toMatchObject({ chargebacks: { count: 0, lostCount: 0, needsReconnect: false, canReconnect: true }, failedPayments: { count: 0, totals: [] }, refunds: { count: 0 }, appPayments: { count: 0, more: false }, appCancels: { count: 0 }, reported: { posts: 0, comments: 0 } });
      const theirs = await read(next);
      expect(theirs.newLeads).toEqual({ count: 1 });
      // No check-in yet, and nobody billed: never a nought.
      expect(theirs.atRisk).toBeNull();
      expect(theirs.paymentDue).toBeNull();

      // A trainer, by the roles' own ticks: none of the money, none of the leads.
      const trainer = await read(gym, await withTicks(gym, null, "trainer"));
      expect(trainer).toMatchObject({ chargebacks: null, failedPayments: null, refunds: null, appPayments: null, newLeads: null, paymentDue: null });

      // Nobody else: next door's owner, a member, a stranger, and nobody.
      const member = await signedIn("Attn Member");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${member.userId}, ${await record(gym, "Attn Member")}, now() - interval '150 days')`;
      for (const who of [next.owner, member, await signedIn("Attn Stranger")]) {
        const res = await inject("GET", attentionUrl(gym), who.cookies);
        expect(res.statusCode, res.body).toBe(404);
        expect(res.body).not.toMatch(/newLeads|atRisk|paymentDue|count/);
      }
      expect((await inject("GET", attentionUrl(gym), {})).statusCode).toBe(401);
      expect((await inject("GET", "/v1/orgs/not-a-business/attention", gym.owner.cookies)).statusCode).toBe(400);
      expect((await inject("GET", `/v1/orgs/${randomUUID()}/attention`, gym.owner.cookies)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "every kind shows exactly when its own page's route lets that person in: each tick alone, every mix of the four that gate, and the roles",
    async () => {
      const gym = await busyGym("Attn Ticks");
      const GATES: OrgPrivilege[] = ["members.confirm", "billing.members", "members.read", "posts.manage"];
      const mixes: (readonly OrgPrivilege[] | null)[] = [null, [], ...ORG_PRIVILEGES.map((t) => [t])];
      for (let mask = 0; mask < 1 << GATES.length; mask += 1) mixes.push(GATES.filter((_, i) => (mask & (1 << i)) !== 0));
      const kinds = Object.keys(PAGE_ROUTES) as Kind[];
      for (const ticks of mixes) {
        for (const role of ticks === null ? (["manager", "trainer"] as const) : (["manager"] as const)) {
          const who = await withTicks(gym, ticks, role);
          const seen = await read(gym, who);
          for (const kind of kinds) {
            expect(seen[kind] !== null, `${role} ${JSON.stringify(ticks)} ${kind}`).toBe(await mayOpen(gym, who, kind));
          }
        }
      }
    },
    T,
  );

  it(
    "each count is its own page's figure",
    async () => {
      const gym = await busyGym("Attn Same");
      const mine = await read(gym);
      const get = async (path: string): Promise<unknown> => {
        const res = await inject("GET", `/v1/orgs/${gym.id}${path}`, gym.owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return JSON.parse(res.body);
      };
      expect(mine.newLeads?.count).toBe(((await get("/leads")) as { counts: { new: number } }).counts.new);
      expect(mine.atRisk?.count).toBe(atRiskResponseSchema.parse(await get("/at-risk")).total);
      expect(mine.paymentDue).toEqual(gymWeekResponseSchema.parse(await get("/week")).week.paymentDue);
      await expectAttentionMatchesPages((path) => inject("GET", path, gym.owner.cookies), gym.id, ["chargebacks", "refunds", "failedPayments", "appPayments", "appCancels", "reported"]);
      // A lead moved on from New leaves the count.
      await sql`UPDATE gym_leads SET status = 'contacted' WHERE gym_id = ${gym.id} AND full_name = 'Leo Lead'`;
      expect((await read(gym)).newLeads).toEqual({ count: 1 });
    },
    T,
  );
  it(
    "staff of two businesses at one front-desk address: one business using up its share never stops the other",
    async () => {
      const one = await makeGym("Attn Shared One");
      const two = await makeGym("Attn Shared Two");
      const desk = "10.96.0.1";
      const at = (gym: Gym) => inject("GET", attentionUrl(gym), gym.owner.cookies, undefined, desk);
      expect((await at(one)).statusCode).toBe(200);
      expect((await at(two)).statusCode).toBe(200);
      // The first business's share of that address, used up (9,000 an hour), counted in up front.
      await redis.setex(`rl:orgs_attention:ip:${one.id}:${desk}`, 3600, "9000");
      expect((await at(one)).statusCode).toBe(429);
      expect((await at(two)).statusCode).toBe(200);
      // A stranger asking about the first business at that address is refused before any count of it.
      const stranger = await signedIn("Attn Shared Stranger");
      expect((await inject("GET", attentionUrl(two), stranger.cookies, undefined, desk)).statusCode).toBe(404);
      expect((await at(two)).statusCode).toBe(200);
    },
    T,
  );
});
