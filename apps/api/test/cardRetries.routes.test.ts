// A declined card tried again, and the cardholder told (ROADMAP 18d-iii-ii-a; spec Part 3 §14.8),
// through the worker's minute, the staff press and the notice sender against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: a card charged again after
// its bank said never, a bill charged more than 3 times or twice within a day, or a bill charged that
// was already paid at the desk. Every claim is read from what the fake Square was asked, never from a
// reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
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
import type { InviteEmail } from "../src/email/resend.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { sendDueCardNotices } from "../src/modules/orgs/payments/cardNotices.js";
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
  JWT_SECRET: "card-retry-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-CARDRETRYAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-CARDRETRYSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 300_000;
const LIVE_PLAN = "zz_card_retry";
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

d("A declined card tried again, and the cardholder told (real Postgres)", { timeout: T }, () => {
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
  const mail: InviteEmail[] = [];
  const HMAC_KEY = Buffer.alloc(32, 3);
  // The app's daily cap is 0: these emails are owed, so no cap holds them.
  const notify = () =>
    sendDueCardNotices({
      sql,
      log: quiet,
      settings: { hmacKey: HMAC_KEY, webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" } },
      sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" },
      transport: {
        send: (m) => {
          mail.push(m);
          return Promise.resolve({ kind: "sent", id: `re_${uniq()}` });
        },
      },
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds: gyms.map((g) => g.id),
    });

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'crty-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'crty-t-%@example.com'`;
    await sql`DELETE FROM gym_card_decline_notices WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM email_suppressions WHERE email_hmac = ${createHmac("sha256", HMAC_KEY).update("crty-bounced@example.com").digest("hex")}`;
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
    await sql`DELETE FROM users WHERE email LIKE 'crty-t-%@example.com'`;
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
    const email = `crty-t-${uniq()}@example.com`;
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
    const acct = account(`MRT${uniq()}`);
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
  /** A person on the list; `email: null` for one with a phone only. */
  const person = async (gym: Gym, fullName: string, email: string | null = `crty-r-${uniq()}@example.com`): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, email === null ? { fullName, phone: "+1 312 555 0100" } : { fullName, email });
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
  const cardFor = async (gym: Gym, entryId: string, behaviour: CardBehaviour): Promise<string> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, gym.acct.merchantId, customerId, behaviour);
    return cardId;
  };
  /** The card starts answering otherwise, as a bank does once money is paid in. */
  const cardNowAnswers = (cardId: string, behaviour: CardBehaviour) => {
    const card = square.cards.get(cardId);
    if (card === undefined) throw new Error("no such card");
    square.card(cardId, card.accountId, card.customerId, behaviour);
  };
  /** What Square was asked to take from a card, paid or failed, with the key each try was asked with. */
  const askedOf = (cardId: string) => square.charged.filter((p) => p.cardId === cardId);
  const secondWeek = async (h: Holder) => {
    const [bill] = await sql<{ id: string; status: string }[]>`SELECT id, status FROM gym_member_bills WHERE held_membership_id = ${h.membershipId} AND period_index = 1 AND fee IS NULL`;
    if (bill === undefined) throw new Error("no second week");
    return bill;
  };
  const shown = async (gym: Gym, h: Holder) => (await held(gym, h.entryId)).memberships.find((m) => m.id === h.membershipId)?.billing?.bills.find((b) => b.periodIndex === 1);
  const press = async (gym: Gym, h: Holder) => {
    const box = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, h.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    const pay = (await held(gym, h.entryId)).memberships.find((m) => m.id === h.membershipId)?.billing?.pay;
    return await send("POST", `${entryUrl(gym, h.entryId)}/memberships/${h.membershipId}/card-charge`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: pay?.periodIndex,
      amountMinor: pay?.leftMinor,
      cardRef: box.cardOnFile?.ref,
    });
  };
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string; message: string });

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

  it("never charges a card again after its bank said never, never a bill more than 3 times or twice in a day, and never one paid at the desk", async () => {
    const gym = await makeGym(`Retry Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    // Noon in Chicago on the gym's today; each day of the test is the same hour a day on.
    const noon = new Date(`${today}T18:00:00Z`);
    const dayOn = (n: number) => new Date(noon.getTime() + n * DAY);
    clock = noon;

    const nina = await renewingToday(gym, typeId, await person(gym, "Nina Short")); // not enough money, every time
    const ezra = await renewingToday(gym, typeId, await person(gym, "Ezra Expired")); // the bank says the card is expired
    const cora = await renewingToday(gym, typeId, await person(gym, "Cora Closed")); // the account is closed
    const nora = await renewingToday(gym, typeId, await person(gym, "Nora New")); // a code nobody has placed
    const gabe = await renewingToday(gym, typeId, await person(gym, "Gabe Generic")); // no reason given
    const pete = await renewingToday(gym, typeId, await person(gym, "Pete Paid")); // pays cash at the desk on day 2
    const ninaCard = await cardFor(gym, nina.entryId, "insufficient");
    const ezraCard = await cardFor(gym, ezra.entryId, "expired");
    const coraCard = await cardFor(gym, cora.entryId, { declines: "INVALID_ACCOUNT" });
    const noraCard = await cardFor(gym, nora.entryId, { declines: "CARD_DECLINED_TEMPORARILY" });
    const gabeCard = await cardFor(gym, gabe.entryId, "declines");
    const peteCard = await cardFor(gym, pete.entryId, "insufficient");

    const payCash = async (h: Holder) => {
      const pay = (await held(gym, h.entryId)).memberships[0]?.billing?.pay;
      const cash = await send("POST", `${entryUrl(gym, h.entryId)}/memberships/${h.membershipId}/payments`, gym.owner.cookies, {
        requestKey: randomUUID(),
        periodIndex: pay?.periodIndex,
        amountMinor: pay?.leftMinor,
        method: "cash",
      });
      expect(cash.statusCode, cash.body).toBe(200);
    };
    // Every day for two weeks, the worker's minute twice at the same instant and once more. On day
    // 2 Pete pays his week in cash at the desk. On day 8 Ezra pays his in cash before the worker
    // looks, so his third week, opened on day 7, is one the app would charge by itself.
    for (let n = 0; n <= 14; n++) {
      clock = dayOn(n);
      await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
      if (n === 8) await payCash(ezra);
      await Promise.all([work(), work()]);
      await work();
      if (n === 2) await payCash(pete);
    }

    // Not enough money: tried on day 0, day 3 and day 7, each try once, under its own key; never a
    // fourth, and never two within a day.
    const ninaBill = await secondWeek(nina);
    const ninaAsked = askedOf(ninaCard);
    expect(ninaAsked.map((p) => p.key)).toEqual([ninaBill.id, `${ninaBill.id}:2`, `${ninaBill.id}:3`]);
    const [ninaTries] = await sql<{ days: string[] }[]>`
      SELECT array_agg((started_at AT TIME ZONE 'America/Chicago')::date::text ORDER BY started_at) AS days FROM gym_card_charges WHERE held_membership_id = ${nina.membershipId}`;
    expect(ninaTries?.days).toEqual([0, 3, 7].map((n) => dayOn(n).toISOString().slice(0, 10)));
    expect(ninaBill.status).toBe("open");

    // The bank said never (expired, closed, or a code nobody has placed), or gave no reason: one try.
    // Ezra's third week too: the card is stopped for every bill of the gym.
    for (const [who, card] of [["Ezra", ezraCard], ["Cora", coraCard], ["Nora", noraCard], ["Gabe", gabeCard]] as const) {
      expect(askedOf(card).map((p) => [p.key, p.status]), who).toHaveLength(1);
    }
    const [ezraThird] = await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE held_membership_id = ${ezra.membershipId} AND period_index = 2 AND fee IS NULL`;
    expect(ezraThird?.status, "Ezra's third week is open and due").toBe("open");
    // Paid at the desk on day 2: day 3's try never asked (his third week is a bill of its own).
    const peteBill = await secondWeek(pete);
    expect(askedOf(peteCard).filter((p) => p.key.startsWith(peteBill.id))).toHaveLength(1);
    expect((await secondWeek(pete)).status).toBe("paid");

    // Staff pressing Charge card on file: never a card its bank declined for good; never a fourth time.
    for (const h of [cora, nora, ezra]) {
      const res = await press(gym, h);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res).error).toBe("card_charge_stopped");
    }
    const fourth = await press(gym, nina);
    expect(fourth.statusCode, fourth.body).toBe(409);
    expect(errorOf(fourth).error).toBe("card_charge_tried_out");
    // No reason given: staff may charge it again once the cardholder has spoken to their bank.
    cardNowAnswers(gabeCard, "pays");
    const again = await press(gym, gabe);
    expect(again.statusCode, again.body).toBe(200);
    expect(cardChargeResponseSchema.parse(JSON.parse(again.body)).charge.outcome).toBe("paid");
    for (const card of [ezraCard, coraCard, noraCard]) expect(askedOf(card), card).toHaveLength(1);
    expect(askedOf(ninaCard)).toHaveLength(3);
  });

  it("the card paying on a later try: paid on day 3, and nothing after", async () => {
    const gym = await makeGym(`Recover Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    const noon = new Date(`${today}T18:00:00Z`);
    clock = noon;
    const rita = await renewingToday(gym, typeId, await person(gym, "Rita Recover"));
    const card = await cardFor(gym, rita.entryId, "insufficient");
    await work();
    expect((await shown(gym, rita))?.cardDeclined).toMatchObject({ reason: "insufficient_funds", next: new Date(noon.getTime() + 3 * DAY).toISOString().slice(0, 10), stop: null });
    cardNowAnswers(card, "pays");
    for (const n of [1, 2, 3, 4, 7]) {
      clock = new Date(noon.getTime() + n * DAY);
      await work();
    }
    expect(askedOf(card).map((p) => p.status)).toEqual(["FAILED", "COMPLETED"]);
    expect((await secondWeek(rita)).status).toBe("paid");
    expect((await shown(gym, rita))?.cardDeclined).toBeNull();
  });

  it("staff charge a declined card again only a whole day after its decline", async () => {
    const gym = await makeGym(`Wait Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    const noon = new Date(`${today}T18:00:00Z`);
    clock = noon;
    const will = await renewingToday(gym, typeId, await person(gym, "Will Wait"));
    const card = await cardFor(gym, will.entryId, "declines");
    await work();
    clock = new Date(noon.getTime() + 23 * 60 * 60_000);
    const early = await press(gym, will);
    expect(early.statusCode, early.body).toBe(409);
    expect(errorOf(early)).toMatchObject({ error: "card_charge_wait" });
    expect(errorOf(early).message).toMatch(/^Visa ending 1111 was declined less than a day ago\. Square recommends waiting 24 hours before retrying\. It can be charged from .+ on \d{1,2} [A-Z][a-z]{2}\. Nothing was charged\.$/);
    expect(askedOf(card)).toHaveLength(1);
    clock = new Date(noon.getTime() + 24 * 60 * 60_000);
    const later = await press(gym, will);
    expect(later.statusCode, later.body).toBe(200);
    expect(askedOf(card)).toHaveLength(2);
  });

  it("a card saved after the decline is staff's to charge, never the app's", async () => {
    const gym = await makeGym(`New Card Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    const noon = new Date(`${today}T18:00:00Z`);
    clock = noon;
    const sam = await renewingToday(gym, typeId, await person(gym, "Sam Swap"));
    const old = await cardFor(gym, sam.entryId, "insufficient");
    await work();
    const fresh = await cardFor(gym, sam.entryId, "pays");
    // The new card is staff's to charge: the bill says so (review round one, Low-1).
    expect((await shown(gym, sam))?.cardDeclined).toMatchObject({ next: null, stop: "manual" });
    for (const n of [3, 7]) {
      clock = new Date(noon.getTime() + n * DAY);
      await work();
    }
    expect(askedOf(old)).toHaveLength(1);
    expect(askedOf(fresh)).toHaveLength(0);
    const res = await press(gym, sam);
    expect(res.statusCode, res.body).toBe(200);
    expect(askedOf(fresh).map((p) => p.status)).toEqual(["COMPLETED"]);
  });

  it("a retry the worker will not make is never promised: a member who became past after the decline", async () => {
    const gym = await makeGym(`Past Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    const noon = new Date(`${today}T18:00:00Z`);
    clock = noon;
    const paul = await renewingToday(gym, typeId, await person(gym, "Paul Past", "crty-paul@example.com"));
    const card = await cardFor(gym, paul.entryId, "insufficient");
    await work();
    expect((await shown(gym, paul))?.cardDeclined?.next).toBe(new Date(noon.getTime() + 3 * DAY).toISOString().slice(0, 10));
    // A file that no longer lists him marks him a past member; his membership stays as it was.
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${paul.entryId}`;
    const page = (await held(gym, paul.entryId)).memberships.find((m) => m.id === paul.membershipId)?.billing?.bills.find((b) => b.periodIndex === 1);
    expect(page?.cardDeclined).toMatchObject({ next: null, stop: "manual" });
    // His email, sent now, promises nothing either.
    await notify();
    const paulMail = mail.find((m) => m.to === "crty-paul@example.com");
    expect(paulMail?.text).toContain("We will not automatically retry this payment.");
    expect(paulMail?.text).not.toContain("We will retry this payment automatically");
    for (const n of [3, 7]) {
      clock = new Date(noon.getTime() + n * DAY);
      await work();
    }
    expect(askedOf(card)).toHaveLength(1);
  });

  it("a press paying ahead, declined before its bill is open, emails the cardholder, and the bill says so once open", async () => {
    const gym = await makeGym(`Ahead Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    clock = new Date(`${today}T18:00:00Z`);
    const abe = await person(gym, "Abe Ahead", "crty-abe@example.com");
    const given = await send("POST", `${entryUrl(gym, abe)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    const h = { entryId: abe, membershipId: m.id };
    await cardFor(gym, abe, "insufficient");
    // Next week paid ahead at the desk on the card on file: declined, and no bill for it yet.
    const pressed = await press(gym, h);
    expect(pressed.statusCode, pressed.body).toBe(200);
    expect(cardChargeResponseSchema.parse(JSON.parse(pressed.body)).charge.outcome).toBe("declined");
    expect(await sql`SELECT id FROM gym_member_bills WHERE held_membership_id = ${m.id} AND period_index = 1`).toHaveLength(0);
    await notify();
    const abeMail = mail.find((x) => x.to === "crty-abe@example.com");
    expect(abeMail?.text).toMatch(/Your \$25\.00 membership payment to Ahead Gym \d+ could not be processed\./);
    expect(abeMail?.text).toContain("We will not automatically retry this payment.");
    // A week on, the bill opens and says what happened.
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${m.id}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${m.id}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    expect((await shown(gym, h))?.cardDeclined).toMatchObject({ reason: "insufficient_funds", next: null, stop: "manual", notice: { state: "emailed", on: today } });
    // One email for that week, however often the sender runs.
    await notify();
    expect(mail.filter((x) => x.to === "crty-abe@example.com")).toHaveLength(1);
  });

  it("the cardholder is emailed once a bill, at their own address or their payer's, and the bill says so", async () => {
    const gym = await makeGym(`Notice Gym ${uniq()}`);
    await sql`UPDATE gyms SET contact_email = 'desk@noticegym.test', contact_phone = '+1 312 555 0199' WHERE id = ${gym.id}`;
    const typeId = await typeOf(gym);
    const today = (await held(gym, await person(gym, "Clock Reader"))).today;
    const noon = new Date(`${today}T18:00:00Z`);
    clock = noon;
    const nadia = await renewingToday(gym, typeId, await person(gym, "Nadia Notice", "crty-nadia@example.com"));
    // Kai's bills are paid by his mother Mei: her card, her email.
    const meiId = await person(gym, "Mei Payer", "crty-mei@example.com");
    const kai = await renewingToday(gym, typeId, await person(gym, "Kai Child", "crty-kai@example.com"));
    expect((await send("PUT", `${entryUrl(gym, kai.entryId)}/payer`, gym.owner.cookies, { payerEntryId: meiId })).statusCode).toBe(200);
    const phoneOnly = await renewingToday(gym, typeId, await person(gym, "Phil Phone", null));
    const paidFirst = await renewingToday(gym, typeId, await person(gym, "Paige Paid", "crty-paige@example.com"));
    const gone = await renewingToday(gym, typeId, await person(gym, "Gwen Gone", "crty-gwen@example.com"));
    const bounced = await renewingToday(gym, typeId, await person(gym, "Bea Bounced", "crty-bounced@example.com"));
    // Bea's address bounced at another gym's email: no gym's email goes to it again.
    await sql`INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${createHmac("sha256", HMAC_KEY).update("crty-bounced@example.com").digest("hex")}, NULL, 'bounced')`;
    await cardFor(gym, nadia.entryId, "insufficient");
    await cardFor(gym, meiId, "expired");
    await cardFor(gym, phoneOnly.entryId, "declines");
    await cardFor(gym, paidFirst.entryId, "insufficient");
    await cardFor(gym, gone.entryId, "insufficient");
    await cardFor(gym, bounced.entryId, "insufficient");

    await work();
    // Gwen's record deleted for good before her email goes, through the gym's own buttons: taken off
    // the list, then deleted from past members. Nothing is sent to an address the gym was asked to
    // forget, and the notice keeps no link to her record.
    const cancel = await send("POST", `${entryUrl(gym, gone.entryId)}/memberships/${gone.membershipId}/cancel`, gym.owner.cookies, { when: "today" });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const off = await api().inject({ method: "DELETE", url: entryUrl(gym, gone.entryId), remoteAddress: nextIp(), cookies: gym.owner.cookies });
    expect(off.statusCode, off.body).toBe(200);
    const forgotten = await api().inject({ method: "DELETE", url: `/v1/orgs/${gym.id}/member-list/former/${gone.entryId}`, remoteAddress: nextIp(), cookies: gym.owner.cookies });
    expect(forgotten.statusCode, forgotten.body).toBe(200);
    // Paige pays at the desk before the email goes: nothing is sent to her.
    const pay = (await held(gym, paidFirst.entryId)).memberships[0]?.billing?.pay;
    expect(
      (await send("POST", `${entryUrl(gym, paidFirst.entryId)}/memberships/${paidFirst.membershipId}/payments`, gym.owner.cookies, {
        requestKey: randomUUID(),
        periodIndex: pay?.periodIndex,
        amountMinor: pay?.leftMinor,
        method: "cash",
      })).statusCode,
    ).toBe(200);
    await Promise.all([notify(), notify()]);
    await notify();
    // The second try on day 3 sends no second email.
    clock = new Date(noon.getTime() + 3 * DAY);
    await work();
    await notify();

    const to = mail.filter((m) => m.subject.includes("Notice Gym")).map((m) => m.to).sort();
    expect(to).toEqual(["crty-mei@example.com", "crty-nadia@example.com"]);
    const nadiaMail = mail.find((m) => m.to === "crty-nadia@example.com");
    const fmt = (offset: number) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${today}T12:00:00Z`).getTime() + offset * DAY);
    expect(nadiaMail?.subject).toMatch(/^Your payment to Notice Gym \d+ could not be processed$/);
    expect(nadiaMail?.text).toContain("Hi Nadia,");
    expect(nadiaMail?.text).toMatch(/Your \$25\.00 membership payment to Notice Gym \d+ could not be processed\./);
    expect(nadiaMail?.text).toContain(`Your Visa ending in 1111 was declined on ${fmt(0)}. The card did not have enough funds.`);
    expect(nadiaMail?.text).toContain(`We will retry this payment automatically on ${fmt(3)}.`);
    expect(nadiaMail?.text).toContain(`Please make your payment by ${fmt(7)} using one of the following options:\n\n• Pay at the front desk\n• Pay with another card`);
    expect(nadiaMail?.text).toContain("If you have any questions, you can call +1 312 555 0199 or email desk@noticegym.test.\n\nThank you.");
    expect(nadiaMail?.html).toContain("<ul><li>Pay at the front desk</li><li>Pay with another card</li></ul>");
    expect(nadiaMail?.replyTo).toBe("desk@noticegym.test");
    const meiMail = mail.find((m) => m.to === "crty-mei@example.com");
    expect(meiMail?.text).toContain("Hi Mei,");
    expect(meiMail?.text).toMatch(/Your \$25\.00 payment to Notice Gym \d+ for Kai Child's membership could not be processed\./);
    expect(meiMail?.text).toContain("The card has expired.\n\nThis card cannot be charged again.");
    expect(meiMail?.text).not.toContain("crty-kai@example.com");

    // The bills say what happened; no address is kept once the emails are done.
    expect((await shown(gym, nadia))?.cardDeclined?.notice).toEqual({ state: "emailed", on: today });
    expect((await shown(gym, kai))?.cardDeclined).toMatchObject({ stop: "new_card", notice: { state: "emailed" } });
    expect((await shown(gym, phoneOnly))?.cardDeclined).toMatchObject({ stop: "bank", notice: { state: "no_email", on: null } });
    const rows = await sql<{ state: string; reason: string | null; email: string | null }[]>`SELECT state, reason, email::text AS email FROM gym_card_decline_notices WHERE gym_id = ${gym.id} ORDER BY created_at`;
    expect(rows.map((r) => r.email)).toEqual([null, null, null, null, null, null]);
    expect(rows.map((r) => `${r.state}:${r.reason ?? ""}`).sort()).toEqual([
      "sent:",
      "sent:",
      "skipped:address_blocked",
      "skipped:no_email",
      "skipped:paid",
      "skipped:record_gone",
    ]);
    const [goneRow] = await sql<{ entry_id: string | null }[]>`SELECT n.entry_id FROM gym_card_decline_notices n JOIN gym_card_charges c ON c.id = n.charge_id WHERE n.gym_id = ${gym.id} AND c.held_membership_id = ${gone.membershipId}`;
    expect(goneRow?.entry_id, "the deleted record let go of").toBeNull();
  });
});
