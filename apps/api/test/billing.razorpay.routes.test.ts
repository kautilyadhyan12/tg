// An Indian gym pays through Razorpay (ROADMAP Stage 3 item 1d-i), against real Postgres with
// a fake Razorpay in place of Razorpay's API. DATABASE_URL-gated.
//
// THE WORST THING THIS JOB COULD DO: open a paid plan for a gym that has not paid — a "paid"
// message from the browser or a webhook, believed — or put one gym's payment on another. The
// first test is that. Then: charged exactly our price, never twice, never touching what
// something else on the same Razorpay account made.
import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { processRazorpayEvents } from "../src/modules/billing/events.js";
import { gymSeatCap } from "../src/modules/orgs/repo.js";
import { createMemoryRedis } from "../src/redis.js";
import { FakeRazorpay } from "./fakeRazorpay.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const WEBHOOK_SECRET = ["rzp", "webhook", "test", "secret", "for", "routes"].join("-");
/** Fakes in Razorpay's shapes, built at run time so no key-shaped text is in the repository. */
const KEY_ID = ["rzp", "test", "A".repeat(14)].join("_");
const KEY_SECRET = "B".repeat(24);

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "billing-rzp-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RAZORPAY_KEY_ID: KEY_ID,
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SMALL = "zz_rzp_small"; // up to 1 member, ₹100
const BIG = "zz_rzp_big"; // up to 5,000 members, ₹200

