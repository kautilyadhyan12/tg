// A GYM PAYING THROUGH PADDLE HANDED TO A CO-OWNER — routes against REAL Postgres
// (DATABASE_URL-gated), with a fake Paddle that behaves as Kd's sandbox did on 2026-10-18.
// ROADMAP Stage 2 item 4b-iii-a.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): the
// old owner keeps being charged for a gym they gave away, or the gym goes to somebody who never
// put in a card. "Charged" is read where Paddle would charge: whose card the plan's next
// renewal takes, and whose account its receipt goes to.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { BillingDeps } from "../src/modules/billing/service.js";
import { settleOwnerCards } from "../src/modules/orgs/coOwners/paidHandOver.js";
import { defaultPrivilegesFor } from "../src/modules/orgs/service.js";
import { FakePaddle } from "./fakePaddle.js";
import {
  ROLE_PRIVILEGES,
  answerOwnerRequestResponseSchema,
  myOwnerRequestResponseSchema,
  orgStaffResponseSchema,
  ownerCardResponseSchema,
  type OrgRole,
} from "@app/shared";

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
  /** The plan's Paddle subscription, and the old owner's Paddle customer that pays it. */
  sub: string;
  payer: string;
}

let ipCounter = 0;
const nextIp = () => `10.69.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("a gym paying through Paddle handed to a co-owner (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const paddle = new FakePaddle({ [PRICE]: { amount: "2900", currency: "USD" } });
  const errors: { event?: string }[] = [];
  const log = { info: () => undefined, warn: () => undefined, error: (obj: object) => void errors.push(obj) };
  const billing: BillingDeps = {
    sql,
    redis: createMemoryRedis(),
    paddle: { api: paddle, environment: "sandbox", clientToken: baseEnv.PADDLE_CLIENT_TOKEN },
    log,
    now: () => new Date(),
  };
  const worker = () => settleOwnerCards(billing, defaultPrivilegesFor("owner"));
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

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, who: User, payload?: unknown) =>
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

  /** A gym its owner pays for through Paddle, with their card on the plan. */
  const makePaidGym = async (ownerName: string): Promise<Gym> => {
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `${ownerName}'s Gym ${String(++count)}`, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.id}`;
    const made = await paddle.createTransaction({ priceId: PRICE, customData: { gym_id: org.id } });
    if (made.kind !== "ok") throw new Error("the fake did not make a transaction");
    const sub = paddle.pay(made.value.id, "api", true, owner.email);
    const payer = paddle.subs.get(sub)?.customer_id ?? null;
    if (payer === null) throw new Error("the fake's subscription has no customer");
    paddle.cardOf.set(sub, payer);
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, provider_customer_ref, current_period_end)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'paddle', ${sub}, ${payer}, now() + interval '30 days')`;
    return { id: org.id, owner, sub, payer };
  };
  const makeStaff = async (gym: Gym, name: string, role: OrgRole = "manager"): Promise<User> => {
    const staff = await person(name);
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${staff.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
    return staff;
  };
  const makeCoOwner = (gym: Gym, name: string) => makeStaff(gym, name, "owner");

  const ask = (gym: Gym, target: User) => send("POST", `/v1/orgs/${gym.id}/staff/${target.userId}/owner-request`, gym.owner);
  const cancel = (gym: Gym, target: User) => send("DELETE", `/v1/orgs/${gym.id}/staff/${target.userId}/owner-request`, gym.owner);
  const mineAt = async (gym: Gym, who: User) => {
    const res = await get(`/v1/orgs/${gym.id}/owner-request`, who);
    expect(res.statusCode, res.body).toBe(200);
    return myOwnerRequestResponseSchema.parse(JSON.parse(res.body)).request;
  };
  const requestIdFor = async (gym: Gym, who: User): Promise<string> => {
    const request = await mineAt(gym, who);
    if (request === null) throw new Error("no request is waiting");
    return request.id;
  };
  const accept = (gym: Gym, requestId: string, who: User) => send("POST", `/v1/orgs/${gym.id}/owner-request/${requestId}/accept`, who);
  const cardSaved = (gym: Gym, requestId: string, who: User) => send("POST", `/v1/orgs/${gym.id}/owner-request/${requestId}/card`, who);
  /** Accept, answered with Paddle's card window: its transaction, opened in their browser. */
  const acceptToWindow = async (gym: Gym, requestId: string, who: User): Promise<string> => {
    const res = await accept(gym, requestId, who);
    expect(res.statusCode, res.body).toBe(200);
    const body = answerOwnerRequestResponseSchema.parse(JSON.parse(res.body));
    if (body.status !== "card_needed") throw new Error(`Accept answered ${body.status}`);
    expect(body.card.email).toBe(who.email);
    paddle.openCardWindow(body.card.transactionId);
    return body.card.transactionId;
  };
  const ownerOf = async (gym: Gym) => (await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gym.id}`)[0]?.owner_user_id;
  const customerOf = (who: User) => paddle.customersByEmail.get(who.email.toLowerCase()) ?? null;
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
  describe("the old owner is never charged for a gym they gave away, and nobody gets it without a card", () => {
    it("Accept moves nothing; the gym moves when the new owner's card is saved, and from then they pay", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      expect((await mineAt(gym, cora))?.cardNeeded).toBe(true);

      const txn = await acceptToWindow(gym, requestId, cora);
      // Nothing has moved: the gym, the plan's payer and its card are the old owner's.
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(paddle.renewal(gym.sub)).toEqual({ card: gym.payer, receipt: gym.payer });
      const pending = await cardSaved(gym, requestId, cora);
      expect(ownerCardResponseSchema.parse(JSON.parse(pending.body)).status).toBe("waiting");
      expect(await ownerOf(gym)).toBe(gym.owner.userId);

      // Their own Paddle customer, never the old owner's.
      const theirs = customerOf(cora);
      expect(theirs).not.toBeNull();
      expect(theirs).not.toBe(gym.payer);
      expect(paddle.saveCard(txn)).toBe(true);
      const done = await cardSaved(gym, requestId, cora);
      expect(done.statusCode, done.body).toBe(200);
      expect(ownerCardResponseSchema.parse(JSON.parse(done.body)).status).toBe("accepted");

      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renewal(gym.sub)).toEqual({ card: theirs, receipt: theirs });
      const row = await sql<{ provider_customer_ref: string }[]>`
        SELECT provider_customer_ref FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND provider_ref = ${gym.sub}`;
      expect(row[0]?.provider_customer_ref).toBe(theirs);
      // Asked again by the browser or the worker: nothing more happens.
      expect(ownerCardResponseSchema.parse(JSON.parse((await cardSaved(gym, requestId, cora)).body)).status).toBe("accepted");
      await worker();
      expect(paddle.payerMoves.filter((m) => m.subscriptionId === gym.sub)).toHaveLength(1);
    }, TEST_TIMEOUT_MS);

    it("a window closed without a card leaves the gym and its payer as they were, and Cancel shuts the window even in a tab still open", async () => {
      const gym = await makePaidGym("Kd");
      const cy = await makeCoOwner(gym, "Cy");
      expect((await ask(gym, cy)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cy);
      const txn = await acceptToWindow(gym, requestId, cy);
      await worker();
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect((await mineAt(gym, cy))?.id).toBe(requestId);

      const cancelled = await cancel(gym, cy);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      // Their tab, still open, is refused by Paddle: the window is the plan's payer's again.
      expect(paddle.txns.get(txn)?.customer_id).toBe(gym.payer);
      expect(paddle.saveCard(txn)).toBe(false);
      expect(paddle.renewal(gym.sub)).toEqual({ card: gym.payer, receipt: gym.payer });
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect((await cardSaved(gym, requestId, cy)).statusCode).toBe(409);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
    }, TEST_TIMEOUT_MS);

    it("nobody but the person asked can press their Accept or say their card was saved", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      const other = await makeCoOwner(gym, "Otto");
      const manager = await makeStaff(gym, "Manny");
      const stranger = (await makePaidGym("Stranger")).owner;
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      for (const who of [other, manager, gym.owner]) {
        expect((await accept(gym, requestId, who)).statusCode).toBe(404);
      }
      expect((await accept(gym, requestId, stranger)).statusCode).toBe(404);
      const txn = await acceptToWindow(gym, requestId, cora);
      expect(paddle.saveCard(txn)).toBe(true);
      for (const who of [other, manager, gym.owner]) {
        expect((await cardSaved(gym, requestId, who)).statusCode).toBe(404);
      }
      expect((await cardSaved(gym, requestId, stranger)).statusCode).toBe(404);
      // The worker finishes it for the person whose card it was, whoever closed their tab.
      expect((await worker()).handedOver).toBeGreaterThanOrEqual(1);
      expect(await ownerOf(gym)).toBe(cora.userId);
    }, TEST_TIMEOUT_MS);

    it("a card saved after the request ended moves nothing, and the window is shut before the request ends", async () => {
      const gym = await makePaidGym("Kd");
      const ria = await makeCoOwner(gym, "Ria");
      expect((await ask(gym, ria)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, ria);
      const txn = await acceptToWindow(gym, requestId, ria);
      await sql`UPDATE gym_owner_requests SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = ${requestId}`;
      // Out of date, but its window is open: it ends only once the worker shut the window.
      expect((await sql<{ state: string }[]>`SELECT state FROM gym_owner_requests WHERE id = ${requestId}`)[0]?.state).toBe("pending");
      expect((await worker()).closed).toBeGreaterThanOrEqual(1);
      expect((await sql<{ state: string }[]>`SELECT state FROM gym_owner_requests WHERE id = ${requestId}`)[0]?.state).toBe("expired");
      expect(paddle.saveCard(txn)).toBe(false);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(paddle.renewal(gym.sub)).toEqual({ card: gym.payer, receipt: gym.payer });
    }, TEST_TIMEOUT_MS);

    it("while their card window is open the owner cannot change or remove them, and Decline shuts the window", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      const txn = await acceptToWindow(gym, requestId, cora);
      const demote = await send("PATCH", `/v1/orgs/${gym.id}/staff/${cora.userId}`, gym.owner, { role: "manager" });
      expect(demote.statusCode, demote.body).toBe(409);
      expect(errorOf(demote)).toBe("adding_card");
      const remove = await send("DELETE", `/v1/orgs/${gym.id}/staff/${cora.userId}`, gym.owner);
      expect(remove.statusCode, remove.body).toBe(409);
      expect(errorOf(remove)).toBe("adding_card");

      const declined = await send("POST", `/v1/orgs/${gym.id}/owner-request/${requestId}/decline`, cora);
      expect(declined.statusCode, declined.body).toBe(200);
      await worker();
      expect(paddle.saveCard(txn)).toBe(false);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect((await send("PATCH", `/v1/orgs/${gym.id}/staff/${cora.userId}`, gym.owner, { role: "manager" })).statusCode).toBe(200);
    }, TEST_TIMEOUT_MS);

    it("Cancel after the card was saved hands the gym over instead, as the card said", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      const txn = await acceptToWindow(gym, requestId, cora);
      expect(paddle.saveCard(txn)).toBe(true);
      const late = await cancel(gym, cora);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late)).toBe("card_saved");
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renewal(gym.sub).receipt).toBe(customerOf(cora));
    }, TEST_TIMEOUT_MS);
  });

  describe("the plan's state", () => {
    it("money owed, a plan set to end, or Razorpay stops a hand-over, and the Staff tab says why", async () => {
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

      const ending = await makePaidGym("Kd");
      const b = await makeCoOwner(ending, "Bo");
      await sql`UPDATE subscriptions SET cancel_at_period_end = true WHERE owner_type = 'gym' AND owner_id = ${ending.id}`;
      expect(errorOf(await ask(ending, b))).toBe("plan_ending");

      const rupees = await makePaidGym("Kd");
      const c = await makeCoOwner(rupees, "Cy");
      await sql`UPDATE subscriptions SET provider = 'razorpay' WHERE owner_type = 'gym' AND owner_id = ${rupees.id}`;
      expect(errorOf(await ask(rupees, c))).toBe("paid_plan");

      const fine = await makePaidGym("Kd");
      const tabFine = await staffList(fine, fine.owner);
      expect(tabFine.paidPlan).toBe(false);
      expect(tabFine.paidPlanNote).toBeNull();
      expect(tabFine.cardNeeded).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("a plan that goes past due before the card is saved still moves: the card window pays what is owed", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      const txn = await acceptToWindow(gym, requestId, cora);
      await sql`UPDATE subscriptions SET status = 'past_due', past_due_since = now() WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect(paddle.saveCard(txn)).toBe(true);
      expect(ownerCardResponseSchema.parse(JSON.parse((await cardSaved(gym, requestId, cora)).body)).status).toBe("accepted");
      expect(await ownerOf(gym)).toBe(cora.userId);
    }, TEST_TIMEOUT_MS);
  });

  describe("when Paddle does not answer", () => {
    it("a key that cannot make customers opens no window and moves nothing", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      paddle.noCustomerWrite = true;
      try {
        const res = await accept(gym, requestId, cora);
        expect(res.statusCode).toBe(503);
        expect(errorOf(res)).toBe("card_unavailable");
      } finally {
        paddle.noCustomerWrite = false;
      }
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect((await sql`SELECT 1 FROM gym_owner_requests WHERE id = ${requestId} AND card_txn_ref IS NOT NULL`).length).toBe(0);
    }, TEST_TIMEOUT_MS);

    it("a payer that did not move is moved by the worker, and Paddle's page waits until then", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      const txn = await acceptToWindow(gym, requestId, cora);
      // While the window is open, neither of them opens Paddle's page.
      const early = await send("POST", `/v1/orgs/${gym.id}/billing/portal`, gym.owner);
      expect(early.statusCode, early.body).toBe(409);
      expect(errorOf(early)).toBe("payer_moving");

      expect(paddle.saveCard(txn)).toBe(true);
      paddle.payerMoveFailures = 1;
      expect(ownerCardResponseSchema.parse(JSON.parse((await cardSaved(gym, requestId, cora)).body)).status).toBe("accepted");
      expect(await ownerOf(gym)).toBe(cora.userId);
      expect(paddle.renewal(gym.sub).receipt).toBe(gym.payer);
      expect(errorOf(await send("POST", `/v1/orgs/${gym.id}/billing/portal`, cora))).toBe("payer_moving");

      await worker();
      expect(paddle.renewal(gym.sub)).toEqual({ card: customerOf(cora), receipt: customerOf(cora) });
      const opened = await send("POST", `/v1/orgs/${gym.id}/billing/portal`, cora);
      expect(opened.statusCode, opened.body).toBe(200);
      expect(paddle.portalCalls.at(-1)?.customerId).toBe(customerOf(cora));
    }, TEST_TIMEOUT_MS);

    it("two 'card saved' calls at once, and the worker beside them, hand the gym over once", async () => {
      const gym = await makePaidGym("Kd");
      const cora = await makeCoOwner(gym, "Cora");
      expect((await ask(gym, cora)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, cora);
      const txn = await acceptToWindow(gym, requestId, cora);
      expect(paddle.saveCard(txn)).toBe(true);
      const answers = await Promise.all([cardSaved(gym, requestId, cora), cardSaved(gym, requestId, cora), worker()]);
      expect(answers[0].statusCode).toBe(200);
      expect(answers[1].statusCode).toBe(200);
      expect(await ownerOf(gym)).toBe(cora.userId);
      const audits = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.owner_handed_over'`;
      expect(audits.length).toBe(1);
    }, TEST_TIMEOUT_MS);
  });
});
