// A gym pays through Paddle (ROADMAP Stage 3 items 1a, 1c-i and 1c-ii), against real Postgres with a
// fake Paddle in place of Paddle's API. DATABASE_URL-gated.
//
// THE WORST THING THIS JOB COULD DO: charge an owner twice for one gym, or let their
// payment switch on a different gym. The first three tests are those. Managing a paid
// plan (1c-i: Paddle's own page, the 2-day grace) and a bigger size (1c-ii) are at the
// end, with their own.
import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { processPaddleEvents } from "../src/modules/billing/events.js";
import { gymSeatCap } from "../src/modules/orgs/repo.js";
import { expireLapsedGymTrials } from "../src/modules/orgs/trialSweep.js";
import { FakePaddle, paddleId } from "./fakePaddle.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const WEBHOOK_SECRET = ["pdl", "ntfset", "01" + "c".repeat(24), "TestSecretForBillingRoutes"].join("_");
/** Fakes in Paddle's shapes, built at run time so no key-shaped text is in the repository. */
const fakePaddleKey = (env: "sdbx" | "live") => ["pdl", env, "apikey", "01" + "a".repeat(24), "AbCdEfGhIjKlMnOpQrStUv", "Xyz"].join("_");
const CLIENT_TOKEN = ["test", "0".repeat(27)].join("_");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "billing-test-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  PADDLE_ENV: "sandbox",
  PADDLE_API_KEY: fakePaddleKey("sdbx"),
  PADDLE_CLIENT_TOKEN: CLIENT_TOKEN,
  PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;


const SMALL = "zz_billing_small"; // up to 1 member, $10
const MID = "zz_billing_mid"; // up to 50 members, $15
const BIG = "zz_billing_big"; // up to 5,000 members, $20
const SMALL_PRICE = paddleId("pri");
const MID_PRICE = paddleId("pri");
const BIG_PRICE = paddleId("pri");
const PRICES: Record<string, { amount: string; currency: string }> = {
  [SMALL_PRICE]: { amount: "1000", currency: "USD" },
  [MID_PRICE]: { amount: "1500", currency: "USD" },
  [BIG_PRICE]: { amount: "2000", currency: "USD" },
};

