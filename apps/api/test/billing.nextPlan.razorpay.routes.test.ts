// A NEW OWNER CHOOSES THEIR PLAN BEFORE A RAZORPAY PLAN HANDED OVER WITH THE GYM ENDS — routes
// against REAL Postgres (DATABASE_URL-gated), with a fake Razorpay. ROADMAP Stage 2 item 4b-vi-b.
//
// A gym paying through Razorpay is handed to a co-owner: the old owner's plan stops renewing, its
// cancel goes to Razorpay at Accept, and it stays paid to the end of its month (4b-iii-b). The new
// owner chooses their own plan now, in Razorpay's window: Razorpay takes the mandate now and the
// first payment when the old plan ends, so the members never drop to the free app between the two.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): the new
// owner charged for days the old owner already paid for, or the old owner's card charged again
// after the hand-over. "Charged" is read where Razorpay would charge: the payments it took and
// kept, and when it takes the first one.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { planEndReminderEmail } from "../src/modules/billing/emails.js";
import { processRazorpayEvents } from "../src/modules/billing/events.js";
import { applyRazorpaySubscription, planEndAction, syncOrgCheckout } from "../src/modules/billing/service.js";
import { createMemoryRedis } from "../src/redis.js";
import { ROLE_PRIVILEGES, myOwnerRequestResponseSchema, orgCheckoutSyncResponseSchema, orgPlanCancelResponseSchema } from "@app/shared";
import { BILLING_LOCK_WAIT_MS, holdBillingSuiteLock } from "./billingSuiteLock.js";
import { FakeRazorpay } from "./fakeRazorpay.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** Fakes in Razorpay's shapes, built at run time so no key-shaped text is in the repository. */
const KEY_ID = ["rzp", "test", "N".repeat(14)].join("_");
const KEY_SECRET = "P".repeat(24);

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "rzp-next-plan-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RAZORPAY_KEY_ID: KEY_ID,
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: ["rzp", "webhook", "next", "plan"].join("-"),
};

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const BIG = "zz_rzp_next_big"; // up to 5,000 members, ₹200
const SMALL = "zz_rzp_next_small"; // up to 1,000 members, ₹100

type Cookies = Record<string, string>;
interface User {
  userId: string;
  email: string;
  name: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  owner: User;
  /** The old owner's plan's Razorpay subscription. */
  sub: string;
  /** When the month it paid for ends. */
  end: Date;
}
interface ConsolePlan {
  status: string;
  seatCap: number | null;
  cancelAtPeriodEnd: boolean;
  keepUntil: string | null;
  currentPeriodEnd: string | null;
  handedOverBy: string | null;
  nextPlanUntil: string | null;
  followsPaidBy: string | null;
  followsPaidByYou: boolean;
}

