// KEEP MY PLAN FOR A PADDLE PLAN SET TO END — routes against REAL Postgres (DATABASE_URL-gated),
// with a fake Paddle. ROADMAP Stage 3 item 1g.
//
// A Paddle plan cancelled on Paddle's own page is kept from the Plan box, as a Razorpay plan
// is: the server takes the cancel back at Paddle, until a few hours before the plan ends.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a
// plan handed over with its gym kept, so the old owner is charged for a gym they gave away.
// "Charged" is read where Paddle would charge: whether the plan renews at its next date.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { applyPaddleSubscription, endHandedOverPlan, type BillingDeps } from "../src/modules/billing/service.js";
import { handedOverPlansToEnd } from "../src/modules/billing/repo.js";
import { FakePaddle } from "./fakePaddle.js";
import { ROLE_PRIVILEGES, myOwnerRequestResponseSchema, orgPlanCancelResponseSchema, type OrgRole } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "paddle-keep-plan-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // Built at run time so no key-shaped text is in the repository.
  PADDLE_ENV: "sandbox",
  PADDLE_API_KEY: ["pdl", "sdbx", "apikey", "01" + "k".repeat(24), "PaddleKeepPlanPaddleKe", "Xyz"].join("_"),
  PADDLE_CLIENT_TOKEN: ["test", "4".repeat(27)].join("_"),
};

type App = Awaited<ReturnType<typeof buildApp>>;
const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const PLAN = "zz_keep_paddle";
const PRICE = "pri_" + "q".repeat(26);
const addr = (local: string) => `keeppd-t-${local}@keeppd-t.example.com`;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}
interface Gym {
  id: string;
  owner: User;
  /** The plan's Paddle subscription. */
  sub: string;
}

