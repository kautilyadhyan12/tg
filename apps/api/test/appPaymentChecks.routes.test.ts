// Overview's App payments to review (ROADMAP 18k-vi), through its route against real Postgres (DATABASE_URL-gated),
// with Square answered by the fake in `fakeSquareTerminal.ts`. Every page is ended the way a real one ends: Square taking
// another amount, Square never answering for a day, a price changed under a purchase.
//
// The first test is the worst thing this job could do to a real person: a member whose money Square took left off the list,
// so nobody gives them what they paid for; or another gym's member on it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  appPaymentChecksResponseSchema,
  appPaymentResponseSchema,
  appPurchaseResponseSchema,
  forSaleResponseSchema,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type AppPaymentCheckRow,
  type AppPaymentResponse,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { createMemoryRedis } from "../src/redis.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { openDueFreezeFees } from "../src/modules/orgs/memberships/freezeFees.js";
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
const LOCK_KEY = Buffer.alloc(32, 5).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-APPCHECKSAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "app-checks-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-APPCHECKSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 240_000;
const LIVE_PLAN = "zz_app_checks";

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
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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
const pack = { ...gold, name: "5-class pack", kind: "pack", priceMinor: 5000, termCount: null, termUnit: null, packClasses: 5, packDays: 60, soldInApp: true };
const TIP = { tip_money: { amount: 500, currency: "USD" }, total_money: { amount: 5499, currency: "USD" } };