d("a new owner chooses their plan before a Razorpay plan handed over with the gym ends (real Postgres, fake Razorpay)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const razorpay = new FakeRazorpay();
  const startClock = razorpay.clock;
  beforeEach(() => {
    razorpay.clock = startClock;
    razorpay.down = false;
  });
  const BIG_PLAN = razorpay.addPlan(20000);
  const SMALL_PLAN = razorpay.addPlan(10000);
  const logged: string[] = [];
  const log = {
    info: () => undefined,
    warn: (o: { event?: string }) => void logged.push(`warn ${o.event ?? ""}`),
    error: (o: { event?: string }) => void logged.push(`error ${o.event ?? ""}`),
  };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** One run of the worker's job, `fromEnd` before (negative) or after the old plan's month ends. */
  const deps = (now: () => Date = () => new Date()) => ({ sql, redis: createMemoryRedis(), paddle: null, razorpay: { api: razorpay, keyId: KEY_ID }, log, now });
  const runAt = (end: Date, fromEnd: number) => processRazorpayEvents(deps(() => new Date(end.getTime() + fromEnd)));

  let ip = 0;
  const nextIp = () => `10.73.${String(Math.floor(ip / 250))}.${String((ip++ % 250) + 1)}`;
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rzp-next-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`UPDATE subscriptions SET follows_subscription_id = NULL WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'rzp-next-t-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'rzp-next-t-%@example.com'`;
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
    const email = `rzp-next-t-${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
    const reg = await api().inject({ method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(), payload: { email, password: PASSWORD, displayName } });
    expect(reg.statusCode, reg.body).toBe(201);
    const login = await api().inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return {
      userId: (JSON.parse(reg.body) as { userId: string }).userId,
      email,
      name: displayName,
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
    };
  };
  const key = () => randomBytes(8).toString("hex");
  const opened = (res: { statusCode: number; body: string }) => {
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as { checkoutId: string; subscriptionId: string; email: string | null };
  };
  const checkout = (gym: Gym, who: User, planCode: string = SMALL) => send("POST", `/v1/orgs/${gym.id}/billing/checkout`, who, { planCode }, { "idempotency-key": key() });
  const sync = async (gymId: string, checkoutId: string, who: User) => {
    const res = await send("POST", `/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, who);
    expect(res.statusCode, res.body).toBe(200);
    return orgCheckoutSyncResponseSchema.parse(JSON.parse(res.body));
  };

  /** A gym on a paid month through Razorpay, started a day ago, its month ending in about 29. */
  const makePaidGym = async (ownerName: string): Promise<Gym> => {
    razorpay.clock = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `${ownerName}'s Next Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    const win = opened(await send("POST", `/v1/orgs/${id}/billing/checkout`, owner, { planCode: BIG }, { "idempotency-key": key() }));
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
  const handOver = async (gym: Gym, to: User, from: User) => {
    expect((await send("POST", `/v1/orgs/${gym.id}/staff/${to.userId}/owner-request`, from)).statusCode).toBe(201);
    const mineRes = await send("GET", `/v1/orgs/${gym.id}/owner-request`, to);
    const request = myOwnerRequestResponseSchema.parse(JSON.parse(mineRes.body)).request;
    if (request === null) throw new Error("no request is waiting");
    const res = await send("POST", `/v1/orgs/${gym.id}/owner-request/${request.id}/accept`, to);
    expect(res.statusCode, res.body).toBe(200);
  };
  async function planRow(gymId: string, sub: string) {
    return (
      await sql<
        {
          id: string;
          status: string;
          cancel_at_period_end: boolean;
          cancel_sent_at: Date | null;
          cancel_reason: string | null;
          current_period_end: Date | null;
          trial_seat_cap: number | null;
          follows_subscription_id: string | null;
          handed_over_from: string | null;
        }[]
      >`
        SELECT id, status, cancel_at_period_end, cancel_sent_at, cancel_reason, current_period_end, trial_seat_cap,
               follows_subscription_id, handed_over_from
        FROM subscriptions
        WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'razorpay' AND provider_ref = ${sub}`
    )[0];
  }
  const liveRows = async (gymId: string) =>
    await sql<{ provider_ref: string }[]>`
      SELECT provider_ref FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId} AND status IN ('trialing','active','past_due')`;
  /** The gym's plan as the console reads it, for this person. */
  const consolePlan = async (gym: Gym, who: User): Promise<ConsolePlan | null> => {
    const res = await send("GET", "/v1/orgs/mine", who);
    expect(res.statusCode, res.body).toBe(200);
    const { orgs } = JSON.parse(res.body) as { orgs: { id: string; subscription: ConsolePlan | null }[] };
    return orgs.find((o) => o.id === gym.id)?.subscription ?? null;
  };
  /** Every payment Razorpay took on this subscription and did not give back. */
  const keptPayments = (sub: string) =>
    (razorpay.invoices.get(sub) ?? []).filter((i) => i.status === "paid" && i.payment_id != null && !razorpay.refunds.includes(i.payment_id)).map((i) => i.payment_id);
  /** A paid gym handed from Kd to Cora: Razorpay took the old plan's cancel at Accept. */
  const handedOverGym = async () => {
    const gym = await makePaidGym("Kd");
    const cora = await makeCoOwner(gym, "Cora");
    await handOver(gym, cora, gym.owner);
    expect(razorpay.endAtCycleEnd.has(gym.sub)).toBe(true);
    return { gym, cora };
  };
  /** Razorpay at the end of the old plan's month: the old plan ends there, as it was told. */
  const oldMonthEnds = (gym: Gym) => {
    razorpay.clock = Math.floor(gym.end.getTime() / 1000);
    razorpay.endCycle(gym.sub);
  };

  // ── The worst thing: a month paid twice, or the old owner charged again ─────────────────────
  describe("nobody pays twice for the same days, and the old owner is never charged again", () => {
    it("Razorpay takes the mandate now and the new owner's first payment exactly when the old plan ends", async () => {
      const { gym, cora } = await handedOverGym();
      // Offered until three hours before the old plan ends.
      const before = await consolePlan(gym, cora);
      expect(before?.nextPlanUntil).toBe(new Date(gym.end.getTime() - 3 * HOUR_MS).toISOString());

      const win = opened(await checkout(gym, cora));
      // The window is filled in with the new owner's own email, never the old owner's.
      expect(win.email).toBe(cora.email);
      const asked = razorpay.created.at(-1);
      expect(asked?.startAt?.getTime()).toBe(gym.end.getTime());
      expect(asked?.expireBy?.getTime()).toBe(gym.end.getTime() - 3 * HOUR_MS);
      expect(razorpay.subs.get(win.subscriptionId)?.start_at).toBe(Math.ceil(gym.end.getTime() / 1000));

      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, cora)).toMatchObject({ state: "paid" });
      // Nothing is taken before the old plan ends.
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect(razorpay.subs.get(win.subscriptionId)).toMatchObject({ status: "authenticated", paid_count: 0 });

      // It takes the old plan's place now, starting when that plan ends, with its member limit.
      const old = await planRow(gym.id, gym.sub);
      const next = await planRow(gym.id, win.subscriptionId);
      expect(old).toMatchObject({ status: "expired", cancel_reason: "followed" });
      expect(next).toMatchObject({ status: "trialing", follows_subscription_id: old?.id, trial_seat_cap: 5000 });
      expect(next?.current_period_end?.getTime()).toBe(Math.ceil(gym.end.getTime() / 1000) * 1000);
      expect((await liveRows(gym.id)).map((r) => r.provider_ref)).toEqual([win.subscriptionId]);
      // Its own size where that is smaller: nobody was over it, or the window would not have opened.
      expect(await consolePlan(gym, cora)).toMatchObject({ status: "trialing", followsPaidBy: "Kd", followsPaidByYou: false, nextPlanUntil: null, seatCap: 1000 });

      // A day before: nothing taken from either owner.
      await runAt(gym.end, -DAY_MS);
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect(keptPayments(gym.sub)).toHaveLength(1);

      // The old plan ends at Razorpay; the new owner's first payment is taken at that moment.
      oldMonthEnds(gym);
      razorpay.charge(win.subscriptionId);
      expect(razorpay.subs.get(win.subscriptionId)?.current_start).toBe(Math.ceil(gym.end.getTime() / 1000));
      expect((await send("POST", `/v1/orgs/${gym.id}/billing/razorpay/refresh`, cora)).statusCode).toBe(204);
      await runAt(gym.end, 60_000);
      expect(keptPayments(gym.sub)).toHaveLength(1);
      expect(keptPayments(win.subscriptionId)).toHaveLength(1);
      expect(await planRow(gym.id, win.subscriptionId)).toMatchObject({ status: "active", trial_seat_cap: null });
      expect(await consolePlan(gym, cora)).toMatchObject({ status: "active", followsPaidBy: null, seatCap: 1000 });
    }, TEST_TIMEOUT_MS);

    it("the old plan Razorpay charges anyway after the new one took its place: that month goes back to the old owner", async () => {
      const { gym, cora } = await handedOverGym();
      const win = opened(await checkout(gym, cora));
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, cora)).toMatchObject({ state: "paid" });
      // Razorpay forgets the month-end cancel it took at Accept and renews the old plan.
      razorpay.endAtCycleEnd.delete(gym.sub);
      oldMonthEnds(gym);
      const renewal = keptPayments(gym.sub).at(-1);
      expect(keptPayments(gym.sub)).toHaveLength(2);
      razorpay.charge(win.subscriptionId);
      // Razorpay's event about the old plan: it is ended there and the renewal refunded.
      const after = () => new Date(gym.end.getTime() + 60_000);
      expect(await applyRazorpaySubscription(deps(after), gym.sub)).not.toBe("retry");
      await runAt(gym.end, 60_000);
      expect(razorpay.subs.get(gym.sub)?.status).toBe("cancelled");
      expect(razorpay.refunds).toContain(renewal);
      expect(keptPayments(gym.sub)).toHaveLength(1);
      // The new owner's plan is the gym's, paid once.
      expect((await liveRows(gym.id)).map((r) => r.provider_ref)).toEqual([win.subscriptionId]);
      expect(keptPayments(win.subscriptionId)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);

    it("handed back to the person who paid before the window is paid: it never starts, and nothing is charged", async () => {
      const { gym, cora } = await handedOverGym();
      const win = opened(await checkout(gym, cora));
      // Accept closes the window at Razorpay; here Razorpay missed that, and the window is paid after.
      razorpay.cancelFailures = 1;
      await handOver(gym, gym.owner, cora);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("created");
      razorpay.authenticate(win.subscriptionId);
      // The step the console's sync runs, with this file's own log: expected, so a warning.
      expect(await syncOrgCheckout(deps(), { userId: gym.owner.userId, gymId: gym.id, checkoutId: win.checkoutId })).toEqual({ state: "not_started" });
      expect(logged).toContain("warn billing.following_not_started");
      expect(logged).not.toContain("error billing.duplicate_subscription");
      expect(await sync(gym.id, win.checkoutId, gym.owner)).toEqual({ state: "not_started" });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      // The gym's plan is still the one Kd paid for, to the end of its month.
      expect((await liveRows(gym.id)).map((r) => r.provider_ref)).toEqual([gym.sub]);
    }, TEST_TIMEOUT_MS);

    it("handed on to a third owner before the window is paid: it never starts, and nothing is charged", async () => {
      const { gym, cora } = await handedOverGym();
      const dev = await makeCoOwner(gym, "Dev");
      const win = opened(await checkout(gym, cora));
      // Paid in the instant before Accept's cancel of the window reaches Razorpay.
      razorpay.duringNextCancel = (id) => {
        if (id === win.subscriptionId) razorpay.authenticate(id);
        return Promise.resolve();
      };
      await handOver(gym, dev, cora);
      expect(await sync(gym.id, win.checkoutId, dev)).toEqual({ state: "not_started" });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect((await liveRows(gym.id)).map((r) => r.provider_ref)).toEqual([gym.sub]);
      // Dev may choose theirs, and Kd's plan still stops: Razorpay has it.
      expect((await consolePlan(gym, dev))?.nextPlanUntil).toBe(new Date(gym.end.getTime() - 3 * HOUR_MS).toISOString());
    }, TEST_TIMEOUT_MS);

    it("handed on, Razorpay missing the window's cancel, and the window paid after: never the gym's plan, nothing charged", async () => {
      const { gym, cora } = await handedOverGym();
      const dev = await makeCoOwner(gym, "Dev");
      const win = opened(await checkout(gym, cora));
      razorpay.cancelFailures = 1;
      await handOver(gym, dev, cora);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("created");
      // Cora's mandate, approved for a gym that is Dev's now: it would pay for somebody else's gym.
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, dev)).toEqual({ state: "not_started" });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect((await liveRows(gym.id)).map((r) => r.provider_ref)).toEqual([gym.sub]);
    }, TEST_TIMEOUT_MS);

    it("a first payment Razorpay would take before the old plan ends is never opened, nor placed", async () => {
      const { gym, cora } = await handedOverGym();
      // Razorpay answers a start a second early: the window is never opened.
      razorpay.shiftNextStart = -1;
      const refused = await checkout(gym, cora);
      expect(refused.statusCode, refused.body).toBe(503);
      const early = razorpay.created.length;
      expect(razorpay.cancelled.at(-1)).toBeDefined();

      // A window whose start moved early after it opened: approved, never placed, cancelled.
      const win = opened(await checkout(gym, cora));
      expect(razorpay.created.length).toBe(early + 1);
      const s = razorpay.subs.get(win.subscriptionId);
      if (s === undefined) throw new Error("no subscription");
      const sooner = Math.ceil(gym.end.getTime() / 1000) - 1;
      razorpay.subs.set(win.subscriptionId, { ...s, start_at: sooner, charge_at: sooner });
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, cora)).toEqual({ state: "not_started" });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect((await liveRows(gym.id)).map((r) => r.provider_ref)).toEqual([gym.sub]);
    }, TEST_TIMEOUT_MS);

    it("cancelled before it starts: Razorpay is told in the last hours, nothing is charged, and Keep my plan undoes it until then", async () => {
      const { gym, cora } = await handedOverGym();
      const win = opened(await checkout(gym, cora));
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, cora)).toMatchObject({ state: "paid" });

      const cancelled = await send("PUT", `/v1/orgs/${gym.id}/billing/cancel`, cora);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(orgPlanCancelResponseSchema.parse(JSON.parse(cancelled.body)).subscription).toMatchObject({ status: "trialing", cancelAtPeriodEnd: true });
      // Not yet sent: it can still be kept.
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("authenticated");
      expect((await send("DELETE", `/v1/orgs/${gym.id}/billing/cancel`, cora)).statusCode).toBe(200);
      expect((await planRow(gym.id, win.subscriptionId))?.cancel_at_period_end).toBe(false);
      expect((await send("PUT", `/v1/orgs/${gym.id}/billing/cancel`, cora)).statusCode).toBe(200);

      // In the last three hours the worker ends it at Razorpay; the members keep it until then.
      await runAt(gym.end, -2 * HOUR_MS);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect((await planRow(gym.id, win.subscriptionId))?.status).toBe("trialing");
      oldMonthEnds(gym);
      await runAt(gym.end, 60_000);
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect(keptPayments(gym.sub)).toHaveLength(1);
      expect(await liveRows(gym.id)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("handed on again before it starts: it is set to end at Razorpay at once, never charged, and the next owner may choose theirs", async () => {
      const { gym, cora } = await handedOverGym();
      const win = opened(await checkout(gym, cora));
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, cora)).toMatchObject({ state: "paid" });
      const dev = await makeCoOwner(gym, "Dev");
      await handOver(gym, dev, cora);
      // Razorpay ends a plan not yet charged at once (it refuses a month-end cancel for it).
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect(await planRow(gym.id, win.subscriptionId)).toMatchObject({ status: "trialing", cancel_at_period_end: true, handed_over_from: cora.userId });
      expect((await consolePlan(gym, dev))?.nextPlanUntil).toBe(new Date(Math.ceil(gym.end.getTime() / 1000) * 1000 - 3 * HOUR_MS).toISOString());
      const devs = opened(await checkout(gym, dev));
      expect(razorpay.created.at(-1)?.startAt?.getTime()).toBe(Math.ceil(gym.end.getTime() / 1000) * 1000);
      razorpay.authenticate(devs.subscriptionId);
      expect(await sync(gym.id, devs.checkoutId, dev)).toMatchObject({ state: "paid" });
      oldMonthEnds(gym);
      razorpay.charge(devs.subscriptionId);
      await runAt(gym.end, 60_000);
      expect(keptPayments(win.subscriptionId)).toEqual([]);
      expect(keptPayments(gym.sub)).toHaveLength(1);
      expect(keptPayments(devs.subscriptionId)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);
  });

  describe("who may choose it, and when", () => {
    it("refused to the person who paid, before Razorpay has the cancel, in the last three hours, and on a plan not handed over", async () => {
      const { gym, cora } = await handedOverGym();
      const payer = await checkout(gym, gym.owner);
      expect(payer.statusCode).toBe(409);
      expect(errorOf(payer)).toBe("next_plan_not_yours");

      // Razorpay down at Accept: its cancel not yet taken, the old plan could still renew.
      const other = await makePaidGym("Ravi");
      const nora = await makeCoOwner(other, "Nora");
      razorpay.down = true;
      await handOver(other, nora, other.owner);
      razorpay.down = false;
      expect((await consolePlan(other, nora))?.nextPlanUntil).toBeNull();
      const early = await checkout(other, nora);
      expect(early.statusCode).toBe(409);
      expect(errorOf(early)).toBe("plan_ending_unconfirmed");
      expect((JSON.parse(early.body) as { message: string }).message).toMatch(/^Razorpay is still being told/);

      // Three hours before the end, and after: too late.
      await sql`UPDATE subscriptions SET current_period_end = now() + interval '2 hours' WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`;
      const late = await checkout(gym, cora);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late)).toBe("too_late");

      // A plan not handed over is any plan already chosen.
      const plain = await makePaidGym("Asha");
      expect(errorOf(await checkout(plain, plain.owner))).toBe("already_subscribed");
    }, TEST_TIMEOUT_MS);

    it("somebody of another gym is refused, and sees nothing of it", async () => {
      const { gym } = await handedOverGym();
      const stranger = await person("Stranger");
      const res = await checkout(gym, stranger);
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("its size is not changed before it starts", async () => {
      const { gym, cora } = await handedOverGym();
      const win = opened(await checkout(gym, cora));
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.id, win.checkoutId, cora)).toMatchObject({ state: "paid" });
      const res = await send("POST", `/v1/orgs/${gym.id}/billing/size/razorpay`, cora, { planCode: BIG }, { "idempotency-key": key() });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("plan_not_started");
    }, TEST_TIMEOUT_MS);
  });

  describe("the reminder of a handed-over Razorpay plan", () => {
    const endsAt = new Date("2026-11-10T16:00:00Z");
    const now = new Date("2026-11-03T16:00:00Z");
    const until = new Date(endsAt.getTime() - 3 * HOUR_MS);
    const due = { endsAt, handedOver: true, handedOverConfirmed: true, handedOverFrom: "kd", cancelSent: true, provider: "razorpay" as const };

    it.each([
      ["the new owner, Razorpay has the cancel", due, "cora", { kind: "choose_next", until, provider: "razorpay" }],
      ["the person who paid", due, "kd", { kind: "choose" }],
      ["Razorpay not yet told", { ...due, handedOverConfirmed: false, cancelSent: false }, "cora", { kind: "choose" }],
      ["inside the last three hours", { ...due, endsAt: new Date(now.getTime() + 2 * HOUR_MS) }, "cora", { kind: "choose" }],
    ])("%s", (_name, row, who, action) => {
      expect(planEndAction(row, who, now)).toEqual(action);
    });

    it("says the first payment is taken when the old plan ends, never that nothing is charged", () => {
      const m = planEndReminderEmail({
        to: "cora@example.com",
        gymName: "Iron Pune",
        orgType: "gym",
        members: 40,
        seatCap: 5000,
        priceLabel: "₹200.00",
        trialing: false,
        following: false,
        endsAt,
        timezone: "Asia/Kolkata",
        reminder: false,
        action: { kind: "choose_next", until, provider: "razorpay" },
        planLink: "http://localhost:5173/console",
      });
      expect(m.text).toContain("choose the next one before");
      expect(m.text).toContain("It starts when this one ends, and its first payment is taken then.");
      expect(m.text).not.toContain("nothing is charged until then");
    });
  });
});
