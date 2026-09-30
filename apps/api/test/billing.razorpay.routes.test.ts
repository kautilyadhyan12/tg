// An Indian gym pays through Razorpay (ROADMAP Stage 3 item 1d-i), against real Postgres with
// a fake Razorpay in place of Razorpay's API. DATABASE_URL-gated.
//
// THE WORST THING THIS JOB COULD DO: open a paid plan for a gym that has not paid — a "paid"
// message from the browser or a webhook, believed — or put one gym's payment on another. The
// first test is that. Then: charged exactly our price, never twice, never touching what
// something else on the same Razorpay account made.
import { createHash, createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { processRazorpayEvents } from "../src/modules/billing/events.js";
import { applyRazorpaySubscription } from "../src/modules/billing/service.js";
import { gymSeatCap } from "../src/modules/orgs/repo.js";
import { expireLapsedGymTrials } from "../src/modules/orgs/trialSweep.js";
import { createMemoryRedis } from "../src/redis.js";
import { orgCheckoutResponseSchema } from "@app/shared";
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
  /** Razorpay's clock as each test starts: a test that moves it (a trial's last day, a month
   *  later) would otherwise hand the next test a clock at that test's own trial end, and two
   *  trials begun in the same second end in the same second, so the next one was charged at
   *  once where it should be waiting (seen on CI, PR #138). */
  const startClock = razorpay.clock;
  beforeEach(() => {
    razorpay.clock = startClock;
  });
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
  /** A paid trial's window, as a press before 2f-i made it (1d-i): Razorpay's subscription
   *  starts when the gym's own trial ends, so the mandate is given now and the first payment
   *  taken then. No press makes one now (Kd, RULINGS 2026-09-30), but those already made are
   *  still followed, so this writes the checkout row and the subscription that press made. */
  const trialWindow = async (a: { gymId: string; userId: string }, planCode: string) => {
    const own = (await sql<{ trial_ends_at: Date }[]>`
      SELECT trial_ends_at FROM subscriptions WHERE owner_id = ${a.gymId} AND provider = 'none' AND status = 'trialing'`)[0];
    if (own === undefined) throw new Error("no free trial");
    const row = (await sql<{ id: string }[]>`
      INSERT INTO billing_checkouts (gym_id, plan_id, created_by, idempotency_key, provider, trial_ends_at)
      VALUES (${a.gymId}, (SELECT id FROM plans WHERE code = ${planCode}), ${a.userId}, ${randomBytes(8).toString("hex")}, 'razorpay', ${own.trial_ends_at})
      RETURNING id`)[0];
    if (row === undefined) throw new Error("no checkout row");
    const made = await razorpay.createSubscription({
      planId: planCode === BIG ? BIG_PLAN : SMALL_PLAN,
      startAt: own.trial_ends_at,
      notes: { app: "aihg", gym_id: a.gymId, checkout_id: row.id },
    });
    if (made.kind !== "ok") throw new Error("fake Razorpay made no subscription");
    await sql`UPDATE billing_checkouts SET state = 'open', provider_ref = ${made.value.id} WHERE id = ${row.id}`;
    return { checkoutId: row.id, subscriptionId: made.value.id };
  };
  const opened = (res: { statusCode: number; body: string }) => {
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { checkoutId: string; provider: string; keyId: string; subscriptionId: string; description: string; contact: string | null; email: string | null };
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
    (JSON.parse((await get("/v1/orgs/mine", cookies)).body) as { orgs: { id: string; subscription: Record<string, unknown> | null; paymentOverdue: boolean | null; paymentOverdueThrough: string | null; consoleReadOnly: boolean | null; billingMobile: string | null }[] }).orgs.find(
      (o) => o.id === gymId,
    );

  const patch = (path: string, payload: unknown, cookies: Cookies) =>
    api().inject({ method: "PATCH", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, cookies, payload: JSON.stringify(payload) });
  const createGym = (cookies: Cookies, extra: Record<string, unknown>) =>
    post("/v1/orgs", { name: `Mobile Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata", ...extra }, cookies);
  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer", privileges: string[]) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${privileges})`;
  };

  it(
    "WORST THING: an owner's mobile reaches nobody but their own gym's billing staff — not a manager, a trainer, a member, another gym or the gym's public page",
    async () => {
      const owner1 = await makeUser();
      const created = await createGym(owner1.cookies, { billingMobile: "+91 98765-43210" });
      expect(created.statusCode).toBe(201);
      const gymId = (JSON.parse(created.body) as { org: { id: string; slug: string } }).org.id;
      const slug = (JSON.parse(created.body) as { org: { slug: string } }).org.slug;
      expect(created.body).not.toContain("9876543210");
      expect((await post(`/v1/orgs/${gymId}/trial`, {}, owner1.cookies)).statusCode).toBe(200);
      expect(await myGym(gymId, owner1.cookies)).toMatchObject({ billingMobile: "+919876543210" });

      const manager = await makeUser();
      const trainer = await makeUser();
      const member = await makeUser();
      const stranger = await owner();
      await addStaff(gymId, manager.userId, "manager", ["members.read", "codes.invite", "members.confirm", "org.manage"]);
      await addStaff(gymId, trainer.userId, "trainer", ["members.read", "codes.invite"]);
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${member.userId})`;

      for (const who of [manager, trainer, member, stranger]) {
        const mineRes = await get("/v1/orgs/mine", who.cookies);
        expect(mineRes.statusCode).toBe(200);
        expect(mineRes.body).not.toContain("9876543210");
      }
      expect((await get(`/v1/public/gyms/${slug}`, stranger.cookies)).body).not.toContain("9876543210");
      // A manager may rename the gym but neither sees nor changes where its payment messages go.
      const renamed = await patch(`/v1/orgs/${gymId}`, { name: "Renamed by the manager" }, manager.cookies);
      expect(renamed.statusCode).toBe(200);
      expect(renamed.body).not.toContain("9876543210");
      expect((await patch(`/v1/orgs/${gymId}`, { billingMobile: "70123 45678" }, manager.cookies)).statusCode).toBe(403);
      expect([403, 404]).toContain((await patch(`/v1/orgs/${gymId}`, { billingMobile: "70123 45678" }, stranger.cookies)).statusCode);
      // Nobody but billing staff can open a window, so nobody else is handed it there either.
      expect([403, 404]).toContain((await checkout(gymId, manager.cookies, BIG)).statusCode);
      expect((await sql`SELECT billing_mobile FROM gyms WHERE id = ${gymId}`)[0]).toEqual({ billing_mobile: "+919876543210" });

      // The owner's own window is filled in with it.
      expect(opened(await checkout(gymId, owner1.cookies, BIG))).toMatchObject({ contact: "+919876543210" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the mobile for payments: an Indian mobile or none, only in India, changed or cleared by billing staff in Settings",
    async () => {
      const user = await makeUser();
      expect(JSON.parse((await post("/v1/orgs", { name: `Austin Gym ${String(seq++)}`, country: "US", timezone: "America/Chicago", billingMobile: "9876543210" }, user.cookies)).body)).toMatchObject({ error: "mobile_india_only" });
      for (const bad of ["020 2612 3456", "12345", "+44 7911 123456"]) {
        const res = await createGym(user.cookies, { billingMobile: bad });
        expect([res.statusCode, JSON.parse(res.body)]).toMatchObject([400, { error: "mobile_invalid" }]);
      }
      // None given: allowed, and Razorpay's window asks for it.
      const none = await createGym(user.cookies, {});
      expect(none.statusCode).toBe(201);
      const gymId = (JSON.parse(none.body) as { org: { id: string } }).org.id;
      expect((await post(`/v1/orgs/${gymId}/trial`, {}, user.cookies)).statusCode).toBe(200);
      expect(opened(await checkout(gymId, user.cookies, BIG))).toMatchObject({ contact: null });

      const set = await patch(`/v1/orgs/${gymId}`, { billingMobile: "(+91) 70123 45678" }, user.cookies);
      expect([set.statusCode, JSON.parse(set.body)]).toMatchObject([200, { billingMobile: "+917012345678" }]);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.updated' AND meta->'changed' ? 'billingMobile'`).toHaveLength(1);
      expect(JSON.parse((await patch(`/v1/orgs/${gymId}`, { billingMobile: "5876543210" }, user.cookies)).body)).toMatchObject({ error: "mobile_invalid" });
      const cleared = await patch(`/v1/orgs/${gymId}`, { billingMobile: null }, user.cookies);
      expect(JSON.parse(cleared.body)).toMatchObject({ billingMobile: null });
      expect((await sql`SELECT billing_mobile FROM gyms WHERE id = ${gymId}`)[0]).toEqual({ billing_mobile: null });
    },
    TEST_TIMEOUT_MS,
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
    "a paid trial made before 2f-i: the mandate given, the first payment when the trial ends, the trial's 100 members until then",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const own = (await sql<{ trial_ends_at: Date }[]>`
        SELECT trial_ends_at FROM subscriptions WHERE owner_id = ${a.gymId} AND provider = 'none'`)[0];
      const win = await trialWindow(a, BIG);
      // Razorpay starts the subscription at the gym's own trial end, to the second.
      expect(razorpay.created.at(-1)?.startAt?.getTime()).toBe(own?.trial_ends_at.getTime());
      const startAt = razorpay.subs.get(win.subscriptionId)?.start_at ?? 0;
      expect(startAt).toBe(Math.ceil((own?.trial_ends_at.getTime() ?? 0) / 1000));

      razorpay.authenticate(win.subscriptionId);
      const synced = JSON.parse((await sync(a.gymId, win.checkoutId, a.cookies)).body) as { state: string; subscription?: Record<string, unknown> };
      const trialEnd = new Date(startAt * 1000).toISOString();
      expect(synced).toMatchObject({
        state: "paid",
        subscription: { status: "trialing", subscribed: true, paidThrough: "razorpay", priceLabel: "₹200", seatCap: 100, nextSeatCap: 5000, currentPeriodEnd: trialEnd },
      });
      expect(razorpay.invoices.get(win.subscriptionId) ?? []).toEqual([]);
      expect(await gymSeatCap(sql, a.gymId)).toBe(100);

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
    "WORST THING: a gym that pays in its free trial is charged now at the plan's own price, and gets its full size at once; the trial ends (Razorpay)",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      // No start date: Razorpay charges when the window is paid, never at the trial's end.
      expect(razorpay.created.at(-1)?.startAt ?? null).toBeNull();
      expect(razorpay.subs.get(win.subscriptionId)?.start_at ?? null).toBeNull();
      razorpay.authenticate(win.subscriptionId);
      expect((razorpay.invoices.get(win.subscriptionId) ?? []).map((i) => i.amount_paid)).toEqual([20000]);
      const synced = JSON.parse((await sync(a.gymId, win.checkoutId, a.cookies)).body) as { state: string };
      expect(synced).toMatchObject({ state: "paid", subscription: { status: "active", seatCap: 5000, nextSeatCap: null, paidThrough: "razorpay" } });
      const ownRow = (await sql<{ status: string; cancel_reason: string | null }[]>`
        SELECT status, cancel_reason FROM subscriptions WHERE owner_id = ${a.gymId} AND provider = 'none'`)[0];
      expect(ownRow).toEqual({ status: "expired", cancel_reason: "subscribed" });
      expect(await gymSeatCap(sql, a.gymId)).toBe(5000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trial window not paid before the trial ends is told so, nothing charged",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const win = await trialWindow(a, SMALL);
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

      // The card is changed on the halted plan: Razorpay says `active` but charges nothing
      // (its "Payment Retries" page), so the month is still owed and nothing opens.
      razorpay.changeCard(win.subscriptionId);
      await signedWebhook(win.subscriptionId, "subscription.activated");
      await runWorker(2 * DAY_MS + 10_000);
      expect(await paidRows(a.gymId)).toEqual([{ status: "expired", provider_ref: win.subscriptionId, cancel_reason: "grace_expired" }]);
      expect(await myGym(a.gymId, a.cookies)).toMatchObject({ consoleReadOnly: true, paymentOverdue: true });

      // The owed month is charged: everything opens again.
      razorpay.chargeUnpaid(win.subscriptionId);
      await signedWebhook(win.subscriptionId, "subscription.charged");
      await runWorker(2 * DAY_MS + 20_000);
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
    "WORST THING: a trial paid for through Razorpay is never ended by the nightly trial check, however late its first charge arrives, nor can its country move its money",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const win = await trialWindow(a, BIG);
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);
      const firstCharge = (razorpay.subs.get(win.subscriptionId)?.start_at ?? 0) * 1000;
      // A bank mandate's first debit is confirmed a day or more after the trial's end.
      const swept = await expireLapsedGymTrials({ sql, log: silent }, { now: new Date(firstCharge + DAY_MS), gymIds: [a.gymId] });
      expect(swept.expired).toBe(0);
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["trialing"]);
      expect(await myGym(a.gymId, a.cookies)).toMatchObject({ consoleReadOnly: false });
      expect(JSON.parse((await patch(`/v1/orgs/${a.gymId}`, { country: "US" }, a.cookies)).body)).toMatchObject({ error: "currency_locked" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a Razorpay plan charged while the gym already pays for another is cancelled, and that charge refunded, never an earlier month",
    async () => {
      const a = await owner();
      const first = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(first.subscriptionId);
      await sync(a.gymId, first.checkoutId, a.cookies);
      const honestMonth = razorpay.invoices.get(first.subscriptionId)?.[0]?.payment_id;
      // The first plan's row ends (as the old trial check could end one) after its month was paid.
      await sql`
        UPDATE subscriptions SET status = 'expired', ended_at = to_timestamp(${razorpay.clock + 3600})
        WHERE provider_ref = ${first.subscriptionId}`;
      const second = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(second.subscriptionId);
      expect(JSON.parse((await sync(a.gymId, second.checkoutId, a.cookies)).body)).toMatchObject({ state: "paid" });

      // Razorpay charges the first plan's next month anyway.
      razorpay.clock += 31 * 24 * 3600;
      const late = razorpay.charge(first.subscriptionId);
      await signedWebhook(first.subscriptionId);
      await runWorker();
      expect(razorpay.cancelled).toContain(first.subscriptionId);
      expect(razorpay.refunds).toContain(late);
      expect(razorpay.refunds).not.toContain(honestMonth);
      expect((await paidRows(a.gymId)).map((r) => [r.provider_ref, r.status])).toEqual([
        [first.subscriptionId, "expired"],
        [second.subscriptionId, "active"],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: an out-of-date answer about a gym's only plan never cancels or refunds it",
    async () => {
      const a = await owner();
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);
      const live = razorpay.subs.get(win.subscriptionId);
      if (live === undefined) throw new Error("no subscription");
      // Razorpay hands a later ask an older state ("authenticated") than the one written.
      razorpay.subs.set(win.subscriptionId, { ...live, status: "authenticated" });
      await signedWebhook(win.subscriptionId, "subscription.authenticated");
      await runWorker();
      razorpay.subs.set(win.subscriptionId, live);
      expect(razorpay.cancelled).not.toContain(win.subscriptionId);
      expect(await sql`SELECT 1 FROM billing_refunds WHERE subscription_ref = ${win.subscriptionId}`).toHaveLength(0);
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["active"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a failed payment that Razorpay's own retry takes within the grace keeps the gym open",
    async () => {
      const a = await owner();
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);
      razorpay.fail(win.subscriptionId);
      await signedWebhook(win.subscriptionId, "subscription.pending");
      await runWorker();
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["past_due"]);
      // The retry takes the same month's charge: its invoice is paid, no new one made.
      razorpay.retrySucceeds(win.subscriptionId);
      await signedWebhook(win.subscriptionId, "subscription.charged");
      await runWorker(60_000);
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["active"]);
      expect(await myGym(a.gymId, a.cookies)).toMatchObject({ consoleReadOnly: false, paymentOverdue: false });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an answer asked for earlier never overwrites one asked for later, however slowly it arrives",
    async () => {
      const a = await owner();
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);
      let tick = Date.now() + 5000;
      const deps = { sql, redis: createMemoryRedis(), paddle: null, razorpay: { api: razorpay, keyId: KEY_ID }, log: silent, now: () => new Date((tick += 1000)) };
      razorpay.fail(win.subscriptionId);
      await applyRazorpaySubscription(deps, win.subscriptionId);
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["past_due"]);
      // A worker asks and its answer ("pending") is slow; meanwhile the retry is paid and a
      // second ask writes that. The slow answer lands last and must not undo it.
      razorpay.duringNextGet = async () => {
        razorpay.chargeUnpaid(win.subscriptionId);
        await applyRazorpaySubscription(deps, win.subscriptionId);
      };
      await applyRazorpaySubscription(deps, win.subscriptionId);
      expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["active"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Razorpay event is kept once, however often it is delivered: by Razorpay's id, else by the body itself",
    async () => {
      const a = await owner();
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      const eventId = `evt_${randomBytes(7).toString("hex")}`;
      for (let i = 0; i < 3; i++) expect((await signedWebhook(win.subscriptionId, "subscription.charged", WEBHOOK_SECRET, eventId)).statusCode).toBe(200);
      expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'razorpay' AND event_id = ${eventId}`).toHaveLength(1);

      const raw = JSON.stringify({ entity: "event", event: "subscription.pending", payload: { subscription: { entity: { id: win.subscriptionId } } } });
      const unnamed = () =>
        api().inject({
          method: "POST",
          url: "/v1/webhooks/razorpay",
          remoteAddress: nextIp(),
          headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex") },
          payload: raw,
        });
      expect((await unnamed()).statusCode).toBe(200);
      expect((await unnamed()).statusCode).toBe(200);
      const byBody = `body:${createHash("sha256").update(raw).digest("hex")}`;
      expect(await sql`SELECT 1 FROM webhook_events WHERE provider = 'razorpay' AND event_id = ${byBody}`).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym paying on a Razorpay plan is still followed after its price's Razorpay plan is replaced",
    async () => {
      const a = await owner();
      const win = opened(await checkout(a.gymId, a.cookies, BIG));
      razorpay.authenticate(win.subscriptionId);
      await sync(a.gymId, win.checkoutId, a.cookies);
      const replacement = razorpay.addPlan(25000);
      await sql`UPDATE plans SET razorpay_plan_id = ${replacement} WHERE code = ${BIG}`;
      try {
        razorpay.fail(win.subscriptionId);
        await signedWebhook(win.subscriptionId, "subscription.pending");
        await runWorker();
        expect((await paidRows(a.gymId)).map((r) => r.status)).toEqual(["past_due"]);
      } finally {
        await sql`UPDATE plans SET razorpay_plan_id = ${BIG_PLAN} WHERE code = ${BIG}`;
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Razorpay's window gets the OWNER's email, whoever of the billing staff opens it; and a gym leaving India drops the mobile",
    async () => {
      const owner1 = await makeUser();
      const created = await createGym(owner1.cookies, { billingMobile: "70123 45678" });
      const gymId = (JSON.parse(created.body) as { org: { id: string } }).org.id;
      expect((await post(`/v1/orgs/${gymId}/trial`, {}, owner1.cookies)).statusCode).toBe(200);
      const ownerEmail = (await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${owner1.userId}`)[0]?.email;
      const clerk = await makeUser();
      await addStaff(gymId, clerk.userId, "manager", ["members.read", "billing.manage"]);
      expect(opened(await checkout(gymId, clerk.cookies, BIG))).toMatchObject({ email: ownerEmail, contact: "+917012345678" });

      const leaving = await patch(`/v1/orgs/${gymId}`, { country: "US" }, owner1.cookies);
      expect(leaving.statusCode).toBe(200);
      expect((await sql`SELECT billing_mobile FROM gyms WHERE id = ${gymId}`)[0]).toEqual({ billing_mobile: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an owner's stored email the console can't read back is left out, and Razorpay's window asks for it; the reply still reads",
    async () => {
      const odd = await owner();
      // A dot before the @, as a migrated or Google account may hold.
      await sql`UPDATE users SET email = ${`billing-rzp-odd-${String(seq++)}.@example.com`} WHERE id = ${odd.userId}`;
      const res = await checkout(odd.gymId, odd.cookies, BIG);
      expect(res.statusCode).toBe(200);
      const reply: unknown = JSON.parse(res.body);
      expect(reply).toMatchObject({ provider: "razorpay", email: null });
      expect(orgCheckoutResponseSchema.safeParse(reply).success).toBe(true);
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
