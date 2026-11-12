// Buy a repeating membership in the app (ROADMAP 18k-iv; spec Part 3 §14.8), through its routes against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`, whose cards on file are charged as
// Square's test area charged them on 2026-10-23: the same key gives back the same payment, never a second.
//
// The first block is the worst thing this job could do to a real person: charge a card that is not theirs, charge one
// press twice, or take the money and give nothing with nobody told.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  appPurchaseResponseSchema,
  dayWords,
  forSaleResponseSchema,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type AppPurchaseResponse,
  type ForSaleLine,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { createMemoryRedis } from "../src/redis.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account, type CardBehaviour } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-APPCARDBUYAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "app-card-buy-secret-0123456789abcdefg", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-APPCARDBUYSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_app_card_buy";

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

let ipCounter = 0;
const nextIp = () => `10.58.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
/** Gold Monthly: $49.99 every month, sold in the app. */
const monthly = (over: Record<string, unknown>) => ({
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
  soldInApp: true,
  ...over,
});
const TERMS = "Your membership renews every month until you cancel. Cancel in the app or at the front desk.";

d("Buy a repeating membership in the app: on their own card, once, given only for what Square took (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  const square = fakeSquare();
  const hub = recordingHub();
  const redis = createMemoryRedis();
  const copies: { to: string; signedName: string }[] = [];
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  const MINE = "acbuy-t-%@example.com";
  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`).map((r) => r.id);
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });
  const work = async () => processSquareWork(workDeps(), [], await mine());
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM gym_app_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_autopay_pauses WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_agreement_documents WHERE gym_id IN (${mineSql})`;
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
    const email = `acbuy-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string): Promise<Gym> => {
    const acct = account(`ACB${uniq().slice(-7)}`);
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
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
    return { id, name, owner, acct };
  };
  const addType = async (gym: Gym, over: Record<string, unknown>): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, monthly(over));
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === over["name"]);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const member = async (gym: Gym, fullName: string): Promise<{ entryId: string; app: Person; email: string }> => {
    const email = `acbuy-r-${uniq()}@gmail.com`;
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const app = await signedIn(fullName);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${app.userId}, ${entryId})`;
    return { entryId, app, email };
  };
  /** A card saved for the record, as Add card keeps one, and in the gym's Square account. */
  const cardFor = async (gym: Gym, entryId: string, behaviour: CardBehaviour = "pays", exp: { month: number; year: number } = { month: 12, year: 2031 }): Promise<{ cardId: string; customerId: string }> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'app', NULL, 'VISA', '1111', now())
      RETURNING id`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', '1111', ${exp.month}, ${exp.year}, 'app', NULL, ${agreed?.id ?? null}, now(), now())`;
    square.card(cardId, gym.acct.merchantId, customerId, behaviour);
    return { cardId, customerId };
  };
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const forSale = async (gym: Gym, who: Person, repeating = true) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/for-sale${repeating ? "?repeating=true" : ""}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return forSaleResponseSchema.parse(JSON.parse(res.body));
  };
  const lineOf = async (gym: Gym, who: Person, typeId: string): Promise<ForSaleLine> => {
    const found = (await forSale(gym, who)).items.find((i) => i.typeId === typeId);
    if (found === undefined) throw new Error("the line is not listed");
    return found;
  };
  const buyUrl = (gym: Gym) => `/v1/orgs/${gym.id}/for-sale/purchases`;
  /** Buy, as the phone sends it: what the list showed, the tick read word for word, signed where the line asks. */
  const buyPress = (gym: Gym, who: Person, shown: ForSaleLine, over: Record<string, unknown> = {}, name = "Tara Singh") =>
    send("POST", buyUrl(gym), who.cookies, {
      requestKey: randomUUID(),
      typeId: shown.typeId,
      amountMinor: shown.firstPayment.amountMinor,
      factsKey: shown.factsKey,
      agreement: shown.agreement === null ? null : { agreementId: shown.agreement.id, signer: "person", name },
      charge: { words: shown.charge ?? "I agree.", verificationToken: null },
      ...over,
    });
  const parsed = (res: { statusCode: number; body: string }): AppPurchaseResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return appPurchaseResponseSchema.parse(JSON.parse(res.body));
  };
  const check = async (gym: Gym, who: Person, id: string) => parsed(await send("GET", `${buyUrl(gym)}/${id}`, who.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string; message?: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message?: string }).message;
  const takenAt = (gym: Gym) => square.charged.filter((p) => p.accountId === gym.acct.merchantId);
  const paymentsOf = (gymId: string) =>
    sql<{ entry_id: string; amount_minor: number; method: string; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT h.entry_id, p.amount_minor, p.method, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${gymId} ORDER BY p.seq`;
  const typeChange = async (gym: Gym, typeId: string, over: Record<string, unknown>) => {
    const types = JSON.parse((await send("GET", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies)).body) as GymMembershipTypesResponse;
    const t = types.types.find((x) => x.id === typeId);
    if (t === undefined) throw new Error("no type");
    const notSent = new Set(["id", "currency", "archivedAt", "classTypes", "agreementId"]);
    return send("PUT", `/v1/orgs/${gym.id}/membership-types/${typeId}`, gym.owner.cookies, { ...Object.fromEntries(Object.entries(t).filter(([k]) => !notSent.has(k))), classTypeIds: null, ...over });
  };
  /** The tick as the server words it, from what the list shows of the line. */
  const wordsOf = (gymName: string, shown: ForSaleLine, last4 = "1111") =>
    `I agree that ${gymName} may charge my Visa ending ${last4} $${(shown.firstPayment.amountMinor / 100).toFixed(2)} today, then $${((shown.renews?.amountMinor ?? 0) / 100).toFixed(2)} every month from ${dayWords(shown.renews?.from ?? "")}, until my membership ends or I cancel it.`;

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
      agreementEmailSender: {
        sendAgreementCopy: (letter) => {
          copies.push({ to: letter.to, signedName: letter.signedName });
          return Promise.resolve();
        },
        sendAgreementLink: () => Promise.resolve(),
      },
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

  it("the worst thing: only their own card is charged, once a press, and the membership is given for exactly what Square took", async () => {
    clock = new Date();
    const gymA = await makeGym("Card Buy Worst A");
    const gymB = await makeGym("Card Buy Worst B");
    const agreed = await send("PUT", `/v1/orgs/${gymA.id}/agreement`, gymA.owner.cookies, { text: TERMS });
    expect(agreed.statusCode, agreed.body).toBe(200);
    const gold = await addType(gymA, { name: "Gold Monthly" });
    const silver = await addType(gymA, { name: "Silver Monthly", priceMinor: 2999 });
    await addType(gymB, { name: "Gold Monthly" });
    const tara = await member(gymA, "Tara Singh");
    const sam = await member(gymA, "Sam Lee");
    const priya = await member(gymA, "Priya Sharma");
    const leo = await member(gymA, "Leo Card");
    const bea = await member(gymB, "Bea Brown");
    const stranger = await signedIn("A Stranger");
    const taraCard = await cardFor(gymA, tara.entryId);
    const priyaCard = await cardFor(gymA, priya.entryId);
    await cardFor(gymB, bea.entryId);
    // Priya pays for Sam (18i): Sam does not buy in the app, and her card is never charged for him.
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${gymA.id}, ${sam.entryId}, ${priya.entryId}, ${gymA.owner.userId})`;

    // A phone that does not ask for repeating lines is never shown one: it would offer it on Square's page, which keeps no card.
    expect((await forSale(gymA, tara.app, false)).items.map((i) => i.typeId)).not.toContain(gold);
    expect((await forSale(gymA, tara.app, false)).card).toBeNull();
    // Asked for, the line names her card and its own tick, in words naming the card, today's payment and the next.
    const list = await forSale(gymA, tara.app);
    expect(list.card).toEqual({ brand: "VISA", last4: "1111", expired: false });
    const shown = await lineOf(gymA, tara.app, gold);
    expect(shown).toMatchObject({ repeats: true, firstPayment: { amountMinor: 4999 }, renews: { amountMinor: 4999, every: { count: 1, unit: "month" } } });
    expect(shown.renews?.from > shown.firstPayment.dueOn).toBe(true);
    expect(shown.charge).toBe(wordsOf(gymA.name, shown));
    // Leo has no card: no tick to read.
    expect((await forSale(gymA, leo.app)).card).toBeNull();
    const leoLine = await lineOf(gymA, leo.app, gold);
    expect(leoLine.charge).toBeNull();

    // Nobody buys but at their own gym, on their own record: a stranger, B's member at A, A's owner, Tara at B; Sam, whom
    // somebody pays for; Leo, with no card; a phone sending no tick at all.
    for (const [gym, who, line, over, status, code] of [
      [gymA, stranger, shown, {}, 404, "org_not_found"],
      [gymA, bea.app, shown, {}, 404, "org_not_found"],
      [gymA, gymA.owner, shown, {}, 404, "org_not_found"],
      [gymB, tara.app, shown, {}, 404, "org_not_found"],
      [gymA, sam.app, shown, {}, 409, "app_purchase_paid_by_other"],
      [gymA, leo.app, leoLine, { charge: { words: "I agree.", verificationToken: null } }, 409, "app_purchase_card_needed"],
      [gymA, tara.app, shown, { charge: undefined }, 409, "app_purchase_card_needed"],
    ] as const) {
      const res = await buyPress(gym, who, line, over);
      expect(res.statusCode, res.body).toBe(status);
      expect(errorOf(res)).toBe(code);
    }
    // Only the very tick shown: another card's digits, another amount, nothing more after it.
    for (const words of [wordsOf(gymA.name, shown, "4242"), (shown.charge ?? "").replace("$49.99 today", "$4.99 today"), `${shown.charge ?? ""} `]) {
      const res = await buyPress(gymA, tara.app, shown, { charge: { words, verificationToken: null } });
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("app_purchase_card_changed");
    }
    expect(square.charged).toHaveLength(0);

    // Tara presses Buy: her card alone is charged, once, $49.99, with the purchase as Square's key.
    const key = randomUUID();
    const bought = parsed(await buyPress(gymA, tara.app, shown, { requestKey: key }));
    expect(bought.purchase).toMatchObject({ state: "paid", typeId: gold, amountMinor: 4999, url: null });
    expect(takenAt(gymA).map((p) => [p.cardId, p.customer_id, p.amount_money.amount, p.status, p.key])).toEqual([[taraCard.cardId, taraCard.customerId, 4999, "COMPLETED", bought.purchase.id]]);
    // The membership is hers, renewing, its first bill paid in the app with Square's payment, nobody on staff recording it.
    const hers = await held(gymA, tara.entryId);
    expect(hers.memberships.map((m) => [m.id, m.typeName, m.kind])).toEqual([[bought.purchase.membershipId, "Gold Monthly", "recurring"]]);
    expect(await paymentsOf(gymA.id)).toEqual([{ entry_id: tara.entryId, amount_minor: 4999, method: "app", provider_payment_id: takenAt(gymA)[0]?.id ?? "", recorded_by: null }]);
    // The agreement is signed, the copy emailed once, and the tick kept word for word with the membership and the card.
    const [sig] = await sql<{ signed_name: string; signed_via: string }[]>`SELECT signed_name, signed_via FROM gym_agreement_signatures WHERE held_membership_id = ${bought.purchase.membershipId}`;
    expect(sig).toEqual({ signed_name: "Tara Singh", signed_via: "app" });
    expect(copies).toEqual([{ to: tara.email, signedName: "Tara Singh" }]);
    const ticks = await sql<{ entry_id: string; words: string; screen: string; brand: string; last4: string }[]>`
      SELECT entry_id, words, screen, brand, last4 FROM gym_card_agreements WHERE held_membership_id = ${bought.purchase.membershipId}`;
    expect(ticks).toEqual([{ entry_id: tara.entryId, words: shown.charge, screen: "app", brand: "VISA", last4: "1111" }]);
    // The purchase keeps neither the tick nor a name once it is given.
    const [row] = await sql<{ bought: { charge: unknown; sign: unknown } }[]>`SELECT bought FROM gym_app_payments WHERE id = ${bought.purchase.id}`;
    expect(row?.bought.charge).toBeNull();
    expect(row?.bought.sign).toBeNull();

    // The same press again, the phone asking, the worker's minute: still one charge, one membership, one payment, one copy.
    expect(parsed(await buyPress(gymA, tara.app, shown, { requestKey: key })).purchase.id).toBe(bought.purchase.id);
    await check(gymA, tara.app, bought.purchase.id);
    await work();
    expect(takenAt(gymA)).toHaveLength(1);
    expect((await held(gymA, tara.entryId)).memberships).toHaveLength(1);
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
    expect(copies).toHaveLength(1);
    // Buying it again, or another repeating line while it renews, is refused before anything is charged: two would bill at once.
    const again = await buyPress(gymA, tara.app, await lineOf(gymA, tara.app, gold));
    expect(errorOf(again)).toBe("already_held");
    const other = await buyPress(gymA, tara.app, await lineOf(gymA, tara.app, silver));
    expect(other.statusCode, other.body).toBe(409);
    expect(errorOf(other)).toBe("app_purchase_renewing_held");
    expect(messageOf(other)).toBe("You already have Gold Monthly, which renews. To change it, ask the front desk.");
    // Nobody else's card was ever charged, and nobody else was given anything.
    expect(square.charged.map((p) => p.cardId)).toEqual([taraCard.cardId]);
    expect(square.charged.some((p) => p.cardId === priyaCard.cardId)).toBe(false);
    for (const other of [sam, priya, leo]) expect((await held(gymA, other.entryId)).memberships).toEqual([]);
  });

  it("a declined card takes nothing and gives nothing; a card that pays then buys it", async () => {
    clock = new Date();
    const gym = await makeGym("Card Buy Declined");
    const gold = await addType(gym, { name: "Gold Monthly" });
    const tara = await member(gym, "Tara Singh");
    await cardFor(gym, tara.entryId, "insufficient");
    const shown = await lineOf(gym, tara.app, gold);
    const res = await buyPress(gym, tara.app, shown);
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res)).toBe("app_purchase_declined");
    expect(messageOf(res)).toBe("Visa ending 1111 was declined, so nothing was charged. Update your card or try again later.");
    expect(takenAt(gym).filter((p) => p.status === "COMPLETED")).toHaveLength(0);
    expect((await held(gym, tara.entryId)).memberships).toEqual([]);
    expect((await held(gym, tara.entryId)).appBuying).toBeNull();
    // She updates her card: the tick names the new card's digits, and it buys.
    await cardFor(gym, tara.entryId, "pays");
    const now = await lineOf(gym, tara.app, gold);
    expect(parsed(await buyPress(gym, tara.app, now)).purchase.state).toBe("paid");
    expect(takenAt(gym).filter((p) => p.status === "COMPLETED")).toHaveLength(1);
  });

  it("Square not answering: nothing given yet, staff told, then given once when Square gives back the same payment", async () => {
    clock = new Date();
    const gym = await makeGym("Card Buy No Answer");
    const gold = await addType(gym, { name: "Gold Monthly" });
    const tara = await member(gym, "Tara Singh");
    await cardFor(gym, tara.entryId);
    const shown = await lineOf(gym, tara.app, gold);
    // Square takes the money, and its answer is lost on the way.
    square.state.loseAnswers = true;
    const open = parsed(await buyPress(gym, tara.app, shown));
    square.state.loseAnswers = false;
    expect(open.purchase).toMatchObject({ state: "open", url: null, membershipId: null });
    expect((await held(gym, tara.entryId)).memberships).toEqual([]);
    // Staff read it on her page, with nothing to close; Close payment page is refused.
    const page = await held(gym, tara.entryId);
    expect(page.appBuying).toMatchObject({ id: open.purchase.id, typeName: "Gold Monthly", card: { brand: "VISA", last4: "1111" } });
    const close = await send("POST", `${entryUrl(gym, tara.entryId)}/app-purchases/${open.purchase.id}/close`, gym.owner.cookies);
    expect(close.statusCode, close.body).toBe(404);
    // Another press meanwhile gets back the same purchase, and charges nothing more.
    expect(parsed(await buyPress(gym, tara.app, shown)).purchase.id).toBe(open.purchase.id);
    expect(takenAt(gym)).toHaveLength(1);
    // Leaving changes nothing at Square; her phone asking again gets back the same payment: given once.
    const left = parsed(await send("POST", `${buyUrl(gym)}/${open.purchase.id}/close`, tara.app.cookies));
    expect(left.purchase.state).toBe("paid");
    await work();
    expect(takenAt(gym).filter((p) => p.status === "COMPLETED")).toHaveLength(1);
    expect((await held(gym, tara.entryId)).memberships.map((m) => m.typeName)).toEqual(["Gold Monthly"]);
    expect(await paymentsOf(gym.id)).toHaveLength(1);

    // Square down for a day for Leo: the worker asks with the same key, and after a day staff are told to check Square.
    const leo = await member(gym, "Leo Down");
    await cardFor(gym, leo.entryId);
    square.state.down = true;
    const waiting = parsed(await buyPress(gym, leo.app, await lineOf(gym, leo.app, gold)));
    expect(waiting.purchase.state).toBe("open");
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    await work();
    square.state.down = false;
    expect((await check(gym, leo.app, waiting.purchase.id)).purchase.state).toBe("check");
    expect((await held(gym, leo.entryId)).appBuyChecks).toMatchObject([{ id: waiting.purchase.id, typeName: "Gold Monthly", why: "unknown" }]);
    expect((await held(gym, leo.entryId)).memberships).toEqual([]);
  });

  it("Square taking another amount gives nothing and tells staff what it took", async () => {
    clock = new Date();
    const gym = await makeGym("Card Buy Other Amount");
    const gold = await addType(gym, { name: "Gold Monthly" });
    const tara = await member(gym, "Tara Singh");
    await cardFor(gym, tara.entryId);
    square.state.chargeOther = true;
    const res = parsed(await buyPress(gym, tara.app, await lineOf(gym, tara.app, gold)));
    square.state.chargeOther = false;
    expect(res.purchase.state).toBe("check");
    expect((await held(gym, tara.entryId)).memberships).toEqual([]);
    expect((await held(gym, tara.entryId)).appBuyChecks).toMatchObject([{ why: "taken", amountMinor: 5099 }]);
  });

  it("refused before anything is charged: an expired card, paused payments, a member not on the list, a changed price, a tick on a line paid once", async () => {
    clock = new Date();
    const gym = await makeGym("Card Buy Refusals");
    const gold = await addType(gym, { name: "Gold Monthly" });
    const pack = await addType(gym, { name: "10-class pack", kind: "pack", priceMinor: 9000, termCount: null, termUnit: null, packClasses: 10, packDays: 60 });
    const before = square.charged.length;

    const old = await member(gym, "Olive Old Card");
    await cardFor(gym, old.entryId, "pays", { month: 1, year: 2020 });
    expect((await forSale(gym, old.app)).card).toEqual({ brand: "VISA", last4: "1111", expired: true });
    const oldLine = await lineOf(gym, old.app, gold);
    expect(oldLine.charge).toBeNull();
    expect(errorOf(await buyPress(gym, old.app, oldLine, { charge: { words: "I agree.", verificationToken: null } }))).toBe("app_purchase_card_expired");

    const paused = await member(gym, "Paul Paused");
    await cardFor(gym, paused.entryId);
    await sql`INSERT INTO gym_autopay_pauses (gym_id, entry_id, paused_at, paused_by) VALUES (${gym.id}, ${paused.entryId}, now(), ${gym.owner.userId})`;
    expect(errorOf(await buyPress(gym, paused.app, await lineOf(gym, paused.app, gold)))).toBe("app_purchase_card_paused");

    // A member not on the list yet has no card here: told to ask the front desk.
    const noRecord = await signedIn("Nora No Record");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${noRecord.userId}, NULL)`;
    const noRecordLine = (await forSale(gym, noRecord)).items.find((i) => i.typeId === gold);
    expect(noRecordLine?.charge ?? null).toBeNull();
    if (noRecordLine !== undefined) expect(errorOf(await buyPress(gym, noRecord, noRecordLine, { charge: { words: "I agree.", verificationToken: null } }))).toBe("app_purchase_card_no_record");

    // The price changed while Tara read it: refused, nothing charged.
    const tara = await member(gym, "Tara Singh");
    await cardFor(gym, tara.entryId);
    const read = await lineOf(gym, tara.app, gold);
    expect((await typeChange(gym, gold, { priceMinor: 5999 })).statusCode).toBe(200);
    expect(errorOf(await buyPress(gym, tara.app, read))).toBe("app_payment_changed");
    // A tick sent with a line paid once is not what was shown.
    const packLine = await lineOf(gym, tara.app, pack);
    expect(packLine.charge).toBeNull();
    expect(errorOf(await buyPress(gym, tara.app, packLine, { charge: { words: "I agree.", verificationToken: null } }))).toBe("app_payment_changed");
    expect(square.charged.length).toBe(before);
  });

  it("two presses at the same instant charge the card once", async () => {
    clock = new Date();
    const gym = await makeGym("Card Buy Race");
    const gold = await addType(gym, { name: "Gold Monthly" });
    const tara = await member(gym, "Tara Singh");
    const card = await cardFor(gym, tara.entryId);
    const shown = await lineOf(gym, tara.app, gold);
    const [a, b] = await Promise.all([buyPress(gym, tara.app, shown), buyPress(gym, tara.app, shown)]);
    // Each press is answered with the one purchase, or told what stands in the way; never a second charge.
    const ids = [a, b].filter((r) => r.statusCode === 200).map((r) => appPurchaseResponseSchema.parse(JSON.parse(r.body)).purchase.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    for (const r of [a, b].filter((x) => x.statusCode !== 200)) expect(["app_purchase_charging", "app_purchase_renewing_held"]).toContain(errorOf(r));
    expect(square.charged.filter((p) => p.cardId === card.cardId)).toHaveLength(1);
    expect((await held(gym, tara.entryId)).memberships).toHaveLength(1);
  });
});