d("App payments to review on Overview: every one the person's page says, and only this gym's (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  const square = fakeSquare();
  const hub = recordingHub();
  const redis = createMemoryRedis();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });

  const MINE = "achk-t-%@example.com";
  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM gym_app_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
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

  const send = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const signedIn = async (name: string): Promise<Person> => {
    const email = `achk-t-${uniq()}@example.com`;
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
    const acct = account(`ACK${uniq().slice(-7)}`);
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    return { id, name, owner, acct };
  };
  const addType = async (gym: Gym, body: Record<string, unknown>): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `achk-r-${uniq()}@gmail.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  /** On the list holding Gold Monthly, its first month owed, and in the gym's app on that record. */
  const member = async (gym: Gym, typeId: string, fullName: string): Promise<{ holder: Holder; app: Person }> => {
    const entryId = await record(gym, fullName);
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: (await held(gym, entryId)).today, paid: false });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    const app = await signedIn(fullName);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${app.userId}, ${entryId})`;
    return { holder: { entryId, membershipId: m.id }, app };
  };
  const payUrl = (gym: Gym) => `/v1/orgs/${gym.id}/my-membership/payments`;
  const parsed = (res: { statusCode: number; body: string }): AppPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return appPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const pay = async (gym: Gym, by: Person, who: Holder, over: Record<string, unknown> = {}) =>
    parsed(await send("POST", payUrl(gym), by.cookies, { requestKey: randomUUID(), membershipId: who.membershipId, periodIndex: 0, amountMinor: 4999, ...over }));
  const checkPay = async (gym: Gym, by: Person, id: string) => parsed(await send("GET", `${payUrl(gym)}/${id}`, by.cookies));
  const linkOf = (id: string) => [...square.links.values()].find((l) => l.referenceId === id);
  const byHand = (gym: Gym, who: Holder) =>
    send("POST", `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
  const work = async (gym: Gym) => processSquareWork(workDeps(), [], [gym.id]);

  const checksRes = (gym: Gym, by: Person) => send("GET", `/v1/orgs/${gym.id}/app-payment-checks`, by.cookies);
  const checks = async (gym: Gym, by: Person = gym.owner) => {
    const res = await checksRes(gym, by);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    return appPaymentChecksResponseSchema.parse(JSON.parse(res.body));
  };
  /** What each person's own page says is to check, as the card's rows say it. */
  const pageSays = async (gym: Gym, entryIds: readonly string[]): Promise<Omit<AppPaymentCheckRow, "name" | "past">[]> => {
    const out: Omit<AppPaymentCheckRow, "name" | "past">[] = [];
    for (const entryId of entryIds) {
      const page = await held(gym, entryId);
      for (const m of page.memberships) {
        const c = m.billing?.appCheck ?? null;
        if (c !== null) out.push({ id: `bill:${m.id}`, entryId, kind: "bill", typeName: m.typeName, fee: null, ...c, currency: m.currency });
        for (const f of m.billing?.fees ?? []) {
          if (f.appCheck !== null) out.push({ id: `fee:${f.id}`, entryId, kind: "fee", typeName: m.typeName, fee: f.fee, ...f.appCheck, currency: m.currency });
        }
      }
      for (const c of page.appBuyChecks) out.push({ ...c, id: `purchase:${c.id}`, entryId, kind: "purchase", fee: null });
    }
    return out;
  };
  const bare = (rows: readonly AppPaymentCheckRow[]): Omit<AppPaymentCheckRow, "name" | "past">[] =>
    rows.map((r) => ({ id: r.id, entryId: r.entryId, kind: r.kind, typeName: r.typeName, fee: r.fee, why: r.why, amountMinor: r.amountMinor, currency: r.currency, on: r.on, payerName: r.payerName }));
  const byId = <R extends { id: string }>(rows: readonly R[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));

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

  it("the worst thing: every payment a person's page says to check is on the list, nothing else is, and never another gym's", async () => {
    clock = new Date();
    clock.setUTCHours(18, 0, 0, 0);
    const gymA = await makeGym("App Checks A");
    const gymB = await makeGym("App Checks B");
    const goldA = await addType(gymA, gold);
    const goldB = await addType(gymB, gold);
    const packA = await addType(gymA, pack);
    const setFee = await send("PUT", `/v1/orgs/${gymA.id}/bill-settings`, gymA.owner.cookies, { overdueAfterDays: 0, freezeFeeMinor: 1500 });
    expect(setFee.statusCode, setFee.body).toBe(200);

    // Nothing ended needing a check yet: an empty list.
    expect(await checks(gymA)).toEqual({ rows: [], more: false });

    // Tara: Square took $54.99 for her $49.99 bill, so it could not go on it.
    const tara = await member(gymA, goldA, "Tara Singh");
    const taraPage = await pay(gymA, tara.app, tara.holder);
    square.payLink(linkOf(taraPage.payment.id)?.id ?? "", TIP);
    expect((await checkPay(gymA, tara.app, taraPage.payment.id)).payment.state).toBe("check");

    // Pia: Square never finished her payment, and a day on the page was given up on.
    const pia = await member(gymA, goldA, "Pia Moss");
    const piaPage = await pay(gymA, pia.app, pia.holder);
    square.payLink(linkOf(piaPage.payment.id)?.id ?? "", { status: "APPROVED" });
    clock = new Date(clock.getTime() + APP_PAYMENT.giveUpMs + 60_000);
    await work(gymA);
    expect((await checkPay(gymA, pia.app, piaPage.payment.id)).payment.state).toBe("check");

    // Mia: her freeze fee, paid with a tip on top.
    clock = new Date();
    clock.setUTCHours(18, 0, 0, 0);
    const mia = await member(gymA, goldA, "Mia Frost");
    expect((await byHand(gymA, mia.holder)).statusCode).toBe(200);
    const frozen = await send("POST", `${entryUrl(gymA, mia.holder.entryId)}/memberships/${mia.holder.membershipId}/freeze`, gymA.owner.cookies, { feeMinor: 1500 });
    expect(frozen.statusCode, frozen.body).toBe(200);
    await openDueFreezeFees({ sql, log: quiet }, { now: clock, gymIds: [gymA.id] });
    const miaFee = (await held(gymA, mia.holder.entryId)).memberships[0]?.billing?.fees.find((f) => f.fee === "freeze");
    expect(miaFee).toMatchObject({ amountMinor: 1500, state: "due" });
    const miaPage = await pay(gymA, mia.app, mia.holder, { periodIndex: undefined, feeId: miaFee?.id, amountMinor: 1500 });
    square.payLink(linkOf(miaPage.payment.id)?.id ?? "", { tip_money: { amount: 200, currency: "USD" }, total_money: { amount: 1700, currency: "USD" } });
    expect((await checkPay(gymA, mia.app, miaPage.payment.id)).payment.state).toBe("check");

    // Ana: the pack's price changed under her purchase, so Square took $50.00 and nothing could be given.
    const anaEntry = await record(gymA, "Ana Ruiz");
    const anaApp = await signedIn("Ana Ruiz");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gymA.id}, ${anaApp.userId}, ${anaEntry})`;
    const sale = forSaleResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymA.id}/for-sale`, anaApp.cookies)).body));
    const shown = sale.items.find((i) => i.typeId === packA);
    if (shown === undefined) throw new Error("the pack is not for sale");
    const bought = await send("POST", `/v1/orgs/${gymA.id}/for-sale/purchases`, anaApp.cookies, {
      requestKey: randomUUID(),
      typeId: shown.typeId,
      amountMinor: shown.firstPayment.amountMinor,
      factsKey: shown.factsKey,
      agreement: null,
    });
    expect(bought.statusCode, bought.body).toBe(200);
    const anaBuy = appPurchaseResponseSchema.parse(JSON.parse(bought.body)).purchase;
    await sql`UPDATE gym_membership_types SET price_minor = 5500 WHERE gym_id = ${gymA.id} AND id = ${packA}`;
    square.payLink(linkOf(anaBuy.id)?.id ?? "");
    const anaChecked = await send("GET", `/v1/orgs/${gymA.id}/for-sale/purchases/${anaBuy.id}`, anaApp.cookies);
    expect(appPurchaseResponseSchema.parse(JSON.parse(anaChecked.body)).purchase.state).toBe("check");

    // Sam paid his in the app, and Leo closed his page: nothing to check for either.
    const sam = await member(gymA, goldA, "Sam Lee");
    const samPage = await pay(gymA, sam.app, sam.holder);
    square.payLink(linkOf(samPage.payment.id)?.id ?? "");
    expect((await checkPay(gymA, sam.app, samPage.payment.id)).payment.state).toBe("paid");
    const leo = await member(gymA, goldA, "Leo Park");
    const leoPage = await pay(gymA, leo.app, leo.holder);
    expect(parsed(await send("POST", `${payUrl(gymA)}/${leoPage.payment.id}/close`, leo.app.cookies)).payment.state).toBe("closed");

    // Bea, at the other gym, also has one.
    const bea = await member(gymB, goldB, "Bea Brown");
    const beaPage = await pay(gymB, bea.app, bea.holder);
    square.payLink(linkOf(beaPage.payment.id)?.id ?? "", TIP);
    expect((await checkPay(gymB, bea.app, beaPage.payment.id)).payment.state).toBe("check");

    // The list is exactly what each page says, for every person at the gym: Tara, Pia, Mia and Ana, and not Sam or Leo.
    const everyoneA = [tara.holder.entryId, pia.holder.entryId, mia.holder.entryId, anaEntry, sam.holder.entryId, leo.holder.entryId];
    const listA = await checks(gymA);
    const saysA = await pageSays(gymA, everyoneA);
    expect(saysA).toHaveLength(4);
    expect(byId(bare(listA.rows))).toEqual(byId(saysA));
    expect(listA.more).toBe(false);
    const named = Object.fromEntries(listA.rows.map((r) => [r.name, r]));
    expect(Object.keys(named).sort()).toEqual(["Ana Ruiz", "Mia Frost", "Pia Moss", "Tara Singh"]);
    expect(named["Tara Singh"]).toMatchObject({ kind: "bill", typeName: "Gold Monthly", why: "taken", amountMinor: 5499, currency: "USD", payerName: "Tara Singh", past: false });
    expect(named["Pia Moss"]).toMatchObject({ kind: "bill", why: "unknown", amountMinor: null, payerName: "Pia Moss" });
    expect(named["Mia Frost"]).toMatchObject({ kind: "fee", fee: "freeze", typeName: "Gold Monthly", why: "taken", amountMinor: 1700 });
    expect(named["Ana Ruiz"]).toMatchObject({ kind: "purchase", typeName: "5-class pack", why: "taken", amountMinor: 5000, entryId: anaEntry });
    // The newest day first: Pia's page was given up on a day after it opened; the others ended at one moment of the test's clock.
    expect(listA.rows[0]?.name).toBe("Pia Moss");
    expect(listA.rows.map((r) => r.on)).toEqual([...listA.rows.map((r) => r.on)].sort().reverse());

    // B reads only Bea; A's never shows her, and B's never shows A's people.
    const listB = await checks(gymB);
    expect(listB.rows.map((r) => r.name)).toEqual(["Bea Brown"]);
    expect(byId(bare(listB.rows))).toEqual(byId(await pageSays(gymB, [bea.holder.entryId])));
    expect(listA.rows.some((r) => r.entryId === bea.holder.entryId)).toBe(false);

    // Each goes as it goes from the page: Tara's bill taken at the desk, Mia's fee paid there, Ana's marked as checked.
    expect((await byHand(gymA, tara.holder)).statusCode).toBe(200);
    const miaCash = await send("POST", `${entryUrl(gymA, mia.holder.entryId)}/memberships/${mia.holder.membershipId}/fees/${miaFee?.id ?? ""}/payments`, gymA.owner.cookies, {
      requestKey: randomUUID(),
      amountMinor: 1500,
      method: "cash",
    });
    expect(miaCash.statusCode, miaCash.body).toBe(200);
    const marked = await send("POST", `${entryUrl(gymA, anaEntry)}/app-purchases/${anaBuy.id}/checked`, gymA.owner.cookies);
    expect(marked.statusCode, marked.body).toBe(200);
    const after = await checks(gymA);
    expect(after.rows.map((r) => r.name)).toEqual(["Pia Moss"]);
    expect(byId(bare(after.rows))).toEqual(byId(await pageSays(gymA, everyoneA)));

    // Tara's next month is owed now: her old page's check is not said again on it, here or on her page.
    clock = new Date(clock.getTime() + 40 * 24 * 60 * 60_000);
    expect((await held(gymA, tara.holder.entryId)).memberships[0]?.billing?.appCheck).toBeNull();
    expect((await checks(gymA)).rows.some((r) => r.entryId === tara.holder.entryId)).toBe(false);

    // Pia comes off the list: a past member's bill is still to check, as their page says, and the row says they are past.
    await sql`UPDATE gym_member_list_entries SET former_at = ${clock} WHERE gym_id = ${gymA.id} AND id = ${pia.holder.entryId}`;
    const pastRows = (await checks(gymA)).rows;
    expect(byId(bare(pastRows))).toEqual(byId(await pageSays(gymA, everyoneA)));
    expect(pastRows.map((r) => [r.name, r.past])).toEqual([["Pia Moss", true]]);
  });

  it("a bill's check is said while that bill is the one owed now, as on the page: not while an earlier month is owed again", async () => {
    clock = new Date();
    clock.setUTCHours(18, 0, 0, 0);
    const gym = await makeGym("App Checks Owed");
    const goldId = await addType(gym, gold);
    const uma = await member(gym, goldId, "Uma Shah");
    // Her first month paid at the desk; her membership moved a month back, so her second month's bill is owed today.
    const cash = await byHand(gym, uma.holder);
    expect(cash.statusCode, cash.body).toBe(200);
    await sql`UPDATE gym_held_memberships SET starts_on = (starts_on - interval '1 month')::date WHERE gym_id = ${gym.id} AND id = ${uma.holder.membershipId}`;
    await sql`UPDATE gym_member_bills SET due_on = (due_on - interval '1 month')::date, covers_from = (covers_from - interval '1 month')::date, covers_to = (covers_to - interval '1 month')::date WHERE gym_id = ${gym.id} AND held_membership_id = ${uma.holder.membershipId}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    // She pays the second month in the app, and Square takes another amount.
    const second = await pay(gym, uma.app, uma.holder, { periodIndex: 1 });
    square.payLink(linkOf(second.payment.id)?.id ?? "", TIP);
    expect((await checkPay(gym, uma.app, second.payment.id)).payment.state).toBe("check");
    const owedSecond = await checks(gym);
    expect(owedSecond.rows.map((r) => [r.name, r.kind])).toEqual([["Uma Shah", "bill"]]);
    expect(byId(bare(owedSecond.rows))).toEqual(byId(await pageSays(gym, [uma.holder.entryId])));

    // Staff void the first month's cash payment: the first month is owed again, and the page says nothing of the second's
    // check until it is paid. Neither does the list.
    const page = await held(gym, uma.holder.entryId);
    const firstPayment = page.memberships[0]?.billing?.bills.find((b) => b.periodIndex === 0)?.payments[0]?.id ?? "";
    const voided = await send("POST", `${entryUrl(gym, uma.holder.entryId)}/memberships/${uma.holder.membershipId}/payments/${firstPayment}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((await held(gym, uma.holder.entryId)).memberships[0]?.billing?.pay?.periodIndex).toBe(0);
    expect(await pageSays(gym, [uma.holder.entryId])).toEqual([]);
    expect((await checks(gym)).rows).toEqual([]);

    // The first month paid again: the second is owed, and its check is back on both.
    expect((await byHand(gym, uma.holder)).statusCode).toBe(200);
    const back = await checks(gym);
    expect(back.rows.map((r) => r.name)).toEqual(["Uma Shah"]);
    expect(byId(bare(back.rows))).toEqual(byId(await pageSays(gym, [uma.holder.entryId])));
  });

  it("only staff who take payments and keep the member list read it; a member, a stranger and another gym get nothing", async () => {
    clock = new Date();
    const gym = await makeGym("App Checks Who");
    const other = await makeGym("App Checks Other");
    const goldId = await addType(gym, gold);
    const kim = await member(gym, goldId, "Kim Vale");
    const page = await pay(gym, kim.app, kim.holder);
    square.payLink(linkOf(page.payment.id)?.id ?? "", TIP);
    expect((await checkPay(gym, kim.app, page.payment.id)).payment.state).toBe("check");

    const manager = await signedIn("Mo Manager");
    const trainer = await signedIn("Tia Trainer");
    const desk = await signedIn("Dee Desk");
    const stranger = await signedIn("A Stranger");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${manager.userId}, 'manager', ${[...ROLE_PRIVILEGES.manager]})`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
    // Takes payments, but does not keep the member list: the page the rows open is not theirs to open.
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'manager', ${["billing.members"]})`;

    expect((await checks(gym)).rows.map((r) => r.name)).toEqual(["Kim Vale"]);
    expect((await checks(gym, manager)).rows.map((r) => r.name)).toEqual(["Kim Vale"]);
    for (const [who, status] of [
      [trainer, 403],
      [desk, 403],
      [kim.app, 404],
      [stranger, 404],
      [other.owner, 404],
    ] as const) {
      const res = await checksRes(gym, who);
      expect(res.statusCode, res.body).toBe(status);
      expect(res.body).not.toContain("Kim Vale");
    }
    expect((await checks(other)).rows).toEqual([]);
    // Signed out, and a gym that is not an id.
    expect((await send("GET", `/v1/orgs/${gym.id}/app-payment-checks`, {})).statusCode).toBe(401);
    expect((await send("GET", "/v1/orgs/not-a-gym/app-payment-checks", gym.owner.cookies)).statusCode).toBe(400);
  });
});
