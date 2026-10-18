// A GYM PAYING THROUGH PADDLE HANDED TO A CO-OWNER — routes against REAL Postgres
// (DATABASE_URL-gated), with a fake Paddle. ROADMAP Stage 2 item 4b-iii-a.
//
// Accept hands the gym over at once and the old owner's plan stops renewing: it stays paid to
// the end of its month, and the new owner then chooses their own plan in their own name (Kd,
// 2026-10-18, after his hand test showed one card window a Paddle plan, shared with the old
// owner's own Paddle page).
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): the
// old owner keeps being charged for a gym they gave away. "Charged" is read where Paddle would
// charge: whether the plan renews at its next date.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { endHandedOverPlans, type BillingDeps } from "../src/modules/billing/service.js";
import { FakePaddle } from "./fakePaddle.js";
import { ROLE_PRIVILEGES, myOwnerRequestResponseSchema, orgStaffResponseSchema, type OrgRole } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "paid-hand-over-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // Built at run time so no key-shaped text is in the repository.
  PADDLE_ENV: "sandbox",
  PADDLE_API_KEY: ["pdl", "sdbx", "apikey", "01" + "p".repeat(24), "PaidHandOverPaidHandOv", "Xyz"].join("_"),
  PADDLE_CLIENT_TOKEN: ["test", "3".repeat(27)].join("_"),
};

