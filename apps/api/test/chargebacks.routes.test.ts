// A chargeback shown on its payment (ROADMAP 18d-iv-e-i; spec Part 3 §14.8), through the routes and the worker's minute against real
// Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, whose chargebacks are as Square's test area
// showed one on 2026-11-01.
//
// The first block is the worst thing this job could do to a real person: a chargeback shown on somebody else, the wrong date, or a card
// charged again by itself after its owner told their bank a charge was wrong.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  chargebacksResponseSchema,
  gymPaymentsResponseSchema,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentsResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { keepSquareEvent } from "../src/modules/webhooks/repo.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
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
const LIVE_PLAN = "zz_chargeback";

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
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("A chargeback (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  const hub = recordingHub();
  // Past 6 in the morning at a Chicago gym, whenever this runs: the app charges from then.
  let clock = new Date(Math.max(Date.now(), Date.parse(`${new Date().toISOString().slice(0, 10)}T18:00:00.000Z`)));
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cbck-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'cbck-t-%@example.com'`;
    await sql`DELETE FROM gym_square_disputes WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'cbck-t-%@example.com'`;
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
    const email = `cbck-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const connect = async (gym: { id: string; owner: Person }, acct: Account, outcome = "connected") => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe(outcome);
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
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `cbck-r-${uniq()}@example.com` });
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

  const message = async (merchantId: string, disputeId: string, type = "dispute.created") => {
    const eventId = randomUUID();
    await keepSquareEvent(sql, { eventId, payload: { type, accountId: merchantId, disputeId } });
    return await processSquareWork(workDeps(), [eventId], gyms.map((g) => g.id));
  };
  const rowsOf = (squarePaymentId: string) =>
    sql<{ gym_id: string; state: string; reason: string | null; amount_minor: number; last4: string | null }[]>`
      SELECT gym_id, state, reason, amount_minor, last4 FROM gym_square_disputes WHERE square_payment_id = ${squarePaymentId}`;
  const onOverview = async (g: Gym, by: Person = g.owner) => {
    const res = await send("GET", `/v1/orgs/${g.id}/chargebacks`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return chargebacksResponseSchema.parse(JSON.parse(res.body));
  };
  /** The next week's bill falls due and opens, on a membership whose second week has been paid. */
  const nextWeekOpens = async (p: Paid) => {
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${p.gym.id} AND id = ${p.membershipId}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${p.gym.id} AND held_membership_id = ${p.membershipId}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [p.gym.id] });
    const [bill] = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM gym_member_bills WHERE gym_id = ${p.gym.id} AND held_membership_id = ${p.membershipId} AND period_index = 2`;
    expect(bill?.status, "the third week's bill is open").toBe("open");
    return bill?.id ?? "";
  };
  const chargesByTheApp = (billId: string) => sql<{ state: string }[]>`SELECT state FROM gym_card_charges WHERE bill_id = ${billId} AND by_schedule`;

  describe("the worst thing", () => {
    it("Maya's chargeback is on Maya's payment alone, with Square's own date, and once", async () => {
      const maya = await paidByCard(gym, "Dispute Maya");
      const ravi = await paidByCard(gym, "Dispute Ravi");
      const nina = await paidByCard(nextDoor, "Dispute Nina");
      const made = square.disputeInSquare(maya.squarePaymentId);

      await message(gym.acct.merchantId, made.id);
      await message(gym.acct.merchantId, made.id);
      expect(await rowsOf(maya.squarePaymentId)).toEqual([{ gym_id: gym.id, state: "EVIDENCE_REQUIRED", reason: "NO_KNOWLEDGE", amount_minor: 2500, last4: "1111" }]);

      const shown = (await paymentOnPage(maya)).chargebacks;
      expect(shown).toHaveLength(1);
      // Square's midnight UTC is the evening before on a Chicago gym's calendar: the earlier day, never a counted one.
      const due = new Date(made.due_at ?? "");
      const chicago = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(due);
      expect(shown[0]).toMatchObject({ amountMinor: 2500, currency: "USD", state: "EVIDENCE_REQUIRED", reason: "NO_KNOWLEDGE", dueOn: chicago, duePassed: false, card: { brand: "VISA", last4: "1111" } });

      // Same price, other people: nothing.
      expect((await paymentOnPage(ravi)).chargebacks).toEqual([]);
      expect((await paymentOnPage(nina)).chargebacks).toEqual([]);

      const list = await onOverview(gym);
      expect(list.rows.filter((r) => r.name === "Dispute Maya")).toHaveLength(1);
      expect(list.rows.some((r) => r.name === "Dispute Ravi")).toBe(false);
      expect((await onOverview(nextDoor)).rows.some((r) => r.name === "Dispute Maya")).toBe(false);
      expect(list.rows.find((r) => r.name === "Dispute Maya")?.member?.entryId).toBe(maya.entryId);

      // Told to Staff activity once, for Maya, with nobody named as having done it.
      const notes = await sql<{ actor_user_id: string | null }[]>`
        SELECT actor_user_id FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.chargeback' AND meta->>'entryId' = ${maya.entryId}`;
      expect(notes).toEqual([{ actor_user_id: null }]);
    });

    it("a fee's chargeback is on the fee's payment, and stops the card too", async () => {
      const fay = await feePaid(gym, "Dispute Fay");
      await message(gym.acct.merchantId, square.disputeInSquare(fay.squarePaymentId).id);
      const fee = await feeOnPage(fay);
      expect(fee.payments[0]?.chargebacks.map((c) => c.state)).toEqual(["EVIDENCE_REQUIRED"]);
      expect((await onOverview(gym)).rows.find((r) => r.name === "Dispute Fay")?.member?.what).toBe("No-show fee");
    });

    it("a message naming another account writes nothing: its token cannot read that chargeback", async () => {
      const sam = await paidByCard(gym, "Dispute Sam");
      const made = square.disputeInSquare(sam.squarePaymentId);
      await message(nextDoor.acct.merchantId, made.id);
      expect(await rowsOf(sam.squarePaymentId)).toEqual([]);
    });

    it("a payment this gym does not hold writes nothing", async () => {
      const other = await paidByCard(nextDoor, "Dispute Other");
      const made = square.disputeInSquare(other.squarePaymentId);
      await sql`UPDATE gym_member_payments SET provider_payment_id = ${"gone" + uniq()} WHERE gym_id = ${nextDoor.id} AND id = ${other.paymentId}`;
      await message(nextDoor.acct.merchantId, made.id);
      expect(await rowsOf(other.squarePaymentId)).toEqual([]);
    });

    it("the card is not charged by itself while a chargeback is open, or lost; a win starts it again, and it is charged once", async () => {
      const tara = await paidByCard(gym, "Dispute Tara");
      const made = square.disputeInSquare(tara.squarePaymentId);
      await message(gym.acct.merchantId, made.id);
      const billId = await nextWeekOpens(tara);

      await work();
      expect(await chargesByTheApp(billId)).toEqual([]);
      const page = await held(gym, gym.owner, tara.entryId);
      expect(page.memberships.flatMap((m) => m.billing?.bills ?? []).find((b) => b.id === billId)?.chargesStopped).toBe(true);

      for (const moved of ["PROCESSING", "LOST", "ACCEPTED", "INQUIRY_EVIDENCE_REQUIRED", "A_STATE_NOBODY_PLACED"]) {
        square.disputeMoves(made.id, moved);
        await message(gym.acct.merchantId, made.id, "dispute.state.updated");
        await work();
        expect(await chargesByTheApp(billId), moved).toEqual([]);
      }

      square.disputeMoves(made.id, "WON");
      await message(gym.acct.merchantId, made.id, "dispute.state.updated");
      await Promise.all([work(), work()]);
      await work();
      expect(await chargesByTheApp(billId)).toHaveLength(1);
      const after = await held(gym, gym.owner, tara.entryId);
      expect(after.memberships.flatMap((m) => m.billing?.bills ?? []).find((b) => b.id === billId)?.chargesStopped).toBe(false);
    });

    it("whoever pays for others: a chargeback on one stops the card for the other too", async () => {
      const mum = await paidByCard(gym, "Dispute Mum");
      const son = await paidByCard(gym, "Dispute Son");
      await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${son.entryId}`;
      await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${gym.id}, ${son.entryId}, ${mum.entryId}, ${gym.owner.userId})`;
      await message(gym.acct.merchantId, square.disputeInSquare(mum.squarePaymentId).id);
      const billId = await nextWeekOpens(son);
      await work();
      expect(await chargesByTheApp(billId)).toEqual([]);
    });

    it("staff can still charge by hand while it is stopped", async () => {
      const lee = await paidByCard(gym, "Dispute Lee");
      await message(gym.acct.merchantId, square.disputeInSquare(lee.squarePaymentId).id);
      const billId = await nextWeekOpens(lee);
      const start = await send("POST", `${entryUrl(gym, lee.entryId)}/memberships/${lee.membershipId}/card-charge`, gym.owner.cookies, {
        requestKey: randomUUID(),
        periodIndex: 2,
        amountMinor: 2500,
        cardRef: await cardRefOf(gym, lee.entryId),
      });
      expect(start.statusCode, start.body).toBe(200);
      expect((await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE id = ${billId}`)[0]?.status).toBe("paid");
    });
  });

  describe("what Square answers", () => {
    it("the hourly read finds one no message brought, and follows it", async () => {
      const una = await paidByCard(gym, "Dispute Una");
      const made = square.disputeInSquare(una.squarePaymentId);
      clock = new Date(clock.getTime() + 2 * 60 * 60_000);
      await work();
      expect((await rowsOf(una.squarePaymentId)).map((r) => r.state)).toEqual(["EVIDENCE_REQUIRED"]);
      square.disputeMoves(made.id, "WON");
      clock = new Date(clock.getTime() + 2 * 60 * 60_000);
      await work();
      expect((await rowsOf(una.squarePaymentId)).map((r) => r.state)).toEqual(["WON"]);
      expect((await onOverview(gym)).rows.some((r) => r.name === "Dispute Una")).toBe(false);
    });

    it("an older answer arriving late never moves a newer one back", async () => {
      const bo = await paidByCard(gym, "Dispute Bo");
      const made = square.disputeInSquare(bo.squarePaymentId);
      await message(gym.acct.merchantId, made.id);
      const first = made.updated_at;
      clock = new Date(clock.getTime() + 60_000);
      square.disputeMoves(made.id, "WON");
      await message(gym.acct.merchantId, made.id, "dispute.state.updated");
      made.state = "EVIDENCE_REQUIRED";
      made.updated_at = first ?? null;
      await message(gym.acct.merchantId, made.id, "dispute.created");
      expect((await rowsOf(bo.squarePaymentId)).map((r) => r.state)).toEqual(["WON"]);
    });

    it("a state nobody has placed still shows, and asks staff to check; a reason nobody has placed shows none", async () => {
      const kim = await paidByCard(gym, "Dispute Kim");
      await message(gym.acct.merchantId, square.disputeInSquare(kim.squarePaymentId, { state: "PRE_ARBITRATION", reason: "SOMETHING_NEW" }).id);
      expect((await paymentOnPage(kim)).chargebacks[0]).toMatchObject({ state: "UNKNOWN", reason: null });
      expect((await onOverview(gym)).rows.some((r) => r.name === "Dispute Kim")).toBe(true);
    });

    it("once Square's date has gone it leaves the list and says so on the payment; Square not answering is asked again", async () => {
      const pia = await paidByCard(gym, "Dispute Pia");
      const made = square.disputeInSquare(pia.squarePaymentId);
      square.state.down = true;
      const event = randomUUID();
      await keepSquareEvent(sql, { eventId: event, payload: { type: "dispute.created", accountId: gym.acct.merchantId, disputeId: made.id } });
      await processSquareWork(workDeps(), [event], gyms.map((g) => g.id));
      square.state.down = false;
      expect(await rowsOf(pia.squarePaymentId)).toEqual([]);
      const [kept] = await sql<{ status: string }[]>`SELECT status FROM webhook_events WHERE event_id = ${event}`;
      expect(kept?.status).not.toBe("done");

      await message(gym.acct.merchantId, made.id);
      expect(await rowsOf(pia.squarePaymentId)).toHaveLength(1);
      await sql`UPDATE gym_square_disputes SET due_at = ${new Date(clock.getTime() - 60_000)} WHERE square_payment_id = ${pia.squarePaymentId}`;
      expect((await paymentOnPage(pia)).chargebacks[0]?.duePassed).toBe(true);
      expect((await onOverview(gym)).rows.some((r) => r.name === "Dispute Pia")).toBe(false);
    });

    it("a connection from before the permission asks nothing of Square, and tells the owner", async () => {
      const old = await makeGym(`Old Gym ${uniq()}`, `MERCH${uniq()}`);
      const dee = await paidByCard(old, "Dispute Dee");
      const made = square.disputeInSquare(dee.squarePaymentId);
      await sql`UPDATE gym_payment_connections SET scopes = array_remove(scopes, 'DISPUTES_READ') WHERE gym_id = ${old.id}`;
      const asked = square.disputeAsks.length;
      await message(old.acct.merchantId, made.id);
      clock = new Date(clock.getTime() + 2 * 60 * 60_000);
      await work();
      expect(square.disputeAsks.length).toBe(asked);
      expect(await rowsOf(dee.squarePaymentId)).toEqual([]);
      const list = await onOverview(old);
      expect(list).toMatchObject({ needsReconnect: true, canReconnect: true });
      const res = await send("GET", `/v1/orgs/${old.id}/payments`, old.owner.cookies);
      const box = gymPaymentsResponseSchema.parse(JSON.parse(res.body)).payments;
      expect(box.needsAllow).toBe(true);
      expect(box.allowFor).toEqual(["chargebacks"]);
      // The Terminal does not need this permission: nobody is made to reconnect for it.
      expect(box.terminals?.needsAllow ?? false).toBe(false);
      await connect(old, old.acct, "connected_again");
      await work();
      expect(await rowsOf(dee.squarePaymentId)).toHaveLength(1);
    });
  });

  describe("who sees it", () => {
    it("a stranger gets 404, and the shape of the route refuses a bad page", async () => {
      const maya = await paidByCard(gym, "Dispute Stranger Test");
      await message(gym.acct.merchantId, square.disputeInSquare(maya.squarePaymentId).id);
      const stranger = await signedIn("Stranger");
      expect((await send("GET", `/v1/orgs/${gym.id}/chargebacks`, stranger.cookies)).statusCode).toBe(404);
      expect((await send("GET", `/v1/orgs/${gym.id}/chargebacks`, nextDoor.owner.cookies)).statusCode).toBe(404);
      expect((await send("GET", `/v1/orgs/${gym.id}/chargebacks`, {})).statusCode).toBe(401);
      expect((await send("GET", `/v1/orgs/${gym.id}/chargebacks?from=-1`, gym.owner.cookies)).statusCode).toBe(400);
    });
  });
});
