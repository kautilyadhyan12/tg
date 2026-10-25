// Payments to match (ROADMAP 18d-iii-b-ii-a; spec Part 3 §14.8): the list of payments from Square Point
// of Sale, every one waiting for one press of Match (Kd, 2026-10-25), the bill it fits ticked where that is
// plain, Not for a bill and its Undo, and the card on file waiting meanwhile,
// through Square's signed messages, the worker's minute and the routes, against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`.
//
// The first block is the worst thing this job could do to a real person: a member charged twice, their
// card on file charged for a bill they may have paid in Square Point of Sale while that payment waits.
// Every claim is read from the tables, or from Square's own record of what it took, never from the
// reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  PAYMENTS_TO_MATCH_WORDS,
  failedPaymentsResponseSchema,
  heldMembershipsResponseSchema,
  matchBillsResponseSchema,
  matchPaymentResponseSchema,
  paymentToMatchStateResponseSchema,
  paymentsToMatchResponseSchema,
  paymentsToMatchSummarySchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentsResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type PaymentToMatch,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 10).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "payments-to-match-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "payments-to-match-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-PAYMENTSTOMATCH", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-PAYMENTSTOMATCHSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_pay_to_match";

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
  acct: Account;
  locationId: string;
}
interface Holder {
  entryId: string;
  membershipId: string;
}

