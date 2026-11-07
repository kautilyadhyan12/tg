// Buy in the app (ROADMAP 18k-iii-a; spec Part 3 §14.8), through its routes against real Postgres (DATABASE_URL-gated),
// with Square answered by the fake in `fakeSquareTerminal.ts`, whose payment pages answer as Square's test area did on
// 2026-11-06 (`apps/api/.cost/18k-ii-a/probe-links.mts`).
//
// The first block is the worst thing this job could do to a real person: take their money and give them nothing with
// nobody told, give it without their money, give it on somebody else's record, or give it twice for one press.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  appPaymentCloseResponseSchema,
  appPurchaseResponseSchema,
  forSaleResponseSchema,
  heldMembershipsResponseSchema,
  membershipAgreementResponseSchema,
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
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-APPBUYINGAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "app-buy-secret-0123456789abcdefghi", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-APPBUYINGSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_app_buy";

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
const nextIp = () => `10.57.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const line = (over: Record<string, unknown>) => ({
  description: null,
  kind: "pack",
  priceMinor: 9000,
  termCount: null,
  termUnit: null,
  packClasses: 10,
  packDays: 60,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  soldInApp: true,
  ...over,
});
const TERMS = "Classes are booked in the app. A pack is not refunded once a class is used.";

d("Buy in the app: given once, on their own record, only for what Square took (real Postgres)", { timeout: T }, () => {
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

  const MINE = "abuy-t-%@example.com";
  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`).map((r) => r.id);
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });
  const work = async () => processSquareWork(workDeps(), [], await mine());
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM gym_app_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_referral_member_gifts WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mineSql})`;
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
    const email = `abuy-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string, acct: Account): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const gym = { id, name, owner };
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    return gym;
  };
  const addType = async (gym: Gym, over: Record<string, unknown>): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, line(over));
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === over["name"]);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const agreementOn = async (gym: Gym) => {
    const res = await send("PUT", `/v1/orgs/${gym.id}/agreement`, gym.owner.cookies, { text: TERMS });
    expect(res.statusCode, res.body).toBe(200);
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** Somebody on the list, in the gym's app on their own record. */
  const member = async (gym: Gym, fullName: string, dateOfBirth: string | null = null): Promise<{ entryId: string; app: Person; email: string }> => {
    const email = `abuy-r-${uniq()}@gmail.com`;
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email, ...(dateOfBirth === null ? {} : { dateOfBirth }) });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const app = await signedIn(fullName);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${app.userId}, ${entryId})`;
    return { entryId, app, email };
  };
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const forSale = async (gym: Gym, who: Person) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/for-sale`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return forSaleResponseSchema.parse(JSON.parse(res.body));
  };
  const lineOf = async (gym: Gym, who: Person, typeId: string): Promise<ForSaleLine> => {
    const found = (await forSale(gym, who)).items.find((i) => i.typeId === typeId);
    if (found === undefined) throw new Error("the line is not listed");
    return found;
  };
  const buyUrl = (gym: Gym) => `/v1/orgs/${gym.id}/for-sale/purchases`;
  /** Buy, as the phone sends it: what the list showed, signed by the name given where the line asks for its agreement. */
  const buyPress = (gym: Gym, who: Person, shown: ForSaleLine, over: Record<string, unknown> = {}, name = "Tara Singh") =>
    send("POST", buyUrl(gym), who.cookies, {
      requestKey: randomUUID(),
      typeId: shown.typeId,
      amountMinor: shown.firstPayment.amountMinor,
      factsKey: shown.factsKey,
      agreement: shown.agreement === null ? null : { agreementId: shown.agreement.id, signer: "person", name },
      ...over,
    });
  const parsed = (res: { statusCode: number; body: string }): AppPurchaseResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return appPurchaseResponseSchema.parse(JSON.parse(res.body));
  };
  const check = async (gym: Gym, who: Person, id: string) => parsed(await send("GET", `${buyUrl(gym)}/${id}`, who.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const linkOf = (id: string) => [...square.links.values()].find((l) => l.referenceId === id);
  const typeChange = async (gym: Gym, typeId: string, over: Record<string, unknown>) => {
    const types = JSON.parse((await send("GET", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies)).body) as GymMembershipTypesResponse;
    const t = types.types.find((x) => x.id === typeId);
    if (t === undefined) throw new Error("no type");
    const notSent = new Set(["id", "currency", "archivedAt", "classTypes", "agreementId"]);
    return send("PUT", `/v1/orgs/${gym.id}/membership-types/${typeId}`, gym.owner.cookies, { ...Object.fromEntries(Object.entries(t).filter(([k]) => !notSent.has(k))), classTypeIds: null, ...over });
  };
  const paymentsOf = (gymId: string) =>
    sql<{ entry_id: string; amount_minor: number; method: string; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT h.entry_id, p.amount_minor, p.method, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${gymId} ORDER BY p.seq`;

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

  it("the worst thing: what Square took gives exactly what was shown, once, on their own record, and nothing is given without it", async () => {
    clock = new Date();
    const acctA = account(`ABWA${uniq().slice(-6)}`);
    const acctB = account(`ABWB${uniq().slice(-6)}`);
    const gymA = await makeGym("App Buy Worst A", acctA);
    const gymB = await makeGym("App Buy Worst B", acctB);
    await agreementOn(gymA);
    const packA = await addType(gymA, { name: "10-class pack" });
    const passA = await addType(gymA, { name: "Day pass", priceMinor: 1500, packClasses: 1, packDays: 1 });
    await addType(gymB, { name: "10-class pack" });
    const tara = await member(gymA, "Tara Singh");
    const sam = await member(gymA, "Sam Lee");
    const priya = await member(gymA, "Priya Sharma");
    const bea = await member(gymB, "Bea Brown");
    const stranger = await signedIn("A Stranger");
    // Priya pays for Sam (18i): Sam does not buy on his own in the app.
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by) VALUES (${gymA.id}, ${sam.entryId}, ${priya.entryId}, ${gymA.owner.userId})`;

    // The list names the line as it will be bought: the pack, its price, the agreement to sign, and who signs.
    const shown = await lineOf(gymA, tara.app, packA);
    expect(shown.firstPayment.amountMinor).toBe(9000);
    expect(shown.agreement?.text).toBe(TERMS);
    expect((await forSale(gymA, tara.app)).signer).toBe("either");

    // Nobody buys for anyone but themselves at their own gym: a stranger, B's member at A, A's owner (staff, not a member),
    // Tara at B; Sam, whom somebody else pays for.
    for (const [gym, who, status, code] of [
      [gymA, stranger, 404, "org_not_found"],
      [gymA, bea.app, 404, "org_not_found"],
      [gymA, gymA.owner, 404, "org_not_found"],
      [gymB, tara.app, 404, "org_not_found"],
      [gymA, sam.app, 409, "app_purchase_paid_by_other"],
    ] as const) {
      const res = await buyPress(gym, who, shown);
      expect(res.statusCode, res.body).toBe(status);
      expect(errorOf(res)).toBe(code);
    }
    // Only what the list showed: another amount, other details, or no signature where the line asks for one.
    for (const over of [{ amountMinor: 8999 }, { factsKey: "0".repeat(64) }, { agreement: null }]) {
      const res = await buyPress(gymA, tara.app, shown, over);
      expect(res.statusCode, res.body).toBe(409);
    }
    expect(square.links.size).toBe(0);

    // Tara presses Buy: Square's page for $90.00, and nothing is hers yet.
    const key = randomUUID();
    const press = { requestKey: key };
    const page = parsed(await buyPress(gymA, tara.app, shown, press));
    expect(page.purchase).toMatchObject({ state: "open", typeId: packA, amountMinor: 9000, membershipId: null });
    expect(linkOf(page.purchase.id)).toMatchObject({ amount: 9000, name: "10-class pack", note: "Bought in the app" });
    expect((await held(gymA, tara.entryId)).memberships).toEqual([]);
    // The same press again, or another press for the same line, is the same page; another line while it is open is
    // refused; no second page is made.
    expect(parsed(await buyPress(gymA, tara.app, shown, press)).purchase.id).toBe(page.purchase.id);
    expect(parsed(await buyPress(gymA, tara.app, shown)).purchase.id).toBe(page.purchase.id);
    const second = await buyPress(gymA, tara.app, await lineOf(gymA, tara.app, passA));
    expect(second.statusCode, second.body).toBe(409);
    expect(errorOf(second)).toBe("app_payment_other_open");
    expect(square.links.size).toBe(1);
    // Staff read it on her page, and cannot change the line under her or delete her meanwhile.
    expect((await held(gymA, tara.entryId)).appBuying).toMatchObject({ id: page.purchase.id, typeName: "10-class pack", payerName: "Tara Singh" });
    const priceChange = await typeChange(gymA, packA, { priceMinor: 9500 });
    expect(priceChange.statusCode, priceChange.body).toBe(409);
    expect(errorOf(priceChange)).toBe("type_being_bought");
    const archive = await send("DELETE", `/v1/orgs/${gymA.id}/membership-types/${packA}`, gymA.owner.cookies);
    expect(errorOf(archive)).toBe("type_being_bought");
    // Her page is not another member's to read, nor read through Pay's routes.
    expect((await send("GET", `${buyUrl(gymA)}/${page.purchase.id}`, priya.app.cookies)).statusCode).toBe(404);
    expect((await send("GET", `/v1/orgs/${gymA.id}/my-membership/payments/${page.purchase.id}`, tara.app.cookies)).statusCode).toBe(404);

    // She pays on Square's page: the pack is hers, once, its first bill paid in the app with Square's payment.
    expect(square.payLink(linkOf(page.purchase.id)?.id ?? "")).toBe(true);
    const paid = await check(gymA, tara.app, page.purchase.id);
    expect(paid.purchase.state).toBe("paid");
    const hers = await held(gymA, tara.entryId);
    expect(hers.memberships.map((m) => [m.id, m.typeName, m.kind])).toEqual([[paid.purchase.membershipId, "10-class pack", "pack"]]);
    expect(hers.appBuying).toBeNull();
    const payments = await paymentsOf(gymA.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ entry_id: tara.entryId, amount_minor: 9000, method: "app", recorded_by: null });
    expect(payments[0]?.provider_payment_id).toMatch(/^apppay/);
    // Signed in the app as she bought it, with the very details she read, which the membership given reads too.
    const agreement = membershipAgreementResponseSchema.parse(
      JSON.parse((await send("GET", `${entryUrl(gymA, tara.entryId)}/memberships/${paid.purchase.membershipId ?? ""}/agreement`, gymA.owner.cookies)).body),
    );
    expect(agreement.signed).toMatchObject({ name: "Tara Singh", signer: "person", via: "app", by: null, text: TERMS });
    expect(agreement.signed?.facts).toEqual(shown.facts);
    expect(agreement.facts).toEqual(shown.facts);
    expect(copies).toEqual([{ to: tara.email, signedName: "Tara Singh" }]);
    // Asked again, and the worker's minute: still one membership, one payment, one copy.
    await check(gymA, tara.app, page.purchase.id);
    await work();
    expect((await held(gymA, tara.entryId)).memberships).toHaveLength(1);
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
    expect(copies).toHaveLength(1);
    // Nobody else was given anything; the price list can change again.
    expect((await held(gymA, priya.entryId)).memberships).toEqual([]);
    expect((await typeChange(gymA, packA, { priceMinor: 9500 })).statusCode).toBe(200);
  });

  it("a page left, or closed by staff, gives nothing and can no longer be paid", async () => {
    clock = new Date();
    const acct = account(`ABCL${uniq().slice(-6)}`);
    const gym = await makeGym("App Buy Close", acct);
    const pass = await addType(gym, { name: "Day pass", priceMinor: 1500, packClasses: 1, packDays: 1 });
    const leo = await member(gym, "Leo Park");
    const shown = await lineOf(gym, leo.app, pass);
    expect(shown.agreement).toBeNull();
    // The member leaves the page.
    const left = parsed(await buyPress(gym, leo.app, shown));
    const closed = parsed(await send("POST", `${buyUrl(gym)}/${left.purchase.id}/close`, leo.app.cookies));
    expect(closed.purchase.state).toBe("closed");
    expect(square.payLink(linkOf(left.purchase.id)?.id ?? "")).toBe(false);
    // Staff close the next one on his page.
    const again = parsed(await buyPress(gym, leo.app, shown));
    const byStaff = await send("POST", `${entryUrl(gym, leo.entryId)}/app-purchases/${again.purchase.id}/close`, gym.owner.cookies);
    expect(byStaff.statusCode, byStaff.body).toBe(200);
    expect(appPaymentCloseResponseSchema.parse(JSON.parse(byStaff.body)).outcome).toBe("closed");
    // Fifteen minutes on, a page nobody closed is closed by the worker.
    const late = parsed(await buyPress(gym, leo.app, shown));
    clock = new Date(clock.getTime() + 16 * 60_000);
    await work();
    expect((await check(gym, leo.app, late.purchase.id)).purchase.state).toBe("closed");
    expect((await held(gym, leo.entryId)).memberships).toEqual([]);
    expect(await paymentsOf(gym.id)).toEqual([]);
  });

  it("money Square took that cannot be given exactly as shown gives nothing, is kept, and staff are told until they mark it checked", async () => {
    clock = new Date();
    const acct = account(`ABCK${uniq().slice(-6)}`);
    const gym = await makeGym("App Buy Check", acct);
    const pack = await addType(gym, { name: "5-class pack", priceMinor: 5000, packClasses: 5 });
    const ana = await member(gym, "Ana Ruiz");
    const shown = await lineOf(gym, ana.app, pack);
    // The price changes under her by a way the price list's hold does not cover.
    const page = parsed(await buyPress(gym, ana.app, shown));
    await sql`UPDATE gym_membership_types SET price_minor = 5500 WHERE gym_id = ${gym.id} AND id = ${pack}`;
    square.payLink(linkOf(page.purchase.id)?.id ?? "");
    expect((await check(gym, ana.app, page.purchase.id)).purchase).toMatchObject({ state: "check", membershipId: null });
    const read = await held(gym, ana.entryId);
    expect(read.memberships).toEqual([]);
    expect(read.appBuyChecks).toMatchObject([{ id: page.purchase.id, typeName: "5-class pack", why: "taken", amountMinor: 5000, payerName: "Ana Ruiz" }]);
    // She cannot buy it again until the front desk has checked it.
    await sql`UPDATE gym_membership_types SET price_minor = 5000 WHERE gym_id = ${gym.id} AND id = ${pack}`;
    const again = await buyPress(gym, ana.app, await lineOf(gym, ana.app, pack));
    expect(errorOf(again)).toBe("app_payment_check");
    const checked = await send("POST", `${entryUrl(gym, ana.entryId)}/app-purchases/${page.purchase.id}/checked`, gym.owner.cookies);
    expect(checked.statusCode, checked.body).toBe(200);
    expect((await held(gym, ana.entryId)).appBuyChecks).toEqual([]);
    expect((await send("POST", `${entryUrl(gym, ana.entryId)}/app-purchases/${page.purchase.id}/checked`, gym.owner.cookies)).statusCode).toBe(404);

    // Square taking another amount than asked gives nothing either.
    const next = parsed(await buyPress(gym, ana.app, await lineOf(gym, ana.app, pack)));
    square.payLink(linkOf(next.purchase.id)?.id ?? "", { amount_money: { amount: 4000, currency: "USD" }, total_money: { amount: 4000, currency: "USD" } });
    expect((await check(gym, ana.app, next.purchase.id)).purchase.state).toBe("check");
    expect((await held(gym, ana.entryId)).memberships).toEqual([]);
    expect(await paymentsOf(gym.id)).toEqual([]);
    // Another gym's staff never read or clear it.
    const other = await makeGym("App Buy Check Other", account(`ABCO${uniq().slice(-6)}`));
    expect((await send("POST", `${entryUrl(gym, ana.entryId)}/app-purchases/${next.purchase.id}/checked`, other.owner.cookies)).statusCode).toBe(404);
  });

  it("a member's own Refer a friend gift comes off as at the desk, and a child's agreement is signed by a parent or guardian", async () => {
    clock = new Date();
    const acct = account(`ABGF${uniq().slice(-6)}`);
    const gym = await makeGym("App Buy Gift", acct);
    await agreementOn(gym);
    const pack = await addType(gym, { name: "10-class pack" });
    const once = await addType(gym, { name: "Summer month", kind: "one_time", priceMinor: 6000, termCount: 1, termUnit: "month", packClasses: null, packDays: null });
    const mia = await member(gym, "Mia Chen");
    const today = (await held(gym, mia.entryId)).today;
    await sql`
      INSERT INTO gym_referral_member_gifts (gym_id, member_user_id, kind, amount_minor, currency, given_at, given_on)
      VALUES (${gym.id}, ${mia.app.userId}, 'amount', 1000, 'USD', ${clock}, ${today})`;
    const shown = await lineOf(gym, mia.app, pack);
    expect(shown.firstPayment).toMatchObject({ amountMinor: 8000, memberGiftOffMinor: 1000 });
    const page = parsed(await buyPress(gym, mia.app, shown, {}, "Mia Chen"));
    square.payLink(linkOf(page.purchase.id)?.id ?? "");
    expect((await check(gym, mia.app, page.purchase.id)).purchase.state).toBe("paid");
    expect((await paymentsOf(gym.id)).map((p) => p.amount_minor)).toEqual([8000]);
    const [gift] = await sql<{ used_off_minor: number | null }[]>`SELECT used_off_minor FROM gym_referral_member_gifts WHERE gym_id = ${gym.id}`;
    expect(gift?.used_off_minor).toBe(1000);
    // The gift is used: the next line reads its full price.
    expect((await lineOf(gym, mia.app, pack)).firstPayment.amountMinor).toBe(9000);
    // A one-time membership she already holds over the same days is refused before she pays.
    const summer = parsed(await buyPress(gym, mia.app, await lineOf(gym, mia.app, once), {}, "Mia Chen"));
    square.payLink(linkOf(summer.purchase.id)?.id ?? "");
    expect((await check(gym, mia.app, summer.purchase.id)).purchase.state).toBe("paid");
    const twice = await buyPress(gym, mia.app, await lineOf(gym, mia.app, once), {}, "Mia Chen");
    expect(errorOf(twice)).toBe("already_held");

    // Under 18 by the record: she cannot sign for herself; a parent or guardian can.
    const kid = await member(gym, "Kai Chen", "2014-03-01");
    expect((await forSale(gym, kid.app)).signer).toBe("guardian");
    const kidLine = await lineOf(gym, kid.app, pack);
    const alone = await buyPress(gym, kid.app, kidLine, {}, "Kai Chen");
    expect(errorOf(alone)).toBe("guardian_needed");
    const withParent = parsed(await buyPress(gym, kid.app, kidLine, { agreement: { agreementId: kidLine.agreement?.id, signer: "guardian", name: "Lin Chen" } }));
    square.payLink(linkOf(withParent.purchase.id)?.id ?? "");
    const kidPaid = await check(gym, kid.app, withParent.purchase.id);
    const signed = membershipAgreementResponseSchema.parse(
      JSON.parse((await send("GET", `${entryUrl(gym, kid.entryId)}/memberships/${kidPaid.purchase.membershipId ?? ""}/agreement`, gym.owner.cookies)).body),
    ).signed;
    expect(signed).toMatchObject({ name: "Lin Chen", signer: "guardian", via: "app" });
    // The page keeps no signer's name once it is written with the membership.
    const [kept] = await sql<{ sign: unknown }[]>`SELECT bought->'sign' AS sign FROM gym_app_payments WHERE id = ${withParent.purchase.id}`;
    expect(kept?.sign).toBeNull();
  });

  it("round one: a day pass is never paid once it is over; who may buy is asked under the lock; deleting waits; a second signature is never swapped", async () => {
    // 23:42 in Chicago (05:42 UTC): a day pass's page closes at 23:55, before its day ends, never 15 minutes on at 23:57.
    clock = new Date("2026-11-11T05:42:00Z");
    const acct = account(`ABR1${uniq().slice(-6)}`);
    const gym = await makeGym("App Buy Round One", acct);
    await agreementOn(gym);
    const pass = await addType(gym, { name: "Day pass", priceMinor: 1500, packClasses: 1, packDays: 1 });
    const pack = await addType(gym, { name: "10-class pack" });
    const di = await member(gym, "Di Day");
    const late = parsed(await buyPress(gym, di.app, await lineOf(gym, di.app, pass), {}, "Di Day"));
    expect(late.purchase.closesAt).toBe("2026-11-11T05:55:00.000Z");
    // At 23:56 the worker has closed it: Square's page can no longer be paid, and nothing is given.
    clock = new Date("2026-11-11T05:56:00Z");
    await work();
    expect((await check(gym, di.app, late.purchase.id)).purchase.state).toBe("closed");
    expect(square.payLink(linkOf(late.purchase.id)?.id ?? "")).toBe(false);
    // From 23:50 a day pass is not bought at all; a 60-day pack still is.
    clock = new Date("2026-11-11T05:52:00Z");
    const tooLate = await buyPress(gym, di.app, await lineOf(gym, di.app, pass), {}, "Di Day");
    expect(errorOf(tooLate)).toBe("app_purchase_too_late");
    const packPage = parsed(await buyPress(gym, di.app, await lineOf(gym, di.app, pack), {}, "Di Day"));
    expect(packPage.purchase.closesAt).toBe("2026-11-11T06:07:00.000Z");
    // A second press on the open page signed with another name is not given the first signature.
    const otherName = await buyPress(gym, di.app, await lineOf(gym, di.app, pack), {}, "Someone Else");
    expect(errorOf(otherName)).toBe("app_payment_other_open");
    // Staff of this gym on another record's page neither close nor check it.
    const eve = await member(gym, "Eve Other");
    expect((await send("POST", `${entryUrl(gym, eve.entryId)}/app-purchases/${packPage.purchase.id}/close`, gym.owner.cookies)).statusCode).toBe(404);
    expect((await send("POST", `${entryUrl(gym, eve.entryId)}/app-purchases/${packPage.purchase.id}/checked`, gym.owner.cookies)).statusCode).toBe(404);
    // Delete permanently waits while her page is open.
    await sql`UPDATE gym_member_list_entries SET former_at = ${clock} WHERE gym_id = ${gym.id} AND id = ${di.entryId}`;
    const whileOpen = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${di.entryId}`, gym.owner.cookies);
    expect(errorOf(whileOpen)).toBe("app_payment_open");
    // Paid now, taken off the list meanwhile: nothing given, the money kept, and the page keeps no name she typed.
    square.payLink(linkOf(packPage.purchase.id)?.id ?? "");
    expect((await check(gym, di.app, packPage.purchase.id)).purchase.state).toBe("check");
    const [kept] = await sql<{ sign: unknown }[]>`SELECT bought->'sign' AS sign FROM gym_app_payments WHERE id = ${packPage.purchase.id}`;
    expect(kept?.sign).toBeNull();
    // Delete permanently waits for that check too, then goes once it is marked checked.
    const unchecked = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${di.entryId}`, gym.owner.cookies);
    expect(errorOf(unchecked)).toBe("app_purchase_check");
    expect((await send("POST", `${entryUrl(gym, di.entryId)}/app-purchases/${packPage.purchase.id}/checked`, gym.owner.cookies)).statusCode).toBe(200);
    const gone = await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${di.entryId}`, gym.owner.cookies);
    expect(gone.statusCode, gone.body).toBe(200);

    // A record two accounts hold is nobody's own to buy on; neither is one somebody else starts paying for once the line is read.
    const fay = await member(gym, "Fay Two");
    const fayLine = await lineOf(gym, fay.app, pack);
    const second = await signedIn("Fay Two Phone");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${second.userId}, ${fay.entryId})`;
    expect(errorOf(await buyPress(gym, fay.app, fayLine, {}, "Fay Two"))).toBe("app_purchase_not_own");
    // An adult by her record signs herself, never a parent or guardian for her.
    const gus = await member(gym, "Gus Grown", "1990-02-02");
    const gusLine = await lineOf(gym, gus.app, pack);
    const asGuardian = await buyPress(gym, gus.app, gusLine, { agreement: { agreementId: gusLine.agreement?.id, signer: "guardian", name: "Pat Grown" } });
    expect(errorOf(asGuardian)).toBe("person_signs");
  });

  it("a body that is not a purchase is refused before anything is read", async () => {
    const acct = account(`ABVL${uniq().slice(-6)}`);
    const gym = await makeGym("App Buy Valid", acct);
    const zoe = await member(gym, "Zoe Ali");
    for (const body of [{}, { requestKey: "x", typeId: randomUUID(), amountMinor: 1, factsKey: "a".repeat(64), agreement: null }, { requestKey: randomUUID(), typeId: randomUUID(), amountMinor: 0, factsKey: "a".repeat(64), agreement: null }]) {
      const res = await send("POST", buyUrl(gym), zoe.app.cookies, body);
      expect(res.statusCode, res.body).toBe(400);
    }
  });
});
