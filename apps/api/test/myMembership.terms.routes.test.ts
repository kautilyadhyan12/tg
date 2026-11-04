// MY MEMBERSHIP SHOWS ITS TERMS (ROADMAP Stage 5 item 16d; Kd, 2026-11-04): the minimum term, the early
// cancellation fee, the notice to cancel and the cooling-off period, as the agreement and the Terminal say
// them, on the member's own My membership. Real routes against real Postgres. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: tell a member they can still cancel with a full
// refund when they cannot, or show them a fee or a minimum term that is not on their membership. That is the
// first test: the cooling-off line is there on its last day and gone the day after, and a membership with
// no terms shows none. A member somebody else pays for reads the minimum term and the notice, never the fee
// or the refund, which are the payer's.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  membershipTermLines,
  myMembershipResponseSchema,
  type GymMembershipTypesResponse,
  type MyMembership,
  type MyMembershipResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "my-membership-terms-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_my_membership_terms";

let ipCounter = 0;
const nextIp = () => `10.95.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold",
  description: null,
  kind: "recurring",
  priceMinor: 5000,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  ...over,
});
const ALL_TERMS = { contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900, noticeDays: 30, coolingOffDays: 3 };

/** Noon in Chicago on a day of November 2026 (standard time from 1 November). */
const noon = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T18:00:00Z`);

d("my membership shows its terms (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = noon(4);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'terms-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'terms-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'terms-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `terms-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
    types: Map<string, string>;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const types = new Map<string, string>();
    for (const body of [monthly({ name: "Gold Max", ...ALL_TERMS }), monthly({ name: "Gold" }), monthly({ name: "Gold Notice", noticeDays: 30 })]) {
      const made = await inject("POST", `/v1/orgs/${id}/membership-types`, owner.cookies, body);
      expect(made.statusCode, made.body).toBe(201);
      const found = (JSON.parse(made.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
      if (found === undefined) throw new Error(`no type ${body.name}`);
      types.set(body.name, found.id);
    }
    return { id, owner, types };
  };
  interface Member extends Person {
    entryId: string;
  }
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `terms-p-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
    return { ...person, entryId };
  };
  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  const give = async (gym: Gym, who: Member, type: string): Promise<string> => {
    const typeId = gym.types.get(type);
    if (typeId === undefined) throw new Error(`no type ${type}`);
    const res = await inject("POST", heldUrl(gym, who.entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn: "2026-11-04", paid: false, priceMinor: 5000, totalMinor: 5000 });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${who.entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const mineUrl = (gym: Gym) => `/v1/orgs/${gym.id}/my-membership`;
  const mine = async (gym: Gym, who: Person): Promise<MyMembershipResponse> => {
    const res = await inject("GET", mineUrl(gym), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myMembershipResponseSchema.parse(JSON.parse(res.body));
  };
  const one = (view: MyMembershipResponse, id: string): MyMembership => {
    const found = view.memberships.find((m) => m.id === id);
    if (found === undefined) throw new Error(`no membership ${id}`);
    return found;
  };
  const keys = (m: MyMembership) => m.terms.map((t) => t.key);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: the full refund is offered to the member on its last day and not the day after, and no term a membership does not have is shown", async () => {
    clock = noon(4);
    const gym = await makeGym("Terms Iron House");
    const ana = await member(gym, "Ana Terms");
    const ben = await member(gym, "Ben Terms");
    const anaMax = await give(gym, ana, "Gold Max");
    const benPlain = await give(gym, ben, "Gold");

    const firstDay = one(await mine(gym, ana), anaMax);
    expect(firstDay.terms).toEqual([
      { key: "minimum_term", label: "Minimum term", value: "12 months, to 3 Nov 2027" },
      { key: "early_cancellation_fee", label: "Early cancellation fee", value: "$99.00" },
      { key: "notice", label: "Notice to cancel", value: "30 days" },
      { key: "cooling_off", label: "Cooling-off period", value: "until 7 Nov 2026, to cancel with a full refund" },
    ]);
    // A membership with no terms shows none; Ben's answer carries nothing of Ana's.
    expect(one(await mine(gym, ben), benPlain).terms).toEqual([]);

    clock = noon(7);
    expect(keys(one(await mine(gym, ana), anaMax))).toEqual(["minimum_term", "early_cancellation_fee", "notice", "cooling_off"]);
    clock = noon(8);
    const after = one(await mine(gym, ana), anaMax);
    expect(keys(after)).toEqual(["minimum_term", "early_cancellation_fee", "notice"]);
    expect(JSON.stringify(after)).not.toContain("full refund");

    // A member of this gym only: another gym's owner reads nothing here.
    const next = await makeGym("Terms Next Door");
    expect((await inject("GET", mineUrl(gym), next.owner.cookies)).statusCode).toBe(404);
  });

  it("the phone's words are the Terminal's, from the person's page's own read", async () => {
    clock = noon(5);
    const gym = await makeGym("Terms Same Words");
    const cara = await member(gym, "Cara Terms");
    const caraMax = await give(gym, cara, "Gold Max");
    const caraNotice = await give(gym, cara, "Gold Notice");
    const page = await inject("GET", heldUrl(gym, cara.entryId), gym.owner.cookies);
    expect(page.statusCode, page.body).toBe(200);
    const held = heldMembershipsResponseSchema.parse(JSON.parse(page.body));
    const view = await mine(gym, cara);
    for (const id of [caraMax, caraNotice]) {
      const staff = held.memberships.find((m) => m.id === id);
      if (staff === undefined) throw new Error("not on the person's page");
      expect(one(view, id).terms.map((t) => `${t.label}: ${t.value}.`)).toEqual(membershipTermLines(staff));
    }
    expect(one(view, caraNotice).terms).toEqual([{ key: "notice", label: "Notice to cancel", value: "30 days" }]);
  });

  it("a member somebody else pays for reads the minimum term and the notice; the fee and the refund are the payer's", async () => {
    clock = noon(4);
    const gym = await makeGym("Terms Family");
    const priya = await member(gym, "Priya Terms");
    const dev = await member(gym, "Dev Terms");
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${dev.entryId}/payer`, gym.owner.cookies, { payerEntryId: priya.entryId })).statusCode).toBe(200);
    const devMax = await give(gym, dev, "Gold Max");

    const his = await mine(gym, dev);
    expect(his.paidBy).toBe("Priya Terms");
    expect(keys(one(his, devMax))).toEqual(["minimum_term", "notice"]);
    expect(JSON.stringify(his)).not.toContain("$99.00");
    expect(JSON.stringify(his)).not.toContain("full refund");

    const hers = await mine(gym, priya);
    const paidFor = hers.paysFor.find((p) => p.name === "Dev Terms")?.memberships.find((m) => m.id === devMax);
    expect(paidFor?.terms.map((t) => t.key)).toEqual(["minimum_term", "early_cancellation_fee", "notice", "cooling_off"]);
  });
});
