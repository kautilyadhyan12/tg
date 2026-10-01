// A gym paying through Razorpay moves to a smaller size (ROADMAP Stage 3 item 1d-iii-b), against
// real Postgres with a fake Razorpay in place of Razorpay's API. DATABASE_URL-gated.
//
// Razorpay charges only a plan the gym approved in its window (a ₹5 check, given back: tried on
// the test account, 2026-10-01), so a smaller size is a NEW subscription approved when it is
// chosen, starting the day the paid month ends. It waits on the plan; shortly before that day
// the members are counted. If they fit it takes the plan's place and the old plan is cancelled;
// if not, the gym stays on its size (Kd, RULINGS 2026-10-01).
//
// THE WORST THING THIS JOB COULD DO: charge a gym twice for one month (its old size and its new
// one), or take its size down while it has more members than the new size holds. The first two
// tests are those.
import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailMessage } from "../src/email/resend.js";
import { processRazorpayEvents } from "../src/modules/billing/events.js";
import { dueSizeWarnings } from "../src/modules/billing/repo.js";
import { SIZE_WINDOW_MS } from "../src/modules/billing/service.js";
import { gymSeatCap } from "../src/modules/orgs/repo.js";
import { createMemoryRedis } from "../src/redis.js";
import { BILLING_LOCK_WAIT_MS, holdBillingSuiteLock } from "./billingSuiteLock.js";
import { FakeRazorpay } from "./fakeRazorpay.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** Fakes in Razorpay's shapes, built at run time so no key-shaped text is in the repository. */
const KEY_ID = ["rzp", "test", "E".repeat(14)].join("_");
const KEY_SECRET = "F".repeat(24);
const WEBHOOK_SECRET = ["rzp", "webhook", "smaller", "secret"].join("-");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "billing-rzp-smaller-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RAZORPAY_KEY_ID: KEY_ID,
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
const DAY_S = 24 * 60 * 60;
const MONTH_S = 30 * DAY_S;
const HOUR_MS = 60 * 60 * 1000;

const SMALL = "zz_rzpsm_small"; // up to 1 member, ₹100
const MID = "zz_rzpsm_mid"; // up to 50 members, ₹150
const BIG = "zz_rzpsm_big"; // up to 5,000 members, ₹200