d("an Indian gym pays through Razorpay (real Postgres, fake Razorpay)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const razorpay = new FakeRazorpay();
  const SMALL_PLAN = razorpay.addPlan(10000);
  const BIG_PLAN = razorpay.addPlan(20000);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let noRazorpay: Awaited<ReturnType<typeof buildApp>> | undefined;
  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  /** One run of the worker's job; `aheadMs` runs it that far in the future (see the Paddle
   *  suite: an event's `not_before` is Postgres's clock, so at least a second ahead). */
  const runWorker = (aheadMs = 1000) =>
    processRazorpayEvents({
      sql,
      redis: createMemoryRedis(),
      paddle: null,
      razorpay: { api: razorpay, keyId: KEY_ID },
      log: silent,
      now: () => new Date(Date.now() + aheadMs),
    });

  let ip = 0;
  const nextIp = () => `10.43.${String(Math.floor(ip / 250))}.${String((ip++ % 250) + 1)}`;
  type Cookies = Record<string, string>;

  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'billing-rzp-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM webhook_events WHERE provider = 'razorpay'`;
    await sql`DELETE FROM billing_refunds WHERE provider = 'razorpay'`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'billing-rzp-%@example.com'`;
  };

  beforeAll(async () => {
    await cleanup();
    for (const [code, cap, price, planId] of [
      [SMALL, 1, 10000, SMALL_PLAN],
      [BIG, 5000, 20000, BIG_PLAN],
    ] as const) {
      // trial_days 0: the trial is on the smallest plan WITH a trial (the seeded ₹ band 1).
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap,
                           trial_days, rank, entitlements, member_entitlements, razorpay_plan_id)
        VALUES (${code}, 'org', ${"plan." + code}, ${price}, 'INR', 'month', ${cap}, 0, 10,
                '{}'::jsonb, '{}'::jsonb, ${planId})
        ON CONFLICT (code) DO UPDATE SET active = true, price_minor = ${price}, seat_cap = ${cap},
                                         razorpay_plan_id = ${planId}`;
    }
    app = await buildApp(loadConfig(baseEnv), { razorpayApi: razorpay });
    noRazorpay = await buildApp(loadConfig({ ...baseEnv, RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }));
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM plans WHERE code IN (${SMALL}, ${BIG})`;
    await app?.close();
    await noRazorpay?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  const post = (path: string, payload: unknown, cookies: Cookies = {}, headers: Record<string, string> = {}, on = api()) =>
    on.inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", ...headers },
      cookies,
      payload: JSON.stringify(payload),
    });
  const get = (path: string, cookies: Cookies, on = api()) => on.inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  let seq = 0;
  const makeUser = async (): Promise<{ userId: string; cookies: Cookies }> => {
    const email = `billing-rzp-${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Billing" });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return {
      userId: (JSON.parse(reg.body) as { userId: string }).userId,
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
    };
  };
  const owner = async () => {
    const user = await makeUser();
    const res = await post("/v1/orgs", { name: `Rupee Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, user.cookies);
    expect(res.statusCode).toBe(201);
    return { ...user, gymId: (JSON.parse(res.body) as { org: { id: string } }).org.id };
  };
  const checkout = (gymId: string, cookies: Cookies, planCode: string, key: string = randomBytes(8).toString("hex")) =>
    post(`/v1/orgs/${gymId}/billing/checkout`, { planCode }, cookies, { "idempotency-key": key });
  const opened = (res: { statusCode: number; body: string }) => {
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { checkoutId: string; provider: string; keyId: string; subscriptionId: string; description: string };
    expect(body.provider).toBe("razorpay");
    return body;
  };
  const sync = (gymId: string, checkoutId: string, cookies: Cookies) => post(`/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, {}, cookies);
  const signedWebhook = (subId: string, event = "subscription.charged", secret = WEBHOOK_SECRET, eventId = `evt_${randomBytes(7).toString("hex")}`) => {
    const raw = JSON.stringify({ entity: "event", event, payload: { subscription: { entity: { id: subId, status: "active" } } } });
    return api().inject({
      method: "POST",
      url: "/v1/webhooks/razorpay",
      remoteAddress: nextIp(),
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex"),
        "x-razorpay-event-id": eventId,
      },
      payload: raw,
    });
  };
  const paidRows = (gymId: string) =>
    sql<{ status: string; provider_ref: string; cancel_reason: string | null }[]>`
      SELECT status, provider_ref, cancel_reason FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'razorpay' ORDER BY created_at`;
  const myGym = async (gymId: string, cookies: Cookies) =>
    (JSON.parse((await get("/v1/orgs/mine", cookies)).body) as { orgs: { id: string; subscription: Record<string, unknown> | null; paymentOverdue: boolean | null; paymentOverdueThrough: string | null; consoleReadOnly: boolean | null }[] }).orgs.find(
      (o) => o.id === gymId,
    );

  it(
    "WORST THING: nothing opens a plan until Razorpay itself says it is paid, and one gym's payment never lands on another",
    async () => {
      const a = await owner();
      const b = await owner();
      const aWin = opened(await checkout(a.gymId, a.cookies, BIG));
      const bWin = opened(await checkout(b.gymId, b.cookies, BIG));
      // The window carries what our server made: our note, our checkout, A's gym.
      expect(razorpay.created.at(-2)?.notes).toEqual({ app: "aihg", gym_id: a.gymId, checkout_id: aWin.checkoutId });

      // The browser says "paid" and a signed webhook says "charged", but Razorpay says the
      // window was never paid: nothing opens.
      expect(JSON.parse((await sync(a.gymId, aWin.checkoutId, a.cookies)).body)).toEqual({ state: "waiting" });
      expect((await signedWebhook(aWin.subscriptionId)).statusCode).toBe(200);
      await runWorker();
      expect(await paidRows(a.gymId)).toEqual([]);
      expect((await myGym(a.gymId, a.cookies))?.subscription).toBeNull();

      // A webhook that is not Razorpay's is refused and kept nowhere.
      razorpay.authenticate(aWin.subscriptionId);
      // And whatever the subscription's own notes come to say, its gym is our checkout's.
      const aSub = razorpay.subs.get(aWin.subscriptionId);
      if (aSub === undefined) throw new Error("no subscription");
      razorpay.subs.set(aWin.subscriptionId, { ...aSub, notes: { ...aSub.notes, gym_id: b.gymId, checkout_id: bWin.checkoutId } });
      expect((await signedWebhook(aWin.subscriptionId, "subscription.charged", "not-the-secret-at-all")).statusCode).toBe(401);
      expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'razorpay' AND payload->>'subscriptionId' = ${aWin.subscriptionId} AND status = 'pending'`).toHaveLength(0);

      // Razorpay now says A's is paid: it lands on A, never on B, whichever gym asks.
      expect((await sync(b.gymId, aWin.checkoutId, b.cookies)).statusCode).toBe(404);
      expect((await sync(a.gymId, aWin.checkoutId, b.cookies)).statusCode).toBe(404);
      expect((await signedWebhook(aWin.subscriptionId)).statusCode).toBe(200);
      await runWorker();
      expect((await paidRows(a.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", aWin.subscriptionId]]);
      expect(await paidRows(b.gymId)).toEqual([]);
      expect(JSON.parse((await sync(b.gymId, bWin.checkoutId, b.cookies)).body)).toEqual({ state: "waiting" });

      // A's console shows the plan, its price in rupees, and who takes the payments.
      expect((await myGym(a.gymId, a.cookies))?.subscription).toMatchObject({
        status: "active",
        priceLabel: "₹200",
        subscribed: true,
        paidThrough: "razorpay",
        seatCap: 5000,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a window opens only at exactly our price; otherwise nothing is opened and Razorpay's subscription is cancelled",
    async () => {
      const a = await owner();
      razorpay.wrongAmount = true;
      const res = await checkout(a.gymId, a.cookies, BIG);
      expect(res.statusCode).toBe(503);
      const made = [...razorpay.subs.values()].filter((s) => s.notes["gym_id"] === a.gymId);
      expect(made).toHaveLength(1);
      expect(razorpay.cancelled).toContain(made[0]?.id);
      expect(await sql`SELECT state FROM billing_checkouts WHERE gym_id = ${a.gymId}`).toEqual([{ state: "failed" }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a gym is never charged twice — the replaced window is cancelled, and a second paid plan is cancelled and refunded once",
    async () => {
      const a = await owner();
      const first = opened(await checkout(a.gymId, a.cookies, BIG));
      const second = opened(await checkout(a.gymId, a.cookies, BIG));
      expect(razorpay.cancelled).toContain(first.subscriptionId);
      razorpay.authenticate(second.subscriptionId);
      expect(JSON.parse((await sync(a.gymId, second.checkoutId, a.cookies)).body)).toMatchObject({ state: "paid", subscription: { status: "active" } });
      expect(JSON.parse((await checkout(a.gymId, a.cookies, BIG)).body)).toMatchObject({ error: "already_subscribed" });

      // The first window was paid anyway, in the instant before Razorpay cancelled it.
      const firstSub = razorpay.subs.get(first.subscriptionId);
      if (firstSub === undefined) throw new Error("no first subscription");
      razorpay.subs.set(first.subscriptionId, { ...firstSub, status: "created", ended_at: null });
      razorpay.authenticate(first.subscriptionId);
      const extraPayment = razorpay.invoices.get(first.subscriptionId)?.[0]?.payment_id;
      await signedWebhook(first.subscriptionId);
      await runWorker();
      expect((await paidRows(a.gymId)).map((r) => [r.provider_ref, r.status, r.cancel_reason])).toEqual([
        [second.subscriptionId, "active", null],
        [first.subscriptionId, "expired", "duplicate"],
      ]);
      expect(razorpay.refunds).toEqual(expect.arrayContaining([extraPayment]));
      const secondPayment = razorpay.invoices.get(second.subscriptionId)?.[0]?.payment_id;
      expect(razorpay.refunds).not.toContain(secondPayment);
      // Its events again, and the worker again: Razorpay is asked for nothing more.
      const refundsBefore = razorpay.refunds.length;
      await signedWebhook(first.subscriptionId, "subscription.cancelled");
      await runWorker(2 * 60_000);
      expect(razorpay.refunds).toHaveLength(refundsBefore);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a subscription something else on the same Razorpay account made is never touched",
    async () => {
      const foreign = razorpay.foreign(BIG_PLAN);
      const itsPayment = razorpay.invoices.get(foreign)?.[0]?.payment_id;
      expect((await signedWebhook(foreign)).statusCode).toBe(200);
      await runWorker();
      expect(await sql`SELECT 1 FROM subscriptions WHERE provider_ref = ${foreign}`).toHaveLength(0);
      expect(await sql`SELECT 1 FROM billing_refunds WHERE subscription_ref = ${foreign}`).toHaveLength(0);
      expect(razorpay.cancelled).not.toContain(foreign);
      expect(razorpay.refunds).not.toContain(itsPayment);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym pays during its free trial: the mandate now, the first payment when the trial ends, the trial's 200 members until then",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const own = (await sql<{ trial_ends_at: Date }[]>`
        SELECT trial_ends_at FROM subscriptions WHERE owner_id = ${a.gymId} AND provider = 'none'`)[0];
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      // Razorpay starts the subscription at the gym's own trial end, to the second.
      expect(razorpay.created.at(-1)?.startAt?.getTime()).toBe(own?.trial_ends_at.getTime());
      const startAt = razorpay.subs.get(win.subscriptionId)?.start_at ?? 0;
      expect(startAt).toBe(Math.ceil((own?.trial_ends_at.getTime() ?? 0) / 1000));

      razorpay.authenticate(win.subscriptionId);
      const synced = JSON.parse((await sync(a.gymId, win.checkoutId, a.cookies)).body) as { state: string; subscription?: Record<string, unknown> };
      const trialEnd = new Date(startAt * 1000).toISOString();
      expect(synced).toMatchObject({
        state: "paid",
        subscription: { status: "trialing", subscribed: true, paidThrough: "razorpay", priceLabel: "₹200", seatCap: 200, nextSeatCap: 5000, currentPeriodEnd: trialEnd },
      });
      expect(razorpay.invoices.get(win.subscriptionId) ?? []).toEqual([]);
      expect(await gymSeatCap(sql, a.gymId)).toBe(200);

      // The trial's last day: Razorpay takes the first payment, and the chosen size starts.
      razorpay.clock = startAt;
      razorpay.charge(win.subscriptionId);
      await signedWebhook(win.subscriptionId);
      await runWorker();
      expect((await myGym(a.gymId, a.cookies))?.subscription).toMatchObject({ status: "active", seatCap: 5000, nextSeatCap: null, paidThrough: "razorpay" });
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${a.gymId} AND action = 'billing.converted'`).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trial window not paid before the trial ends is told so, nothing charged",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const win = opened(await checkout(a.gymId, a.cookies, SMALL));
      const sub = razorpay.subs.get(win.subscriptionId);
      if (sub === undefined) throw new Error("no subscription");
      razorpay.subs.set(win.subscriptionId, { ...sub, status: "expired", ended_at: sub.start_at });
      expect(JSON.parse((await sync(a.gymId, win.checkoutId, a.cookies)).body)).toEqual({ state: "trial_ended" });
      expect(await paidRows(a.gymId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a failed payment: past due, then after 2 days the console is read-only and names Razorpay's email; a payment opens it again",
    async () => {
      const a = await owner();
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);

      razorpay.fail(win.subscriptionId);
      await signedWebhook(win.subscriptionId, "subscription.pending");
      await runWorker();
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["past_due"]);
      await runWorker(2 * DAY_MS - 60_000);
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["past_due"]);
      // Razorpay gives up retrying (halted) after the grace: still unpaid.
      razorpay.fail(win.subscriptionId, "halted");
      await signedWebhook(win.subscriptionId, "subscription.halted");
      expect((await runWorker(2 * DAY_MS + 5000)).gracesEnded).toBe(1);
      expect(await paidRows(a.gymId)).toEqual([{ status: "expired", provider_ref: win.subscriptionId, cancel_reason: "grace_expired" }]);
      expect(await myGym(a.gymId, a.cookies)).toMatchObject({ consoleReadOnly: true, paymentOverdue: true, paymentOverdueThrough: "razorpay" });
      // A second plan would charge twice: the overdue one is paid instead.
      expect(JSON.parse((await checkout(a.gymId, a.cookies, BIG)).body)).toMatchObject({ error: "payment_overdue" });

      razorpay.charge(win.subscriptionId);
      await signedWebhook(win.subscriptionId);
      await runWorker(2 * DAY_MS + 10_000);
      expect(await myGym(a.gymId, a.cookies)).toMatchObject({ consoleReadOnly: false, paymentOverdue: false, paymentOverdueThrough: null, subscription: { status: "active" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an Indian gym can pay online only where Razorpay is set up; its plan's size and payment page are not Paddle's",
    async () => {
      const a = await owner();
      expect(JSON.parse((await get(`/v1/orgs/${a.gymId}/plans`, a.cookies)).body)).toMatchObject({ payOnline: "available" });
      expect(JSON.parse((await get(`/v1/orgs/${a.gymId}/plans`, a.cookies, noRazorpay)).body)).toMatchObject({ payOnline: "unavailable" });
      const off = await post(`/v1/orgs/${a.gymId}/billing/checkout`, { planCode: BIG }, a.cookies, { "idempotency-key": "k-off" }, noRazorpay);
      expect(off.statusCode).toBe(503);

      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);
      expect(JSON.parse((await post(`/v1/orgs/${a.gymId}/billing/portal`, {}, a.cookies)).body)).toMatchObject({ error: "paid_through_razorpay" });
      const size = await post(`/v1/orgs/${a.gymId}/billing/size`, { planCode: SMALL }, a.cookies, { "idempotency-key": "k-size" });
      expect(JSON.parse(size.body)).toMatchObject({ error: "paid_through_razorpay" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "nobody but the gym's billing staff can open a window or ask after one",
    async () => {
      const a = await owner();
      const stranger = await makeUser();
      expect([403, 404]).toContain((await checkout(a.gymId, stranger.cookies, BIG)).statusCode);
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      expect([403, 404]).toContain((await sync(a.gymId, win.checkoutId, stranger.cookies)).statusCode);
      expect((await post(`/v1/orgs/${a.gymId}/billing/checkout`, { planCode: 7 }, a.cookies, { "idempotency-key": "k-bad" })).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );
});
