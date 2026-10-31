// Refund to card (ROADMAP 18d-iv-a; spec Part 3 §14.8), through the routes and the worker's minute against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, which answers refunds as Square's test
// area did on 2026-10-30.
//
// The first block is the worst thing this job could do to a real person: a member refunded twice, refunded more than they
// paid, or the wrong person's or another gym's payment refunded. Every claim is read from the tables and from what the fake
// Square made, never from the reply alone.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  cardRefundCheckSchema,
  cardRefundResponseSchema,
  heldMembershipsResponseSchema,
  refundsToReviewResponseSchema,
  ROLE_PRIVILEGES,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentsResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { removeFreezeFees } from "../src/modules/orgs/memberships/freezeFees.js";
import { CARD_REFUND, refundDevice, TERMINAL_REFUND } from "../src/modules/orgs/payments/cardRefunds.js";
import { waitingOnTerminalOfBill } from "../src/modules/orgs/payments/cardRefundsRepo.js";
import { linesPage, totals } from "../src/modules/orgs/paymentsDownload/repo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account, type Behaviour } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "card-refund-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-CARDREFUNDAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-CARDREFUNDSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 240_000;
const LIVE_PLAN = "zz_card_refund";

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
  typeId: string;
}
interface Paid {
  gym: Gym;
  entryId: string;
  membershipId: string;
  paymentId: string;
  squarePaymentId: string;
  billId: string;
}

