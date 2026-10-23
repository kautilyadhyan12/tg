// Failed payments (ROADMAP 18d-iii-ii-b; spec Part 3 §14.8): the list of bills still owed whose
// newest charge to a card on file was declined, and Try again, through the real routes and worker
// against real Postgres (DATABASE_URL-gated), with Square answered by the fake in
// `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: Try again on one row charging
// somebody else's card, or the same bill twice, or one gym's staff reading another gym's declines.
// Every claim about money is read from what the fake Square was asked, never from a reply alone.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  failedPaymentsResponseSchema,
  failedPaymentsSummarySchema,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentsResponseSchema,
  type FailedPayment,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
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
  JWT_SECRET: "failed-pay-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-FAILEDPAYAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-FAILEDPAYSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 300_000;
const LIVE_PLAN = "zz_failed_pay";
const DAY = 24 * 60 * 60_000;

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  owner: Person;
  acct: Account;
}
interface Holder {
  entryId: string;
  membershipId: string;
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

d("Failed payments, and Try again (real Postgres)", { timeout: T }, () => {
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
  const gyms: Gym[] = [];
  const work = () => processSquareWork({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock }, [], gyms.map((g) => g.id));

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'fpay-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'fpay-t-%@example.com'`;
    await sql`DELETE FROM gym_card_decline_notices WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'fpay-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const signedIn = async (name: string): Promise<Person> => {
    const email = `fpay-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to its own Square account. */
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(`MFP${uniq()}`);
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    const gym = { id, owner, acct };
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
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `fpay-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Gold Weekly from today, its first week paid at the desk; then a week back, so the second week's
   *  bill falls due today and is opened. */
  const renewingToday = async (gym: Gym, typeId: string, entryId: string): Promise<Holder> => {
    const today = (await held(gym, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    const h = { entryId, membershipId: m.id };
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${h.membershipId}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${h.membershipId}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    return h;
  };
  const cardFor = async (gym: Gym, entryId: string, behaviour: CardBehaviour, last4 = "1111"): Promise<string> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', ${last4}, now())
      RETURNING id`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', ${last4}, 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, gym.acct.merchantId, customerId, behaviour);
    return cardId;
  };
  /** The card starts answering otherwise, as a bank does once money is paid in. */
  const cardNowAnswers = (cardId: string, behaviour: CardBehaviour) => {
    const card = square.cards.get(cardId);
    if (card === undefined) throw new Error("no such card");
    square.card(cardId, card.accountId, card.customerId, behaviour);
  };
  /** What Square was asked to take from a card, paid or failed. */
  const askedOf = (cardId: string) => square.charged.filter((p) => p.cardId === cardId);
  const list = async (gym: Gym, cookies: Cookies = gym.owner.cookies, from = 0) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/failed-payments?from=${String(from)}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return failedPaymentsResponseSchema.parse(JSON.parse(res.body));
  };
  const summary = async (gym: Gym) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/failed-payments/summary`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return failedPaymentsSummarySchema.parse(JSON.parse(res.body));
  };
  const rowOf = async (gym: Gym, h: Holder): Promise<FailedPayment | undefined> => (await list(gym)).payments.find((p) => p.membershipId === h.membershipId);
  /** Try again, as the list's button sends it: Record payment's own Card on file press. */
  const tryAgain = (gym: Gym, row: FailedPayment, cookies: Cookies = gym.owner.cookies) => {
    if (row.retry.kind !== "charge") throw new Error(`no Try again on this row: ${JSON.stringify(row.retry)}`);
    const at = `${entryUrl(gym, row.entryId)}/memberships/${row.membershipId}`;
    return row.fee === null
      ? send("POST", `${at}/card-charge`, cookies, { requestKey: randomUUID(), periodIndex: row.periodIndex, amountMinor: row.retry.amountMinor, cardRef: row.retry.cardRef })
      : send("POST", `${at}/fees/${row.billId}/card-charge`, cookies, { requestKey: randomUUID(), amountMinor: row.retry.amountMinor, cardRef: row.retry.cardRef });
  };
  /** A gym's people whose renewal the worker charged at noon today, each card answering as named. */
  const declinedToday = async (gym: Gym, typeId: string, people: readonly [string, CardBehaviour][]) => {
    const out: { h: Holder; card: string }[] = [];
    for (const [name, behaviour] of people) {
      const h = await renewingToday(gym, typeId, await person(gym, name));
      out.push({ h, card: await cardFor(gym, h.entryId, behaviour, String(1000 + out.length)) });
    }
    await work();
    return out;
  };
  const noonOf = async (gym: Gym) => new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T18:00:00Z`);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(config(), {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    });
    await api().ready();
  }, T);
  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("Try again charges that row's own card once, for that row's bill, and one gym never reads another's", async () => {
    const gym = await makeGym(`Failed Gym ${uniq()}`);
    const other = await makeGym(`Next Door ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    const [gina, nina] = await declinedToday(gym, typeId, [
      ["Gina Declined", "declines"],
      ["Nina Short", "insufficient"],
    ]);
    if (gina === undefined || nina === undefined) throw new Error("no people");
    // Next door has its own decline: never on this gym's list, nor this gym's on its.
    const otherType = await typeOf(other);
    const [olga] = await declinedToday(other, otherType, [["Olga Elsewhere", "declines"]]);
    if (olga === undefined) throw new Error("no Olga");

    // A day on, both can be charged again by staff.
    clock = new Date(clock.getTime() + DAY + 60_000);
    const page = await list(gym);
    expect(page.payments.map((p) => p.name).sort()).toEqual(["Gina Declined", "Nina Short"]);
    expect(page.count).toBe(2);
    expect(page.totals).toEqual([{ currency: "USD", minor: 5000 }]);
    expect((await list(other)).payments.map((p) => p.name)).toEqual(["Olga Elsewhere"]);
    // Another gym's owner asking for this gym's list, or Try again on this gym's row: nothing.
    expect((await send("GET", `/v1/orgs/${gym.id}/failed-payments`, other.owner.cookies)).statusCode).toBe(404);
    expect((await send("GET", `/v1/orgs/${gym.id}/failed-payments/summary`, other.owner.cookies)).statusCode).toBe(404);

    const ginaRow = page.payments.find((p) => p.membershipId === gina.h.membershipId);
    if (ginaRow === undefined) throw new Error("no Gina row");
    expect(ginaRow.retry).toMatchObject({ kind: "charge", card: { brand: "VISA", last4: "1000" }, payerName: null, amountMinor: 2500 });
    expect(ginaRow.declined).toMatchObject({ last4: "1000", reason: "declined", stop: "bank" });

    // Gina's bank lets it through now. Two of staff press Try again on her row at the same instant.
    cardNowAnswers(gina.card, "pays");
    const before = { gina: askedOf(gina.card).length, nina: askedOf(nina.card).length, olga: askedOf(olga.card).length };
    const presses = await Promise.all([tryAgain(gym, ginaRow), tryAgain(gym, ginaRow)]);
    expect(presses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    // Square was asked once, of Gina's card alone, for her week alone.
    const ginaNew = askedOf(gina.card).slice(before.gina);
    expect(ginaNew.map((p) => [p.status, p.amount_money.amount])).toEqual([["COMPLETED", 2500]]);
    expect(askedOf(nina.card).length).toBe(before.nina);
    expect(askedOf(olga.card).length).toBe(before.olga);
    const [bill] = await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE held_membership_id = ${gina.h.membershipId} AND period_index = 1 AND fee IS NULL`;
    expect(bill?.status).toBe("paid");

    // Paid: off the list, and Overview's count agrees with the list.
    const after = await list(gym);
    expect(after.payments.map((p) => p.name)).toEqual(["Nina Short"]);
    expect(await summary(gym)).toEqual({ count: 1, totals: [{ currency: "USD", minor: 2500 }], square: true });
    // The same row pressed again from a list opened before: refused, nothing asked.
    expect((await tryAgain(gym, ginaRow)).statusCode).toBe(409);
    expect(askedOf(gina.card).length).toBe(before.gina + 1);
  });

  it("a row's decline says what the person's page says of that bill", async () => {
    const gym = await makeGym(`Same Words ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    const people = await declinedToday(gym, typeId, [
      ["Ivy Short", "insufficient"],
      ["Gus Generic", "declines"],
      ["Eli Expired", "expired"],
    ]);
    clock = new Date(clock.getTime() + DAY + 60_000);
    const page = await list(gym);
    for (const { h } of people) {
      const row = page.payments.find((p) => p.membershipId === h.membershipId);
      const bill = (await held(gym, h.entryId)).memberships[0]?.billing?.bills.find((b) => b.periodIndex === 1);
      expect(row?.declined).toEqual(bill?.cardDeclined);
      expect(row?.leftMinor).toBe(2500);
      expect(row?.covers).toEqual(bill?.covers);
    }
    const eli = page.payments.find((p) => p.name === "Eli Expired");
    expect(eli?.retry).toEqual({ kind: "no", why: "new_card" });
    const ivy = page.payments.find((p) => p.name === "Ivy Short");
    expect(ivy?.declined.next).not.toBeNull();
  });

  it("declined less than a day ago: Try again waits, and the press is refused the same", async () => {
    const gym = await makeGym(`Wait Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    const [wes] = await declinedToday(gym, typeId, [["Wes Waiting", "declines"]]);
    if (wes === undefined) throw new Error("no Wes");
    const [charge] = await sql<{ started_at: Date }[]>`SELECT started_at FROM gym_card_charges WHERE held_membership_id = ${wes.h.membershipId}`;
    clock = new Date(clock.getTime() + 60 * 60_000);
    const row = await rowOf(gym, wes.h);
    expect(row?.retry).toEqual({ kind: "wait", from: new Date((charge?.started_at ?? new Date(0)).getTime() + DAY).toISOString() });
    const asked = askedOf(wes.card).length;
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, wes.h.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    const res = await send("POST", `${entryUrl(gym, wes.h.entryId)}/memberships/${wes.h.membershipId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: 1,
      amountMinor: 2500,
      cardRef: box.cardOnFile?.ref,
    });
    expect(res.statusCode).toBe(409);
    expect((JSON.parse(res.body) as { error: string }).error).toBe("card_charge_wait");
    expect(askedOf(wes.card).length).toBe(asked);
  });

  it("paid another way: off the list; a card removed: no Try again", async () => {
    const gym = await makeGym(`Leave Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    const [cash, nocard] = await declinedToday(gym, typeId, [
      ["Cass Cash", "declines"],
      ["Noel Nocard", "declines"],
    ]);
    if (cash === undefined || nocard === undefined) throw new Error("no people");
    clock = new Date(clock.getTime() + DAY + 60_000);
    expect((await list(gym)).count).toBe(2);
    const pay = (await held(gym, cash.h.entryId)).memberships[0]?.billing?.pay;
    const paid = await send("POST", `${entryUrl(gym, cash.h.entryId)}/memberships/${cash.h.membershipId}/payments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: pay?.periodIndex,
      amountMinor: pay?.leftMinor,
      method: "cash",
    });
    expect(paid.statusCode, paid.body).toBe(200);
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${nocard.h.entryId}`;
    const page = await list(gym);
    expect(page.payments.map((p) => [p.name, p.retry])).toEqual([["Noel Nocard", { kind: "no", why: "no_card" }]]);
  });

  it("somebody paid for by another: the row names the payer's card, and Try again charges the payer's card alone", async () => {
    const gym = await makeGym(`Payer Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    const kai = await renewingToday(gym, typeId, await person(gym, "Kai Child"));
    const meiId = await person(gym, "Mei Parent");
    expect((await send("PUT", `${entryUrl(gym, kai.entryId)}/payer`, gym.owner.cookies, { payerEntryId: meiId })).statusCode).toBe(200);
    const meiCard = await cardFor(gym, meiId, "declines", "4242");
    await work();
    clock = new Date(clock.getTime() + DAY + 60_000);
    const row = await rowOf(gym, kai);
    expect(row).toMatchObject({ name: "Kai Child", retry: { kind: "charge", card: { last4: "4242" }, payerName: "Mei Parent", amountMinor: 2500 } });
    cardNowAnswers(meiCard, "pays");
    if (row === undefined) throw new Error("no row");
    expect((await tryAgain(gym, row)).statusCode).toBe(200);
    expect(askedOf(meiCard).map((p) => p.status)).toEqual(["FAILED", "COMPLETED"]);
    expect((await list(gym)).count).toBe(0);
  });

  it("a fee declined on a staff press is listed, and Try again charges that fee alone", async () => {
    const gym = await makeGym(`Fee Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    const fay = await renewingToday(gym, typeId, await person(gym, "Fay Fee"));
    const card = await cardFor(gym, fay.entryId, "pays");
    await work();
    const today = (await held(gym, fay.entryId)).today;
    const [fee] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, amount_minor, currency, due_on, covers_from, covers_to, fee, fee_for)
      SELECT gym_id, id, 1500, currency, ${today}, ${today}, ${today}, 'late_cancel', 'Spin'
      FROM gym_held_memberships WHERE id = ${fay.membershipId}
      RETURNING id`;
    if (fee === undefined) throw new Error("no fee");
    cardNowAnswers(card, "declines");
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, fay.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    const press = await send("POST", `${entryUrl(gym, fay.entryId)}/memberships/${fay.membershipId}/fees/${fee.id}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      amountMinor: 1500,
      cardRef: box.cardOnFile?.ref,
    });
    expect(press.statusCode, press.body).toBe(200);
    clock = new Date(clock.getTime() + DAY + 60_000);
    const page = await list(gym);
    expect(page.payments.map((p) => [p.name, p.periodIndex, p.fee?.kind, p.fee?.forName, p.leftMinor])).toEqual([["Fay Fee", null, "late_cancel", "Spin", 1500]]);
    const row = page.payments[0];
    if (row === undefined) throw new Error("no row");
    cardNowAnswers(card, "pays");
    expect((await tryAgain(gym, row)).statusCode).toBe(200);
    expect(askedOf(card).slice(-1).map((p) => [p.status, p.amount_money.amount])).toEqual([["COMPLETED", 1500]]);
    const [after] = await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE id = ${fee.id}`;
    expect(after?.status).toBe("paid");
  });

  it("refused to staff who don't take payments; a bad page number is refused; pages are 25 rows", async () => {
    const gym = await makeGym(`Role Gym ${uniq()}`);
    const trainer = await signedIn("Tom Trainer");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
    const asTrainer = await send("GET", `/v1/orgs/${gym.id}/failed-payments`, trainer.cookies);
    expect([403, 404]).toContain(asTrainer.statusCode);
    expect((await send("GET", `/v1/orgs/${gym.id}/failed-payments?from=-1`, gym.owner.cookies)).statusCode).toBe(400);
    expect((await send("GET", `/v1/orgs/${gym.id}/failed-payments?from=x`, gym.owner.cookies)).statusCode).toBe(400);
    expect((await send("GET", `/v1/orgs/${gym.id}/failed-payments`, {})).statusCode).toBe(401);

    const typeId = await typeOf(gym);
    clock = await noonOf(gym);
    await declinedToday(
      gym,
      typeId,
      Array.from({ length: 27 }, (_, i): [string, CardBehaviour] => [`Pat Page ${String(i)}`, "declines"]),
    );
    const first = await list(gym);
    expect(first.payments.length).toBe(25);
    expect(first.next).toBe(25);
    const second = await list(gym, gym.owner.cookies, 25);
    expect(second.payments.length).toBe(2);
    expect(second.next).toBeNull();
    expect(new Set([...first.payments, ...second.payments].map((p) => p.billId)).size).toBe(27);
  });
});