let ipCounter = 0;
const nextIp = () => `10.59.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Payments to match (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  let clock = new Date();
  square.state.now = () => clock;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const gyms: Gym[] = [];
  /** The worker's minute, for these of Square's messages and this test's gyms alone. */
  const work = (eventIds: readonly string[] = []) =>
    processSquareWork(
      { sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock },
      eventIds,
      gyms.map((g) => g.id),
    );

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptm-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'ptm-t-%@example.com'`;
    await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${mineSql}) OR account_id LIKE 'MPTM%'`;
    await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'ptm-t-%'`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptm-t-%@example.com'`;
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
    const email = `ptm-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account of its own. */
  const makeGym = async (name: string, acct: Account = account(`MPTM${uniq()}`)): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    const gym = { id, name, owner, acct, locationId: acct.locations[0]?.id ?? "" };
    gyms.push(gym);
    return gym;
  };
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, weekly);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const toMatchUrl = (gym: Gym) => `/v1/orgs/${gym.id}/payments-to-match`;
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const person = async (gym: Gym, fullName: string, email = `ptm-r-${uniq()}@example.com`): Promise<string> => {
    let add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email });
    // Somebody of the same name is on the list already: added anyway, as staff can.
    if (add.statusCode === 409) {
      const people = (JSON.parse(add.body) as { people: { entryId: string }[] }).people.map((p) => p.entryId);
      add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email, acknowledgedDuplicates: people });
    }
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Gold Weekly from today, its first week paid at the desk in cash, then moved a week back so its second
   *  week's bill falls due today, opened by the bill run. */
  const owing = async (gym: Gym, typeId: string, entryId: string): Promise<Holder> => {
    const today = (await held(gym, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${m.id}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${m.id}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    return { entryId, membershipId: m.id };
  };
  /** A card on file for a record, as Card on file keeps one, on a Square customer of its own: the
   *  customer Square Point of Sale names when staff pick that person. */
  const cardFor = async (gym: Gym, entryId: string): Promise<{ cardId: string; customerId: string }> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CPTM${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, gym.acct.merchantId, customerId);
    return { cardId, customerId };
  };
  /** Square's signed message about a payment, through the real route. */
  const deliver = async (acct: Account, paymentId: string, type = "payment.created"): Promise<string> => {
    const eventId = `ptm-t-${uniq()}`;
    const payload = JSON.stringify({ merchant_id: acct.merchantId, type, event_id: eventId, data: { type: "payment", id: paymentId } });
    const signature = createHmac("sha256", WEBHOOK_KEY).update(WEBHOOK_URL + payload).digest("base64");
    const res = await api().inject({
      method: "POST",
      url: "/v1/webhooks/square",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "x-square-hmacsha256-signature": signature },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    await sql`UPDATE webhook_events SET not_before = ${clock} WHERE provider = 'square' AND event_id = ${eventId}`;
    return eventId;
  };
  /** A payment taken in Square Point of Sale, told to the app and taken in by the worker's minute. */
  const takenIn = async (gym: Gym, o: Parameters<typeof square.appPayment>[1]) => {
    const paid = square.appPayment(gym.acct, { locationId: gym.locationId, ...o });
    await work([await deliver(gym.acct, paid.id)]);
    return paid;
  };
  const rowOf = async (squarePaymentId: string) => {
    const [row] = await sql<{ id: string; state: string; reason: string | null; not_bill: string | null; entry_id: string | null; member_payment_id: string | null; entered_minor: number | null }[]>`
      SELECT id, state, reason, not_bill, entry_id, member_payment_id, entered_minor FROM gym_square_app_payments WHERE square_payment_id = ${squarePaymentId}`;
    if (row === undefined) throw new Error("not taken in");
    return row;
  };
  const billsOf = (h: Holder) =>
    sql<{ id: string; period_index: number | null; fee: string | null; status: string; amount_minor: number }[]>`
      SELECT id, period_index, fee, status, amount_minor FROM gym_member_bills WHERE held_membership_id = ${h.membershipId} ORDER BY period_index NULLS LAST, created_at`;
  const paymentsOf = (h: Holder) =>
    sql<{ id: string; bill_id: string; amount_minor: number; method: string; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT p.id, p.bill_id, p.amount_minor, p.method, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE b.held_membership_id = ${h.membershipId} AND p.undone_at IS NULL ORDER BY p.seq`;
  const second = async (h: Holder) => (await billsOf(h)).find((b) => b.period_index === 1);
  /** What Square took from a card on file. */
  const takenFrom = (cardId: string) => square.taken().filter((p) => p.cardId === cardId);
  const list = async (gym: Gym, cookies = gym.owner.cookies) => {
    const res = await send("GET", toMatchUrl(gym), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return paymentsToMatchResponseSchema.parse(JSON.parse(res.body));
  };
  const listed = async (gym: Gym, rowId: string): Promise<PaymentToMatch | undefined> => (await list(gym)).payments.find((p) => p.id === rowId);
  const match = (gym: Gym, rowId: string, h: Holder, body: { amountMinor: number; periodIndex?: number; requestKey?: string }, cookies = gym.owner.cookies) =>
    send("POST", `${toMatchUrl(gym)}/${rowId}/match`, cookies, {
      requestKey: body.requestKey ?? randomUUID(),
      entryId: h.entryId,
      membershipId: h.membershipId,
      target: { kind: "period", periodIndex: body.periodIndex ?? 1 },
      amountMinor: body.amountMinor,
    });
  /** Staff press Charge card on file for the bill due, as Record payment's Card on file sends it. */
  const chargePress = async (gym: Gym, h: Holder) => {
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, h.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    const pay = (await held(gym, h.entryId)).memberships.find((m) => m.id === h.membershipId)?.billing?.pay;
    return await send("POST", `${entryUrl(gym, h.entryId)}/memberships/${h.membershipId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: pay?.periodIndex ?? 1,
      amountMinor: pay?.leftMinor ?? 2500,
      cardRef: box.cardOnFile?.ref ?? "",
    });
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(config(), {
      squareApi: square.api,
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

  it("no member is charged twice: while a payment of Ben's from Square Point of Sale waits, nobody charges his card, for him or for whoever he pays for; Zoe, owing the same with nothing waiting, is charged", async () => {
    const gym = await makeGym(`Hold Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    // Five in the morning in Chicago: before the card on file is charged, at six.
    clock = new Date(`${today}T10:00:00Z`);

    const ben = await owing(gym, typeId, await person(gym, "Ben Ortiz"));
    const zoe = await owing(gym, typeId, await person(gym, "Zoe Park"));
    // Kai's bills are Ben's to pay (18i): charged to Ben's card.
    const kai = await owing(gym, typeId, await person(gym, "Kai Ortiz"));
    const payer = await send("PUT", `${entryUrl(gym, kai.entryId)}/payer`, gym.owner.cookies, { payerEntryId: ben.entryId });
    expect(payer.statusCode, payer.body).toBe(200);
    const benCard = await cardFor(gym, ben.entryId);
    const zoeCard = await cardFor(gym, zoe.entryId);

    // Ben pays at the desk in Square Point of Sale, staff picking him; Square adds its own tax on top of the
    // $25.00 typed. Nothing goes on a bill by itself, and his bill and Kai's are both $25.00: it waits for
    // staff to say which.
    const paid = await takenIn(gym, { amount: 2706, addedTax: 206, customerId: benCard.customerId });
    const row = await rowOf(paid.id);
    expect([row.state, row.reason, row.entry_id, row.entered_minor]).toEqual(["waiting", "several_bills", ben.entryId, 2500]);

    // Noon: the worker's minute charges the cards on file of the bills due today.
    clock = new Date(`${today}T17:00:00Z`);
    await work();
    await work();
    expect(takenFrom(benCard.cardId), "Ben's card is charged for nobody while his payment waits").toEqual([]);
    expect((await second(ben))?.status).toBe("open");
    expect((await second(kai))?.status, "nor Kai's bill, which Ben's card pays").toBe("open");
    expect(takenFrom(zoeCard.cardId).map((p) => p.amount_money.amount), "Zoe, with nothing waiting, is charged once").toEqual([2500]);
    expect((await second(zoe))?.status).toBe("paid");

    // Staff can't charge it either, from Record payment or for Kai: told why, and nothing reaches Square.
    for (const h of [ben, kai]) {
      const pressed = await chargePress(gym, h);
      expect(pressed.statusCode, pressed.body).toBe(409);
      expect((JSON.parse(pressed.body) as { error: string }).error).toBe("square_app_waiting");
      expect((JSON.parse(pressed.body) as { message: string }).message).toBe(PAYMENTS_TO_MATCH_WORDS.card_held);
    }
    expect(takenFrom(benCard.cardId)).toEqual([]);

    // Their pages say so: Ben's own payment, and on Kai's the payment of Ben, who pays for him.
    expect((await held(gym, ben.entryId)).squareAppWaiting.map((w) => [w.id, w.amountMinor, w.enteredMinor, w.byName, w.holdsCard, w.bill?.entryId])).toEqual([[row.id, 2706, 2500, null, true, undefined]]);
    expect((await held(gym, kai.entryId)).squareAppWaiting.map((w) => [w.amountMinor, w.byName, w.holdsCard])).toEqual([[2706, "Ben Ortiz", true]]);
    expect((await held(gym, zoe.entryId)).squareAppWaiting).toEqual([]);
    // And Payments to match: no bill ticked while two fit, and that it holds his card.
    expect(await listed(gym, row.id)).toMatchObject({
      reason: "several_bills",
      amountMinor: 2706,
      enteredMinor: 2500,
      holdsCard: true,
      person: { entryId: ben.entryId, name: "Ben Ortiz" },
      bill: null,
    });

    // Staff match it to Ben's bill: the $25.00 entered goes on it once, as Square Point of Sale.
    const matched = await match(gym, row.id, ben, { amountMinor: 2500 });
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched).toMatchObject({ entryId: ben.entryId, name: "Ben Ortiz", amountMinor: 2500, currency: "USD" });
    const benBill = await second(ben);
    expect(benBill?.status).toBe("paid");
    expect((await paymentsOf(ben)).filter((p) => p.bill_id === benBill?.id).map((p) => [p.amount_minor, p.method, p.provider_payment_id, p.recorded_by])).toEqual([
      [2500, "square_app", paid.id, gym.owner.userId],
    ]);

    // Matched, the card is free again: Kai's bill is charged to Ben's card, Ben's own never.
    await work();
    await work();
    expect(takenFrom(benCard.cardId).map((p) => p.amount_money.amount), "Ben's card: Kai's $25.00 alone").toEqual([2500]);
    expect((await second(kai))?.status).toBe("paid");
    expect((await paymentsOf(ben)).filter((p) => p.bill_id === benBill?.id)).toHaveLength(1);
    expect(takenFrom(zoeCard.cardId)).toHaveLength(1);
    expect((await held(gym, ben.entryId)).squareAppWaiting).toEqual([]);
  });

  it("one press: a payment of exactly what Amy owes goes on no bill by itself; it waits with her bill ticked, her card held, until Match", async () => {
    const gym = await makeGym(`Press Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    clock = new Date(`${today}T10:00:00Z`);
    const amy = await owing(gym, typeId, await person(gym, "Amy Press"));
    const amyCard = await cardFor(gym, amy.entryId);
    // Exactly her $25.00 bill, typed, Amy picked: Square says who paid, never what for.
    const paid = await takenIn(gym, { amount: 2500, customerId: amyCard.customerId, device: "Front desk 2" });
    const row = await rowOf(paid.id);
    expect([row.state, row.reason, row.member_payment_id]).toEqual(["waiting", "ready", null]);
    expect((await second(amy))?.status).toBe("open");
    expect(await listed(gym, row.id)).toMatchObject({ deviceName: "Front desk 2", bill: { entryId: amy.entryId, target: { kind: "period", periodIndex: 1 }, leftMinor: 2500 } });

    // Noon: her card is not charged while it waits.
    clock = new Date(`${today}T17:00:00Z`);
    await work();
    expect(takenFrom(amyCard.cardId)).toEqual([]);
    expect((await second(amy))?.status).toBe("open");

    // One press, from her page's ticked bill: on the bill once, and her card is never charged for it.
    const bill = (await held(gym, amy.entryId)).squareAppWaiting[0]?.bill;
    if (bill === undefined || bill === null) throw new Error("no bill ticked on her page");
    const pressed = await send("POST", `${toMatchUrl(gym)}/${row.id}/match`, gym.owner.cookies, {
      requestKey: randomUUID(),
      entryId: bill.entryId,
      membershipId: bill.membershipId,
      target: bill.target,
      amountMinor: bill.leftMinor,
    });
    expect(pressed.statusCode, pressed.body).toBe(200);
    expect((await second(amy))?.status).toBe("paid");
    await work();
    expect(takenFrom(amyCard.cardId)).toEqual([]);
    expect((await paymentsOf(amy)).filter((p) => p.method === "square_app").map((p) => p.provider_payment_id)).toEqual([paid.id]);
  });

  it("a membership rung up as a shop item: a sale of items for Leo, of at least what he owes this week, waits and holds his card; a smaller one is a shop sale", async () => {
    const gym = await makeGym(`Items Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    clock = new Date(`${today}T10:00:00Z`);
    const leo = await owing(gym, typeId, await person(gym, "Leo Items"));
    const leoCard = await cardFor(gym, leo.entryId);
    // A protein bar for $4.00: a shop sale, kept off the list.
    const bar = await takenIn(gym, { amount: 400, customerId: leoCard.customerId, lines: ["ITEM"] });
    expect([(await rowOf(bar.id)).state, (await rowOf(bar.id)).reason]).toEqual(["shop_sale", null]);
    // "Gold Weekly" sold as an item in Square, $25.00 plus Square's $2.06 tax: it may be his bill.
    const item = await takenIn(gym, { amount: 2706, addedTax: 206, customerId: leoCard.customerId, lines: ["ITEM"] });
    const row = await rowOf(item.id);
    expect([row.state, row.reason, row.entry_id]).toEqual(["waiting", "shop_items", leo.entryId]);
    expect(await listed(gym, row.id), "nothing ticked: staff say what it was").toMatchObject({ reason: "shop_items", bill: null, holdsCard: true });

    // Noon: his card is not charged while it waits.
    clock = new Date(`${today}T17:00:00Z`);
    await work();
    expect(takenFrom(leoCard.cardId), "Leo's card is not charged for a bill he may have paid as an item").toEqual([]);
    // It was his membership: Match asks how much was for the bill, and the card stays free of it.
    const box = matchBillsResponseSchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/${row.id}/bills?entryId=${leo.entryId}`, gym.owner.cookies)).body));
    expect([box.amountMinor, box.suggested]).toEqual([null, null]);
    expect((await match(gym, row.id, leo, { amountMinor: 2500 })).statusCode).toBe(200);
    await work();
    expect(takenFrom(leoCard.cardId)).toEqual([]);
    expect((await second(leo))?.status).toBe("paid");
  });

  it("the look before charging: a desk payment whose message from Square never came is found before Mia's card is charged, not after", async () => {
    const gym = await makeGym(`Late Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    clock = new Date(`${today}T10:00:00Z`);
    const mia = await owing(gym, typeId, await person(gym, "Mia Late"));
    const miaCard = await cardFor(gym, mia.entryId);
    // The first minute begins watching the gym's Square payments.
    await work();
    // Mia pays at the desk, picked; Square's message about it is lost.
    clock = new Date(`${today}T16:50:00Z`);
    const paid = square.appPayment(gym.acct, { amount: 2500, customerId: miaCard.customerId, locationId: gym.locationId });
    // Noon: before her card is charged, the gym's payments are looked at, and hers holds the card.
    clock = new Date(`${today}T17:00:00Z`);
    await work();
    expect((await rowOf(paid.id)).reason).toBe("ready");
    expect(takenFrom(miaCard.cardId), "Mia's card is not charged for the bill she paid at the desk").toEqual([]);
    expect((await second(mia))?.status).toBe("open");
    // A minute on, nothing is asked of Square again for her held bill.
    const looks = square.listed().length;
    clock = new Date(clock.getTime() + 60_000);
    await work();
    expect(square.listed().length, "Square is not asked every minute").toBe(looks);

    // Round one, High 4: Noa pays at the desk, picked, her message lost, and in the minute that charges cards
    // Square gives no answer about what was sold. Her payment still waits at once, and her card with it.
    const noa = await owing(gym, typeId, await person(gym, "Noa Late"));
    const noaCard = await cardFor(gym, noa.entryId);
    clock = new Date(`${today}T17:30:00Z`);
    const unread = square.appPayment(gym.acct, { amount: 2500, customerId: noaCard.customerId, locationId: gym.locationId });
    square.state.ordersUnanswered.add(unread.order_id ?? "");
    clock = new Date(`${today}T17:40:00Z`);
    await work();
    square.state.ordersUnanswered.delete(unread.order_id ?? "");
    expect((await rowOf(unread.id)).reason, "kept as a sale that could not be read").toBe("sale_unread");
    expect(takenFrom(noaCard.cardId), "Noa's card is not charged while it waits").toEqual([]);
    expect((await second(noa))?.status).toBe("open");
  });

  it("round one, High 1: the bill ticked is worked out again from today's bills: paid by hand meanwhile, 'they may have paid twice' is said beside the next; a payer added since, two bills of that amount, nothing ticked", async () => {
    const gym = await makeGym(`Stale Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const amy = await owing(gym, typeId, await person(gym, "Amy Stale"));
    const amyCard = await cardFor(gym, amy.entryId);
    const paid = await takenIn(gym, { amount: 2500, customerId: amyCard.customerId });
    const row = await rowOf(paid.id);
    expect((await listed(gym, row.id))?.bill?.target).toEqual({ kind: "period", periodIndex: 1 });
    // Staff also record this week's bill by hand, in cash.
    const cash = await send("POST", `${entryUrl(gym, amy.entryId)}/memberships/${amy.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 1, amountMinor: 2500, method: "cash" });
    expect(cash.statusCode, cash.body).toBe(200);
    // Next week's bill is ticked now, with the warning, on the list and on her page.
    expect(await listed(gym, row.id)).toMatchObject({ reason: "maybe_twice", bill: { target: { kind: "period", periodIndex: 2 } } });
    expect((await held(gym, amy.entryId)).squareAppWaiting.map((w) => [w.maybeTwice, w.bill?.target])).toEqual([[true, { kind: "period", periodIndex: 2 }]]);

    // Ben's payment waits ready; then Ben is made the payer of Cal, who owes the same today.
    const ben = await owing(gym, typeId, await person(gym, "Ben Stale"));
    const benCard = await cardFor(gym, ben.entryId);
    const benPaid = await takenIn(gym, { amount: 2500, customerId: benCard.customerId });
    const benRow = await rowOf(benPaid.id);
    expect((await listed(gym, benRow.id))?.reason).toBe("ready");
    const cal = await owing(gym, typeId, await person(gym, "Cal Stale"));
    const payer = await send("PUT", `${entryUrl(gym, cal.entryId)}/payer`, gym.owner.cookies, { payerEntryId: ben.entryId });
    expect(payer.statusCode, payer.body).toBe(200);
    expect(await listed(gym, benRow.id), "two bills of that amount now: staff choose").toMatchObject({ reason: "several_bills", bill: null });
    const box = matchBillsResponseSchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/${benRow.id}/bills?entryId=${ben.entryId}`, gym.owner.cookies)).body));
    expect(box.suggested, "nor does Match's box tick one").toBeNull();
  });

  it("Record payment offers Square Point of Sale where the gym takes payments there, naming whom to pick in Square: the member linked there, else whoever pays for them, else nobody", async () => {
    const gym = await makeGym(`Pick Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const pia = await owing(gym, typeId, await person(gym, "Pia Linked"));
    const kid = await owing(gym, typeId, await person(gym, "Kid Paidfor"));
    const new1 = await owing(gym, typeId, await person(gym, "Nell New"));
    await cardFor(gym, pia.entryId);
    const payer = await send("PUT", `${entryUrl(gym, kid.entryId)}/payer`, gym.owner.cookies, { payerEntryId: pia.entryId });
    expect(payer.statusCode, payer.body).toBe(200);
    const pickOf = async (g: Gym, h: Holder, cookies = g.owner.cookies) => {
      const res = await send("GET", `${entryUrl(g, h.entryId)}/terminal-payments`, cookies);
      expect(res.statusCode, res.body).toBe(200);
      return terminalPaymentsResponseSchema.parse(JSON.parse(res.body)).squareApp;
    };
    expect(await pickOf(gym, pia)).toEqual({ pick: "Pia Linked" });
    expect(await pickOf(gym, kid), "Kid's bills are Pia's to pay: pick Pia").toEqual({ pick: "Pia Linked" });
    expect(await pickOf(gym, new1), "linked to nobody in Square: it will wait in Payments to match").toEqual({ pick: null });
    const summary = paymentsToMatchSummarySchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/summary`, gym.owner.cookies)).body));
    expect(summary.pointOfSale).toBe(true);
    // Connected before Square let the app read what was sold: not offered.
    await sql`UPDATE gym_payment_connections SET scopes = array_remove(scopes, 'ORDERS_READ') WHERE gym_id = ${gym.id}`;
    expect(await pickOf(gym, pia)).toBeNull();
    expect(paymentsToMatchSummarySchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/summary`, gym.owner.cookies)).body)).pointOfSale).toBe(false);
    // Another gym's owner: as if there were no such person.
    const other = await makeGym(`Pick Stranger ${uniq()}`);
    expect((await send("GET", `${entryUrl(gym, pia.entryId)}/terminal-payments`.replace(gym.id, other.id), other.owner.cookies)).statusCode).toBe(404);
  });

  it("Match puts it on the bill once, whatever arrives twice: the same press again is the same answer, two presses at once record it once, and a stranger's gym gets 404", async () => {
    const gym = await makeGym(`Match Gym ${uniq()}`);
    const other = await makeGym(`Stranger Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee"));
    const sam = await owing(other, await typeOf(other), await person(other, "Sam Stranger"));
    // Taken with no customer added to the sale: it waits, and holds nobody's card.
    const paid = await takenIn(gym, { amount: 2500 });
    const row = await rowOf(paid.id);
    expect([row.state, row.reason, row.entry_id]).toEqual(["waiting", "no_customer", null]);
    expect(await listed(gym, row.id)).toMatchObject({ person: null, customer: null, suggested: null, holdsCard: false, enteredMinor: 2500 });

    // A stranger's gym sees nothing of it, and can't act on it, nor put it on their own member's bill.
    const strangerUrl = `${toMatchUrl(gym)}/${row.id}`;
    for (const [method, path, body] of [
      ["GET", toMatchUrl(gym), undefined],
      ["GET", `${toMatchUrl(gym)}/summary`, undefined],
      ["GET", `${strangerUrl}/bills?entryId=${amy.entryId}`, undefined],
      ["POST", `${strangerUrl}/match`, { requestKey: randomUUID(), entryId: amy.entryId, membershipId: amy.membershipId, target: { kind: "period", periodIndex: 1 }, amountMinor: 2500 }],
      ["POST", `${strangerUrl}/not-a-bill`, { why: "other" }],
      ["POST", `${strangerUrl}/undo`, undefined],
    ] as const) {
      expect((await send(method, path, other.owner.cookies, body)).statusCode, `${method} ${path}`).toBe(404);
    }
    expect((await list(other)).payments.map((p) => p.id)).not.toContain(row.id);
    expect((await send("POST", `${toMatchUrl(other)}/${row.id}/match`, other.owner.cookies, {
      requestKey: randomUUID(), entryId: sam.entryId, membershipId: sam.membershipId, target: { kind: "period", periodIndex: 1 }, amountMinor: 2500,
    })).statusCode, "another gym's payment, on another gym's bill").toBe(404);
    // Nor put on another gym's person's bill from this one.
    expect((await match(gym, row.id, sam, { amountMinor: 2500 })).statusCode).toBe(404);

    // Two presses at once with their own keys: one goes on the bill, the other is told it is there.
    const [a, b] = await Promise.all([match(gym, row.id, amy, { amountMinor: 2500 }), match(gym, row.id, amy, { amountMinor: 2500 })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect((JSON.parse(loser.body) as { error: string }).error).toBe("payment_to_match_matched");
    const winner = a.statusCode === 200 ? a : b;
    const receipt = matchPaymentResponseSchema.parse(JSON.parse(winner.body)).matched.receiptNumber;
    expect((await paymentsOf(amy)).filter((p) => p.method === "square_app").map((p) => [p.amount_minor, p.provider_payment_id])).toEqual([[2500, paid.id]]);

    // The same press sent again (a lost answer, a double click): the same receipt, nothing added.
    const key = randomUUID();
    const amy2 = await owing(gym, typeId, await person(gym, "Amy Two"));
    const paid2 = await takenIn(gym, { amount: 2500 });
    const row2 = await rowOf(paid2.id);
    const once = await match(gym, row2.id, amy2, { amountMinor: 2500, requestKey: key });
    const twice = await match(gym, row2.id, amy2, { amountMinor: 2500, requestKey: key });
    expect([once.statusCode, twice.statusCode]).toEqual([200, 200]);
    expect(JSON.parse(twice.body)).toEqual(JSON.parse(once.body));
    // The same key asking for another bill is refused, never answered as matched there.
    const elsewhere = await match(gym, row2.id, amy, { amountMinor: 2500, requestKey: key });
    expect(elsewhere.statusCode, elsewhere.body).toBe(409);
    expect((JSON.parse(elsewhere.body) as { error: string }).error).toBe("payment_to_match_key_reused");
    // Round one, Low 2: the same person, membership and amount, but another of their bills: refused too.
    const otherBill = await match(gym, row2.id, amy2, { amountMinor: 2500, requestKey: key, periodIndex: 2 });
    expect(otherBill.statusCode, otherBill.body).toBe(409);
    expect((JSON.parse(otherBill.body) as { error: string }).error).toBe("payment_to_match_key_reused");
    expect((await paymentsOf(amy2)).filter((p) => p.method === "square_app")).toHaveLength(1);
    expect(receipt).not.toBe(matchPaymentResponseSchema.parse(JSON.parse(once.body)).matched.receiptNumber);
    // Matched, it leaves the list and Overview's count.
    expect((await list(gym)).payments.map((p) => p.id)).not.toContain(row2.id);
    const summary = paymentsToMatchSummarySchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/summary`, gym.owner.cookies)).body));
    expect(summary.count).toBe(0);
  });

  it("Not a bill payment takes it off the list and lets the card be charged; Undo puts it back as it was and holds the card again", async () => {
    const gym = await makeGym(`Mark Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    clock = new Date(`${today}T10:00:00Z`);
    const lea = await owing(gym, typeId, await person(gym, "Lea Mark"));
    const leaCard = await cardFor(gym, lea.entryId);
    // $30.00 of protein typed in as an amount, Lea picked: no bill of hers is $30.00, so it waits.
    const paid = await takenIn(gym, { amount: 3000, customerId: leaCard.customerId });
    const row = await rowOf(paid.id);
    expect([row.state, row.reason, row.entry_id]).toEqual(["waiting", "no_bill", lea.entryId]);

    const mark = (why: "other" | "by_hand") => send("POST", `${toMatchUrl(gym)}/${row.id}/not-a-bill`, gym.owner.cookies, { why });
    const undo = () => send("POST", `${toMatchUrl(gym)}/${row.id}/undo`, gym.owner.cookies);
    const marked = await mark("other");
    expect(marked.statusCode, marked.body).toBe(200);
    expect(paymentToMatchStateResponseSchema.parse(JSON.parse(marked.body))).toEqual({ state: "not_bill", why: "other" });
    expect((await mark("other")).statusCode, "the same press again stands").toBe(200);
    expect((await list(gym)).payments.map((p) => p.id)).not.toContain(row.id);
    expect((await held(gym, lea.entryId)).squareAppWaiting).toEqual([]);
    expect((await match(gym, row.id, lea, { amountMinor: 3000 })).statusCode, "a payment marked is never matched").toBe(409);

    // Undo: back as it was, holding her card again.
    const back = await undo();
    expect(back.statusCode, back.body).toBe(200);
    expect(paymentToMatchStateResponseSchema.parse(JSON.parse(back.body))).toEqual({ state: "waiting", why: null });
    expect(await rowOf(paid.id)).toMatchObject({ state: "waiting", reason: "no_bill", not_bill: null });
    clock = new Date(`${today}T17:00:00Z`);
    await work();
    expect(takenFrom(leaCard.cardId), "held again after Undo").toEqual([]);

    // Marked again, the card is charged for her bill, once.
    expect((await mark("by_hand")).statusCode).toBe(200);
    expect(await rowOf(paid.id)).toMatchObject({ state: "not_bill", not_bill: "by_hand", reason: "no_bill" });
    await work();
    await work();
    expect(takenFrom(leaCard.cardId).map((p) => p.amount_money.amount)).toEqual([2500]);
    // Staff activity has each press, by who and why.
    const notes = await sql<{ action: string; actor_user_id: string | null; why: string | null }[]>`
      SELECT action, actor_user_id, meta->>'why' AS why FROM audit_log WHERE gym_id = ${gym.id} AND target_id = ${row.id} ORDER BY at, id`;
    expect(notes.map((n) => [n.action, n.why])).toEqual([
      ["org.square_app_payment_not_bill", "other"],
      ["org.square_app_payment_put_back", null],
      ["org.square_app_payment_not_bill", "by_hand"],
    ]);
    expect(new Set(notes.map((n) => n.actor_user_id))).toEqual(new Set([gym.owner.userId]));
  });

  it("Match asks Square first: never a payment Square has refunded since, nothing changed while Square doesn't answer, and never while money is out on the card on file", async () => {
    const gym = await makeGym(`Square Asked Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const rex = await owing(gym, typeId, await person(gym, "Rex Refund"));
    const paid = await takenIn(gym, { amount: 2500 });
    const row = await rowOf(paid.id);

    square.state.down = true;
    const down = await match(gym, row.id, rex, { amountMinor: 2500 });
    square.state.down = false;
    expect(down.statusCode, down.body).toBe(503);
    expect((await second(rex))?.status).toBe("open");
    expect((await rowOf(paid.id)).state).toBe("waiting");

    // Refunded in Square after it was taken in: never on a bill, and the list says why it waits now.
    square.refund(paid.id, 1000);
    const refunded = await match(gym, row.id, rex, { amountMinor: 2500 });
    expect(refunded.statusCode, refunded.body).toBe(409);
    expect((JSON.parse(refunded.body) as { error: string }).error).toBe("payment_to_match_refunded");
    expect((await second(rex))?.status).toBe("open");
    expect(await listed(gym, row.id)).toMatchObject({ reason: "refunded", refundedMinor: 1000 });

    // Money out on the card on file for the membership: Match waits for Square's answer, so it is
    // never taken twice.
    const ivy = await owing(gym, typeId, await person(gym, "Ivy Busy"));
    const paid2 = await takenIn(gym, { amount: 2500 });
    const row2 = await rowOf(paid2.id);
    // Her card saved once the payment is in, so the next minute is the one that charges it.
    await cardFor(gym, ivy.entryId);
    // The app's own charge of Ivy's bill is out, and Square gives no answer to it yet.
    square.state.down = true;
    await work();
    square.state.down = false;
    const [charging] = await sql<{ state: string }[]>`SELECT state FROM gym_card_charges WHERE held_membership_id = ${ivy.membershipId}`;
    expect(charging?.state).toBe("charging");
    const busy = await match(gym, row2.id, ivy, { amountMinor: 2500 });
    expect(busy.statusCode, busy.body).toBe(409);
    expect((JSON.parse(busy.body) as { error: string }).error).toBe("payment_to_match_busy");
    expect((await paymentsOf(ivy)).filter((p) => p.method === "square_app")).toEqual([]);
    // And never more than the bill has left, nor another amount than the screen showed.
    const big = await takenIn(gym, { amount: 4000 });
    const bigRow = await rowOf(big.id);
    const tom = await owing(gym, typeId, await person(gym, "Tom Toomuch"));
    expect((await match(gym, bigRow.id, tom, { amountMinor: 4000 })).statusCode).toBe(409);
    expect((await match(gym, bigRow.id, tom, { amountMinor: 2500 })).statusCode, "the entered part is all of it").toBe(409);
    expect((await paymentsOf(tom)).filter((p) => p.method === "square_app")).toEqual([]);
  });

  it("the list says who it is: Square's own details for a customer linked to nobody, the one person here with the same email filled in for Match, never a guess by name", async () => {
    const gym = await makeGym(`Who Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const email = `ptm-amy-${uniq()}@gmail.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", email));
    // Another Amy Lee, with another email: Square's name alone never picks either.
    await person(gym, "Amy Lee");
    // A family sharing one address: neither is filled in.
    const shared = `ptm-family-${uniq()}@gmail.com`;
    await person(gym, "Pat Family", shared);
    await person(gym, "Sam Family", shared);

    square.customer(gym.acct, { id: "CAMY1", given_name: "Amy", family_name: "Lee", email_address: email.toUpperCase(), phone_number: "+1 312-555-0100" });
    square.customer(gym.acct, { id: "CAMY2", given_name: "Amy", family_name: "Lee", email_address: null, phone_number: null });
    square.customer(gym.acct, { id: "CFAM", given_name: "Pat", family_name: "Family", email_address: shared });
    const minuteOn = () => {
      clock = new Date(clock.getTime() + 60_000);
    };
    const byEmail = await takenIn(gym, { amount: 2500, customerId: "CAMY1" });
    minuteOn();
    const byName = await takenIn(gym, { amount: 2500, customerId: "CAMY2" });
    minuteOn();
    const family = await takenIn(gym, { amount: 2500, customerId: "CFAM" });
    minuteOn();
    // Paid in two parts in Square (split tender): how much of each is for a bill is the desk's to say.
    const split = await takenIn(gym, { amount: 1500, customerId: "CAMY2", split: true });

    const rows = (await list(gym)).payments;
    const of = (id: string) => rows.find((r) => r.id === id);
    const kept = async (id: string) =>
      (await sql<{ customer_name: string | null; customer_email: string | null }[]>`SELECT customer_name, customer_email FROM gym_square_app_payments WHERE square_payment_id = ${id}`)[0];
    const amyRow = of((await rowOf(byEmail.id)).id);
    expect(amyRow).toMatchObject({ reason: "not_linked", person: null, customer: { name: "Amy Lee", email: email.toUpperCase(), phone: "+1 312-555-0100" } });
    expect(amyRow?.suggested?.entryId, "the one record with that email, whatever its case").toBe(amy.entryId);
    expect(of((await rowOf(byName.id)).id)).toMatchObject({ customer: { name: "Amy Lee", email: null, phone: null }, suggested: null });
    expect(of((await rowOf(family.id)).id)?.suggested, "two records share that email: nobody is filled in").toBeNull();
    expect(of((await rowOf(split.id)).id)?.enteredMinor, "part of a sale paid in two: the amount for the bill is asked").toBeNull();
    // Newest first.
    expect(rows.map((r) => r.id).slice(0, 4)).toEqual([await rowOf(split.id), await rowOf(family.id), await rowOf(byName.id), await rowOf(byEmail.id)].map((r) => r.id));

    // A split payment's part goes on the bill as the desk says, never more than the payment.
    const box = matchBillsResponseSchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/${(await rowOf(split.id)).id}/bills?entryId=${amy.entryId}`, gym.owner.cookies)).body));
    expect(box.amountMinor).toBeNull();
    expect((await match(gym, (await rowOf(split.id)).id, amy, { amountMinor: 1600 })).statusCode).toBe(409);
    const part = await match(gym, (await rowOf(split.id)).id, amy, { amountMinor: 1500 });
    expect(part.statusCode, part.body).toBe(200);
    const bill = await second(amy);
    expect([bill?.status, (await paymentsOf(amy)).filter((p) => p.bill_id === bill?.id).map((p) => p.amount_minor)]).toEqual(["open", [1500]]);

    // Matched, it is the record's: Square's details of the customer are no longer kept on it.
    expect(await kept(byEmail.id)).toEqual({ customer_name: "Amy Lee", customer_email: email.toUpperCase() });
    const rest = await match(gym, (await rowOf(byEmail.id)).id, amy, { amountMinor: 1000 });
    expect(rest.statusCode, "the entered $25.00 is all of it").toBe(409);
    const ann = await owing(gym, typeId, await person(gym, "Ann Lee"));
    expect((await match(gym, (await rowOf(byEmail.id)).id, ann, { amountMinor: 2500 })).statusCode).toBe(200);
    expect(await kept(byEmail.id)).toEqual({ customer_name: null, customer_email: null });
    expect(await kept(byName.id), "one not matched keeps them").toEqual({ customer_name: "Amy Lee", customer_email: null });
  });

  it("Match's box lists the person's bills and those of whoever they pay for, ticks the one of exactly that amount, shows their newest payments, and pays a fee only whole", async () => {
    const gym = await makeGym(`Box Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const ann = await owing(gym, typeId, await person(gym, "Ann Payer"));
    const kid = await owing(gym, typeId, await person(gym, "Kid Payer"));
    const set = await send("PUT", `${entryUrl(gym, kid.entryId)}/payer`, gym.owner.cookies, { payerEntryId: ann.entryId });
    expect(set.statusCode, set.body).toBe(200);
    const paid = await takenIn(gym, { amount: 2500 });
    const row = await rowOf(paid.id);

    const res = await send("GET", `${toMatchUrl(gym)}/${row.id}/bills?entryId=${ann.entryId}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const box = matchBillsResponseSchema.parse(JSON.parse(res.body));
    expect(box.person).toMatchObject({ entryId: ann.entryId, name: "Ann Payer" });
    expect(box.amountMinor).toBe(2500);
    expect(box.bills.map((b) => [b.name, b.target, b.leftMinor, b.cannot])).toEqual([
      ["Ann Payer", { kind: "period", periodIndex: 1 }, 2500, null],
      ["Kid Payer", { kind: "period", periodIndex: 1 }, 2500, null],
    ]);
    // Ann's bill and the Kid's are both $25.00: which one is the desk's to say, so nothing is ticked (round
    // one, High 2), as the list ticks nothing.
    expect(box.suggested).toBeNull();
    // Their first weeks, paid in cash at the desk: seen, so one already recorded by hand is never matched twice.
    expect(box.paid).toHaveLength(2);
    expect(box.paid.map((p) => [p.amountMinor, p.method, p.forName])).toEqual(expect.arrayContaining([
      [2500, "cash", null],
      [2500, "cash", "Kid Payer"],
    ]));
    // Somebody not on this gym's list: 404.
    expect((await send("GET", `${toMatchUrl(gym)}/${row.id}/bills?entryId=${randomUUID()}`, gym.owner.cookies)).statusCode).toBe(404);

    // Put on the kid's bill, from Ann's box: Ann paid for him.
    const done = await match(gym, row.id, kid, { amountMinor: 2500 });
    expect(done.statusCode, done.body).toBe(200);
    expect((await second(kid))?.status).toBe("paid");
    expect((await second(ann))?.status).toBe("open");
  });

  it("Not this bill on the person's page puts a matched payment back on the list, waiting again", async () => {
    const gym = await makeGym(`Back Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const una = await owing(gym, typeId, await person(gym, "Una Back"));
    const paid = await takenIn(gym, { amount: 2500 });
    const row = await rowOf(paid.id);
    expect((await match(gym, row.id, una, { amountMinor: 2500 })).statusCode).toBe(200);
    const payment = (await paymentsOf(una)).find((p) => p.method === "square_app");
    const voided = await send("POST", `${entryUrl(gym, una.entryId)}/memberships/${una.membershipId}/payments/${payment?.id ?? ""}/void`, gym.owner.cookies, { reason: "not_this_bill" });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await listed(gym, row.id)).toMatchObject({ reason: "not_this_bill", bill: null });
    expect((await second(una))?.status).toBe("open");
    // Match's box never ticks the bill staff just took it off (round one, High 2).
    const box = matchBillsResponseSchema.parse(JSON.parse((await send("GET", `${toMatchUrl(gym)}/${row.id}/bills?entryId=${una.entryId}`, gym.owner.cookies)).body));
    expect(box.suggested).toBeNull();
    // Matched again, to the same bill: on it once.
    expect((await match(gym, row.id, una, { amountMinor: 2500 })).statusCode).toBe(200);
    expect((await paymentsOf(una)).filter((p) => p.method === "square_app")).toHaveLength(1);
  });

  it("two gyms here at one Square location: a payment with nobody picked is listed for neither, and each is told how many, so it gives each gym its own location", async () => {
    const shared = account(`MPTM${uniq()}`);
    const one = await makeGym(`Shared One ${uniq()}`, shared);
    const two = await makeGym(`Shared Two ${uniq()}`, shared);
    clock = new Date(`${(await held(one, await person(one, "Clock Reader"))).today}T17:00:00Z`);
    const paid = square.appPayment(shared, { amount: 2500, locationId: one.locationId });
    await work([await deliver(shared, paid.id)]);
    const [row] = await sql<{ gym_id: string | null; reason: string | null }[]>`SELECT gym_id, reason FROM gym_square_app_payments WHERE square_payment_id = ${paid.id}`;
    expect(row).toEqual({ gym_id: null, reason: "several_gyms" });
    for (const gym of [one, two]) {
      const seen = await list(gym);
      expect(seen.payments, "nobody's to match").toEqual([]);
      expect(seen.sharedLocation, "each told").toBe(1);
    }
    // A gym of its own location is told nothing; nor is one once the other gym has left that location.
    expect((await list(await makeGym(`Alone ${uniq()}`))).sharedLocation).toBe(0);
    await sql`UPDATE gym_payment_connections SET state = 'removed', removed_at = now() WHERE gym_id = ${two.id}`;
    expect((await list(one)).sharedLocation).toBe(0);
  });

  it("round one, Low 3: 'their card isn't charged' is said only for a card in the Square account connected now", async () => {
    const gym = await makeGym(`Old Card Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T17:00:00Z`);
    const ola = await owing(gym, typeId, await person(gym, "Ola Oldcard"));
    const card = await cardFor(gym, ola.entryId);
    const paid = await takenIn(gym, { amount: 2500, customerId: card.customerId });
    const row = await rowOf(paid.id);
    expect((await listed(gym, row.id))?.holdsCard).toBe(true);
    // The card was saved in another Square account than the one connected now: the app can't charge it.
    await sql`UPDATE gym_member_cards SET account_id = 'MOLDACCOUNT' WHERE gym_id = ${gym.id} AND entry_id = ${ola.entryId}`;
    expect((await listed(gym, row.id))?.holdsCard).toBe(false);
    expect((await held(gym, ola.entryId)).squareAppWaiting.map((w) => w.holdsCard)).toEqual([false]);
  });

  it("Failed payments says a card waits for a payment from Square Point of Sale instead of offering Try again", async () => {
    const gym = await makeGym(`Failed Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    clock = new Date(`${today}T17:00:00Z`);
    const dee = await owing(gym, typeId, await person(gym, "Dee Declined"));
    const card = await cardFor(gym, dee.entryId);
    square.card(card.cardId, gym.acct.merchantId, card.customerId, "declines");
    await work();
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    const before = failedPaymentsResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/failed-payments`, gym.owner.cookies)).body));
    expect(before.payments.find((p) => p.entryId === dee.entryId)?.retry.kind).toBe("charge");
    // Dee pays $10.00 in Square Point of Sale, picked: it waits, and her card with it.
    await takenIn(gym, { amount: 1000, customerId: card.customerId });
    const after = failedPaymentsResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/failed-payments`, gym.owner.cookies)).body));
    expect(after.payments.find((p) => p.entryId === dee.entryId)?.retry).toEqual({ kind: "no", why: "square_app" });
  });
});