let ipCounter = 0;
const nextIp = () => `10.71.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("Keep my plan for a Paddle plan set to end (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const paddle = new FakePaddle({ [PRICE]: { amount: "2900", currency: "USD" } });
  const billing: BillingDeps = {
    sql,
    redis: createMemoryRedis(),
    paddle: { api: paddle, environment: "sandbox", clientToken: baseEnv.PADDLE_CLIENT_TOKEN },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    now: () => new Date(),
  };
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'keeppd-t-%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_co_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_plan_changes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'keeppd-t-%')`;
    await sql`DELETE FROM users WHERE email LIKE 'keeppd-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'keeppd-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, who: User, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: who.cookies,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload ?? {}),
    });
  const get = (path: string, who: User) => api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies: who.cookies });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const keep = (gym: Gym, who: User) => api().inject({ method: "DELETE", url: `/v1/orgs/${gym.id}/billing/cancel`, remoteAddress: nextIp(), cookies: who.cookies });

  const signIn = async (email: string, displayName: string): Promise<User> => {
    const sent = await api().inject({ method: "POST", url: "/v1/auth/code/send", remoteAddress: nextIp(), payload: { email } });
    expect(sent.statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await api().inject({ method: "POST", url: "/v1/auth/code/verify", remoteAddress: nextIp(), payload: { email, code } });
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${user.id}`;
    return { userId: user.id, email, cookies: cookieMap(res) };
  };
  let count = 0;
  const person = (name: string) => signIn(addr(`${name.toLowerCase()}-${String(++count)}`), name);

  /** A gym its owner pays for through Paddle, its month ending `endsInMs` from now. */
  const makePaidGym = async (ownerName: string, endsInMs = 20 * DAY_MS): Promise<Gym> => {
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `${ownerName}'s Gym ${String(++count)}`, city: "Austin", country: "US", timezone: "America/Chicago" });
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
    return { id: org.id, owner, sub };
  };
  /** Cancelled on Paddle's own page: Paddle's event brings it to the row. */
  const cancelAtPaddle = async (gym: Gym) => {
    expect((await paddle.cancelAtPeriodEnd(gym.sub)).kind).toBe("ok");
    expect(await applyPaddleSubscription(billing, gym.sub)).toBe("applied");
    expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
  };
  const makeStaff = async (gym: Gym, name: string, role: OrgRole = "manager"): Promise<User> => {
    const staff = await person(name);
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${staff.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
    return staff;
  };
  const makeCoOwner = (gym: Gym, name: string) => makeStaff(gym, name, "owner");

  const handOver = async (gym: Gym, to: User) => {
    expect((await send("POST", `/v1/orgs/${gym.id}/staff/${to.userId}/owner-request`, gym.owner)).statusCode).toBe(201);
    const mineRes = await get(`/v1/orgs/${gym.id}/owner-request`, to);
    const request = myOwnerRequestResponseSchema.parse(JSON.parse(mineRes.body)).request;
    if (request === null) throw new Error("no request is waiting");
    const res = await send("POST", `/v1/orgs/${gym.id}/owner-request/${request.id}/accept`, to);
    expect(res.statusCode, res.body).toBe(200);
  };
  const planRow = async (gym: Gym) =>
    (
      await sql<{ cancel_at_period_end: boolean; handed_over_at: Date | null; handed_over_end_sent_at: Date | null }[]>`
        SELECT cancel_at_period_end, handed_over_at, handed_over_end_sent_at FROM subscriptions
        WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`
    )[0];
  const keptAudits = async (gym: Gym) =>
    (await sql<{ meta: { provider?: string } }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'billing.cancel_withdrawn'`).map((r) => r.meta.provider);
  /** The gym's plan as the console reads it, for this person. */
  const consolePlan = async (gym: Gym, who: User) => {
    const res = await get("/v1/orgs/mine", who);
    expect(res.statusCode, res.body).toBe(200);
    const { orgs } = JSON.parse(res.body) as { orgs: { id: string; subscription: { cancelAtPeriodEnd: boolean; keepUntil: string | null; currentPeriodEnd: string | null } | null }[] };
    return orgs.find((o) => o.id === gym.id)?.subscription ?? null;
  };
  /** The worker's step for THIS gym only: its sweep over every gym would reach other test files' rows, which this file's fake Paddle has never heard of. */
  const worker = async (gym: Gym) => {
    const at = (await planRow(gym))?.handed_over_at;
    if (at == null) throw new Error("not handed over");
    return await endHandedOverPlan(billing, { gymId: gym.id, subscriptionRef: gym.sub, handedOverAt: at });
  };
  const removed = (gym: Gym) => paddle.cancelsRemoved.filter((s) => s === gym.sub).length;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements, paddle_price_id)
      VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 2900, 'USD', 'month', 200, 0, 10, '{}'::jsonb, '{}'::jsonb, ${PRICE})
      ON CONFLICT (code) DO UPDATE SET active = true, paddle_price_id = ${PRICE}`;
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
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  // ── The worst thing: the old owner charged for a gym they gave away ──────────────────────
  describe("a plan handed over with its gym is never kept", () => {
    it("neither the new owner nor the old one keeps it, and Paddle is never asked", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await cancelAtPaddle(gym);
      await handOver(gym, cora);
      expect(paddle.renews(gym.sub)).toBe(false);
      // Nothing to press: the plan box is given no time to keep it until.
      expect((await consolePlan(gym, cora))?.keepUntil).toBeNull();
      for (const who of [cora, gym.owner]) {
        const res = await keep(gym, who);
        // The old owner, whatever they are now at the gym, is refused too.
        expect([403, 404, 409], res.body).toContain(res.statusCode);
        if (who === cora) expect(errorOf(res)).toBe("handed_over_plan");
      }
      expect(removed(gym)).toBe(0);
      expect(paddle.renews(gym.sub)).toBe(false);
      expect(await keptAudits(gym)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("handed over at the instant Paddle is asked: the plan is set to end again, and the press is refused", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await cancelAtPaddle(gym);
      paddle.duringNextRemoveCancel = () => handOver(gym, cora);
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("handed_over_plan");
      // Paddle did take the cancel back, after Accept had set it to end; it is set to end again.
      expect(removed(gym)).toBe(1);
      expect(paddle.renews(gym.sub)).toBe(false);
      const row = await planRow(gym);
      expect(row?.cancel_at_period_end).toBe(true);
      expect(row?.handed_over_end_sent_at).not.toBeNull();
      expect(await keptAudits(gym)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("handed over at that instant with Paddle then down: the worker sets it to end once Paddle answers", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await cancelAtPaddle(gym);
      paddle.duringNextRemoveCancel = async () => {
        await handOver(gym, cora);
        paddle.periodEndFailures = 1;
      };
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect((await planRow(gym))?.handed_over_end_sent_at).toBeNull();
      expect(await worker(gym)).toBe(true);
      expect(paddle.renews(gym.sub)).toBe(false);
      expect((await planRow(gym))?.handed_over_end_sent_at).not.toBeNull();
    }, TEST_TIMEOUT_MS);
  });

  describe("keeping a plan set to end", () => {
    it("the owner keeps it: Paddle renews it again, the plan box reads it renewing, and it is written down once", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      const before = await consolePlan(gym, gym.owner);
      const end = Date.parse(before?.currentPeriodEnd ?? "");
      // Kept until three hours before it ends, as a Razorpay plan is.
      expect(Date.parse(before?.keepUntil ?? "")).toBe(end - 3 * HOUR_MS);

      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(200);
      const body = orgPlanCancelResponseSchema.parse(JSON.parse(res.body));
      expect(body.subscription?.cancelAtPeriodEnd).toBe(false);
      expect(body.subscription?.keepUntil).toBeNull();
      expect(paddle.renews(gym.sub)).toBe(true);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(false);
      expect(await keptAudits(gym)).toEqual(["paddle"]);

      // A second press finds it renewing: nothing more is asked of Paddle or written.
      const again = await keep(gym, gym.owner);
      expect(again.statusCode, again.body).toBe(200);
      expect(removed(gym)).toBe(1);
      expect(await keptAudits(gym)).toEqual(["paddle"]);
    }, TEST_TIMEOUT_MS);

    it("two presses at once: Paddle's plan renews and it is written down once", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      const [a, b] = await Promise.all([keep(gym, gym.owner), keep(gym, gym.owner)]);
      expect(a.statusCode, a.body).toBe(200);
      expect(b.statusCode, b.body).toBe(200);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect(await keptAudits(gym)).toEqual(["paddle"]);
    }, TEST_TIMEOUT_MS);

    it("a co-owner keeps it; a manager is refused, and a stranger finds no gym", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      const max = await makeStaff(gym, "Max", "manager");
      const stranger = await makePaidGym("Sam");
      await cancelAtPaddle(gym);
      const refused = await keep(gym, max);
      expect(refused.statusCode, refused.body).toBe(403);
      const lost = await keep(gym, stranger.owner);
      expect(lost.statusCode, lost.body).toBe(404);
      expect(removed(gym)).toBe(0);
      expect(paddle.renews(gym.sub)).toBe(false);
      const res = await keep(gym, cora);
      expect(res.statusCode, res.body).toBe(200);
      expect(paddle.renews(gym.sub)).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a gym id that is not one is refused before anything is read", async () => {
      const gym = await makePaidGym("Kd");
      const res = await api().inject({ method: "DELETE", url: "/v1/orgs/not-a-gym/billing/cancel", remoteAddress: nextIp(), cookies: gym.owner.cookies });
      expect(res.statusCode, res.body).toBe(400);
    }, TEST_TIMEOUT_MS);

    it("Paddle down: a plain sentence, the plan still ends, and the next press keeps it", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      paddle.removeCancelFailures = 1;
      paddle.down = true;
      const res = await keep(gym, gym.owner);
      paddle.down = false;
      expect(res.statusCode, res.body).toBe(503);
      expect((JSON.parse(res.body) as { message: string }).message).toBe("Paddle couldn't be reached to keep your plan. Please try again in a moment.");
      expect(paddle.renews(gym.sub)).toBe(false);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
      expect(await keptAudits(gym)).toEqual([]);
      const again = await keep(gym, gym.owner);
      expect(again.statusCode, again.body).toBe(200);
      expect(paddle.renews(gym.sub)).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("Paddle keeps it but its answer is lost: Paddle's own record decides, and the plan reads kept", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      paddle.loseRemoveCancelAnswer = true;
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(200);
      expect(orgPlanCancelResponseSchema.parse(JSON.parse(res.body)).subscription?.cancelAtPeriodEnd).toBe(false);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect(await keptAudits(gym)).toEqual(["paddle"]);
    }, TEST_TIMEOUT_MS);

    it("within three hours of its end it is too late, and Paddle is not asked", async () => {
      const gym = await makePaidGym("Kd", 2 * HOUR_MS);
      await cancelAtPaddle(gym);
      // The plan box draws Keep my plan only before this time, which has passed.
      expect(Date.parse((await consolePlan(gym, gym.owner))?.keepUntil ?? "")).toBeLessThan(Date.now());
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("too_late");
      expect((JSON.parse(res.body) as { message: string }).message).toMatch(/^Your plan ends on .+, and it's too close to then to keep it\. You can choose a plan again once it ends\.$/);
      expect(removed(gym)).toBe(0);
      expect(paddle.renews(gym.sub)).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("a plan that renews is left as it is, and Paddle is not asked", async () => {
      const gym = await makePaidGym("Kd");
      expect((await consolePlan(gym, gym.owner))?.keepUntil).toBeNull();
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(200);
      expect(removed(gym)).toBe(0);
      expect(paddle.renews(gym.sub)).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a payment owed is paid from Update payment method, not kept here", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      await sql`UPDATE subscriptions SET status = 'past_due' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("plan_past_due");
      expect(removed(gym)).toBe(0);
    }, TEST_TIMEOUT_MS);
  });

  // ── Round one (`reviews/1g-2-findings.md`) ─────────────────────────────────────────────────
  describe("round one", () => {
    it("Paddle refuses: a true sentence, never 'couldn't be reached', and nothing written as kept", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      paddle.refuseNextRemoveCancel = true;
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("keep_refused");
      expect((JSON.parse(res.body) as { message: string }).message).toBe("Paddle wouldn't keep this plan. Press Manage payment to see it on Paddle's page.");
      expect(paddle.renews(gym.sub)).toBe(false);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
      expect(await keptAudits(gym)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("already ended at Paddle, its event not yet here: says so, the row reads it ended, nothing written as kept", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      paddle.update(gym.sub, { status: "canceled", scheduled_change: null });
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("plan_ended");
      expect((JSON.parse(res.body) as { message: string }).message).toBe("Your plan has already ended, so it can't be kept. You can choose a new plan.");
      const rows = await sql<{ status: string }[]>`SELECT status FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`;
      expect(rows[0]?.status).not.toBe("active");
      expect(await keptAudits(gym)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("Paddle has no record of the plan: says so, never 'couldn't be reached', and nothing written as kept", async () => {
      const gym = await makePaidGym("Kd");
      await cancelAtPaddle(gym);
      paddle.subs.delete(gym.sub);
      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("plan_not_at_paddle");
      expect((JSON.parse(res.body) as { message: string }).message).toBe("Paddle has no record of this plan, so it can't be kept. You can choose a plan again once it ends.");
      expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
      expect(await keptAudits(gym)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("handed over mid-press and the server dies before it settles: Paddle's event and the worker set it to end", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await cancelAtPaddle(gym);
      paddle.duringNextRemoveCancel = () => handOver(gym, cora);
      // Paddle takes the cancel back; nothing after it runs.
      expect((await paddle.removeScheduledCancel(gym.sub)).kind).toBe("ok");
      expect(paddle.renews(gym.sub)).toBe(true);
      // Before Paddle's event the worker has nothing to do: the row still reads it ending.
      const due = async () => (await handedOverPlansToEnd(sql, 100_000)).some((p) => p.gymId === gym.id);
      expect(await due()).toBe(false);
      // Paddle's event writes it renewing, and the worker's list picks it up again.
      expect(await applyPaddleSubscription(billing, gym.sub)).toBe("applied");
      expect(await due()).toBe(true);
      expect(await worker(gym)).toBe(true);
      expect(paddle.renews(gym.sub)).toBe(false);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
      expect(await due()).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("a paid trial set to end is kept: it is charged when the gym's own trial ends, never moved, charged early or cancelled", async () => {
      const gym = await makePaidGym("Kd");
      const trialEnd = new Date(Date.now() + 3 * DAY_MS).toISOString();
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at, ended_at, cancel_reason)
        VALUES ('gym', ${gym.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'expired', 'none', ${trialEnd}, now(), 'trial_subscribed')`;
      paddle.update(gym.sub, { status: "trialing", next_billed_at: trialEnd, current_billing_period: { starts_at: new Date(Date.now() - 5 * DAY_MS).toISOString(), ends_at: trialEnd } });
      await sql`UPDATE subscriptions SET status = 'trialing', trial_ends_at = ${trialEnd}, current_period_end = ${trialEnd} WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider = 'paddle'`;
      await cancelAtPaddle(gym);
      expect((await consolePlan(gym, gym.owner))?.keepUntil).not.toBeNull();

      const res = await keep(gym, gym.owner);
      expect(res.statusCode, res.body).toBe(200);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect(paddle.subs.get(gym.sub)?.next_billed_at).toBe(trialEnd);
      expect(paddle.trialMoves.filter((m) => m.subscriptionId === gym.sub)).toEqual([]);
      expect(paddle.activations).not.toContain(gym.sub);
      expect(paddle.cancelledSubs).not.toContain(gym.sub);
      expect(await keptAudits(gym)).toEqual(["paddle"]);
    }, TEST_TIMEOUT_MS);
  });
});