d("a gym paying through Razorpay moves to a smaller size (real Postgres, fake Razorpay)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const razorpay = new FakeRazorpay();
  // Razorpay's clock half way through the month the gym first pays for.
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
  /** Every billing email the worker sent. */
  const mails: EmailMessage[] = [];
  /** One run of the worker at `atMs` (default: a second from now, past the webhook's own time). */
  const runWorker = (atMs: number = Date.now() + 1000) =>
    processRazorpayEvents({
      sql,
      redis: createMemoryRedis(),
      paddle: null,
      razorpay: { api: razorpay, keyId: KEY_ID },
      log: silent,
      now: () => new Date(atMs),
      mail: {
        transport: {
          send: (message: EmailMessage) => {
            mails.push(message);
            return Promise.resolve();
          },
        },
        webOrigin: "http://localhost:5173",
      },
    });

  let ip = 0;
  const nextIp = () => `10.48.${String(Math.floor(ip / 250))}.${String((ip++ % 250) + 1)}`;
  type Cookies = Record<string, string>;

  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'billing-rzpsm-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM webhook_events WHERE provider = 'razorpay' AND payload->>'subscriptionId' IN (SELECT provider_ref FROM billing_checkouts WHERE gym_id IN (${mine}))`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_plan_changes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'billing-rzpsm-%@example.com'`;
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

  const inject = (method: "POST" | "PUT" | "DELETE" | "GET", path: string, cookies: Cookies = {}, payload?: unknown, headers: Record<string, string> = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      headers: payload === undefined ? headers : { "content-type": "application/json", ...headers },
      cookies,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Cookies = {}, headers: Record<string, string> = {}) => inject("POST", path, cookies, payload, headers);

  let seq = 0;
  const makeUser = async (): Promise<{ userId: string; cookies: Cookies; email: string }> => {
    const email = `billing-rzpsm-${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Billing" });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return {
      userId: (JSON.parse(reg.body) as { userId: string }).userId,
      cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])),
      email,
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
  const sync = async (gymId: string, checkoutId: string, cookies: Cookies) =>
    JSON.parse((await post(`/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, {}, cookies)).body) as {
      state: string;
      subscription?: Record<string, unknown>;
    };
  const preview = (gymId: string, cookies: Cookies, planCode: string) => post(`/v1/orgs/${gymId}/billing/size/preview`, { planCode }, cookies);
  const choose = (gymId: string, cookies: Cookies, planCode: string, k: string = key()) =>
    post(`/v1/orgs/${gymId}/billing/size/razorpay`, { planCode }, cookies, { "idempotency-key": k });
  const keepSize = (gymId: string, cookies: Cookies) => inject("DELETE", `/v1/orgs/${gymId}/billing/size/pending`, cookies);
  const cancelPlan = (gymId: string, cookies: Cookies) => inject("PUT", `/v1/orgs/${gymId}/billing/cancel`, cookies);
  const myGym = async (gymId: string, cookies: Cookies) => {
    const res = await inject("GET", "/v1/orgs/mine", cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { orgs: { id: string; subscription: Record<string, unknown> | null }[] }).orgs.find((o) => o.id === gymId);
  };
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
    sql<{ status: string; provider_ref: string; cancel_reason: string | null; current_period_end: Date | null; plan: string; pending: string | null; pending_ref: string | null }[]>`
      SELECT s.status, s.provider_ref, s.cancel_reason, s.current_period_end, p.code AS plan, pp.code AS pending, s.pending_subscription_ref AS pending_ref
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id LEFT JOIN plans pp ON pp.id = s.pending_plan_id
      WHERE s.owner_type = 'gym' AND s.owner_id = ${gymId} AND s.provider = 'razorpay' ORDER BY s.created_at`;
  const addMember = async (gymId: string) => {
    const person = await makeUser();
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${person.userId})`;
  };
  const membersOf = async (gymId: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gymId} AND removed_at IS NULL`)[0]?.n;
  /** Every payment Razorpay took for this subscription and did not give back. */
  const kept = (subId: string) =>
    (razorpay.invoices.get(subId) ?? [])
      .filter((i) => i.status === "paid" && i.payment_id != null && !razorpay.refunds.includes(i.payment_id))
      .map((i) => i.amount_paid);

  /** A gym on `planCode`, paid through Razorpay half a month ago. */
  const payingGym = async (planCode = BIG) => {
    const user = await makeUser();
    const res = await post("/v1/orgs", { trainsHere: false, name: `Rupee Smaller Gym ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, user.cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    const win = opened(await post(`/v1/orgs/${gymId}/billing/checkout`, { planCode }, user.cookies, { "idempotency-key": key() }));
    razorpay.authenticate(win.subscriptionId);
    expect(await sync(gymId, win.checkoutId, user.cookies)).toMatchObject({ state: "paid" });
    const sub = razorpay.subs.get(win.subscriptionId);
    if (sub?.current_end == null) throw new Error("no month");
    return { ...user, gymId, oldSub: win.subscriptionId, oldEnd: new Date(sub.current_end * 1000) };
  };
  type Gym = Awaited<ReturnType<typeof payingGym>>;
  /** Choose a smaller size and approve it in Razorpay's window. */
  const chooseAndApprove = async (gym: Gym, planCode = SMALL) => {
    const win = opened(await choose(gym.gymId, gym.cookies, planCode));
    razorpay.authenticate(win.subscriptionId);
    expect(await sync(gym.gymId, win.checkoutId, gym.cookies)).toMatchObject({ state: "paid" });
    return win;
  };
  /** The worker in the hours before the paid month ends, when a smaller size is decided. */
  const decideRun = (gym: Gym) => runWorker(gym.oldEnd.getTime() - 2 * HOUR_MS);
  /** The paid month ends at Razorpay: each subscription still charging is charged. */
  const monthEnds = async (gym: Gym, ...subs: string[]) => {
    razorpay.clock = Math.floor(gym.oldEnd.getTime() / 1000);
    const taken: string[] = [];
    for (const id of subs) {
      const sub = razorpay.subs.get(id);
      if (sub?.status === "active" || sub?.status === "authenticated") taken.push(razorpay.charge(id));
      await webhook(id);
    }
    await runWorker(gym.oldEnd.getTime() + 10 * 60 * 1000);
    await runWorker(gym.oldEnd.getTime() + 11 * 60 * 1000);
    return taken;
  };

  it(
    "WORST THING (1 of 2): one month is never charged twice — the smaller size waits, takes the plan's place on its day, and the old plan is cancelled before it can charge again (refunded if it does)",
    async () => {
      const gym = await payingGym(BIG);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(5000);

      // Nothing to pay now; the smaller price from the paid month's end.
      const shown = JSON.parse((await preview(gym.gymId, gym.cookies, SMALL)).body) as Record<string, unknown>;
      expect(shown).toMatchObject({ planCode: SMALL, seatCap: 1, priceLabel: "₹100", dueNow: null, nextPaymentAt: gym.oldEnd.toISOString() });

      const before = Date.now();
      const win = opened(await choose(gym.gymId, gym.cookies, SMALL));
      const after = Date.now();
      // Razorpay was asked for exactly this: the smaller plan from the paid month's end, nothing
      // taken now, the window open half an hour.
      const asked = razorpay.created.at(-1);
      expect(asked?.planId).toBe(SMALL_PLAN);
      expect(asked?.startAt?.getTime()).toBe(gym.oldEnd.getTime());
      expect(asked?.upfront ?? null).toBeNull();
      expect(asked?.expireBy?.getTime()).toBeGreaterThanOrEqual(before + SIZE_WINDOW_MS - 1000);
      expect(asked?.expireBy?.getTime()).toBeLessThanOrEqual(after + SIZE_WINDOW_MS);
      expect(asked?.notes).toEqual({ app: "aihg", gym_id: gym.gymId, checkout_id: win.checkoutId });

      // Not approved yet: nothing waits.
      expect(await sync(gym.gymId, win.checkoutId, gym.cookies)).toEqual({ state: "waiting" });
      expect((await rows(gym.gymId)).map((r) => [r.status, r.plan, r.pending])).toEqual([["active", BIG, null]]);

      // Approved: it waits, and the gym keeps its whole size and its plan until then.
      razorpay.authenticate(win.subscriptionId);
      const done = await sync(gym.gymId, win.checkoutId, gym.cookies);
      expect(done).toMatchObject({ state: "paid", subscription: { seatCap: 5000, pendingSize: { seatCap: 1, priceLabel: "₹100", from: gym.oldEnd.toISOString() } } });
      expect((await rows(gym.gymId)).map((r) => [r.status, r.plan, r.pending, r.pending_ref])).toEqual([["active", BIG, SMALL, win.subscriptionId]]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(5000);
      expect(kept(win.subscriptionId)).toEqual([]);

      // Razorpay's own event about the approval, and the worker before its day, change nothing,
      // and ask Razorpay to cancel nothing.
      await webhook(win.subscriptionId);
      await runWorker();
      await runWorker(gym.oldEnd.getTime() - 4 * HOUR_MS);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.plan])).toEqual([["active", BIG]]);
      expect(razorpay.cancelled).not.toContain(gym.oldSub);
      expect(razorpay.cancelled).not.toContain(win.subscriptionId);

      // Its day: the members fit, so it takes the plan's place, paid to the month's end, and the
      // old plan is cancelled at Razorpay before its next charge.
      await decideRun(gym);
      const swapped = await rows(gym.gymId);
      expect(swapped.map((r) => [r.status, r.provider_ref, r.plan, r.cancel_reason, r.pending])).toEqual([
        ["expired", gym.oldSub, BIG, "replaced", null],
        ["active", win.subscriptionId, SMALL, null, null],
      ]);
      expect(swapped[1]?.current_period_end?.getTime()).toBe(gym.oldEnd.getTime());
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("cancelled");
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
      // Twice is the same: the old plan cancelled once.
      await decideRun(gym);
      expect(razorpay.cancelled.filter((id) => id === gym.oldSub)).toHaveLength(1);

      // The month ends: Razorpay charges the smaller plan only.
      const taken = await monthEnds(gym, win.subscriptionId, gym.oldSub);
      expect(taken.map((id) => razorpay.payments.get(id)?.amount)).toEqual([10000]);
      // Had Razorpay charged the cancelled old plan anyway, it is refunded in full.
      const late = razorpay.charge(gym.oldSub);
      await webhook(gym.oldSub);
      await runWorker(gym.oldEnd.getTime() + 12 * 60 * 1000);
      await runWorker(gym.oldEnd.getTime() + 13 * 60 * 1000);
      expect(razorpay.refunds).toContain(late);
      // In all: the old plan's first month, the new plan's first month. Nothing else is kept.
      expect(kept(gym.oldSub)).toEqual([20000]);
      expect(kept(win.subscriptionId)).toEqual([10000]);
      const after2 = await rows(gym.gymId);
      expect(after2.map((r) => [r.status, r.provider_ref])).toEqual([
        ["expired", gym.oldSub],
        ["active", win.subscriptionId],
      ]);
      expect(after2[1]?.current_period_end?.getTime()).toBe((Math.floor(gym.oldEnd.getTime() / 1000) + MONTH_S) * 1000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "WORST THING (2 of 2): more members than the smaller size holds on its day — nobody is removed, the gym stays on its size and price, the smaller plan is cancelled at Razorpay uncharged, and billing staff are told",
    async () => {
      const gym = await payingGym(BIG);
      await addMember(gym.gymId);
      await addMember(gym.gymId);
      // Allowed with more members than it holds: they are counted on its day.
      const win = await chooseAndApprove(gym, SMALL);
      mails.length = 0;
      const people = await membersOf(gym.gymId);

      await decideRun(gym);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref, r.plan, r.pending, r.pending_ref])).toEqual([["active", gym.oldSub, BIG, null, null]]);
      expect(await membersOf(gym.gymId)).toBe(people);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(5000);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("active");
      expect(razorpay.cancelled).not.toContain(gym.oldSub);
      // The card says so, and so does the email: once.
      expect((await myGym(gym.gymId, gym.cookies))?.subscription).toMatchObject({ seatCap: 5000, pendingSize: null, sizeKept: { seatCap: 1, members: 2 } });
      await decideRun(gym);
      const told = mails.filter((m) => m.to === gym.email);
      expect(told).toHaveLength(1);
      expect(told[0]?.text).toContain("had 2 members when its smaller size was due, more than the 1 it allows");

      // The month ends: only the old plan charges, at its own price; the smaller one never.
      const taken = await monthEnds(gym, gym.oldSub, win.subscriptionId);
      expect(taken.map((id) => razorpay.payments.get(id)?.amount)).toEqual([20000]);
      expect(kept(win.subscriptionId)).toEqual([]);
      expect(kept(gym.oldSub)).toEqual([20000, 20000]);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref, r.plan])).toEqual([["active", gym.oldSub, BIG]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "only this gym's billing staff can price, choose or cancel a smaller size; a bad request is refused before anything is asked",
    async () => {
      const gym = await payingGym();
      const stranger = await payingGym();
      const trainer = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.gymId}, ${trainer.userId}, 'trainer', ${["members.read"]})`;
      const win = await chooseAndApprove(gym, MID);
      const made = razorpay.created.length;
      for (const who of [stranger, trainer]) {
        expect([403, 404]).toContain((await preview(gym.gymId, who.cookies, SMALL)).statusCode);
        expect([403, 404]).toContain((await choose(gym.gymId, who.cookies, SMALL)).statusCode);
        expect([403, 404]).toContain((await keepSize(gym.gymId, who.cookies)).statusCode);
      }
      expect((await choose(gym.gymId, {}, SMALL)).statusCode).toBe(401);
      expect((await post(`/v1/orgs/${gym.gymId}/billing/size/razorpay`, { planCode: SMALL }, gym.cookies)).statusCode).toBe(400);
      expect((await choose(gym.gymId, gym.cookies, "")).statusCode).toBe(400);
      expect(razorpay.created.length).toBe(made);
      // Nothing of the gym's changed, and the stranger's own plan is untouched.
      expect((await rows(gym.gymId)).map((r) => [r.plan, r.pending_ref])).toEqual([[BIG, win.subscriptionId]]);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("authenticated");
      expect((await rows(stranger.gymId)).map((r) => [r.provider_ref, r.pending])).toEqual([[stranger.oldSub, null]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Cancel this change: the smaller plan is cancelled at Razorpay at once, the gym stays as it is, and its day changes nothing",
    async () => {
      const gym = await payingGym();
      const win = await chooseAndApprove(gym);
      const res = await keepSize(gym.gymId, gym.cookies);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ subscription: { pendingSize: null, seatCap: 5000 } });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect((await keepSize(gym.gymId, gym.cookies)).statusCode).toBe(200);
      await decideRun(gym);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref, r.pending])).toEqual([["active", gym.oldSub, null]]);
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a second smaller size replaces the first: the first is cancelled at Razorpay, the second is made on the day; choosing the one already waiting is refused",
    async () => {
      const gym = await payingGym(BIG);
      const first = await chooseAndApprove(gym, MID);
      expect(JSON.parse((await choose(gym.gymId, gym.cookies, MID)).body)).toMatchObject({ error: "already_waiting" });
      const second = await chooseAndApprove(gym, SMALL);
      expect(razorpay.subs.get(first.subscriptionId)?.status).toBe("cancelled");
      expect((await rows(gym.gymId)).map((r) => [r.pending, r.pending_ref])).toEqual([[SMALL, second.subscriptionId]]);
      await decideRun(gym);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([
        ["expired", gym.oldSub],
        ["active", second.subscriptionId],
      ]);
      const taken = await monthEnds(gym, second.subscriptionId, first.subscriptionId, gym.oldSub);
      expect(taken.map((id) => razorpay.payments.get(id)?.amount)).toEqual([10000]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Cancel plan while a smaller size waits: the smaller plan is cancelled at Razorpay, nothing is charged after the paid month",
    async () => {
      const gym = await payingGym();
      const win = await chooseAndApprove(gym);
      expect((await cancelPlan(gym.gymId, gym.cookies)).statusCode).toBe(200);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect((await rows(gym.gymId)).map((r) => [r.pending, r.pending_ref])).toEqual([[null, null]]);
      await decideRun(gym);
      const taken = await monthEnds(gym, win.subscriptionId);
      expect(taken).toEqual([]);
      expect(kept(win.subscriptionId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a window approved after the plan changed (set to end meanwhile) waits on nothing: cancelled at Razorpay, and its page says so",
    async () => {
      const gym = await payingGym();
      const win = opened(await choose(gym.gymId, gym.cookies, SMALL));
      expect((await cancelPlan(gym.gymId, gym.cookies)).statusCode).toBe(200);
      razorpay.authenticate(win.subscriptionId);
      expect(await sync(gym.gymId, win.checkoutId, gym.cookies)).toEqual({ state: "refunded" });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      expect((await rows(gym.gymId)).map((r) => [r.pending, r.pending_ref])).toEqual([[null, null]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the smaller plan ended at Razorpay before its day (the bank withdrew it): the gym keeps its size, and nothing is made on the day",
    async () => {
      const gym = await payingGym();
      const win = await chooseAndApprove(gym);
      const sub = razorpay.subs.get(win.subscriptionId);
      if (sub === undefined) throw new Error("no subscription");
      razorpay.subs.set(win.subscriptionId, { ...sub, status: "cancelled", ended_at: razorpay.clock });
      await webhook(win.subscriptionId);
      await runWorker();
      expect((await rows(gym.gymId)).map((r) => [r.status, r.pending, r.pending_ref])).toEqual([["active", null, null]]);
      await decideRun(gym);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", gym.oldSub]]);
      expect(razorpay.cancelled).not.toContain(gym.oldSub);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "round one H2: the worker was down past the day and both plans charged, the members fit — the smaller size is made all the same, and the old plan's renewal is refunded in full",
    async () => {
      const gym = await payingGym(BIG);
      const win = await chooseAndApprove(gym);
      const taken = await monthEnds(gym, gym.oldSub, win.subscriptionId);
      expect(taken).toHaveLength(2);
      const [oldRenewal, newMonth] = taken;
      expect(razorpay.payments.get(oldRenewal ?? "")?.amount).toBe(20000);
      expect(razorpay.refunds).toContain(oldRenewal);
      expect(razorpay.refunds).not.toContain(newMonth);
      expect(razorpay.subs.get(gym.oldSub)?.status).toBe("cancelled");
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("active");
      // The month after the day: the smaller price only. The old plan's first month stands.
      expect(kept(gym.oldSub)).toEqual([20000]);
      expect(kept(win.subscriptionId)).toEqual([10000]);
      const now = await rows(gym.gymId);
      expect(now.map((r) => [r.status, r.provider_ref, r.plan, r.pending])).toEqual([
        ["expired", gym.oldSub, BIG, null],
        ["active", win.subscriptionId, SMALL, null],
      ]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "round one H2: the worker was down past the day and the members did NOT fit — the gym stays on its size, the smaller plan's charge is refunded, and the card and the email say so",
    async () => {
      const gym = await payingGym(BIG);
      await addMember(gym.gymId);
      await addMember(gym.gymId);
      const win = await chooseAndApprove(gym);
      mails.length = 0;
      const taken = await monthEnds(gym, gym.oldSub, win.subscriptionId);
      expect(taken).toHaveLength(2);
      const [oldRenewal, newMonth] = taken;
      expect(razorpay.refunds).toContain(newMonth);
      expect(razorpay.refunds).not.toContain(oldRenewal);
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("cancelled");
      const now = await rows(gym.gymId);
      expect(now.filter((r) => r.status === "active").map((r) => [r.provider_ref, r.plan, r.pending])).toEqual([[gym.oldSub, BIG, null]]);
      expect((await myGym(gym.gymId, gym.cookies))?.subscription).toMatchObject({ seatCap: 5000, pendingSize: null, sizeKept: { seatCap: 1, members: 2 } });
      expect(mails.filter((m) => m.to === gym.email).map((m) => m.text)).toEqual([expect.stringContaining("had 2 members when its smaller size was due")]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "round one H1: the browser's sync and Razorpay's webhook for one approval, at the same moment, both leave it waiting — neither cancels it",
    async () => {
      const gym = await payingGym(BIG);
      const win = opened(await choose(gym.gymId, gym.cookies, SMALL));
      razorpay.authenticate(win.subscriptionId);
      await webhook(win.subscriptionId);
      // The gym's lock held while both read: each sees nothing waiting and the window open.
      let release: () => void = () => undefined;
      const held = sql.begin(async (tx) => {
        await tx`SELECT 1 FROM gyms WHERE id = ${gym.gymId} FOR UPDATE`;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const both = Promise.all([sync(gym.gymId, win.checkoutId, gym.cookies), runWorker()]);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      release();
      await held;
      const [synced] = await both;
      expect(synced).toMatchObject({ state: "paid", subscription: { pendingSize: { seatCap: 1 } } });
      expect(razorpay.subs.get(win.subscriptionId)?.status).toBe("authenticated");
      expect(razorpay.cancelled).not.toContain(win.subscriptionId);
      expect((await rows(gym.gymId)).map((r) => [r.plan, r.pending, r.pending_ref])).toEqual([[BIG, SMALL, win.subscriptionId]]);
      // Its day: made, and the month is charged once, at the smaller price.
      await decideRun(gym);
      const taken = await monthEnds(gym, win.subscriptionId, gym.oldSub);
      expect(taken.map((id) => razorpay.payments.get(id)?.amount)).toEqual([10000]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Razorpay unreachable on the day: the size is held and made on the next run; one charge for the month all the same",
    async () => {
      const gym = await payingGym(BIG);
      const win = await chooseAndApprove(gym);
      razorpay.down = true;
      await decideRun(gym);
      razorpay.down = false;
      // Decided (the members fit) and holding for joins, not yet in the plan's place.
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([["active", gym.oldSub]]);
      expect(await gymSeatCap(sql, gym.gymId)).toBe(1);
      // Cancel this change can no longer cross it.
      expect(JSON.parse((await keepSize(gym.gymId, gym.cookies)).body)).toMatchObject({ error: "change_in_progress" });
      await runWorker(gym.oldEnd.getTime() - HOUR_MS);
      expect((await rows(gym.gymId)).map((r) => [r.status, r.provider_ref])).toEqual([
        ["expired", gym.oldSub],
        ["active", win.subscriptionId],
      ]);
      const taken = await monthEnds(gym, win.subscriptionId, gym.oldSub);
      expect(taken.map((id) => razorpay.payments.get(id)?.amount)).toEqual([10000]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a bigger size paid while a smaller one waits: the smaller plan is cancelled at Razorpay and the bigger one is the gym's",
    async () => {
      const gym = await payingGym(MID);
      const small = await chooseAndApprove(gym, SMALL);
      const big = opened(await choose(gym.gymId, gym.cookies, BIG));
      razorpay.authenticate(big.subscriptionId);
      expect(await sync(gym.gymId, big.checkoutId, gym.cookies)).toMatchObject({ state: "paid", subscription: { seatCap: 5000, pendingSize: null } });
      await runWorker();
      expect(razorpay.subs.get(small.subscriptionId)?.status).toBe("cancelled");
      await decideRun(gym);
      expect((await rows(gym.gymId)).filter((r) => r.status === "active").map((r) => r.provider_ref)).toEqual([big.subscriptionId]);
      const taken = await monthEnds(gym, big.subscriptionId, small.subscriptionId);
      expect(taken.map((id) => razorpay.payments.get(id)?.amount)).toEqual([20000]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "three days before, billing staff are emailed once: the gym will STAY on its size if it does nothing, with the smallest size that fits offered",
    async () => {
      const gym = await payingGym(BIG);
      await addMember(gym.gymId);
      await addMember(gym.gymId);
      await chooseAndApprove(gym, SMALL);
      mails.length = 0;
      // Each provider's worker warns its own gyms only.
      const due = async (provider: "paddle" | "razorpay") =>
        (await dueSizeWarnings(sql, { provider, now: new Date(gym.oldEnd.getTime() - 2 * DAY_S * 1000), within: 3 * DAY_S * 1000, lead: 3 * HOUR_MS, limit: 500 })).map((d) => d.gymId);
      expect(await due("razorpay")).toContain(gym.gymId);
      expect(await due("paddle")).not.toContain(gym.gymId);
      await runWorker(gym.oldEnd.getTime() - 4 * DAY_S * 1000);
      expect(mails.filter((m) => m.to === gym.email)).toEqual([]);
      await runWorker(gym.oldEnd.getTime() - 2 * DAY_S * 1000);
      await runWorker(gym.oldEnd.getTime() - 2 * DAY_S * 1000 + HOUR_MS);
      const sent = mails.filter((m) => m.to === gym.email);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toMatch(/has 2 members now\. If you do nothing, on \d+ \w+ Rupee Smaller Gym \d+ will stay on up to 5,000 members at ₹200 a month\./);
      expect(sent[0]?.text).toContain("Or move to up to 50 members (₹150 a month), the smallest size that fits, or choose another size, from your plan:");
      // The card offers the same, and says the gym stays if it does nothing.
      expect((await myGym(gym.gymId, gym.cookies))?.subscription).toMatchObject({ pendingSize: { seatCap: 1, ifTooMany: { planCode: MID, seatCap: 50, priceLabel: "₹150" } } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refused, with nothing asked of Razorpay: within the hour before renewal, a plan set to end",
    async () => {
      const gym = await payingGym(MID);
      const made = razorpay.created.length;
      await sql`UPDATE subscriptions SET current_period_end = now() + interval '40 minutes' WHERE provider_ref = ${gym.oldSub}`;
      expect(JSON.parse((await choose(gym.gymId, gym.cookies, SMALL)).body)).toMatchObject({ error: "renewing" });
      await sql`UPDATE subscriptions SET current_period_end = ${gym.oldEnd} WHERE provider_ref = ${gym.oldSub}`;
      expect((await cancelPlan(gym.gymId, gym.cookies)).statusCode).toBe(200);
      expect(JSON.parse((await choose(gym.gymId, gym.cookies, SMALL)).body)).toMatchObject({ error: "plan_ending" });
      expect(razorpay.created.length).toBe(made);
    },
    TEST_TIMEOUT_MS,
  );
});
