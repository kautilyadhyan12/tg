// Payment received, told to the phone (ROADMAP Stage 5 item 20h), against real Postgres (DATABASE_URL-gated), with Square
// answered by the fake in `fakeSquareTerminal.ts` and Firebase by a recording sender. A payment in the app that Square
// confirms while nobody is waiting on the answer (the worker's minute, staff's Close payment page) owes the member who
// pressed Pay one notification; one their own phone read as paid owes none.
//
// The worst thing this job could do to a real person: a phone saying "Payment received" when no money was taken (a page
// left, cancelled, still on its way, or one Square took another amount for that the bill did not take), or telling
// somebody other than the person who paid. That is first.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_PAYMENTS_CHANNEL,
  appPaymentCloseResponseSchema,
  appPaymentResponseSchema,
  appPurchaseResponseSchema,
  forSaleResponseSchema,
  gymPaymentPushDataSchema,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  verifyCodePhoneResponseSchema,
  type AppPaymentResponse,
  type GymMembershipTypesResponse,
  type PhoneSessionTokens,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { APP_PAYMENT } from "../src/modules/orgs/payments/appPayments.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import type { PushMessage, PushResult, PushSender } from "../src/modules/push/fcm.adapter.js";
import { sendPaymentNotifications } from "../src/modules/push/paymentsSweep.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "pay-received-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-PAYRECEIVEDAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-PAYRECEIVEDSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_pay_received";
const MINE = "payrx-t-%@example.com";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Owner {
  userId: string;
  cookies: Cookies;
}
/** A member signed in on a phone, with its notification address given. */
interface Phone extends PhoneSessionTokens {
  userId: string;
  phone: string;
}
interface Gym {
  id: string;
  name: string;
  owner: Owner;
  acct: Account;
  gold: string;
}
interface Holder {
  entryId: string;
  membershipId: string;
}

