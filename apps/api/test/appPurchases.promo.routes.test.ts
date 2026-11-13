// A promo code typed in the app (ROADMAP Stage 2 item 18k-v; Kd, 2026-11-13; spec Part 3 §14.3), through the routes
// against real Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`.
//
// The first block is the worst thing this job could do to a real person: a member pays and is given nothing, or pays an
// amount they were not shown, because their code ran out or changed while they paid; or a code works where its gym never
// meant it to (another gym's, one not ticked for the app, Refer a friend's own).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  PROMO_CODE_WORDS,
  appPurchaseResponseSchema,
  forSaleResponseSchema,
  heldMembershipsResponseSchema,
  sellPageResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type AppPurchaseResponse,
  type ForSaleLine,
  type ForSaleResponse,
  type GymDiscount,
  type GymMembershipTypesResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { createMemoryRedis } from "../src/redis.js";
import { loadConfig } from "../src/config.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { recordingHub } from "./liveNewsRecorder.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-APPPROMOAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "app-promo-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-APPPROMOSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_app_promo";

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
const nextIp = () => `10.58.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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
/** A discount form: a code for every membership, 20% off every payment, in the app, once per member, unless it says otherwise. */
const form = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  code: null,
  kind: "percent",
  percentBp: 2000,
  amountMinor: null,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  forProducts: false,
  allProducts: true,
  productIds: [],
  forMemberships: true,
  allMembershipTypes: true,
  membershipTypeIds: [],
  membershipPayments: "every",
  inApp: true,
  oncePerMember: true,
  ...over,
});

d("A promo code typed in the app: only where the gym meant it, honoured as shown, its last use never taken twice (real Postgres)", { timeout: T }, () => {
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

  const MINE = "apromo-t-%@example.com";
  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MINE})`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE ${MINE}`;
    await sql`DELETE FROM gym_app_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mineSql})`;
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
    const email = `apromo-t-${uniq()}@example.com`;
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
  const discounts = (gym: Gym) => `/v1/orgs/${gym.id}/register/discounts`;
  const addDiscount = async (gym: Gym, name: string, over: Record<string, unknown> = {}): Promise<GymDiscount> => {
    const res = await send("POST", discounts(gym), gym.owner.cookies, form(name, over));
    expect(res.statusCode, res.body).toBe(201);
    const found = sellPageResponseSchema.parse(JSON.parse(res.body)).discounts.find((x) => x.name === name);
    if (found === undefined) throw new Error(`no discount named ${name}`);
    return found;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const member = async (gym: Gym, fullName: string): Promise<{ entryId: string; app: Person }> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `apromo-r-${uniq()}@gmail.com` });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const app = await signedIn(fullName);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${app.userId}, ${entryId})`;
    return { entryId, app };
  };
  const today = async (gym: Gym, entryId: string): Promise<string> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body)).today;
  };
  /** The list as the phone reads it, with the code typed. */
  const listWith = async (gym: Gym, who: Person, code: string | null, repeating = false): Promise<ForSaleResponse> => {
    const q = [...(repeating ? ["repeating=true"] : []), ...(code === null ? [] : [`code=${encodeURIComponent(code)}`])].join("&");
    const res = await send("GET", `/v1/orgs/${gym.id}/for-sale${q === "" ? "" : `?${q}`}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return forSaleResponseSchema.parse(JSON.parse(res.body));
  };
  const lineIn = (list: ForSaleResponse, typeId: string): ForSaleLine => {
    const found = list.items.find((i) => i.typeId === typeId);
    if (found === undefined) throw new Error("the line is not listed");
    return found;
  };
  const buyUrl = (gym: Gym) => `/v1/orgs/${gym.id}/for-sale/purchases`;
  /** Buy, as the phone sends it: what the list showed, with the code it was shown with. */
  const buyPress = (gym: Gym, who: Person, shown: ForSaleLine, over: Record<string, unknown> = {}) =>
    send("POST", buyUrl(gym), who.cookies, {
      requestKey: randomUUID(),
      typeId: shown.typeId,
      amountMinor: shown.firstPayment.amountMinor,
      factsKey: shown.factsKey,
      agreement: null,
      ...(shown.firstPayment.promo === null ? {} : { code: shown.firstPayment.promo.code }),
      ...over,
    });
  const parsed = (res: { statusCode: number; body: string }): AppPurchaseResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return appPurchaseResponseSchema.parse(JSON.parse(res.body));
  };
  const check = async (gym: Gym, who: Person, id: string) => parsed(await send("GET", `${buyUrl(gym)}/${id}`, who.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;
  const linkOf = (id: string) => [...square.links.values()].find((l) => l.referenceId === id);
  const usesOf = async (discountId: string) => (await sql<{ uses: number }[]>`SELECT uses FROM gym_discounts WHERE id = ${discountId}`)[0]?.uses;
  const heldOf = (gymId: string, entryId: string) =>
    sql<{ discount_id: string | null; discount_minor: number; price_minor: number }[]>`
      SELECT discount_id, discount_minor, price_minor FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at, id`;
  /** Add membership at the desk, paid in cash, with a discount. */
  const deskGive = (gym: Gym, entryId: string, typeId: string, priceMinor: number, discount: { id: string; offMinor: number } | null, startsOn: string) =>
    send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, {
      requestKey: randomUUID(),
      typeId,
      startsOn,
      paid: true,
      method: "cash",
      priceMinor,
      ...(discount === null ? {} : { discountId: discount.id, discountMinor: discount.offMinor }),
    });
  const change = (gym: Gym, d: GymDiscount, name: string, over: Record<string, unknown>) =>
    send("PUT", `${discounts(gym)}/${d.id}`, gym.owner.cookies, { ...form(name, { code: d.code, maxUses: d.maxUses, ...over }), updatedAt: d.updatedAt });

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

  it("the worst thing: a code works only where its gym meant it, is charged as shown, and its last use, kept while a member pays, is never given to anyone else", async () => {
    clock = new Date();
    const gymA = await makeGym("Promo Worst A", account(`APWA${uniq().slice(-6)}`));
    const gymB = await makeGym("Promo Worst B", account(`APWB${uniq().slice(-6)}`));
    const pack = await addType(gymA, { name: "10-class pack" });
    await addType(gymB, { name: "10-class pack" });
    const summer = await addDiscount(gymA, "Summer", { code: "SUMMER20", maxUses: 1 });
    await addDiscount(gymA, "Staff only", { code: "STAFF50", percentBp: 5000, inApp: false, oncePerMember: false });
    await addDiscount(gymB, "B's own", { code: "BONLY" });
    const tara = await member(gymA, "Tara Singh");
    const sam = await member(gymA, "Sam Lee");
    const priya = await member(gymA, "Priya Sharma");
    const bea = await member(gymB, "Bea Brown");
    const stranger = await signedIn("A Stranger");

    // Typed as a member types it: 20% off the $90.00 pack, $72.00 today, named in what they read.
    const withCode = await listWith(gymA, tara.app, " summer20 ");
    expect(withCode.promo).toEqual({ code: "SUMMER20", applied: true, words: null });
    const shown = lineIn(withCode, pack);
    expect(shown.firstPayment.amountMinor).toBe(7200);
    expect(shown.firstPayment.promo).toEqual({ code: "SUMMER20", name: "Summer", offMinor: 1800, instead: null });
    expect(shown.promoWords).toBeNull();
    expect(shown.factsKey).not.toBe(lineIn(await listWith(gymA, tara.app, null), pack).factsKey);
    // Not a code here: one only staff use, another gym's, nonsense. Nothing comes off.
    for (const typed of ["STAFF50", "BONLY", "x", "SUMMER 20!"]) {
      const list = await listWith(gymA, tara.app, typed);
      expect(list.promo?.applied, typed).toBe(false);
      expect(list.promo?.words, typed).toBe(PROMO_CODE_WORDS.not_found);
      expect(lineIn(list, pack).firstPayment.amountMinor, typed).toBe(9000);
    }
    // A's code at B, and a stranger at A.
    expect((await listWith(gymB, bea.app, "SUMMER20")).promo?.words).toBe(PROMO_CODE_WORDS.not_found);
    expect((await send("GET", `/v1/orgs/${gymA.id}/for-sale?code=SUMMER20`, stranger.cookies)).statusCode).toBe(404);

    // Buy is held to what the list showed with the code: a full price sent with the code, a discounted one without it,
    // and a code at a gym that never ticked it, all make nothing.
    const full = lineIn(await listWith(gymA, tara.app, null), pack);
    for (const res of [
      await buyPress(gymA, tara.app, full, { code: "SUMMER20" }),
      await buyPress(gymA, tara.app, shown, { code: undefined }),
      await buyPress(gymA, tara.app, full, { code: "STAFF50" }),
    ]) {
      expect(res.statusCode, res.body).toBe(409);
    }
    const staffOnly = await buyPress(gymA, tara.app, full, { code: "STAFF50" });
    expect(messageOf(staffOnly)).toBe(PROMO_CODE_WORDS.not_found);
    expect(square.links.size).toBe(0);
    expect(await usesOf(summer.id)).toBe(0);

    // Tara presses Buy with it: Square's page is for $72.00, and the code's one use is kept for her.
    const page = parsed(await buyPress(gymA, tara.app, shown));
    expect(page.purchase).toMatchObject({ state: "open", amountMinor: 7200 });
    expect(linkOf(page.purchase.id)?.amount).toBe(7200);
    const [kept] = await sql<{ discount_id: string | null }[]>`SELECT discount_id FROM gym_app_payments WHERE id = ${page.purchase.id}`;
    expect(kept?.discount_id).toBe(summer.id);
    // Meanwhile nobody takes its last use: Sam reads it used up and his Buy is refused; the desk cannot give it to Priya;
    // staff cannot change it or archive it under her.
    const samList = await listWith(gymA, sam.app, "SUMMER20");
    expect(samList.promo).toEqual({ code: "SUMMER20", applied: false, words: PROMO_CODE_WORDS.used_up });
    const samBuy = await buyPress(gymA, sam.app, shown);
    expect(samBuy.statusCode, samBuy.body).toBe(409);
    expect(errorOf(samBuy)).toBe("app_purchase_promo");
    expect(messageOf(samBuy)).toBe(PROMO_CODE_WORDS.used_up);
    const desk = await deskGive(gymA, priya.entryId, pack, 9000, { id: summer.id, offMinor: 1800 }, await today(gymA, priya.entryId));
    expect(desk.statusCode, desk.body).toBe(409);
    expect(errorOf(desk)).toBe("discount_kept_in_app");
    expect(messageOf(desk)).toBe("Summer's last use is kept for a member who is paying with it in the app right now. Nothing was saved: pick another discount, or add the membership without one.");
    // The Discounts list says the same: nothing used yet, one kept for a member paying in the app.
    const listed = sellPageResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gymA.id}/register`, gymA.owner.cookies)).body)).discounts.find((x) => x.id === summer.id);
    expect(listed).toMatchObject({ uses: 0, keptUses: 1 });
    // Tara's own list, her page open, still shows her code applied: her own kept use is not counted against her.
    expect((await listWith(gymA, tara.app, "SUMMER20")).promo).toEqual({ code: "SUMMER20", applied: true, words: null });
    const edit = await change(gymA, summer, "Summer", { percentBp: 9000 });
    expect(edit.statusCode, edit.body).toBe(409);
    expect(errorOf(edit)).toBe("discount_being_used");
    expect(messageOf(edit)).toBe("You can't change this discount right now because Tara Singh is paying with it in the app. Try again once their payment is finished.");
    const archive = await send("DELETE", `${discounts(gymA)}/${summer.id}`, gymA.owner.cookies);
    expect(errorOf(archive)).toBe("discount_being_used");
    expect(square.links.size).toBe(1);

    // She pays: given with the code, as shown, its use counted once.
    expect(square.payLink(linkOf(page.purchase.id)?.id ?? "")).toBe(true);
    const paid = await check(gymA, tara.app, page.purchase.id);
    expect(paid.purchase.state).toBe("paid");
    expect(await heldOf(gymA.id, tara.entryId)).toEqual([{ discount_id: summer.id, discount_minor: 1800, price_minor: 7200 }]);
    expect(await usesOf(summer.id)).toBe(1);
    await check(gymA, tara.app, page.purchase.id);
    expect(await usesOf(summer.id)).toBe(1);
    // Used up for everyone now, and nobody else was given anything.
    expect((await listWith(gymA, sam.app, "SUMMER20")).promo?.words).toBe(PROMO_CODE_WORDS.used_up);
    expect(await heldOf(gymA.id, sam.entryId)).toEqual([]);
    expect(await heldOf(gymA.id, priya.entryId)).toEqual([]);
  });

  it("a sale never takes a use kept for a member paying in the app, and the member is given what they paid for even if a Terminal sale counted past the limit (round one, H1)", async () => {
    clock = new Date();
    const gym = await makeGym("Promo Terminal", account(`APTM${uniq().slice(-6)}`));
    const pack = await addType(gym, { name: "10-class pack" });
    const both = await addDiscount(gym, "Both ways", { code: "BOTHWAYS", maxUses: 1, forProducts: true, oncePerMember: false });
    const tara = await member(gym, "Tara Terminal");
    const page = parsed(await buyPress(gym, tara.app, lineIn(await listWith(gym, tara.app, "BOTHWAYS"), pack)));
    // The desk sells a towel with the same code while Tara pays: refused before anything is taken (a Terminal sale asks the
    // same pricing before the card is asked).
    const product = await send("POST", `/v1/orgs/${gym.id}/register/products`, gym.owner.cookies, { name: "Towel", priceMinor: 2000, taxRateIds: [], stock: null });
    expect(product.statusCode, product.body).toBe(201);
    const towel = sellPageResponseSchema.parse(JSON.parse(product.body)).products.find((p) => p.name === "Towel")?.id ?? "";
    const sale = await send("POST", `/v1/orgs/${gym.id}/register/sales`, gym.owner.cookies, { requestKey: randomUUID(), productId: towel, quantity: 1, entryId: null, method: "cash", totalMinor: 1600, discountId: both.id });
    expect(sale.statusCode, sale.body).toBe(409);
    expect(errorOf(sale)).toBe("discount_kept_in_app");
    expect(await usesOf(both.id)).toBe(0);
    // A Terminal sale asked for before her page was made is counted past the limit once its card is taken (recordTakenSale):
    // her use was kept, so she is still given what she paid for.
    await sql`UPDATE gym_discounts SET uses = 1 WHERE id = ${both.id}`;
    expect(square.payLink(linkOf(page.purchase.id)?.id ?? "")).toBe(true);
    expect((await check(gym, tara.app, page.purchase.id)).purchase.state).toBe("paid");
    expect(await heldOf(gym.id, tara.entryId)).toEqual([{ discount_id: both.id, discount_minor: 1800, price_minor: 7200 }]);
    expect(await usesOf(both.id)).toBe(2);
  });

  it("two members press Buy for a code's last use at the same instant: one page, and a page left unpaid gives its use back", async () => {
    clock = new Date();
    const gym = await makeGym("Promo Race", account(`APRC${uniq().slice(-6)}`));
    const pack = await addType(gym, { name: "10-class pack" });
    const last = await addDiscount(gym, "Last one", { code: "LASTONE", maxUses: 1, oncePerMember: false });
    const ava = await member(gym, "Ava Race");
    const ben = await member(gym, "Ben Race");
    const avaLine = lineIn(await listWith(gym, ava.app, "LASTONE"), pack);
    const benLine = lineIn(await listWith(gym, ben.app, "LASTONE"), pack);
    const both = await Promise.all([buyPress(gym, ava.app, avaLine), buyPress(gym, ben.app, benLine)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = both.find((r) => r.statusCode === 409);
    expect(loser === undefined ? null : messageOf(loser)).toBe(PROMO_CODE_WORDS.used_up);
    const [open] = await sql<{ id: string; entry_id: string }[]>`SELECT id, entry_id FROM gym_app_payments WHERE gym_id = ${gym.id} AND state = 'open'`;
    expect(await sql`SELECT id FROM gym_app_payments WHERE gym_id = ${gym.id}`).toHaveLength(1);
    // The winner leaves the page: the use goes back, and the other can have it.
    const winner = open?.entry_id === ava.entryId ? ava : ben;
    const other = winner === ava ? ben : ava;
    const closed = parsed(await send("POST", `${buyUrl(gym)}/${open?.id ?? ""}/close`, winner.app.cookies));
    expect(closed.purchase.state).toBe("closed");
    expect(await usesOf(last.id)).toBe(0);
    const again = await listWith(gym, other.app, "LASTONE");
    expect(again.promo?.applied).toBe(true);
    expect(parsed(await buyPress(gym, other.app, lineIn(again, pack))).purchase.amountMinor).toBe(7200);
  });

  it("once per member: a second use is refused on the same record, in the app and at the desk, a walk-in is not counted, and unticked it is used again", async () => {
    clock = new Date();
    const gym = await makeGym("Promo Once", account(`APON${uniq().slice(-6)}`));
    const pack = await addType(gym, { name: "10-class pack" });
    const pass = await addType(gym, { name: "Day pass", priceMinor: 1500, packClasses: 1, packDays: 1 });
    const welcome = await addDiscount(gym, "Welcome", { code: "WELCOME", kind: "amount", percentBp: null, amountMinor: 1000, forProducts: true });
    const tara = await member(gym, "Tara Once");
    const sam = await member(gym, "Sam Once");
    const day = await today(gym, tara.entryId);

    // Tara buys the pack with it in the app: $80.00.
    const shown = lineIn(await listWith(gym, tara.app, "WELCOME"), pack);
    expect(shown.firstPayment.amountMinor).toBe(8000);
    const page = parsed(await buyPress(gym, tara.app, shown));
    expect(square.payLink(linkOf(page.purchase.id)?.id ?? "")).toBe(true);
    expect((await check(gym, tara.app, page.purchase.id)).purchase.state).toBe("paid");
    // Not a second time: not on the day pass in the app, nor at the desk, nor on a product sold to her.
    const twice = await listWith(gym, tara.app, "WELCOME");
    expect(twice.promo).toEqual({ code: "WELCOME", applied: false, words: PROMO_CODE_WORDS.used_by_member });
    expect(messageOf(await buyPress(gym, tara.app, lineIn(await listWith(gym, tara.app, null), pass), { code: "WELCOME", amountMinor: 500 }))).toBe(PROMO_CODE_WORDS.used_by_member);
    const desk = await deskGive(gym, tara.entryId, pass, 1500, { id: welcome.id, offMinor: 1000 }, day);
    expect(desk.statusCode, desk.body).toBe(409);
    expect(errorOf(desk)).toBe("discount_used_by_member");
    expect(messageOf(desk)).toBe("This member has already used Welcome, and it is limited to one use per member. Nothing was saved: pick another discount, or add the membership without one.");
    const product = await send("POST", `/v1/orgs/${gym.id}/register/products`, gym.owner.cookies, { name: "Shaker", priceMinor: 2500, taxRateIds: [], stock: null });
    expect(product.statusCode, product.body).toBe(201);
    const shaker = sellPageResponseSchema.parse(JSON.parse(product.body)).products.find((p) => p.name === "Shaker")?.id ?? "";
    const sale = (entryId: string | null) =>
      send("POST", `/v1/orgs/${gym.id}/register/sales`, gym.owner.cookies, { requestKey: randomUUID(), productId: shaker, quantity: 1, entryId, method: "cash", totalMinor: 1500, discountId: welcome.id });
    const taraSale = await sale(tara.entryId);
    expect(taraSale.statusCode, taraSale.body).toBe(409);
    expect(errorOf(taraSale)).toBe("discount_used_by_member");
    // Somebody else may, at the desk; a walk-in has no record to count it on.
    expect((await deskGive(gym, sam.entryId, pass, 1500, { id: welcome.id, offMinor: 1000 }, day)).statusCode).toBe(201);
    expect((await sale(null)).statusCode).toBe(201);
    // A sale voided gives the use back: Lee buys a shaker with it, it is voided, and the code works for Lee in the app.
    const lee = await member(gym, "Lee Void");
    const leeSale = await sale(lee.entryId);
    expect(leeSale.statusCode, leeSale.body).toBe(201);
    expect((await listWith(gym, lee.app, "WELCOME")).promo?.words).toBe(PROMO_CODE_WORDS.used_by_member);
    const saleId = (JSON.parse(leeSale.body) as { saleId: string }).saleId;
    expect((await send("POST", `/v1/orgs/${gym.id}/register/sales/${saleId}/void`, gym.owner.cookies, { reason: "mistake" })).statusCode).toBe(200);
    expect((await listWith(gym, lee.app, "WELCOME")).promo?.applied).toBe(true);
    // Sam, who used it at the desk, reads it used in the app too.
    expect((await listWith(gym, sam.app, "WELCOME")).promo?.words).toBe(PROMO_CODE_WORDS.used_by_member);
    // The gym unticks Once per member: Tara can use it again.
    const now = sellPageResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/register`, gym.owner.cookies)).body)).discounts.find((x) => x.id === welcome.id);
    if (now === undefined) throw new Error("no discount");
    const untick = await change(gym, now, "Welcome", { kind: "amount", percentBp: null, amountMinor: 1000, forProducts: true, oncePerMember: false });
    expect(untick.statusCode, untick.body).toBe(200);
    expect((await listWith(gym, tara.app, "WELCOME")).promo?.applied).toBe(true);
  });

  it("a code ending today is honoured for a page opened before midnight and paid after it, as the member was shown it", async () => {
    // 23:50 in Chicago on 2026-11-20.
    clock = new Date("2026-11-21T05:50:00.000Z");
    const gym = await makeGym("Promo Midnight", account(`APMN${uniq().slice(-6)}`));
    const pack = await addType(gym, { name: "10-class pack" });
    const lastDay = await addDiscount(gym, "Last day", { code: "LASTDAY", endsOn: "2026-11-20" });
    const ivy = await member(gym, "Ivy Late");
    const page = parsed(await buyPress(gym, ivy.app, lineIn(await listWith(gym, ivy.app, "LASTDAY"), pack)));
    // Paid at 00:02: the code has ended on the gym's clock, and she is given what she was shown.
    clock = new Date("2026-11-21T06:02:00.000Z");
    expect((await listWith(gym, ivy.app, "LASTDAY")).promo?.words).toBe(PROMO_CODE_WORDS.expired);
    expect(square.payLink(linkOf(page.purchase.id)?.id ?? "")).toBe(true);
    expect((await check(gym, ivy.app, page.purchase.id)).purchase.state).toBe("paid");
    expect(await heldOf(gym.id, ivy.entryId)).toEqual([{ discount_id: lastDay.id, discount_minor: 1800, price_minor: 7200 }]);
  });

  it("each line says whether the code takes something off it, a repeating line's later payments follow First payment only or Every payment, and a code not started says when", async () => {
    clock = new Date();
    const gym = await makeGym("Promo Lines", account(`APLN${uniq().slice(-6)}`));
    const pack = await addType(gym, { name: "10-class pack" });
    const monthly = await addType(gym, { name: "Gold Monthly", kind: "recurring", priceMinor: 5000, termCount: 1, termUnit: "month", packClasses: null, packDays: null });
    const pass = await addType(gym, { name: "Day pass", priceMinor: 1500, packClasses: 1, packDays: 1 });
    await addDiscount(gym, "Gold first", { code: "GOLDFIRST", allMembershipTypes: false, membershipTypeIds: [monthly], membershipPayments: "first" });
    await addDiscount(gym, "Gold every", { code: "GOLDEVERY", allMembershipTypes: false, membershipTypeIds: [monthly] });
    await addDiscount(gym, "Too big", { code: "TOOBIG", kind: "amount", percentBp: null, amountMinor: 2000 });
    await addDiscount(gym, "Soon", { code: "SOON", startsOn: "2099-01-01" });
    const mo = await member(gym, "Mo Lines");

    const first = await listWith(gym, mo.app, "GOLDFIRST", true);
    expect(first.promo).toEqual({ code: "GOLDFIRST", applied: true, words: null });
    expect(lineIn(first, monthly).firstPayment.promo?.offMinor).toBe(1000);
    expect(lineIn(first, monthly).renews?.amountMinor).toBe(5000);
    expect(lineIn(first, pack).promoWords).toBe(PROMO_CODE_WORDS.not_for("10-class pack"));
    expect(lineIn(first, pack).firstPayment.amountMinor).toBe(9000);
    const every = await listWith(gym, mo.app, "GOLDEVERY", true);
    expect(lineIn(every, monthly).renews?.amountMinor).toBe(4000);
    // $20.00 off: the pack takes it, the $15.00 day pass would be free and does not.
    const big = await listWith(gym, mo.app, "TOOBIG");
    expect(lineIn(big, pack).firstPayment.amountMinor).toBe(7000);
    expect(lineIn(big, pass).firstPayment.amountMinor).toBe(1500);
    expect(lineIn(big, pass).promoWords).toBe(PROMO_CODE_WORDS.not_for("Day pass"));
    const passPress = await buyPress(gym, mo.app, lineIn(big, pass), { code: "TOOBIG" });
    expect(messageOf(passPress)).toBe(PROMO_CODE_WORDS.not_for("Day pass"));
    // A repeating line is never offered to a phone that does not ask for it: a code for it alone fits nothing there.
    expect((await listWith(gym, mo.app, "GOLDEVERY")).promo).toEqual({ code: "GOLDEVERY", applied: false, words: PROMO_CODE_WORDS.fits_nothing });
    expect((await listWith(gym, mo.app, "SOON")).promo?.words).toBe(PROMO_CODE_WORDS.not_started("1 Jan 2099"));
  });

  it("codes that take nothing off are counted, never one that works; once too many, a code is not looked at and the list says so (round one, L2)", async () => {
    clock = new Date();
    const gym = await makeGym("Promo Limit", account(`APLM${uniq().slice(-6)}`));
    await addType(gym, { name: "10-class pack" });
    await addDiscount(gym, "Real one", { code: "REAL20", oncePerMember: false });
    const kim = await member(gym, "Kim Tries");
    const tries = async () => Number((await redis.get(`rl:promo_code_try:id:${kim.app.userId}`)) ?? 0);
    for (let n = 0; n < 19; n++) await redis.incrWithTtl(`rl:promo_code_try:id:${kim.app.userId}`, 3600);
    // A code that works, read again and again as the phone re-reads the list, is never counted.
    for (let n = 0; n < 3; n++) expect((await listWith(gym, kim.app, "REAL20")).promo?.applied).toBe(true);
    expect(await tries()).toBe(19);
    // The twentieth that takes nothing off is counted, and from then on no code is looked at, the real one included: the
    // list is read as ever, and says why in words.
    expect((await listWith(gym, kim.app, "GUESS20")).promo?.words).toBe(PROMO_CODE_WORDS.not_found);
    expect(await tries()).toBe(20);
    const spent = await listWith(gym, kim.app, "REAL20");
    expect(spent.promo).toEqual({ code: "REAL20", applied: false, words: PROMO_CODE_WORDS.too_many });
    expect(spent.items).toHaveLength(1);
    expect(spent.items[0]?.firstPayment.amountMinor).toBe(9000);
    // Buy with a code is refused in the same words; the list and Buy without one are not.
    const [pack] = (await listWith(gym, kim.app, null)).items;
    if (pack === undefined) throw new Error("the line is not listed");
    const buyWith = await buyPress(gym, kim.app, pack, { code: "REAL20" });
    expect(buyWith.statusCode).toBe(429);
    expect(messageOf(buyWith)).toBe(PROMO_CODE_WORDS.too_many);
    expect(parsed(await buyPress(gym, kim.app, pack)).purchase.amountMinor).toBe(9000);
    // One wi-fi address is held to 600: another member there, who tried nothing, is told the same.
    const ann = await member(gym, "Ann Same Wifi");
    const wifi = "10.99.0.7";
    for (let n = 0; n < 600; n++) await redis.incrWithTtl(`rl:promo_code_try:ip:${wifi}`, 3600);
    const there = await api().inject({ method: "GET", url: `/v1/orgs/${gym.id}/for-sale?code=REAL20`, remoteAddress: wifi, cookies: ann.app.cookies });
    expect(there.statusCode, there.body).toBe(200);
    expect(forSaleResponseSchema.parse(JSON.parse(there.body)).promo?.words).toBe(PROMO_CODE_WORDS.too_many);
    expect((await listWith(gym, ann.app, "REAL20")).promo?.applied).toBe(true);
    // Thirty wrong codes sent at the same instant are each counted before they are looked at: twenty looked up, no more
    // (the re-check, N1).
    const bo = await member(gym, "Bo Burst");
    const burst = await Promise.all(Array.from({ length: 30 }, (_, n) => listWith(gym, bo.app, `BURST${String(n).padStart(2, "0")}`)));
    const said = burst.map((l) => l.promo?.words);
    expect(said.filter((w) => w === PROMO_CODE_WORDS.not_found)).toHaveLength(20);
    expect(said.filter((w) => w === PROMO_CODE_WORDS.too_many)).toHaveLength(10);
    // Bo's ten past his twenty never counted against the address he sent them from (the second re-check, N2).
    const cy = await member(gym, "Cy One Wifi");
    const shared = "10.99.0.8";
    const atShared = (who: Person, code: string) => api().inject({ method: "GET", url: `/v1/orgs/${gym.id}/for-sale?code=${code}`, remoteAddress: shared, cookies: who.cookies });
    for (let n = 0; n < 20; n++) await redis.incrWithTtl(`rl:promo_code_try:id:${cy.app.userId}`, 3600);
    for (let n = 0; n < 5; n++) expect((await atShared(cy.app, `CYTRY${String(n)}`)).statusCode).toBe(200);
    expect(Number((await redis.get(`rl:promo_code_try:ip:${shared}`)) ?? 0)).toBe(0);
  });

  it("staff tick a code for the app only on memberships, and read both ticks on the Discounts list; a stranger changes nothing", async () => {
    clock = new Date();
    const gym = await makeGym("Promo Console", account(`APCN${uniq().slice(-6)}`));
    const other = await makeGym("Promo Console Next Door", account(`APCX${uniq().slice(-6)}`));
    for (const over of [
      { code: "SHAKE10", forProducts: true, forMemberships: false, membershipPayments: null },
      { code: null, oncePerMember: false },
      { code: null, inApp: false },
    ]) {
      const res = await send("POST", discounts(gym), gym.owner.cookies, form("Bad", over));
      expect(res.statusCode, `${JSON.stringify(over)} ${res.body}`).toBe(400);
    }
    const saved = await addDiscount(gym, "Spring", { code: "SPRING" });
    expect(saved).toMatchObject({ inApp: true, oncePerMember: true });
    // Sent without the two ticks (an older form): neither.
    const older = Object.fromEntries(Object.entries(form("Plain", { code: "PLAIN" })).filter(([k]) => k !== "inApp" && k !== "oncePerMember"));
    const plain = await send("POST", discounts(gym), gym.owner.cookies, older);
    expect(plain.statusCode, plain.body).toBe(201);
    expect(sellPageResponseSchema.parse(JSON.parse(plain.body)).discounts.find((x) => x.name === "Plain")).toMatchObject({ inApp: false, oncePerMember: false });
    // Next door's owner cannot change or archive it.
    expect([403, 404]).toContain((await send("PUT", `${discounts(gym)}/${saved.id}`, other.owner.cookies, { ...form("Spring", { code: "SPRING", inApp: false }), updatedAt: saved.updatedAt })).statusCode);
    expect([403, 404]).toContain((await send("DELETE", `${discounts(gym)}/${saved.id}`, other.owner.cookies)).statusCode);
    // Nor does the code work at next door's gym.
    const nextDoorMember = await member(other, "Nia Next");
    await addType(other, { name: "10-class pack" });
    expect((await listWith(other, nextDoorMember.app, "SPRING")).promo?.words).toBe(PROMO_CODE_WORDS.not_found);
    const [row] = await sql<{ in_app: boolean }[]>`SELECT in_app FROM gym_discounts WHERE id = ${saved.id}`;
    expect(row?.in_app).toBe(true);
  });
});
