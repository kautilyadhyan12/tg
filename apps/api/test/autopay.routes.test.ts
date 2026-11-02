// Pause automatic payments (ROADMAP 18d-iv-f; spec Part 3 §14.8), through the routes and the worker's minute against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`.
//
// The first block is the worst thing this job could do to a real person: a member who asked to pay at the desk having their saved card
// charged anyway, by the bill's date, by a retry after a decline, or as the payer for somebody else.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  autopayPreviewSchema,
  memberCardResponseSchema,
  staffActivityResponseSchema,
  orgWords,
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
import { chargeDueBill } from "../src/modules/orgs/payments/cardCharges.js";
import { dueBills, pendingRetries, retryBills, startCharge } from "../src/modules/orgs/payments/cardChargesRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { STAFF_LINES } from "../src/modules/orgs/staffActivity/words.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
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
const LIVE_PLAN = "zz_autopay";

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
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("Pause automatic payments (real Postgres)", { timeout: T }, () => {
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'apau-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'apau-t-%@example.com'`;
    await sql`DELETE FROM gym_square_disputes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_autopay_pauses WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'apau-t-%@example.com'`;
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
    const email = `apau-t-${uniq()}@example.com`;
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
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `apau-r-${uniq()}@example.com` });
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


  const autopayUrl = (g: Gym, entryId: string) => `${entryUrl(g, entryId)}/card/autopay`;
  const pause = async (g: Gym, entryId: string, by: Person = g.owner) => {
    const res = await send("POST", `${autopayUrl(g, entryId)}/pause`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberCardResponseSchema.parse(JSON.parse(res.body)).cardOnFile;
  };
  const resume = async (g: Gym, entryId: string, by: Person = g.owner) => {
    const res = await send("POST", `${autopayUrl(g, entryId)}/resume`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberCardResponseSchema.parse(JSON.parse(res.body)).cardOnFile;
  };
  const billOnPage = async (g: Gym, entryId: string, billId: string) =>
    (await held(g, g.owner, entryId)).memberships.flatMap((m) => m.billing?.bills ?? []).find((b) => b.id === billId);
  /** Son, whose card is his mum's: a renewing membership of his own, paid for by her. */
  const paidForBy = async (payer: Paid, fullName: string): Promise<Paid> => {
    const son = await paidByCard(payer.gym, fullName);
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${payer.gym.id} AND entry_id = ${son.entryId}`;
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${payer.gym.id}, ${son.entryId}, ${payer.entryId}, ${payer.gym.owner.userId})`;
    return son;
  };
  const scheduleCharge = async (p: Paid, periodIndex: number) => {
    const [conn] = await sql<{ account_id: string; location_id: string; currency: string }[]>`SELECT account_id, location_id, currency FROM gym_payment_connections WHERE gym_id = ${p.gym.id}`;
    const today = (await held(p.gym, p.gym.owner, p.entryId)).today;
    return await startCharge(sql, {
      gymId: p.gym.id,
      entryId: p.entryId,
      membershipId: p.membershipId,
      target: { kind: "period", periodIndex },
      amountMinor: null,
      cardRef: null,
      environment: "production",
      accountId: conn?.account_id ?? "",
      locationId: conn?.location_id ?? "",
      accountCurrency: conn?.currency ?? "",
      bySchedule: true,
      requestKey: randomUUID(),
      id: randomUUID(),
      startedBy: null,
      today,
      now: clock,
      checkingUntil: new Date(clock.getTime() + 60_000),
    });
  };

  describe("the worst thing", () => {
    it("paused: neither Pia's card nor the son she pays for is charged on the bill's date; Resume charges each bill once", async () => {
      const pia = await paidByCard(gym, "Pause Pia");
      const son = await paidForBy(pia, "Pause Son");
      const shown = await pause(gym, pia.entryId);
      expect(shown.card).toMatchObject({ brand: "VISA", last4: "1111" });
      expect(shown.autopayPausedOn).toBe((await held(gym, gym.owner, pia.entryId)).today);
      const piaBill = await nextWeekOpens(pia);
      const sonBill = await nextWeekOpens(son);
      // Never even found by the worker's look, whose own write checks again under the record's lock.
      const listed = await dueBills(sql, { environment: "production", now: clock, limit: 1000, after: null, gymIds: [gym.id] });
      expect(listed.map((b) => b.billId)).not.toContain(piaBill);
      expect(listed.map((b) => b.billId)).not.toContain(sonBill);

      await work();
      await work();
      expect(await chargesByTheApp(piaBill)).toEqual([]);
      expect(await chargesByTheApp(sonBill)).toEqual([]);
      expect((await billOnPage(gym, pia.entryId, piaBill))?.chargeStop).toEqual({ kind: "paused", heldBy: null });
      expect((await billOnPage(gym, son.entryId, sonBill))?.chargeStop).toEqual({ kind: "paused", heldBy: { entryId: pia.entryId, name: "Pause Pia" } });
      // The card is kept.
      expect(await sql`SELECT 1 FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${pia.entryId}`).toHaveLength(1);

      await resume(gym, pia.entryId);
      await Promise.all([work(), work()]);
      await work();
      expect(await chargesByTheApp(piaBill)).toHaveLength(1);
      expect(await chargesByTheApp(sonBill)).toHaveLength(1);
      expect((await billOnPage(gym, pia.entryId, piaBill))?.chargeStop ?? null).toBeNull();
    });

    it("a card declined before the pause: no try again while paused, and the bill no longer promises one", async () => {
      const vic = await paidByCard(gym, "Pause Vic");
      const billId = await nextWeekOpens(vic);
      const [card] = await sql<{ card_id: string; customer_id: string }[]>`SELECT card_id, customer_id FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${vic.entryId}`;
      square.card(card?.card_id ?? "", gym.acct.merchantId, card?.customer_id ?? "", "insufficient");
      await work();
      expect(await chargesByTheApp(billId)).toHaveLength(1);
      expect((await pendingRetries(sql, gym.id, [billId], clock)).size).toBe(1);
      await pause(gym, vic.entryId);
      expect(await pendingRetries(sql, gym.id, [billId], clock)).toEqual(new Map());
      square.card(card?.card_id ?? "", gym.acct.merchantId, card?.customer_id ?? "", "pays");
      // Through both of the retry days (3 and 7 days after the decline).
      for (let day = 1; day <= 8; day += 1) {
        clock = new Date(clock.getTime() + 24 * 60 * 60_000);
        await work();
      }
      expect(await chargesByTheApp(billId)).toHaveLength(1);
    });

    it("a retry the worker listed a moment before Pause keeps its day, and comes back after Resume", async () => {
      const rex = await paidByCard(gym, "Pause Rex");
      const billId = await nextWeekOpens(rex);
      const [card] = await sql<{ card_id: string; customer_id: string }[]>`SELECT card_id, customer_id FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${rex.entryId}`;
      square.card(card?.card_id ?? "", gym.acct.merchantId, card?.customer_id ?? "", "insufficient");
      await work();
      expect(await chargesByTheApp(billId)).toHaveLength(1);
      // The first retry day (3 days after the decline): the worker lists the bill, then staff press Pause before it is charged.
      clock = new Date(clock.getTime() + 3 * 24 * 60 * 60_000);
      const settings = workDeps().square;
      if (settings === null) throw new Error("the fake Square is not set up");
      const listed = (await retryBills(sql, { environment: settings.environment, now: clock, limit: 50, after: null, gymIds: [gym.id] })).find((b) => b.billId === billId);
      if (listed === undefined) throw new Error("the retry was not listed on its day");
      await pause(gym, rex.entryId);
      expect(await chargeDueBill(workDeps(), settings, listed, true)).toBeUndefined();
      expect(await chargesByTheApp(billId)).toHaveLength(1);
      await resume(gym, rex.entryId);
      expect((await pendingRetries(sql, gym.id, [billId], clock)).size).toBe(1);
      square.card(card?.card_id ?? "", gym.acct.merchantId, card?.customer_id ?? "", "pays");
      await work();
      expect(await chargesByTheApp(billId)).toHaveLength(2);
    });

    it("the write's own check refuses it too, for the payer and for whom she pays, if the list ever let one through", async () => {
      const gus = await paidByCard(gym, "Pause Gus");
      const kid = await paidForBy(gus, "Pause Gus Kid");
      await pause(gym, gus.entryId);
      const gusBill = await nextWeekOpens(gus);
      const kidBill = await nextWeekOpens(kid);
      expect((await scheduleCharge(gus, 2)).kind).toBe("not_allowed");
      expect((await scheduleCharge(kid, 2)).kind).toBe("not_allowed");
      expect(await chargesByTheApp(gusBill)).toEqual([]);
      expect(await chargesByTheApp(kidBill)).toEqual([]);
    });

    it("pausing one person never stops somebody else's card", async () => {
      const ann = await paidByCard(gym, "Pause Ann");
      const ben = await paidByCard(gym, "Pause Ben");
      await pause(gym, ann.entryId);
      const benBill = await nextWeekOpens(ben);
      await work();
      expect(await chargesByTheApp(benBill)).toHaveLength(1);
      expect((await billOnPage(gym, ben.entryId, benBill))?.chargeStop ?? null).toBeNull();
    });
  });

  describe("around it", () => {
    it("staff can still charge the card by hand while paused", async () => {
      const lee = await paidByCard(gym, "Pause Lee");
      await pause(gym, lee.entryId);
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

    it("resumed weeks later: the bill that fell due while paused is staff's, it says so, and nothing old is charged by itself", async () => {
      const wes = await paidByCard(gym, "Pause Wes");
      await pause(gym, wes.entryId);
      const billId = await nextWeekOpens(wes);
      clock = new Date(clock.getTime() + 21 * 24 * 60 * 60_000);
      await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
      await resume(gym, wes.entryId);
      await work();
      expect((await billOnPage(gym, wes.entryId, billId))?.chargeStop).toEqual({ kind: "paused_missed", heldBy: null });
      expect(await sql`SELECT id FROM gym_card_charges WHERE held_membership_id = ${wes.membershipId} AND by_schedule`).toEqual([]);
    });

    it("the box names the card and each renewing membership it pays for; a second press is one; the payee is paused on the payer's page", async () => {
      const kay = await paidByCard(gym, "Pause Kay");
      const kid = await person(gym, "Pause Kay Kid");
      const today = (await held(gym, gym.owner, kid)).today;
      const given = await send("POST", `${entryUrl(gym, kid)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId: gym.typeId, startsOn: today, paid: true });
      expect(given.statusCode, given.body).toBe(201);
      await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${kid}, ${kay.entryId})`;

      const box = await send("GET", autopayUrl(gym, kay.entryId), gym.owner.cookies);
      expect(box.statusCode, box.body).toBe(200);
      expect(autopayPreviewSchema.parse(JSON.parse(box.body))).toEqual({
        pausedOn: null,
        people: [
          { name: "Pause Kay", what: "Gold Weekly" },
          { name: "Pause Kay Kid", what: "Gold Weekly" },
        ],
        more: 0,
        card: { brand: "VISA", last4: "1111" },
        squareConnected: true,
        chargebackStops: false,
      });

      await Promise.all([pause(gym, kay.entryId), pause(gym, kay.entryId)]);
      await pause(gym, kay.entryId);
      expect(await sql`SELECT 1 FROM gym_autopay_pauses WHERE gym_id = ${gym.id} AND entry_id = ${kay.entryId}`).toHaveLength(1);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.autopay_paused' AND target_id = ${kay.entryId}`).toHaveLength(1);
      const after = autopayPreviewSchema.parse(JSON.parse((await send("GET", autopayUrl(gym, kay.entryId), gym.owner.cookies)).body));
      expect(after.pausedOn).toBe(today);

      // Kid's own Card on file says so; Kid is paused and resumed on Kay's page only.
      const kidCard = await send("GET", `${entryUrl(gym, kid)}/card`, gym.owner.cookies);
      expect(memberCardResponseSchema.parse(JSON.parse(kidCard.body)).cardOnFile.autopayPausedOn).toBe(today);
      for (const path of ["", "/pause", "/resume"]) {
        const refused = await send(path === "" ? "GET" : "POST", `${autopayUrl(gym, kid)}${path}`, gym.owner.cookies);
        expect(refused.statusCode, path).toBe(409);
        expect(JSON.parse(refused.body)).toMatchObject({ error: "card_paid_by_payer" });
      }

      await Promise.all([resume(gym, kay.entryId), resume(gym, kay.entryId)]);
      expect((await resume(gym, kay.entryId)).autopayPausedOn).toBeNull();
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.autopay_resumed' AND target_id = ${kay.entryId}`).toHaveLength(1);
    });

    it("a stranger, another gym and staff without the payments tick are refused; a bad id is a 400", async () => {
      const zed = await paidByCard(gym, "Pause Zed");
      const stranger = await signedIn("Pause Stranger");
      const trainer = await signedIn("Pause Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${["members.read", "members.confirm"]})`;
      for (const [method, path] of [
        ["GET", ""],
        ["POST", "/pause"],
        ["POST", "/resume"],
      ] as const) {
        expect((await send(method, `${autopayUrl(gym, zed.entryId)}${path}`, {})).statusCode).toBe(401);
        expect((await send(method, `${autopayUrl(gym, zed.entryId)}${path}`, stranger.cookies)).statusCode).toBe(404);
        expect((await send(method, `${autopayUrl(gym, zed.entryId)}${path}`, nextDoor.owner.cookies)).statusCode).toBe(404);
        // Its own gym's address with another gym's person.
        expect((await send(method, `${autopayUrl(nextDoor, zed.entryId)}${path}`, nextDoor.owner.cookies)).statusCode).toBe(404);
        expect((await send(method, `${autopayUrl(gym, zed.entryId)}${path}`, trainer.cookies)).statusCode).toBe(403);
      }
      expect(await sql`SELECT 1 FROM gym_autopay_pauses WHERE entry_id = ${zed.entryId}`).toEqual([]);
      expect((await send("POST", `/v1/orgs/${gym.id}/member-list/entries/nope/card/autopay/pause`, gym.owner.cookies)).statusCode).toBe(400);
    });

    it("two records of one person joined: a pause on the one not kept stands on the kept one", async () => {
      const old = await paidByCard(gym, "Pause Twin");
      const twin = await person(gym, "Pause Twin Two");
      await pause(gym, old.entryId);
      const merged = await send("POST", `${entryUrl(gym, old.entryId)}/merge`, gym.owner.cookies, { keepEntryId: twin });
      expect(merged.statusCode, merged.body).toBe(200);
      expect(await sql`SELECT 1 FROM gym_autopay_pauses WHERE gym_id = ${gym.id} AND entry_id = ${twin} AND resumed_at IS NULL`).toHaveLength(1);
    });

    it("two records joined, both paused: the kept one holds one open pause, and the other is closed", async () => {
      const one = await paidByCard(gym, "Pause Both One");
      const two = await person(gym, "Pause Both Two");
      await saveCard(gym, two);
      await pause(gym, one.entryId);
      await pause(gym, two);
      const merged = await send("POST", `${entryUrl(gym, one.entryId)}/merge`, gym.owner.cookies, { keepEntryId: two });
      expect(merged.statusCode, merged.body).toBe(200);
      const rows = await sql<{ open: boolean }[]>`SELECT resumed_at IS NULL AS open FROM gym_autopay_pauses WHERE gym_id = ${gym.id} AND entry_id = ${two} ORDER BY paused_at`;
      expect(rows.map((r) => r.open).sort()).toEqual([false, true]);
    });

    it("paused and resumed before a bill's dates: a bill missed later for another reason never says it was paused", async () => {
      const una = await paidByCard(gym, "Pause Una");
      await pause(gym, una.entryId);
      await resume(gym, una.entryId);
      await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${una.entryId}`;
      const billId = await nextWeekOpens(una);
      clock = new Date(clock.getTime() + 5 * 24 * 60 * 60_000);
      await saveCard(gym, una.entryId);
      expect((await billOnPage(gym, una.entryId, billId))?.chargeStop ?? null).toBeNull();
    });

    it("somebody else is set to pay for a paused person: their own pause ends, and Staff activity says so", async () => {
      const ivy = await paidByCard(gym, "Pause Ivy");
      const mum = await paidByCard(gym, "Pause Ivy Mum");
      await pause(gym, ivy.entryId);
      const set = await send("PUT", `${entryUrl(gym, ivy.entryId)}/payer`, gym.owner.cookies, { payerEntryId: mum.entryId });
      expect(set.statusCode, set.body).toBe(200);
      expect(await sql`SELECT 1 FROM gym_autopay_pauses WHERE gym_id = ${gym.id} AND entry_id = ${ivy.entryId} AND resumed_at IS NULL`).toEqual([]);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.autopay_pause_ended_by_payer' AND target_id = ${ivy.entryId}`).toHaveLength(1);
      // Removing the payer later brings no old pause back.
      const removed = await send("DELETE", `${entryUrl(gym, ivy.entryId)}/payer`, gym.owner.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      expect((await send("GET", `${entryUrl(gym, ivy.entryId)}/card`, gym.owner.cookies)).body).toContain('"autopayPausedOn":null');
    });

    it("Staff activity names the person and says who paused and resumed, read through its own route", async () => {
      const ola = await paidByCard(gym, "Pause Ola");
      await pause(gym, ola.entryId);
      await resume(gym, ola.entryId);
      const res = await send("GET", `/v1/orgs/${gym.id}/staff-activity`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const lines = staffActivityResponseSchema.parse(JSON.parse(res.body)).lines.map((l) => l.line);
      expect(lines).toContain("Automatic payments were paused for Pause Ola. Their card stays saved");
      expect(lines).toContain("Automatic payments were resumed for Pause Ola");
    });

    it("Staff activity says who paused and resumed", () => {
      const ctx = { about: "Maya", words: orgWords("gym"), currency: "USD" };
      expect(STAFF_LINES["org.autopay_paused"]?.({ ...ctx, meta: { entryId: "x" } })).toBe("Automatic payments were paused for Maya. Their card stays saved");
      expect(STAFF_LINES["org.autopay_resumed"]?.({ ...ctx, meta: { entryId: "x" } })).toBe("Automatic payments were resumed for Maya");
      expect(STAFF_LINES["org.autopay_pause_ended_by_payer"]?.({ ...ctx, meta: { entryId: "x" } })).toBe("The pause of automatic payments for Maya ended, as somebody else now pays for them");
    });
  });
});
