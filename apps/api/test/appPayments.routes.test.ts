// Pay what they owe in the app (ROADMAP 18k-ii-a; spec Part 3 §14.8), through its routes against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, whose payment pages answer as
// Square's test area did on 2026-11-06 (`apps/api/.cost/18k-ii-a/probe-links.mts`).
//
// The first block is the worst thing this job could do to a real person: charged twice for one bill (their page and the
// desk, the card on file, or a second page at once), or charged and still shown as owing, or their money on somebody
// else's bill. The last block holds a fee to the same (18k-ii-b), and to one more: charged for a fee they no longer owe
// (marked came while paying it) with nobody told.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  appPaymentCloseResponseSchema,
  appPaymentResponseSchema,
  gymPaymentsResponseSchema,
  heldMembershipsResponseSchema,
  myAppPaymentsResponseSchema,
  myMembershipResponseSchema,
  refundsToReviewResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentsResponseSchema,
  type AppPaymentResponse,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { createMemoryRedis } from "../src/redis.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { openDueFreezeFees } from "../src/modules/orgs/memberships/freezeFees.js";
import { appointmentById } from "../src/modules/orgs/pt/repo.js";
import { loadConfig } from "../src/config.js";
import { APP_PAYMENT } from "../src/modules/orgs/payments/appPayments.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 9).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-APPPAYMENTSAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "app-pay-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-APPPAYMENTSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_app_pay";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  name: string;
  owner: Person;
}
interface Holder {
  entryId: string;
  membershipId: string;
}

