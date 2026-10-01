// A gym paying through Razorpay moves to a bigger size (ROADMAP Stage 3 item 1d-iii-a), against
// real Postgres with a fake Razorpay in place of Razorpay's API. DATABASE_URL-gated.
//
// Razorpay cannot change what an Indian card, UPI or bank account mandate charges (refused on the
// test account, 2026-10-01), so a bigger size is a NEW subscription the gym approves in Razorpay's
// window: the rest of this month's difference taken now, the new price from the old month's end.
//
// THE WORST THING THIS JOB COULD DO: charge a gym for its old plan AND its new one, or open the
// bigger size without a payment. The first test is that.
import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { processRazorpayEvents } from "../src/modules/billing/events.js";
import { upgradeCharge } from "../src/modules/billing/razorpayPlan.js";
import { SIZE_WINDOW_MS } from "../src/modules/billing/service.js";
import { gymSeatCap } from "../src/modules/orgs/repo.js";
import { createMemoryRedis } from "../src/redis.js";
import { BILLING_LOCK_WAIT_MS, holdBillingSuiteLock } from "./billingSuiteLock.js";
import { FakeRazorpay } from "./fakeRazorpay.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** Fakes in Razorpay's shapes, built at run time so no key-shaped text is in the repository. */
const KEY_ID = ["rzp", "test", "C".repeat(14)].join("_");
const KEY_SECRET = "D".repeat(24);
const WEBHOOK_SECRET = ["rzp", "webhook", "size", "secret"].join("-");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "billing-rzp-size-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RAZORPAY_KEY_ID: KEY_ID,
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
const DAY_S = 24 * 60 * 60;
const MONTH_S = 30 * DAY_S;

const SMALL = "zz_rzpsz_small"; // up to 1 member, ₹100
const MID = "zz_rzpsz_mid"; // up to 50 members, ₹150
const BIG = "zz_rzpsz_big"; // up to 5,000 members, ₹200

