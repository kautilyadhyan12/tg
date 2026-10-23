// The saved card charged on the bill's date (ROADMAP 18d-iii-i; spec Part 3 §14.8), through the
// worker's minute and the routes against real Postgres (DATABASE_URL-gated), with Square answered by
// the fake in `fakeSquareTerminal.ts`, which charges cards on file as Square's test area did on
// 2026-10-23.
//
// The first block is the worst thing this job could do to a real person: charged twice, charged for
// somebody else's bill, or charged for a bill already paid, cancelled or frozen. Every claim is read
// from the tables and from what the fake Square took, never from the reply alone.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  cardChargeResponseSchema,
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
import { CARD_CHARGE } from "../src/modules/orgs/payments/cardCharges.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account, type CardBehaviour } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "card-charge-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-CARDCHARGEAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-CARDCHARGESECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 240_000;
const LIVE_PLAN = "zz_card_charge";

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
}
interface Holder {
  entryId: string;
  membershipId: string;
}

let ipCounter = 0;
const nextIp = () => `10.57.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
// Weekly, so "a period ago" is seven days on any day of the month.
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

d("Card on file charged on the bill's date (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  let clock = new Date();
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cchg-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'cchg-t-%@example.com'`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_terminals WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'cchg-t-%@example.com'`;
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
    const email = `cchg-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to its own Square account. */
  const makeGym = async (name: string, merchantId: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(merchantId);
    const gym = { id, name, owner, acct };
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
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
  const held = async (gym: Gym, by: Person, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `cchg-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** A person holding Gold Weekly from today, its first week paid at the desk (`firstPaid`) or not. */
  const holding = async (gym: Gym, typeId: string, entryId: string, firstPaid = true): Promise<Holder> => {
    const today = (await held(gym, gym.owner, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: firstPaid });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return { entryId, membershipId: m.id };
  };
  /** The membership moved a week back, so its second week's bill falls due today; the run opens it. */
  const weekOn = async (gym: Gym, h: Holder) => {
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${h.membershipId}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${h.membershipId}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
  };
  /** A card on file for a record, as Card on file keeps one, and in the fake Square account. */
  const cardFor = async (gym: Gym, entryId: string, behaviour: CardBehaviour = "pays", acct: Account = gym.acct): Promise<string> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, acct.merchantId, customerId, behaviour);
    return cardId;
  };
  const billsOf = (h: Holder) =>
    sql<{ id: string; period_index: number | null; fee: string | null; status: string; amount_minor: number; due_on: string }[]>`
      SELECT id, period_index, fee, status, amount_minor, due_on::text AS due_on FROM gym_member_bills WHERE held_membership_id = ${h.membershipId} ORDER BY period_index NULLS LAST, created_at`;
  const paymentsOf = (h: Holder) =>
    sql<{ bill_id: string; amount_minor: number; method: string; provider: string | null; provider_payment_id: string | null }[]>`
      SELECT p.bill_id, p.amount_minor, p.method, p.provider, p.provider_payment_id
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE b.held_membership_id = ${h.membershipId} AND p.undone_at IS NULL ORDER BY p.seq`;
  const chargesOf = (h: Holder) =>
    sql<{ bill_id: string | null; card_id: string; state: string; outcome: string | null; by_schedule: boolean; payer_entry_id: string | null; amount_minor: number }[]>`
      SELECT bill_id, card_id, state, outcome, by_schedule, payer_entry_id, amount_minor FROM gym_card_charges WHERE held_membership_id = ${h.membershipId} ORDER BY started_at`;
  /** What Square took from a card. */
  const takenFrom = (cardId: string) => square.taken().filter((p) => p.cardId === cardId);
  const todayOf = async (gym: Gym, entryId: string) => (await held(gym, gym.owner, entryId)).today;

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

  it("charges each renewal once, on its payer's card, for exactly what is owed, and never a bill that is not the app's to charge", async () => {
    const gym = await makeGym(`Charge Gym ${uniq()}`, `MCH${uniq()}`);
    const other = await makeGym(`Other Gym ${uniq()}`, `MOT${uniq()}`);
    const typeId = await typeOf(gym);
    const otherType = await typeOf(other);
    const today = await todayOf(gym, await person(gym, "Clock Reader"));
    // Noon in Chicago on the gym's today: after 6 in the morning there.
    clock = new Date(`${today}T18:00:00Z`);

    const tara = await holding(gym, typeId, await person(gym, "Tara Singh"));
    const ravi = await holding(gym, typeId, await person(gym, "Ravi Patel"));
    // Aarav's bills are paid by Priya (18i): her card, never his.
    const priyaId = await person(gym, "Priya Sharma");
    const aarav = await holding(gym, typeId, await person(gym, "Aarav Sharma"));
    const payer = await send("PUT", `${entryUrl(gym, aarav.entryId)}/payer`, gym.owner.cookies, { payerEntryId: priyaId });
    expect(payer.statusCode, payer.body).toBe(200);
    // Not the app's to charge: a first week never paid, a membership cancelled, one set to stop.
    const unpaidFirst = await holding(gym, typeId, await person(gym, "Una First"), false);
    const cancelled = await holding(gym, typeId, await person(gym, "Cal Cancelled"));
    const stopping = await holding(gym, typeId, await person(gym, "Stella Stopping"));
    // Another gym's member, with a card of their own in another account.
    const stranger = await holding(other, otherType, await person(other, "Sam Stranger"));

    // Cancelled now, and set to stop at the end of its first week: neither renews by itself.
    for (const [h, when] of [
      [cancelled, "today"],
      [stopping, "period_end"],
    ] as const) {
      const res = await send("POST", `${entryUrl(gym, h.entryId)}/memberships/${h.membershipId}/cancel`, gym.owner.cookies, { when });
      expect(res.statusCode, res.body).toBe(200);
    }
    for (const h of [tara, ravi, aarav, cancelled, stopping]) await weekOn(gym, h);
    await weekOn(other, stranger);
    const taraCard = await cardFor(gym, tara.entryId);
    const raviCard = await cardFor(gym, ravi.entryId);
    const priyaCard = await cardFor(gym, priyaId);
    const aaravOwnCard = `ccof:${randomUUID()}`; // never saved: a person paid for keeps no card here
    const unpaidCard = await cardFor(gym, unpaidFirst.entryId);
    const cancelledCard = await cardFor(gym, cancelled.entryId);
    const stoppingCard = await cardFor(gym, stopping.entryId);
    const strangerCard = await cardFor(other, stranger.entryId);

    // The worker's minute, twice at the same instant, then once more.
    await Promise.all([work(), work()]);
    await work();

    // Each renewal: one payment Square took, the second week's whole amount, on the right card.
    for (const [h, card] of [
      [tara, taraCard],
      [ravi, raviCard],
      [aarav, priyaCard],
    ] as const) {
      const bills = await billsOf(h);
      const second = bills.find((b) => b.period_index === 1);
      expect(second?.status, "the second week is paid").toBe("paid");
      expect(takenFrom(card).map((p) => p.amount_money.amount)).toEqual([second?.amount_minor]);
      // The app's own charge is asked with the bill's own id.
      expect(takenFrom(card).map((p) => p.key)).toEqual([second?.id]);
      const paid = (await paymentsOf(h)).filter((p) => p.bill_id === second?.id);
      expect(paid.map((p) => [p.method, p.provider, p.provider_payment_id])).toEqual([["company", "square", takenFrom(card)[0]?.id]]);
      expect((await chargesOf(h)).map((c) => [c.bill_id, c.card_id, c.outcome, c.by_schedule])).toEqual([[second?.id, card, "paid", true]]);
    }
    expect(takenFrom(aaravOwnCard)).toEqual([]);
    expect((await chargesOf(aarav))[0]?.payer_entry_id).toBe(priyaId);
    // The other gym is its own: charged in its own account, and nothing of this gym's touched it.
    expect(takenFrom(strangerCard)).toHaveLength(1);
    expect(square.taken().every((p) => (p.cardId === strangerCard ? p.accountId === other.acct.merchantId : p.accountId === gym.acct.merchantId))).toBe(true);
    // Never charged: the first week (taken at the desk), a cancelled membership, one set to stop.
    for (const card of [unpaidCard, cancelledCard, stoppingCard]) expect(square.charged.filter((p) => p.cardId === card)).toEqual([]);
    for (const h of [unpaidFirst, cancelled, stopping]) expect(await chargesOf(h)).toEqual([]);

    // The page: paid by Card on file, Visa ending 1111.
    const page = (await held(gym, gym.owner, tara.entryId)).memberships[0];
    const secondShown = page?.billing?.bills.find((b) => b.periodIndex === 1);
    expect(secondShown?.payments.map((p) => [p.method, p.card])).toEqual([["company", { brand: "VISA", last4: "1111" }]]);
    expect(secondShown?.cardDeclined).toBeNull();
  });

  it("a membership given today with an earlier start: its first bill, for a later period, is taken at the desk, never by itself", async () => {
    const gym = await makeGym(`Back Gym ${uniq()}`, `MBK${uniq()}`);
    const typeId = await typeOf(gym);
    const entryId = await person(gym, "Bea Backdated");
    const today = await todayOf(gym, entryId);
    clock = new Date(`${today}T18:00:00Z`);
    const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: weekAgo, paid: false });
    expect(given.statusCode, given.body).toBe(201);
    const bea = { entryId, membershipId: heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0]?.id ?? "" };
    // Its one bill is the second week's, due today and owed.
    expect((await billsOf(bea)).map((b) => [b.period_index, b.status, b.due_on])).toEqual([[1, "open", today]]);
    const card = await cardFor(gym, entryId);
    await work();
    expect(square.charged.filter((p) => p.cardId === card)).toEqual([]);
    expect(await chargesOf(bea)).toEqual([]);
  });

  it("a declined card leaves the bill owed and says so, and is not charged again by itself", async () => {
    const gym = await makeGym(`Decline Gym ${uniq()}`, `MDC${uniq()}`);
    const typeId = await typeOf(gym);
    const dana = await holding(gym, typeId, await person(gym, "Dana Declined"));
    clock = new Date(`${await todayOf(gym, dana.entryId)}T18:00:00Z`);
    await weekOn(gym, dana);
    const card = await cardFor(gym, dana.entryId, "insufficient");

    await work();
    await work();
    expect(square.charged.filter((p) => p.cardId === card).map((p) => p.status)).toEqual(["FAILED"]);
    const second = (await billsOf(dana)).find((b) => b.period_index === 1);
    expect(second?.status).toBe("open");
    expect((await chargesOf(dana)).map((c) => c.outcome)).toEqual(["declined"]);
    const shown = (await held(gym, gym.owner, dana.entryId)).memberships[0]?.billing?.bills.find((b) => b.periodIndex === 1);
    expect(shown?.cardDeclined).toEqual({ brand: "VISA", last4: "1111", on: await todayOf(gym, dana.entryId), reason: "insufficient_funds" });
  });

  it("before 6 in the morning, and for a bill three days old, nothing is charged", async () => {
    const gym = await makeGym(`Early Gym ${uniq()}`, `MEA${uniq()}`);
    const typeId = await typeOf(gym);
    const ella = await holding(gym, typeId, await person(gym, "Ella Early"));
    const today = await todayOf(gym, ella.entryId);
    clock = new Date(`${today}T18:00:00Z`);
    await weekOn(gym, ella);
    const card = await cardFor(gym, ella.entryId);
    // 5 in the morning in Chicago (10:00 or 11:00 UTC): not yet.
    clock = new Date(`${today}T10:00:00Z`);
    await work();
    expect(square.charged.filter((p) => p.cardId === card)).toEqual([]);
    // Three days later at noon: too old to be charged by itself.
    clock = new Date(new Date(`${today}T18:00:00Z`).getTime() + 3 * 24 * 60 * 60_000);
    await work();
    expect(square.charged.filter((p) => p.cardId === card)).toEqual([]);
    expect(await chargesOf(ella)).toEqual([]);
  });

  it("Square's answer lost: nothing else is paid meanwhile, and asking again records the one payment once", async () => {
    const gym = await makeGym(`Lost Gym ${uniq()}`, `MLO${uniq()}`);
    const typeId = await typeOf(gym);
    const lea = await holding(gym, typeId, await person(gym, "Lea Lost"));
    clock = new Date(`${await todayOf(gym, lea.entryId)}T18:00:00Z`);
    await weekOn(gym, lea);
    const card = await cardFor(gym, lea.entryId);

    square.state.loseAnswers = true;
    await work();
    square.state.loseAnswers = false;
    expect(takenFrom(card)).toHaveLength(1);
    expect((await chargesOf(lea)).map((c) => c.state)).toEqual(["charging"]);
    // Cash at the desk meanwhile would take it twice: refused, nothing written.
    const page = (await held(gym, gym.owner, lea.entryId)).memberships[0];
    const pay = page?.billing?.pay;
    expect(page?.billing?.bills.find((b) => b.periodIndex === 1)?.charging).toBe(true);
    const cash = await send("POST", `${entryUrl(gym, lea.entryId)}/memberships/${lea.membershipId}/payments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: pay?.periodIndex,
      amountMinor: pay?.leftMinor,
      method: "cash",
    });
    expect(cash.statusCode, cash.body).toBe(409);
    expect((JSON.parse(cash.body) as { error: string }).error).toBe("card_charge_waiting");
    expect((await paymentsOf(lea)).filter((p) => p.method === "cash")).toHaveLength(1);
    // The Terminal too.
    const deviceId = `R5${uniq()}`;
    square.devices.set(deviceId, { accountId: gym.acct.merchantId, behaviour: "pays" });
    const [terminal] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
      VALUES (${gym.id}, 'production', ${gym.acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${gym.owner.userId}) RETURNING id`;
    const onTerminal = await send("POST", `${entryUrl(gym, lea.entryId)}/memberships/${lea.membershipId}/terminal-payment`, gym.owner.cookies, {
      terminalId: terminal?.id,
      requestKey: randomUUID(),
      periodIndex: pay?.periodIndex,
      amountMinor: pay?.leftMinor,
    });
    expect(onTerminal.statusCode, onTerminal.body).toBe(409);
    expect((JSON.parse(onTerminal.body) as { error: string }).error).toBe("card_charge_waiting");
    expect(square.checkouts.size).toBe(0);

    // Too soon to ask again; then a minute later the same key gives back the same payment.
    await work();
    expect((await chargesOf(lea)).map((c) => c.state)).toEqual(["charging"]);
    clock = new Date(clock.getTime() + CARD_CHARGE.idleMs + 1000);
    await work();
    expect(takenFrom(card)).toHaveLength(1);
    expect((await chargesOf(lea)).map((c) => c.outcome)).toEqual(["paid"]);
    expect((await paymentsOf(lea)).filter((p) => p.method === "company").map((p) => p.provider_payment_id)).toEqual([takenFrom(card)[0]?.id]);
  });

  it("money Square took for another amount is kept, never recorded, and told to Staff activity", async () => {
    const gym = await makeGym(`Odd Gym ${uniq()}`, `MOD${uniq()}`);
    const typeId = await typeOf(gym);
    const omar = await holding(gym, typeId, await person(gym, "Omar Odd"));
    clock = new Date(`${await todayOf(gym, omar.entryId)}T18:00:00Z`);
    await weekOn(gym, omar);
    await cardFor(gym, omar.entryId);
    square.state.chargeOther = true;
    try {
      await work();
    } finally {
      square.state.chargeOther = false;
    }
    expect((await chargesOf(omar)).map((c) => c.outcome)).toEqual(["not_recorded"]);
    expect((await billsOf(omar)).find((b) => b.period_index === 1)?.status).toBe("open");
    const [told] = await sql<{ action: string; why: string }[]>`
      SELECT action, meta->>'why' AS why FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.card_charge_not_recorded'`;
    expect(told).toEqual({ action: "org.card_charge_not_recorded", why: "amount_differs" });
  });

  it("a freeze fee is charged on its day; a late cancel fee never is", async () => {
    const gym = await makeGym(`Freeze Gym ${uniq()}`, `MFZ${uniq()}`);
    const typeId = await typeOf(gym);
    const fay = await holding(gym, typeId, await person(gym, "Fay Frozen"));
    clock = new Date(`${await todayOf(gym, fay.entryId)}T18:00:00Z`);
    const card = await cardFor(gym, fay.entryId);
    const settings = await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 0, freezeFeeMinor: 1000 });
    expect(settings.statusCode, settings.body).toBe(200);
    const frozen = await send("POST", `${entryUrl(gym, fay.entryId)}/memberships/${fay.membershipId}/freeze`, gym.owner.cookies, { feeMinor: 1000 });
    expect(frozen.statusCode, frozen.body).toBe(200);
    // A late cancel fee on the same membership: staff take it by hand.
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, amount_minor, currency, due_on, covers_from, covers_to, fee, fee_for)
      SELECT gym_id, id, 1500, currency, ${await todayOf(gym, fay.entryId)}, ${await todayOf(gym, fay.entryId)}, ${await todayOf(gym, fay.entryId)}, 'late_cancel', 'Spin'
      FROM gym_held_memberships WHERE id = ${fay.membershipId}`;

    await work();
    const fees = (await billsOf(fay)).filter((b) => b.fee !== null);
    expect(fees.map((b) => [b.fee, b.status]).sort()).toEqual([
      ["freeze", "paid"],
      ["late_cancel", "open"],
    ]);
    expect(takenFrom(card).map((p) => p.amount_money.amount)).toEqual([1000]);
  });

  it("Charge card on file: one press is one charge, on the card the screen showed, by staff who take payments in this gym alone", async () => {
    const gym = await makeGym(`Desk Gym ${uniq()}`, `MDK${uniq()}`);
    const other = await makeGym(`Next Door ${uniq()}`, `MND${uniq()}`);
    const typeId = await typeOf(gym);
    const tess = await holding(gym, typeId, await person(gym, "Tess Desk"), false);
    const card = await cardFor(gym, tess.entryId);
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, tess.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    expect(box.cardOnFile).toMatchObject({ brand: "VISA", last4: "1111", payerName: null, expired: false });
    const ref = box.cardOnFile?.ref ?? "";
    const pay = (await held(gym, gym.owner, tess.entryId)).memberships[0]?.billing?.pay;
    if (pay === undefined || pay === null) throw new Error("nothing owed");
    const body = { requestKey: randomUUID(), periodIndex: pay.periodIndex, amountMinor: pay.leftMinor, cardRef: ref };
    const chargeUrl = `${entryUrl(gym, tess.entryId)}/memberships/${tess.membershipId}/card-charge`;

    // A stranger's owner, a trainer here, and a malformed body: refused, nothing at Square.
    expect((await send("POST", `${entryUrl(other, tess.entryId)}/memberships/${tess.membershipId}/card-charge`, other.owner.cookies, body)).statusCode).toBe(404);
    expect((await send("POST", chargeUrl, other.owner.cookies, body)).statusCode).toBe(404);
    const trainer = await signedIn("Tom Trainer");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
    expect((await send("POST", chargeUrl, trainer.cookies, body)).statusCode).toBe(403);
    expect((await send("POST", chargeUrl, gym.owner.cookies, { ...body, amountMinor: "25" })).statusCode).toBe(400);
    // A card replaced since the screen read it: refused, nothing at Square.
    expect((await send("POST", chargeUrl, gym.owner.cookies, { ...body, cardRef: `${tess.entryId}:2020-01-01T00:00:00.000Z` })).statusCode).toBe(409);
    expect(square.charged.filter((p) => p.cardId === card)).toEqual([]);

    // The press, twice: one charge, paid, with its receipt.
    const first = await send("POST", chargeUrl, gym.owner.cookies, body);
    expect(first.statusCode, first.body).toBe(200);
    const again = await send("POST", chargeUrl, gym.owner.cookies, body);
    expect(again.statusCode, again.body).toBe(200);
    const charge = cardChargeResponseSchema.parse(JSON.parse(first.body)).charge;
    expect(charge).toMatchObject({ step: "done", outcome: "paid", card: { brand: "VISA", last4: "1111" }, amountMinor: pay.leftMinor });
    expect(cardChargeResponseSchema.parse(JSON.parse(again.body)).charge.id).toBe(charge.id);
    expect(takenFrom(card).map((p) => p.amount_money.amount)).toEqual([pay.leftMinor]);
    expect(charge.receiptNumber).not.toBeNull();

    // Paid through Square: given back there, never voided here.
    const page = (await held(gym, gym.owner, tess.entryId)).memberships[0];
    const paid = page?.billing?.bills.find((b) => b.periodIndex === pay.periodIndex)?.payments[0];
    expect(page?.billing?.undo).toBeNull();
    const voided = await send("POST", `${entryUrl(gym, tess.entryId)}/memberships/${tess.membershipId}/payments/${paid?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect((await paymentsOf(tess)).map((p) => p.method)).toEqual(["company"]);
  });

  it("a declined press says why, and charges nothing", async () => {
    const gym = await makeGym(`Desk Decline ${uniq()}`, `MDD${uniq()}`);
    const typeId = await typeOf(gym);
    const ned = await holding(gym, typeId, await person(gym, "Ned Expired"), false);
    await cardFor(gym, ned.entryId, "expired");
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, ned.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    const pay = (await held(gym, gym.owner, ned.entryId)).memberships[0]?.billing?.pay;
    const res = await send("POST", `${entryUrl(gym, ned.entryId)}/memberships/${ned.membershipId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: pay?.periodIndex,
      amountMinor: pay?.leftMinor,
      cardRef: box.cardOnFile?.ref,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(cardChargeResponseSchema.parse(JSON.parse(res.body)).charge).toMatchObject({ step: "done", outcome: "declined", reason: "expired", receiptNumber: null });
    expect(await paymentsOf(ned)).toEqual([]);
    const [told] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.card_charge_declined'`;
    expect(told?.n).toBe(1);
  });
});
