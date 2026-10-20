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
import { applyPaddleSubscription, endHandedOverPlans, endExpiredGraces, type BillingDeps } from "../src/modules/billing/service.js";
import { processPaddleEvents } from "../src/modules/billing/events.js";
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
/** A bigger size, for a size change pressed as the co-owner accepts. */
const BIG = "zz_hand_over_paddle_big";
const BIG_PRICE = "pri_" + "j".repeat(26);
const addr = (local: string) => `handpd-t-${local}@handpd-t.example.com`;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const paddle = new FakePaddle({ [PRICE]: { amount: "2900", currency: "USD" }, [BIG_PRICE]: { amount: "5900", currency: "USD" } });
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
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM billing_plan_changes WHERE gym_id IN (${mine()})`;
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
    await sql`DELETE FROM plans WHERE code IN (${PLAN}, ${BIG})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'paddle' AND event_id LIKE 'hand_back:%'`;
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
    const monthStart = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const monthEnd = new Date(Date.now() + 20 * DAY_MS).toISOString();
    paddle.update(sub, { current_billing_period: { starts_at: monthStart, ends_at: monthEnd }, next_billed_at: monthEnd });
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
  const planRowRef = async (gym: Gym) =>
    (await sql<{ provider_customer_ref: string }[]>`SELECT provider_customer_ref FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`)[0] ?? { provider_customer_ref: "" };
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
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements, paddle_price_id)
      VALUES (${BIG}, 'org', ${"plan." + BIG}, 5900, 'USD', 'month', 400, 0, 20, '{}'::jsonb, '{}'::jsonb, ${BIG_PRICE})
      ON CONFLICT (code) DO UPDATE SET active = true, paddle_price_id = ${BIG_PRICE}`;
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
      expect((await mineAt(gym, cora))?.planStops).toEqual({ until: until === null ? null : new Date(until).toISOString(), trial: false });

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
      paddle.update(gym.sub, { scheduled_change: null, next_billed_at: paddle.subs.get(gym.sub)?.current_billing_period?.ends_at ?? null });
      expect(await applyPaddleSubscription(billing, gym.sub)).toBe("applied");
      expect((await planRow(gym))?.cancel_at_period_end).toBe(false);
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
      await sql`UPDATE subscriptions SET cancel_at_period_end = false WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
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

  // Round one of the rework (reviews/4b-iii-a-8 and -8b): each ran red on the code before its fix.
  describe("round one", () => {
    it("a month Paddle took after the hand-over ends the plan at once and is owed back to the old owner", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      paddle.periodEndFailures = 1;
      await handOver(gym, cora);
      // Paddle renewed before it was told: the next month, on the old owner's card.
      const renewal = paddle.renew(gym.sub, new Date(Date.now() + 5 * 60 * 1000).toISOString());
      await worker();
      expect(paddle.cancelledSubs).toContain(gym.sub);
      const owed = await sql<{ transaction_ref: string }[]>`SELECT transaction_ref FROM billing_refunds WHERE gym_id = ${gym.id}`;
      expect(owed.map((r) => r.transaction_ref)).toEqual([renewal]);
      const row = await sql<{ status: string }[]>`SELECT status FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`;
      expect(row[0]?.status).toBe("expired");
      expect(await ownerOf(gym)).toBe(cora.userId);
    }, TEST_TIMEOUT_MS);

    it("a payment failing on the old owner's card after the hand-over ends the plan at once, nothing owed back", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      paddle.periodEndFailures = 1;
      await handOver(gym, cora);
      paddle.update(gym.sub, { status: "past_due" });
      await sql`UPDATE subscriptions SET status = 'past_due', past_due_since = now() WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await worker();
      expect(paddle.cancelledSubs).toContain(gym.sub);
      expect((await sql`SELECT 1 FROM billing_refunds WHERE gym_id = ${gym.id}`).length).toBe(0);
      // The new owner can choose their own plan, and never opens the old owner's account.
      const portal = await send("POST", `/v1/orgs/${gym.id}/billing/portal`, cora);
      expect(portal.statusCode).not.toBe(200);
      const res = await send("POST", `/v1/orgs/${gym.id}/billing/checkout`, cora, { planCode: PLAN }, { "idempotency-key": `pd-${gym.id}` });
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as { email: string | null }).email).toBe(cora.email);
    }, TEST_TIMEOUT_MS);

    it("a handed-over plan whose grace ran out never opens the old owner's Paddle page, and is ended at Paddle", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      // Past due and its grace over before the worker reached it (Paddle not answering meanwhile).
      paddle.update(gym.sub, { status: "past_due" });
      await sql`UPDATE subscriptions SET status = 'past_due', past_due_since = now() - interval '5 days' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await endExpiredGraces(billing);
      const portal = await send("POST", `/v1/orgs/${gym.id}/billing/portal`, cora);
      expect(portal.statusCode).toBe(409);
      expect(errorOf(portal)).toBe("handed_over_plan");
      expect(paddle.portalCalls.filter((c) => c.subscriptionIds.includes(gym.sub))).toHaveLength(0);
      await worker();
      expect(paddle.cancelledSubs).toContain(gym.sub);
      const res = await send("POST", `/v1/orgs/${gym.id}/billing/checkout`, cora, { planCode: PLAN }, { "idempotency-key": `ge-${gym.id}` });
      expect(res.statusCode, res.body).toBe(200);
    }, TEST_TIMEOUT_MS);

    it("handed back to the person who pays, the plan is theirs again: their name, their Paddle page, no 'you won't be charged' to the other", async () => {
      const gym = await makePaidGym("Ann");
      const bob = await makeCoOwner(gym, "Bob");
      await handOver(gym, bob);
      // Bob's box: Bob never paid, so nothing tells him he won't be charged.
      expect((await staffList({ ...gym, owner: bob }, bob)).planStops).toBeNull();
      expect((await ask({ ...gym, owner: bob }, gym.owner, bob)).statusCode).toBe(201);
      expect((await mineAt(gym, gym.owner))?.planStops).toBeNull();
      const back = await accept(gym, gym.owner);
      expect(back.statusCode, back.body).toBe(200);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      const row = await planRow(gym);
      expect(row?.handed_over_from).toBeNull();
      expect((await consolePlan(gym, gym.owner))?.handedOverBy).toBeNull();
      expect((await send("POST", `/v1/orgs/${gym.id}/billing/portal`, gym.owner)).statusCode).toBe(200);
    }, TEST_TIMEOUT_MS);

    it("handed on again, the plan stays the first payer's", async () => {
      const gym = await makePaidGym("Ann");
      const bob = await makeCoOwner(gym, "Bob");
      const cy = await makeCoOwner(gym, "Cy");
      await handOver(gym, bob);
      const asBob = { ...gym, owner: bob };
      expect((await ask(asBob, cy, bob)).statusCode).toBe(201);
      expect((await accept(gym, cy)).statusCode).toBe(200);
      expect((await planRow(gym))?.handed_over_from).toBe(gym.owner.userId);
      expect((await consolePlan(gym, cy))?.handedOverBy).toBe("Ann");
    }, TEST_TIMEOUT_MS);

    it("the old owner still opens Paddle's page for their other gym after they leave the one handed over", async () => {
      const gym = await makePaidGym("Ann");
      const bob = await makeCoOwner(gym, "Bob");
      // Ann's second gym, paid by the same Paddle customer.
      const res = await send("POST", "/v1/orgs", gym.owner, { trainsHere: false, name: `Ann's Second ${String(Date.now())}`, city: "Austin", country: "US", timezone: "America/Chicago" });
      expect(res.statusCode, res.body).toBe(201);
      const second = (JSON.parse(res.body) as { org: { id: string } }).org.id;
      const payer = (await planRowRef(gym)).provider_customer_ref;
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${second}`;
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, provider_customer_ref, current_period_end)
        VALUES ('gym', ${second}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'paddle', ${"sub_" + "s".repeat(22) + String(count++).padStart(4, "0")}, ${payer}, now() + interval '20 days')`;
      await handOver(gym, bob);
      const removed = await send("DELETE", `/v1/orgs/${gym.id}/staff/${gym.owner.userId}`, bob);
      expect(removed.statusCode, removed.body).toBe(200);
      const portal = await send("POST", `/v1/orgs/${second}/billing/portal`, gym.owner);
      expect(portal.statusCode, portal.body).toBe(200);
      // Re-check F1: a billing manager of the second gym alone still does not open Ann's whole
      // account, which shows the gym she gave away.
      const mo = await makeStaff({ id: second, owner: gym.owner, sub: "" }, "Mo");
      await sql`UPDATE gym_staff SET privileges = array_append(privileges, 'billing.manage') WHERE gym_id = ${second} AND user_id = ${mo.userId} AND NOT ('billing.manage' = ANY(privileges))`;
      const moPortal = await send("POST", `/v1/orgs/${second}/billing/portal`, mo);
      expect(moPortal.statusCode, moPortal.body).toBe(409);
      expect(errorOf(moPortal)).toBe("shared_payer");
    }, TEST_TIMEOUT_MS);

    it("handed back before Paddle heard, the payer's plan reads as Paddle has it: renewing, not ending (re-check F2)", async () => {
      const gym = await makePaidGym("Ann");
      const bob = await makeCoOwner(gym, "Bob");
      paddle.periodEndFailures = 1;
      await handOver(gym, bob);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect((await ask({ ...gym, owner: bob }, gym.owner, bob)).statusCode).toBe(201);
      expect((await accept(gym, gym.owner)).statusCode).toBe(200);
      expect(paddle.renews(gym.sub)).toBe(true);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(false);
      expect((await consolePlan(gym, gym.owner))?.cancelAtPeriodEnd).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("handed back while Paddle is down, after it had set the plan to end, the worker reads it again (confirm's Low)", async () => {
      const gym = await makePaidGym("Ann");
      const bob = await makeCoOwner(gym, "Bob");
      await handOver(gym, bob);
      expect(paddle.renews(gym.sub)).toBe(false);
      // The answer to the first Accept was lost: Paddle has it ending, the row never heard.
      await sql`UPDATE subscriptions SET handed_over_end_sent_at = NULL WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect((await ask({ ...gym, owner: bob }, gym.owner, bob)).statusCode).toBe(201);
      paddle.down = true;
      try {
        expect((await accept(gym, gym.owner)).statusCode).toBe(200);
      } finally {
        paddle.down = false;
      }
      expect((await planRow(gym))?.cancel_at_period_end).toBe(false);
      await processPaddleEvents(billing);
      expect((await planRow(gym))?.cancel_at_period_end).toBe(true);
      expect((await consolePlan(gym, gym.owner))?.cancelAtPeriodEnd).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a plan Paddle already ended, its event lost, is written onto the row, and the new owner can subscribe (re-check F3)", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await handOver(gym, cora);
      paddle.update(gym.sub, { status: "canceled", canceled_at: new Date().toISOString() });
      await sql`
        UPDATE subscriptions SET status = 'expired', ended_at = now(), past_due_since = now() - interval '5 days', cancel_reason = 'grace_expired'
        WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await worker();
      const row = await sql<{ cancel_reason: string | null }[]>`SELECT cancel_reason FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`;
      expect(row[0]?.cancel_reason).toBeNull();
      const res = await send("POST", `/v1/orgs/${gym.id}/billing/checkout`, cora, { planCode: PLAN }, { "idempotency-key": `f3-${gym.id}` });
      expect(res.statusCode, res.body).toBe(200);
    }, TEST_TIMEOUT_MS);

    it("a paid trial set to end that runs past the gym's own trial still ends at once (re-check, second review)", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      const trialEnd = new Date(Date.now() + 3 * DAY_MS).toISOString();
      paddle.update(gym.sub, { status: "trialing", next_billed_at: trialEnd, current_billing_period: { starts_at: new Date(Date.now() - 5 * DAY_MS).toISOString(), ends_at: trialEnd } });
      await sql`UPDATE subscriptions SET status = 'trialing', trial_ends_at = ${trialEnd}, current_period_end = ${trialEnd} WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await handOver(gym, cora);
      // The gym's own free trial ended an hour ago; the row has not yet heard the plan is set to end.
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at, ended_at, cancel_reason)
        VALUES ('gym', ${gym.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'expired', 'none', now() - interval '1 hour', now() - interval '1 hour', 'trial_subscribed')`;
      await sql`UPDATE subscriptions SET cancel_at_period_end = false WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider = 'paddle'`;
      await applyPaddleSubscription(billing, gym.sub);
      expect(paddle.cancelledSubs).toContain(gym.sub);
      expect(paddle.activations).not.toContain(gym.sub);
    }, TEST_TIMEOUT_MS);

    it("a smaller size waiting is dropped with the hand-over: the plan has no next month", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await sql`
        UPDATE subscriptions SET pending_plan_id = plan_id, pending_from = current_period_end
        WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await handOver(gym, cora);
      const pending = await sql<{ pending_plan_id: string | null }[]>`SELECT pending_plan_id FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`;
      expect(pending[0]?.pending_plan_id).toBeNull();
    }, TEST_TIMEOUT_MS);

    it("a paid trial handed over is set to end and never charged early", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      const trialEnd = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      paddle.update(gym.sub, { status: "trialing", next_billed_at: trialEnd, current_billing_period: { starts_at: new Date(Date.now() - 5 * DAY_MS).toISOString(), ends_at: trialEnd } });
      await sql`UPDATE subscriptions SET status = 'trialing', trial_ends_at = now() + interval '20 minutes', current_period_end = now() + interval '2 days' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await handOver(gym, cora);
      // The gym's own free trial ends within the hour; Paddle answers the plan set to end with no
      // date; and the row has not yet heard it is set to end, so Paddle's record is applied.
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at, ended_at, cancel_reason)
        VALUES ('gym', ${gym.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'expired', 'none', now() + interval '20 minutes', now(), 'trial_subscribed')`;
      await sql`UPDATE subscriptions SET cancel_at_period_end = false WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider = 'paddle'`;
      expect(await applyPaddleSubscription(billing, gym.sub)).toBe("applied");
      expect(paddle.activations).not.toContain(gym.sub);
      expect(paddle.cancelledSubs).not.toContain(gym.sub);
      expect(paddle.charges.filter((c) => c.subscriptionId === gym.sub)).toHaveLength(0);
    }, TEST_TIMEOUT_MS);

    it("Accept waits while the plan renews within the hour; the request still waits", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      await sql`UPDATE subscriptions SET current_period_end = now() + interval '20 minutes' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const res = await accept(gym, cora);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("plan_renewing");
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await mineAt(gym, cora)).not.toBeNull();
    }, TEST_TIMEOUT_MS);

    it("two plans at once are not handed over, with a sentence that names no payment company", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      await sql`UPDATE subscriptions SET provider_ref = NULL WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const res = await ask(gym, cora);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("plan_unclear");
    }, TEST_TIMEOUT_MS);
  });

  describe("the plan's state", () => {
    it("money owed stops a hand-over, and the Staff tab says why and until when a Paddle plan is paid", async () => {
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

      const fine = await makePaidGym("Kd");
      const tabFine = await staffList(fine, fine.owner);
      expect(tabFine.paidPlan).toBe(false);
      expect(tabFine.paidPlanNote).toBeNull();
      expect(tabFine.planStops?.until).not.toBeNull();
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

  // ── 4b's two extra passes (`handoff/2026-10-20-4b-v.md`) ─────────────────────────────────
  describe("the two extra passes", () => {
    it("a bigger size pressed as the co-owner accepts is made first: Accept waits, and the old owner is charged for their own gym only", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      // Accept lands after the size change has checked the plan and before Paddle is asked.
      const seen: { during: Awaited<ReturnType<typeof accept>> | null } = { during: null };
      paddle.duringNextChange = async () => {
        seen.during = await accept(gym, cora);
      };
      const size = await send("POST", `/v1/orgs/${gym.id}/billing/size`, gym.owner, { planCode: BIG }, { "idempotency-key": `big-${gym.id}` });
      expect(size.statusCode, size.body).toBe(200);
      const during = seen.during;
      if (during === null) throw new Error("Accept never ran inside the size change");
      expect(during.statusCode, during.body).toBe(409);
      expect(errorOf(during)).toBe("plan_changing");
      // The charge was made while the gym was still Kd's.
      expect(paddle.charges.filter((c) => c.subscriptionId === gym.sub)).toHaveLength(1);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await mineAt(gym, cora)).not.toBeNull();

      // Once the size is made, Accept hands the gym over, and the plan stops renewing.
      expect((await accept(gym, cora)).statusCode).toBe(200);
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renews(gym.sub)).toBe(false);
      const again = await send("POST", `/v1/orgs/${gym.id}/billing/size`, cora, { planCode: PLAN }, { "idempotency-key": `small-${gym.id}` });
      expect(again.statusCode).toBe(409);
      expect(paddle.charges.filter((c) => c.subscriptionId === gym.sub)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);
  });
});
