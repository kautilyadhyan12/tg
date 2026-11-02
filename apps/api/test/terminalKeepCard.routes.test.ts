// The card kept from a Terminal payment (ROADMAP 18d-vi-c; spec Part 3 §14.8), through its routes against real
// Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`. The first test is the
// worst thing: a card kept without its holder's own I agree, or kept on somebody else's record.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentResponseSchema,
  terminalPaymentsResponseSchema,
  type GymMembershipTypesResponse,
  type TerminalPaymentResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account, type Behaviour } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-TERMINALKEEPAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "terminal-keep-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-TERMINALKEEPSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_terminal_keep";


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

d("The card kept from a Terminal payment: only with their I agree, on their record alone (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  const square = fakeSquare();
  /** What the console's open lines were told (Stage 4 item 18). */
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tkeep-t-%@example.com')`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tkeep-t-%@example.com')`).map((r) => r.id);
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'tkeep-t-%@example.com'`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'tkeep-t-%@example.com'`;
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
    const email = `tkeep-t-${uniq()}@example.com`;
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
  const connect = async (gym: Gym, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  /** A Terminal signed in to the account, paired by the gym (pairing itself is
   *  `squareTerminals.routes.test.ts`'s). */
  const terminal = async (gym: Gym, acct: Account, behaviour: Behaviour = "person"): Promise<{ id: string; deviceId: string }> => {
    const deviceId = `R5${randomBytes(6).toString("hex").toUpperCase()}`;
    square.devices.set(deviceId, { accountId: acct.merchantId, behaviour });
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
      VALUES (${gym.id}, 'production', ${acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${gym.owner.userId})
      RETURNING id`;
    if (row === undefined) throw new Error("no terminal");
    return { id: row.id, deviceId };
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
  const owing = async (gym: Gym, typeId: string, fullName: string): Promise<{ entryId: string; membershipId: string }> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `tkeep-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const today = heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: false });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return { entryId, membershipId: m.id };
  };

  const payPress = (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, terminalId: string, over: Record<string, unknown> = {}) =>
    send("POST", `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/terminal-payment`, by.cookies, {
      terminalId,
      requestKey: randomUUID(),
      periodIndex: 0,
      amountMinor: 4999,
      ...over,
    });
  const parsed = (res: { statusCode: number; body: string }): TerminalPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return terminalPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const pay = async (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, terminalId: string, over: Record<string, unknown> = {}) =>
    parsed(await payPress(gym, by, who, terminalId, over));
  const check = async (gym: Gym, by: Person, entryId: string, payId: string) => parsed(await send("GET", `${entryUrl(gym, entryId)}/terminal-payments/${payId}`, by.cookies));
  const cancel = async (gym: Gym, by: Person, entryId: string, payId: string) => parsed(await send("POST", `${entryUrl(gym, entryId)}/terminal-payments/${payId}/cancel`, by.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const paymentsOf = (gymId: string) =>
    sql<{ bill_id: string; held_membership_id: string; amount_minor: number; method: string; provider: string | null; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT p.bill_id, b.held_membership_id, p.amount_minor, p.method, p.provider, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE p.gym_id = ${gymId} ORDER BY p.seq`;
  const checkoutsOn = (deviceId: string) => [...square.checkouts.values()].filter((c) => c.deviceId === deviceId);
  const work = async (gymIds?: string[]) => processSquareWork(workDeps(), [], gymIds ?? (await mine()));

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
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  const cardsOf = (gymId: string) => sql<{ entry_id: string; last4: string; agreement_id: string }[]>`SELECT entry_id, last4, agreement_id FROM gym_member_cards WHERE gym_id = ${gymId}`;
  const agreementsOf = (gymId: string) => sql<{ entry_id: string; words: string; screen: string; held_membership_id: string | null; last4: string }[]>`SELECT entry_id, words, screen, held_membership_id, last4 FROM gym_card_agreements WHERE gym_id = ${gymId}`;
  const setUp = async (label: string, behaviour: Behaviour = "person") => {
    const gym = await makeGym(`Keep ${label}`);
    const acct = account(`TK${label.slice(0, 2).toUpperCase()}${uniq().slice(-6)}`);
    await connect(gym, acct);
    const goldId = await typeOf(gym);
    const desk = await terminal(gym, acct, behaviour);
    return { gym, acct, goldId, desk };
  };
  /** The person answers the agreement, pays, and the box asks where it stands. */
  const answersAndPays = async (gym: Gym, who: { entryId: string }, payId: string, deviceId: string, agreed: boolean) => {
    await check(gym, gym.owner, who.entryId, payId);
    square.agreement(deviceId).answers(agreed);
    await check(gym, gym.owner, who.entryId, payId);
    square.at(deviceId).taps();
    return await check(gym, gym.owner, who.entryId, payId);
  };

  it("the worst thing: a card is kept only after their own I agree, only from their payment, only on their record", async () => {
    clock = new Date();
    const { gym, goldId, desk } = await setUp("Worst");
    const tara = await owing(gym, goldId, "Tara Singh");
    const sam = await owing(gym, goldId, "Sam Lee");

    // Pay without saving: the money is taken, and Square is never asked to keep the card.
    const first = await pay(gym, gym.owner, tara, desk.id, { keepCard: true });
    expect(first.payment.card).toMatchObject({ step: "agreeing" });
    expect(checkoutsOn(desk.deviceId)).toEqual([]);
    const words = square.agreement(desk.deviceId).words;
    expect(words).toContain("Gold Monthly: $49.99 every month. Renews until you cancel.");
    expect(words).toContain(`I agree that ${gym.name} may save this card`);
    const declined = await answersAndPays(gym, tara, first.payment.id, desk.deviceId, false);
    expect(declined.payment).toMatchObject({ outcome: "paid", card: { step: "declined" } });
    expect(await cardsOf(gym.id)).toEqual([]);
    expect(square.cardsFromPayments).toEqual([]);
    expect(await paymentsOf(gym.id)).toHaveLength(1);

    // No answer at all, or an answer to other words: nothing is taken and nothing kept.
    const late = await pay(gym, gym.owner, sam, desk.id, { keepCard: true });
    await check(gym, gym.owner, sam.entryId, late.payment.id);
    square.agreement(desk.deviceId).changesWords("I agree to anything at all, and more.");
    square.agreement(desk.deviceId).answers(true);
    const changed = await check(gym, gym.owner, sam.entryId, late.payment.id);
    expect(changed.payment).toMatchObject({ outcome: "refused" });
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
    expect(await cardsOf(gym.id)).toEqual([]);

    // I agree, then the person cancels the payment: no money, no card.
    const backs = await pay(gym, gym.owner, sam, desk.id, { keepCard: true });
    await check(gym, gym.owner, sam.entryId, backs.payment.id);
    square.agreement(desk.deviceId).answers(true);
    await check(gym, gym.owner, sam.entryId, backs.payment.id);
    square.at(desk.deviceId).cancels();
    const cancelled = await check(gym, gym.owner, sam.entryId, backs.payment.id);
    expect(cancelled.payment.outcome).toBe("cancelled_on_terminal");
    expect(await cardsOf(gym.id)).toEqual([]);
    expect(square.cardsFromPayments).toEqual([]);

    // I agree and paid: kept once, on Sam alone, from that very payment, with the words shown, for that membership.
    const yes = await pay(gym, gym.owner, sam, desk.id, { keepCard: true });
    const shownWords = (await (async () => { await check(gym, gym.owner, sam.entryId, yes.payment.id); return square.agreement(desk.deviceId).words; })());
    const done = await answersAndPays(gym, sam, yes.payment.id, desk.deviceId, true);
    expect(done.payment).toMatchObject({ outcome: "paid", card: { step: "saved", brand: "VISA", last4: "1111" } });
    const kept = await cardsOf(gym.id);
    expect(kept.map((c) => c.entry_id)).toEqual([sam.entryId]);
    const [agreed] = await agreementsOf(gym.id);
    expect(agreed).toMatchObject({ entry_id: sam.entryId, words: shownWords, screen: "terminal", held_membership_id: sam.membershipId, last4: "1111" });
    expect(square.cardsFromPayments).toHaveLength(1);
    const paid = await paymentsOf(gym.id);
    expect(square.cardsFromPayments[0]?.paymentId).toBe(paid.find((p) => p.held_membership_id === sam.membershipId)?.provider_payment_id);
    expect(paid).toHaveLength(2);

    // The signed agreement's box names it.
    const box = await send("GET", `${entryUrl(gym, sam.entryId)}/memberships/${sam.membershipId}/agreement`, gym.owner.cookies);
    expect(box.statusCode, box.body).toBe(200);
    expect((JSON.parse(box.body) as { card: unknown }).card).toMatchObject({ brand: "VISA", last4: "1111" });
    const none = await send("GET", `${entryUrl(gym, tara.entryId)}/memberships/${tara.membershipId}/agreement`, gym.owner.cookies);
    expect((JSON.parse(none.body) as { card: unknown }).card).toBeNull();
  });

  it("never offered where it cannot be: somebody else pays, another gym", async () => {
    clock = new Date();
    const { gym, goldId, desk } = await setUp("Offer");
    const other = await setUp("Other");
    const tara = await owing(gym, goldId, "Tara Payer");
    const kid = await owing(gym, goldId, "Kit Paidfor");
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${kid.entryId}, ${tara.entryId})`;
    const paidFor = await payPress(gym, gym.owner, kid, desk.id, { keepCard: true });
    expect(paidFor.statusCode, paidFor.body).toBe(409);
    expect(errorOf(paidFor)).toBe("keep_card_not_offered");
    const list = await send("GET", `${entryUrl(gym, kid.entryId)}/terminal-payments`, gym.owner.cookies);
    expect(terminalPaymentsResponseSchema.parse(JSON.parse(list.body)).keepsCard).toBe(false);
    const payerList = await send("GET", `${entryUrl(gym, tara.entryId)}/terminal-payments`, gym.owner.cookies);
    expect(terminalPaymentsResponseSchema.parse(JSON.parse(payerList.body)).keepsCard).toBe(true);
    // Another gym's owner reaches nothing.
    const stranger = await payPress(gym, other.gym.owner, tara, desk.id, { keepCard: true });
    expect(stranger.statusCode, stranger.body).toBe(404);
    expect(square.actions.size).toBe(0);
  });

  it("Square refusing, or not answering, leaves the payment on the bill; the worker finishes it; a press with no tick is as before", async () => {
    clock = new Date();
    const { gym, goldId, desk } = await setUp("Refuse");
    const ann = await owing(gym, goldId, "Ann Wallet");
    const ben = await owing(gym, goldId, "Ben Later");
    const cal = await owing(gym, goldId, "Cal Plain");

    // Apple Pay: Square will not save it.
    square.state.cardFromPaymentRefused = "INVALID_CARD_DATA";
    const a = await pay(gym, gym.owner, ann, desk.id, { keepCard: true });
    const aDone = await answersAndPays(gym, ann, a.payment.id, desk.deviceId, true);
    expect(aDone.payment).toMatchObject({ outcome: "paid", card: { step: "not_saved" } });
    square.state.cardFromPaymentRefused = null;
    expect(await cardsOf(gym.id)).toEqual([]);

    // No answer: still paid, and the worker keeps it once Square answers.
    square.state.cardFromPaymentDown = true;
    const b = await pay(gym, gym.owner, ben, desk.id, { keepCard: true });
    const bDone = await answersAndPays(gym, ben, b.payment.id, desk.deviceId, true);
    expect(bDone.payment).toMatchObject({ outcome: "paid", card: { step: "keeping" } });
    expect(await paymentsOf(gym.id)).toHaveLength(2);
    square.state.cardFromPaymentDown = false;
    clock = new Date(clock.getTime() + 60_000);
    await work();
    const after = await check(gym, gym.owner, ben.entryId, b.payment.id);
    expect(after.payment.card).toMatchObject({ step: "saved", last4: "1111" });
    expect((await cardsOf(gym.id)).map((c) => c.entry_id)).toEqual([ben.entryId]);

    // Past Square's 24 hours it is given up, and the payment stands.
    square.state.cardFromPaymentDown = true;
    const c = await pay(gym, gym.owner, cal, desk.id, { keepCard: true });
    await answersAndPays(gym, cal, c.payment.id, desk.deviceId, true);
    clock = new Date(clock.getTime() + 23.5 * 60 * 60_000);
    await work();
    square.state.cardFromPaymentDown = false;
    const gaveUp = await check(gym, gym.owner, cal.entryId, c.payment.id);
    expect(gaveUp.payment.card).toMatchObject({ step: "not_saved" });
    expect((await paymentsOf(gym.id)).length).toBe(3);
    expect((await cardsOf(gym.id)).map((x) => x.entry_id)).toEqual([ben.entryId]);
  });

  it("no tick, no agreement; Cancel on the agreement charges nothing; a join sends the card to the record holding the membership", async () => {
    clock = new Date();
    const { gym, goldId, desk } = await setUp("Plain");
    const dee = await owing(gym, goldId, "Dee Plain");
    const eve = await owing(gym, goldId, "Eve Swap");
    const before = square.actions.size;
    const plain = await pay(gym, gym.owner, dee, desk.id);
    expect(plain.payment.card).toBeNull();
    expect(square.actions.size).toBe(before);
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
    square.at(desk.deviceId).taps();
    await check(gym, gym.owner, dee.entryId, plain.payment.id);

    const waiting = await pay(gym, gym.owner, eve, desk.id, { keepCard: true });
    await check(gym, gym.owner, eve.entryId, waiting.payment.id);
    const stopped = await cancel(gym, gym.owner, eve.entryId, waiting.payment.id);
    expect(stopped.payment.outcome).toBe("cancelled");
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);

    // Twice with the same key is one press.
    const key = randomUUID();
    const once = await pay(gym, gym.owner, eve, desk.id, { keepCard: true, requestKey: key });
    const twice = await pay(gym, gym.owner, eve, desk.id, { keepCard: true, requestKey: key });
    expect(twice.payment.id).toBe(once.payment.id);
    await answersAndPays(gym, eve, once.payment.id, desk.deviceId, true);
    expect((await cardsOf(gym.id)).map((c) => c.entry_id)).toEqual([eve.entryId]);
    expect(square.charged).toEqual([]);

    // Two records joined while the payment waits: the card follows the membership, as the money does.
    const fay = await owing(gym, goldId, "Fay Moved");
    const gil = await owing(gym, goldId, "Gil Kept");
    const moving = await pay(gym, gym.owner, fay, desk.id, { keepCard: true });
    await check(gym, gym.owner, fay.entryId, moving.payment.id);
    square.agreement(desk.deviceId).answers(true);
    await check(gym, gym.owner, fay.entryId, moving.payment.id);
    await sql`UPDATE gym_held_memberships SET entry_id = ${gil.entryId} WHERE gym_id = ${gym.id} AND id = ${fay.membershipId}`;
    square.at(desk.deviceId).taps();
    await check(gym, gym.owner, fay.entryId, moving.payment.id);
    expect((await cardsOf(gym.id)).map((c) => c.entry_id).sort()).toEqual([eve.entryId, gil.entryId].sort());
  });
});