d("a gym paying through Razorpay moves to a bigger size (real Postgres, fake Razorpay)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const razorpay = new FakeRazorpay();
  // Razorpay's clock half way through the month the gym first pays for: that month is the one
  // being priced, against the server's own (real) clock.
  beforeEach(() => {
    razorpay.clock = Math.floor(Date.now() / 1000) - 15 * DAY_S;
    razorpay.down = false;
    razorpay.cancelFailures = 0;
  });
  const SMALL_PLAN = razorpay.addPlan(10000);
  const MID_PLAN = razorpay.addPlan(15000);
  const BIG_PLAN = razorpay.addPlan(20000);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const runWorker = () =>
    processRazorpayEvents({
      sql,
      redis: createMemoryRedis(),
      paddle: null,
      razorpay: { api: razorpay, keyId: KEY_ID },
      log: silent,
      now: () => new Date(Date.now() + 1000),
    });

  let ip = 0;
  const nextIp = () => `10.47.${String(Math.floor(ip / 250))}.${String((ip++ % 250) + 1)}`;
  type Cookies = Record<string, string>;

  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'billing-rzpsz-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM webhook_events WHERE provider = 'razorpay' AND payload->>'subscriptionId' IN (SELECT provider_ref FROM subscriptions WHERE owner_id IN (${mine}))`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'billing-rzpsz-%@example.com'`;
  };

  // The other billing suites' workers sweep every gym: they take turns (billingSuiteLock.ts).
  let releaseLock: (() => Promise<void>) | null = null;
  beforeAll(async () => {
    releaseLock = await holdBillingSuiteLock(sql);
  }, BILLING_LOCK_WAIT_MS);

  beforeAll(async () => {
    await cleanup();
    for (const [code, cap, price, planId] of [
      [SMALL, 1, 10000, SMALL_PLAN],
      [MID, 50, 15000, MID_PLAN],
      [BIG, 5000, 20000, BIG_PLAN],
    ] as const) {
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap,
                           trial_days, rank, entitlements, member_entitlements, razorpay_plan_id)
        VALUES (${code}, 'org', ${"plan." + code}, ${price}, 'INR', 'month', ${cap}, 0, 10,
                '{}'::jsonb, '{}'::jsonb, ${planId})
        ON CONFLICT (code) DO UPDATE SET active = true, price_minor = ${price}, seat_cap = ${cap},
                                         razorpay_plan_id = ${planId}`;
    }
    app = await buildApp(loadConfig(baseEnv), { razorpayApi: razorpay });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM plans WHERE code IN (${SMALL}, ${MID}, ${BIG})`;
    await app?.close();
    await releaseLock?.();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  const post = (path: string, payload: unknown, cookies: Cookies = {}, headers: Record<string, string> = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", ...headers },
      cookies,
      payload: JSON.stringify(payload),
    });

  /** Cancel plan (1d-ii). */
  const cancelPlan = (gymId: string, cookies: Cookies) =>
    api().inject({ method: "PUT", url: `/v1/orgs/${gymId}/billing/cancel`, remoteAddress: nextIp(), cookies });

  let seq = 0;
  const makeUser = async (): Promise<{ userId: string; cookies: Cookies }> => {
    const email = `billing-rzpsz-${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Billing" });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return {
      userId: (JSON.parse(reg.body) as { userId: string }).userId,
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
    };
  };
  const key = () => randomBytes(8).toString("hex");
  type Window = { checkoutId: string; provider: string; subscriptionId: string; description: string };
  const opened = (res: { statusCode: number; body: string }): Window => {
    expect([res.statusCode, res.body]).toEqual([200, expect.any(String)]);
    const body = JSON.parse(res.body) as Window;
    expect(body.provider).toBe("razorpay");
    return body;
  };
  const sync = (gymId: string, checkoutId: string, cookies: Cookies) => post(`/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, {}, cookies);
  const preview = (gymId: string, cookies: Cookies, planCode: string) => post(`/v1/orgs/${gymId}/billing/size/preview`, { planCode }, cookies);
  const bigger = (gymId: string, cookies: Cookies, planCode: string, k: string = key()) =>
    post(`/v1/orgs/${gymId}/billing/size/razorpay`, { planCode }, cookies, { "idempotency-key": k });
  /** Razorpay's webhook about one subscription, signed as Razorpay signs it. */
  const webhook = async (subId: string) => {
    const raw = JSON.stringify({ entity: "event", event: "subscription.charged", payload: { subscription: { entity: { id: subId, status: "active" } } } });
    const res = await api().inject({
      method: "POST",
      url: "/v1/webhooks/razorpay",
      remoteAddress: nextIp(),
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"),
        "x-razorpay-event-id": `evt_${randomBytes(7).toString("hex")}`,
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
  };
  const rows = (gymId: string) =>
    sql<{ status: string; provider_ref: string; cancel_reason: string | null; cancel_sent_at: Date | null; current_period_end: Date | null; plan: string; cancel_at_period_end: boolean }[]>`
      SELECT s.status, s.provider_ref, s.cancel_reason, s.cancel_sent_at, s.current_period_end, p.code AS plan, s.cancel_at_period_end
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.owner_type = 'gym' AND s.owner_id = ${gymId} AND s.provider = 'razorpay' ORDER BY s.created_at`;

  /** A gym on the smallest size, paid through Razorpay half a month ago. */
  const payingGym = async (planCode = SMALL) => {
    const user = await makeUser();
    const res = await post("/v1/orgs", { trainsHere: true, name: `Rupee Size Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, user.cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    const win = opened(await post(`/v1/orgs/${gymId}/billing/checkout`, { planCode }, user.cookies, { "idempotency-key": key() }));
    razorpay.authenticate(win.subscriptionId);
    expect(JSON.parse((await sync(gymId, win.checkoutId, user.cookies)).body)).toMatchObject({ state: "paid" });
    const sub = razorpay.subs.get(win.subscriptionId);
    if (sub?.current_end == null) throw new Error("no month");
    return { ...user, gymId, oldSub: win.subscriptionId, oldEnd: new Date(sub.current_end * 1000) };
  };
  /** What a bigger size costs now, between two moments the server's clock lies in. */
  const chargeBetween = (from: number, to: number, oldSub: string, before: number, after: number) => {
    const sub = razorpay.subs.get(oldSub);
    const start = sub?.current_start ?? null;
    const end = sub?.current_end ?? null;
    if (start === null || end === null) throw new Error("no month");
    const at = (ms: number) => {
      const c = upgradeCharge({ fromMinor: from, toMinor: to, periodStart: new Date(start * 1000), periodEnd: new Date(end * 1000), now: new Date(ms) });
      return c.kind === "charge" ? c.minor : 0;
    };
    return [at(after), at(before)] as const;
  };

  it(
    "WORST THING: the bigger size opens only once Razorpay says its window was paid, the old plan is cancelled then, and a month the old plan takes after that is refunded",
    async () => {
      const gym = await payingGym();
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);

      const before = Date.now();
      const win = opened(await bigger(gym.gymId, gym.cookies, BIG));
      const after = Date.now();
      // Razorpay was asked for exactly this: the bigger plan, from the day the paid month ends,
      // the rest of this month's difference now, the window open half an hour.
      const asked = razorpay.created.at(-1);
      const [low, high] = chargeBetween(10000, 20000, gym.oldSub, before, after);
      expect(asked?.planId).toBe(BIG_PLAN);
      expect(asked?.startAt?.getTime()).toBe(gym.oldEnd.getTime());
      expect(asked?.upfront?.amountMinor).toBeGreaterThanOrEqual(low);
      expect(asked?.upfront?.amountMinor).toBeLessThanOrEqual(high);
      expect(asked?.upfront?.currency).toBe("INR");
      expect(asked?.expireBy?.getTime()).toBeGreaterThanOrEqual(before + SIZE_WINDOW_MS - 1000);
      expect(asked?.expireBy?.getTime()).toBeLessThanOrEqual(after + SIZE_WINDOW_MS);
      expect(asked?.notes).toEqual({ app: "aihg", gym_id: gym.gymId, checkout_id: win.checkoutId });

      // Not paid: the browser's "paid" and a webhook are not believed. Nothing changes.
      expect(JSON.parse((await sync(gym.gymId, win.checkoutId, gym.cookies)).body)).toEqual({ state: "waiting" });
      await webhook(win.subscriptionId);
      await runWorker();
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", gym.oldSub]]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
      expect(razorpay.cancelled).not.toContain(gym.oldSub);

      // Mandate given but the rest of this month not yet paid (an e-mandate's debit still on its
      // way): still nothing.
      const paying = razorpay.subs.get(win.subscriptionId);
      if (paying === undefined) throw new Error("no subscription");
      razorpay.subs.set(win.subscriptionId, { ...paying, status: "authenticated" });
      expect(JSON.parse((await sync(gym.gymId, win.checkoutId, gym.cookies)).body)).toEqual({ state: "waiting" });
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
      razorpay.subs.set(win.subscriptionId, paying);

      // Paid: the bigger size at once, paid to the old month's end; the old plan cancelled.
      razorpay.authenticate(win.subscriptionId);
      const paid = JSON.parse((await sync(gym.gymId, win.checkoutId, gym.cookies)).body) as { state: string; subscription: { seatCap: number; status: string } };
      expect(paid).toMatchObject({ state: "paid", subscription: { status: "active", seatCap: 5000 } });
      expect(await gymSeatCap(sql, gym.gymId)).toBe(5000);
      const after1 = await rows(gym.gymId);
      expect(after1.map((r) => [r.status, r.provider_ref, r.plan, r.cancel_reason])).toEqual([
        ["expired", gym.oldSub, SMALL, "replaced"],
        ["active", win.subscriptionId, BIG, null],
      ]);
      expect(after1[1]?.current_period_end?.getTime()).toBe(gym.oldEnd.getTime());
      expect(after1[0]?.cancel_sent_at).not.toBeNull();
      expect(razorpay.cancelled).toContain(gym.oldSub);
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("cancelled");
      // Only the rest of this month was taken now.
      const takenNow = (razorpay.invoices.get(win.subscriptionId) ?? []).filter((i) => i.status === "paid");
      expect(takenNow.map((i) => i.amount_paid)).toEqual([asked?.upfront?.amountMinor]);

      // The old plan's month ends and Razorpay charges it anyway: refunded in full.
      razorpay.clock = Math.floor(gym.oldEnd.getTime() / 1000);
      const late = razorpay.charge(gym.oldSub);
      await webhook(gym.oldSub);
      await runWorker();
      await runWorker();
      expect(razorpay.refunds).toContain(late);
      // The old plan's first month, which the gym used, is never refunded.
      const firstMonth = (razorpay.invoices.get(gym.oldSub) ?? [])[0]?.payment_id;
      expect(razorpay.refunds).not.toContain(firstMonth);

      // The new plan's first monthly charge, at the bigger price, from that day.
      const first = razorpay.charge(win.subscriptionId);
      expect(razorpay.payments.get(first)?.amount).toBe(20000);
      await webhook(win.subscriptionId);
      await runWorker();
      const after2 = await rows(gym.gymId);
      expect(after2.map((r) => [r.status, r.provider_ref])).toEqual([
        ["expired", gym.oldSub],
        ["active", win.subscriptionId],
      ]);
      expect(after2[1]?.current_period_end?.getTime()).toBe((Math.floor(gym.oldEnd.getTime() / 1000) + MONTH_S) * 1000);
      expect(razorpay.refunds).not.toContain(first);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "only this gym's billing staff can price or open a bigger size; a bad request is refused before anything is asked",
    async () => {
      const gym = await payingGym();
      const stranger = await payingGym();
      const trainer = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.gymId}, ${trainer.userId}, 'trainer', ${["members.read"]})`;
      const made = razorpay.created.length;
      for (const who of [stranger, trainer]) {
        expect([403, 404]).toContain((await preview(gym.gymId, who.cookies, BIG)).statusCode);
        expect([403, 404]).toContain((await bigger(gym.gymId, who.cookies, BIG)).statusCode);
      }
      expect((await bigger(gym.gymId, {}, BIG)).statusCode).toBe(401);
      expect((await post(`/v1/orgs/${gym.gymId}/billing/size/razorpay`, { planCode: BIG }, gym.cookies)).statusCode).toBe(400);
      expect((await bigger(gym.gymId, gym.cookies, "")).statusCode).toBe(400);
      expect((await post(`/v1/orgs/${gym.gymId}/billing/size/razorpay`, { planCode: BIG, priceMinor: 1 }, gym.cookies, { "idempotency-key": key() })).statusCode).toBe(400);
      expect(razorpay.created.length).toBe(made);
      // A stranger's own plan is untouched by their tries on this gym.
      expect((await rows(stranger.gymId)).map((r) => r.provider_ref)).toEqual([stranger.oldSub]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the price shown is the price asked: the rest of this month's difference now, the bigger price from the paid month's end; the same press opens the same window",
    async () => {
      const gym = await payingGym();
      const before = Date.now();
      const shown = JSON.parse((await preview(gym.gymId, gym.cookies, MID)).body) as { dueNow: { totalLabel: string; taxLabel: string | null }; nextPaymentAt: string; priceLabel: string; seatCap: number };
      const after = Date.now();
      const [low, high] = chargeBetween(10000, 15000, gym.oldSub, before, after);
      const labels = new Set([low, high].map((m) => `₹${String(Math.floor(m / 100))}${m % 100 === 0 ? "" : `.${String(m % 100).padStart(2, "0")}`}`));
      expect(labels).toContain(shown.dueNow.totalLabel);
      expect(shown).toMatchObject({ priceLabel: "₹150", seatCap: 50, nextPaymentAt: gym.oldEnd.toISOString(), dueNow: { taxLabel: null } });
      // A preview changes nothing and asks Razorpay for nothing new.
      expect(razorpay.created.at(-1)?.planId).not.toBe(MID_PLAN);

      const k = key();
      const first = opened(await bigger(gym.gymId, gym.cookies, MID, k));
      const again = opened(await bigger(gym.gymId, gym.cookies, MID, k));
      expect(again.subscriptionId).toBe(first.subscriptionId);
      expect(razorpay.created.filter((c) => c.notes["checkout_id"] === first.checkoutId)).toHaveLength(1);
      expect(JSON.parse((await bigger(gym.gymId, gym.cookies, BIG, k)).body)).toMatchObject({ error: "idempotency_key_reused" });

      // A second press (another size) closes the first window at Razorpay: only one can be paid.
      const second = opened(await bigger(gym.gymId, gym.cookies, BIG));
      expect(razorpay.subs.get(first.subscriptionId)?.status).toBe("cancelled");
      expect(() => {
        razorpay.authenticate(first.subscriptionId);
      }).toThrow();
      razorpay.authenticate(second.subscriptionId);
      expect(JSON.parse((await sync(gym.gymId, second.checkoutId, gym.cookies)).body)).toMatchObject({ state: "paid", subscription: { seatCap: 5000 } });
      // The same press once paid: told so, nothing opened.
      expect(JSON.parse((await bigger(gym.gymId, gym.cookies, MID, k)).body)).toMatchObject({ error: "checkout_replaced" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refused, with nothing asked of Razorpay: the same size, within the hour before renewal, a payment overdue, a plan set to end",
    async () => {
      const gym = await payingGym(MID);
      const made = razorpay.created.length;
      const refusal = async (planCode: string) => JSON.parse((await bigger(gym.gymId, gym.cookies, planCode)).body) as { error: string; message: string };
      expect(await refusal(MID)).toMatchObject({ error: "same_size" });
      expect(await refusal("zz_no_such_plan")).toMatchObject({ error: "plan_not_found" });

      await sql`UPDATE subscriptions SET current_period_end = now() + interval '40 minutes' WHERE provider_ref = ${gym.oldSub}`;
      expect(await refusal(BIG)).toMatchObject({ error: "renewing", message: "Your plan renews within the hour. Change its size after it renews." });
      await sql`UPDATE subscriptions SET current_period_end = ${gym.oldEnd} WHERE provider_ref = ${gym.oldSub}`;

      const ending = await cancelPlan(gym.gymId, gym.cookies);
      expect(ending.statusCode).toBe(200);
      expect(await refusal(BIG)).toMatchObject({ error: "plan_ending" });
      await sql`UPDATE subscriptions SET cancel_at_period_end = false WHERE provider_ref = ${gym.oldSub}`;

      razorpay.fail(gym.oldSub);
      await webhook(gym.oldSub);
      await runWorker();
      expect(await refusal(BIG)).toMatchObject({ error: "payment_overdue" });
      expect(razorpay.created.length).toBe(made);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Razorpay's subscription not exactly our price, or its add-on not exactly the difference: cancelled there, nothing opened",
    async () => {
      const gym = await payingGym();
      razorpay.wrongAmount = true;
      expect(JSON.parse((await bigger(gym.gymId, gym.cookies, BIG)).body)).toMatchObject({ error: "payments_unavailable" });
      expect(razorpay.subs.get(razorpay.cancelled.at(-1) ?? "")?.notes["gym_id"]).toBe(gym.gymId);
      razorpay.wrongUpfront = true;
      const cancelledBefore = razorpay.cancelled.length;
      expect(JSON.parse((await bigger(gym.gymId, gym.cookies, BIG)).body)).toMatchObject({ error: "payments_unavailable" });
      expect(razorpay.cancelled.length).toBe(cancelledBefore + 1);
      expect(await sql`SELECT state FROM billing_checkouts WHERE gym_id = ${gym.gymId} AND replaces_subscription_id IS NOT NULL`).toEqual([{ state: "failed" }, { state: "failed" }]);
      expect((await rows(gym.gymId)).map((r) => r.provider_ref)).toEqual([gym.oldSub]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the plan changed while the window was open (Cancel plan pressed): the bigger size is not put on the gym, and what it took is refunded",
    async () => {
      const gym = await payingGym();
      const win = opened(await bigger(gym.gymId, gym.cookies, BIG));
      expect((await cancelPlan(gym.gymId, gym.cookies)).statusCode).toBe(200);
      razorpay.authenticate(win.subscriptionId);
      expect(JSON.parse((await sync(gym.gymId, win.checkoutId, gym.cookies)).body)).toEqual({ state: "refunded" });
      await runWorker();
      const upfront = (razorpay.invoices.get(win.subscriptionId) ?? [])[0]?.payment_id;
      expect(upfront).toBeDefined();
      expect(razorpay.refunds).toContain(upfront);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      // The gym's plan is as it was: its own size, still set to end, never cancelled for the new one.
      const now = await rows(gym.gymId);
      expect(now.filter((r) => r.status === "active").map((r) => [r.provider_ref, r.cancel_at_period_end])).toEqual([[gym.oldSub, true]]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
      expect(razorpay.cancelled).not.toContain(gym.oldSub);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a window never paid changes nothing; it cannot be paid after its half hour",
    async () => {
      const gym = await payingGym();
      const win = opened(await bigger(gym.gymId, gym.cookies, BIG));
      razorpay.clock = Math.floor(Date.now() / 1000) + SIZE_WINDOW_MS / 1000 + 1;
      expect(() => {
        razorpay.authenticate(win.subscriptionId);
      }).toThrow(/expired/);
      razorpay.expire(win.subscriptionId);
      await webhook(win.subscriptionId);
      await runWorker();
      expect(JSON.parse((await sync(gym.gymId, win.checkoutId, gym.cookies)).body)).toEqual({ state: "waiting" });
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", gym.oldSub]]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
      expect(razorpay.cancelled).not.toContain(gym.oldSub);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Razorpay unreachable when the old plan is cancelled: the bigger size still opens, and the worker cancels the old plan when it can",
    async () => {
      const gym = await payingGym();
      const win = opened(await bigger(gym.gymId, gym.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      // Reached by Razorpay's webhook alone: nobody waits on the page. Razorpay refuses the old
      // plan's cancel there and again when the same run's sweep asks.
      await webhook(win.subscriptionId);
      razorpay.cancelFailures = 2;
      await runWorker();
      const first = await rows(gym.gymId);
      expect(first.map((r) => [r.status, r.cancel_reason, r.cancel_sent_at === null])).toEqual([
        ["expired", "replaced", true],
        ["active", null, true],
      ]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(5000);
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("active");
      await runWorker();
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("cancelled");
      expect((await rows(gym.gymId))[0]?.cancel_sent_at).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Cancel plan after a bigger size, before its first monthly charge: ended at Razorpay at once, and the gym keeps the bigger size to the end of the month it paid for",
    async () => {
      const gym = await payingGym();
      const win = opened(await bigger(gym.gymId, gym.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      expect(JSON.parse((await sync(gym.gymId, win.checkoutId, gym.cookies)).body)).toMatchObject({ state: "paid" });
      expect((await cancelPlan(gym.gymId, gym.cookies)).statusCode).toBe(200);
      // The cancel goes to Razorpay in the hours before the month ends.
      await sql`UPDATE subscriptions SET current_period_end = now() + interval '1 hour' WHERE provider_ref = ${win.subscriptionId}`;
      const run = await runWorker();
      expect(run.cancels.sent).toBe(1);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      await webhook(win.subscriptionId);
      await runWorker();
      expect((await rows(gym.gymId)).filter((r) => r.status === "active").map((r) => [r.provider_ref, r.cancel_at_period_end])).toEqual([[win.subscriptionId, true]]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(5000);
    },
    TEST_TIMEOUT_MS,
  );
  it(
    "round one C1: a paid window that a second press closed before it was written is refunded, and its page says so",
    async () => {
      const gym = await payingGym();
      const first = opened(await bigger(gym.gymId, gym.cookies, MID));
      razorpay.authenticate(first.subscriptionId);
      // The page stopped waiting (an e-mandate's debit slow to land, a closed tab): pressed again.
      const second = opened(await bigger(gym.gymId, gym.cookies, BIG));
      expect(razorpay.subs.get(first.subscriptionId)?.status).toBe("cancelled");
      expect(JSON.parse((await sync(gym.gymId, first.checkoutId, gym.cookies)).body)).toEqual({ state: "refunded" });
      await runWorker();
      const paidFirst = (razorpay.invoices.get(first.subscriptionId) ?? [])[0]?.payment_id;
      expect(paidFirst).toBeDefined();
      expect(razorpay.refunds).toContain(paidFirst);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", gym.oldSub]]);
      // The second window still works.
      razorpay.authenticate(second.subscriptionId);
      expect(JSON.parse((await sync(gym.gymId, second.checkoutId, gym.cookies)).body)).toMatchObject({ state: "paid", subscription: { seatCap: 5000 } });
      expect(razorpay.refunds).not.toContain((razorpay.invoices.get(second.subscriptionId) ?? [])[0]?.payment_id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "round one H1: a second bigger size in the same month is priced from the same month and replaces the first",
    async () => {
      const gym = await payingGym();
      const first = opened(await bigger(gym.gymId, gym.cookies, MID));
      razorpay.authenticate(first.subscriptionId);
      expect(JSON.parse((await sync(gym.gymId, first.checkoutId, gym.cookies)).body)).toMatchObject({ state: "paid", subscription: { seatCap: 50 } });

      const before = Date.now();
      const shown = await preview(gym.gymId, gym.cookies, BIG);
      const after = Date.now();
      expect(shown.statusCode).toBe(200);
      expect(JSON.parse(shown.body)).toMatchObject({ seatCap: 5000, nextPaymentAt: gym.oldEnd.toISOString() });
      const second = opened(await bigger(gym.gymId, gym.cookies, BIG));
      const asked = razorpay.created.at(-1);
      // From ₹150 to ₹200 for the rest of the same month.
      const [low, high] = chargeBetween(15000, 20000, gym.oldSub, before, after + 2000);
      expect(asked?.startAt?.getTime()).toBe(gym.oldEnd.getTime());
      expect(asked?.upfront?.amountMinor).toBeGreaterThanOrEqual(low);
      expect(asked?.upfront?.amountMinor).toBeLessThanOrEqual(high);

      razorpay.authenticate(second.subscriptionId);
      expect(JSON.parse((await sync(gym.gymId, second.checkoutId, gym.cookies)).body)).toMatchObject({ state: "paid", subscription: { seatCap: 5000 } });
      expect((await rows(gym.gymId)).map((r) => [r.status, r.plan, r.cancel_reason])).toEqual([
        ["expired", SMALL, "replaced"],
        ["expired", MID, "replaced"],
        ["active", BIG, null],
      ]);
      expect(razorpay.subs.get(first.subscriptionId)?.status).toBe("cancelled");
      expect((await rows(gym.gymId))[2]?.current_period_end?.getTime()).toBe(gym.oldEnd.getTime());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "round one tests: the old plan renewed, or its payment failed, after the window opened — the paid window is refunded and the old plan left as it is",
    async () => {
      // Renewed: Razorpay charged the old plan's next month before the window was written.
      const renewed = await payingGym();
      const win = opened(await bigger(renewed.gymId, renewed.cookies, BIG));
      const now = razorpay.clock;
      razorpay.clock = Math.floor(renewed.oldEnd.getTime() / 1000);
      razorpay.charge(renewed.oldSub);
      await webhook(renewed.oldSub);
      await runWorker();
      const renewedEnd = (await rows(renewed.gymId))[0]?.current_period_end;
      expect(renewedEnd?.getTime()).toBeGreaterThan(renewed.oldEnd.getTime());
      razorpay.clock = now;
      razorpay.authenticate(win.subscriptionId);
      expect(JSON.parse((await sync(renewed.gymId, win.checkoutId, renewed.cookies)).body)).toEqual({ state: "refunded" });
      await runWorker();
      expect(razorpay.refunds).toContain((razorpay.invoices.get(win.subscriptionId) ?? [])[0]?.payment_id);
      expect((await rows(renewed.gymId)).filter((r) => r.status === "active").map((r) => [r.provider_ref, r.plan])).toEqual([[renewed.oldSub, SMALL]]);
      expect(razorpay.subs.get(renewed.oldSub)?.status).toBe("active");

      // Failed: the old plan's payment failed before the window was written.
      const failed = await payingGym();
      const win2 = opened(await bigger(failed.gymId, failed.cookies, BIG));
      razorpay.fail(failed.oldSub);
      await webhook(failed.oldSub);
      await runWorker();
      razorpay.authenticate(win2.subscriptionId);
      expect(JSON.parse((await sync(failed.gymId, win2.checkoutId, failed.cookies)).body)).toEqual({ state: "refunded" });
      await runWorker();
      expect(razorpay.refunds).toContain((razorpay.invoices.get(win2.subscriptionId) ?? [])[0]?.payment_id);
      expect((await rows(failed.gymId)).filter((r) => r.status === "past_due").map((r) => r.provider_ref)).toEqual([failed.oldSub]);
    },
    TEST_TIMEOUT_MS,
  );
});