type App = Awaited<ReturnType<typeof buildApp>>;
const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const PLAN = "zz_hand_over_paddle";
const PRICE = "pri_" + "h".repeat(26);
const addr = (local: string) => `handpd-t-${local}@handpd-t.example.com`;

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
const nextIp = () => `10.69.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("a gym paying through Paddle handed to a co-owner (real Postgres)", () => {
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
  const worker = () => endHandedOverPlans(billing);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'handpd-t-%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_co_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'handpd-t-%')`;
    await sql`DELETE FROM users WHERE email LIKE 'handpd-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'handpd-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, who: User, payload?: unknown, headers: Record<string, string> = {}) =>
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
    return { userId: user.id, email, cookies: cookieMap(res) };
  };
  let count = 0;
  const person = (name: string) => signIn(addr(`${name.toLowerCase()}-${String(++count)}`), name);

  /** A gym its owner pays for through Paddle. */
  const makePaidGym = async (ownerName: string): Promise<Gym> => {
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `${ownerName}'s Gym ${String(++count)}`, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.id}`;
    const made = await paddle.createTransaction({ priceId: PRICE, customData: { gym_id: org.id } });
    if (made.kind !== "ok") throw new Error("the fake did not make a transaction");
    const sub = paddle.pay(made.value.id, "api", true, owner.email);
    const fake = paddle.subs.get(sub);
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, provider_customer_ref, current_period_end, provider_updated_at)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'paddle', ${sub}, ${fake?.customer_id ?? null},
              ${fake?.current_billing_period?.ends_at ?? null}, ${fake?.updated_at ?? null})`;
    return { id: org.id, owner, sub };
  };
  const makeStaff = async (gym: Gym, name: string, role: OrgRole = "manager"): Promise<User> => {
    const staff = await person(name);
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${staff.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
    return staff;
  };
  const makeCoOwner = (gym: Gym, name: string) => makeStaff(gym, name, "owner");

  const ask = (gym: Gym, target: User, who: User = gym.owner) => send("POST", `/v1/orgs/${gym.id}/staff/${target.userId}/owner-request`, who);
  const mineAt = async (gym: Gym, who: User) => {
    const res = await get(`/v1/orgs/${gym.id}/owner-request`, who);
    expect(res.statusCode, res.body).toBe(200);
    return myOwnerRequestResponseSchema.parse(JSON.parse(res.body)).request;
  };
  const accept = async (gym: Gym, who: User) => {
    const request = await mineAt(gym, who);
    if (request === null) throw new Error("no request is waiting");
    return await send("POST", `/v1/orgs/${gym.id}/owner-request/${request.id}/accept`, who);
  };
  const handOver = async (gym: Gym, to: User) => {
    expect((await ask(gym, to)).statusCode).toBe(201);
    const res = await accept(gym, to);
    expect(res.statusCode, res.body).toBe(200);
  };
  const ownerOf = async (gym: Gym) => (await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gym.id}`)[0]?.owner_user_id;
  const planRow = async (gym: Gym) =>
    (
      await sql<{ cancel_at_period_end: boolean; handed_over_from: string | null; handed_over_end_sent_at: Date | null }[]>`
        SELECT cancel_at_period_end, handed_over_from, handed_over_end_sent_at FROM subscriptions
        WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`
    )[0];
  /** The gym's plan as the console reads it, for this person. */
  const consolePlan = async (gym: Gym, who: User) => {
    const res = await get("/v1/orgs/mine", who);
    expect(res.statusCode, res.body).toBe(200);
    const { orgs } = JSON.parse(res.body) as { orgs: { id: string; subscription: { cancelAtPeriodEnd: boolean; handedOverBy: string | null; currentPeriodEnd: string | null } | null }[] };
    return orgs.find((o) => o.id === gym.id)?.subscription ?? null;
  };
  const staffList = async (gym: Gym, who: User) => {
    const res = await get(`/v1/orgs/${gym.id}/staff`, who);
    expect(res.statusCode, res.body).toBe(200);
    return orgStaffResponseSchema.parse(JSON.parse(res.body));
  };

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
  describe("the old owner is never charged again for a gym they gave away", () => {
    it("Accept hands the gym over at once and its plan stops renewing at Paddle, paid to the end of its month", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      // Before Accept: renewing, and the person asked is told until when it is paid.
      expect(paddle.renews(gym.sub)).toBe(true);
      const until = paddle.subs.get(gym.sub)?.current_billing_period?.ends_at ?? null;
      expect((await mineAt(gym, cora))?.paidUntil).toBe(until === null ? null : new Date(until).toISOString());

      const res = await accept(gym, cora);
      expect(res.statusCode, res.body).toBe(200);
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renews(gym.sub)).toBe(false);
      expect(paddle.endsAtPeriodEnd).toContain(gym.sub);
      const row = await planRow(gym);
      expect(row?.cancel_at_period_end).toBe(true);
      expect(row?.handed_over_from).toBe(gym.owner.userId);
      expect(row?.handed_over_end_sent_at).not.toBeNull();
      // The new owner reads that the plan was the old owner's and when it stops.
      const plan = await consolePlan(gym, cora);
      expect(plan?.handedOverBy).toBe("Kd");
      expect(plan?.cancelAtPeriodEnd).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("Paddle not answering at Accept: the gym still moves, and the worker sets the plan to end once Paddle answers", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      paddle.periodEndFailures = 2;
      await handOver(gym, cora);
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect((await planRow(gym))?.handed_over_end_sent_at).toBeNull();
      await worker();
      await worker();
      expect(paddle.renews(gym.sub)).toBe(false);
      expect((await planRow(gym))?.handed_over_end_sent_at).not.toBeNull();
    }, TEST_TIMEOUT_MS);

    it("a plan kept again at Paddle after the hand-over is set to end again", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      expect(paddle.renews(gym.sub)).toBe(false);
      // The old owner keeps it on a Paddle page opened earlier; Paddle's event reaches the row.
      paddle.update(gym.sub, { scheduled_change: null });
      await sql`UPDATE subscriptions SET cancel_at_period_end = false WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect(paddle.renews(gym.sub)).toBe(true);
      expect(await worker()).toBeGreaterThanOrEqual(1);
      expect(paddle.renews(gym.sub)).toBe(false);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("nobody opens Paddle's page for a handed-over plan or changes its size: it is the old owner's account and card", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      for (const who of [cora, gym.owner]) {
        const portal = await send("POST", `/v1/orgs/${gym.id}/billing/portal`, who);
        expect(portal.statusCode, portal.body).toBe(409);
        expect(errorOf(portal)).toBe("handed_over_plan");
      }
      expect(paddle.portalCalls.filter((c) => c.subscriptionIds.includes(gym.sub))).toHaveLength(0);
      const size = await send("POST", `/v1/orgs/${gym.id}/billing/size/preview`, cora, { planCode: PLAN });
      expect(size.statusCode).toBe(409);
      expect(errorOf(size)).toBe("plan_ending");
    }, TEST_TIMEOUT_MS);

    it("once the old plan has ended, the new owner chooses a plan in Paddle's window filled in with their own email", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      await sql`UPDATE subscriptions SET status = 'expired', ended_at = now() WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const res = await send("POST", `/v1/orgs/${gym.id}/billing/checkout`, cora, { planCode: PLAN }, { "idempotency-key": `k-${gym.id}` });
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as { email: string | null }).email).toBe(cora.email);
    }, TEST_TIMEOUT_MS);
  });

  describe("the plan's state", () => {
    it("money owed or a Razorpay plan stops a hand-over, and the Staff tab says why and until when a Paddle plan is paid", async () => {
      const overdue = await makePaidGym("Kd");
      const a = await makeCoOwner(overdue, "Ada");
      await sql`UPDATE subscriptions SET status = 'past_due', past_due_since = now() WHERE owner_type = 'gym' AND owner_id = ${overdue.id}`;
      const r1 = await ask(overdue, a);
      expect(r1.statusCode).toBe(409);
      expect(errorOf(r1)).toBe("plan_overdue");
      const tab = await staffList(overdue, overdue.owner);
      expect(tab.paidPlan).toBe(true);
      expect(tab.paidPlanNote).toBe("A payment is overdue, so the owner can't be changed until it's paid.");

      await sql`UPDATE subscriptions SET status = 'expired', ended_at = now(), cancel_reason = 'grace_expired' WHERE owner_type = 'gym' AND owner_id = ${overdue.id}`;
      expect(errorOf(await ask(overdue, a))).toBe("plan_overdue");

      const rupees = await makePaidGym("Kd");
      const c = await makeCoOwner(rupees, "Cy");
      await sql`UPDATE subscriptions SET provider = 'razorpay' WHERE owner_type = 'gym' AND owner_id = ${rupees.id}`;
      expect(errorOf(await ask(rupees, c))).toBe("paid_plan");

      const fine = await makePaidGym("Kd");
      const tabFine = await staffList(fine, fine.owner);
      expect(tabFine.paidPlan).toBe(false);
      expect(tabFine.paidPlanNote).toBeNull();
      expect(tabFine.paidUntil).not.toBeNull();
    }, TEST_TIMEOUT_MS);

    it("a plan already set to end is handed over and stays set to end", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await paddle.cancelAtPeriodEnd(gym.sub);
      await sql`UPDATE subscriptions SET cancel_at_period_end = true WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await handOver(gym, cora);
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renews(gym.sub)).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("a plan that goes past due between Send and Accept is not handed over", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      await sql`UPDATE subscriptions SET status = 'past_due', past_due_since = now() WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const res = await accept(gym, cora);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("plan_overdue");
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(paddle.renews(gym.sub)).toBe(true);
    }, TEST_TIMEOUT_MS);
  });
});