let ipCounter = 0;
const nextIp = () => `10.57.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const gold = {
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4999,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Payment received, told to the phone (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  const square = fakeSquare();
  const hub = recordingHub();
  const redis = createMemoryRedis();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const gymIds: string[] = [];
  const work = () => processSquareWork({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock }, [], gymIds);
  /** The worker's minute, past the time a page is left to the phone that asks about it. */
  const workLater = async () => {
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work();
  };

  const codes: { email: string; code: string }[] = [];
  const emailSender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (to, code) => {
      codes.push({ email: to, code });
      return Promise.resolve();
    },
  };

  const sent: PushMessage[] = [];
  const answers = new Map<string, PushResult>();
  const sender: PushSender = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve(answers.get(message.token) ?? "sent");
    },
  };
  const sweep = (with_: PushSender = sender) => sendPaymentNotifications({ sql, sender: with_, now: () => clock, gymIds });
  const fresh = () => {
    sent.length = 0;
  };

  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE ${MINE}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_app_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM push_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const request = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: { payload?: unknown; bearer?: string; cookies?: Cookies } = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: opts.cookies ?? {},
      headers: {
        ...(opts.payload === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.bearer === undefined ? {} : { authorization: `Bearer ${opts.bearer}` }),
      },
      ...(opts.payload === undefined ? {} : { payload: JSON.stringify(opts.payload) }),
    });
  const codeFor = async (to: string): Promise<string> => {
    const res = await request("POST", "/v1/auth/code/send", { payload: { email: to } });
    expect(res.statusCode, res.body).toBe(200);
    const hit = [...codes].reverse().find((c) => c.email === to);
    if (hit === undefined) throw new Error(`no code was sent to ${to}`);
    return hit.code;
  };
  const phoneOf = async (name: string): Promise<Phone> => {
    const to = `payrx-t-${name.replace(/\W/g, "").toLowerCase()}-${uniq()}@example.com`;
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to), client: "phone" } });
    expect(res.statusCode, res.body).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    const phone = `fcm-${name.replace(/\W/g, "")}-${uniq()}:APA91b${"x".repeat(60)}`;
    const given = await request("PUT", "/v1/push-tokens", { bearer: body.tokens.accessToken, payload: { token: phone, platform: "android" } });
    expect(given.statusCode, given.body).toBe(200);
    return { ...body.tokens, userId: body.user.id, phone };
  };
  const browser = async (): Promise<Owner> => {
    const to = `payrx-t-owner-${uniq()}@example.com`;
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to) } });
    expect(res.statusCode, res.body).toBe(200);
    const userId = (JSON.parse(res.body) as { user: { id: string } }).user.id;
    return { userId, cookies: Object.fromEntries(res.cookies.map((c) => [c.name, c.value])) };
  };
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await browser();
    const res = await request("POST", "/v1/orgs", { cookies: owner.cookies, payload: { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" } });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    gymIds.push(id);
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(`PRX${uniq().slice(-7)}`);
    const start = await request("POST", `/v1/orgs/${id}/payments/square/connect`, { cookies: owner.cookies });
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await request("POST", "/v1/payments/square/finish", { cookies: owner.cookies, payload: { state, code: square.allow(acct) } });
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    const type = await request("POST", `/v1/orgs/${id}/membership-types`, { cookies: owner.cookies, payload: gold });
    expect(type.statusCode, type.body).toBe(201);
    const found = (JSON.parse(type.body) as GymMembershipTypesResponse).types.find((t) => t.name === gold.name);
    if (found === undefined) throw new Error("no type");
    return { id, name, owner, acct, gold: found.id };
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** On the list holding Gold Monthly, its first month owed; in the gym's app on that record where `app` is given. */
  const owing = async (gym: Gym, fullName: string, app: Phone | null): Promise<Holder> => {
    const add = await request("POST", `/v1/orgs/${gym.id}/member-list/entries`, { cookies: gym.owner.cookies, payload: { fullName, email: `payrx-r-${uniq()}@example.com` } });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const today = heldMembershipsResponseSchema.parse(JSON.parse((await request("GET", `${entryUrl(gym, entryId)}/memberships`, { cookies: gym.owner.cookies })).body)).today;
    const given = await request("POST", `${entryUrl(gym, entryId)}/memberships`, {
      cookies: gym.owner.cookies,
      payload: { requestKey: randomUUID(), method: "cash", typeId: gym.gold, startsOn: today, paid: false },
    });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    if (app !== null) await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${app.userId}, ${entryId})`;
    return { entryId, membershipId: m.id };
  };
  const payUrl = (gym: Gym) => `/v1/orgs/${gym.id}/my-membership/payments`;
  const parsed = (res: { statusCode: number; body: string }): AppPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return appPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const pay = async (gym: Gym, by: Phone, who: Holder) =>
    parsed(await request("POST", payUrl(gym), { bearer: by.accessToken, payload: { requestKey: randomUUID(), membershipId: who.membershipId, periodIndex: 0, amountMinor: 4999 } }));
  const check = async (gym: Gym, by: Phone, id: string) => parsed(await request("GET", `${payUrl(gym)}/${id}`, { bearer: by.accessToken }));
  const linkOf = (id: string) => {
    const found = [...square.links.values()].find((l) => l.referenceId === id);
    if (found === undefined) throw new Error("no payment page at the fake Square");
    return found;
  };
  const owed = async (id: string) => (await sql<{ due: boolean }[]>`SELECT push_due_at IS NOT NULL AS due FROM gym_app_payments WHERE id = ${id}`)[0]?.due;
  const outcome = async (id: string) => (await sql<{ outcome: string | null }[]>`SELECT outcome FROM gym_app_payments WHERE id = ${id}`)[0]?.outcome;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    square.state.now = () => clock;
    app = await buildApp(config(), {
      redis,
      squareApi: square.api,
      live: { hub },
      emailSender,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("the worst thing: told only once Square took exactly what was asked and it is on the bill, and only to the person who paid", async () => {
    clock = new Date();
    fresh();
    const gym = await makeGym("Pay Received Worst");
    const tara = await phoneOf("Tara Singh");
    const sam = await phoneOf("Sam Lee");
    const priya = await phoneOf("Priya Sharma");
    const taraBill = await owing(gym, "Tara Singh", tara);
    const samBill = await owing(gym, "Sam Lee", sam);
    const priyaRecord = await owing(gym, "Priya Sharma", priya);
    // Priya pays for Sam (18i).
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${gym.id}, ${samBill.entryId}, ${priyaRecord.entryId}, ${gym.owner.userId})`;

    // A page left open and never paid: closed by the worker once its time is up. Nothing is told.
    const left = await pay(gym, tara, taraBill);
    clock = new Date(clock.getTime() + APP_PAYMENT.openMs + 60_000);
    await work();
    expect(await outcome(left.payment.id)).toBe("closed");
    await sweep();
    expect(sent).toEqual([]);

    // Paid, but Square's payment is still on its way: nothing yet, however often the worker asks.
    const pending = await pay(gym, tara, taraBill);
    expect(square.payLink(linkOf(pending.payment.id).id, { status: "PENDING" })).toBe(true);
    await workLater();
    await workLater();
    expect(await outcome(pending.payment.id)).toBeNull();
    await sweep();
    expect(sent).toEqual([]);

    // Square finishes taking it while Tara is away: the worker records it, and her phone alone is told, once.
    const paymentId = linkOf(pending.payment.id).paymentIds[0] ?? "";
    const taken = square.payments.get(paymentId);
    if (taken === undefined) throw new Error("no payment at the fake Square");
    taken.status = "COMPLETED";
    await workLater();
    expect(await outcome(pending.payment.id)).toBe("paid");
    const run = await sweep();
    expect(run).toMatchObject({ sent: 1, failed: 0 });
    expect(sent.map((m) => m.token)).toEqual([tara.phone]);
    expect(sent[0]).toMatchObject({
      userId: tara.userId,
      title: "Payment received",
      body: `$49.99 paid to ${gym.name} for Gold Monthly.`,
      tag: `payment:${pending.payment.id}`,
      channelId: GYM_PAYMENTS_CHANNEL.id,
    });
    expect(gymPaymentPushDataSchema.parse(sent[0]?.data)).toEqual({ kind: "gym_payment", gymId: gym.id, paymentId: pending.payment.id });
    // Asked again: never twice.
    await sweep();
    await workLater();
    await sweep();
    expect(sent).toHaveLength(1);

    // Priya pays Sam's month and leaves: Priya is told, never Sam, whose bill it was.
    fresh();
    const forSam = await pay(gym, priya, samBill);
    expect(square.payLink(linkOf(forSam.payment.id).id)).toBe(true);
    await workLater();
    expect(await outcome(forSam.payment.id)).toBe("paid");
    await sweep();
    expect(sent.map((m) => m.token)).toEqual([priya.phone]);
    expect(sent[0]?.userId).toBe(priya.userId);

    // Square took another amount than the bill: kept as not recorded, never told as received.
    fresh();
    const priyaOwn = await pay(gym, priya, priyaRecord);
    expect(square.payLink(linkOf(priyaOwn.payment.id).id, { amount_money: { amount: 5000, currency: "USD" }, total_money: { amount: 5000, currency: "USD" } })).toBe(true);
    await workLater();
    expect(await outcome(priyaOwn.payment.id)).toBe("not_recorded");
    expect(await owed(priyaOwn.payment.id)).toBe(false);
    await sweep();
    expect(sent).toEqual([]);
  });

  it("the member's own phone saw it paid: no notification, whether it asked first or the worker did", async () => {
    clock = new Date();
    fresh();
    const gym = await makeGym("Pay Received Seen");
    const leo = await phoneOf("Leo Park");
    const mia = await phoneOf("Mia Chen");
    const leoBill = await owing(gym, "Leo Park", leo);
    const miaBill = await owing(gym, "Mia Chen", mia);

    // Leo pays and comes back to the app: his phone asks, the screen says it, nothing is owed.
    const own = await pay(gym, leo, leoBill);
    expect(square.payLink(linkOf(own.payment.id).id)).toBe(true);
    expect((await check(gym, leo, own.payment.id)).payment.state).toBe("paid");
    expect(await owed(own.payment.id)).toBe(false);

    // Mia pays; the worker records it first, then her phone reads it before the notification goes: not sent.
    const hers = await pay(gym, mia, miaBill);
    expect(square.payLink(linkOf(hers.payment.id).id)).toBe(true);
    await workLater();
    expect(await owed(hers.payment.id)).toBe(true);
    expect((await check(gym, mia, hers.payment.id)).payment.state).toBe("paid");
    expect(await owed(hers.payment.id)).toBe(false);
    await sweep();
    expect(sent).toEqual([]);
  });

  it("staff's Close payment page finds it paid: the member is told", async () => {
    clock = new Date();
    fresh();
    const gym = await makeGym("Pay Received Staff");
    const noor = await phoneOf("Noor Ali");
    const bill = await owing(gym, "Noor Ali", noor);
    const page = await pay(gym, noor, bill);
    expect(square.payLink(linkOf(page.payment.id).id)).toBe(true);
    const shut = await request("POST", `${entryUrl(gym, bill.entryId)}/memberships/${bill.membershipId}/app-payment/close`, { cookies: gym.owner.cookies });
    expect(shut.statusCode, shut.body).toBe(200);
    expect(appPaymentCloseResponseSchema.parse(JSON.parse(shut.body)).outcome).toBe("paid");
    await sweep();
    expect(sent.map((m) => m.token)).toEqual([noor.phone]);
  });

  it("a line bought and given while the member was away: told, with where the pass is", async () => {
    clock = new Date();
    fresh();
    const gym = await makeGym("Pay Received Buy");
    const add = await request("POST", `/v1/orgs/${gym.id}/membership-types`, {
      cookies: gym.owner.cookies,
      payload: { ...gold, name: "Day pass", kind: "pack", priceMinor: 1500, termCount: null, termUnit: null, packClasses: 1, packDays: 1, soldInApp: true },
    });
    expect(add.statusCode, add.body).toBe(201);
    const pass = (JSON.parse(add.body) as GymMembershipTypesResponse).types.find((t) => t.name === "Day pass");
    const ava = await phoneOf("Ava Stone");
    const listed = await request("POST", `/v1/orgs/${gym.id}/member-list/entries`, { cookies: gym.owner.cookies, payload: { fullName: "Ava Stone", email: `payrx-r-${uniq()}@example.com` } });
    const entryId = (JSON.parse(listed.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${ava.userId}, ${entryId})`;
    const sale = forSaleResponseSchema.parse(JSON.parse((await request("GET", `/v1/orgs/${gym.id}/for-sale`, { bearer: ava.accessToken })).body));
    const shown = sale.items.find((i) => i.typeId === pass?.id);
    if (shown === undefined) throw new Error("the day pass is not listed");
    const press = await request("POST", `/v1/orgs/${gym.id}/for-sale/purchases`, {
      bearer: ava.accessToken,
      payload: { requestKey: randomUUID(), typeId: shown.typeId, amountMinor: shown.firstPayment.amountMinor, factsKey: shown.factsKey, agreement: null },
    });
    expect(press.statusCode, press.body).toBe(200);
    const bought = appPurchaseResponseSchema.parse(JSON.parse(press.body));
    expect(square.payLink(linkOf(bought.purchase.id).id)).toBe(true);
    await workLater();
    expect(await outcome(bought.purchase.id)).toBe("paid");
    await sweep();
    expect(sent.map((m) => [m.token, m.body])).toEqual([[ava.phone, `$15.00 paid to ${gym.name} for Day pass. Show your pass when you arrive.`]]);
  });

  it("Payments switched off in Settings, or no phone signed in: nothing, and switched on again tells nothing old (19d)", async () => {
    clock = new Date();
    fresh();
    const gym = await makeGym("Pay Received Off");
    const kai = await phoneOf("Kai Moss");
    const bill = await owing(gym, "Kai Moss", kai);
    const off = await request("PATCH", "/v1/users/me", { bearer: kai.accessToken, payload: { pushPayments: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect((JSON.parse(off.body) as { user: { pushPayments: boolean } }).user.pushPayments).toBe(false);
    const page = await pay(gym, kai, bill);
    expect(square.payLink(linkOf(page.payment.id).id)).toBe(true);
    await workLater();
    expect(await outcome(page.payment.id)).toBe("paid");
    expect(await sweep()).toMatchObject({ sent: 0, skipped: 1 });
    const on = await request("PATCH", "/v1/users/me", { bearer: kai.accessToken, payload: { pushPayments: true } });
    expect(on.statusCode, on.body).toBe(200);
    await sweep();
    expect(sent).toEqual([]);

    // Signed out on the phone: its address reaches nobody.
    const zoe = await phoneOf("Zoe Hart");
    const zoeBill = await owing(gym, "Zoe Hart", zoe);
    const hers = await pay(gym, zoe, zoeBill);
    expect(square.payLink(linkOf(hers.payment.id).id)).toBe(true);
    await sql`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${zoe.userId}`;
    await workLater();
    expect(await outcome(hers.payment.id)).toBe("paid");
    await sweep();
    expect(sent).toEqual([]);
  });

  it("two runs at once send it once; Firebase not answering keeps it for the next run", async () => {
    clock = new Date();
    fresh();
    const gym = await makeGym("Pay Received Twice");
    const ivy = await phoneOf("Ivy Ross");
    const bill = await owing(gym, "Ivy Ross", ivy);
    const page = await pay(gym, ivy, bill);
    expect(square.payLink(linkOf(page.payment.id).id)).toBe(true);
    await workLater();

    answers.set(ivy.phone, "failed");
    expect(await sweep()).toMatchObject({ sent: 0, failed: 1 });
    expect(await owed(page.payment.id)).toBe(true);
    answers.delete(ivy.phone);
    fresh();

    // A sender that waits a moment, so both runs are sending at once.
    const slow: PushSender = { send: (m) => new Promise((resolve) => setTimeout(() => void sender.send(m).then(resolve), 50)) };
    await Promise.all([sweep(slow), sweep(slow), sweep(slow)]);
    expect(sent.map((m) => m.token)).toEqual([ivy.phone]);
    expect(await owed(page.payment.id)).toBe(false);
  });
});