let ipCounter = 0;
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("Refund to card (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  const hub = recordingHub();
  let clock = new Date();
  square.state.now = () => clock;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });
  const gyms: Gym[] = [];
  const work = () =>
    processSquareWork(
      workDeps(),
      [],
      gyms.map((g) => g.id),
    );

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'crfd-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'crfd-t-%@example.com'`;
    await sql`DELETE FROM gym_square_refunds WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_terminals WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'crfd-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const signedIn = async (name: string): Promise<Person> => {
    const email = `crfd-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const connect = async (gym: { id: string; owner: Person }, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  const makeGym = async (name: string, merchantId: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(merchantId);
    await connect({ id, owner }, acct);
    const made = await send("POST", `/v1/orgs/${id}/membership-types`, owner.cookies, weekly);
    expect(made.statusCode, made.body).toBe(201);
    const typeId = (JSON.parse(made.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name)?.id ?? "";
    const gym = { id, name, owner, acct, typeId };
    gyms.push(gym);
    return gym;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const held = async (gym: Gym, by: Person, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `crfd-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Somebody at the gym whose second week was charged to their card on file by the worker: Square holds $25.00 of theirs. */
  const paidByCard = async (gym: Gym, fullName: string, cardMinor = 2500): Promise<Paid> => {
    const entryId = await person(gym, fullName);
    const today = (await held(gym, gym.owner, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId: gym.typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const membershipId = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0]?.id ?? "";
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${membershipId}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    await saveCard(gym, entryId);
    const [bill] = await sql<{ id: string }[]>`
      SELECT id FROM gym_member_bills WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId} AND status = 'open' ORDER BY period_index LIMIT 1`;
    const start = await send("POST", `${entryUrl(gym, entryId)}/memberships/${membershipId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: 1,
      amountMinor: cardMinor,
      cardRef: await cardRefOf(gym, entryId),
    });
    expect(start.statusCode, start.body).toBe(200);
    if (cardMinor < 2500) {
      const rest = await send("POST", `${entryUrl(gym, entryId)}/memberships/${membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 1, amountMinor: 2500 - cardMinor, method: "cash" });
      expect(rest.statusCode, rest.body).toBe(200);
    }
    const [paid] = await sql<{ id: string; provider_payment_id: string }[]>`
      SELECT id, provider_payment_id FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${bill?.id ?? ""} AND method = 'company'`;
    if (paid === undefined) throw new Error("no card payment");
    return { gym, entryId, membershipId, paymentId: paid.id, squarePaymentId: paid.provider_payment_id, billId: bill?.id ?? "" };
  };
  /** Somebody's no-show fee, owed on a membership already paid for in cash: the bill alone, nothing paid yet. */
  const feeOwed = async (gym: Gym, fullName: string, feeMinor = 1000): Promise<{ entryId: string; membershipId: string; billId: string }> => {
    const entryId = await person(gym, fullName);
    const today = (await held(gym, gym.owner, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId: gym.typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const membershipId = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0]?.id ?? "";
    const [bill] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, amount_minor, currency, due_on, covers_from, covers_to, fee, fee_for)
      SELECT gym_id, id, ${feeMinor}, currency, ${today}, ${today}, ${today}, 'no_show', 'Yoga' FROM gym_held_memberships WHERE id = ${membershipId}
      RETURNING id`;
    if (bill === undefined) throw new Error("no fee");
    return { entryId, membershipId, billId: bill.id };
  };
  /** Somebody whose $10.00 no-show fee was charged to their card on file: Square holds it. */
  const feePaid = async (gym: Gym, fullName: string, feeMinor = 1000): Promise<Paid> => {
    const { entryId, membershipId, billId } = await feeOwed(gym, fullName, feeMinor);
    await saveCard(gym, entryId);
    const start = await send("POST", `${entryUrl(gym, entryId)}/memberships/${membershipId}/fees/${billId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      amountMinor: feeMinor,
      cardRef: await cardRefOf(gym, entryId),
    });
    expect(start.statusCode, start.body).toBe(200);
    const [paid] = await sql<{ id: string; provider_payment_id: string }[]>`
      SELECT id, provider_payment_id FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${billId}`;
    if (paid === undefined) throw new Error("no fee payment");
    return { gym, entryId, membershipId, paymentId: paid.id, squarePaymentId: paid.provider_payment_id, billId };
  };
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  /** Somebody who paid by Interac debit: Square marks the payment as needing the card present. */
  const interacPaid = async (g: Gym, fullName: string): Promise<Paid> => {
    const paid = await paidByCard(g, fullName);
    const p = square.paymentById(paid.squarePaymentId);
    if (p === undefined) throw new Error("no payment");
    p.card_details = { card: { card_brand: "INTERAC", last_4: "4242" }, refund_requires_card_presence: true };
    return paid;
  };
  const feeOwedPaidByHand = async (g: Gym, fullName: string): Promise<void> => {
    const { entryId, membershipId, billId } = await feeOwed(g, fullName, 300);
    const paid = await send("POST", `${entryUrl(g, entryId)}/memberships/${membershipId}/fees/${billId}/payments`, g.owner.cookies, { requestKey: randomUUID(), amountMinor: 300, method: "cash" });
    expect(paid.statusCode, paid.body).toBeLessThan(300);
  };
  const saveCard = async (gym: Gym, entryId: string): Promise<void> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, gym.acct.merchantId, customerId, "pays");
  };
  const cardRefOf = async (gym: Gym, entryId: string): Promise<string> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/terminal-payments`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return terminalPaymentsResponseSchema.parse(JSON.parse(res.body)).cardOnFile?.ref ?? "";
  };
  const refundUrl = (p: Paid, entryId = p.entryId, membershipId = p.membershipId, paymentId = p.paymentId) =>
    `${entryUrl(p.gym, entryId)}/memberships/${membershipId}/payments/${paymentId}/card-refund`;
  const press = (p: Paid, amountMinor: number, requestKey: string = randomUUID(), by: Person = p.gym.owner) => send("POST", refundUrl(p), by.cookies, { requestKey, amountMinor, reason: "paid_twice" });
  const refundsOf = (p: Paid) =>
    sql<{ id: string; amount_minor: number; method: string; undone: boolean; void_reason: string | null; receipt_number: number }[]>`
      SELECT id, amount_minor, method, undone_at IS NOT NULL AS undone, void_reason, receipt_number
      FROM gym_member_refunds WHERE gym_id = ${p.gym.id} AND payment_id = ${p.paymentId} ORDER BY created_at, id`;
  const pressesOf = (p: Paid) =>
    sql<{ state: string; outcome: string | null; code: string | null; square_refund_id: string | null }[]>`
      SELECT state, outcome, code, square_refund_id FROM gym_square_refunds WHERE gym_id = ${p.gym.id} AND payment_id = ${p.paymentId} ORDER BY started_at`;
  const madeFor = (p: Paid) => square.refundsMade.filter((f) => f.payment_id === p.squarePaymentId);
  const billStatus = async (p: Paid) => (await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE gym_id = ${p.gym.id} AND id = ${p.billId}`)[0]?.status;
  const paymentsOnPage = async (p: Paid) => {
    const page = await held(p.gym, p.gym.owner, p.entryId);
    return page.memberships.flatMap((m) => m.billing?.bills ?? []).flatMap((b) => b.payments);
  };
  const feeOnPage = async (p: Paid) => {
    const page = await held(p.gym, p.gym.owner, p.entryId);
    const fee = page.memberships.flatMap((m) => m.billing?.fees ?? []).find((x) => x.id === p.billId);
    if (fee === undefined) throw new Error("the fee is not on the page");
    return fee;
  };
  const paymentOnPage = async (p: Paid) => {
    const shown = (await paymentsOnPage(p)).find((x) => x.id === p.paymentId);
    if (shown === undefined) throw new Error("the payment is not on the page");
    return shown;
  };

  let gym: Gym;
  let nextDoor: Gym;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
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
    gym = await makeGym(`Refund Gym ${uniq()}`, `MERCH${uniq()}`);
    nextDoor = await makeGym(`Next Door ${uniq()}`, `MERCH${uniq()}`);
  }, T);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await sql.end();
  }, T);

  describe("the worst thing: refunded twice, too much, or the wrong person", () => {
    it("Maya's $25.00 goes back to her card once, and nobody else's moves", async () => {
      const maya = await paidByCard(gym, "Maya Patel");
      const ravi = await paidByCard(gym, "Ravi Shah");
      const nina = await paidByCard(nextDoor, "Nina Next-Door");

      // The box first: what Square says of the payment.
      const box = await send("GET", refundUrl(maya), gym.owner.cookies);
      expect(box.statusCode, box.body).toBe(200);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toMatchObject({ card: { brand: "VISA", last4: "1111" }, leftMinor: 2500, refundedInSquareMinor: 0, block: null });

      // Two presses of one box: one refund.
      const key = randomUUID();
      const [first, again] = await Promise.all([press(maya, 2500, key), press(maya, 2500, key)]);
      expect(first.statusCode, first.body).toBe(200);
      expect(again.statusCode, again.body).toBe(200);
      expect(cardRefundResponseSchema.parse(JSON.parse(first.body))).toMatchObject({ amountMinor: 2500, currency: "USD", card: { brand: "VISA", last4: "1111" } });

      // One refund at Square, of her payment, for her amount, with the reason's word and no name.
      expect(madeFor(maya)).toHaveLength(1);
      expect(madeFor(maya)[0]).toMatchObject({ amount_money: { amount: 2500, currency: "USD" }, reason: "Paid twice", accountId: gym.acct.merchantId });
      // One refund in the app, as her payment's own way.
      const rows = await refundsOf(maya);
      expect(rows.map((r) => [r.amount_minor, r.method, r.undone])).toEqual([[2500, "company", false]]);
      expect(await billStatus(maya)).toBe("refunded");

      // A second person pressing with a new box finds nothing left.
      const second = await press(maya, 1);
      expect(second.statusCode).toBe(409);
      expect((JSON.parse(second.body) as { error: string }).error).toBe("card_refund_nothing_left");
      expect(madeFor(maya)).toHaveLength(1);

      // Ravi's payment through Maya's door, and next door's through ours: not found, nothing sent.
      const wrongDoor = await send("POST", refundUrl(maya, maya.entryId, maya.membershipId, ravi.paymentId), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect(wrongDoor.statusCode).toBe(404);
      const wrongRecord = await send("GET", refundUrl(ravi, maya.entryId, ravi.membershipId, ravi.paymentId), gym.owner.cookies);
      expect(wrongRecord.statusCode).toBe(404);
      const ours = await send("POST", refundUrl(maya, maya.entryId, maya.membershipId, nina.paymentId), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect(ours.statusCode).toBe(404);
      // Next door's owner, at our gym's own address.
      const stranger = await send("POST", refundUrl(ravi), nextDoor.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect([403, 404]).toContain(stranger.statusCode);
      const strangerRead = await send("GET", refundUrl(ravi), nextDoor.owner.cookies);
      expect([403, 404]).toContain(strangerRead.statusCode);
      expect(madeFor(ravi)).toHaveLength(0);
      expect(madeFor(nina)).toHaveLength(0);
      expect(await refundsOf(ravi)).toHaveLength(0);
      expect(await refundsOf(nina)).toHaveLength(0);
      expect(await billStatus(ravi)).toBe("paid");
    });

    it("two members of staff at one instant never send more than was paid", async () => {
      const maya = await paidByCard(gym, "Two Staff");
      const answers = await Promise.all([press(maya, 2000), press(maya, 2000), press(maya, 2000), press(maya, 2000)]);
      expect(answers.filter((a) => a.statusCode === 200)).toHaveLength(1);
      expect(madeFor(maya)).toHaveLength(1);
      expect((await refundsOf(maya)).map((r) => r.amount_minor)).toEqual([2000]);
      const left = await paymentOnPage(maya);
      expect(left.refundableMinor).toBe(500);
      const over = await press(maya, 501);
      expect(over.statusCode).toBe(409);
      expect((JSON.parse(over.body) as { message: string }).message).toBe("That is more than can be refunded. $5.00 is the most.");
      expect(madeFor(maya)).toHaveLength(1);
      expect((await press(maya, 500)).statusCode).toBe(200);
      expect(madeFor(maya)).toHaveLength(2);
      expect(await billStatus(maya)).toBe("refunded");
    });

    it("a key used for another amount is refused, and sends nothing", async () => {
      const maya = await paidByCard(gym, "Key Reused");
      const key = randomUUID();
      expect((await press(maya, 1000, key)).statusCode).toBe(200);
      const other = await press(maya, 500, key);
      expect(other.statusCode).toBe(409);
      expect((JSON.parse(other.body) as { error: string }).error).toBe("card_refund_key_reused");
      expect(madeFor(maya)).toHaveLength(1);
    });

    it("a payment by hand is never sent to Square", async () => {
      const maya = await paidByCard(gym, "By Hand");
      const page = await held(gym, gym.owner, maya.entryId);
      const cash = page.memberships.flatMap((m) => m.billing?.bills ?? []).flatMap((b) => b.payments).find((x) => x.method === "cash");
      expect(cash).toBeDefined();
      const res = await send("POST", refundUrl(maya, maya.entryId, maya.membershipId, cash?.id ?? ""), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("card_refund_not_card");
      expect(square.refundsMade.filter((f) => f.amount_money.amount === 100)).toHaveLength(0);
    });

    it("staff without the payments tick cannot refund, or see what Square says", async () => {
      const maya = await paidByCard(gym, "No Tick");
      const staff = await signedIn("Front Desk");
      // Can open a person's page, with everything but the payments tick: the tick itself says no.
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${staff.userId}, 'trainer', ${["members.read", "members.confirm"]})`;
      expect((await send("GET", refundUrl(maya), staff.cookies)).statusCode).toBe(403);
      expect((await press(maya, 100, randomUUID(), staff)).statusCode).toBe(403);
      expect(madeFor(maya)).toHaveLength(0);
    });
  });

  describe("what Square answers", () => {
    it("pending, then finished by the worker's look", async () => {
      const maya = await paidByCard(gym, "Pending Then Done");
      const res = cardRefundResponseSchema.parse(JSON.parse((await press(maya, 1000)).body));
      expect(res.step).toBe("pending");
      const row = (await paymentOnPage(maya)).refunds[0];
      expect(row).toMatchObject({ amountMinor: 1000, method: "company", square: { state: "pending", card: { brand: "VISA", last4: "1111" }, late: false } });
      // Too soon for a look: it stands as it was.
      await work();
      expect((await pressesOf(maya))[0]?.state).toBe("pending");
      square.refundEnds(madeFor(maya)[0]?.id ?? "", "COMPLETED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "completed" });
      expect((await paymentOnPage(maya)).refunds[0]?.square?.state).toBe("completed");
    });

    it.each(["FAILED", "REJECTED"])("%s after taking it up: no money went, the bill reads as it did, and the refund stops counting", async (status) => {
      const maya = await paidByCard(gym, `Refund ${status}`);
      expect((await press(maya, 2500)).statusCode).toBe(200);
      expect(await billStatus(maya)).toBe("refunded");
      square.refundEnds(madeFor(maya)[0]?.id ?? "", status);
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect(await billStatus(maya)).toBe("paid");
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "failed", code: status });
      expect(await refundsOf(maya)).toMatchObject([{ undone: true, void_reason: "square_failed" }]);
      const shown = await paymentOnPage(maya);
      expect(shown.refunds).toEqual([]);
      expect(shown.voidedRefunds[0]?.voided).toMatchObject({ reason: "square_failed", by: null });
      expect(shown.refundableMinor).toBe(2500);
      // Its refund can be sent again.
      expect((await press(maya, 2500)).statusCode).toBe(200);
      expect(await billStatus(maya)).toBe("refunded");
    });

    it("failed at once: said in the box, and on the page", async () => {
      const maya = await paidByCard(gym, "Failed At Once");
      square.state.refundStatus = "REJECTED";
      const res = await press(maya, 1000);
      square.state.refundStatus = "PENDING";
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("card_refund_failed");
      expect(await refundsOf(maya)).toMatchObject([{ undone: true, void_reason: "square_failed" }]);
      expect(await billStatus(maya)).toBe("paid");
    });

    it.each([
      ["INSUFFICIENT_FUNDS", "Your Square account doesn't have enough money for this refund."],
      ["PAYMENT_NOT_REFUNDABLE_DUE_TO_DISPUTE", "This payment has a chargeback"],
      ["A_CODE_SQUARE_ADDS_LATER", "Square refused this refund. No money went back."],
    ])("Square refuses with %s: nothing stands as refunded", async (code, line) => {
      const maya = await paidByCard(gym, `Refused ${code}`);
      square.state.refundRefused = code;
      const res = await press(maya, 1000);
      square.state.refundRefused = null;
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { message: string }).message).toContain(line);
      expect(await refundsOf(maya)).toHaveLength(0);
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "refused", code });
      expect(await billStatus(maya)).toBe("paid");
      expect((await paymentOnPage(maya)).cardRefund).toBeNull();
    });

    it("no answer: asked again with the same key, and refunded once", async () => {
      const maya = await paidByCard(gym, "No Answer");
      square.state.refundLost = true;
      const res = cardRefundResponseSchema.parse(JSON.parse((await press(maya, 1500)).body));
      square.state.refundLost = false;
      expect(res.step).toBe("checking");
      expect(madeFor(maya)).toHaveLength(1);
      expect(await refundsOf(maya)).toHaveLength(0);
      expect((await paymentOnPage(maya)).cardRefund).toMatchObject({ amountMinor: 1500, lost: false });
      // While it waits nothing else goes back on that bill, by card or by hand.
      const during = await press(maya, 100);
      expect((JSON.parse(during.body) as { error: string }).error).toBe("card_refund_waiting");
      const byHand = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, method: "cash", reason: "other" });
      expect((JSON.parse(byHand.body) as { error: string }).error).toBe("card_refund_waiting");

      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      expect(madeFor(maya)).toHaveLength(1);
      expect((await refundsOf(maya)).map((r) => r.amount_minor)).toEqual([1500]);
      expect((await pressesOf(maya))[0]?.state).toBe("pending");
      expect((await paymentOnPage(maya)).cardRefund).toBeNull();
    });

    it("no answer for an hour: never sent as new, and left to check in Square", async () => {
      const maya = await paidByCard(gym, "Never Answered");
      square.state.refundDown = true;
      await press(maya, 1500);
      clock = new Date(clock.getTime() + CARD_REFUND.resendForMs + 1000);
      await work();
      square.state.refundDown = false;
      expect(madeFor(maya)).toHaveLength(0);
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "lost" });
      expect((await paymentOnPage(maya)).cardRefund).toMatchObject({ amountMinor: 1500, lost: true });
      // A refund noted afterwards answers it.
      const noted = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1500, method: "card_at_desk", reason: "other" });
      expect(noted.statusCode, noted.body).toBe(200);
      expect((await paymentOnPage(maya)).cardRefund).toBeNull();
    });

    it("a void waits for a refund Square has not answered, and the bill stays as it is", async () => {
      const maya = await paidByCard(gym, "Void Waits", 1500);
      square.state.refundDown = true;
      await press(maya, 1500);
      square.state.refundDown = false;
      const cash = (await paymentsOnPage(maya)).find((x) => x.method === "cash" && x.amountMinor === 1000);
      if (cash === undefined) throw new Error("no cash payment");
      const voided = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${cash.id}/void`, gym.owner.cookies, { reason: "mistake" });
      expect(voided.statusCode, voided.body).toBe(409);
      expect((JSON.parse(voided.body) as { error: string }).error).toBe("card_refund_waiting");
      expect(await billStatus(maya)).toBe("paid");
    });

    it("the gym moves to another Square account while a press waits: never asked through the new one", async () => {
      const other = await makeGym(`Moves Away ${uniq()}`, `MERCH${uniq()}`);
      const maya = await paidByCard(other, "Moved While Waiting");
      square.state.refundDown = true;
      await press(maya, 500);
      square.state.refundDown = false;
      expect((await send("DELETE", `/v1/orgs/${other.id}/payments/square`, other.owner.cookies)).statusCode).toBe(200);
      await connect(other, account(`MERCHMOVED${uniq()}`));
      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      // Asked through the new account, Square would have said not found: no code means it was not asked.
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "lost", code: null });
      expect(madeFor(maya)).toHaveLength(0);
    });

    it("a smaller refund does not answer a refund Square never answered", async () => {
      const maya = await paidByCard(gym, "Lost Then Smaller");
      square.state.refundDown = true;
      await press(maya, 1500);
      clock = new Date(clock.getTime() + CARD_REFUND.resendForMs + 1000);
      await work();
      square.state.refundDown = false;
      expect((await press(maya, 1000)).statusCode).toBe(200);
      expect((await paymentOnPage(maya)).cardRefund).toMatchObject({ amountMinor: 1500, lost: true });
    });

    it("a refund on another bill of the membership does not hold a note on this one", async () => {
      const maya = await paidByCard(gym, "Other Bill");
      square.state.refundDown = true;
      await press(maya, 500);
      square.state.refundDown = false;
      const cash = (await paymentsOnPage(maya)).find((x) => x.method === "cash");
      if (cash === undefined) throw new Error("no cash payment");
      const noted = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${cash.id}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, method: "cash", reason: "other" });
      expect(noted.statusCode, noted.body).toBe(200);
    });

    it("looks at a pending refund 1, 2, 5 and 15 minutes on, then hourly and every 3 hours", async () => {
      const started = clock;
      const maya = await paidByCard(gym, "Look Times");
      await press(maya, 500);
      const nextLook = async () => (await sql<{ look_at: Date }[]>`SELECT look_at FROM gym_square_refunds WHERE gym_id = ${maya.gym.id} AND payment_id = ${maya.paymentId}`)[0]?.look_at ?? clock;
      expect((await nextLook()).getTime() - clock.getTime()).toBe(60_000);
      for (const after of [120_000, 300_000, 900_000, 3_600_000, 10_800_000, 10_800_000]) {
        clock = new Date((await nextLook()).getTime() + 1000);
        await work();
        expect((await nextLook()).getTime() - clock.getTime()).toBe(after);
      }
      expect((await pressesOf(maya))[0]?.state).toBe("pending");
      clock = started;
    });

    it("still pending after Square's 14 days, the page says so; on the 14th day it does not", async () => {
      const maya = await paidByCard(gym, "Late Refund");
      await press(maya, 500);
      const today = (await held(gym, gym.owner, maya.entryId)).today;
      // By the gym's own days: 24-hour steps would miss a day across a clock change.
      const startedDaysAgo = (days: number) => sql`
        UPDATE gym_square_refunds SET started_at = ((${today}::date - ${days}::int)::timestamp + interval '12 hours') AT TIME ZONE 'America/Chicago'
        WHERE gym_id = ${maya.gym.id} AND payment_id = ${maya.paymentId}`;
      await startedDaysAgo(14);
      expect((await paymentOnPage(maya)).refunds[0]?.square?.late).toBe(false);
      await startedDaysAgo(15);
      expect((await paymentOnPage(maya)).refunds[0]?.square?.late).toBe(true);
    });

    it("a refusal after no answer says nothing of the first ask: left to check in Square", async () => {
      const maya = await paidByCard(gym, "Refused On Retry");
      square.state.refundDown = true;
      await press(maya, 1500);
      square.state.refundDown = false;
      square.state.refundRefused = "INTERNAL_ERROR";
      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      square.state.refundRefused = null;
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "lost" });
    });
  });

  describe("a refund on the Terminal", () => {
    // A gym of its own: its owner's presses stay under the hourly limit the rest of the file's owner shares.
    let gym: Gym;
    beforeAll(async () => {
      gym = await makeGym(`Terminal Gym ${uniq()}`, `MERCH${uniq()}`);
    });
    const desk = async (g: Gym, behaviour: Behaviour = "person"): Promise<{ id: string; deviceId: string }> => {
      const deviceId = `DESK${uniq()}`;
      // A gym holds at most 20, and this block's tests share one: the oldest make room.
      await sql`DELETE FROM gym_square_terminals WHERE gym_id = ${g.id} AND id NOT IN (SELECT id FROM gym_square_terminals WHERE gym_id = ${g.id} ORDER BY created_at DESC, id LIMIT 8)`;
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
        VALUES (${g.id}, 'production', ${g.acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${g.owner.userId}) RETURNING id`;
      square.devices.set(deviceId, { accountId: g.acct.merchantId, behaviour });
      return { id: row?.id ?? "", deviceId };
    };
    const pressOn = (p: Paid, terminalId: string, amountMinor = 2500, requestKey: string = randomUUID(), by: Person = p.gym.owner) =>
      send("POST", refundUrl(p), by.cookies, { requestKey, amountMinor, reason: "paid_twice", terminalId });
    const read = (res: { statusCode: number; body: string }) => {
      expect(res.statusCode, res.body).toBe(200);
      return cardRefundResponseSchema.parse(JSON.parse(res.body));
    };
    const look = (p: Paid, pressId: string, by: Person = p.gym.owner) => send("GET", `/v1/orgs/${p.gym.id}/card-refunds/${pressId}`, by.cookies);
    const stop = (p: Paid, pressId: string, by: Person = p.gym.owner) => send("POST", `/v1/orgs/${p.gym.id}/card-refunds/${pressId}/cancel`, by.cookies);
    const asked = (p: Paid) => square.terminalRefunds.filter((f) => f.payment_id === p.squarePaymentId);
    const onlyAsked = (p: Paid) => {
      const [made] = asked(p);
      if (made === undefined) throw new Error("the Terminal was not asked");
      return made;
    };
    const checkOf = async (p: Paid) => cardRefundCheckSchema.parse(JSON.parse((await send("GET", refundUrl(p), p.gym.owner.cookies)).body));

    describe("the worst thing: refunded twice, or shown refunded when no money went back", () => {
      it("nothing stands as given back until Square says the person finished, and it goes back once however often it is pressed", async () => {
        const maya = await interacPaid(gym, "Maya Terminal");
        const terminal = await desk(gym);
        const key = randomUUID();
        const first = read(await pressOn(maya, terminal.id, 2500, key));
        expect(first.step).toBe("terminal");
        expect(first.onTerminal).toMatchObject({ pickedUp: false, stopping: false, ended: null });
        // Sent to the Terminal, never to the card.
        expect(madeFor(maya)).toHaveLength(0);
        expect(onlyAsked(maya)).toMatchObject({ device_id: terminal.deviceId, key: first.pressId, deadline: "PT5M" });
        expect(await refundsOf(maya)).toHaveLength(0);
        expect(await billStatus(maya)).toBe("paid");

        // While it waits: the same press is the one press, and nothing else goes back on that payment.
        expect(read(await pressOn(maya, terminal.id, 2500, key)).pressId).toBe(first.pressId);
        const other = await desk(gym);
        const second = await pressOn(maya, other.id);
        expect(second.statusCode).toBe(409);
        expect(errorOf(second)).toBe("card_refund_waiting");
        const noted = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 2500, method: "cash", reason: "paid_twice" });
        expect(noted.statusCode, noted.body).toBe(409);
        expect(asked(maya)).toHaveLength(1);
        expect(await refundsOf(maya)).toHaveLength(0);

        // On the Terminal's screen, still nothing given back.
        square.terminalRefundShown(onlyAsked(maya).id);
        expect(read(await look(maya, first.pressId)).onTerminal?.pickedUp).toBe(true);
        expect(await refundsOf(maya)).toHaveLength(0);

        square.terminalRefundUsed(onlyAsked(maya).id);
        expect(read(await look(maya, first.pressId)).step).toBe("pending");
        expect(await refundsOf(maya)).toMatchObject([{ amount_minor: 2500, method: "company", undone: false }]);
        expect(madeFor(maya)).toHaveLength(1);

        // Looked at again and pressed again: still one refund.
        await look(maya, first.pressId);
        await work();
        expect(read(await pressOn(maya, terminal.id, 2500, key)).pressId).toBe(first.pressId);
        const again = await pressOn(maya, terminal.id);
        expect(again.statusCode).toBe(409);
        expect(asked(maya)).toHaveLength(1);
        expect(await refundsOf(maya)).toHaveLength(1);
      });

      it("the person cancels on the Terminal: no money stands as given back, and it can be tried again", async () => {
        const maya = await interacPaid(gym, "Maya Cancels");
        const terminal = await desk(gym, "cancels");
        const first = read(await pressOn(maya, terminal.id));
        const seen = read(await look(maya, first.pressId));
        expect(seen.step).toBe("ended");
        expect(seen.onTerminal?.ended).toBe("cancelled_on_terminal");
        expect(await pressesOf(maya)).toMatchObject([{ state: "done", outcome: "cancelled", code: "BUYER_CANCELED", square_refund_id: null }]);
        expect(await refundsOf(maya)).toHaveLength(0);
        expect(await billStatus(maya)).toBe("paid");
        // A cancel is no failure: nothing to review, and nothing said under the payment.
        expect((await paymentOnPage(maya)).cardRefund).toBeNull();

        square.devices.set(terminal.deviceId, { accountId: gym.acct.merchantId, behaviour: "person" });
        const next = read(await pressOn(maya, terminal.id));
        expect(next.pressId).not.toBe(first.pressId);
        square.terminalRefundUsed(asked(maya)[1]?.id ?? "");
        await look(maya, next.pressId);
        expect(await refundsOf(maya)).toHaveLength(1);
      });

      it("Square says COMPLETED for another amount or payment: nothing is written, and it is left to check", async () => {
        const maya = await interacPaid(gym, "Maya Other");
        const terminal = await desk(gym);
        const first = read(await pressOn(maya, terminal.id, 1000));
        onlyAsked(maya).amount_money = { amount: 1100, currency: "USD" };
        square.terminalRefundUsed(onlyAsked(maya).id);
        expect(read(await look(maya, first.pressId)).step).toBe("lost");
        expect(await pressesOf(maya)).toMatchObject([{ state: "done", outcome: "lost", code: "NOT_OURS" }]);
        expect(await refundsOf(maya)).toHaveLength(0);
      });

      it("Square's request names another payment or amount while it waits: it is stopped at Square, so a second press cannot send the money twice", async () => {
        const maya = await interacPaid(gym, "Maya Stray");
        const terminal = await desk(gym);
        const first = read(await pressOn(maya, terminal.id, 1000));
        onlyAsked(maya).amount_money = { amount: 1100, currency: "USD" };
        expect(read(await look(maya, first.pressId)).step).toBe("lost");
        expect(await pressesOf(maya)).toMatchObject([{ state: "done", outcome: "lost", code: "NOT_OURS" }]);
        expect(onlyAsked(maya).status).toBe("CANCELED");
        expect(await refundsOf(maya)).toHaveLength(0);
      });

      it("that request cannot be stopped because Square gives no answer: the press holds on, and is not freed", async () => {
        const maya = await interacPaid(gym, "Maya Stray Down");
        const terminal = await desk(gym);
        const first = read(await pressOn(maya, terminal.id, 1000));
        const real = square.api.cancelTerminalRefund.bind(square.api);
        square.api.cancelTerminalRefund = () => Promise.resolve({ kind: "unavailable", status: null });
        onlyAsked(maya).amount_money = { amount: 1100, currency: "USD" };
        expect(read(await look(maya, first.pressId)).step).toBe("terminal");
        square.api.cancelTerminalRefund = real;
        expect(read(await look(maya, first.pressId)).step).toBe("lost");
        expect(onlyAsked(maya).status).toBe("CANCELED");
      });

      it("Square writes the Terminal's id another way: it is the same request, and it goes back once", async () => {
        const maya = await interacPaid(gym, "Maya Device");
        const terminal = await desk(gym);
        const first = read(await pressOn(maya, terminal.id, 1000));
        onlyAsked(maya).device_id = `device:${terminal.deviceId}`;
        square.terminalRefundUsed(onlyAsked(maya).id);
        expect(read(await look(maya, first.pressId)).step).toBe("pending");
        expect(asked(maya)).toHaveLength(1);
        expect(await refundsOf(maya)).toHaveLength(1);
      });

      it("Square says COMPLETED and its refund stays unread: read for a day, then left to check, and nothing is written", async () => {
        const maya = await interacPaid(gym, "Maya Day");
        const terminal = await desk(gym);
        const first = read(await pressOn(maya, terminal.id));
        square.terminalRefundUsed(onlyAsked(maya).id);
        square.state.refundUnread = true;
        const started = clock;
        clock = new Date(started.getTime() + TERMINAL_REFUND.deadlineMs + TERMINAL_REFUND.graceMs + 60_000);
        const later = read(await look(maya, first.pressId)).step;
        clock = new Date(started.getTime() + TERMINAL_REFUND.giveUpMs + 60_000);
        const lastly = read(await look(maya, first.pressId)).step;
        clock = started;
        square.state.refundUnread = false;
        expect(later).toBe("terminal");
        expect(lastly).toBe("lost");
        expect(await refundsOf(maya)).toHaveLength(0);
      });

      it("Square says COMPLETED but its refund cannot be read yet: nothing is written until it can", async () => {
        const maya = await interacPaid(gym, "Maya Unread");
        const terminal = await desk(gym);
        const first = read(await pressOn(maya, terminal.id));
        square.terminalRefundUsed(onlyAsked(maya).id);
        square.state.refundUnread = true;
        expect(read(await look(maya, first.pressId)).step).toBe("terminal");
        expect(await refundsOf(maya)).toHaveLength(0);
        square.state.refundUnread = false;
        expect(read(await look(maya, first.pressId)).step).toBe("pending");
        expect(await refundsOf(maya)).toHaveLength(1);
      });

      it("Square's answer to the press is lost: the same request is read back, never a second", async () => {
        const maya = await interacPaid(gym, "Maya Lost");
        const terminal = await desk(gym);
        square.state.refundLost = true;
        const first = read(await pressOn(maya, terminal.id));
        square.state.refundLost = false;
        expect(first.step).toBe("terminal");
        expect(asked(maya)).toHaveLength(1);
        read(await look(maya, first.pressId));
        expect(asked(maya)).toHaveLength(1);
        expect((await sql<{ id: string | null }[]>`SELECT terminal_refund_id AS id FROM gym_square_refunds WHERE id = ${first.pressId}`)[0]?.id).toBe(onlyAsked(maya).id);
      });
    });

    it("a page closed while it waits: the worker finishes it", async () => {
      const maya = await interacPaid(gym, "Maya Worker");
      const terminal = await desk(gym);
      read(await pressOn(maya, terminal.id));
      square.terminalRefundUsed(onlyAsked(maya).id);
      const started = clock;
      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      clock = started;
      expect(await refundsOf(maya)).toHaveLength(1);
    });

    it("the Terminal never shows it: it is cancelled after a minute, and the box says why", async () => {
      const maya = await interacPaid(gym, "Maya Offline");
      const terminal = await desk(gym, "offline");
      const first = read(await pressOn(maya, terminal.id));
      expect(read(await look(maya, first.pressId)).step).toBe("terminal");
      const started = clock;
      clock = new Date(clock.getTime() + TERMINAL_REFUND.notShownMs + 1000);
      const seen = read(await look(maya, first.pressId));
      clock = started;
      expect(seen.onTerminal?.ended).toBe("no_answer");
      expect(onlyAsked(maya).status).toBe("CANCELED");
    });

    it("past Square's own time with no end from it: Square is asked to cancel", async () => {
      const maya = await interacPaid(gym, "Maya Late");
      const terminal = await desk(gym);
      const first = read(await pressOn(maya, terminal.id));
      const started = clock;
      square.terminalRefundShown(onlyAsked(maya).id);
      read(await look(maya, first.pressId));
      onlyAsked(maya).status = "PENDING";
      clock = new Date(clock.getTime() + TERMINAL_REFUND.deadlineMs + TERMINAL_REFUND.graceMs + 1000);
      const seen = read(await look(maya, first.pressId));
      clock = started;
      expect(seen.onTerminal?.ended).toBe("timed_out");
    });

    it.each(["IN_PROGRESS", "CANCEL_REQUESTED", "A_STATUS_SQUARE_ADDS_LATER"])("%s for good: after a day it is left to check, on Refunds to review, and frees the Terminal", async (status) => {
      const g = await makeGym(`Terminal No End ${uniq()}`, `MERCH${uniq()}`);
      const maya = await interacPaid(g, "Maya Stuck");
      const leo = await interacPaid(g, "Leo Next");
      const terminal = await desk(g);
      const first = read(await pressOn(maya, terminal.id));
      onlyAsked(maya).status = status;
      const started = clock;
      clock = new Date(started.getTime() + TERMINAL_REFUND.giveUpMs - 60_000);
      const before = read(await look(maya, first.pressId)).step;
      clock = new Date(started.getTime() + TERMINAL_REFUND.giveUpMs + 60_000);
      const after = read(await look(maya, first.pressId)).step;
      clock = started;
      expect(before).toBe("terminal");
      expect(after).toBe("lost");
      expect(await pressesOf(maya)).toMatchObject([{ state: "done", outcome: "lost", code: "NO_END" }]);
      expect(await refundsOf(maya)).toHaveLength(0);
      const list = await send("GET", `/v1/orgs/${g.id}/refunds-to-review?from=0`, g.owner.cookies);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.body).toContain(maya.paymentId);
      read(await pressOn(leo, terminal.id, 500));
    });

    it("Square gives no answer: a press it never answered is left to check after an hour, a request it made after a day", async () => {
      const maya = await interacPaid(gym, "Maya Silent");
      const leo = await interacPaid(gym, "Leo Silent");
      const a = await desk(gym);
      const b = await desk(gym);
      square.state.refundLost = true;
      const never = read(await pressOn(maya, a.id));
      square.state.refundLost = false;
      square.state.refundDown = true;
      const started = clock;
      clock = new Date(started.getTime() + CARD_REFUND.resendForMs + 60_000);
      const silent = read(await look(maya, never.pressId)).step;
      clock = started;
      square.state.refundDown = false;
      expect(silent).toBe("lost");
      const made = read(await pressOn(leo, b.id));
      square.state.down = true;
      clock = new Date(started.getTime() + CARD_REFUND.resendForMs + 60_000);
      const within = read(await look(leo, made.pressId)).step;
      clock = new Date(started.getTime() + TERMINAL_REFUND.giveUpMs + 60_000);
      const past = read(await look(leo, made.pressId)).step;
      clock = started;
      square.state.down = false;
      expect(within).toBe("terminal");
      expect(past).toBe("lost");
    });

    it("Square refuses Cancel with any code once the person has started: the box says so and never says it is stopping", async () => {
      const maya = await interacPaid(gym, "Maya Refused");
      const terminal = await desk(gym);
      const first = read(await pressOn(maya, terminal.id));
      square.terminalRefundShown(onlyAsked(maya).id);
      square.state.terminalCancelRefusal = 409;
      const seen = read(await stop(maya, first.pressId));
      square.state.terminalCancelRefusal = 400;
      expect(seen.onTerminal).toMatchObject({ tooLate: true, stopping: false });
    });

    it("a box opened on another payment of the same bill finds what waits", async () => {
      const maya = await interacPaid(gym, "Maya Two Payments");
      const terminal = await desk(gym);
      const first = read(await pressOn(maya, terminal.id, 1000));
      const open = await checkOf(maya);
      expect(open.waitingPress?.pressId).toBe(first.pressId);
      const [other] = await sql<{ id: string }[]>`SELECT id FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${maya.billId} AND id <> ${maya.paymentId}`;
      expect(other).toBeUndefined();
      const found = await waitingOnTerminalOfBill(sql, gym.id, maya.billId);
      expect(found?.id).toBe(first.pressId);
      expect(await waitingOnTerminalOfBill(sql, nextDoor.id, maya.billId)).toBeNull();
    });

    it("a card save waits for a refund on that Terminal", async () => {
      const maya = await interacPaid(gym, "Maya Save");
      const terminal = await desk(gym);
      read(await pressOn(maya, terminal.id));
      const entryId = await person(gym, "Saver Busy");
      const save = await send("POST", `${entryUrl(gym, entryId)}/card/terminal`, gym.owner.cookies, { terminalId: terminal.id, requestKey: randomUUID() });
      expect(save.statusCode, save.body).toBe(409);
      expect(errorOf(save)).toBe("terminal_busy");
    });

    it("who may: staff without the ticks are refused, and a gym with no live plan cannot press or cancel, though it can read", async () => {
      const g = await makeGym(`Terminal Ticks ${uniq()}`, `MERCH${uniq()}`);
      const maya = await interacPaid(g, "Maya Ticks");
      const terminal = await desk(g);
      const first = read(await pressOn(maya, terminal.id));
      const desker = await signedIn("Desk Only");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${g.id}, ${desker.userId}, 'trainer', ${["billing.members"]})`;
      const trainer = await signedIn("Trainer Only");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${g.id}, ${trainer.userId}, 'trainer', ${["members.read"]})`;
      for (const by of [desker, trainer]) {
        expect((await look(maya, first.pressId, by)).statusCode).toBe(403);
        expect((await stop(maya, first.pressId, by)).statusCode).toBe(403);
      }
      expect(onlyAsked(maya).status).toBe("PENDING");
      await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${g.id}`;
      expect((await look(maya, first.pressId)).statusCode).toBe(200);
      const refused = await stop(maya, first.pressId);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("gym_not_on_plan");
      expect(onlyAsked(maya).status).toBe("PENDING");
    });

    it("Square's test area plays each Terminal's part; a real Terminal is sent as it is", () => {
      const interac = "388b5a08-a77c-48ef-ad2a-4a790e6f2789";
      expect(refundDevice({ environment: "sandbox" }, interac)).toBe("f72dfb8e-4d65-4e56-aade-ec3fb8d33291");
      expect(refundDevice({ environment: "sandbox" }, "7647344e-aea2-4cff-ac53-513644de434d")).toBe("7647344e-aea2-4cff-ac53-513644de434d");
      expect(refundDevice({ environment: "production" }, interac)).toBe(interac);
    });

    it("Cancel stops it until the person starts; after that it says so and finishes there", async () => {
      const maya = await interacPaid(gym, "Maya Stop");
      const terminal = await desk(gym);
      const first = read(await pressOn(maya, terminal.id));
      const seen = read(await stop(maya, first.pressId));
      expect(seen.step).toBe("ended");
      expect(seen.onTerminal?.ended).toBe("cancelled");
      expect(await refundsOf(maya)).toHaveLength(0);

      const next = read(await pressOn(maya, terminal.id));
      const latest = asked(maya)[1];
      square.terminalRefundShown(latest?.id ?? "");
      const tooLate = read(await stop(maya, next.pressId));
      expect(tooLate.step).toBe("terminal");
      expect(tooLate.onTerminal).toMatchObject({ tooLate: true, stopping: false });
      square.terminalRefundUsed(latest?.id ?? "");
      await look(maya, next.pressId);
      expect(await refundsOf(maya)).toHaveLength(1);
    });

    it("one Terminal does one thing: a refund waits for a free Terminal, and a payment for a refund's", async () => {
      const maya = await interacPaid(gym, "Maya Busy");
      const leo = await interacPaid(gym, "Leo Busy");
      const terminal = await desk(gym);
      read(await pressOn(maya, terminal.id));
      const busy = await pressOn(leo, terminal.id);
      expect(busy.statusCode).toBe(409);
      expect(errorOf(busy)).toBe("terminal_busy");
      expect(await pressesOf(leo)).toHaveLength(0);

      const entryId = await person(gym, "Payer Busy");
      const today = (await held(gym, gym.owner, entryId)).today;
      const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId: gym.typeId, startsOn: today, paid: false });
      expect(given.statusCode, given.body).toBe(201);
      const membershipId = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0]?.id ?? "";
      const pay = await send("POST", `${entryUrl(gym, entryId)}/memberships/${membershipId}/terminal-payment`, gym.owner.cookies, { terminalId: terminal.id, requestKey: randomUUID(), periodIndex: 0, amountMinor: 2500 });
      expect(pay.statusCode).toBe(409);
      expect(errorOf(pay)).toBe("terminal_busy");
    });

    it("a stranger: another gym's Terminal is refused, and another gym's press cannot be read or stopped", async () => {
      const maya = await interacPaid(gym, "Maya Stranger");
      const theirs = await desk(nextDoor);
      const refused = await pressOn(maya, theirs.id);
      expect(refused.statusCode).toBe(404);
      expect(errorOf(refused)).toBe("terminal_gone");
      expect(asked(maya)).toHaveLength(0);

      const terminal = await desk(gym);
      const first = read(await pressOn(maya, terminal.id));
      expect((await send("GET", `/v1/orgs/${nextDoor.id}/card-refunds/${first.pressId}`, nextDoor.owner.cookies)).statusCode).toBe(404);
      expect((await send("POST", `/v1/orgs/${nextDoor.id}/card-refunds/${first.pressId}/cancel`, nextDoor.owner.cookies)).statusCode).toBe(404);
      expect([403, 404]).toContain((await look(maya, first.pressId, nextDoor.owner)).statusCode);
      expect([403, 404]).toContain((await stop(maya, first.pressId, nextDoor.owner)).statusCode);
      expect(onlyAsked(maya).status).toBe("PENDING");
      read(await stop(maya, first.pressId));
    });

    it("a card Square does not mark goes to the card, whatever Terminal is named", async () => {
      const maya = await paidByCard(gym, "Visa Named");
      const terminal = await desk(gym);
      read(await pressOn(maya, terminal.id, 500));
      expect(madeFor(maya)).toHaveLength(1);
      expect(asked(maya)).toHaveLength(0);
    });

    it("the box names the Terminals and an opened box finds what waits; the page says it waits on the Terminal", async () => {
      const g = await makeGym(`Terminal Box ${uniq()}`, `MERCH${uniq()}`);
      const maya = await interacPaid(g, "Maya Box");
      expect(await checkOf(maya)).toMatchObject({ onTerminal: true, terminals: [], card: { brand: "INTERAC", last4: "4242" } });
      const terminal = await desk(g);
      expect((await checkOf(maya)).terminals).toEqual([{ id: terminal.id, serial: terminal.deviceId, practice: null }]);
      const first = read(await pressOn(maya, terminal.id, 1000));
      const open = await checkOf(maya);
      expect(open.block).toBe("waiting");
      expect(open.waitingPress?.pressId).toBe(first.pressId);
      expect((await paymentOnPage(maya)).cardRefund).toMatchObject({ amountMinor: 1000, onTerminal: true, lost: false });
    });
  });

  describe("what stops a refund before it is sent", () => {
    const blockOf = async (p: Paid) => cardRefundCheckSchema.parse(JSON.parse((await send("GET", refundUrl(p), gym.owner.cookies)).body));

    it("an Interac debit card with no Terminal named: nothing is sent to the card or a Terminal", async () => {
      const maya = await interacPaid(gym, "Interac Debit");
      expect(await blockOf(maya)).toMatchObject({ block: null, onTerminal: true });
      const res = await press(maya, 100);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("card_refund_pick_terminal");
      expect(madeFor(maya)).toHaveLength(0);
      expect(square.terminalRefunds.filter((f) => f.payment_id === maya.squarePaymentId)).toHaveLength(0);
    });

    it("a payment over a year old", async () => {
      const maya = await paidByCard(gym, "Year Old");
      const p = square.paymentById(maya.squarePaymentId);
      if (p === undefined) throw new Error("no payment");
      p.created_at = new Date(clock.getTime() - 366 * 24 * 60 * 60_000).toISOString();
      expect((await blockOf(maya)).block).toBe("too_old");
    });

    it("a payment Square has not finished, or that doesn't match", async () => {
      const maya = await paidByCard(gym, "Not Finished");
      const p = square.paymentById(maya.squarePaymentId);
      if (p === undefined) throw new Error("no payment");
      p.status = "APPROVED";
      expect((await blockOf(maya)).block).toBe("not_finished");
      p.status = "COMPLETED";
      p.total_money = { amount: 9900, currency: "USD" };
      expect((await blockOf(maya)).block).toBe("differs");
      p.total_money = { amount: 2500, currency: "USD" };
    });

    it("money already refunded inside Square: the box says so, and only the rest can go", async () => {
      const maya = await paidByCard(gym, "Refunded In Square");
      const p = square.paymentById(maya.squarePaymentId);
      if (p === undefined) throw new Error("no payment");
      p.refunded_money = { amount: 1000, currency: "USD" };
      expect(await blockOf(maya)).toMatchObject({ leftMinor: 1500, refundedInSquareMinor: 1000, block: null });
      expect((await press(maya, 1501)).statusCode).toBe(409);
      expect(madeFor(maya)).toHaveLength(0);
      expect((await press(maya, 1500)).statusCode).toBe(200);
      expect(madeFor(maya)).toHaveLength(1);
    });

    it("a payment taken in the Square account the gym used before", async () => {
      const other = await makeGym(`Moved Account ${uniq()}`, `MERCH${uniq()}`);
      const maya = await paidByCard(other, "Old Account");
      expect((await send("DELETE", `/v1/orgs/${other.id}/payments/square`, other.owner.cookies)).statusCode).toBe(200);
      await connect(other, account(`MERCHNEW${uniq()}`));
      const res = await send("GET", refundUrl(maya), other.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect(cardRefundCheckSchema.parse(JSON.parse(res.body)).block).toBe("other_account");
      expect((await press(maya, 100)).statusCode).toBe(409);
      expect(madeFor(maya)).toHaveLength(0);
    });
  });

  describe("with everything else on the page", () => {
    it("the line at the top of the membership waits for Square too", async () => {
      const maya = await paidByCard(gym, "Top Line");
      const top = async () => (await held(gym, gym.owner, maya.entryId)).memberships.find((m) => m.id === maya.membershipId);
      await press(maya, 2500);
      expect(await top()).toMatchObject({ refundedInFull: true, refundPending: true });
      square.refundEnds(madeFor(maya)[0]?.id ?? "", "COMPLETED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect(await top()).toMatchObject({ refundedInFull: true, refundPending: false });
    });

    it("a refund to the card cannot be voided, and one noted by hand still can", async () => {
      const maya = await paidByCard(gym, "Void Rules");
      await press(maya, 500);
      const sent = (await refundsOf(maya))[0];
      const voidIt = (id: string) =>
        send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds/${id}/void`, gym.owner.cookies, { reason: "mistake" });
      const refused = await voidIt(sent?.id ?? "");
      expect(refused.statusCode).toBe(409);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("card_refund_void");
      const noted = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 500, method: "cash", reason: "other" });
      expect(noted.statusCode, noted.body).toBe(200);
      const hand = (await refundsOf(maya)).find((r) => r.method === "cash");
      expect((await voidIt(hand?.id ?? "")).statusCode).toBe(200);
    });

    it("its receipt and the gym's record say what happened", async () => {
      const maya = await paidByCard(gym, "Receipt Reader");
      await press(maya, 700);
      const row = (await refundsOf(maya))[0];
      const receipt = await send("GET", `/v1/orgs/${gym.id}/receipts/${String(row?.receipt_number ?? 0)}`, gym.owner.cookies);
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(JSON.parse(receipt.body)).toMatchObject({ kind: "refund", method: "company", refundedMinor: 700 });
      const [audit] = await sql<{ action: string; meta: Record<string, string> }[]>`
        SELECT action, meta FROM audit_log WHERE gym_id = ${gym.id} AND target_id = ${row?.id ?? ""}`;
      expect(audit).toMatchObject({ action: "org.member_refund_sent", meta: { amountMinor: "700", brand: "VISA", last4: "1111" } });
    });

    it("a change of membership waits for a refund Square has not answered", async () => {
      const maya = await paidByCard(gym, "Change Waits");
      square.state.refundLost = true;
      await press(maya, 500);
      square.state.refundLost = false;
      const today = (await held(gym, gym.owner, maya.entryId)).today;
      const change = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/change`, gym.owner.cookies, {
        requestKey: randomUUID(),
        typeId: gym.typeId,
        when: "today",
        startsOn: today,
        priceMinor: 2500,
        creditMinor: 0,
        totalMinor: 2500,
        paid: false,
      });
      expect(change.statusCode, change.body).toBe(409);
      expect((JSON.parse(change.body) as { error: string }).error).toBe("card_refund_waiting");
    });

    it("tells the gym's open lines to read the person's memberships again", async () => {
      const maya = await paidByCard(gym, "Live News");
      const before = await hub.toldAbout(gym.id, maya.entryId);
      await press(maya, 300);
      expect(await hub.toldAbout(gym.id, maya.entryId, before + 1)).toBeGreaterThan(before);
    });
  });

  // 18d-iv-b-i. The worst thing here is the same one, on a fee: refunded twice, refunded more than was paid, or the wrong
  // person's. A failed fee refund handing out a member's gift is in `referrals.memberGift.routes.test.ts`.
  describe("a fee", () => {
    // A gym of its own: the same owner is held to the sixty presses an hour the routes allow.
    beforeAll(async () => {
      gym = await makeGym(`Fee Gym ${uniq()}`, `MERCH${uniq()}`);
    }, T);

    it("Maya's $10.00 no-show fee goes back to the card once, and nobody else's moves", async () => {
      const maya = await feePaid(gym, "Maya Fee");
      const ravi = await feePaid(gym, "Ravi Fee");
      const nina = await feePaid(nextDoor, "Nina Fee");

      const box = await send("GET", refundUrl(maya), gym.owner.cookies);
      expect(box.statusCode, box.body).toBe(200);
      expect(cardRefundCheckSchema.parse(JSON.parse(box.body))).toMatchObject({ card: { brand: "VISA", last4: "1111" }, leftMinor: 1000, refundedInSquareMinor: 0, block: null });

      const key = randomUUID();
      const [first, again] = await Promise.all([press(maya, 1000, key), press(maya, 1000, key)]);
      expect(first.statusCode, first.body).toBe(200);
      expect(again.statusCode, again.body).toBe(200);
      expect(madeFor(maya)).toHaveLength(1);
      expect(madeFor(maya)[0]).toMatchObject({ amount_money: { amount: 1000, currency: "USD" }, accountId: gym.acct.merchantId });
      expect((await refundsOf(maya)).map((r) => [r.amount_minor, r.method, r.undone])).toEqual([[1000, "company", false]]);
      expect(await billStatus(maya)).toBe("refunded");

      const shown = await feeOnPage(maya);
      expect(shown).toMatchObject({ state: "refunded", refundedMinor: 1000, can: { pay: false, waive: false, voidPaymentId: null } });
      expect(shown.payments[0]).toMatchObject({ refundableMinor: 0, cardRefund: null, refunds: [{ amountMinor: 1000, method: "company", square: { state: "pending" } }] });

      const second = await press(maya, 1);
      expect(second.statusCode).toBe(409);
      expect((JSON.parse(second.body) as { error: string }).error).toBe("card_refund_nothing_left");
      expect(madeFor(maya)).toHaveLength(1);

      // Ravi's fee through Maya's door, next door's through ours, and next door's owner at our address.
      const wrongDoor = await send("POST", refundUrl(maya, maya.entryId, maya.membershipId, ravi.paymentId), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect(wrongDoor.statusCode).toBe(404);
      const wrongRecord = await send("GET", refundUrl(ravi, maya.entryId, ravi.membershipId, ravi.paymentId), gym.owner.cookies);
      expect(wrongRecord.statusCode).toBe(404);
      const ours = await send("POST", refundUrl(maya, maya.entryId, maya.membershipId, nina.paymentId), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect(ours.statusCode).toBe(404);
      const stranger = await send("POST", refundUrl(ravi), nextDoor.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, reason: "other" });
      expect([403, 404]).toContain(stranger.statusCode);
      const noted = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${ravi.paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, method: "cash", reason: "other" });
      expect(noted.statusCode).toBe(404);
      expect(madeFor(ravi)).toHaveLength(0);
      expect(madeFor(nina)).toHaveLength(0);
      expect(await refundsOf(ravi)).toHaveLength(0);
      expect(await refundsOf(nina)).toHaveLength(0);
      expect(await billStatus(ravi)).toBe("paid");
    });

    it("two members of staff at one instant never send more than was paid", async () => {
      const maya = await feePaid(gym, "Fee Two Staff");
      const answers = await Promise.all([press(maya, 800), press(maya, 800), press(maya, 800), press(maya, 800)]);
      expect(answers.filter((a) => a.statusCode === 200)).toHaveLength(1);
      expect(madeFor(maya)).toHaveLength(1);
      expect((await refundsOf(maya)).map((r) => r.amount_minor)).toEqual([800]);
    });

    it("part of a fee: it stays Paid, says what is left, and never goes over", async () => {
      const maya = await feePaid(gym, "Fee Part");
      expect((await press(maya, 400)).statusCode).toBe(200);
      const part = await feeOnPage(maya);
      expect(part).toMatchObject({ state: "paid", refundedMinor: 400 });
      expect(part.payments[0]?.refundableMinor).toBe(600);
      const over = await press(maya, 601);
      expect(over.statusCode).toBe(409);
      expect((JSON.parse(over.body) as { message: string }).message).toBe("That is more than can be refunded. $6.00 is the most.");
      expect((await press(maya, 600)).statusCode).toBe(200);
      expect(await billStatus(maya)).toBe("refunded");
      expect(madeFor(maya).map((r) => r.amount_money.amount)).toEqual([400, 600]);
    });

    it("a fee paid on the Terminal goes back the same way, and reads as the Terminal's", async () => {
      const maya = await feePaid(gym, "Fee Terminal");
      await sql`UPDATE gym_member_payments SET method = 'terminal' WHERE gym_id = ${gym.id} AND id = ${maya.paymentId}`;
      expect((await press(maya, 1000)).statusCode).toBe(200);
      expect((await refundsOf(maya)).map((r) => r.method)).toEqual(["terminal"]);
    });

    it("a fee paid by hand is never sent to Square, takes no refund, and is voided as it always was", async () => {
      const { entryId, membershipId, billId } = await feeOwed(gym, "Fee Cash");
      const at = `${entryUrl(gym, entryId)}/memberships/${membershipId}`;
      const paid = await send("POST", `${at}/fees/${billId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, method: "cash" });
      expect(paid.statusCode, paid.body).toBe(200);
      const p: Paid = { gym, entryId, membershipId, billId, paymentId: "", squarePaymentId: "" };
      const fee = await feeOnPage(p);
      const paymentId = fee.payments[0]?.id ?? "";
      expect(fee.payments[0]?.refundableMinor).toBe(0);
      expect(fee.can.voidPaymentId).toBe(paymentId);
      const toCard = await send("POST", refundUrl({ ...p, paymentId }), gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, reason: "other" });
      expect(toCard.statusCode).toBe(409);
      expect((JSON.parse(toCard.body) as { error: string }).error).toBe("card_refund_not_card");
      const noted = await send("POST", `${at}/payments/${paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, method: "cash", reason: "other" });
      expect(noted.statusCode).toBe(409);
      expect(await refundsOf({ ...p, paymentId })).toHaveLength(0);
    });

    it("Note a refund on a fee taken through Square: it counts, and Void refund takes it back", async () => {
      const maya = await feePaid(gym, "Fee Noted");
      const at = `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds`;
      const noted = await send("POST", at, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, method: "cash", reason: "other" });
      expect(noted.statusCode, noted.body).toBe(200);
      expect(await billStatus(maya)).toBe("refunded");
      expect((await feeOnPage(maya)).state).toBe("refunded");
      expect(madeFor(maya)).toHaveLength(0);
      const refund = (await refundsOf(maya))[0];
      const voided = await send("POST", `${at}/${refund?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
      expect(voided.statusCode, voided.body).toBe(200);
      const back = await feeOnPage(maya);
      expect(back).toMatchObject({ state: "paid", refundedMinor: 0 });
      expect(back.payments[0]).toMatchObject({ refundableMinor: 1000, voidedRefunds: [{ amountMinor: 1000, voided: { reason: "mistake" } }] });
    });

    it("pending, then finished by the worker's look; the press names itself, so a sentence follows its own refund", async () => {
      const maya = await feePaid(gym, "Fee Pending");
      const sent = cardRefundResponseSchema.parse(JSON.parse((await press(maya, 1000)).body));
      expect(sent.step).toBe("pending");
      expect((await feeOnPage(maya)).payments[0]?.refunds[0]?.square?.pressId).toBe(sent.pressId);
      square.refundEnds(madeFor(maya)[0]?.id ?? "", "COMPLETED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect((await pressesOf(maya))[0]).toMatchObject({ state: "done", outcome: "completed" });
      expect((await feeOnPage(maya)).payments[0]?.refunds[0]?.square).toMatchObject({ state: "completed", pressId: sent.pressId });
    });

    it("a change of membership waits for a fee's refund Square has not answered", async () => {
      const maya = await feePaid(gym, "Fee Change Waits");
      square.state.refundLost = true;
      await press(maya, 500);
      square.state.refundLost = false;
      const today = (await held(gym, gym.owner, maya.entryId)).today;
      const change = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/change`, gym.owner.cookies, {
        requestKey: randomUUID(),
        typeId: gym.typeId,
        when: "today",
        startsOn: today,
        priceMinor: 2500,
        creditMinor: 0,
        totalMinor: 2500,
        paid: false,
      });
      expect(change.statusCode, change.body).toBe(409);
      expect((JSON.parse(change.body) as { error: string }).error).toBe("card_refund_waiting");
    });

    it("a freeze fee refunded, then unfrozen, stays no longer owed if Square fails the refund", async () => {
      const maya = await feePaid(gym, "Fee Freeze");
      await sql`UPDATE gym_member_bills SET fee = 'freeze', fee_for = 'Gold Weekly' WHERE gym_id = ${gym.id} AND id = ${maya.billId}`;
      expect((await press(maya, 1000)).statusCode).toBe(200);
      const [bill] = await sql<{ covers_from: string }[]>`SELECT covers_from::text AS covers_from FROM gym_member_bills WHERE id = ${maya.billId}`;
      await sql.begin((tx) => removeFreezeFees(tx, gym.id, maya.membershipId, bill?.covers_from ?? "", clock));
      square.refundEnds(madeFor(maya)[0]?.id ?? "", "FAILED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect(await feeOnPage(maya)).toMatchObject({ state: "paid", stillOwed: false });
    });

    it("Square fails it after taking it up: no money went, the fee reads Paid, and it can be sent again", async () => {
      const maya = await feePaid(gym, "Fee Failed");
      expect((await press(maya, 1000)).statusCode).toBe(200);
      expect(await billStatus(maya)).toBe("refunded");
      square.refundEnds(madeFor(maya)[0]?.id ?? "", "FAILED");
      clock = new Date(clock.getTime() + CARD_REFUND.lookAfterMs[0] + 1000);
      await work();
      expect(await billStatus(maya)).toBe("paid");
      expect(await refundsOf(maya)).toMatchObject([{ undone: true, void_reason: "square_failed" }]);
      const shown = await feeOnPage(maya);
      expect(shown).toMatchObject({ state: "paid", refundedMinor: 0 });
      expect(shown.payments[0]).toMatchObject({ refunds: [], refundableMinor: 1000, voidedRefunds: [{ voided: { reason: "square_failed", by: null } }] });
      expect((await press(maya, 1000)).statusCode).toBe(200);
    });

    it("no answer from Square: the fee's page says so, nothing else is noted meanwhile, and asked again it is refunded once", async () => {
      const maya = await feePaid(gym, "Fee Lost");
      square.state.refundLost = true;
      await press(maya, 500);
      square.state.refundLost = false;
      expect((await feeOnPage(maya)).payments[0]?.cardRefund).toMatchObject({ amountMinor: 500, lost: false });
      const noted = await send("POST", `${entryUrl(gym, maya.entryId)}/memberships/${maya.membershipId}/payments/${maya.paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 100, method: "cash", reason: "other" });
      expect(noted.statusCode).toBe(409);
      expect((JSON.parse(noted.body) as { error: string }).error).toBe("card_refund_waiting");

      clock = new Date(clock.getTime() + CARD_REFUND.idleMs + 1000);
      await work();
      expect(madeFor(maya)).toHaveLength(1);
      expect((await refundsOf(maya)).map((r) => r.amount_minor)).toEqual([500]);
      expect((await feeOnPage(maya)).payments[0]).toMatchObject({ cardRefund: null, refundableMinor: 500 });
    });

    it("its receipts, Reports, the payments download and the gym's record all say what happened", async () => {
      const maya = await feePaid(gym, "Fee Records");
      const refundedInReports = async () => {
        const res = await send("GET", `/v1/orgs/${gym.id}/reports/money`, gym.owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { report: { thisMonth: { refundedMinor: number } } }).report.thisMonth.refundedMinor;
      };
      const before = await refundedInReports();
      await press(maya, 700);
      expect(await refundedInReports()).toBe(before + 700);
      const row = (await refundsOf(maya))[0];
      const receipt = await send("GET", `/v1/orgs/${gym.id}/receipts/${String(row?.receipt_number ?? 0)}`, gym.owner.cookies);
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(JSON.parse(receipt.body)).toMatchObject({ kind: "refund", method: "company", refundedMinor: 700 });
      const [paid] = await sql<{ receipt_number: number; paid_on: string }[]>`SELECT receipt_number, paid_on::text AS paid_on FROM gym_member_payments WHERE gym_id = ${gym.id} AND id = ${maya.paymentId}`;
      const paidReceipt = await send("GET", `/v1/orgs/${gym.id}/receipts/${String(paid?.receipt_number ?? 0)}`, gym.owner.cookies);
      expect(JSON.parse(paidReceipt.body)).toMatchObject({ kind: "payment", refunds: [{ amountMinor: 700 }] });
      const day = paid?.paid_on ?? "";
      const { lastReceipt } = await totals(sql, gym.id, day, "2099-12-31");
      const lines = await linesPage(sql, gym.id, day, "2099-12-31", lastReceipt, null);
      expect(lines.filter((l) => l.receipt === row?.receipt_number).map((l) => [l.kind, l.item, l.amountMinor])).toEqual([["refund", "No-show fee · Yoga", 700]]);
      const [audit] = await sql<{ action: string; meta: Record<string, string> }[]>`
        SELECT action, meta FROM audit_log WHERE gym_id = ${gym.id} AND target_id = ${row?.id ?? ""}`;
      expect(audit).toMatchObject({ action: "org.member_refund_sent", meta: { fee: "no_show", amountMinor: "700", brand: "VISA", last4: "1111" } });
      expect(audit?.meta).not.toHaveProperty("period");
    });
  });

  describe("Refunds to review", () => {
    // A gym of its own: a list holds everything its gym left open.
    let mine: Gym;
    const list = async (g: Gym, by: Person = g.owner, from = 0) => {
      const res = await send("GET", `/v1/orgs/${g.id}/refunds-to-review?from=${String(from)}`, by.cookies);
      expect(res.statusCode, res.body).toBe(200);
      return refundsToReviewResponseSchema.parse(JSON.parse(res.body));
    };
    const rowOf = async (g: Gym, paymentId: string) => (await list(g)).rows.find((r) => r.member?.paymentId === paymentId);
    const keep = (g: Gym, billId: string, by: Person = g.owner) => send("POST", `/v1/orgs/${g.id}/refunds-to-review/fees/${billId}/keep`, by.cookies);
    const noRefund = (g: Gym, pressId: string, by: Person = g.owner) => send("POST", `/v1/orgs/${g.id}/refunds-to-review/presses/${pressId}/no-refund`, by.cookies);
    const auditsOf = async (g: Gym, action: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${g.id} AND action = ${action}`)[0]?.n;
    /** Square took it up and the answer never came back: the app ends it as one to check. */
    const takenWithNoAnswer = async (p: Paid, minor: number) => {
      square.state.refundLost = true;
      await press(p, minor);
      square.state.refundLost = false;
      await sql`UPDATE gym_square_refunds SET state = 'done', outcome = 'lost', checking_until = NULL WHERE gym_id = ${p.gym.id} AND payment_id = ${p.paymentId}`;
    };
    const failedAtOnce = async (p: Paid, minor: number) => {
      square.state.refundStatus = "REJECTED";
      await press(p, minor);
      square.state.refundStatus = "PENDING";
    };

    beforeAll(async () => {
      mine = await makeGym(`Review Gym ${uniq()}`, `MERCH${uniq()}`);
    }, T);

    it("the worst thing: a refund Square took with no answer cannot be sent a second time from its row", async () => {
      const maya = await paidByCard(mine, "Review Twice");
      await takenWithNoAnswer(maya, 2500);
      expect(madeFor(maya)).toHaveLength(1);
      const row = await rowOf(mine, maya.paymentId);
      expect(row).toMatchObject({ kind: "lost", amountMinor: 2500, name: "Review Twice" });

      const box = cardRefundCheckSchema.parse(JSON.parse((await send("GET", refundUrl(maya), mine.owner.cookies)).body));
      expect(box).toMatchObject({ leftMinor: 0, refundedInSquareMinor: 2500, block: "nothing_left" });
      const again = await press(maya, 2500);
      expect(again.statusCode).toBe(409);
      expect(madeFor(maya)).toHaveLength(1);
    });

    it("the worst thing: nobody sees another gym's rows, or decides on them", async () => {
      const ours = await feePaid(mine, "Review Ours");
      const theirs = await feePaid(nextDoor, "Review Theirs");
      expect((await list(mine)).rows.map((r) => r.name)).not.toContain("Review Theirs");
      expect((await list(nextDoor)).rows.map((r) => r.name)).not.toContain("Review Ours");

      const peek = await send("GET", `/v1/orgs/${mine.id}/refunds-to-review`, nextDoor.owner.cookies);
      expect([403, 404]).toContain(peek.statusCode);
      expect([403, 404]).toContain((await keep(mine, ours.billId, nextDoor.owner)).statusCode);
      // Next door's fee through our own address.
      expect((await keep(mine, theirs.billId)).statusCode).toBe(404);
      const failed = await paidByCard(nextDoor, "Review Failed Next Door");
      await failedAtOnce(failed, 500);
      const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_square_refunds WHERE gym_id = ${nextDoor.id} AND payment_id = ${failed.paymentId}`;
      expect((await noRefund(mine, row?.id ?? "")).statusCode).toBe(404);
      expect((await sql`SELECT 1 FROM gym_member_bills WHERE id = ${theirs.billId} AND fee_kept_at IS NOT NULL`).length).toBe(0);
      expect((await sql`SELECT 1 FROM gym_square_refunds WHERE id = ${row?.id ?? ""} AND no_refund_at IS NOT NULL`).length).toBe(0);
    });

    it("a fee is listed only while it is no longer owed and something of it is left", async () => {
      const noLonger = await feePaid(mine, "Review No Longer");
      expect(await rowOf(mine, noLonger.paymentId)).toMatchObject({
        kind: "fee",
        amountMinor: 1000,
        paidMinor: 1000,
        member: { entryId: noLonger.entryId, membershipId: noLonger.membershipId, byHand: false, fee: { kind: "no_show", of: "class", forName: "Yoga" } },
      });

      const owed = await feePaid(mine, "Review Still Owed");
      await sql`UPDATE gym_member_bills SET fee = 'freeze' WHERE id = ${owed.billId}`;
      expect(await rowOf(mine, owed.paymentId)).toBeUndefined();
      expect((await keep(mine, owed.billId)).statusCode).toBe(409);

      const part = await feePaid(mine, "Review Part");
      expect((await press(part, 400)).statusCode).toBe(200);
      expect(await rowOf(mine, part.paymentId)).toMatchObject({ amountMinor: 600, paidMinor: 1000 });

      const whole = await feePaid(mine, "Review Whole");
      expect((await press(whole, 1000)).statusCode).toBe(200);
      expect(await rowOf(mine, whole.paymentId)).toBeUndefined();
    });

    it("a fee paid by hand is listed to be voided", async () => {
      const { entryId, membershipId, billId } = await feeOwed(mine, "Review By Hand", 800);
      const paid = await send("POST", `${entryUrl(mine, entryId)}/memberships/${membershipId}/fees/${billId}/payments`, mine.owner.cookies, { requestKey: randomUUID(), amountMinor: 800, method: "cash" });
      expect(paid.statusCode, paid.body).toBeLessThan(300);
      const row = (await list(mine)).rows.find((r) => r.id === billId);
      expect(row).toMatchObject({ kind: "fee", amountMinor: 800, member: { byHand: true } });
    });

    it("Keep the fee takes it off, once, says who and when on their page, and Refund stays", async () => {
      const maya = await feePaid(mine, "Review Keep");
      const [one, two] = await Promise.all([keep(mine, maya.billId), keep(mine, maya.billId)]);
      expect(one.statusCode, one.body).toBe(204);
      expect(two.statusCode, two.body).toBe(204);
      expect(await rowOf(mine, maya.paymentId)).toBeUndefined();
      const shown = await feeOnPage(maya);
      expect(shown.kept).toMatchObject({ by: expect.stringContaining("Owner") as string });
      expect(shown.payments[0]?.refundableMinor).toBe(1000);
      expect(madeFor(maya)).toHaveLength(0);
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE target_id = ${maya.billId} AND action = 'org.member_fee_kept'`)[0]?.n).toBe(1);
      expect((await press(maya, 1000)).statusCode).toBe(200);
      expect(madeFor(maya)).toHaveLength(1);
    });

    it("a refund that failed is listed; one sent since takes it off, and a smaller one leaves it", async () => {
      const maya = await paidByCard(mine, "Review Failed");
      await failedAtOnce(maya, 1000);
      clock = new Date(clock.getTime() + 1000);
      expect(await rowOf(mine, maya.paymentId)).toMatchObject({ kind: "failed", amountMinor: 1000 });
      expect((await press(maya, 400)).statusCode).toBe(200);
      expect(await rowOf(mine, maya.paymentId)).toMatchObject({ kind: "failed" });
      expect((await press(maya, 600)).statusCode).toBe(200);
      expect(await rowOf(mine, maya.paymentId)).toBeUndefined();
    });

    it("a fee whose refund failed is one row, and No refund needed keeps the fee too", async () => {
      const maya = await feePaid(mine, "Review Fee Failed");
      await failedAtOnce(maya, 1000);
      await failedAtOnce(maya, 1000);
      const shown = (await list(mine)).rows.filter((r) => r.member?.paymentId === maya.paymentId);
      expect(shown.map((r) => r.kind)).toEqual(["failed"]);

      const res = await noRefund(mine, shown[0]?.id ?? "");
      expect(res.statusCode, res.body).toBe(204);
      expect(await rowOf(mine, maya.paymentId)).toBeUndefined();
      const fee = await feeOnPage(maya);
      expect(fee.kept).not.toBeNull();
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_square_refunds WHERE payment_id = ${maya.paymentId} AND no_refund_at IS NULL`)[0]?.n).toBe(0);
      expect((await noRefund(mine, shown[0]?.id ?? "")).statusCode).toBe(204);
      expect(fee.payments[0]?.cardRefund).toMatchObject({ decided: { by: expect.stringContaining("Owner") as string } });
    });

    it("No refund needed on one Square never answered: their page stops asking, and says who decided", async () => {
      const maya = await paidByCard(mine, "Review Lost");
      square.state.refundDown = true;
      await press(maya, 1500);
      square.state.refundDown = false;
      await sql`UPDATE gym_square_refunds SET state = 'done', outcome = 'lost', checking_until = NULL WHERE payment_id = ${maya.paymentId}`;
      const row = await rowOf(mine, maya.paymentId);
      expect(row?.kind).toBe("lost");
      expect((await paymentOnPage(maya)).cardRefund).toMatchObject({ lost: true, decided: null });
      expect((await noRefund(mine, row?.id ?? "")).statusCode).toBe(204);
      expect(await rowOf(mine, maya.paymentId)).toBeUndefined();
      expect((await paymentOnPage(maya)).cardRefund?.decided).toMatchObject({ by: expect.stringContaining("Owner") as string });
      expect(await auditsOf(mine, "org.refund_not_needed")).toBeGreaterThanOrEqual(1);
    });

    it("a refund still pending past Square's 14 days is listed, and cannot be marked as needing none", async () => {
      const maya = await paidByCard(mine, "Review Late");
      expect((await press(maya, 700)).statusCode).toBe(200);
      expect(await rowOf(mine, maya.paymentId)).toBeUndefined();
      await sql`UPDATE gym_square_refunds SET started_at = started_at - interval '15 days' WHERE payment_id = ${maya.paymentId}`;
      const row = await rowOf(mine, maya.paymentId);
      expect(row).toMatchObject({ kind: "late", amountMinor: 700 });
      expect((await noRefund(mine, row?.id ?? "")).statusCode).toBe(409);
    });

    it("staff with the payments tick alone see no person's row and cannot decide one; a trainer sees nothing", async () => {
      const maya = await feePaid(mine, "Review Ticks");
      const desk = await signedIn("Review Desk");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${mine.id}, ${desk.userId}, 'trainer', ${["billing.members"]})`;
      expect((await list(mine, desk)).rows.filter((r) => r.member !== null)).toEqual([]);
      expect((await keep(mine, maya.billId, desk)).statusCode).toBe(403);
      const trainer = await signedIn("Review Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${mine.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
      expect((await send("GET", `/v1/orgs/${mine.id}/refunds-to-review`, trainer.cookies)).statusCode).toBe(403);
    });

    it("a press still waiting on Square: the fee is not listed, and neither decision goes through", async () => {
      const maya = await feePaid(mine, "Review Asking");
      const key = randomUUID();
      await sql`INSERT INTO gym_square_refunds (id, gym_id, payment_id, environment, account_id, square_payment_id, amount_minor, currency, reason, request_key, state, started_at, checked_at)
                VALUES (${randomUUID()}, ${mine.id}, ${maya.paymentId}, 'production', ${mine.acct.merchantId}, ${maya.squarePaymentId}, 1000, 'USD', 'other', ${key}, 'asking', ${clock}, ${clock})`;
      expect(await rowOf(mine, maya.paymentId)).toBeUndefined();
      const res = await keep(mine, maya.billId);
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("card_refund_waiting");

      const ravi = await paidByCard(mine, "Review Asking Failed");
      await failedAtOnce(ravi, 500);
      const row = await rowOf(mine, ravi.paymentId);
      await sql`INSERT INTO gym_square_refunds (id, gym_id, payment_id, environment, account_id, square_payment_id, amount_minor, currency, reason, request_key, state, started_at, checked_at)
                VALUES (${randomUUID()}, ${mine.id}, ${ravi.paymentId}, 'production', ${mine.acct.merchantId}, ${ravi.squarePaymentId}, 500, 'USD', 'other', ${randomUUID()}, 'asking', ${clock}, ${clock})`;
      const waiting = await noRefund(mine, row?.id ?? "");
      expect(waiting.statusCode).toBe(409);
      expect((JSON.parse(waiting.body) as { error: string }).error).toBe("card_refund_waiting");
      await sql`UPDATE gym_square_refunds SET state = 'done', outcome = 'lost' WHERE gym_id = ${mine.id} AND state = 'asking'`;
    });

    it("No refund needed on a fee still owed does not mark it kept", async () => {
      const maya = await feePaid(mine, "Review Owed Failed");
      await sql`UPDATE gym_member_bills SET fee = 'freeze' WHERE id = ${maya.billId}`;
      await failedAtOnce(maya, 300);
      const row = await rowOf(mine, maya.paymentId);
      expect((await noRefund(mine, row?.id ?? "")).statusCode).toBe(204);
      expect((await sql`SELECT 1 FROM gym_member_bills WHERE id = ${maya.billId} AND fee_kept_at IS NOT NULL`).length).toBe(0);
    });

    it("a smaller refund since: the row says what is left; a newer failure stands over an older decision", async () => {
      const maya = await paidByCard(mine, "Review Left");
      await failedAtOnce(maya, 1000);
      clock = new Date(clock.getTime() + 1000);
      expect((await press(maya, 400)).statusCode).toBe(200);
      expect(await rowOf(mine, maya.paymentId)).toMatchObject({ kind: "failed", amountMinor: 600, paidMinor: 1000, others: 0 });

      const ravi = await paidByCard(mine, "Review Newer");
      await failedAtOnce(ravi, 300);
      const first = await rowOf(mine, ravi.paymentId);
      expect((await noRefund(mine, first?.id ?? "")).statusCode).toBe(204);
      expect((await paymentOnPage(ravi)).cardRefund?.decided).not.toBeNull();
      clock = new Date(clock.getTime() + 1000);
      await failedAtOnce(ravi, 300);
      expect((await rowOf(mine, ravi.paymentId))?.kind).toBe("failed");
      expect((await paymentOnPage(ravi)).cardRefund).toBeNull();
    });

    it("one Square never answered stays said under a newer failure; a late refund is not counted as closing", async () => {
      const maya = await paidByCard(mine, "Review Lost Then Failed");
      square.state.refundDown = true;
      await press(maya, 400);
      square.state.refundDown = false;
      await sql`UPDATE gym_square_refunds SET state = 'done', outcome = 'lost', checking_until = NULL WHERE payment_id = ${maya.paymentId}`;
      clock = new Date(clock.getTime() + 1000);
      await failedAtOnce(maya, 600);
      expect((await paymentOnPage(maya)).cardRefund).toMatchObject({ amountMinor: 400, lost: true, decided: null });
      expect(await rowOf(mine, maya.paymentId)).toMatchObject({ kind: "failed", others: 1 });

      const ravi = await paidByCard(mine, "Review Late Then Failed");
      expect((await press(ravi, 300)).statusCode).toBe(200);
      await sql`UPDATE gym_square_refunds SET started_at = started_at - interval '15 days' WHERE payment_id = ${ravi.paymentId}`;
      await failedAtOnce(ravi, 300);
      expect(await rowOf(mine, ravi.paymentId)).toMatchObject({ kind: "failed", others: 0 });
    });

    it("a past member is said so; failed comes before late, late before a fee", async () => {
      const g = await makeGym(`Review Order ${uniq()}`, `MERCH${uniq()}`);
      const fee = await feePaid(g, "Order Fee");
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${fee.entryId}`;
      const late = await paidByCard(g, "Order Late");
      expect((await press(late, 700)).statusCode).toBe(200);
      await sql`UPDATE gym_square_refunds SET started_at = now() - interval '15 days' WHERE payment_id = ${late.paymentId}`;
      const failed = await paidByCard(g, "Order Failed");
      await failedAtOnce(failed, 100);
      await sql`UPDATE gym_square_refunds SET started_at = now() - interval '20 days' WHERE payment_id = ${failed.paymentId}`;
      const rows = (await list(g)).rows;
      expect(rows.map((r) => r.kind)).toEqual(["failed", "late", "fee"]);
      expect(rows[2]).toMatchObject({ past: true, name: "Order Fee" });
    });

    it("a gym that can only read refuses both; a bad id or a bad page is a 400", async () => {
      const g = await makeGym(`Review Lapsed ${uniq()}`, `MERCH${uniq()}`);
      const maya = await feePaid(g, "Lapsed Fee");
      expect((await send("GET", `/v1/orgs/${g.id}/refunds-to-review?from=-1`, g.owner.cookies)).statusCode).toBe(400);
      expect((await keep(g, "not-a-uuid")).statusCode).toBe(400);
      expect((await noRefund(g, "not-a-uuid")).statusCode).toBe(400);
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${g.id}`;
      const lapsed = await keep(g, maya.billId);
      expect(lapsed.statusCode).toBe(409);
      expect((JSON.parse(lapsed.body) as { error: string }).error).toBe("gym_not_on_plan");
      expect((await noRefund(g, randomUUID())).statusCode).toBe(409);
      expect((await list(g)).count).toBe(1);
    });

    it("a page holds ten rows and says where the next starts, with refunds that went wrong first", async () => {
      const g = await makeGym(`Review Pages ${uniq()}`, `MERCH${uniq()}`);
      for (let i = 0; i < 11; i += 1) await feeOwedPaidByHand(g, `Review Page ${String(i)}`);
      const failed = await paidByCard(g, "Review First");
      await failedAtOnce(failed, 100);
      const first = await list(g);
      expect(first).toMatchObject({ count: 12, next: 10 });
      expect(first.rows).toHaveLength(10);
      expect(first.rows[0]?.name).toBe("Review First");
      const second = await list(g, g.owner, 10);
      expect(second).toMatchObject({ count: 12, next: null });
      expect(second.rows).toHaveLength(2);
    });
  });
});
