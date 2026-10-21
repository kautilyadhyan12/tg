// A NEW OWNER CHOOSES THEIR PLAN BEFORE THE HANDED-OVER PLAN ENDS — routes against REAL Postgres
// (DATABASE_URL-gated), with a fake Paddle. ROADMAP Stage 2 item 4b-vi-a.
//
// A gym paying through Paddle is handed to a co-owner: the old owner's plan stops renewing and
// stays paid to the end of its month (4b-iii-a). The new owner chooses their own plan now, in
// Paddle's window with their own card: nothing is charged until the old plan ends, and it starts
// then, so the members never drop to the free app between the two.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): the new
// owner charged for days the old owner already paid for, or charged at all once the gym has left
// them. "Charged" is read where Paddle would charge: what it has charged, and when it next will.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { planEndReminderEmail } from "../src/modules/billing/emails.js";
import { applyPaddleSubscription, planEndAction, type BillingDeps } from "../src/modules/billing/service.js";
import { staleTrialCheckouts } from "../src/modules/billing/repo.js";
import { FakePaddle } from "./fakePaddle.js";
import {
  ROLE_PRIVILEGES,
  myOwnerRequestResponseSchema,
  orgCheckoutResponseSchema,
  orgCheckoutSyncResponseSchema,
  orgPlanCancelResponseSchema,
  type OrgRole,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "next-plan-test-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // Built at run time so no key-shaped text is in the repository.
  PADDLE_ENV: "sandbox",
  PADDLE_API_KEY: ["pdl", "sdbx", "apikey", "01" + "n".repeat(24), "NextPlanNextPlanNextPl", "Xyz"].join("_"),
  PADDLE_CLIENT_TOKEN: ["test", "5".repeat(27)].join("_"),
};

type App = Awaited<ReturnType<typeof buildApp>>;
const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const PLAN = "zz_next_plan_200";
const PLAN_BIG = "zz_next_plan_500";
const PRICE = "pri_" + "w".repeat(26);
const PRICE_BIG = "pri_" + "x".repeat(26);
const addr = (local: string) => `nextpl-t-${local}@nextpl-t.example.com`;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface User {
  userId: string;
  email: string;
  name: string;
  cookies: Record<string, string>;
}
interface Gym {
  id: string;
  /** Who paid for the plan, its first owner. */
  payer: User;
  /** The old owner's plan's Paddle subscription. */
  sub: string;
}