let ipCounter = 0;
const nextIp = () => `10.53.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
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

d("Pay what they owe in the app: charged once, on this bill alone (real Postgres)", { timeout: T }, () => {
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
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });

  const MINE = "apay-t-%@example.com";
  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`).map((r) => r.id);
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM gym_app_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_refunds WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_terminals WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  /** The same, from one fixed address: a whole gym on its wi-fi. */
  const sendFrom = (ip: string, method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const signedIn = async (name: string): Promise<Person> => {
    const email = `apay-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, name, owner };
  };
  const staff = async (gym: Gym, who: Person, role: "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
  };
  const connect = async (gym: Gym, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, gold);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === gold.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** A person on the list holding Gold Monthly, its first month owed. */
  const owing = async (gym: Gym, typeId: string, fullName: string): Promise<Holder> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `apay-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const today = heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: false });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return { entryId, membershipId: m.id };
  };
  /** In the gym's app, linked to the record. */
  const inApp = async (gym: Gym, who: Person, entryId: string) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${who.userId}, ${entryId})`;
  };
  /** Somebody owing their first month, in the gym's app on their record. */
  const member = async (gym: Gym, typeId: string, fullName: string): Promise<{ holder: Holder; app: Person }> => {
    const holder = await owing(gym, typeId, fullName);
    const app = await signedIn(fullName);
    await inApp(gym, app, holder.entryId);
    return { holder, app };
  };
  const held = async (gym: Gym, by: Person, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const payUrl = (gym: Gym) => `/v1/orgs/${gym.id}/my-membership/payments`;
  const payPress = (gym: Gym, by: Person, who: Holder, over: Record<string, unknown> = {}) =>
    send("POST", payUrl(gym), by.cookies, { requestKey: randomUUID(), membershipId: who.membershipId, periodIndex: 0, amountMinor: 4999, ...over });
  const parsed = (res: { statusCode: number; body: string }): AppPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return appPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const pay = async (gym: Gym, by: Person, who: Holder, over: Record<string, unknown> = {}) => parsed(await payPress(gym, by, who, over));
  const check = async (gym: Gym, by: Person, id: string) => parsed(await send("GET", `${payUrl(gym)}/${id}`, by.cookies));
  const close = async (gym: Gym, by: Person, id: string) => parsed(await send("POST", `${payUrl(gym)}/${id}/close`, by.cookies));
  const staffClose = (gym: Gym, by: Person, who: Holder) => send("POST", `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/app-payment/close`, by.cookies);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const byHand = (gym: Gym, who: Holder) =>
    send("POST", `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
  const paymentsOf = (gymId: string) =>
    sql<{ bill_id: string; held_membership_id: string; amount_minor: number; method: string; provider: string | null; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT p.bill_id, b.held_membership_id, p.amount_minor, p.method, p.provider, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE p.gym_id = ${gymId} AND p.undone_at IS NULL ORDER BY p.seq`;
  const linksOf = (acct: Account) => [...square.links.values()].filter((l) => l.accountId === acct.merchantId);
  const work = async (gymIds?: string[]) => processSquareWork(workDeps(), [], gymIds ?? (await mine()));

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
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("the worst thing: what Square took is on this bill once, nobody else's page reaches it, and nothing else can pay it meanwhile", async () => {
    clock = new Date();
    const gymA = await makeGym("App Pay Worst A");
    const gymB = await makeGym("App Pay Worst B");
    const accountA = account(`APWA${uniq().slice(-6)}`);
    const accountB = account(`APWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const goldA = await typeOf(gymA);
    const goldB = await typeOf(gymB);
    const tara = await owing(gymA, goldA, "Tara Singh");
    const sam = await owing(gymA, goldA, "Sam Lee");
    const priyaRecord = await owing(gymA, goldA, "Priya Sharma");
    const bea = await owing(gymB, goldB, "Bea Brown");
    const taraApp = await signedIn("Tara Singh");
    const samApp = await signedIn("Sam Lee");
    const priyaApp = await signedIn("Priya Sharma");
    const beaApp = await signedIn("Bea Brown");
    const stranger = await signedIn("A Stranger");
    await inApp(gymA, taraApp, tara.entryId);
    await inApp(gymA, samApp, sam.entryId);
    await inApp(gymA, priyaApp, priyaRecord.entryId);
    await inApp(gymB, beaApp, bea.entryId);
    // Priya pays for Sam (18i): Sam's money is hers to read and pay.
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${gymA.id}, ${sam.entryId}, ${priyaRecord.entryId}, ${gymA.owner.userId})`;
    const toldSetUp = await hub.toldAbout(gymA.id, tara.entryId);

    // My membership names the bill a payment in the app takes, all of it.
    const mineRead = myMembershipResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymA.id}/my-membership`, taraApp.cookies)).body));
    expect(mineRead.memberships[0]?.owed).toMatchObject({ amountMinor: 4999, periodIndex: 0 });
    expect(myAppPaymentsResponseSchema.parse(JSON.parse((await send("GET", payUrl(gymA), taraApp.cookies)).body))).toEqual({ inApp: true, open: [] });

    // Nobody reaches a bill that is not theirs to pay: Sam's own (Priya pays it), Tara on Sam's, Priya on Tara's, B's
    // member at A, a stranger, A's owner (staff, not a member), Tara at B for B's member.
    for (const [gym, who, holder, status] of [
      [gymA, samApp, sam, 404],
      [gymA, taraApp, sam, 404],
      [gymA, priyaApp, tara, 404],
      [gymA, beaApp, tara, 404],
      [gymA, stranger, tara, 404],
      [gymA, gymA.owner, tara, 404],
      [gymB, taraApp, bea, 404],
    ] as const) {
      const res = await payPress(gym, who, holder);
      expect(res.statusCode, res.body).toBe(status);
    }
    expect(linksOf(accountA)).toHaveLength(0);
    expect(linksOf(accountB)).toHaveLength(0);
    expect(await hub.toldAbout(gymA.id, tara.entryId)).toBe(toldSetUp);

    // Tara presses Pay: Square's page for exactly her bill, at A's location, no tip or coupon, nothing on the bill yet.
    const started = await pay(gymA, taraApp, tara);
    expect(started.payment).toMatchObject({ state: "open", amountMinor: 4999, currency: "USD", membershipId: tara.membershipId, periodIndex: 0, receiptNumber: null });
    expect(started.payment.url).toMatch(/^https:\/\/square\.link\/u\//);
    const [link] = linksOf(accountA);
    expect(link).toMatchObject({ amount: 4999, currency: "USD", locationId: accountA.locations[0]?.id, referenceId: started.payment.id, note: "Membership payment", orderState: "DRAFT" });
    expect(link?.name).toMatch(/^Gold Monthly, \d{1,2} [A-Z][a-z]{2} \d{4} to \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(await paymentsOf(gymA.id)).toEqual([]);
    expect(await hub.toldAbout(gymA.id, tara.entryId, toldSetUp + 1)).toBe(toldSetUp + 1);
    // Staff see it under her bill, with who is paying and when it closes.
    expect((await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing?.appPayment).toMatchObject({ id: started.payment.id, payerName: "Tara Singh" });

    // Pressed again, with the same key or a new one: the same page, never a second.
    expect((await pay(gymA, taraApp, tara)).payment.id).toBe(started.payment.id);
    expect(linksOf(accountA)).toHaveLength(1);
    // Others cannot read or close it.
    for (const who of [priyaApp, beaApp, stranger, gymA.owner]) {
      expect((await send("GET", `${payUrl(gymA)}/${started.payment.id}`, who.cookies)).statusCode).toBe(404);
      expect((await send("POST", `${payUrl(gymA)}/${started.payment.id}/close`, who.cookies)).statusCode).toBe(404);
    }

    // While it is open nothing else pays, voids or changes Tara's month: by hand, Cancel bill, cancel, freeze, a paid mark.
    const cash = await byHand(gymA, tara);
    expect(cash.statusCode, cash.body).toBe(409);
    expect(errorOf(cash)).toBe("app_payment_open");
    const billId = (await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing?.bills[0]?.id ?? "";
    const voidBill = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/bills/${billId}/cancel`, gymA.owner.cookies, { reason: "mistake" });
    expect(voidBill.statusCode, voidBill.body).toBe(409);
    expect(errorOf(voidBill)).toBe("app_payment_open");
    for (const [what, body] of [
      ["cancel", { when: "today" }],
      ["freeze", {}],
      ["paid", { paidPeriods: 0 }],
    ] as const) {
      const res = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/${what}`, gymA.owner.cookies, body);
      expect(res.statusCode, `${what} ${res.body}`).toBe(409);
      expect(errorOf(res), what).toBe("app_payment_open");
    }
    // Nor does Disconnect Square: the page could be paid with nothing here to record it.
    const off = await send("DELETE", `/v1/orgs/${gymA.id}/payments/square`, gymA.owner.cookies);
    expect(off.statusCode, off.body).toBe(409);
    expect(errorOf(off)).toBe("app_payment_open");
    expect(await paymentsOf(gymA.id)).toEqual([]);

    // Priya pays Sam's month: Sam's bill, her page.
    const forSam = await pay(gymA, priyaApp, sam);
    expect(forSam.payment.membershipId).toBe(sam.membershipId);

    // Tara pays on Square's page. Her bill reads paid once, In the app, with Square's payment and no member of staff.
    expect(square.payLink(link?.id ?? "")).toBe(true);
    const toldOpen = await hub.toldAbout(gymA.id, tara.entryId);
    const paid = await check(gymA, taraApp, started.payment.id);
    expect(paid.payment).toMatchObject({ state: "paid", url: null, closesAt: null });
    expect(paid.payment.receiptNumber).not.toBeNull();
    expect(await hub.toldAbout(gymA.id, tara.entryId, toldOpen + 1)).toBe(toldOpen + 1);
    const squarePaymentId = link?.paymentIds[0];
    expect(await paymentsOf(gymA.id)).toEqual([
      { bill_id: billId, held_membership_id: tara.membershipId, amount_minor: 4999, method: "app", provider: "square", provider_payment_id: squarePaymentId, recorded_by: null },
    ]);
    // Asked again by the phone, the worker and the page marked open by hand: still one payment.
    await check(gymA, taraApp, started.payment.id);
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gymA.id]);
    await sql`UPDATE gym_app_payments SET state = 'open', outcome = NULL, member_payment_id = NULL, finished_at = NULL WHERE id = ${started.payment.id}`;
    await work([gymA.id]);
    expect((await paymentsOf(gymA.id)).filter((p) => p.held_membership_id === tara.membershipId)).toHaveLength(1);

    // The bill is no longer owed: the desk cannot take it again, and the person's page names the card it was paid with.
    const after = await byHand(gymA, tara);
    expect(after.statusCode, after.body).toBe(409);
    const view = await held(gymA, gymA.owner, tara.entryId);
    const payment = view.memberships[0]?.billing?.bills[0]?.payments[0];
    expect(payment).toMatchObject({ method: "app", card: { brand: "VISA", last4: "1111" } });
    expect(view.memberships[0]?.billing?.appPayment).toBeNull();
    // Square holds that money: never voided here.
    const voided = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments/${payment?.id ?? ""}/void`, gymA.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect(errorOf(voided)).toBe("app_payment_void");
    // Sam's and B's bills are untouched.
    expect((await held(gymA, gymA.owner, sam.entryId)).memberships[0]?.billing?.pay).toMatchObject({ leftMinor: 4999 });
    expect(await paymentsOf(gymB.id)).toEqual([]);
  });

  it("a page closed by the member, by staff or by its time can no longer be paid, and one paid as it closed is recorded instead", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Close");
    const acct = account(`APC${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const noor = await owing(gym, typeId, "Noor Ali");
    const noorApp = await signedIn("Noor Ali");
    await inApp(gym, noorApp, noor.entryId);
    const trainer = await signedIn("Desk Trainer");
    await staff(gym, trainer, "trainer");

    // The member leaves the page: Square cancels its order; the page cannot be paid, and the desk can take it.
    const left = await pay(gym, noorApp, noor);
    const closed = await close(gym, noorApp, left.payment.id);
    expect(closed.payment).toMatchObject({ state: "closed", url: null });
    const leftLink = linksOf(acct).find((l) => l.referenceId === left.payment.id);
    expect(leftLink?.orderState).toBe("CANCELED");
    expect(square.payLink(leftLink?.id ?? "")).toBe(false);

    // Staff press Close payment page: a trainer may not; whoever records payments may.
    const open = await pay(gym, noorApp, noor);
    const asTrainer = await staffClose(gym, trainer, noor);
    expect(asTrainer.statusCode, asTrainer.body).toBe(403);
    const shut = await staffClose(gym, gym.owner, noor);
    expect(shut.statusCode, shut.body).toBe(200);
    expect(appPaymentCloseResponseSchema.parse(JSON.parse(shut.body)).outcome).toBe("closed");
    expect((await check(gym, noorApp, open.payment.id)).payment.state).toBe("closed");
    expect((await staffClose(gym, gym.owner, noor)).statusCode).toBe(404);

    // Paid at the very moment it is closed: Square's payment is recorded, never lost and never taken twice.
    const racing = await pay(gym, noorApp, noor);
    const racingLink = linksOf(acct).find((l) => l.referenceId === racing.payment.id);
    square.linkState.beforeLinkDelete = () => {
      square.payLink(racingLink?.id ?? "");
    };
    const raced = await staffClose(gym, gym.owner, noor);
    expect(appPaymentCloseResponseSchema.parse(JSON.parse(raced.body)).outcome).toBe("paid");
    expect((await check(gym, noorApp, racing.payment.id)).payment.state).toBe("paid");
    expect((await paymentsOf(gym.id)).map((p) => p.method)).toEqual(["app"]);
    expect((await byHand(gym, noor)).statusCode).toBe(409);
  });

  it("a page left open closes by itself, and Square not answering keeps the bill held until it does", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Time");
    const acct = account(`APT${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const lee = await owing(gym, typeId, "Lee Park");
    const leeApp = await signedIn("Lee Park");
    await inApp(gym, leeApp, lee.entryId);

    const page = await pay(gym, leeApp, lee);
    // Square cannot be reached when its time comes: still held, so the desk waits rather than taking it twice.
    clock = new Date(clock.getTime() + APP_PAYMENT.openMs + 1000);
    square.linkState.deleteLinkDown = true;
    await work([gym.id]);
    expect((await check(gym, leeApp, page.payment.id)).payment.state).toBe("open");
    expect(errorOf(await byHand(gym, lee))).toBe("app_payment_open");
    // Square answers again: closed, and the page can no longer be paid.
    square.linkState.deleteLinkDown = false;
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect((await check(gym, leeApp, page.payment.id)).payment.state).toBe("closed");
    expect(square.payLink(linksOf(acct)[0]?.id ?? "")).toBe(false);
    const cash = await byHand(gym, lee);
    expect(cash.statusCode, cash.body).toBe(200);
    expect((await paymentsOf(gym.id)).map((p) => p.method)).toEqual(["cash"]);
  });

  it("Square taking another amount is kept and never put on the bill", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Other");
    const acct = account(`APO${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    for (const [what, over] of [
      ["a tip on top", { tip_money: { amount: 500, currency: "USD" }, total_money: { amount: 5499, currency: "USD" } }],
      ["less than asked", { amount_money: { amount: 4000, currency: "USD" }, total_money: { amount: 4000, currency: "USD" } }],
    ] as const) {
      const { holder: kim, app: kimApp } = await member(gym, typeId, `Kim ${what}`);
      const page = await pay(gym, kimApp, kim);
      const link = linksOf(acct).find((l) => l.referenceId === page.payment.id);
      square.payLink(link?.id ?? "", over);
      expect((await check(gym, kimApp, page.payment.id)).payment.state, what).toBe("check");
      expect(await paymentsOf(gym.id), what).toEqual([]);
      const [kept] = await sql<{ square_payment_id: string | null }[]>`SELECT square_payment_id FROM gym_app_payments WHERE id = ${page.payment.id}`;
      expect(kept?.square_payment_id, what).toBe(link?.paymentIds[0]);
      // Not paid in the app again until the desk has checked Square (18k-ii-b): Square may hold the money already.
      const again = await payPress(gym, kimApp, kim);
      expect(again.statusCode, again.body).toBe(409);
      expect(errorOf(again), what).toBe("app_payment_check");
    }
    // A card fee the business adds on top, which Square names, is the bill paid.
    const { holder: kim, app: kimApp } = await member(gym, typeId, "Kim Cho");
    const page = await pay(gym, kimApp, kim);
    const link = linksOf(acct).find((l) => l.referenceId === page.payment.id);
    square.payLink(link?.id ?? "", {
      amount_money: { amount: 5149, currency: "USD" },
      total_money: { amount: 5149, currency: "USD" },
      card_details: { card: { card_brand: "MASTERCARD", last_4: "4444" }, applied_card_surcharge_details: { card_surcharge_money: { amount: 150, currency: "USD" } } },
    });
    expect((await check(gym, kimApp, page.payment.id)).payment.state).toBe("paid");
    expect((await paymentsOf(gym.id)).map((p) => p.amount_minor)).toEqual([4999]);
  });

  it("refused before Square is asked: another amount or bill, the desk paying it, a gym not able to, Square refusing", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Refused");
    const acct = account(`APR${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const ava = await owing(gym, typeId, "Ava Diaz");
    const avaApp = await signedIn("Ava Diaz");
    await inApp(gym, avaApp, ava.entryId);

    // Part of the bill, more than it, or a later month: what the screen showed is no longer what is owed.
    for (const over of [{ amountMinor: 1000 }, { amountMinor: 5000 }, { periodIndex: 1 }]) {
      const res = await payPress(gym, avaApp, ava, over);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("app_payment_changed");
    }
    // The same key with another bill is not the same press.
    const key = randomUUID();
    await pay(gym, avaApp, ava, { requestKey: key });
    await close(gym, avaApp, (await pay(gym, avaApp, ava, { requestKey: key })).payment.id);
    expect(errorOf(await payPress(gym, avaApp, ava, { requestKey: key, amountMinor: 1000 }))).toBe("app_payment_changed");
    expect(linksOf(acct)).toHaveLength(1);

    // Square gives no answer, or makes the page for another amount: nothing is held and the member is told.
    square.linkState.linkDown = true;
    const down = await payPress(gym, avaApp, ava);
    expect(down.statusCode, down.body).toBe(503);
    square.linkState.linkDown = false;
    square.linkState.linkTotal = 6000;
    const other = await payPress(gym, avaApp, ava);
    expect(other.statusCode, other.body).toBe(409);
    expect(errorOf(other)).toBe("app_payment_refused");
    square.linkState.linkTotal = null;
    expect(linksOf(acct).filter((l) => !l.deleted)).toHaveLength(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_app_payments WHERE gym_id = ${gym.id} AND state = 'open'`)[0]?.n).toBe(0);
    expect((await byHand(gym, ava)).statusCode).toBe(200);
    // Her next month is owed only once it is due: paying ahead is taken at the desk.
    const ahead = await payPress(gym, avaApp, ava, { periodIndex: 1 });
    expect(ahead.statusCode, ahead.body).toBe(409);
    expect(errorOf(ahead)).toBe("app_payment_not_due");

    // A gym connected before the app asked for orders: members read that they pay at the desk; the owner reads why to
    // reconnect; Terminals keep working.
    const old = await makeGym("App Pay Old");
    const oldAcct = account(`APX${uniq().slice(-6)}`);
    await connect(old, oldAcct);
    await sql`UPDATE gym_payment_connections SET scopes = array_remove(array_remove(scopes, 'ORDERS_READ'), 'ORDERS_WRITE') WHERE gym_id = ${old.id}`;
    const oldType = await typeOf(old);
    const ben = await owing(old, oldType, "Ben Ode");
    const benApp = await signedIn("Ben Ode");
    await inApp(old, benApp, ben.entryId);
    expect(myAppPaymentsResponseSchema.parse(JSON.parse((await send("GET", payUrl(old), benApp.cookies)).body)).inApp).toBe(false);
    const notYet = await payPress(old, benApp, ben);
    expect(notYet.statusCode, notYet.body).toBe(409);
    expect(errorOf(notYet)).toBe("app_payment_not_offered");
    const settings = gymPaymentsResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${old.id}/payments`, old.owner.cookies)).body)).payments;
    expect(settings.allowFor).toContain("app_payments");
    expect(settings.terminals?.needsAllow).toBe(false);

    // The gym's plan with us ends: not offered either.
    const unpaid = await makeGym("App Pay No Plan");
    await connect(unpaid, account(`APN${uniq().slice(-6)}`));
    const unpaidType = await typeOf(unpaid);
    const joe = await owing(unpaid, unpaidType, "Joe Roe");
    const joeApp = await signedIn("Joe Roe");
    await inApp(unpaid, joeApp, joe.entryId);
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${unpaid.id}`;
    expect(myAppPaymentsResponseSchema.parse(JSON.parse((await send("GET", payUrl(unpaid), joeApp.cookies)).body)).inApp).toBe(false);
    expect(errorOf(await payPress(unpaid, joeApp, joe))).toBe("app_payment_not_offered");
  });
  /** A Terminal paired by the gym, in the fake Square, that waits for the person (pairing is `squareTerminals.routes.test.ts`'s). */
  const terminalOf = async (gym: Gym, acct: Account): Promise<string> => {
    const deviceId = `R5${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    square.devices.set(deviceId, { accountId: acct.merchantId, behaviour: "person" });
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
      VALUES (${gym.id}, 'production', ${acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${gym.owner.userId})
      RETURNING id`;
    if (row === undefined) throw new Error("no terminal");
    return row.id;
  };
  /** A card on file for a record, as Card on file keeps one, and in the fake Square account. */
  const cardFor = async (gym: Gym, entryId: string, acct: Account): Promise<string> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, acct.merchantId, customerId, "pays");
    return cardId;
  };
  /** The membership moved a month back, so its second month's bill falls due today; the run opens it. */
  const monthOn = async (gym: Gym, h: Holder) => {
    await sql`UPDATE gym_held_memberships SET starts_on = (starts_on - interval '1 month')::date WHERE gym_id = ${gym.id} AND id = ${h.membershipId}`;
    await sql`UPDATE gym_member_bills SET due_on = (due_on - interval '1 month')::date, covers_from = (covers_from - interval '1 month')::date, covers_to = (covers_to - interval '1 month')::date WHERE gym_id = ${gym.id} AND held_membership_id = ${h.membershipId}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
  };
  const chargedFrom = (cardId: string) => square.charged.filter((p) => p.cardId === cardId);

  it("the card on file is never charged while a page is open, nor for a bill a page may have paid; the Terminal waits too", async () => {
    // Midday in Austin: the worker charges a card from 6 in the morning on the gym's clock.
    clock = new Date();
    clock.setUTCHours(18, 0, 0, 0);
    const gym = await makeGym("App Pay Card");
    const acct = account(`APK${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const tara = await owing(gym, typeId, "Tara Card");
    const taraApp = await signedIn("Tara Card");
    await inApp(gym, taraApp, tara.entryId);
    // Her first month paid at the desk; her second falls due today, with a card on file the worker charges by itself.
    expect((await byHand(gym, tara)).statusCode).toBe(200);
    await monthOn(gym, tara);
    const card = await cardFor(gym, tara.entryId, acct);
    const owed = (await held(gym, gym.owner, tara.entryId)).memberships[0]?.billing?.pay;
    expect(owed).toMatchObject({ periodIndex: 1, leftMinor: 4999 });

    // Her page open: the worker's minute charges nothing; staff's Charge card on file and Take payment on Terminal wait.
    const page = await pay(gym, taraApp, tara, { periodIndex: 1 });
    await work([gym.id]);
    expect(chargedFrom(card)).toEqual([]);
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, tara.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    const staffCharge = await send("POST", `${entryUrl(gym, tara.entryId)}/memberships/${tara.membershipId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: 1,
      amountMinor: 4999,
      cardRef: box.cardOnFile?.ref ?? "",
    });
    expect(staffCharge.statusCode, staffCharge.body).toBe(409);
    expect(errorOf(staffCharge)).toBe("app_payment_open");
    const desk = await terminalOf(gym, acct);
    const onTerminal = await send("POST", `${entryUrl(gym, tara.entryId)}/memberships/${tara.membershipId}/terminal-payment`, gym.owner.cookies, {
      terminalId: desk,
      requestKey: randomUUID(),
      periodIndex: 1,
      amountMinor: 4999,
    });
    expect(onTerminal.statusCode, onTerminal.body).toBe(409);
    expect(errorOf(onTerminal)).toBe("app_payment_open");

    // Square takes another amount than asked: kept, not on the bill. Staff read what to check, the phone says so too, and the
    // worker still charges nothing for that bill.
    const link = linksOf(acct).find((l) => l.referenceId === page.payment.id);
    square.payLink(link?.id ?? "", { tip_money: { amount: 500, currency: "USD" }, total_money: { amount: 5499, currency: "USD" } });
    expect((await check(gym, taraApp, page.payment.id)).payment.state).toBe("check");
    const view = (await held(gym, gym.owner, tara.entryId)).memberships[0]?.billing;
    expect(view?.appPayment).toBeNull();
    // What Square really took, never the bill's amount.
    expect(view?.appCheck).toMatchObject({ why: "taken", amountMinor: 5499, payerName: "Tara Card" });
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect(chargedFrom(card)).toEqual([]);
    // Once staff have checked Square and taken it at the desk, the line goes.
    const cash = await send("POST", `${entryUrl(gym, tara.entryId)}/memberships/${tara.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 1, amountMinor: 4999, method: "cash" });
    expect(cash.statusCode, cash.body).toBe(200);
    expect((await held(gym, gym.owner, tara.entryId)).memberships[0]?.billing?.appCheck).toBeNull();
  });

  it("a Terminal payment waiting, or the card being charged, keeps the member's Pay away", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Desk");
    const acct = account(`APD${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const ravi = await owing(gym, typeId, "Ravi Desk");
    const raviApp = await signedIn("Ravi Desk");
    await inApp(gym, raviApp, ravi.entryId);
    const desk = await terminalOf(gym, acct);
    const started = await send("POST", `${entryUrl(gym, ravi.entryId)}/memberships/${ravi.membershipId}/terminal-payment`, gym.owner.cookies, {
      terminalId: desk,
      requestKey: randomUUID(),
      periodIndex: 0,
      amountMinor: 4999,
    });
    expect(started.statusCode, started.body).toBe(200);
    const atDesk = await payPress(gym, raviApp, ravi);
    expect(atDesk.statusCode, atDesk.body).toBe(409);
    expect(errorOf(atDesk)).toBe("app_payment_at_desk");
    expect(linksOf(acct)).toHaveLength(0);
    // The card on file being charged holds it the same way.
    await sql`UPDATE gym_terminal_payments SET state = 'done', outcome = 'cancelled', finished_at = now() WHERE gym_id = ${gym.id}`;
    const card = await cardFor(gym, ravi.entryId, acct);
    await sql`
      INSERT INTO gym_card_charges (gym_id, entry_id, held_membership_id, period_index, customer_id, card_id, brand, last4, amount_minor, currency, environment, account_id,
                                    location_id, request_key, payment_key, state, by_schedule, started_by, started_at, checked_at, checking_until)
      VALUES (${gym.id}, ${ravi.entryId}, ${ravi.membershipId}, 0, 'CUSTDESK', ${card}, 'VISA', '1111', 4999, 'USD', 'production', ${acct.merchantId},
              ${acct.locations[0]?.id ?? ""}, ${randomUUID()}, ${randomUUID()}, 'charging', false, ${gym.owner.userId}, now(), now(), now())`;
    expect(errorOf(await payPress(gym, raviApp, ravi))).toBe("app_payment_at_desk");
  });

  it("only exactly what was asked goes on the bill: another order, another location, two payments, or one that never finishes", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Exact");
    const acct = account(`APE${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    for (const [what, over, times] of [
      ["another order", { order_id: "someotherorder" }, 1],
      ["another location", { location_id: "LELSEWHERE" }, 1],
      ["two payments", {}, 2],
    ] as const) {
      // Somebody each: a bill whose page needs a check is not paid in the app again.
      const { holder: pia, app: piaApp } = await member(gym, typeId, `Pia ${what}`);
      const page = await pay(gym, piaApp, pia);
      square.payLink(linksOf(acct).find((l) => l.referenceId === page.payment.id)?.id ?? "", over, times);
      expect((await check(gym, piaApp, page.payment.id)).payment.state, what).toBe("check");
      expect(await paymentsOf(gym.id), what).toEqual([]);
      // The line names all Square took: both payments where the order names two.
      expect((await held(gym, gym.owner, pia.entryId)).memberships[0]?.billing?.appCheck?.amountMinor, what).toBe(times === 2 ? 9998 : 4999);
    }

    // A payment Square never finishes, or one that FAILED on a page nobody closes: the page holds the membership no longer
    // than a day, then the bill says to check Square, and the desk can take it.
    for (const [what, status] of [
      ["never finishes", "APPROVED"],
      ["failed", "FAILED"],
    ] as const) {
      clock = new Date();
      const { holder: pia, app: piaApp } = await member(gym, typeId, `Pia ${what}`);
      const page = await pay(gym, piaApp, pia);
      square.payLink(linksOf(acct).find((l) => l.referenceId === page.payment.id)?.id ?? "", { status });
      expect((await check(gym, piaApp, page.payment.id)).payment.state, what).toBe("open");
      clock = new Date(clock.getTime() + APP_PAYMENT.giveUpMs + 60_000);
      await work([gym.id]);
      expect((await check(gym, piaApp, page.payment.id)).payment.state, what).toBe("check");
      expect((await held(gym, gym.owner, pia.entryId)).memberships[0]?.billing?.appCheck, what).toMatchObject({ why: "unknown", amountMinor: null, payerName: `Pia ${what}` });
      expect((await held(gym, gym.owner, pia.entryId)).memberships[0]?.billing?.appPayment, what).toBeNull();
    }
    // A FAILED payment on a page the member leaves is no payment: the page closes and its order is cancelled.
    clock = new Date();
    const { holder: pia, app: piaApp } = await member(gym, typeId, "Pia Exact");
    const left = await pay(gym, piaApp, pia);
    const leftLink = linksOf(acct).find((l) => l.referenceId === left.payment.id);
    if (leftLink !== undefined) {
      leftLink.paymentIds.push("failedpay1");
      square.payments.set("failedpay1", { id: "failedpay1", status: "FAILED", amount_money: { amount: 4999, currency: "USD" }, order_id: leftLink.orderId, accountId: acct.merchantId });
    }
    expect((await close(gym, piaApp, left.payment.id)).payment.state).toBe("closed");
    expect(leftLink?.orderState).toBe("CANCELED");
  });

  it("three presses at once open one page; another gym's staff cannot close it; many members share one address", async () => {
    clock = new Date();
    const gymA = await makeGym("App Pay Race A");
    const gymB = await makeGym("App Pay Race B");
    const acct = account(`APX${uniq().slice(-6)}`);
    await connect(gymA, acct);
    await connect(gymB, account(`APY${uniq().slice(-6)}`));
    const typeId = await typeOf(gymA);
    const ola = await owing(gymA, typeId, "Ola Race");
    const olaApp = await signedIn("Ola Race");
    await inApp(gymA, olaApp, ola.entryId);
    const presses = await Promise.all([payPress(gymA, olaApp, ola), payPress(gymA, olaApp, ola), payPress(gymA, olaApp, ola)]);
    expect(presses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(presses.map((r) => appPaymentResponseSchema.parse(JSON.parse(r.body)).payment.id)).size).toBe(1);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_app_payments WHERE gym_id = ${gymA.id} AND state = 'open'`)[0]?.n).toBe(1);
    // Any page Square made for a press that lost is deleted there: one can be paid.
    expect(linksOf(acct).filter((l) => !l.deleted)).toHaveLength(1);

    // Another gym's owner, on A's address or their own, reaches nothing.
    for (const gym of [gymA, gymB]) {
      const res = await staffClose(gym, gymB.owner, ola);
      expect(res.statusCode, res.body).toBe(404);
    }
    expect((await sql<{ close_wanted_at: Date | null }[]>`SELECT close_wanted_at FROM gym_app_payments WHERE gym_id = ${gymA.id} AND state = 'open'`)[0]?.close_wanted_at).toBeNull();

    // One gym's wi-fi address: the address's allowance is many members' (a member's own is 30 an hour).
    const shared = "10.77.0.1";
    for (let i = 0; i < 2000; i++) await redis.incrWithTtl(`rl:app_payment:ip:${shared}`, 3600);
    for (const name of ["Ann Wifi", "Bo Wifi", "Cy Wifi"]) {
      const who = await owing(gymA, typeId, name);
      const app = await signedIn(name);
      await inApp(gymA, app, who.entryId);
      const res = await sendFrom(shared, "POST", payUrl(gymA), app.cookies, { requestKey: randomUUID(), membershipId: who.membershipId, periodIndex: 0, amountMinor: 4999 });
      expect(res.statusCode, `${name} ${res.body}`).toBe(200);
    }
    // One member who used up their own is refused, and the next member at the same address is not.
    for (let i = 0; i < 30; i++) await redis.incrWithTtl(`rl:app_payment:id:${olaApp.userId}`, 3600);
    const spent = await sendFrom(shared, "POST", payUrl(gymA), olaApp.cookies, { requestKey: randomUUID(), membershipId: ola.membershipId, periodIndex: 0, amountMinor: 4999 });
    expect(spent.statusCode).toBe(429);
  });

  it("Close payment page never says nothing was paid when Square may have taken money, and Delete permanently waits", async () => {
    clock = new Date();
    const gym = await makeGym("App Pay Honest");
    const acct = account(`APH${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const una = await owing(gym, typeId, "Una Honest");
    const unaApp = await signedIn("Una Honest");
    await inApp(gym, unaApp, una.entryId);
    // Paid with another amount at the very moment staff close it.
    const page = await pay(gym, unaApp, una);
    const link = linksOf(acct).find((l) => l.referenceId === page.payment.id);
    square.linkState.beforeLinkDelete = () => {
      square.payLink(link?.id ?? "", { tip_money: { amount: 100, currency: "USD" }, total_money: { amount: 5099, currency: "USD" } });
    };
    const res = await staffClose(gym, gym.owner, una);
    expect(appPaymentCloseResponseSchema.parse(JSON.parse(res.body)).outcome).toBe("check");
    expect((await held(gym, gym.owner, una.entryId)).memberships[0]?.billing?.appCheck).toMatchObject({ why: "taken", amountMinor: 5099, payerName: "Una Honest" });

    // A past member paying a bill they left owing: Delete permanently waits for their page to close.
    const vic = await owing(gym, typeId, "Vic Past");
    const vicApp = await signedIn("Vic Past");
    await inApp(gym, vicApp, vic.entryId);
    const open = await pay(gym, vicApp, vic);
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${vic.entryId}`;
    const deleted = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${vic.entryId}`, gym.owner.cookies);
    expect(deleted.statusCode, deleted.body).toBe(409);
    expect(errorOf(deleted)).toBe("app_payment_open");
    await close(gym, vicApp, open.payment.id);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_list_entries WHERE id = ${vic.entryId}`)[0]?.n).toBe(1);
  });

  // ── A fee paid in the app (18k-ii-b) ──────────────────────────────────────────────────────────────

  /** A class they booked yesterday on their membership, and the class list's mark on it, which opens or takes off its fee. */
  const classYesterday = async (gym: Gym, who: Holder, person: Person, name: string) => {
    const [classType] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gym.id}, ${name}, 45, NULL, 'blue', false) RETURNING id`;
    const startsAt = new Date(clock.getTime() - 24 * 60 * 60_000);
    const [session] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${classType?.id ?? ""}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, NULL, 'scheduled'
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'America/Chicago' AS l) x
      RETURNING id`;
    const [booking] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, request_key, booked_at)
      VALUES (${gym.id}, ${session?.id ?? ""}, ${person.userId}, ${who.entryId}, ${who.membershipId}, 'booked', ${randomUUID()}, ${new Date(startsAt.getTime() - 60 * 60_000)})
      RETURNING id`;
    const mark = async (status: "no_show" | "attended") => {
      const res = await send("POST", `/v1/orgs/${gym.id}/class-sessions/${session?.id ?? ""}/bookings/${booking?.id ?? ""}/mark`, gym.owner.cookies, { status });
      expect(res.statusCode, res.body).toBe(200);
    };
    /** The fee as the class's list says it, under their mark. */
    const onList = async (): Promise<unknown> => {
      const res = await send("GET", `/v1/orgs/${gym.id}/class-sessions/${session?.id ?? ""}/bookings`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const find = (o: unknown): unknown => {
        if (Array.isArray(o)) return o.map(find).find((x) => x !== undefined);
        if (o === null || typeof o !== "object") return undefined;
        const rec = o as Record<string, unknown>;
        return rec["bookingId"] === booking?.id ? rec["fee"] : Object.values(rec).map(find).find((x) => x !== undefined);
      };
      return find(JSON.parse(res.body));
    };
    return Object.assign(mark, { onList });
  };
  /** A personal training session yesterday with the owner, on their membership, and its mark (18h-ii). */
  const sessionYesterday = async (gym: Gym, who: Holder) => {
    const startsAt = new Date(clock.getTime() - 24 * 60 * 60_000);
    const [session] = await sql<{ id: string }[]>`
      INSERT INTO gym_pt_appointments (gym_id, trainer_user_id, entry_id, held_membership_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, request_key, booked_by)
      SELECT ${gym.id}, ${gym.owner.userId}, ${who.entryId}, ${who.membershipId}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt},
             ${new Date(startsAt.getTime() + 60 * 60_000)}, 60, 'booked', ${randomUUID()}, ${gym.owner.userId}
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'America/Chicago' AS l) x
      RETURNING id`;
    const mark = async (status: "no_show" | "attended") => {
      const res = await send("POST", `/v1/orgs/${gym.id}/pt/appointments/${session?.id ?? ""}/mark`, gym.owner.cookies, { status });
      expect(res.statusCode, res.body).toBe(200);
    };
    /** The fee as the trainer's week reads it (`appointmentsOf` and this share one read). */
    const onWeek = async () => (await appointmentById(sql, gym.id, session?.id ?? "", false))?.fee ?? null;
    return Object.assign(mark, { onWeek });
  };
  const feesOf = async (gym: Gym, who: Holder) => (await held(gym, gym.owner, who.entryId)).memberships.find((m) => m.id === who.membershipId)?.billing?.fees ?? [];
  const feePress = (gym: Gym, by: Person, who: Holder, feeId: string, over: Record<string, unknown> = {}) =>
    send("POST", payUrl(gym), by.cookies, { requestKey: randomUUID(), membershipId: who.membershipId, feeId, amountMinor: 1000, ...over });
  const payFee = async (gym: Gym, by: Person, who: Holder, feeId: string, over: Record<string, unknown> = {}) => parsed(await feePress(gym, by, who, feeId, over));
  const feeUrl = (gym: Gym, who: Holder, feeId: string) => `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/fees/${feeId}`;
  const billStatus = async (billId: string) => (await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE id = ${billId}`)[0]?.status;
  const linkOf = (acct: Account, page: AppPaymentResponse) => linksOf(acct).find((l) => l.referenceId === page.payment.id);
  const DAY = "\\d{1,2} [A-Z][a-z]{2} \\d{4}";

  it("a fee, the worst thing: what Square took pays this fee once, nobody else's page reaches it, and nothing else pays or waives it meanwhile", async () => {
    clock = new Date();
    const gymA = await makeGym("App Fee Worst A");
    const gymB = await makeGym("App Fee Worst B");
    const accountA = account(`AFWA${uniq().slice(-6)}`);
    const accountB = account(`AFWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    await sql`UPDATE gyms SET class_no_show_fee_minor = 1000 WHERE id IN (${gymA.id}, ${gymB.id})`;
    const goldA = await typeOf(gymA);
    const { holder: tara, app: taraApp } = await member(gymA, goldA, "Tara Singh");
    const { holder: sam, app: samApp } = await member(gymA, goldA, "Sam Lee");
    const { holder: priya, app: priyaApp } = await member(gymA, goldA, "Priya Sharma");
    const { holder: bea, app: beaApp } = await member(gymB, await typeOf(gymB), "Bea Brown");
    const stranger = await signedIn("A Stranger");
    // Priya pays for Sam (18i): Sam's fees are hers to read and pay.
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${gymA.id}, ${sam.entryId}, ${priya.entryId}, ${gymA.owner.userId})`;
    // Each marked No-show on yesterday's class: $10.00 each.
    await (await classYesterday(gymA, tara, taraApp, "Spin"))("no_show");
    await (await classYesterday(gymA, sam, samApp, "Spin at 7"))("no_show");
    await (await classYesterday(gymB, bea, beaApp, "Spin"))("no_show");
    const taraFee = (await feesOf(gymA, tara))[0]?.id ?? "";
    const samFee = (await feesOf(gymA, sam))[0]?.id ?? "";
    const beaFee = (await feesOf(gymB, bea))[0]?.id ?? "";
    expect((await feesOf(gymA, tara))[0]).toMatchObject({ fee: "no_show", amountMinor: 1000, state: "due", appPayment: null });
    // My membership names each fee owed, for Pay.
    const mineRead = myMembershipResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymA.id}/my-membership`, taraApp.cookies)).body));
    expect(mineRead.memberships[0]?.fees).toMatchObject([{ id: taraFee, fee: "no_show", amountMinor: 1000, state: "due" }]);

    // Nobody reaches a fee that is not theirs to pay: Sam's own (Priya pays it), Tara on Sam's, Priya on Tara's, B's member at
    // A, a stranger, A's owner, Tara at B; and Tara's own membership named with Sam's fee or B's.
    for (const [gym, who, holder, feeId] of [
      [gymA, samApp, sam, samFee],
      [gymA, taraApp, sam, samFee],
      [gymA, priyaApp, tara, taraFee],
      [gymA, beaApp, tara, taraFee],
      [gymA, stranger, tara, taraFee],
      [gymA, gymA.owner, tara, taraFee],
      [gymB, taraApp, bea, beaFee],
      [gymA, taraApp, tara, samFee],
      [gymA, taraApp, tara, beaFee],
    ] as const) {
      const res = await feePress(gym, who, holder, feeId);
      expect(res.statusCode, res.body).toBe(404);
    }
    expect(linksOf(accountA)).toHaveLength(0);
    expect(linksOf(accountB)).toHaveLength(0);

    // Tara presses Pay on her fee: Square's page for exactly it, listed as the fee it is, naming nobody.
    const started = await payFee(gymA, taraApp, tara, taraFee);
    expect(started.payment).toMatchObject({ state: "open", amountMinor: 1000, currency: "USD", membershipId: tara.membershipId, feeId: taraFee, periodIndex: null, receiptNumber: null });
    const link = linkOf(accountA, started);
    expect(link).toMatchObject({ amount: 1000, currency: "USD", locationId: accountA.locations[0]?.id, note: "No-show fee", orderState: "DRAFT" });
    expect(link?.name).toMatch(new RegExp(`^No-show fee, Spin, ${DAY}$`));
    expect(await paymentsOf(gymA.id)).toEqual([]);
    // Staff read it under the fee, not under her bill.
    const open = (await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing;
    expect(open?.fees[0]?.appPayment).toMatchObject({ id: started.payment.id, payerName: "Tara Singh" });
    expect(open?.appPayment).toBeNull();
    // Only Close payment page is offered meanwhile: neither Record payment nor Waive fee.
    expect(open?.fees[0]?.can).toMatchObject({ pay: false, waive: false });
    // Pressed again: the same page, never a second; her month waits for it.
    expect((await payFee(gymA, taraApp, tara, taraFee)).payment.id).toBe(started.payment.id);
    expect(errorOf(await payPress(gymA, taraApp, tara))).toBe("app_payment_other_open");
    expect(linksOf(accountA)).toHaveLength(1);

    // While it is open nothing else pays or waives her fee, by hand or on the Terminal, nor takes her month by hand.
    for (const [path, body] of [
      [`${feeUrl(gymA, tara, taraFee)}/payments`, { requestKey: randomUUID(), amountMinor: 1000, method: "cash" }],
      [`${feeUrl(gymA, tara, taraFee)}/waive`, {}],
      [`${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments`, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" }],
      [`${feeUrl(gymA, tara, taraFee)}/terminal-payment`, { terminalId: await terminalOf(gymA, accountA), requestKey: randomUUID(), amountMinor: 1000 }],
    ] as const) {
      const res = await send("POST", path, gymA.owner.cookies, body);
      expect(res.statusCode, `${path} ${res.body}`).toBe(409);
      expect(errorOf(res), path).toBe("app_payment_open");
    }
    // Priya pays Sam's fee, on a page of her own.
    expect((await payFee(gymA, priyaApp, sam, samFee)).payment.feeId).toBe(samFee);

    // Tara pays on Square's page: her fee reads paid once, In the app, with Square's payment and no member of staff.
    expect(square.payLink(link?.id ?? "")).toBe(true);
    const paid = await check(gymA, taraApp, started.payment.id);
    expect(paid.payment).toMatchObject({ state: "paid", url: null });
    expect(paid.payment.receiptNumber).not.toBeNull();
    expect(await paymentsOf(gymA.id)).toEqual([
      { bill_id: taraFee, held_membership_id: tara.membershipId, amount_minor: 1000, method: "app", provider: "square", provider_payment_id: link?.paymentIds[0], recorded_by: null },
    ]);
    // Asked again by the worker, and with the page marked open by hand: still one payment.
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gymA.id]);
    await sql`UPDATE gym_app_payments SET state = 'open', outcome = NULL, member_payment_id = NULL, finished_at = NULL WHERE id = ${started.payment.id}`;
    await work([gymA.id]);
    expect((await paymentsOf(gymA.id)).filter((p) => p.held_membership_id === tara.membershipId)).toHaveLength(1);

    // The fee is no longer owed: the desk cannot take it again; it names the card; Square holds the money, so no Void.
    const fee = (await feesOf(gymA, tara))[0];
    expect(fee).toMatchObject({ state: "paid", appPayment: null, appCheck: null, can: { pay: false, waive: false, voidPaymentId: null } });
    expect(fee?.payments[0]).toMatchObject({ method: "app", amountMinor: 1000, card: { brand: "VISA", last4: "1111" } });
    const again = await send("POST", `${feeUrl(gymA, tara, taraFee)}/payments`, gymA.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, method: "cash" });
    expect(again.statusCode, again.body).toBe(409);
    const voided = await send("POST", `${feeUrl(gymA, tara, taraFee)}/payments/${fee?.payments[0]?.id ?? ""}/void`, gymA.owner.cookies, { reason: "mistake" });
    expect(errorOf(voided)).toBe("app_payment_void");
    // Her own page says paid, with its receipt; her month, Sam's fee and B's fee are untouched.
    const mineAfter = myMembershipResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymA.id}/my-membership`, taraApp.cookies)).body));
    expect(mineAfter.memberships[0]?.fees[0]).toMatchObject({ id: taraFee, state: "paid", receiptNumber: paid.payment.receiptNumber });
    expect((await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing?.pay).toMatchObject({ leftMinor: 4999 });
    expect(await billStatus(samFee)).toBe("open");
    expect(await billStatus(beaFee)).toBe("open");
  });

  it("marked Came while they pay their fee: the page is closed and the fee comes off once it has; paid meanwhile, it is on Refunds to review", async () => {
    clock = new Date();
    const gym = await makeGym("App Fee Came");
    const acct = account(`AFC${uniq().slice(-6)}`);
    await connect(gym, acct);
    await sql`UPDATE gyms SET class_no_show_fee_minor = 1000, pt_no_show_fee_minor = 1500 WHERE id = ${gym.id}`;
    const typeId = await typeOf(gym);
    const { holder: ravi, app: raviApp } = await member(gym, typeId, "Ravi Das");
    const mark = await classYesterday(gym, ravi, raviApp, "Spin");
    await mark("no_show");
    const fee = (await feesOf(gym, ravi))[0]?.id ?? "";
    const page = await payFee(gym, raviApp, ravi, fee);

    // Staff mark him Came: the fee is not taken off while his page is open, the page says why, and it is asked closed.
    await mark("attended");
    expect(await billStatus(fee)).toBe("open");
    expect((await feesOf(gym, ravi))[0]).toMatchObject({ state: "due", stillOwed: false, appPayment: { id: page.payment.id } });
    expect((await sql<{ close_wanted_by: string | null }[]>`SELECT close_wanted_by FROM gym_app_payments WHERE id = ${page.payment.id}`)[0]?.close_wanted_by).toBe("removed");
    // No-show and Came again meanwhile: still the one fee.
    await mark("no_show");
    await mark("attended");
    expect(await feesOf(gym, ravi)).toHaveLength(1);

    // The worker closes the page at Square, then the fee comes off: he came, so he owes nothing, and the page can't be paid.
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect((await check(gym, raviApp, page.payment.id)).payment.state).toBe("closed");
    expect(await billStatus(fee)).toBe("void");
    expect(await feesOf(gym, ravi)).toEqual([]);
    expect(square.payLink(linkOf(acct, page)?.id ?? "")).toBe(false);
    expect(await paymentsOf(gym.id)).toEqual([]);

    // Marked No-show again: a new fee. He pays it, staff mark him Came, and Square takes his money before the page closes:
    // the fee is paid, In the app, and as he no longer owes it, Refunds to review lists it for staff to give back or keep.
    await mark("no_show");
    const second = (await feesOf(gym, ravi)).find((f) => f.state === "due")?.id ?? "";
    expect(second).not.toBe(fee);
    const page2 = await payFee(gym, raviApp, ravi, second);
    await mark("attended");
    square.payLink(linkOf(acct, page2)?.id ?? "");
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect((await check(gym, raviApp, page2.payment.id)).payment.state).toBe("paid");
    expect(await billStatus(second)).toBe("paid");
    expect((await feesOf(gym, ravi)).find((f) => f.id === second)).toMatchObject({ state: "paid", stillOwed: false });
    const review = refundsToReviewResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/refunds-to-review`, gym.owner.cookies)).body));
    expect(review.rows.map((r) => [r.kind, r.id, r.amountMinor])).toEqual([["fee", second, 1000]]);

    // A personal training session holds to the same, and Square's page names no trainer.
    const session = await sessionYesterday(gym, ravi);
    await session("no_show");
    const ptFee = (await feesOf(gym, ravi)).find((f) => f.of === "pt")?.id ?? "";
    const page3 = await payFee(gym, raviApp, ravi, ptFee, { amountMinor: 1500 });
    expect(linkOf(acct, page3)?.name).toMatch(new RegExp(`^No-show fee, Personal training, ${DAY}$`));
    await session("attended");
    expect(await billStatus(ptFee)).toBe("open");
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect((await check(gym, raviApp, page3.payment.id)).payment.state).toBe("closed");
    expect(await billStatus(ptFee)).toBe("void");
  });

  it("a freeze fee: the card on file is not charged for it while its page is open, nor once Square may have taken it; Pay waits for the desk", async () => {
    // Midday in Austin: the worker charges a card from 6 in the morning on the gym's clock.
    clock = new Date();
    clock.setUTCHours(18, 0, 0, 0);
    const gym = await makeGym("App Fee Freeze");
    const acct = account(`AFF${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const setFee = await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 0, freezeFeeMinor: 1500 });
    expect(setFee.statusCode, setFee.body).toBe(200);
    /** Their first month paid at the desk, frozen with the gym's fee, its month owed today, and a card on file. */
    const frozen = async (name: string) => {
      const { holder, app } = await member(gym, typeId, name);
      expect((await byHand(gym, holder)).statusCode).toBe(200);
      const res = await send("POST", `${entryUrl(gym, holder.entryId)}/memberships/${holder.membershipId}/freeze`, gym.owner.cookies, { feeMinor: 1500 });
      expect(res.statusCode, res.body).toBe(200);
      await openDueFreezeFees({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
      const card = await cardFor(gym, holder.entryId, acct);
      const fee = (await feesOf(gym, holder)).find((f) => f.fee === "freeze");
      expect(fee).toMatchObject({ amountMinor: 1500, state: "due" });
      return { holder, app, card, fee: fee?.id ?? "" };
    };
    const mia = await frozen("Mia Frost");
    const ned = await frozen("Ned Frost");

    // Mia's page open: the worker charges Ned's card for his, and not Mia's for hers.
    const page = await payFee(gym, mia.app, mia.holder, mia.fee, { amountMinor: 1500 });
    expect(linkOf(acct, page)?.name).toMatch(new RegExp(`^Freeze fee, Gold Monthly, ${DAY} to ${DAY}$`));
    await work([gym.id]);
    expect(chargedFrom(ned.card)).toHaveLength(1);
    expect(chargedFrom(mia.card)).toEqual([]);

    // Square takes another amount: kept, never on the fee. Staff read under the fee what to check, the worker still
    // charges nothing for it, and Pay in the app waits for the desk.
    square.payLink(linkOf(acct, page)?.id ?? "", { tip_money: { amount: 200, currency: "USD" }, total_money: { amount: 1700, currency: "USD" } });
    expect((await check(gym, mia.app, page.payment.id)).payment.state).toBe("check");
    expect((await feesOf(gym, mia.holder))[0]).toMatchObject({ state: "due", appPayment: null, appCheck: { why: "taken", amountMinor: 1700, payerName: "Mia Frost" } });
    expect((await held(gym, gym.owner, mia.holder.entryId)).memberships[0]?.billing?.appCheck).toBeNull();
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect(chargedFrom(mia.card)).toEqual([]);
    const again = await feePress(gym, mia.app, mia.holder, mia.fee, { amountMinor: 1500 });
    expect(again.statusCode, again.body).toBe(409);
    expect(errorOf(again)).toBe("app_payment_check");
    // Once staff have checked Square and taken it at the desk, the line goes.
    const cash = await send("POST", `${feeUrl(gym, mia.holder, mia.fee)}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1500, method: "cash" });
    expect(cash.statusCode, cash.body).toBe(200);
    expect((await feesOf(gym, mia.holder))[0]?.appCheck).toBeNull();
  });

  it("a fee: another amount, one waived, paid or taken off, another page open, and a press naming both are refused before Square", async () => {
    clock = new Date();
    const gym = await makeGym("App Fee Refused");
    const acct = account(`AFR${uniq().slice(-6)}`);
    await connect(gym, acct);
    await sql`UPDATE gyms SET class_no_show_fee_minor = 1000 WHERE id = ${gym.id}`;
    const typeId = await typeOf(gym);
    const { holder: kai, app: kaiApp } = await member(gym, typeId, "Kai Moss");
    const mark = await classYesterday(gym, kai, kaiApp, "Spin");
    await mark("no_show");
    const fee = (await feesOf(gym, kai))[0]?.id ?? "";
    // Another amount: what the screen showed is not what is owed.
    for (const amountMinor of [999, 1001]) expect(errorOf(await feePress(gym, kaiApp, kai, fee, { amountMinor }))).toBe("app_payment_changed");
    // A bill and a fee in one press, or neither: not a press.
    for (const body of [
      { requestKey: randomUUID(), membershipId: kai.membershipId, periodIndex: 0, feeId: fee, amountMinor: 1000 },
      { requestKey: randomUUID(), membershipId: kai.membershipId, amountMinor: 1000 },
    ]) {
      expect((await send("POST", payUrl(gym), kaiApp.cookies, body)).statusCode).toBe(400);
    }
    // His month's page open: the fee waits for it, and the other way round.
    const month = await pay(gym, kaiApp, kai);
    expect(errorOf(await feePress(gym, kaiApp, kai, fee))).toBe("app_payment_other_open");
    await close(gym, kaiApp, month.payment.id);
    const feePage = await payFee(gym, kaiApp, kai, fee);
    expect(errorOf(await payPress(gym, kaiApp, kai))).toBe("app_payment_other_open");
    await close(gym, kaiApp, feePage.payment.id);
    expect(await billStatus(fee)).toBe("open");
    // Marked Came with no page open: taken off at once, as ever, and not paid in the app.
    await mark("attended");
    expect(await billStatus(fee)).toBe("void");
    expect(errorOf(await feePress(gym, kaiApp, kai, fee))).toBe("app_payment_changed");
    // Marked No-show again, then waived: not paid in the app.
    await mark("no_show");
    const second = (await feesOf(gym, kai)).find((f) => f.state === "due")?.id ?? "";
    expect((await send("POST", `${feeUrl(gym, kai, second)}/waive`, gym.owner.cookies, {})).statusCode).toBe(200);
    expect(errorOf(await feePress(gym, kaiApp, kai, second))).toBe("app_payment_changed");

    // An early cancellation fee, owed for good: a twelve-month membership cancelled inside its term with its fee. Her own
    // page lists it, she pays it in the app, named as such, and then not again.
    const twelve = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, { ...gold, name: "Gold 12", contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 2500 });
    expect(twelve.statusCode, twelve.body).toBe(201);
    const twelveId = (JSON.parse(twelve.body) as GymMembershipTypesResponse).types.find((t) => t.name === "Gold 12")?.id ?? "";
    const { holder: lea, app: leaApp } = await member(gym, twelveId, "Lea Leave");
    expect((await byHand(gym, lea)).statusCode).toBe(200);
    const cancelled = await send("POST", `${entryUrl(gym, lea.entryId)}/memberships/${lea.membershipId}/cancel`, gym.owner.cookies, { when: "leave_early", leaveFeeMinor: 2500 });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const theirs = myMembershipResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/my-membership`, leaApp.cookies)).body));
    const leave = theirs.memberships.flatMap((m) => m.fees).find((f) => f.fee === "leave_early");
    expect(leave).toMatchObject({ amountMinor: 2500, state: "due", stillOwed: true });
    const leavePage = await payFee(gym, leaApp, lea, leave?.id ?? "", { amountMinor: 2500 });
    expect(linkOf(acct, leavePage)).toMatchObject({ amount: 2500, note: "Early cancellation fee" });
    expect(linkOf(acct, leavePage)?.name).toMatch(new RegExp(`^Early cancellation fee, Gold 12, ${DAY}$`));
    square.payLink(linkOf(acct, leavePage)?.id ?? "");
    expect((await check(gym, leaApp, leavePage.payment.id)).payment.state).toBe("paid");
    expect(await billStatus(leave?.id ?? "")).toBe("paid");
    expect(errorOf(await feePress(gym, leaApp, lea, leave?.id ?? "", { amountMinor: 2500 }))).toBe("app_payment_changed");
    expect((await paymentsOf(gym.id)).filter((p) => p.method === "app").map((p) => [p.bill_id, p.amount_minor])).toEqual([[leave?.id, 2500]]);
  });

  it("marked Came while paying, and the page ends with money Square may have taken: the fee stays for the desk to check, and every page says so", async () => {
    clock = new Date();
    const gym = await makeGym("App Fee Held");
    const acct = account(`AFH${uniq().slice(-6)}`);
    await connect(gym, acct);
    await sql`UPDATE gyms SET class_no_show_fee_minor = 1000, pt_no_show_fee_minor = 1500 WHERE id = ${gym.id}`;
    const typeId = await typeOf(gym);

    // Ida pays her class's no-show fee; staff mark her Came; Square never finishes her payment.
    const { holder: ida, app: idaApp } = await member(gym, typeId, "Ida Held");
    const idaClass = await classYesterday(gym, ida, idaApp, "Spin");
    await idaClass("no_show");
    expect(await idaClass.onList()).toMatchObject({ state: "owed" });
    const idaFee = (await feesOf(gym, ida))[0]?.id ?? "";
    const idaPage = await payFee(gym, idaApp, ida, idaFee);
    await idaClass("attended");
    // The class's list says what her page says: it comes off once her page closes.
    expect(await idaClass.onList()).toMatchObject({ amountMinor: 1000, state: "held" });
    square.payLink(linkOf(acct, idaPage)?.id ?? "", { status: "APPROVED" });
    clock = new Date(clock.getTime() + APP_PAYMENT.giveUpMs + 60_000);
    await work([gym.id]);
    expect((await check(gym, idaApp, idaPage.payment.id)).payment.state).toBe("check");
    // Square may have her money: the fee is not taken off, it says to check Square, and only Waive fee is offered.
    expect(await billStatus(idaFee)).toBe("open");
    // A day on, it reads Overdue.
    expect((await feesOf(gym, ida))[0]).toMatchObject({ state: "overdue", stillOwed: false, appPayment: null, appCheck: { why: "unknown", payerName: "Ida Held" }, can: { pay: false, waive: true } });
    expect(await idaClass.onList()).toMatchObject({ state: "check" });
    const idaOwn = myMembershipResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/my-membership`, idaApp.cookies)).body));
    expect(idaOwn.memberships[0]?.fees[0]).toMatchObject({ id: idaFee, stillOwed: false });
    expect(errorOf(await feePress(gym, idaApp, ida, idaFee))).toBe("app_payment_changed");

    // Jo pays a session's no-show fee; staff mark him Came; the gym leaves that Square account while the page is open.
    clock = new Date();
    const { holder: jo, app: joApp } = await member(gym, typeId, "Jo Held");
    const joSession = await sessionYesterday(gym, jo);
    await joSession("no_show");
    const joFee = (await feesOf(gym, jo))[0]?.id ?? "";
    const joPage = await payFee(gym, joApp, jo, joFee, { amountMinor: 1500 });
    await joSession("attended");
    expect(await joSession.onWeek()).toMatchObject({ amountMinor: 1500, state: "held" });
    await sql`UPDATE gym_payment_connections SET access_token = NULL, refresh_token = NULL, state = 'removed', removed_at = now() WHERE gym_id = ${gym.id}`;
    clock = new Date(clock.getTime() + APP_PAYMENT.idleMs + 1000);
    await work([gym.id]);
    expect((await check(gym, joApp, joPage.payment.id)).payment.state).toBe("check");
    expect(await billStatus(joFee)).toBe("open");
    expect((await feesOf(gym, jo))[0]).toMatchObject({ stillOwed: false, appCheck: { why: "unknown" }, can: { pay: false, waive: true } });
    expect(await joSession.onWeek()).toMatchObject({ state: "check" });
    // Staff check Square, then waive it: nobody who came owes it.
    expect((await send("POST", `${feeUrl(gym, jo, joFee)}/waive`, gym.owner.cookies, {})).statusCode).toBe(200);
    expect(await joSession.onWeek()).toMatchObject({ state: "waived" });
  });
});
