// A GYM PAYING THROUGH RAZORPAY HANDED TO A CO-OWNER — routes against REAL Postgres
// (DATABASE_URL-gated), with a fake Razorpay. ROADMAP Stage 2 item 4b-iii-b.
//
// The same rule as Paddle's (4b-iii-a; Kd, 2026-10-18): Accept hands the gym over at once and
// the old owner's plan stops renewing. It stays paid to the end of its month; then the new owner
// chooses their own plan in their own name. A Razorpay plan is set to end as Cancel plan sets it
// (1d-ii), and its cancel is sent to Razorpay at Accept (Kd, 2026-10-20), not held to the hours
// before the month ends.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): the
// old owner charged for a month of a gym they gave away. "Charged" is read where Razorpay would
// charge: the payments it took on the old owner's mandate and kept.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { processRazorpayEvents } from "../src/modules/billing/events.js";
import { createMemoryRedis } from "../src/redis.js";
import { ROLE_PRIVILEGES, myOwnerRequestResponseSchema, orgStaffResponseSchema } from "@app/shared";
import { BILLING_LOCK_WAIT_MS, holdBillingSuiteLock } from "./billingSuiteLock.js";
import { confirmOwnerOf } from "./confirmOwner.js";
import { FakeRazorpay } from "./fakeRazorpay.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** Fakes in Razorpay's shapes, built at run time so no key-shaped text is in the repository. */
const KEY_ID = ["rzp", "test", "H".repeat(14)].join("_");
const KEY_SECRET = "C".repeat(24);

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "rzp-hand-over-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RAZORPAY_KEY_ID: KEY_ID,
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: ["rzp", "webhook", "hand", "over"].join("-"),
};

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const BIG = "zz_rzp_hand_big"; // up to 5,000 members, ₹200
const SMALL = "zz_rzp_hand_small"; // up to 1,000 members, ₹100

type Cookies = Record<string, string>;
interface User {
  userId: string;
  email: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  owner: User;
  /** The plan's Razorpay subscription. */
  sub: string;
  /** When the month it paid for ends. */
  end: Date;
}