let ipCounter = 0;
const nextIp = () => `10.72.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("A new owner chooses their plan before the handed-over plan ends (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  /** What this file's own billing steps logged, as "level event". */
  const logged: string[] = [];
  const paddle = new FakePaddle({ [PRICE]: { amount: "2900", currency: "USD" }, [PRICE_BIG]: { amount: "4900", currency: "USD" } });
  const billing: BillingDeps = {
    sql,
    redis: createMemoryRedis(),
    paddle: { api: paddle, environment: "sandbox", clientToken: baseEnv.PADDLE_CLIENT_TOKEN },
    log: { info: () => undefined, warn: (o: { event?: string }) => void logged.push(`warn ${o.event ?? ""}`), error: (o: { event?: string }) => void logged.push(`error ${o.event ?? ""}`) },
    now: () => new Date(),
  };
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE name LIKE 'NextPl %'`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_co_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_plan_changes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`UPDATE subscriptions SET follows_subscription_id = NULL WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'nextpl-t-%')`;
    await sql`DELETE FROM users WHERE email LIKE 'nextpl-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'nextpl-t-%'`;
    await sql`DELETE FROM plans WHERE code IN (${PLAN}, ${PLAN_BIG})`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, who: User, payload?: unknown, headers: Record<string, string> = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: who.cookies,
      headers: { "content-type": "application/json", ...headers },
      payload: JSON.stringify(payload ?? {}),
    });
  const get = (path: string, who: User) => api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies: who.cookies });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const signIn = async (email: string, displayName: string): Promise<User> => {
    const sent = await api().inject({ method: "POST", url: "/v1/auth/code/send", remoteAddress: nextIp(), payload: { email } });
    expect(sent.statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await api().inject({ method: "POST", url: "/v1/auth/code/verify", remoteAddress: nextIp(), payload: { email, code } });
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${user.id}`;
    return { userId: user.id, email, name: displayName, cookies: cookieMap(res) };
  };
  let count = 0;
  const person = (name: string) => signIn(addr(`${name.toLowerCase()}-${String(++count)}`), name);

  /** A gym its owner pays for through Paddle, its month ending `endsInMs` from now. */
  const makePaidGym = async (ownerName: string, endsInMs = 20 * DAY_MS): Promise<Gym> => {
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `NextPl ${ownerName} ${String(++count)}`, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.id}`;
    const made = await paddle.createTransaction({ priceId: PRICE, customData: { gym_id: org.id } });
    if (made.kind !== "ok") throw new Error("the fake did not make a transaction");
    const sub = paddle.pay(made.value.id, "api", true, owner.email);
    const monthStart = new Date(Date.now() + endsInMs - 30 * DAY_MS).toISOString();
    const monthEnd = new Date(Date.now() + endsInMs).toISOString();
    paddle.update(sub, { current_billing_period: { starts_at: monthStart, ends_at: monthEnd }, next_billed_at: monthEnd });
    const fake = paddle.subs.get(sub);
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, provider_customer_ref, current_period_end, provider_updated_at)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'paddle', ${sub}, ${fake?.customer_id ?? null},
              ${fake?.current_billing_period?.ends_at ?? null}, ${fake?.updated_at ?? null})`;
    return { id: org.id, payer: owner, sub };
  };
  const makeStaff = async (gym: Gym, name: string, role: OrgRole = "manager"): Promise<User> => {
    const staff = await person(name);
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${staff.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
    return staff;
  };
  const makeCoOwner = (gym: Gym, name: string) => makeStaff(gym, name, "owner");
  /** The gym's owner asks a co-owner to take it over, who accepts. */
  const handOver = async (gym: Gym, from: User, to: User) => {
    expect((await send("POST", `/v1/orgs/${gym.id}/staff/${to.userId}/owner-request`, from)).statusCode).toBe(201);
    const request = myOwnerRequestResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gym.id}/owner-request`, to)).body)).request;
    if (request === null) throw new Error("no request is waiting");
    const res = await send("POST", `/v1/orgs/${gym.id}/owner-request/${request.id}/accept`, to);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** A paid gym handed to a new co-owner, Paddle having confirmed the old plan ends. */
  const handedOverGym = async (endsInMs = 20 * DAY_MS) => {
    const gym = await makePaidGym("Kd", endsInMs);
    const cora = await makeCoOwner(gym, "Cora");
    await handOver(gym, gym.payer, cora);
    expect(paddle.renews(gym.sub)).toBe(false);
    const row = await rowOf(gym.sub);
    expect(row?.handed_over_end_sent_at).not.toBeNull();
    return { gym, cora, until: row?.current_period_end ?? new Date(0) };
  };

  const choose = async (gym: Gym, who: User, planCode = PLAN, key = crypto.randomUUID()) =>
    await send("POST", `/v1/orgs/${gym.id}/billing/checkout`, who, { planCode }, { "idempotency-key": key });
  /** Choose a plan in Paddle's window and pay it as `payer` would: the subscription Paddle made. */
  const chooseAndPay = async (gym: Gym, who: User, payer: User, planCode = PLAN) => {
    const res = await choose(gym, who, planCode);
    expect(res.statusCode, res.body).toBe(200);
    const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
    if (window.provider !== "paddle") throw new Error("not Paddle's window");
    const sub = paddle.pay(window.transactionId, "api", true, payer.email);
    return { checkoutId: window.checkoutId, transactionId: window.transactionId, sub };
  };
  const sync = async (gym: Gym, who: User, checkoutId: string) => {
    const res = await send("POST", `/v1/orgs/${gym.id}/billing/checkouts/${checkoutId}/sync`, who);
    expect(res.statusCode, res.body).toBe(200);
    return orgCheckoutSyncResponseSchema.parse(JSON.parse(res.body));
  };
  /** The window paid ten minutes after it opened: Paddle's free days, counted from then, run past
   *  the old plan's end, so its first charge is moved back to that end. */
  const cardSavedLate = () => {
    paddle.clock = Date.now() + 10 * 60_000;
  };
  const cancel = (gym: Gym, who: User) => send("PUT", `/v1/orgs/${gym.id}/billing/cancel`, who);

  const rowOf = async (subRef: string) =>
    (
      await sql<
        {
          id: string;
          status: string;
          cancel_reason: string | null;
          cancel_at_period_end: boolean;
          current_period_end: Date | null;
          trial_ends_at: Date | null;
          trial_seat_cap: number | null;
          handed_over_end_sent_at: Date | null;
          follows_subscription_id: string | null;
        }[]
      >`
        SELECT id, status, cancel_reason, cancel_at_period_end, current_period_end, trial_ends_at, trial_seat_cap,
               handed_over_end_sent_at, follows_subscription_id
        FROM subscriptions WHERE provider = 'paddle' AND provider_ref = ${subRef}`
    )[0];
  const liveRef = async (gym: Gym) =>
    (await sql<{ provider_ref: string | null }[]>`
      SELECT provider_ref FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND status IN ('trialing','active','past_due')`)[0]
      ?.provider_ref ?? null;
  /** The gym's plan as the console reads it, for this person. */
  const consolePlan = async (gym: Gym, who: User) => {
    const res = await get("/v1/orgs/mine", who);
    expect(res.statusCode, res.body).toBe(200);
    const { orgs } = JSON.parse(res.body) as {
      orgs: {
        id: string;
        subscription: {
          status: string;
          seatCap: number | null;
          nextSeatCap: number | null;
          currentPeriodEnd: string | null;
          cancelAtPeriodEnd: boolean;
          keepUntil: string | null;
          handedOverBy: string | null;
          nextPlanUntil: string | null;
          followsPaidBy: string | null;
          followsPaidByYou: boolean;
        } | null;
      }[];
    };
    return orgs.find((o) => o.id === gym.id)?.subscription ?? null;
  };
  /** Everything Paddle has charged for this subscription: its windows and its months. */
  const charged = (sub: string) => [
    ...paddle.charges.filter((c) => c.subscriptionId === sub && c.amount !== 0),
    ...paddle.activations.filter((s) => s === sub),
    ...[...paddle.txns.values()].filter((t) => t.subscription_id === sub && (t.details?.totals?.grand_total ?? "0") !== "0"),
  ];

  beforeAll(async () => {
    await cleanup();
    for (const [code, price, cap, amount] of [
      [PLAN, PRICE, 200, 2900],
      [PLAN_BIG, PRICE_BIG, 500, 4900],
    ] as const) {
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                           seat_cap, trial_days, rank, entitlements, member_entitlements, paddle_price_id)
        VALUES (${code}, 'org', ${"plan." + code}, ${amount}, 'USD', 'month', ${cap}, 0, 10, '{}'::jsonb, '{}'::jsonb, ${price})
        ON CONFLICT (code) DO UPDATE SET active = true, paddle_price_id = ${price}`;
    }
    app = await buildApp(loadConfig(baseEnv), {
      paddleApi: paddle,
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: (to, code) => {
          signInCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
      },
      coOwnerEmailSender: { sendCoOwnerRequest: () => Promise.resolve(), sendOwnerRequest: () => Promise.resolve() },
    });
    await api().ready();
    // A card is saved now, before any hand-over after it, as on Paddle's own clock.
    paddle.clock = Date.now();
    // Paddle's window is filled in with the gym's owner's email: the fake pays as them.
    paddle.payerEmailFor = async (gymId) =>
      (await sql<{ email: string }[]>`SELECT u.email FROM gyms g JOIN users u ON u.id = g.owner_user_id WHERE g.id = ${gymId}`)[0]?.email ?? null;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  // ── The worst thing: the new owner charged for days the old owner paid for ───────────────
  describe("the new owner is never charged before the old plan ends", () => {
    it("their plan's window charges nothing, and its first payment is the old plan's end, to the second", async () => {
      const { gym, cora, until } = await handedOverGym();
      const oldCharges = charged(gym.sub).length;
      cardSavedLate();
      const paid = await chooseAndPay(gym, cora, cora);
      const txn = paddle.txns.get(paid.transactionId);
      // The window: the plan's own price, no charge now, free for the whole days left.
      expect(txn?.details?.totals?.grand_total).toBe("0");
      expect(txn?.items[0]?.price.unit_price.amount).toBe("2900");
      expect(txn?.items[0]?.price.custom_data?.["plan_code"]).toBe(PLAN);
      const days = txn?.items[0]?.price.trial_period?.frequency ?? 0;
      expect(days * DAY_MS).toBeGreaterThanOrEqual(until.getTime() - Date.now());
      expect((days - 1) * DAY_MS).toBeLessThan(until.getTime() - Date.now());

      const synced = await sync(gym, cora, paid.checkoutId);
      expect(synced.state).toBe("paid");
      // Paddle's whole days ran past the old plan's end; its first charge is moved back to it.
      expect(Date.parse(paddle.subs.get(paid.sub)?.next_billed_at ?? "")).toBe(until.getTime());
      expect(paddle.subs.get(paid.sub)?.status).toBe("trialing");
      expect(charged(paid.sub)).toEqual([]);
      // The old owner's plan still ends with its month, never renewed.
      expect(paddle.renews(gym.sub)).toBe(false);
      expect(charged(gym.sub)).toHaveLength(oldCharges);

      // The members keep a plan throughout: the new one is the gym's now, the old one ended here.
      expect(await liveRef(gym)).toBe(paid.sub);
      const next = await rowOf(paid.sub);
      expect(next?.status).toBe("trialing");
      expect(next?.trial_ends_at?.getTime()).toBe(until.getTime());
      const old = await rowOf(gym.sub);
      expect(old?.status).toBe("expired");
      expect(old?.cancel_reason).toBe("followed");
      expect(next?.follows_subscription_id).toBe(old?.id);
    }, TEST_TIMEOUT_MS);

    it("handed back to the old owner before the window is paid: the new plan is cancelled, nothing charged, and the old plan stays", async () => {
      const { gym, cora } = await handedOverGym();
      const res = await choose(gym, cora);
      expect(res.statusCode, res.body).toBe(200);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      if (window.provider !== "paddle") throw new Error("not Paddle's window");
      // Cora gives the gym back before she pays the window she opened.
      await handOver(gym, cora, gym.payer);
      const sub = paddle.pay(window.transactionId, "api", true, cora.email);
      const synced = await sync(gym, gym.payer, window.checkoutId);
      expect(synced.state).toBe("not_started");
      expect(paddle.cancelledSubs).toContain(sub);
      expect(charged(sub)).toEqual([]);
      expect(await sql`SELECT 1 FROM billing_refunds WHERE subscription_ref = ${sub}`).toHaveLength(0);
      expect(await liveRef(gym)).toBe(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("handed on to another co-owner before the window is paid: the new plan is never the gym's, nothing charged", async () => {
      const { gym, cora } = await handedOverGym();
      const dan = await makeCoOwner(gym, "Dan");
      const res = await choose(gym, cora);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      if (window.provider !== "paddle") throw new Error("not Paddle's window");
      await handOver(gym, cora, dan);
      // Paid as Cora, who is no longer the owner; the window was filled in with her email.
      const sub = paddle.pay(window.transactionId, "api", true, cora.email);
      expect((await sync(gym, dan, window.checkoutId)).state).toBe("not_started");
      expect(paddle.cancelledSubs).toContain(sub);
      expect(charged(sub)).toEqual([]);
      expect(await liveRef(gym)).toBe(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("a first payment Paddle puts before the old plan's end is never put on the gym", async () => {
      const { gym, cora, until } = await handedOverGym();
      const res = await choose(gym, cora);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      if (window.provider !== "paddle") throw new Error("not Paddle's window");
      const sub = paddle.pay(window.transactionId, "api", true, cora.email);
      const early = new Date(until.getTime() - 2 * DAY_MS).toISOString();
      paddle.update(sub, { next_billed_at: early, current_billing_period: { starts_at: new Date().toISOString(), ends_at: early } });
      expect((await sync(gym, cora, window.checkoutId)).state).toBe("not_started");
      expect(paddle.cancelledSubs).toContain(sub);
      // Set aside as a second plan: never the gym's plan, not even for a moment.
      expect((await rowOf(sub))?.cancel_reason).toBe("duplicate");
      expect(charged(sub)).toEqual([]);
      expect(await liveRef(gym)).toBe(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("paid after the old plan has ended in our records: it never starts, nothing is charged, and the screen is told so", async () => {
      const { gym, cora } = await handedOverGym();
      const res = await choose(gym, cora);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      if (window.provider !== "paddle") throw new Error("not Paddle's window");
      // Paddle's end of the old plan reaches us first.
      paddle.update(gym.sub, { status: "canceled", canceled_at: paddle.tick(), scheduled_change: null });
      await applyPaddleSubscription(billing, gym.sub);
      expect(await liveRef(gym)).toBeNull();
      const sub = paddle.pay(window.transactionId, "api", true, cora.email);
      // Paddle's event: an expected outcome, never an alarm of a second plan refunded.
      logged.length = 0;
      expect(await applyPaddleSubscription(billing, sub)).toBe("set_aside");
      expect(logged).toEqual(["warn billing.following_not_started"]);
      expect((await sync(gym, cora, window.checkoutId)).state).toBe("not_started");
      expect(paddle.cancelledSubs).toContain(sub);
      // Set aside as a second plan: never the gym's plan, not even for a moment.
      expect((await rowOf(sub))?.cancel_reason).toBe("duplicate");
      expect(charged(sub)).toEqual([]);
      expect(await liveRef(gym)).toBeNull();
    }, TEST_TIMEOUT_MS);

    it("paid inside the old plan's last hour, when Paddle could no longer move its first charge: never placed, nothing charged", async () => {
      const { gym, cora } = await handedOverGym();
      const res = await choose(gym, cora);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      if (window.provider !== "paddle") throw new Error("not Paddle's window");
      // Time passes: the old plan now ends in half an hour, its window still open.
      const soon = new Date(Date.now() + 30 * 60_000);
      await sql`UPDATE subscriptions SET current_period_end = ${soon} WHERE provider_ref = ${gym.sub}`;
      await sql`UPDATE billing_checkouts SET follows_until = ${soon} WHERE id = ${window.checkoutId}`;
      const sub = paddle.pay(window.transactionId, "api", true, cora.email);
      expect((await sync(gym, cora, window.checkoutId)).state).toBe("not_started");
      expect(paddle.cancelledSubs).toContain(sub);
      // Set aside as a second plan: never the gym's plan, not even for a moment.
      expect((await rowOf(sub))?.cancel_reason).toBe("duplicate");
      expect(charged(sub)).toEqual([]);
      expect(await liveRef(gym)).toBe(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("Paddle no longer confirming the old plan's end when the window is paid: never placed, nothing charged", async () => {
      const { gym, cora } = await handedOverGym();
      const res = await choose(gym, cora);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      if (window.provider !== "paddle") throw new Error("not Paddle's window");
      // The old plan kept at Paddle meanwhile: the worker has to tell Paddle again.
      await sql`UPDATE subscriptions SET handed_over_end_sent_at = NULL WHERE provider_ref = ${gym.sub}`;
      const sub = paddle.pay(window.transactionId, "api", true, cora.email);
      expect((await sync(gym, cora, window.checkoutId)).state).toBe("not_started");
      expect(paddle.cancelledSubs).toContain(sub);
      // Set aside as a second plan: never the gym's plan, not even for a moment.
      expect((await rowOf(sub))?.cancel_reason).toBe("duplicate");
      expect(charged(sub)).toEqual([]);
      expect(await liveRef(gym)).toBe(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("cancelled before it starts: Paddle ends it with its free days, and nothing is ever charged", async () => {
      const { gym, cora, until } = await handedOverGym();
      cardSavedLate();
      const paid = await chooseAndPay(gym, cora, cora);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      const res = await cancel(gym, cora);
      expect(res.statusCode, res.body).toBe(200);
      const body = orgPlanCancelResponseSchema.parse(JSON.parse(res.body));
      expect(body.subscription?.cancelAtPeriodEnd).toBe(true);
      expect(Date.parse(body.subscription?.currentPeriodEnd ?? "")).toBe(until.getTime());
      expect(paddle.renews(paid.sub)).toBe(false);
      expect(charged(paid.sub)).toEqual([]);
      // A second press finds it set to end: Paddle is not asked again.
      const asked = paddle.endsAtPeriodEnd.filter((s) => s === paid.sub).length;
      expect((await cancel(gym, cora)).statusCode).toBe(200);
      expect(paddle.endsAtPeriodEnd.filter((s) => s === paid.sub)).toHaveLength(asked);
      // Kept again before it starts, it charges at the old plan's end once more.
      const kept = await send("DELETE", `/v1/orgs/${gym.id}/billing/cancel`, cora);
      expect(kept.statusCode, kept.body).toBe(200);
      expect(paddle.renews(paid.sub)).toBe(true);
      expect(Date.parse(paddle.subs.get(paid.sub)?.next_billed_at ?? "")).toBe(until.getTime());
    }, TEST_TIMEOUT_MS);

    it("handed on again before it starts: it is set to end and nothing is charged", async () => {
      const { gym, cora } = await handedOverGym();
      const dan = await makeCoOwner(gym, "Dan");
      // The card saved before the gym is handed on.
      paddle.clock = Date.now();
      const paid = await chooseAndPay(gym, cora, cora);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      // Dan's request calls it a new plan, never a trial.
      expect((await send("POST", `/v1/orgs/${gym.id}/staff/${dan.userId}/owner-request`, cora)).statusCode).toBe(201);
      const asked = myOwnerRequestResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gym.id}/owner-request`, dan)).body)).request;
      expect(asked?.planStops?.following).toBe(true);
      expect(asked?.planStops?.trial).toBe(true);
      if (asked === null) throw new Error("no request is waiting");
      const accepted = await send("POST", `/v1/orgs/${gym.id}/owner-request/${asked.id}/accept`, dan);
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(paddle.renews(paid.sub)).toBe(false);
      expect(charged(paid.sub)).toEqual([]);
      // Dan may now choose his own, from when Cora's would have started.
      expect((await consolePlan(gym, dan))?.nextPlanUntil).not.toBeNull();
    }, TEST_TIMEOUT_MS);
  });

  describe("who may choose it, and when", () => {
    it("before Paddle confirms the old plan ends, the window is not opened", async () => {
      const { gym, cora } = await handedOverGym();
      await sql`UPDATE subscriptions SET handed_over_end_sent_at = NULL WHERE provider_ref = ${gym.sub}`;
      const made = paddle.created;
      const res = await choose(gym, cora);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("plan_ending_unconfirmed");
      expect(paddle.created).toBe(made);
      expect((await consolePlan(gym, cora))?.nextPlanUntil).toBeNull();
    }, TEST_TIMEOUT_MS);

    it("within three hours of the old plan's end, the window is not opened", async () => {
      const { gym, cora } = await handedOverGym(2 * HOUR_MS);
      const made = paddle.created;
      const res = await choose(gym, cora);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("too_late");
      expect(paddle.created).toBe(made);
    }, TEST_TIMEOUT_MS);

    it("the person who paid for the plan ending is not let choose the next one, the window filled in with the owner's email", async () => {
      const { gym } = await handedOverGym();
      const made = paddle.created;
      const res = await choose(gym, gym.payer);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("next_plan_not_yours");
      expect(paddle.created).toBe(made);
    }, TEST_TIMEOUT_MS);

    it("a new plan's size is not changed before it starts, and is once it has", async () => {
      const { gym, cora, until } = await handedOverGym();
      cardSavedLate();
      const paid = await chooseAndPay(gym, cora, cora);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      const asked = paddle.changeCalls.length;
      const res = await send("POST", `/v1/orgs/${gym.id}/billing/size`, cora, { planCode: PLAN_BIG }, { "idempotency-key": crypto.randomUUID() });
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("plan_not_started");
      expect(paddle.changeCalls).toHaveLength(asked);
      // Once its first payment is taken it is any paying plan: not a new plan on screen, and resized.
      paddle.renew(paid.sub, until.toISOString(), "2900");
      expect(await applyPaddleSubscription(billing, paid.sub)).toBe("applied");
      const paying = await consolePlan(gym, cora);
      expect(paying?.status).toBe("active");
      expect(paying?.followsPaidBy).toBeNull();
      expect(paying?.followsPaidByYou).toBe(false);
      const resized = await send("POST", `/v1/orgs/${gym.id}/billing/size`, cora, { planCode: PLAN_BIG }, { "idempotency-key": crypto.randomUUID() });
      expect(resized.statusCode, resized.body).toBe(200);
    }, TEST_TIMEOUT_MS);

    it("handed on: a new plan never paid names nobody as its payer; one that has paid names who paid", async () => {
      // Never paid: Cora's new plan handed on to Dan before it started.
      const first = await handedOverGym();
      const dan = await makeCoOwner(first.gym, "Dan");
      paddle.clock = Date.now();
      const cora1 = await chooseAndPay(first.gym, first.cora, first.cora);
      expect((await sync(first.gym, first.cora, cora1.checkoutId)).state).toBe("paid");
      await handOver(first.gym, first.cora, dan);
      cardSavedLate();
      const dan1 = await chooseAndPay(first.gym, dan, dan);
      expect((await sync(first.gym, dan, dan1.checkoutId)).state).toBe("paid");
      expect((await consolePlan(first.gym, dan))?.followsPaidBy).toBe("");

      // Paid: Cora's plan took its first payment, then was handed on to Eve.
      const second = await handedOverGym();
      const eve = await makeCoOwner(second.gym, "Eve");
      paddle.clock = Date.now();
      const cora2 = await chooseAndPay(second.gym, second.cora, second.cora);
      expect((await sync(second.gym, second.cora, cora2.checkoutId)).state).toBe("paid");
      paddle.renew(cora2.sub, new Date(Date.now() - 60_000).toISOString(), "2900");
      expect(await applyPaddleSubscription(billing, cora2.sub)).toBe("applied");
      await handOver(second.gym, second.cora, eve);
      cardSavedLate();
      const eve1 = await chooseAndPay(second.gym, eve, eve);
      expect((await sync(second.gym, eve, eve1.checkoutId)).state).toBe("paid");
      expect((await consolePlan(second.gym, eve))?.followsPaidBy).toBe("Cora");
      expect((await consolePlan(second.gym, second.cora))?.followsPaidByYou).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a plan not handed over is still a plan already chosen", async () => {
      const gym = await makePaidGym("Kd");
      const res = await choose(gym, gym.payer);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("already_subscribed");
    }, TEST_TIMEOUT_MS);

    it("nobody from another gym, and nobody on the staff who doesn't manage billing, opens it", async () => {
      const { gym } = await handedOverGym();
      const stranger = (await makePaidGym("Stranger")).payer;
      const trainer = await makeStaff(gym, "Tara", "trainer");
      const made = paddle.created;
      for (const who of [stranger, trainer]) {
        const res = await choose(gym, who);
        expect([403, 404], res.body).toContain(res.statusCode);
      }
      expect(paddle.created).toBe(made);
      expect(await sql`SELECT 1 FROM billing_checkouts WHERE gym_id = ${gym.id}`).toHaveLength(0);
    }, TEST_TIMEOUT_MS);

    it("the same press twice opens one window", async () => {
      const { gym, cora } = await handedOverGym();
      const key = crypto.randomUUID();
      const first = await choose(gym, cora, PLAN, key);
      const again = await choose(gym, cora, PLAN, key);
      expect(first.statusCode, first.body).toBe(200);
      expect(again.statusCode, again.body).toBe(200);
      expect(JSON.parse(again.body)).toEqual(JSON.parse(first.body));
      expect(await sql`SELECT 1 FROM billing_checkouts WHERE gym_id = ${gym.id}`).toHaveLength(1);
    }, TEST_TIMEOUT_MS);

    it("the plan box offers it until three hours before the end, and then says whose plan it follows", async () => {
      const { gym, cora, until } = await handedOverGym();
      const before = await consolePlan(gym, cora);
      expect(Date.parse(before?.nextPlanUntil ?? "")).toBe(until.getTime() - 3 * HOUR_MS);
      // The bigger size waits for the first payment; the old plan's size holds until then.
      cardSavedLate();
      const paid = await chooseAndPay(gym, cora, cora, PLAN_BIG);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      const after = await consolePlan(gym, cora);
      expect(after?.status).toBe("trialing");
      expect(after?.followsPaidBy).toBe("Kd");
      expect(after?.followsPaidByYou).toBe(false);
      expect(after?.nextPlanUntil).toBeNull();
      expect(after?.handedOverBy).toBeNull();
      expect(after?.seatCap).toBe(200);
      expect(after?.nextSeatCap).toBe(500);
      expect(Date.parse(after?.currentPeriodEnd ?? "")).toBe(until.getTime());
      expect((await consolePlan(gym, gym.payer))?.followsPaidByYou).toBe(true);
    }, TEST_TIMEOUT_MS);
  });

  describe("when the old plan ends", () => {
    it("Paddle takes the first payment: the plan is the new owner's, at its full size", async () => {
      const { gym, cora, until } = await handedOverGym();
      const paid = await chooseAndPay(gym, cora, cora, PLAN_BIG);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      paddle.renew(paid.sub, until.toISOString(), "4900");
      expect(await applyPaddleSubscription(billing, paid.sub)).toBe("applied");
      const row = await rowOf(paid.sub);
      expect(row?.status).toBe("active");
      expect(row?.trial_seat_cap).toBeNull();
      const plan = await consolePlan(gym, cora);
      expect(plan?.seatCap).toBe(500);
      // The old plan's own end at Paddle changes nothing here.
      paddle.update(gym.sub, { status: "canceled", canceled_at: paddle.tick(), scheduled_change: null });
      expect(await applyPaddleSubscription(billing, gym.sub)).toBe("unchanged");
      expect(await liveRef(gym)).toBe(paid.sub);
    }, TEST_TIMEOUT_MS);

    it("the old plan kept at Paddle after the new one took its place is set to end again", async () => {
      const { gym, cora } = await handedOverGym();
      const paid = await chooseAndPay(gym, cora, cora);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      // Taken back at Paddle, outside the app.
      paddle.update(gym.sub, { scheduled_change: null });
      expect(paddle.renews(gym.sub)).toBe(true);
      await applyPaddleSubscription(billing, gym.sub);
      expect(paddle.renews(gym.sub)).toBe(false);
      expect(await liveRef(gym)).toBe(paid.sub);
    }, TEST_TIMEOUT_MS);

    it("the old plan renewed at Paddle after the new one took its place is ended, and the old owner's month refunded", async () => {
      const { gym, cora } = await handedOverGym();
      const paid = await chooseAndPay(gym, cora, cora);
      expect((await sync(gym, cora, paid.checkoutId)).state).toBe("paid");
      paddle.update(gym.sub, { scheduled_change: null });
      // Handed over a day ago; Paddle charged the old owner's card for a month starting now.
      await sql`UPDATE subscriptions SET handed_over_at = handed_over_at - interval '1 day' WHERE provider_ref = ${gym.sub}`;
      const renewal = paddle.renew(gym.sub, new Date().toISOString());
      await applyPaddleSubscription(billing, gym.sub);
      expect(paddle.cancelledSubs).toContain(gym.sub);
      expect(await sql`SELECT 1 FROM billing_refunds WHERE subscription_ref = ${gym.sub} AND transaction_ref = ${renewal}`).toHaveLength(1);
      expect(await liveRef(gym)).toBe(paid.sub);
    }, TEST_TIMEOUT_MS);

    it("a window still open when the next plan can no longer be chosen is closed, so it can't be paid", async () => {
      const { gym, cora, until } = await handedOverGym();
      const res = await choose(gym, cora);
      const window = orgCheckoutResponseSchema.parse(JSON.parse(res.body));
      // The button goes three hours before the old plan ends; so does the window.
      const cutoff = until.getTime() - 3 * HOUR_MS;
      const before = await staleTrialCheckouts(sql, new Date(cutoff - 60_000), 500, 3 * HOUR_MS);
      expect(before.map((c) => c.id)).not.toContain(window.checkoutId);
      const after = await staleTrialCheckouts(sql, new Date(cutoff + 60_000), 500, 3 * HOUR_MS);
      expect(after.map((c) => c.id)).toContain(window.checkoutId);
    }, TEST_TIMEOUT_MS);
  });

  describe("whom the reminder offers the next plan (no database)", () => {
    const KD = "11111111-1111-1111-1111-111111111111";
    const CORA = "22222222-2222-2222-2222-222222222222";
    const now = new Date("2026-11-01T00:00:00Z");
    const due = {
      endsAt: new Date("2026-11-08T00:00:00Z"),
      handedOver: true,
      handedOverConfirmed: true,
      handedOverFrom: KD,
      cancelSent: false,
      provider: "paddle" as const,
    };
    const until = new Date("2026-11-07T21:00:00Z");
    it.each([
      ["the new owner, Paddle confirmed", due, CORA, { kind: "choose_next", until }],
      ["the person who paid for it", due, KD, { kind: "choose" }],
      ["not yet confirmed at Paddle", { ...due, handedOverConfirmed: false }, CORA, { kind: "choose" }],
      ["through Razorpay (4b-vi-b)", { ...due, provider: "razorpay" as const }, CORA, { kind: "choose" }],
      ["too close to the end", { ...due, endsAt: new Date("2026-11-01T02:00:00Z") }, CORA, { kind: "choose" }],
      ["not handed over, so kept", { ...due, handedOver: false, handedOverFrom: null }, KD, { kind: "keep", until }],
    ])("%s", (_name, d, who, expected) => {
      expect(planEndAction(d, who, now)).toEqual(expected);
    });
  });

  describe("the reminder's words (no database)", () => {
    const base = {
      to: "owner@example.com",
      gymName: "Iron Den",
      orgType: "gym",
      members: 120,
      seatCap: 200,
      priceLabel: "$29",
      trialing: false,
      following: false,
      endsAt: new Date("2026-11-10T16:00:00Z"),
      timezone: "America/Chicago",
      reminder: false,
      action: { kind: "choose" } as const,
      planLink: "http://localhost:5173/console/iron-den#plan",
    };

    it("a plan handed over says the next one can be chosen now, until when, and that it starts when this one ends", () => {
      const m = planEndReminderEmail({ ...base, action: { kind: "choose_next", until: new Date("2026-11-10T13:00:00Z") } });
      expect(m.text).toContain("To keep your members on a plan, choose the next one before 7:00 am on 10 Nov. It starts when this one ends, and nothing is charged until then.");
      expect(m.text).not.toContain("Once it ends");
    });

    it("a new plan cancelled before it started says so, and that nothing is charged", () => {
      const m = planEndReminderEmail({ ...base, trialing: true, following: true });
      expect(m.text).toContain("Iron Den's new plan, up to 200 members at $29 a month, was cancelled before it started, so it ends at");
      expect(m.text).toContain("nothing is charged.");
      expect(m.text).not.toContain("free trial");
    });
  });
});
