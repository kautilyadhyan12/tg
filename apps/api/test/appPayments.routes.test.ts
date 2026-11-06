// Pay what they owe in the app (ROADMAP 18k-ii-a; spec Part 3 §14.8), through its routes against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, whose payment pages answer as
// Square's test area did on 2026-11-06 (`apps/api/.cost/18k-ii-a/probe-links.mts`).
//
// The first block is the worst thing this job could do to a real person: charged twice for one bill (their page and the
// desk, the card on file, or a second page at once), or charged and still shown as owing, or their money on somebody
// else's bill.
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
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type AppPaymentResponse,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
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
    const kim = await owing(gym, typeId, "Kim Cho");
    const kimApp = await signedIn("Kim Cho");
    await inApp(gym, kimApp, kim.entryId);
    for (const [what, over] of [
      ["a tip on top", { tip_money: { amount: 500, currency: "USD" }, total_money: { amount: 5499, currency: "USD" } }],
      ["less than asked", { amount_money: { amount: 4000, currency: "USD" }, total_money: { amount: 4000, currency: "USD" } }],
    ] as const) {
      const page = await pay(gym, kimApp, kim);
      const link = linksOf(acct).find((l) => l.referenceId === page.payment.id);
      square.payLink(link?.id ?? "", over);
      expect((await check(gym, kimApp, page.payment.id)).payment.state, what).toBe("not_recorded");
      expect(await paymentsOf(gym.id), what).toEqual([]);
      const [kept] = await sql<{ square_payment_id: string | null }[]>`SELECT square_payment_id FROM gym_app_payments WHERE id = ${page.payment.id}`;
      expect(kept?.square_payment_id, what).toBe(link?.paymentIds[0]);
    }
    // A card fee the business adds on top, which Square names, is the bill paid.
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
});