d("a gym pays through Paddle (real Postgres, fake Paddle)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const paddle = new FakePaddle(PRICES);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  /** One run of the worker's job; `aheadMs` runs it that far in the future, past a wait.
   *  At least a second: an event's `not_before` is Postgres's microsecond clock and this
   *  one counts milliseconds, so a run in the same millisecond as the webhook (CI is that
   *  fast) reads the event as not yet due. The real worker runs a minute apart. */
  const runWorker = (aheadMs = 1000) =>
    processPaddleEvents({
      sql,
      redis: createMemoryRedis(),
      paddle: { api: paddle, environment: "sandbox", clientToken: CLIENT_TOKEN },
      log: silent,
      now: () => new Date(Date.now() + aheadMs),
    });

  let ip = 0;
  const nextIp = () => `10.41.${String(Math.floor(ip / 250))}.${String((ip++ % 250) + 1)}`;
  type Cookies = Record<string, string>;

  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'billing-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM webhook_events WHERE provider = 'paddle'`;
    await sql`DELETE FROM billing_refunds WHERE provider = 'paddle'`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_plan_changes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'billing-t-%@example.com'`;
  };

  beforeAll(async () => {
    await cleanup();
    for (const [code, cap, price, priceId] of [
      [SMALL, 1, 1000, SMALL_PRICE],
      [MID, 50, 1500, MID_PRICE],
      [BIG, 5000, 2000, BIG_PRICE],
    ] as const) {
      // trial_days 0: the trial is on the smallest plan WITH a trial, and these must not be it.
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap,
                           trial_days, rank, entitlements, member_entitlements, paddle_price_id)
        VALUES (${code}, 'org', ${"plan." + code}, ${price}, 'USD', 'month', ${cap}, 0, 10,
                '{}'::jsonb, '{}'::jsonb, ${priceId})
        ON CONFLICT (code) DO UPDATE SET active = true, price_minor = ${price}, seat_cap = ${cap},
                                         paddle_price_id = ${priceId}`;
    }
    app = await buildApp(loadConfig(baseEnv), { paddleApi: paddle });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM plans WHERE code IN (${SMALL}, ${MID}, ${BIG})`;
    await app?.close();
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
  const get = (path: string, cookies: Cookies) => api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  let seq = 0;
  const makeUser = async (): Promise<{ userId: string; cookies: Cookies }> => {
    const email = `billing-t-${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Billing" });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return {
      userId: (JSON.parse(reg.body) as { userId: string }).userId,
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
    };
  };
  const makeGym = async (cookies: Cookies, country = "US"): Promise<string> => {
    const res = await post("/v1/orgs", { name: `Billing Gym ${String(seq++)}`, city: "Austin", country, timezone: "America/Chicago" }, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { org: { id: string } }).org.id;
  };
  const owner = async (country = "US") => {
    const user = await makeUser();
    return { ...user, gymId: await makeGym(user.cookies, country) };
  };
  const checkout = (gymId: string, cookies: Cookies, planCode: string, key: string = randomBytes(8).toString("hex")) =>
    post(`/v1/orgs/${gymId}/billing/checkout`, { planCode }, cookies, { "idempotency-key": key });
  const opened = (res: { statusCode: number; body: string }) => {
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as { checkoutId: string; transactionId: string; clientToken: string; environment: string };
  };
  const signedWebhook = (body: object, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(body);
    const h1 = createHmac("sha256", secret).update(`${String(ts)}:${raw}`).digest("hex");
    return api().inject({
      method: "POST",
      url: "/v1/webhooks/paddle",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "paddle-signature": `ts=${String(ts)};h1=${h1}` },
      payload: raw,
    });
  };
  const subscriptionEvent = (subId: string, type = "subscription.created", extra: object = {}) => ({
    event_id: paddleId("evt"),
    event_type: type,
    occurred_at: new Date().toISOString(),
    data: { id: subId, ...extra },
  });
  const paidRows = (gymId: string) =>
    sql<{ status: string; provider_ref: string; cancel_reason: string | null; ended_at: Date | null }[]>`
      SELECT status, provider_ref, cancel_reason, ended_at FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'paddle' ORDER BY created_at`;

  it(
    "WORST THING: gym A's payment switches on gym A and never gym B, whatever the payment says",
    async () => {
      const a = await owner();
      const b = await owner();
      // B has a checkout of its own, made first, so "the first checkout" is B's.
      opened(await checkout(b.gymId, b.cookies, BIG));
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      // Paddle carries what we sent, and the webhook body below lies about the gym:
      // neither is read to place the plan.
      expect(paddle.customData.get(txn.transactionId)).toEqual({ gym_id: a.gymId, checkout_id: txn.checkoutId });
      const subId = paddle.pay(txn.transactionId);
      expect((await signedWebhook(subscriptionEvent(subId, "subscription.created", { custom_data: { gym_id: b.gymId } }))).statusCode).toBe(200);
      await runWorker();

      expect((await paidRows(a.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", subId]]);
      expect(await paidRows(b.gymId)).toEqual([]);
      // B's owner cannot ask after A's checkout, under either gym.
      expect((await post(`/v1/orgs/${b.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, b.cookies)).statusCode).toBe(404);
      expect((await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, b.cookies)).statusCode).toBe(404);
      // A's console shows the plan, its price and its month.
      const mineRes = await get("/v1/orgs/mine", a.cookies);
      const gym = (JSON.parse(mineRes.body) as { orgs: { id: string; subscription: Record<string, unknown> | null; consoleReadOnly: boolean | null }[] }).orgs.find(
        (o) => o.id === a.gymId,
      );
      expect(gym?.subscription).toMatchObject({ status: "active", priceLabel: "$20", currentPeriodEnd: "2026-11-01T00:00:00.000Z", cancelAtPeriodEnd: false, seatCap: 5000 });
      expect(gym?.consoleReadOnly).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a subscription no checkout of ours made gives nobody a plan, and is cancelled and refunded",
    async () => {
      const a = await owner();
      // Somebody pays a Paddle transaction our server never made (as Paddle.js with our
      // public token could), naming gym A.
      const stray = (await paddle.createTransaction({ priceId: BIG_PRICE, customData: { gym_id: a.gymId } }));
      if (stray.kind !== "ok") throw new Error("fake Paddle refused");
      const subId = paddle.pay(stray.value.id, "web");
      await signedWebhook(subscriptionEvent(subId));
      await runWorker();
      expect(await paidRows(a.gymId)).toEqual([]);
      expect(await sql`SELECT 1 FROM subscriptions WHERE provider_ref = ${subId}`).toHaveLength(0);
      expect(paddle.cancelledSubs).toContain(subId);
      expect(paddle.refunds).toContain(stray.value.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a gym is never charged twice — a second Subscribe is refused, and a second paid plan is cancelled and refunded",
    async () => {
      const a = await owner();
      const first = opened(await checkout(a.gymId, a.cookies, BIG));
      const second = opened(await checkout(a.gymId, a.cookies, BIG));
      // Starting the second cancelled the first at Paddle.
      expect(paddle.cancelledTxns).toContain(first.transactionId);
      const liveSub = paddle.pay(second.transactionId);
      const synced = await post(`/v1/orgs/${a.gymId}/billing/checkouts/${second.checkoutId}/sync`, {}, a.cookies);
      expect(synced.statusCode).toBe(200);
      expect(JSON.parse(synced.body)).toMatchObject({ state: "paid", subscription: { status: "active" } });
      const third = await checkout(a.gymId, a.cookies, BIG);
      expect(third.statusCode).toBe(409);
      expect(JSON.parse(third.body)).toMatchObject({ error: "already_subscribed" });

      // The first window was paid anyway, in the instant before Paddle cancelled it.
      const extraSub = paddle.pay(first.transactionId);
      await signedWebhook(subscriptionEvent(extraSub));
      await runWorker();
      const rows = await paidRows(a.gymId);
      expect(rows.map((r) => [r.provider_ref, r.status, r.cancel_reason])).toEqual([
        [liveSub, "active", null],
        [extraSub, "expired", "duplicate"],
      ]);
      expect(paddle.cancelledSubs).toContain(extraSub);
      expect(paddle.refunds).toContain(first.transactionId);
      expect(paddle.refunds).not.toContain(second.transactionId);
      // Running it again asks Paddle nothing more.
      const refundsBefore = paddle.refunds.length;
      await signedWebhook(subscriptionEvent(extraSub, "subscription.canceled"));
      await runWorker();
      expect(paddle.refunds).toHaveLength(refundsBefore);
    },
    TEST_TIMEOUT_MS,
  );

  const refundRow = async (transactionRef: string) =>
    (await sql<{ state: string; reason: string }[]>`
      SELECT state, reason FROM billing_refunds WHERE provider = 'paddle' AND transaction_ref = ${transactionRef}`)[0] ?? null;
  const refundsOf = (transactionRef: string) => paddle.refunds.filter((id) => id === transactionRef).length;

  /** A gym on a paid plan (the second of two windows) and the first window paid anyway. */
  const payTwice = async (completeExtra: boolean) => {
    const a = await owner();
    const first = opened(await checkout(a.gymId, a.cookies, BIG));
    const second = opened(await checkout(a.gymId, a.cookies, BIG));
    paddle.pay(second.transactionId);
    await post(`/v1/orgs/${a.gymId}/billing/checkouts/${second.checkoutId}/sync`, {}, a.cookies);
    const extraSub = paddle.pay(first.transactionId, "api", completeExtra);
    await signedWebhook(subscriptionEvent(extraSub));
    return { a, extraTxn: first.transactionId, extraSub };
  };

  it(
    "WORST THING: a second payment still finishing at Paddle is refunded once it finishes, and once only",
    async () => {
      const { a, extraTxn, extraSub } = await payTwice(false);
      await runWorker();
      expect(paddle.cancelledSubs).toContain(extraSub);
      expect(refundsOf(extraTxn)).toBe(0);
      expect(await refundRow(extraTxn)).toEqual({ state: "owed", reason: "duplicate" });

      paddle.complete(extraTxn);
      await runWorker(2 * 60_000);
      expect(refundsOf(extraTxn)).toBe(1);
      expect((await refundRow(extraTxn))?.state).toBe("requested");
      await runWorker(20 * 60_000);
      expect(refundsOf(extraTxn)).toBe(1);
      expect((await paidRows(a.gymId)).filter((r) => r.status === "active")).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a refund Paddle fails to make is tried again until it is",
    async () => {
      const { extraTxn } = await payTwice(true);
      paddle.refundFailures = 1;
      await runWorker();
      expect(refundsOf(extraTxn)).toBe(0);
      expect((await refundRow(extraTxn))?.state).toBe("owed");
      await runWorker(2 * 60_000);
      expect(refundsOf(extraTxn)).toBe(1);
      expect((await refundRow(extraTxn))?.state).toBe("requested");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a refund whose answer was lost is never asked for twice",
    async () => {
      const { extraTxn } = await payTwice(true);
      paddle.loseRefundAnswer = true;
      await runWorker();
      expect(refundsOf(extraTxn)).toBe(1);
      expect((await refundRow(extraTxn))?.state).toBe("owed");
      await runWorker(2 * 60_000);
      expect(refundsOf(extraTxn)).toBe(1);
      expect((await refundRow(extraTxn))?.state).toBe("requested");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a subscription no checkout of ours made is refunded even when Paddle has already cancelled it",
    async () => {
      const stray = await paddle.createTransaction({ priceId: BIG_PRICE, customData: {} });
      if (stray.kind !== "ok") throw new Error("fake Paddle refused");
      const subId = paddle.pay(stray.value.id, "web");
      paddle.update(subId, { status: "canceled", canceled_at: paddle.tick() });
      await signedWebhook(subscriptionEvent(subId, "subscription.canceled"));
      await runWorker();
      expect(refundsOf(stray.value.id)).toBe(1);
      expect(await refundRow(stray.value.id)).toEqual({ state: "requested", reason: "unmatched" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a payment made but not yet on the gym stops a second Subscribe, and puts the plan on the gym",
    async () => {
      const a = await owner();
      const first = opened(await checkout(a.gymId, a.cookies, BIG));
      // Paid, and the tab closed before the console confirmed it: no sync, no webhook yet.
      const subId = paddle.pay(first.transactionId);
      const before = paddle.created;
      const again = await checkout(a.gymId, a.cookies, BIG);
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.body)).toMatchObject({ error: "already_subscribed" });
      expect(paddle.created).toBe(before);
      expect((await paidRows(a.gymId)).map((r) => [r.provider_ref, r.status])).toEqual([[subId, "active"]]);

      // Paid a moment ago, and Paddle has not made the subscription yet.
      const b = await owner();
      const pending = opened(await checkout(b.gymId, b.cookies, BIG));
      const txn = paddle.txns.get(pending.transactionId);
      if (txn === undefined) throw new Error("no transaction");
      paddle.txns.set(pending.transactionId, { ...txn, status: "paid" });
      const wait = await checkout(b.gymId, b.cookies, BIG);
      expect(wait.statusCode).toBe(409);
      expect(JSON.parse(wait.body)).toMatchObject({ error: "payment_in_progress" });
      expect(paddle.cancelledTxns).not.toContain(pending.transactionId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff without the billing tick may neither pay nor ask after a payment; a press still opening says so",
    async () => {
      const a = await owner();
      const desk = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${a.gymId}, ${desk.userId}, 'manager', ARRAY['members.read'])`;
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      expect((await checkout(a.gymId, desk.cookies, BIG)).statusCode).toBe(403);
      expect((await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, desk.cookies)).statusCode).toBe(403);

      await sql`
        INSERT INTO billing_checkouts (gym_id, plan_id, idempotency_key, provider)
        SELECT ${a.gymId}, id, 'still-opening', 'paddle' FROM plans WHERE code = ${BIG}`;
      const replay = await checkout(a.gymId, a.cookies, BIG, "still-opening");
      expect(replay.statusCode).toBe(409);
      expect(JSON.parse(replay.body)).toMatchObject({ error: "checkout_in_progress" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym's payment is never cancelled because Paddle would not list its transactions",
    async () => {
      const a = await owner();
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      const subId = paddle.pay(txn.transactionId);
      await signedWebhook(subscriptionEvent(subId));
      paddle.listRefused = true;
      try {
        const run = await runWorker();
        expect(run.deferred).toBe(1);
      } finally {
        paddle.listRefused = false;
      }
      expect(paddle.cancelledSubs).not.toContain(subId);
      await runWorker(2 * 60_000);
      expect((await paidRows(a.gymId)).map((r) => [r.provider_ref, r.status])).toEqual([[subId, "active"]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two Subscribe presses at the same instant leave one window open",
    async () => {
      const a = await owner();
      const [x, y] = await Promise.all([checkout(a.gymId, a.cookies, BIG), checkout(a.gymId, a.cookies, BIG)]);
      // One opens; the other either opened first and was replaced, or is told so. Never a 500.
      const answers = [x, y].map((r) => (r.statusCode === 200 ? "open" : `${String(r.statusCode)} ${(JSON.parse(r.body) as { error: string }).error}`));
      expect(answers).toContain("open");
      for (const answer of answers) expect(["open", "409 checkout_replaced"]).toContain(answer);
      const open = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM billing_checkouts WHERE gym_id = ${a.gymId} AND state = 'open'`;
      expect(open[0]?.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a forged, stale or repeated Paddle message changes nothing",
    async () => {
      const a = await owner();
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      const subId = paddle.pay(txn.transactionId);
      const event = subscriptionEvent(subId);
      const kept = () => sql`SELECT 1 FROM webhook_events WHERE provider = 'paddle' AND event_id = ${event.event_id}`;

      expect((await signedWebhook(event, ["pdl", "ntfset", "01" + "d".repeat(24), "NotOurSecret"].join("_"))).statusCode).toBe(401);
      expect((await signedWebhook(event, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 60)).statusCode).toBe(401);
      const unsigned = await api().inject({ method: "POST", url: "/v1/webhooks/paddle", remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(event) });
      expect(unsigned.statusCode).toBe(401);
      expect(await kept()).toHaveLength(0);

      expect((await signedWebhook(event)).statusCode).toBe(200);
      expect((await signedWebhook(event)).statusCode).toBe(200);
      expect(await kept()).toHaveLength(1);
      await runWorker();
      await signedWebhook(subscriptionEvent(subId, "subscription.updated"));
      await runWorker();
      expect(await paidRows(a.gymId)).toHaveLength(1);
      const activations = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${a.gymId} AND action = 'billing.activated'`;
      expect(activations).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a payment that fails keeps the plan; Paddle ending it closes the console",
    async () => {
      const a = await owner();
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      const subId = paddle.pay(txn.transactionId);
      await signedWebhook(subscriptionEvent(subId));
      await runWorker();

      paddle.update(subId, { status: "past_due" });
      await signedWebhook(subscriptionEvent(subId, "subscription.past_due"));
      await runWorker();
      expect((await paidRows(a.gymId))[0]?.status).toBe("past_due");

      // An older record arriving late is not written over the newer one.
      const older = paddle.subs.get(subId);
      if (older === undefined) throw new Error("no subscription");
      paddle.update(subId, { status: "canceled", canceled_at: paddle.tick() });
      await signedWebhook(subscriptionEvent(subId, "subscription.canceled"));
      await runWorker();
      const ended = (await paidRows(a.gymId))[0];
      expect(ended?.status).toBe("expired");
      expect(ended?.ended_at).not.toBeNull();
      paddle.subs.set(subId, { ...older, status: "active" });
      await signedWebhook(subscriptionEvent(subId, "subscription.updated"));
      await runWorker();
      expect((await paidRows(a.gymId))[0]?.status).toBe("expired");

      const mineRes = await get("/v1/orgs/mine", a.cookies);
      const gym = (JSON.parse(mineRes.body) as { orgs: { id: string; consoleReadOnly: boolean | null }[] }).orgs.find((o) => o.id === a.gymId);
      expect(gym?.consoleReadOnly).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same Idempotency-Key opens the same window; for another plan it is refused",
    async () => {
      const a = await owner();
      const before = paddle.created;
      const one = opened(await checkout(a.gymId, a.cookies, BIG, "key-1"));
      const again = opened(await checkout(a.gymId, a.cookies, BIG, "key-1"));
      expect(again.transactionId).toBe(one.transactionId);
      expect(paddle.created).toBe(before + 1);
      const other = await checkout(a.gymId, a.cookies, SMALL, "key-1");
      expect(other.statusCode).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refusals: a stranger, no key, an unknown plan, a rupee gym, too many members, a wrong price, Paddle down",
    async () => {
      const a = await owner();
      const stranger = await makeUser();
      expect((await checkout(a.gymId, stranger.cookies, BIG)).statusCode).toBe(404);
      expect((await post(`/v1/orgs/${a.gymId}/billing/checkout`, { planCode: BIG }, a.cookies)).statusCode).toBe(400);
      expect((await checkout(a.gymId, a.cookies, "org_nope")).statusCode).toBe(404);
      expect((await checkout(a.gymId, a.cookies, "org_b1_in_m")).statusCode).toBe(404);

      const india = await owner("IN");
      const rupees = await checkout(india.gymId, india.cookies, "org_b1_in_m");
      expect(rupees.statusCode).toBe(409);
      expect(JSON.parse(rupees.body)).toMatchObject({ error: "pay_online_soon" });

      const full = await owner();
      for (const person of [await makeUser(), await makeUser()]) {
        await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${full.gymId}, ${person.userId})`;
      }
      const small = await checkout(full.gymId, full.cookies, SMALL);
      expect(small.statusCode).toBe(409);
      expect(JSON.parse(small.body)).toMatchObject({ error: "plan_too_small" });
      const plans = JSON.parse((await get(`/v1/orgs/${full.gymId}/plans`, full.cookies)).body) as { plans: { code: string; fits: boolean }[]; payOnline: string };
      expect(plans.payOnline).toBe("available");
      expect(plans.plans.find((p) => p.code === SMALL)?.fits).toBe(false);
      expect(plans.plans.find((p) => p.code === BIG)?.fits).toBe(true);
      const indianPlans = JSON.parse((await get(`/v1/orgs/${india.gymId}/plans`, india.cookies)).body) as { payOnline: string };
      expect(indianPlans.payOnline).toBe("coming_soon");

      paddle.wrongAmount = true;
      const wrong = await checkout(a.gymId, a.cookies, BIG);
      expect(wrong.statusCode).toBe(503);
      const lastTxn = [...paddle.txns.keys()].at(-1);
      expect(paddle.cancelledTxns).toContain(lastTxn);

      paddle.down = true;
      try {
        expect((await checkout(a.gymId, a.cookies, BIG)).statusCode).toBe(503);
      } finally {
        paddle.down = false;
      }
      const failed = await sql<{ state: string }[]>`SELECT state FROM billing_checkouts WHERE gym_id = ${a.gymId} ORDER BY created_at`;
      expect(failed.map((r) => r.state)).toEqual(["failed", "failed"]);
    },
    TEST_TIMEOUT_MS,
  );

  // ── Managing a paid plan (ROADMAP Stage 3 item 1c-i) ────────────────────────
  //
  // THE WORST THING THIS HALF COULD DO: open one gym's Paddle page — its card, its
  // invoices, its Cancel — for somebody who is not that gym's billing staff.

  const GRACE_MS = 2 * 24 * 60 * 60 * 1000; // Kd, RULINGS 2026-09-24
  const openPortal = (gymId: string, cookies: Cookies) => post(`/v1/orgs/${gymId}/billing/portal`, {}, cookies);
  /** A gym on a paid plan: its owner, the Paddle subscription and its customer. */
  const paying = async () => {
    const a = await owner();
    const txn = opened(await checkout(a.gymId, a.cookies, BIG));
    const subId = paddle.pay(txn.transactionId);
    await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies);
    const customerId = paddle.subs.get(subId)?.customer_id ?? null;
    if (customerId === null) throw new Error("fake Paddle made no customer");
    return { ...a, subId, customerId };
  };
  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer", privileges: string[]) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${privileges})`;
  };
  const myGym = async (gymId: string, cookies: Cookies) => {
    const res = await get("/v1/orgs/mine", cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { orgs: { id: string; subscription: Record<string, unknown> | null; consoleReadOnly: boolean | null; paymentOverdue: boolean | null }[] }).orgs.find(
      (o) => o.id === gymId,
    );
  };
  /** Paddle says the plan changed, and the worker writes it, as a webhook would have it. */
  const paddleSays = async (subId: string, patch: Parameters<FakePaddle["update"]>[1], aheadMs = 1000) => {
    paddle.update(subId, patch);
    expect((await signedWebhook(subscriptionEvent(subId, "subscription.updated"))).statusCode).toBe(200);
    return await runWorker(aheadMs);
  };
  const graceRow = async (subId: string) =>
    (await sql<{ status: string; cancel_reason: string | null; past_due_since: Date | null; ended_at: Date | null }[]>`
      SELECT status, cancel_reason, past_due_since, ended_at FROM subscriptions WHERE provider_ref = ${subId}`)[0];

  it(
    "WORST THING: only this gym's billing staff open its Paddle page — a stranger, a member, a trainer and a manager without the tick are refused and Paddle is never asked",
    async () => {
      const a = await paying();
      const b = await paying();
      const trainer = await makeUser();
      const manager = await makeUser();
      const billingManager = await makeUser();
      const member = await makeUser();
      await addStaff(a.gymId, trainer.userId, "trainer", ["members.read", "codes.invite", "attendance.read"]);
      await addStaff(a.gymId, manager.userId, "manager", ["members.read", "codes.invite", "codes.manage", "members.confirm", "members.remove", "attendance.read", "schedule.manage"]);
      await addStaff(a.gymId, billingManager.userId, "manager", ["members.read", "billing.manage"]);
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${a.gymId}, ${member.userId})`;

      const asked = paddle.portalCalls.length;
      // Gym B's owner, under A's id: indistinguishable from a gym that does not exist.
      expect((await openPortal(a.gymId, b.cookies)).statusCode).toBe(404);
      expect((await openPortal(a.gymId, member.cookies)).statusCode).toBe(404);
      expect((await openPortal(a.gymId, trainer.cookies)).statusCode).toBe(403);
      expect((await openPortal(a.gymId, manager.cookies)).statusCode).toBe(403);
      expect(paddle.portalCalls.length).toBe(asked);

      // A's owner, and a manager given the billing tick, get A's customer and A's plan only.
      for (const who of [a.cookies, billingManager.cookies]) {
        const res = await openPortal(a.gymId, who);
        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(paddle.portalCalls.at(-1)).toEqual({ customerId: a.customerId, subscriptionIds: [a.subId] });
        expect((JSON.parse(res.body) as { url: string }).url).toMatch(/^https:\/\/sandbox-customer-portal\.paddle\.com\/.*action=overview/);
      }
      // B's owner on B gets B's, never A's.
      expect((await openPortal(b.gymId, b.cookies)).statusCode).toBe(200);
      expect(paddle.portalCalls.at(-1)).toEqual({ customerId: b.customerId, subscriptionIds: [b.subId] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: one Paddle account paying for two gyms opens only for somebody who manages the billing of both",
    async () => {
      // Paddle keeps one customer per email and reuses it at checkout, and its page shows
      // everything that customer pays for: here gym B was paid for with gym A's email.
      const a = await paying();
      const b = await paying();
      await sql`UPDATE subscriptions SET provider_customer_ref = ${a.customerId} WHERE provider_ref = ${b.subId}`;
      const bookkeeper = await makeUser();
      await addStaff(a.gymId, bookkeeper.userId, "manager", ["members.read", "billing.manage"]);

      const asked = paddle.portalCalls.length;
      for (const who of [bookkeeper.cookies, a.cookies]) {
        const refused = await openPortal(a.gymId, who);
        expect(refused.statusCode).toBe(409);
        expect(JSON.parse(refused.body)).toMatchObject({ error: "shared_payer" });
      }
      expect(paddle.portalCalls.length).toBe(asked);

      // A's owner given B's billing too manages everything on that page: it opens.
      await addStaff(b.gymId, a.userId, "manager", ["members.read", "billing.manage"]);
      expect((await openPortal(a.gymId, a.cookies)).statusCode).toBe(200);
      expect(paddle.portalCalls.at(-1)).toEqual({ customerId: a.customerId, subscriptionIds: [a.subId] });
      expect((await openPortal(a.gymId, bookkeeper.cookies)).statusCode).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym on no paid plan has no Paddle page to open, and a Paddle answer for another customer is never passed on",
    async () => {
      const trialling = await owner();
      expect((await post(`/v1/orgs/${trialling.gymId}/trial`, {}, trialling.cookies)).statusCode).toBeLessThan(300);
      const asked = paddle.portalCalls.length;
      const none = await openPortal(trialling.gymId, trialling.cookies);
      expect(none.statusCode).toBe(404);
      expect(JSON.parse(none.body)).toMatchObject({ error: "no_paid_plan" });
      expect(paddle.portalCalls.length).toBe(asked);

      const a = await paying();
      paddle.portalWrongCustomer = true;
      const wrong = await openPortal(a.gymId, a.cookies);
      expect(wrong.statusCode).toBe(503);
      expect(wrong.body).not.toContain("paddle.com");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a cancel made on Paddle's page keeps the plan to the end of its month and says when it ends",
    async () => {
      const a = await paying();
      await paddleSays(a.subId, { scheduled_change: { action: "cancel", effective_at: "2026-11-01T00:00:00Z" } });
      expect((await myGym(a.gymId, a.cookies))?.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-11-01T00:00:00.000Z" });
      await paddleSays(a.subId, { status: "canceled", scheduled_change: null, canceled_at: paddle.tick() });
      const gym = await myGym(a.gymId, a.cookies);
      expect(gym?.subscription).toBeNull();
      expect(gym?.consoleReadOnly).toBe(true);
      // Ended by the gym's own choice: nothing is overdue, so Subscribe is open again.
      expect(gym?.paymentOverdue).toBe(false);
      expect((await checkout(a.gymId, a.cookies, BIG)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a failed payment: members keep everything for 2 days, then the console goes read-only until it is paid, and the payment brings it all back",
    async () => {
      const a = await paying();
      await paddleSays(a.subId, { status: "past_due" });
      const failed = await graceRow(a.subId);
      expect(failed?.status).toBe("past_due");
      expect(failed?.past_due_since).not.toBeNull();
      let gym = await myGym(a.gymId, a.cookies);
      expect(gym).toMatchObject({ consoleReadOnly: false, paymentOverdue: false, subscription: { status: "past_due" } });
      // The page opens straight on the card, where Paddle shows what is owed.
      const onCard = await openPortal(a.gymId, a.cookies);
      expect((JSON.parse(onCard.body) as { url: string }).url).toContain("action=update_subscription_payment_method");

      // Paddle retries and fails again a day later: the grace does not start over.
      await paddleSays(a.subId, { current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-02T00:00:00Z" } }, 24 * 60 * 60 * 1000);
      expect((await graceRow(a.subId))?.past_due_since).toEqual(failed?.past_due_since);

      // A minute short of 2 days: still in grace.
      await runWorker(GRACE_MS - 60_000);
      expect((await graceRow(a.subId))?.status).toBe("past_due");
      // Past 2 days: the plan stops, the console is read-only, and the gym is told why.
      const run = await runWorker(GRACE_MS + 5000);
      expect(run.gracesEnded).toBe(1);
      expect(await graceRow(a.subId)).toMatchObject({ status: "expired", cancel_reason: "grace_expired" });
      gym = await myGym(a.gymId, a.cookies);
      expect(gym).toMatchObject({ subscription: null, consoleReadOnly: true, paymentOverdue: true });
      // Twice changes nothing.
      expect((await runWorker(GRACE_MS + 10_000)).gracesEnded).toBe(0);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${a.gymId} AND action = 'billing.grace_ended'`).toHaveLength(1);

      // The fix is the card, never a second plan.
      const second = await checkout(a.gymId, a.cookies, BIG);
      expect(second.statusCode).toBe(409);
      expect(JSON.parse(second.body)).toMatchObject({ error: "payment_overdue" });
      expect((JSON.parse((await openPortal(a.gymId, a.cookies)).body) as { url: string }).url).toContain("action=update_subscription_payment_method");
      // Paddle still retrying, still unpaid: nothing opens.
      await paddleSays(a.subId, { status: "past_due" }, GRACE_MS + 20_000);
      expect((await graceRow(a.subId))?.status).toBe("expired");

      // The new card pays it: everything is back at once.
      await paddleSays(a.subId, { status: "active" }, GRACE_MS + 30_000);
      expect(await graceRow(a.subId)).toMatchObject({ status: "active", cancel_reason: null, past_due_since: null, ended_at: null });
      gym = await myGym(a.gymId, a.cookies);
      expect(gym).toMatchObject({ consoleReadOnly: false, paymentOverdue: false, subscription: { status: "active" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a payment Paddle collects inside the grace keeps the plan, and an unpaid plan Paddle ends lets the gym subscribe afresh",
    async () => {
      const a = await paying();
      await paddleSays(a.subId, { status: "past_due" });
      await paddleSays(a.subId, { status: "active" }, 24 * 60 * 60 * 1000);
      await runWorker(GRACE_MS + 5000);
      expect(await graceRow(a.subId)).toMatchObject({ status: "active", past_due_since: null });

      const b = await paying();
      await paddleSays(b.subId, { status: "past_due" });
      await runWorker(GRACE_MS + 5000);
      expect((await myGym(b.gymId, b.cookies))?.paymentOverdue).toBe(true);
      // Paddle's own retries run out and it cancels: nothing more can be collected.
      await paddleSays(b.subId, { status: "canceled", canceled_at: paddle.tick() }, GRACE_MS + 60_000);
      expect(await graceRow(b.subId)).toMatchObject({ status: "expired", cancel_reason: null });
      expect((await myGym(b.gymId, b.cookies))?.paymentOverdue).toBe(false);
      expect((await openPortal(b.gymId, b.cookies)).statusCode).toBe(404);
      expect((await checkout(b.gymId, b.cookies, BIG)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // ── A bigger size, and paying during the trial (ROADMAP Stage 3 item 1c-ii) ───
  //
  // THE WORST THING THIS HALF COULD DO: charge a gym owner twice for one press, or for a
  // size nobody at that gym chose.

  const DAY_MS = 24 * 60 * 60 * 1000;
  const sizePreview = (gymId: string, cookies: Cookies, planCode: string) => post(`/v1/orgs/${gymId}/billing/size/preview`, { planCode }, cookies);
  const sizeChange = (gymId: string, cookies: Cookies, planCode: string, key: string = randomBytes(8).toString("hex")) =>
    post(`/v1/orgs/${gymId}/billing/size`, { planCode }, cookies, { "idempotency-key": key });
  /** A gym paying for one plan through Paddle. */
  const payingOn = async (planCode: string) => {
    const a = await owner();
    const txn = opened(await checkout(a.gymId, a.cookies, planCode));
    const subId = paddle.pay(txn.transactionId);
    expect((await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies)).statusCode).toBe(200);
    return { ...a, subId };
  };
  /** A gym in its own free trial that pays during it: Paddle saves the card, charges nothing. */
  const payingInTrial = async (planCode: string) => {
    const a = await owner();
    expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
    const txn = opened(await checkout(a.gymId, a.cookies, planCode));
    const subId = paddle.pay(txn.transactionId);
    const synced = await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies);
    expect(synced.statusCode).toBe(200);
    return { ...a, subId, txn, synced: JSON.parse(synced.body) as { state: string; subscription?: Record<string, unknown> } };
  };
  const planOf = async (subId: string) =>
    (await sql<{ code: string; status: string }[]>`
      SELECT p.code, s.status FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.provider_ref = ${subId}`)[0];
  const chargesFor = (subId: string) => paddle.charges.filter((c) => c.subscriptionId === subId);
  const changesAsked = (subId: string) => paddle.changeCalls.filter((c) => c.subscriptionId === subId).length;

  it(
    "WORST THING: two presses at once make one change and one charge, and nobody but this gym's billing staff can make or price one",
    async () => {
      const a = await payingOn(SMALL);
      const b = await payingOn(SMALL);
      const trainer = await makeUser();
      const manager = await makeUser();
      const member = await makeUser();
      await addStaff(a.gymId, trainer.userId, "trainer", ["members.read", "codes.invite", "attendance.read"]);
      await addStaff(a.gymId, manager.userId, "manager", ["members.read", "codes.invite", "members.confirm", "schedule.manage"]);
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${a.gymId}, ${member.userId})`;

      // Another gym's owner, a member, a trainer and a manager without the tick: refused, Paddle never asked.
      for (const [who, status] of [
        [b.cookies, 404],
        [member.cookies, 404],
        [trainer.cookies, 403],
        [manager.cookies, 403],
      ] as const) {
        expect((await sizeChange(a.gymId, who, BIG)).statusCode).toBe(status);
        expect((await sizePreview(a.gymId, who, BIG)).statusCode).toBe(status);
      }
      expect(changesAsked(a.subId)).toBe(0);
      expect(await planOf(a.subId)).toEqual({ code: SMALL, status: "active" });

      // Two different presses at the same moment: one change, one charge.
      paddle.changeDelayMs = 300;
      let both: Awaited<ReturnType<typeof sizeChange>>[];
      try {
        both = await Promise.all([sizeChange(a.gymId, a.cookies, BIG), sizeChange(a.gymId, a.cookies, BIG)]);
      } finally {
        paddle.changeDelayMs = 0;
      }
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(both.map((r) => (JSON.parse(r.body) as { error?: string }).error).filter(Boolean)).toEqual(["change_in_progress"]);
      expect(changesAsked(a.subId)).toBe(1);
      expect(chargesFor(a.subId)).toEqual([{ subscriptionId: a.subId, amount: 500 }]);
      expect(await planOf(a.subId)).toEqual({ code: BIG, status: "active" });

      // The same press sent again answers the same, and asks Paddle nothing.
      const key = "size-key-1";
      const c = await payingOn(SMALL);
      expect((await sizeChange(c.gymId, c.cookies, BIG, key)).statusCode).toBe(200);
      const again = await sizeChange(c.gymId, c.cookies, BIG, key);
      expect(again.statusCode).toBe(200);
      expect((JSON.parse(again.body) as { subscription: { seatCap: number } }).subscription.seatCap).toBe(5000);
      expect(changesAsked(c.subId)).toBe(1);
      expect(chargesFor(c.subId)).toHaveLength(1);
      // Gym B was never touched.
      expect(await planOf(b.subId)).toEqual({ code: SMALL, status: "active" });
      expect(changesAsked(b.subId)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the preview says what Paddle will charge now and from when, before tax and with it",
    async () => {
      const a = await payingOn(SMALL);
      const res = await sizePreview(a.gymId, a.cookies, BIG);
      expect(res.statusCode).toBe(200);
      // The fake charges half the difference ($10 → $20: $5) and 10 % tax.
      expect(JSON.parse(res.body)).toEqual({
        planCode: BIG,
        seatCap: 5000,
        priceLabel: "$20",
        dueNow: { totalLabel: "$5.50", subtotalLabel: "$5", taxLabel: "$0.50" },
        nextPaymentAt: "2026-11-01T00:00:00.000Z",
      });
      expect(changesAsked(a.subId)).toBe(0);
      paddle.down = true;
      try {
        expect((await sizePreview(a.gymId, a.cookies, BIG)).statusCode).toBe(503);
      } finally {
        paddle.down = false;
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a gym pays during its free trial: a trial of the days left, nothing charged, the trial's 200 members until the first payment, and the chosen size from then",
    async () => {
      const a = await payingInTrial(BIG);
      // The trial checkout asked for exactly the days left of the gym's own 10.
      expect(paddle.trialCheckouts.at(-1)).toMatchObject({ trialDays: 10, planCode: BIG, amountMinor: 2000, currency: "USD" });
      const trialEnd = paddle.subs.get(a.subId)?.next_billed_at ?? null;
      // Paddle counted 10 whole days from the fake's clock; the charge was moved to the gym's
      // own trial end, to the millisecond, so no free day is added.
      const own = (await sql<{ trial_ends_at: Date }[]>`
        SELECT trial_ends_at FROM subscriptions WHERE owner_id = ${a.gymId} AND provider = 'none'`)[0];
      expect(trialEnd).toBe(own?.trial_ends_at.toISOString());
      expect(paddle.trialMoves.filter((m) => m.subscriptionId === a.subId)).toHaveLength(1);
      // Choosing 5,000 does not open 5,000 places for free: the trial's 200 hold until Paddle is paid
      // (Kd, RULINGS 2026-09-25), on the screen and where a join is refused.
      expect(a.synced).toMatchObject({
        state: "paid",
        subscription: { status: "trialing", subscribed: true, priceLabel: "$20", seatCap: 200, nextSeatCap: 5000, currentPeriodEnd: trialEnd, trialEndsAt: trialEnd },
      });
      expect(await gymSeatCap(sql, a.gymId)).toBe(200);
      // Its own free trial gave way to the paid one; the owner's one free trial stays spent.
      const rows = await sql<{ provider: string; status: string; cancel_reason: string | null }[]>`
        SELECT provider, status, cancel_reason FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${a.gymId} ORDER BY created_at`;
      expect(rows).toEqual([
        { provider: "none", status: "expired", cancel_reason: "subscribed" },
        { provider: "paddle", status: "trialing", cancel_reason: null },
      ]);
      const mineRes = JSON.parse((await get("/v1/orgs/mine", a.cookies)).body) as { orgs: { id: string; ownerTrialUsed: boolean; consoleReadOnly: boolean }[] };
      expect(mineRes.orgs.find((o) => o.id === a.gymId)).toMatchObject({ ownerTrialUsed: true, consoleReadOnly: false });
      expect(JSON.parse((await checkout(a.gymId, a.cookies, BIG)).body)).toMatchObject({ error: "already_subscribed" });

      // The free-trial sweep, long after, leaves a paid trial to Paddle.
      expect((await expireLapsedGymTrials({ sql, log: silent }, { now: new Date(Date.now() + 30 * DAY_MS), gymIds: [a.gymId] })).expired).toBe(0);
      expect(await planOf(a.subId)).toEqual({ code: BIG, status: "trialing" });

      // The trial's last day: Paddle takes the first payment.
      await paddleSays(a.subId, {
        status: "active",
        current_billing_period: { starts_at: trialEnd ?? "", ends_at: "2026-12-11T00:00:00Z" },
        next_billed_at: "2026-12-11T00:00:00Z",
      });
      expect(await planOf(a.subId)).toEqual({ code: BIG, status: "active" });
      const converted = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${a.gymId} AND action = 'billing.converted'`;
      expect(converted).toHaveLength(1);
      expect((await myGym(a.gymId, a.cookies))?.subscription).toMatchObject({
        status: "active",
        currentPeriodEnd: "2026-12-11T00:00:00.000Z",
        subscribed: true,
        seatCap: 5000,
        nextSeatCap: null,
      });
      expect(await gymSeatCap(sql, a.gymId)).toBe(5000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a second paid trial for one gym is cancelled, and owes no refund for a checkout that charged nothing",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const first = opened(await checkout(a.gymId, a.cookies, BIG));
      const second = opened(await checkout(a.gymId, a.cookies, BIG));
      const liveSub = paddle.pay(second.transactionId);
      await post(`/v1/orgs/${a.gymId}/billing/checkouts/${second.checkoutId}/sync`, {}, a.cookies);
      // The first window was saved too, in the instant before Paddle cancelled it.
      const extraSub = paddle.pay(first.transactionId);
      await signedWebhook(subscriptionEvent(extraSub));
      await runWorker();
      expect((await paidRows(a.gymId)).map((r) => [r.provider_ref, r.status, r.cancel_reason])).toEqual([
        [liveSub, "trialing", null],
        [extraSub, "expired", "duplicate"],
      ]);
      expect(paddle.cancelledSubs).toContain(extraSub);
      expect(await refundRow(first.transactionId)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trial with under an hour left is charged at once, and a card that fails when the trial ends keeps the trial's 200 until Paddle collects",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      await sql`UPDATE subscriptions SET trial_ends_at = now() + interval '30 minutes' WHERE owner_id = ${a.gymId} AND status = 'trialing'`;
      const asked = paddle.trialCheckouts.length;
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      expect(paddle.trialCheckouts.length).toBe(asked);
      const subId = paddle.pay(txn.transactionId);
      await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies);
      expect(await planOf(subId)).toEqual({ code: BIG, status: "active" });

      // The first charge fails: the 5,000 chosen were never paid for, so the trial's 200 hold.
      const b = await payingInTrial(BIG);
      await paddleSays(b.subId, { status: "past_due" });
      expect(await graceRow(b.subId)).toMatchObject({ status: "past_due" });
      expect((await myGym(b.gymId, b.cookies))?.subscription).toMatchObject({ status: "past_due", seatCap: 200, nextSeatCap: 5000 });
      expect(await gymSeatCap(sql, b.gymId)).toBe(200);
      // Paddle collects: the chosen size starts.
      await paddleSays(b.subId, { status: "active" });
      expect((await myGym(b.gymId, b.cookies))?.subscription).toMatchObject({ status: "active", seatCap: 5000, nextSeatCap: null });
      expect(await gymSeatCap(sql, b.gymId)).toBe(5000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING: a trial window paid after the gym's own trial ended gives no free days and charges nothing: it is cancelled",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      expect(paddle.trialCheckouts.at(-1)?.trialDays).toBe(10);
      // The gym's own trial runs out and is swept; the old window, still showing
      // "Due today $0.00", is paid before the worker closes it.
      await sql`UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE owner_id = ${a.gymId} AND provider = 'none'`;
      expect((await expireLapsedGymTrials({ sql, log: silent }, { gymIds: [a.gymId] })).expired).toBe(1);
      const subId = paddle.pay(txn.transactionId);
      const synced = await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies);
      expect(JSON.parse(synced.body)).toEqual({ state: "trial_ended" });
      expect(paddle.cancelledSubs).toContain(subId);
      expect(paddle.activations).not.toContain(subId);
      expect(chargesFor(subId)).toEqual([]);
      expect(await planOf(subId)).toEqual({ code: BIG, status: "expired" });
      expect(await gymSeatCap(sql, a.gymId)).toBeNull();
      expect((await myGym(a.gymId, a.cookies))?.subscription).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trial window left open when the gym's own trial ends is closed at Paddle, once",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      const txn = opened(await checkout(a.gymId, a.cookies, BIG));
      await runWorker();
      expect(paddle.cancelledTxns).not.toContain(txn.transactionId);
      await sql`UPDATE subscriptions SET trial_ends_at = now() - interval '1 minute' WHERE owner_id = ${a.gymId} AND provider = 'none'`;
      await sql`UPDATE billing_checkouts SET trial_ends_at = now() - interval '1 minute' WHERE id = ${txn.checkoutId}`;
      await runWorker();
      await runWorker();
      expect(paddle.cancelledTxns.filter((t) => t === txn.transactionId)).toHaveLength(1);
      const state = await sql<{ state: string }[]>`SELECT state FROM billing_checkouts WHERE id = ${txn.checkoutId}`;
      expect(state[0]?.state).toBe("superseded");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trial ending within the hour is charged when saved, the day its window named; a refused charge cancels it",
    async () => {
      for (const refused of [false, true]) {
        const a = await owner();
        expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
        const txn = opened(await checkout(a.gymId, a.cookies, BIG));
        await sql`UPDATE subscriptions SET trial_ends_at = now() + interval '30 minutes' WHERE owner_id = ${a.gymId} AND provider = 'none'`;
        paddle.refuseNextActivation = refused;
        const subId = paddle.pay(txn.transactionId);
        const synced = JSON.parse((await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies)).body) as { state: string };
        if (refused) {
          expect(synced).toEqual({ state: "trial_ended" });
          expect(paddle.cancelledSubs).toContain(subId);
          expect(chargesFor(subId)).toEqual([]);
        } else {
          expect(synced).toMatchObject({ state: "paid", subscription: { status: "active", seatCap: 5000 } });
          expect(chargesFor(subId)).toEqual([{ subscriptionId: subId, amount: 2000 }]);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trial checkout is opened only at exactly the plan's code and the days left",
    async () => {
      const a = await owner();
      expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
      for (const wrong of ["code", "days"] as const) {
        paddle.wrongTrial = wrong;
        const res = await checkout(a.gymId, a.cookies, BIG);
        expect(res.statusCode).toBe(503);
        expect(paddle.cancelledTxns).toContain([...paddle.txns.keys()].at(-1));
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a price made for a trial is read as our plan only at that plan's amount, currency and month",
    async () => {
      const variants = [
        { unit_price: { amount: "1999", currency_code: "USD" } },
        { unit_price: { amount: "2000", currency_code: "EUR" } },
        { billing_cycle: { interval: "year" as const, frequency: 1 } },
      ];
      for (const patch of variants) {
        const a = await owner();
        expect((await post(`/v1/orgs/${a.gymId}/trial`, {}, a.cookies)).statusCode).toBe(200);
        const txn = opened(await checkout(a.gymId, a.cookies, BIG));
        const subId = paddle.pay(txn.transactionId);
        const item = paddle.subs.get(subId)?.items[0];
        if (item === undefined) throw new Error("fake Paddle made no item");
        paddle.update(subId, { items: [{ ...item, price: { ...item.price, ...patch } }] });
        const synced = await post(`/v1/orgs/${a.gymId}/billing/checkouts/${txn.checkoutId}/sync`, {}, a.cookies);
        expect(JSON.parse(synced.body)).toEqual({ state: "waiting" });
        expect(await paidRows(a.gymId)).toEqual([]);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a change cut off before it finished does not block the next, and its own key then says so",
    async () => {
      const a = await payingOn(SMALL);
      const row = (await sql<{ id: string; plan_id: string }[]>`
        SELECT id, plan_id FROM subscriptions WHERE provider_ref = ${a.subId}`)[0];
      if (row === undefined) throw new Error("no paid plan");
      await sql`
        INSERT INTO billing_plan_changes (gym_id, subscription_id, from_plan_id, to_plan_id, idempotency_key, provider, created_at)
        VALUES (${a.gymId}, ${row.id}, ${row.plan_id}, (SELECT id FROM plans WHERE code = ${BIG}), 'stuck-1', 'paddle', now() - interval '3 minutes')`;
      expect((await sizeChange(a.gymId, a.cookies, BIG)).statusCode).toBe(200);
      const stuck = await sizeChange(a.gymId, a.cookies, BIG, "stuck-1");
      expect(stuck.statusCode).toBe(503);
      expect(JSON.parse(stuck.body)).toMatchObject({ error: "interrupted" });
      expect(chargesFor(a.subId)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a bigger size during the paid trial charges nothing now and opens no places: the new price and size start with the first payment",
    async () => {
      const a = await payingInTrial(SMALL);
      const preview = JSON.parse((await sizePreview(a.gymId, a.cookies, BIG)).body) as { dueNow: unknown; nextPaymentAt: string | null };
      expect(preview.dueNow).toBeNull();
      expect(preview.nextPaymentAt).toBe(paddle.subs.get(a.subId)?.next_billed_at);
      const res = await sizeChange(a.gymId, a.cookies, BIG);
      expect(res.statusCode).toBe(200);
      // SMALL's 1 place was under the trial's 200; BIG's 5,000 wait for the first payment.
      expect(JSON.parse(res.body)).toMatchObject({ subscription: { status: "trialing", seatCap: 200, nextSeatCap: 5000, priceLabel: "$20", subscribed: true } });
      expect(await gymSeatCap(sql, a.gymId)).toBe(200);
      expect(paddle.changeCalls.filter((c) => c.subscriptionId === a.subId)).toEqual([{ subscriptionId: a.subId, priceId: BIG_PRICE, mode: "do_not_bill" }]);
      expect(chargesFor(a.subId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a declined card changes nothing and is answered the same again; a lost answer is never charged twice",
    async () => {
      const a = await payingOn(SMALL);
      paddle.declineNextChange = true;
      const declined = await sizeChange(a.gymId, a.cookies, BIG, "declined-1");
      expect(declined.statusCode).toBe(409);
      expect(JSON.parse(declined.body)).toMatchObject({ error: "change_declined" });
      expect(await planOf(a.subId)).toEqual({ code: SMALL, status: "active" });
      expect(chargesFor(a.subId)).toEqual([]);
      const replay = await sizeChange(a.gymId, a.cookies, BIG, "declined-1");
      expect(JSON.parse(replay.body)).toMatchObject({ error: "change_declined" });
      expect(changesAsked(a.subId)).toBe(1);

      // Paddle made the change but its answer was lost: the next press reads Paddle first.
      paddle.loseChangeAnswer = true;
      const lost = await sizeChange(a.gymId, a.cookies, BIG);
      expect(lost.statusCode).toBe(503);
      expect(JSON.parse(lost.body)).toMatchObject({ error: "change_unconfirmed" });
      const retried = await sizeChange(a.gymId, a.cookies, BIG);
      expect(retried.statusCode).toBe(200);
      expect(changesAsked(a.subId)).toBe(2);
      expect(chargesFor(a.subId)).toHaveLength(1);
      expect(await planOf(a.subId)).toEqual({ code: BIG, status: "active" });
      const states = await sql<{ state: string; failure: string | null }[]>`
        SELECT state, failure FROM billing_plan_changes WHERE gym_id = ${a.gymId} ORDER BY created_at`;
      expect(states).toEqual([
        { state: "failed", failure: "change_declined" },
        { state: "failed", failure: "change_unconfirmed" },
        { state: "done", failure: null },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refused: the same or a smaller size, a free trial with no card, an overdue plan, a plan set to end, an unknown plan, no key",
    async () => {
      const a = await payingOn(MID);
      for (const code of [MID, SMALL]) {
        const res = await sizeChange(a.gymId, a.cookies, code);
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: "not_bigger" });
      }
      expect((await sizeChange(a.gymId, a.cookies, "org_nope")).statusCode).toBe(404);
      expect((await post(`/v1/orgs/${a.gymId}/billing/size`, { planCode: BIG }, a.cookies)).statusCode).toBe(400);

      const trial = await owner();
      expect((await post(`/v1/orgs/${trial.gymId}/trial`, {}, trial.cookies)).statusCode).toBe(200);
      expect(JSON.parse((await sizeChange(trial.gymId, trial.cookies, BIG)).body)).toMatchObject({ error: "no_paid_plan" });

      const overdue = await payingOn(SMALL);
      await paddleSays(overdue.subId, { status: "past_due" });
      expect(JSON.parse((await sizeChange(overdue.gymId, overdue.cookies, BIG)).body)).toMatchObject({ error: "payment_overdue" });

      const ending = await payingOn(SMALL);
      await paddleSays(ending.subId, { scheduled_change: { action: "cancel", effective_at: "2026-11-01T00:00:00Z" } });
      expect(JSON.parse((await sizeChange(ending.gymId, ending.cookies, BIG)).body)).toMatchObject({ error: "plan_ending" });
      expect(changesAsked(a.subId) + changesAsked(overdue.subId) + changesAsked(ending.subId)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