d("a gym paying through Razorpay handed to a co-owner (real Postgres, fake Razorpay)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const razorpay = new FakeRazorpay();
  const startClock = razorpay.clock;
  beforeEach(() => {
    razorpay.clock = startClock;
    razorpay.down = false;
  });
  const BIG_PLAN = razorpay.addPlan(20000);
  const SMALL_PLAN = razorpay.addPlan(10000);
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** One run of the worker's job, `fromEnd` before (negative) or after the plan's month ends. */
  const runAt = (end: Date, fromEnd: number) =>
    processRazorpayEvents({
      sql,
      redis: createMemoryRedis(),
      paddle: null,
      razorpay: { api: razorpay, keyId: KEY_ID },
      log: silent,
      now: () => new Date(end.getTime() + fromEnd),
    });

  let ip = 0;
  const nextIp = () => `10.71.${String(Math.floor(ip / 250))}.${String((ip++ % 250) + 1)}`;
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rzp-hand-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'rzp-hand-t-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'rzp-hand-t-%@example.com'`;
  };

  // The other billing suites' workers sweep every gym: they take turns (billingSuiteLock.ts).
  let releaseLock: (() => Promise<void>) | null = null;
  beforeAll(async () => {
    releaseLock = await holdBillingSuiteLock(sql);
  }, BILLING_LOCK_WAIT_MS);

  beforeAll(async () => {
    await cleanup();
    for (const [code, cap, price, planId] of [
      [BIG, 5000, 20000, BIG_PLAN],
      [SMALL, 1000, 10000, SMALL_PLAN],
    ] as const) {
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap,
                           trial_days, rank, entitlements, member_entitlements, razorpay_plan_id)
        VALUES (${code}, 'org', ${"plan." + code}, ${price}, 'INR', 'month', ${cap}, 0, 10,
                '{}'::jsonb, '{}'::jsonb, ${planId})
        ON CONFLICT (code) DO UPDATE SET active = true, price_minor = ${price}, seat_cap = ${cap},
                                         razorpay_plan_id = ${planId}`;
    }
    app = await buildApp(loadConfig(baseEnv), {
      razorpayApi: razorpay,
      coOwnerEmailSender: { sendCoOwnerRequest: () => Promise.resolve(), sendOwnerRequest: () => Promise.resolve() },
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM plans WHERE code IN (${BIG}, ${SMALL})`;
    await app?.close();
    await releaseLock?.();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, who: User, payload?: unknown, headers: Record<string, string> = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: who.cookies,
      ...(method === "GET" || method === "DELETE" ? { headers } : { headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(payload ?? {}) }),
    });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  let seq = 0;
  const person = async (displayName: string): Promise<User> => {
    const email = `rzp-hand-t-${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
    const reg = await api().inject({ method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(), payload: { email, password: PASSWORD, displayName } });
    expect(reg.statusCode, reg.body).toBe(201);
    const login = await api().inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return {
      userId: (JSON.parse(reg.body) as { userId: string }).userId,
      email,
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
    };
  };
  const key = () => randomBytes(8).toString("hex");
  const opened = (res: { statusCode: number; body: string }) => {
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as { checkoutId: string; subscriptionId: string; email: string | null };
  };
  const sync = async (gymId: string, checkoutId: string, who: User) =>
    JSON.parse((await send("POST", `/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, who)).body) as { state: string };

  /** A gym on a paid month through Razorpay, started a day ago, its month ending in about 29. */
  const makePaidGym = async (ownerName: string, planCode: string = BIG): Promise<Gym> => {
    razorpay.clock = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `${ownerName}'s Rupee Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    const win = opened(await send("POST", `/v1/orgs/${id}/billing/checkout`, owner, { planCode }, { "idempotency-key": key() }));
    razorpay.authenticate(win.subscriptionId);
    expect(await sync(id, win.checkoutId, owner)).toMatchObject({ state: "paid" });
    const end = (await planRow(id, win.subscriptionId))?.current_period_end;
    if (end == null) throw new Error("no period end");
    return { id, owner, sub: win.subscriptionId, end };
  };
  const makeCoOwner = async (gym: Gym, name: string): Promise<User> => {
    const staff = await person(name);
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${staff.userId}, 'owner', ${[...ROLE_PRIVILEGES.owner]})`;
    return staff;
  };

  const ask = (gym: Gym, target: User, who: User = gym.owner) => send("POST", `/v1/orgs/${gym.id}/staff/${target.userId}/owner-request`, who);
  const mineAt = async (gym: Gym, who: User) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/owner-request`, who);
    expect(res.statusCode, res.body).toBe(200);
    return myOwnerRequestResponseSchema.parse(JSON.parse(res.body)).request;
  };
  const accept = async (gym: Gym, who: User) => {
    const request = await mineAt(gym, who);
    if (request === null) throw new Error("no request is waiting");
    return await send("POST", `/v1/orgs/${gym.id}/owner-request/${request.id}/accept`, who);
  };
  const handOver = async (gym: Gym, to: User, from: User = gym.owner) => {
    expect((await ask(gym, to, from)).statusCode).toBe(201);
    const res = await accept(gym, to);
    expect(res.statusCode, res.body).toBe(200);
  };
  const ownerOf = async (gym: Gym) => (await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gym.id}`)[0]?.owner_user_id;
  async function planRow(gymId: string, sub: string) {
    return (
      await sql<{ status: string; cancel_at_period_end: boolean; cancel_sent_at: Date | null; current_period_end: Date | null; handed_over_from: string | null; pending_subscription_ref: string | null }[]>`
        SELECT status, cancel_at_period_end, cancel_sent_at, current_period_end, handed_over_from, pending_subscription_ref FROM subscriptions
        WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'razorpay' AND provider_ref = ${sub}`
    )[0];
  }
  /** The gym's plan as the console reads it, for this person. */
  const consolePlan = async (gym: Gym, who: User) => {
    const res = await send("GET", "/v1/orgs/mine", who);
    expect(res.statusCode, res.body).toBe(200);
    const { orgs } = JSON.parse(res.body) as {
      orgs: { id: string; subscription: { status: string; cancelAtPeriodEnd: boolean; keepUntil: string | null; handedOverBy: string | null; handedOverByYou: boolean; currentPeriodEnd: string | null } | null }[];
    };
    return orgs.find((o) => o.id === gym.id)?.subscription ?? null;
  };
  /** Every payment Razorpay took on this subscription and did not give back. */
  const keptPayments = (sub: string) =>
    (razorpay.invoices.get(sub) ?? []).filter((i) => i.status === "paid" && i.payment_id != null && !razorpay.refunds.includes(i.payment_id)).map((i) => i.payment_id);
  /** Razorpay at the end of this plan's month: one it has cancelled charges nothing, one asked
   *  to end then is ended, any other is charged. */
  const monthEnds = (gym: Gym, sub: string = gym.sub) => {
    razorpay.clock = Math.floor(gym.end.getTime() / 1000);
    if (razorpay.subs.get(sub)?.status !== "cancelled") razorpay.endCycle(sub);
  };
  /** Razorpay's month for this plan ends `ms` from now; the console's refresh writes it. */
  const endsIn = async (gym: Gym, ms: number): Promise<Gym> => {
    const s = razorpay.subs.get(gym.sub);
    if (s === undefined) throw new Error("no subscription");
    const end = Math.floor((Date.now() + ms) / 1000);
    razorpay.subs.set(gym.sub, { ...s, current_end: end, charge_at: end });
    expect((await send("POST", `/v1/orgs/${gym.id}/billing/razorpay/refresh`, gym.owner)).statusCode).toBe(204);
    return { ...gym, end: new Date(end * 1000) };
  };

  // ── The worst thing: the old owner charged for a gym they gave away ──────────────────────
  describe("the old owner is never charged again for a gym they gave away", () => {
    it("Accept hands the gym over at once; its plan is set to end, goes to Razorpay before its month ends and is never charged again", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      // Before Accept: renewing, and the person asked is told until when it is paid.
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ cancel_at_period_end: false, handed_over_from: null });
      expect((await mineAt(gym, cora))?.planStops).toEqual({ until: gym.end.toISOString(), trial: false });

      const res = await accept(gym, cora);
      expect(res.statusCode, res.body).toBe(200);
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ status: "active", cancel_at_period_end: true, handed_over_from: gym.owner.userId });
      // Razorpay is told at Accept, weeks before the month ends (Kd, 2026-10-20).
      expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(true);
      expect((await planRow(gym.id, gym.sub))?.cancel_sent_at).not.toBeNull();
      // The new owner reads whose plan it was and when it stops; nobody can keep it.
      expect(await consolePlan(gym, cora)).toMatchObject({ status: "active", cancelAtPeriodEnd: true, keepUntil: null, handedOverBy: "Kd", handedOverByYou: false, currentPeriodEnd: gym.end.toISOString() });
      expect(await consolePlan(gym, gym.owner)).toMatchObject({ handedOverBy: "Kd", handedOverByYou: true, keepUntil: null });

      // The gym keeps its plan to the end of the month paid for.
      await runAt(gym.end, -DAY_MS);
      expect((await planRow(gym.id, gym.sub))?.status).toBe("active");

      // The month ends at Razorpay: ended, not charged. The gym's plan ends with it.
      const paidBefore = keptPayments(gym.sub);
      expect(paidBefore).toHaveLength(1);
      monthEnds(gym);
      await runAt(gym.end, 60_000);
      expect(razorpay.subs.get(gym.sub)?.status).toBe("cancelled");
      expect(keptPayments(gym.sub)).toEqual(paidBefore);
      expect((await planRow(gym.id, gym.sub))?.status).toBe("expired");
      expect(await consolePlan(gym, cora)).toBeNull();

      // The new owner chooses a plan in Razorpay's window filled in with their own email.
      const own = opened(await send("POST", `/v1/orgs/${gym.id}/billing/checkout`, cora, { planCode: SMALL }, { "idempotency-key": key() }));
      expect(own.email).toBe(cora.email);
      expect(own.subscriptionId).not.toBe(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("Razorpay down at Accept: the gym still moves, and the worker sends the cancel at its next run", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      razorpay.down = true;
      await handOver(gym, cora);
      razorpay.down = false;
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(false);
      expect((await planRow(gym.id, gym.sub))?.cancel_sent_at).toBeNull();
      // Weeks before the month ends.
      await runAt(gym.end, -20 * DAY_MS);
      expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(true);
      monthEnds(gym);
      await runAt(gym.end, 60_000);
      expect(keptPayments(gym.sub)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);

    it("a month Razorpay took because its cancel never reached it is ended at once and given back to the old owner", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      // Razorpay down from Accept to the month's end: it charges the next month.
      razorpay.down = true;
      await handOver(gym, cora);
      await runAt(gym.end, -2 * HOUR_MS);
      razorpay.down = false;
      expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(false);
      monthEnds(gym);
      const renewal = keptPayments(gym.sub).at(-1);
      expect(keptPayments(gym.sub)).toHaveLength(2);

      await runAt(gym.end, 60_000);
      expect(razorpay.subs.get(gym.sub)?.status).toBe("cancelled");
      expect(razorpay.refunds).toContain(renewal);
      expect(keptPayments(gym.sub)).toHaveLength(1);
      expect((await planRow(gym.id, gym.sub))?.status).not.toBe("active");
      expect(await ownerOf(gym)).toBe(cora.userId);
    }, TEST_TIMEOUT_MS);

    it("Accept waits while the plan renews within the hour, and while a month already over has not been read from Razorpay", async () => {
      // The month ended two hours ago and Razorpay renewed it; our row has not heard yet.
      const late = await makePaidGym("Kd");
      await sql`UPDATE subscriptions SET current_period_end = now() - interval '2 hours' WHERE owner_type = 'gym' AND owner_id = ${late.id}`;
      const ada = await makeCoOwner(late, "Ada");
      expect((await ask(late, ada)).statusCode).toBe(201);
      const waited = await accept(late, ada);
      expect(waited.statusCode).toBe(409);
      expect(errorOf(waited)).toBe("plan_renewing");
      expect(await ownerOf(late)).toBe(late.owner.userId);
      expect(razorpay.endAtCycleEnd.has(late.sub)).toBe(false);

      const close = await endsIn(await makePaidGym("Kd"), 30 * 60 * 1000);
      const ria = await makeCoOwner(close, "Ria");
      expect((await ask(close, ria)).statusCode).toBe(201);
      const res = await accept(close, ria);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("plan_renewing");
      expect(await ownerOf(close)).toBe(close.owner.userId);
      expect(await planRow(close.id, close.sub)).toMatchObject({ cancel_at_period_end: false, handed_over_from: null });
      // The request still waits, to be accepted once the plan has renewed.
      expect(await mineAt(close, ria)).not.toBeNull();
    }, TEST_TIMEOUT_MS);

    it("nobody keeps a handed-over plan, pays its bill, changes its card or its size: it is the old owner's mandate", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      for (const who of [cora, gym.owner]) {
        for (const res of [
          await send("DELETE", `/v1/orgs/${gym.id}/billing/cancel`, who),
          await send("POST", `/v1/orgs/${gym.id}/billing/razorpay/pay`, who),
          await send("POST", `/v1/orgs/${gym.id}/billing/razorpay/method`, who),
        ]) {
          expect(res.statusCode, res.body).toBe(409);
          expect(errorOf(res)).toBe("handed_over_plan");
          // The person who paid is told they handed it over; anybody else, that the last owner paid.
          expect((JSON.parse(res.body) as { message: string }).message).toMatch(who === gym.owner ? /^You handed over ownership/ : /^This plan was paid by the last owner/);
        }
        const size = await send("POST", `/v1/orgs/${gym.id}/billing/size/razorpay`, who, { planCode: SMALL }, { "idempotency-key": key() });
        expect(size.statusCode).toBe(409);
        expect(errorOf(size)).toBe("plan_ending");
      }
      // Its size stays refused on the hand-over alone.
      await sql`UPDATE subscriptions SET cancel_at_period_end = false, cancel_sent_at = NULL WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect(errorOf(await send("POST", `/v1/orgs/${gym.id}/billing/size/razorpay`, cora, { planCode: SMALL }, { "idempotency-key": key() }))).toBe("plan_ending");
      await sql`UPDATE subscriptions SET cancel_at_period_end = true, cancel_sent_at = now() WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ cancel_at_period_end: true, handed_over_from: gym.owner.userId });
      // Reading the plan from Razorpay again changes nothing of it.
      expect((await send("POST", `/v1/orgs/${gym.id}/billing/razorpay/refresh`, cora)).statusCode).toBe(204);
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ cancel_at_period_end: true, handed_over_from: gym.owner.userId });
    }, TEST_TIMEOUT_MS);

    it("a smaller size the old owner's mandate approved is dropped and cancelled at Razorpay at Accept", async () => {
      const gym = await makePaidGym("Kd");
      const win = opened(await send("POST", `/v1/orgs/${gym.id}/billing/size/razorpay`, gym.owner, { planCode: SMALL }, { "idempotency-key": key() }));
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, gym.owner)).toMatchObject({ state: "paid" });
      expect((await planRow(gym.id, gym.sub))?.pending_subscription_ref).toBe(win.subscriptionId);
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      expect((await planRow(gym.id, gym.sub))?.pending_subscription_ref).toBeNull();
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      // Its month ends: neither plan charges the old owner again.
      monthEnds(gym);
      monthEnds(gym, win.subscriptionId);
      await runAt(gym.end, 60_000);
      expect(keptPayments(gym.sub)).toHaveLength(1);
      expect(keptPayments(win.subscriptionId)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("a bigger size already in place, its first month still to come, is cancelled at Razorpay at once and never charged again", async () => {
      const gym = await makePaidGym("Kd", SMALL);
      const win = opened(await send("POST", `/v1/orgs/${gym.id}/billing/size/razorpay`, gym.owner, { planCode: BIG }, { "idempotency-key": key() }));
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, gym.owner)).toMatchObject({ state: "paid" });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("authenticated");
      const bigger: Gym = { ...gym, sub: win.subscriptionId };
      expect((await planRow(gym.id, bigger.sub))?.status).toBe("active");
      const upfront = keptPayments(bigger.sub);
      expect(upfront).toHaveLength(1);

      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      // Razorpay refuses a month-end cancel before a first monthly charge: it is ended at once.
      expect(razorpay.cancelled).toContain(bigger.sub);
      expect(await planRow(gym.id, bigger.sub)).toMatchObject({ status: "active", handed_over_from: gym.owner.userId });
      monthEnds(bigger);
      await runAt(gym.end, 60_000);
      expect(keptPayments(bigger.sub)).toEqual(upfront);
      expect(keptPayments(gym.sub)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);
  });

  describe("handed on, handed back, and a plan already set to end", () => {
    it("handed back to the person who pays, it is theirs again and still ends: Razorpay was told at Accept, so it can't be kept", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      await handOver(gym, gym.owner, cora);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ cancel_at_period_end: true, handed_over_from: null });
      expect(await consolePlan(gym, gym.owner)).toMatchObject({ handedOverBy: null, cancelAtPeriodEnd: true, keepUntil: null });
      const kept = await send("DELETE", `/v1/orgs/${gym.id}/billing/cancel`, gym.owner);
      expect(kept.statusCode).toBe(409);
      expect(errorOf(kept)).toBe("cancel_sent");
      // Weeks from its end: not "too close", but already with Razorpay.
      expect((JSON.parse(kept.body) as { message: string }).message).toMatch(/^Your plan ends on .+, and Razorpay has already been told to stop it, so it can't be kept./);
      monthEnds(gym);
      await runAt(gym.end, 60_000);
      expect(keptPayments(gym.sub)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);

    it("handed back before Razorpay was told, it is the payer's own plan set to end, and Keep my plan keeps it", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      razorpay.down = true;
      await handOver(gym, cora);
      await handOver(gym, gym.owner, cora);
      razorpay.down = false;
      expect((await consolePlan(gym, gym.owner))?.keepUntil).not.toBeNull();
      expect((await send("DELETE", `/v1/orgs/${gym.id}/billing/cancel`, gym.owner)).statusCode).toBe(200);
      await runAt(gym.end, -2 * HOUR_MS);
      expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("handed on again, it stays the first payer's and still ends with its month", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      const sid = await makeCoOwner(gym, "Sid");
      // Nothing more stops: the request says nothing about a plan Cora does not pay for.
      expect((await ask(gym, sid, cora)).statusCode).toBe(201);
      expect((await mineAt(gym, sid))?.planStops).toBeNull();
      expect((await accept(gym, sid)).statusCode).toBe(200);
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ cancel_at_period_end: true, handed_over_from: gym.owner.userId });
      expect(await consolePlan(gym, sid)).toMatchObject({ handedOverBy: "Kd" });
    }, TEST_TIMEOUT_MS);

    it("a plan its owner already cancelled is handed over and stays set to end, and can no longer be kept", async () => {
      const gym = await makePaidGym("Kd");
      expect((await send("PUT", `/v1/orgs/${gym.id}/billing/cancel`, gym.owner)).statusCode).toBe(200);
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      expect(await planRow(gym.id, gym.sub)).toMatchObject({ cancel_at_period_end: true, handed_over_from: gym.owner.userId });
      expect((await consolePlan(gym, cora))?.keepUntil).toBeNull();
      expect(errorOf(await send("DELETE", `/v1/orgs/${gym.id}/billing/cancel`, gym.owner))).toBe("handed_over_plan");
      expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a paid trial is cancelled at Razorpay before its first payment, and never charged", async () => {
      const owner = await person("Kd");
      const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `Kd's Trial Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" });
      expect(res.statusCode, res.body).toBe(201);
      const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
      await confirmOwnerOf(sql, id);
      const trial = await send("POST", `/v1/orgs/${id}/trial`, owner);
      expect(trial.statusCode, trial.body).toBeLessThan(300);
      // A paid trial's window, as a press before 2f-i made it: the mandate now, the first
      // payment when the gym's own trial ends.
      const own = (await sql<{ trial_ends_at: Date }[]>`SELECT trial_ends_at FROM subscriptions WHERE owner_id = ${id} AND provider = 'none' AND status = 'trialing'`)[0];
      if (own === undefined) throw new Error("no free trial");
      const checkout = (await sql<{ id: string }[]>`
        INSERT INTO billing_checkouts (gym_id, plan_id, created_by, idempotency_key, provider, trial_ends_at)
        VALUES (${id}, (SELECT id FROM plans WHERE code = ${BIG}), ${owner.userId}, ${key()}, 'razorpay', ${own.trial_ends_at})
        RETURNING id`)[0];
      if (checkout === undefined) throw new Error("no checkout");
      razorpay.clock = Math.floor(Date.now() / 1000);
      const made = await razorpay.createSubscription({ planId: BIG_PLAN, startAt: own.trial_ends_at, notes: { app: "aihg", gym_id: id, checkout_id: checkout.id } });
      if (made.kind !== "ok") throw new Error("no subscription");
      await sql`UPDATE billing_checkouts SET state = 'open', provider_ref = ${made.value.id} WHERE id = ${checkout.id}`;
      razorpay.authenticate(made.value.id);
      expect(await sync(id, checkout.id, owner)).toMatchObject({ state: "paid" });
      const end = (await planRow(id, made.value.id))?.current_period_end;
      if (end == null) throw new Error("no trial end");
      const gym: Gym = { id, owner, sub: made.value.id, end };
      expect((await planRow(id, gym.sub))?.status).toBe("trialing");

      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      expect((await mineAt(gym, cora))?.planStops).toEqual({ until: end.toISOString(), trial: true });
      expect((await accept(gym, cora)).statusCode).toBe(200);
      expect(razorpay.cancelled).toContain(gym.sub);
      // The trial keeps its plan to its end.
      await runAt(end, -DAY_MS);
      expect((await planRow(id, gym.sub))?.status).toBe("trialing");
      monthEnds(gym);
      await runAt(end, 60_000);
      expect(razorpay.subs.get(gym.sub)?.paid_count).toBe(0);
      expect(keptPayments(gym.sub)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("the Staff tab offers Make owner for a Razorpay plan and says until when it is paid", async () => {
      const gym = await makePaidGym("Kd");
      await makeCoOwner(gym, "Cora");
      const res = await send("GET", `/v1/orgs/${gym.id}/staff`, gym.owner);
      expect(res.statusCode).toBe(200);
      const tab = orgStaffResponseSchema.parse(JSON.parse(res.body));
      expect(tab.paidPlan).toBe(false);
      expect(tab.paidPlanNote).toBeNull();
      expect(tab.planStops).toEqual({ until: gym.end.toISOString(), trial: false });
    }, TEST_TIMEOUT_MS);
  });
});
