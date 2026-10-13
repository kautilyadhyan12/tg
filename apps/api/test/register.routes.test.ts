// THE REGISTER, through its routes against real Postgres (spec Part 3 §14.3; ROADMAP
// 18b-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: record one sale twice, so a gym's
// day says it took money it did not; or put a sale on another gym's member. That is the
// first test: one press sent six times at one instant, the same key with another sale
// behind it, two staff selling the last one in stock, and next door's person and product.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PRODUCTS_MAX, REGISTER_WORDS, sellPageResponseSchema, type MemberPurchasesResponse, type SalePeopleResponse, type SellPageResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-register-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_register_routes";

let ipCounter = 0;
const nextIp = () => `10.94.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("the register: products, sales and tax (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'reg-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'reg-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);
  const del = (path: string, cookies: Cookies = {}) => send("DELETE", path, cookies);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `reg-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Reg ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: Person, name: string, country = "US", timezone = "America/Chicago", plan = true): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Austin", country, timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return id;
  };
  /** Somebody on the gym's staff: holding exactly these ticks, or the role's own with null. */
  const staffWith = async (gymId: string, who: Person, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string, email?: string): Promise<string> => {
    const address = email ?? `reg-p-${name.toLowerCase().replace(/[^a-z]/g, "")}-${String(++keyCounter)}@example.com`;
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: address }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const read = async (gymId: string, cookies: Cookies): Promise<SellPageResponse> => {
    const res = await get(base(gymId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return page(res);
  };
  const addProduct = async (gymId: string, cookies: Cookies, body: { name: string; priceMinor: number; taxed?: boolean; stock?: number | null }) => {
    const res = await post(`${base(gymId)}/products`, { taxed: true, stock: null, ...body }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === body.name);
    if (found === undefined) throw new Error(`no product named ${body.name}`);
    return found;
  };
  const sale = (productId: string, totalMinor: number, over: Record<string, unknown> = {}) => ({
    requestKey: nextKey(),
    productId,
    quantity: 1,
    entryId: null,
    method: "cash",
    totalMinor,
    ...over,
  });
  const sell = (gymId: string, cookies: Cookies, body: Record<string, unknown>, ip?: string) => send("POST", `${base(gymId)}/sales`, cookies, body, ip);

  /** What is in the tables, read directly. */
  const salesOf = (gymId: string) => sql<
    { id: string; product_id: string; entry_id: string | null; item_name: string; quantity: number; unit_price_minor: number; net_minor: number; tax_minor: number; total_minor: number; tax_bp: number; tax_included: boolean; currency: string; method: string; sold_on: string; recorded_by: string | null; undone: boolean }[]
  >`
    SELECT id, product_id, entry_id, item_name, quantity, unit_price_minor, net_minor, tax_minor, total_minor, tax_bp, tax_included,
           currency, method, sold_on::text AS sold_on, recorded_by, undone_at IS NOT NULL AS undone
    FROM gym_sales WHERE gym_id = ${gymId} ORDER BY seq`;
  const stockOf = async (productId: string) => (await sql<{ stock: number | null }[]>`SELECT stock FROM gym_products WHERE id = ${productId}`)[0]?.stock;
  const auditOf = (gymId: string, action: string) => sql<{ target_id: string; actor_user_id: string | null; meta: Record<string, string> }[]>`
    SELECT target_id, actor_user_id, meta FROM audit_log WHERE gym_id = ${gymId} AND action = ${action} ORDER BY at, id`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock },
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
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "one sale is one sale: a press sent six times at once, a key used for another sale, the last one in stock sold by two staff, and next door's person and product",
    async () => {
      const owner = await makeUser("once-owner");
      const desk = await makeUser("once-desk");
      const nextDoor = await makeUser("once-nextdoor");
      const gymId = await makeGym(owner, "Reg Once Gym");
      const otherGym = await makeGym(nextDoor, "Reg Once Next Door");
      await staffWith(gymId, desk, "manager", null);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const theirs = await addPerson(otherGym, nextDoor.cookies, "Noor Next");
      const water = await addProduct(gymId, owner.cookies, { name: "Water 500 ml", priceMinor: 199, stock: 10 });
      const lastOne = await addProduct(gymId, owner.cookies, { name: "Shaker", priceMinor: 1200, stock: 1 });
      const few = await addProduct(gymId, owner.cookies, { name: "Protein bar", priceMinor: 300, stock: 3 });
      const theirProduct = await addProduct(otherGym, nextDoor.cookies, { name: "Their towel", priceMinor: 500, stock: 5 });

      // The same press, six times at one instant, from two addresses.
      const press = sale(water.id, 398, { quantity: 2, entryId: maya, method: "card_at_desk" });
      const six = await Promise.all([0, 1, 2, 3, 4, 5].map((n) => sell(gymId, n % 2 === 0 ? owner.cookies : desk.cookies, press)));
      expect(six.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
      const ids = new Set(six.map((r) => (JSON.parse(r.body) as { saleId: string }).saleId));
      expect(ids.size).toBe(1);
      let rows = await salesOf(gymId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ product_id: water.id, entry_id: maya, quantity: 2, total_minor: 398, method: "card_at_desk", undone: false });
      expect(await stockOf(water.id)).toBe(8);
      const notes = await auditOf(gymId, "org.sale_recorded");
      expect(notes).toHaveLength(1);
      expect(Object.keys(notes[0]?.meta ?? {}).sort()).toEqual(["currency", "entryId", "method", "product", "productId", "quantity", "taxMinor", "totalMinor"]);
      expect(notes[0]?.meta["entryId"]).toBe(maya);
      expect(JSON.stringify(notes[0]?.meta)).not.toContain("Maya");
      // And again a moment later: still one.
      expect((await sell(gymId, owner.cookies, press)).statusCode).toBe(201);
      expect(await salesOf(gymId)).toHaveLength(1);
      expect(await stockOf(water.id)).toBe(8);

      // The same key with a different sale behind it: refused, whichever part of the sale differs.
      // The same key naming another buyer is the sale already made, and adds nothing: who
      // bought it is not compared, since a record can be joined to another after the press.
      const otherBuyer = await sell(gymId, owner.cookies, { ...press, entryId: null });
      expect(otherBuyer.statusCode).toBe(201);
      expect((JSON.parse(otherBuyer.body) as { saleId: string }).saleId).toBe([...ids][0]);
      expect((await salesOf(gymId)).map((r) => r.entry_id)).toEqual([maya]);
      for (const other of [{ quantity: 1, totalMinor: 199 }, { method: "cash" }, { productId: few.id, totalMinor: 600 }]) {
        const res = await sell(gymId, owner.cookies, { ...press, ...other });
        expect(res.statusCode, JSON.stringify(other)).toBe(409);
        expect(errorOf(res)).toBe("request_reused");
      }
      expect(await salesOf(gymId)).toHaveLength(1);
      expect(await stockOf(water.id)).toBe(8);
      expect(await stockOf(few.id)).toBe(3);

      // Two staff sell the last one at the same instant, each from their own form.
      const two = await Promise.all([sell(gymId, owner.cookies, sale(lastOne.id, 1200)), sell(gymId, desk.cookies, sale(lastOne.id, 1200))]);
      expect(two.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const lost = two.find((r) => r.statusCode === 409);
      if (lost === undefined) throw new Error("nobody was refused");
      expect(errorOf(lost)).toBe("out_of_stock");
      expect(messageOf(lost)).toBe("Shaker is out of stock. Nothing was sold. If you have more, change the stock count under Products.");
      expect(await stockOf(lastOne.id)).toBe(0);
      expect((await salesOf(gymId)).filter((s) => s.product_id === lastOne.id)).toHaveLength(1);

      // Eight forms at once for three in stock: three are sold, and the count never goes under nothing.
      const eight = await Promise.all(Array.from({ length: 8 }, (_, n) => sell(gymId, n % 2 === 0 ? owner.cookies : desk.cookies, sale(few.id, 300))));
      expect(eight.filter((r) => r.statusCode === 201)).toHaveLength(3);
      expect(eight.filter((r) => r.statusCode === 409 && errorOf(r) === "out_of_stock")).toHaveLength(5);
      expect(await stockOf(few.id)).toBe(0);
      // More than are left says how many.
      const refill = await put(`${base(gymId)}/products/${few.id}`, { name: "Protein bar", priceMinor: 300, taxed: true, stock: 2, updatedAt: (await read(gymId, owner.cookies)).products.find((p) => p.id === few.id)?.updatedAt }, owner.cookies);
      expect(refill.statusCode, refill.body).toBe(200);
      const tooMany = await sell(gymId, owner.cookies, sale(few.id, 900, { quantity: 3 }));
      expect(tooMany.statusCode).toBe(409);
      expect(messageOf(tooMany)).toBe("Only 2 of Protein bar left in stock. Nothing was sold. Sell 2 or fewer, or change the stock count under Products.");
      expect(await stockOf(few.id)).toBe(2);

      // Next door's person on this gym's sale, and next door's product: nothing is written.
      rows = await salesOf(gymId);
      const forTheirs = await sell(gymId, owner.cookies, sale(water.id, 199, { entryId: theirs }));
      expect(forTheirs.statusCode).toBe(404);
      expect(errorOf(forTheirs)).toBe("entry_not_found");
      const theirThing = await sell(gymId, owner.cookies, sale(theirProduct.id, 500));
      expect(theirThing.statusCode).toBe(409);
      expect(errorOf(theirThing)).toBe("product_not_for_sale");
      expect(await salesOf(gymId)).toHaveLength(rows.length);
      expect(await salesOf(otherGym)).toHaveLength(0);
      expect(await stockOf(theirProduct.id)).toBe(5);
      expect(await stockOf(water.id)).toBe(8);
      // And this gym's owner cannot sell at the gym next door at all.
      expect((await sell(otherGym, owner.cookies, sale(theirProduct.id, 500))).statusCode).toBe(404);
      expect(await salesOf(otherGym)).toHaveLength(0);

      // The page adds up only what stands: one water sale of 398, one shaker, three bars.
      const now = await read(gymId, owner.cookies);
      expect(now.totals).toEqual({ count: 5, payments: 0, totalMinor: 398 + 1200 + 900, taxMinor: 0, cash: 1200 + 900, card_at_desk: 398, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0 });
      expect(now.sales).toHaveLength(5);
      expect(now.sales.filter((s) => s.person !== null)).toEqual([expect.objectContaining({ person: { entryId: maya, name: "Maya Patel" }, by: expect.stringMatching(/^Reg once-/) as unknown })]);
    },
    T,
  );

  it(
    "who may: a stranger, next door's owner and a member get 404, nobody signed in 401, and each tick opens only its own half",
    async () => {
      const owner = await makeUser("who-owner");
      const nextDoor = await makeUser("who-nextdoor");
      const stranger = await makeUser("who-stranger");
      const seller = await makeUser("who-seller");
      const pricer = await makeUser("who-pricer");
      const trainer = await makeUser("who-trainer");
      const member = await makeUser("who-member");
      const gymId = await makeGym(owner, "Reg Who Gym");
      await makeGym(nextDoor, "Reg Who Next Door");
      await staffWith(gymId, seller, "trainer", ["members.read", "billing.members"]);
      await staffWith(gymId, pricer, "trainer", ["members.read", "memberships.manage"]);
      await staffWith(gymId, trainer, "trainer", ["members.read", "members.confirm", "attendance.mark"]);
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${member.userId})`;
      const person = await addPerson(gymId, owner.cookies, "Pat Quinn", "reg-p-pat-quinn@example.com");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 199, stock: 50 });
      const sold = await sell(gymId, owner.cookies, sale(water.id, 199, { entryId: person }));
      expect(sold.statusCode, sold.body).toBe(201);
      // Somebody who holds the price tick and nothing else, not even the list's: the page
      // they are sent names nobody who bought, nobody who sold, and no money.
      const onlyPrices = await makeUser("who-onlyprices");
      await staffWith(gymId, onlyPrices, "trainer", ["memberships.manage"]);
      const bare = await get(base(gymId), onlyPrices.cookies);
      expect(bare.statusCode, bare.body).toBe(200);
      expect(page(bare).sales).toEqual([]);
      expect(page(bare).payments).toBeNull();
      expect(page(bare).totals.totalMinor).toBe(0);
      expect(page(bare).products.map((p) => p.name)).toEqual(["Water"]);
      for (const name of ["Pat Quinn", "Reg who-owner", person]) expect(bare.body).not.toContain(name);
      // The owner's own read of the same page does name them: the check above can fail.
      expect((await get(base(gymId), owner.cookies)).body).toContain("Pat Quinn");
      const saleId = (JSON.parse(sold.body) as { saleId: string }).saleId;
      const product = { name: "Towel", priceMinor: 500, taxed: true, stock: null };
      const fresh = async () => (await read(gymId, owner.cookies)).products.find((p) => p.id === water.id)?.updatedAt;

      /** Every route, as one person asks it. */
      const everything = async (cookies: Cookies) => ({
        page: (await get(base(gymId), cookies)).statusCode,
        people: (await get(`${base(gymId)}/people?query=pat`, cookies)).statusCode,
        sell: (await sell(gymId, cookies, sale(water.id, 199))).statusCode,
        undo: (await post(`${base(gymId)}/sales/${saleId}/undo`, {}, cookies)).statusCode,
        tax: (await put(`${base(gymId)}/tax`, { bp: 825, included: false }, cookies)).statusCode,
        add: (await post(`${base(gymId)}/products`, product, cookies)).statusCode,
        change: (await put(`${base(gymId)}/products/${water.id}`, { name: "Water", priceMinor: 199, taxed: true, stock: 50, updatedAt: await fresh() }, cookies)).statusCode,
        archive: (await del(`${base(gymId)}/products/${water.id}`, cookies)).statusCode,
        restore: (await post(`${base(gymId)}/products/${water.id}/restore`, {}, cookies)).statusCode,
        purchases: (await get(`/v1/orgs/${gymId}/member-list/entries/${person}/purchases`, cookies)).statusCode,
      });
      const all = (status: number) => ({ page: status, people: status, sell: status, undo: status, tax: status, add: status, change: status, archive: status, restore: status, purchases: status });

      const before = { sales: await salesOf(gymId), page: await read(gymId, owner.cookies) };
      expect(await everything({})).toEqual(all(401));
      expect(await everything(stranger.cookies)).toEqual(all(404));
      expect(await everything(nextDoor.cookies)).toEqual(all(404));
      expect(await everything(member.cookies)).toEqual(all(404));
      // On the staff with neither tick: told so, on every route.
      expect(await everything(trainer.cookies)).toEqual(all(403));
      // Changing prices alone: reads the page and changes products and tax, sells nothing, sees nobody.
      expect(await everything(pricer.cookies)).toEqual({ page: 200, people: 403, sell: 403, undo: 403, tax: 200, add: 201, change: 200, archive: 200, restore: 200, purchases: 403 });
      const afterPricer = await salesOf(gymId);
      expect(afterPricer).toEqual(before.sales);
      // Put back as it was for the next asker.
      expect((await put(`${base(gymId)}/tax`, { bp: 0, included: false }, owner.cookies)).statusCode).toBe(200);
      const towel = (await read(gymId, owner.cookies)).products.find((p) => p.name === "Towel");
      if (towel === undefined) throw new Error("the towel was not added");
      expect((await del(`${base(gymId)}/products/${towel.id}`, owner.cookies)).statusCode).toBe(200);
      await sql`DELETE FROM gym_products WHERE id = ${towel.id}`;
      // Recording payments alone: sells, takes back and finds people; changes no product and no tax.
      const asSeller = await everything(seller.cookies);
      expect(asSeller).toEqual({ page: 200, people: 200, sell: 201, undo: 200, tax: 403, add: 403, change: 403, archive: 403, restore: 403, purchases: 200 });
      const sellerPage = page(await get(base(gymId), seller.cookies));
      expect({ canSell: sellerPage.canSell, canManage: sellerPage.canManage }).toEqual({ canSell: true, canManage: false });
      expect((await read(gymId, owner.cookies)).tax).toEqual({ bp: 0, included: false });
      expect((await read(gymId, pricer.cookies)).canSell).toBe(false);
      // A seller who does not keep the list is sent no email, and is not found by one.
      const found = JSON.parse((await get(`${base(gymId)}/people?query=pat`, seller.cookies)).body) as SalePeopleResponse;
      expect(found.people).toEqual([{ entryId: person, name: "Pat Quinn", email: null, memberNumber: null, past: false }]);
      expect((JSON.parse((await get(`${base(gymId)}/people?query=reg-p-pat`, seller.cookies)).body) as SalePeopleResponse).people).toEqual([]);
      expect((JSON.parse((await get(`${base(gymId)}/people?query=reg-p-pat`, owner.cookies)).body) as SalePeopleResponse).people).toEqual([
        { entryId: person, name: "Pat Quinn", email: "reg-p-pat-quinn@example.com", memberNumber: null, past: false },
      ]);

      // What is not a sale or a product is refused before anybody's tick is asked.
      for (const bad of [{}, sale(water.id, 199, { quantity: 0 }), sale(water.id, 199, { method: "link" }), sale(water.id, 0), { ...sale(water.id, 199), unitPriceMinor: 1 }, sale("not-a-product", 199)]) {
        expect((await sell(gymId, owner.cookies, bad)).statusCode).toBe(400);
      }
      for (const bad of [{ ...product, priceMinor: 0 }, { ...product, name: " " }, { ...product, stock: -1 }, { ...product, currency: "INR" }]) {
        expect((await post(`${base(gymId)}/products`, bad, owner.cookies)).statusCode).toBe(400);
      }
      for (const bad of [{ bp: 3001, included: false }, { bp: -1, included: false }, { bp: 8.25, included: false }, { bp: 825 }]) {
        expect((await put(`${base(gymId)}/tax`, bad, owner.cookies)).statusCode).toBe(400);
      }
      expect((await get(`${base(gymId)}/people?query=p`, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${base(gymId)}/people?query=${encodeURIComponent("100%")}`, owner.cookies)).statusCode).toBe(200);

      // A gym on no plan reads its register and cannot change it.
      const lapsedOwner = await makeUser("who-lapsed");
      const lapsed = await makeGym(lapsedOwner, "Reg Who Lapsed", "US", "America/Chicago", false);
      const [made] = await sql<{ id: string }[]>`INSERT INTO gym_products (gym_id, name, price_minor, currency, stock) VALUES (${lapsed}, 'Water', 199, 'USD', 4) RETURNING id`;
      if (made === undefined) throw new Error("no product");
      expect((await get(base(lapsed), lapsedOwner.cookies)).statusCode).toBe(200);
      const refusedSale = await sell(lapsed, lapsedOwner.cookies, sale(made.id, 199));
      expect(refusedSale.statusCode).toBe(409);
      expect(errorOf(refusedSale)).toBe("gym_not_on_plan");
      expect((await post(`${base(lapsed)}/products`, product, lapsedOwner.cookies)).statusCode).toBe(409);
      expect((await put(`${base(lapsed)}/tax`, { bp: 825, included: false }, lapsedOwner.cookies)).statusCode).toBe(409);
      expect(await salesOf(lapsed)).toHaveLength(0);
      expect(await stockOf(made.id)).toBe(4);
    },
    T,
  );

  it(
    "the server works out every amount: tax on top and inside the price, a product not taxed, a total that has changed, and a sale that keeps what it was sold at",
    async () => {
      const owner = await makeUser("tax-owner");
      const ukOwner = await makeUser("tax-uk-owner");
      const us = await makeGym(owner, "Reg Tax Texas", "US", "America/Chicago");
      const uk = await makeGym(ukOwner, "Reg Tax Leeds", "GB", "Europe/London");

      // Where each gym starts: no tax; on top in the United States, inside the price in the UK.
      expect((await read(us, owner.cookies)).tax).toEqual({ bp: 0, included: false });
      expect((await read(uk, ukOwner.cookies)).tax).toEqual({ bp: 0, included: true });
      expect((await read(us, owner.cookies)).currency).toBe("USD");
      expect((await read(uk, ukOwner.cookies)).currency).toBe("GBP");

      const water = await addProduct(us, owner.cookies, { name: "Water", priceMinor: 199 });
      const card = await addProduct(us, owner.cookies, { name: "Gift card", priceMinor: 2500, taxed: false });
      const drink = await addProduct(uk, ukOwner.cookies, { name: "Protein shake", priceMinor: 199 });
      expect(water.currency).toBe("USD");
      expect(drink.currency).toBe("GBP");

      // No tax set: the price is the total.
      expect((await sell(us, owner.cookies, sale(water.id, 199))).statusCode).toBe(201);
      // Texas, 8.25% on top.
      expect((await put(`${base(us)}/tax`, { bp: 825, included: false }, owner.cookies)).statusCode).toBe(200);
      // The form still open at the old total sells nothing.
      const stale = await sell(us, owner.cookies, sale(water.id, 199));
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("sale_price_changed");
      expect(messageOf(stale)).toBe(REGISTER_WORDS.price_changed);
      // A total the server does not make is refused, more and less.
      expect((await sell(us, owner.cookies, sale(water.id, 1))).statusCode).toBe(409);
      expect((await sell(us, owner.cookies, sale(water.id, 216))).statusCode).toBe(409);
      expect((await sell(us, owner.cookies, sale(water.id, 215))).statusCode).toBe(201);
      expect((await sell(us, owner.cookies, sale(water.id, 646, { quantity: 3, method: "bank_transfer" }))).statusCode).toBe(201);
      // Not taxed: its price, whatever the rate.
      expect((await sell(us, owner.cookies, sale(card.id, 2500, { method: "card_at_desk" }))).statusCode).toBe(201);
      expect((await sell(us, owner.cookies, sale(card.id, 2706))).statusCode).toBe(409);

      // Leeds, 20% VAT inside the price.
      expect((await put(`${base(uk)}/tax`, { bp: 2000, included: true }, ukOwner.cookies)).statusCode).toBe(200);
      expect((await sell(uk, ukOwner.cookies, sale(drink.id, 199))).statusCode).toBe(201);
      expect((await sell(uk, ukOwner.cookies, sale(drink.id, 239))).statusCode).toBe(409);

      expect((await salesOf(us)).map((s) => [s.item_name, s.quantity, s.unit_price_minor, s.net_minor, s.tax_minor, s.total_minor, s.tax_bp, s.tax_included, s.currency, s.method])).toEqual([
        ["Water", 1, 199, 199, 0, 199, 0, false, "USD", "cash"],
        ["Water", 1, 199, 199, 16, 215, 825, false, "USD", "cash"],
        ["Water", 3, 199, 597, 49, 646, 825, false, "USD", "bank_transfer"],
        ["Gift card", 1, 2500, 2500, 0, 2500, 0, false, "USD", "card_at_desk"],
      ]);
      expect((await salesOf(uk)).map((s) => [s.item_name, s.net_minor, s.tax_minor, s.total_minor, s.tax_bp, s.tax_included, s.currency])).toEqual([["Protein shake", 166, 33, 199, 2000, true, "GBP"]]);

      // The price, the name and the tax change: no sale already made is rewritten.
      const usBefore = await salesOf(us);
      const nowWater = (await read(us, owner.cookies)).products.find((p) => p.id === water.id);
      expect((await put(`${base(us)}/products/${water.id}`, { name: "Spring water", priceMinor: 249, taxed: true, stock: null, updatedAt: nowWater?.updatedAt }, owner.cookies)).statusCode).toBe(200);
      expect((await put(`${base(us)}/tax`, { bp: 0, included: true }, owner.cookies)).statusCode).toBe(200);
      expect(await salesOf(us)).toEqual(usBefore);
      const after = await read(us, owner.cookies);
      expect(after.sales.map((s) => s.itemName).sort()).toEqual(["Gift card", "Water", "Water", "Water"]);
      expect(after.totals).toEqual({ count: 4, payments: 0, totalMinor: 199 + 215 + 646 + 2500, taxMinor: 16 + 49, cash: 199 + 215, card_at_desk: 2500, bank_transfer: 646, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0 });
      // The tax change is written to the gym's record once each, and a save that changes nothing is not.
      expect((await put(`${base(us)}/tax`, { bp: 0, included: true }, owner.cookies)).statusCode).toBe(200);
      expect((await auditOf(us, "org.sales_tax_changed")).map((a) => a.meta)).toEqual([
        { bpBefore: "0", bpAfter: "825", includedBefore: "false", includedAfter: "false" },
        { bpBefore: "825", bpAfter: "0", includedBefore: "false", includedAfter: "true" },
      ]);
      // No sale's note holds a name of a person or anything of a card.
      for (const note of await auditOf(us, "org.sale_recorded")) {
        expect(Object.keys(note.meta).sort()).toEqual(["currency", "method", "product", "productId", "quantity", "taxMinor", "totalMinor"]);
      }
    },
    T,
  );

  it(
    "a sale is the gym's own day's, is taken back once and only that day, and returns what it took from the stock",
    async () => {
      const owner = await makeUser("day-owner");
      // Honolulu is ten hours behind UTC: at 05:00 UTC it is still yesterday there.
      clock = new Date("2026-10-14T05:00:00Z");
      const gymId = await makeGym(owner, "Reg Day Honolulu", "US", "Pacific/Honolulu");
      const bar = await addProduct(gymId, owner.cookies, { name: "Bar", priceMinor: 300, stock: 5 });
      const loose = await addProduct(gymId, owner.cookies, { name: "Coffee", priceMinor: 250 });
      const first = await sell(gymId, owner.cookies, sale(bar.id, 600, { quantity: 2 }));
      const second = await sell(gymId, owner.cookies, sale(loose.id, 250, { method: "card_at_desk" }));
      expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
      const firstId = (JSON.parse(first.body) as { saleId: string }).saleId;
      const secondId = (JSON.parse(second.body) as { saleId: string }).saleId;
      let now = page(await get(base(gymId), owner.cookies));
      expect(now.today).toBe("2026-10-13");
      expect((await salesOf(gymId)).map((s) => s.sold_on)).toEqual(["2026-10-13", "2026-10-13"]);
      expect(now.sales.map((s) => [s.itemName, s.canUndo, s.undone])).toEqual([["Coffee", true, false], ["Bar", true, false]]);
      expect(await stockOf(bar.id)).toBe(3);

      // Taken back twice at one instant, and once more: taken back once.
      const undo = await Promise.all([0, 1, 2].map(() => post(`${base(gymId)}/sales/${firstId}/undo`, {}, owner.cookies)));
      expect(undo.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect((await post(`${base(gymId)}/sales/${firstId}/undo`, {}, owner.cookies)).statusCode).toBe(200);
      expect(await stockOf(bar.id)).toBe(5);
      expect(await auditOf(gymId, "org.sale_undone")).toHaveLength(1);
      now = await read(gymId, owner.cookies);
      expect(now.sales.map((s) => [s.itemName, s.canUndo, s.undone])).toEqual([["Coffee", true, false], ["Bar", false, true]]);
      expect(now.totals).toEqual({ count: 1, payments: 0, totalMinor: 250, taxMinor: 0, cash: 0, card_at_desk: 250, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0 });
      // The sale's own key again does not sell it a second time.
      expect((await salesOf(gymId)).filter((s) => !s.undone)).toHaveLength(1);

      // A product no longer counted gets nothing back; one archived still does.
      const third = await sell(gymId, owner.cookies, sale(bar.id, 300));
      const thirdId = (JSON.parse(third.body) as { saleId: string }).saleId;
      expect(await stockOf(bar.id)).toBe(4);
      const barNow = (await read(gymId, owner.cookies)).products.find((p) => p.id === bar.id);
      expect((await put(`${base(gymId)}/products/${bar.id}`, { name: "Bar", priceMinor: 300, taxed: true, stock: null, updatedAt: barNow?.updatedAt }, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${base(gymId)}/sales/${thirdId}/undo`, {}, owner.cookies)).statusCode).toBe(200);
      expect(await stockOf(bar.id)).toBeNull();

      // The next day there: yesterday's sale is not on the page and cannot be taken back.
      clock = new Date("2026-10-14T11:00:00Z");
      now = await read(gymId, owner.cookies);
      expect(now.today).toBe("2026-10-14");
      expect(now.sales).toEqual([]);
      expect(now.totals.count).toBe(0);
      const late = await post(`${base(gymId)}/sales/${secondId}/undo`, {}, owner.cookies);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late)).toBe("sale_not_today");
      expect((await salesOf(gymId)).find((s) => s.id === secondId)?.undone).toBe(false);
      // A sale that is not this gym's, or nobody's.
      const other = await makeUser("day-other");
      const otherGym = await makeGym(other, "Reg Day Other");
      expect((await post(`${base(otherGym)}/sales/${secondId}/undo`, {}, other.cookies)).statusCode).toBe(404);
      expect((await post(`${base(gymId)}/sales/00000000-0000-4000-8000-00000000dead/undo`, {}, owner.cookies)).statusCode).toBe(404);
      expect((await salesOf(gymId)).find((s) => s.id === secondId)?.undone).toBe(false);
      clock = new Date();
    },
    T,
  );

  it(
    "products: one of a name, a save over a newer one refused, archived ones not sold, and no more than the cap",
    async () => {
      const owner = await makeUser("prod-owner");
      const gymId = await makeGym(owner, "Reg Products Gym");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 199, stock: 6 });
      const taken = await post(`${base(gymId)}/products`, { name: " water ", priceMinor: 250, taxed: true, stock: null }, owner.cookies);
      expect(taken.statusCode).toBe(409);
      expect(errorOf(taken)).toBe("product_name_taken");

      // One is sold while the form is open: the form's save would put the old count back, so it is refused.
      expect((await sell(gymId, owner.cookies, sale(water.id, 199))).statusCode).toBe(201);
      const staleSave = await put(`${base(gymId)}/products/${water.id}`, { name: "Water", priceMinor: 199, taxed: true, stock: 6, updatedAt: water.updatedAt }, owner.cookies);
      expect(staleSave.statusCode).toBe(409);
      expect(errorOf(staleSave)).toBe("product_changed");
      expect(await stockOf(water.id)).toBe(5);

      // Archived: off the page, not sold, its sale kept; its name is free; put back while the name is taken is refused.
      expect((await del(`${base(gymId)}/products/${water.id}`, owner.cookies)).statusCode).toBe(200);
      const gone = await sell(gymId, owner.cookies, sale(water.id, 199));
      expect(gone.statusCode).toBe(409);
      expect(errorOf(gone)).toBe("product_not_for_sale");
      let now = await read(gymId, owner.cookies);
      expect(now.products).toEqual([]);
      expect(now.archived.map((p) => p.name)).toEqual(["Water"]);
      expect(now.archivedTotal).toBe(1);
      expect(now.sales).toHaveLength(1);
      const again = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 220 });
      const back = await post(`${base(gymId)}/products/${water.id}/restore`, {}, owner.cookies);
      expect(back.statusCode).toBe(409);
      expect(errorOf(back)).toBe("product_name_taken");
      expect((await del(`${base(gymId)}/products/${again.id}`, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${base(gymId)}/products/${water.id}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      expect((await del(`${base(gymId)}/products/${water.id}`, owner.cookies)).statusCode).toBe(200);
      expect((await del(`${base(gymId)}/products/${water.id}`, owner.cookies)).statusCode).toBe(404);

      // Next door's product is not this gym's to change.
      const other = await makeUser("prod-other");
      const otherGym = await makeGym(other, "Reg Products Other");
      const theirs = await addProduct(otherGym, other.cookies, { name: "Towel", priceMinor: 500 });
      expect((await put(`${base(gymId)}/products/${theirs.id}`, { name: "Mine now", priceMinor: 1, taxed: true, stock: null, updatedAt: theirs.updatedAt }, owner.cookies)).statusCode).toBe(404);
      expect((await del(`${base(gymId)}/products/${theirs.id}`, owner.cookies)).statusCode).toBe(404);
      expect((await read(otherGym, other.cookies)).products.map((p) => [p.name, p.priceMinor])).toEqual([["Towel", 500]]);

      // The cap.
      await sql`
        INSERT INTO gym_products (gym_id, name, price_minor, currency)
        SELECT ${gymId}, 'Filler ' || n, 100, 'USD' FROM generate_series(1, ${PRODUCTS_MAX}) AS n`;
      const over = await post(`${base(gymId)}/products`, { name: "One more", priceMinor: 100, taxed: true, stock: null }, owner.cookies);
      expect(over.statusCode).toBe(409);
      expect(errorOf(over)).toBe("too_many_products");
      now = await read(gymId, owner.cookies);
      expect(now.products).toHaveLength(PRODUCTS_MAX);
    },
    T,
  );

  it(
    "a person's purchases are theirs alone, follow them when two records are joined, and stay after they leave",
    async () => {
      const owner = await makeUser("buy-owner");
      const other = await makeUser("buy-other");
      const gymId = await makeGym(owner, "Reg Buy Gym");
      const otherGym = await makeGym(other, "Reg Buy Other");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const twin = await addPerson(gymId, owner.cookies, "Maya P");
      const omar = await addPerson(gymId, owner.cookies, "Omar Diaz");
      const theirs = await addPerson(otherGym, other.cookies, "Maya Patel");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 199 });
      const towel = await addProduct(otherGym, other.cookies, { name: "Towel", priceMinor: 500 });
      expect((await sell(gymId, owner.cookies, sale(water.id, 199, { entryId: maya }))).statusCode).toBe(201);
      const twinPress = sale(water.id, 398, { quantity: 2, entryId: twin });
      const twinSold = await sell(gymId, owner.cookies, twinPress);
      expect(twinSold.statusCode).toBe(201);
      expect((await sell(gymId, owner.cookies, sale(water.id, 199, { entryId: omar }))).statusCode).toBe(201);
      expect((await sell(gymId, owner.cookies, sale(water.id, 199))).statusCode).toBe(201);
      expect((await sell(otherGym, other.cookies, sale(towel.id, 500, { entryId: theirs }))).statusCode).toBe(201);

      const bought = async (gym: string, entryId: string, cookies: Cookies) => {
        const res = await get(`/v1/orgs/${gym}/member-list/entries/${entryId}/purchases`, cookies);
        expect(res.statusCode, res.body).toBe(200);
        return JSON.parse(res.body) as MemberPurchasesResponse;
      };
      expect((await bought(gymId, maya, owner.cookies)).sales.map((s) => [s.itemName, s.quantity, s.totalMinor])).toEqual([["Water", 1, 199]]);
      expect((await bought(gymId, omar, owner.cookies)).sales).toHaveLength(1);
      // Next door's person through this gym's address, and this gym's through next door's.
      expect((await get(`/v1/orgs/${gymId}/member-list/entries/${theirs}/purchases`, owner.cookies)).statusCode).toBe(404);
      expect((await get(`/v1/orgs/${otherGym}/member-list/entries/${maya}/purchases`, other.cookies)).statusCode).toBe(404);
      expect((await get(`/v1/orgs/${gymId}/member-list/entries/${maya}/purchases`, other.cookies)).statusCode).toBe(404);

      // Two records joined: what the one not kept bought is the kept one's.
      const merged = await post(`/v1/orgs/${gymId}/member-list/entries/${twin}/merge`, { keepEntryId: maya, acknowledgeLeavesList: true }, owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      // The same press again, its buyer's record now gone into another: the sale it made, not a refusal.
      const again = await sell(gymId, owner.cookies, twinPress);
      expect(again.statusCode, again.body).toBe(201);
      expect((JSON.parse(again.body) as { saleId: string }).saleId).toBe((JSON.parse(twinSold.body) as { saleId: string }).saleId);
      expect(await salesOf(gymId)).toHaveLength(4);
      expect((await bought(gymId, maya, owner.cookies)).sales.map((s) => [s.quantity, s.person?.entryId])).toEqual([[2, maya], [1, maya]]);
      expect((await salesOf(gymId)).filter((s) => s.entry_id === null)).toHaveLength(1);

      // Removed from the list: a past member's purchases are still theirs, and they can still buy.
      expect((await del(`/v1/orgs/${gymId}/member-list/entries/${omar}`, owner.cookies)).statusCode).toBe(200);
      expect((await bought(gymId, omar, owner.cookies)).sales).toHaveLength(1);
      const found = JSON.parse((await get(`${base(gymId)}/people?query=omar`, owner.cookies)).body) as SalePeopleResponse;
      expect(found.people.map((p) => [p.name, p.past])).toEqual([["Omar Diaz", true]]);
      expect((await sell(gymId, owner.cookies, sale(water.id, 199, { entryId: omar }))).statusCode).toBe(201);
      // Deleted for good: the sales stay in the day's takings, as a walk-in's.
      const beforeDelete = (await salesOf(gymId)).filter((x) => x.entry_id === omar).length;
      expect(beforeDelete).toBe(2);
      expect((await del(`/v1/orgs/${gymId}/member-list/former/${omar}`, owner.cookies)).statusCode).toBe(200);
      expect((await salesOf(gymId)).filter((x) => x.entry_id === omar)).toHaveLength(0);
      expect((await salesOf(gymId)).filter((x) => x.entry_id === null)).toHaveLength(1 + beforeDelete);
      expect((await read(gymId, owner.cookies)).totals.count).toBe(5);
      // The search finds this gym's people only.
      const mayas = JSON.parse((await get(`${base(gymId)}/people?query=maya`, owner.cookies)).body) as SalePeopleResponse;
      expect(mayas.people.map((p) => p.entryId)).toEqual([maya]);
    },
    T,
  );

  it(
    "the day's takings hold the membership payments recorded that day, for whoever may record one, and say a refund beside the total",
    async () => {
      const owner = await makeUser("take-owner");
      const pricer = await makeUser("take-pricer");
      const other = await makeUser("take-other");
      const gymId = await makeGym(owner, "Reg Takings Gym");
      const otherGym = await makeGym(other, "Reg Takings Other");
      await staffWith(gymId, pricer, "trainer", ["members.read", "memberships.manage"]);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const theirs = await addPerson(otherGym, other.cookies, "Noor Next");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 199 });
      const type = { name: "One month", description: null, kind: "one_time", priceMinor: 4999, termCount: 1, termUnit: "month", packClasses: null, packDays: null, access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null, includesPt: false, ptLimit: null, ptPeriod: null };
      const typeOf = async (gym: string, cookies: Cookies) => {
        const res = await post(`/v1/orgs/${gym}/membership-types`, type, cookies);
        expect(res.statusCode, res.body).toBe(201);
        const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === type.name);
        if (found === undefined) throw new Error("no type");
        return found.id;
      };
      const month = await typeOf(gymId, owner.cookies);
      const theirMonth = await typeOf(otherGym, other.cookies);
      const today = (await read(gymId, owner.cookies)).today;

      expect((await sell(gymId, owner.cookies, sale(water.id, 199))).statusCode).toBe(201);
      // A membership sold as the Sell page sells it: given as paid, by the notebook's own route.
      const given = await post(`/v1/orgs/${gymId}/member-list/entries/${maya}/memberships`, { requestKey: nextKey(), typeId: month, startsOn: today, paid: true, method: "card_at_desk" }, owner.cookies);
      expect(given.statusCode, given.body).toBe(201);
      const nextDoor = await post(`/v1/orgs/${otherGym}/member-list/entries/${theirs}/memberships`, { requestKey: nextKey(), typeId: theirMonth, startsOn: today, paid: true, method: "cash" }, other.cookies);
      expect(nextDoor.statusCode, nextDoor.body).toBe(201);

      const now = await read(gymId, owner.cookies);
      expect(now.payments?.map((p) => [p.typeName, p.amountMinor, p.method, p.person])).toEqual([["One month", 4999, "card_at_desk", { entryId: maya, name: "Maya Patel" }]]);
      expect(now.totals).toEqual({ count: 1, payments: 1, totalMinor: 199 + 4999, taxMinor: 0, cash: 199, card_at_desk: 4999, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0 });
      // Whoever cannot record a payment is sent no payment and no money from one.
      const forPricer = await read(gymId, pricer.cookies);
      expect(forPricer.payments).toBeNull();
      expect(forPricer.sales).toEqual([]);
      expect(forPricer.salesNotShown).toBe(0);
      expect(forPricer.totals).toEqual({ count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0 });

      // A refund noted today is said beside the total and taken off nothing.
      const held = JSON.parse(given.body) as { memberships: { id: string; billing: { bills: { payments: { id: string }[] }[] } | null }[] };
      const membership = held.memberships[0];
      const paymentId = membership?.billing?.bills[0]?.payments[0]?.id;
      if (membership === undefined || paymentId === undefined) throw new Error("no payment on the membership");
      const refund = await post(`/v1/orgs/${gymId}/member-list/entries/${maya}/memberships/${membership.id}/payments/${paymentId}/refunds`, { requestKey: nextKey(), amountMinor: 1000, method: "cash", reason: "charged_too_much" }, owner.cookies);
      expect(refund.statusCode, refund.body).toBe(200);
      const afterRefund = await read(gymId, owner.cookies);
      expect(afterRefund.totals).toMatchObject({ payments: 1, totalMinor: 199 + 4999, refundedMinor: 1000 });
      // The payment taken back leaves the takings: the refund first, then the payment.
      const refundId = (JSON.parse(refund.body) as { memberships: { billing: { bills: { payments: { refunds: { id: string }[] }[] }[] } | null }[] }).memberships[0]?.billing?.bills[0]?.payments[0]?.refunds[0]?.id;
      expect((await post(`/v1/orgs/${gymId}/member-list/entries/${maya}/memberships/${membership.id}/payments/${paymentId}/refunds/${String(refundId)}/undo`, {}, owner.cookies)).statusCode).toBe(200);
      expect((await post(`/v1/orgs/${gymId}/member-list/entries/${maya}/memberships/${membership.id}/payments/${paymentId}/undo`, {}, owner.cookies)).statusCode).toBe(200);
      const afterUndo = await read(gymId, owner.cookies);
      expect(afterUndo.payments).toEqual([]);
      expect(afterUndo.totals).toEqual({ count: 1, payments: 0, totalMinor: 199, taxMinor: 0, cash: 199, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0 });
      // Next door's takings are its own.
      expect((await read(otherGym, other.cookies)).totals).toMatchObject({ count: 0, payments: 1, totalMinor: 4999, cash: 4999 });
    },
    T,
  );

  it(
    "one day's total is one money: after a gym changes its country, a product still priced in the old money is not sold, and what was taken in it is added to nothing",
    async () => {
      const owner = await makeUser("money-owner");
      const gymId = await makeGym(owner, "Reg Money Gym");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const water = await addProduct(gymId, owner.cookies, { name: "Water", priceMinor: 199, stock: 10 });
      const type = { name: "One month", description: null, kind: "one_time", priceMinor: 4999, termCount: 1, termUnit: "month", packClasses: null, packDays: null, access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null, includesPt: false, ptLimit: null, ptPeriod: null };
      const made = await post(`/v1/orgs/${gymId}/membership-types`, type, owner.cookies);
      expect(made.statusCode, made.body).toBe(201);
      const month = (JSON.parse(made.body) as { types: { id: string }[] }).types[0]?.id;
      const today = (await read(gymId, owner.cookies)).today;
      // In dollars: three waters and a month.
      expect((await sell(gymId, owner.cookies, sale(water.id, 597, { quantity: 3 }))).statusCode).toBe(201);
      expect((await post(`/v1/orgs/${gymId}/member-list/entries/${maya}/memberships`, { requestKey: nextKey(), typeId: month, startsOn: today, paid: true, method: "cash" }, owner.cookies)).statusCode).toBe(201);
      expect((await read(gymId, owner.cookies)).totals).toMatchObject({ count: 1, payments: 1, totalMinor: 597 + 4999, otherCurrency: 0 });

      // The gym moves to the UK.
      const moved = await send("PATCH", `/v1/orgs/${gymId}`, owner.cookies, { country: "GB" });
      expect(moved.statusCode, moved.body).toBe(200);
      let now = await read(gymId, owner.cookies);
      expect(now.currency).toBe("GBP");
      expect(now.products.map((p) => [p.name, p.currency])).toEqual([["Water", "USD"]]);
      // Nothing in dollars is added to a total in pounds, and the page says how many there are.
      expect(now.totals).toEqual({ count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 2 });
      expect(now.sales).toHaveLength(1);
      expect(now.payments).toHaveLength(1);

      // The water still priced in dollars is not sold.
      const before = await salesOf(gymId);
      const refused = await sell(gymId, owner.cookies, sale(water.id, 199));
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("product_currency_changed");
      expect(messageOf(refused)).toBe("Water is priced in USD, and you now sell in GBP. Nothing was sold: open Water under Products and save its price in GBP.");
      expect(await salesOf(gymId)).toEqual(before);
      expect(await stockOf(water.id)).toBe(7);

      // Its price saved again is in pounds, and it sells; a product made now is in pounds.
      const saved = await put(`${base(gymId)}/products/${water.id}`, { name: "Water", priceMinor: 150, taxed: true, stock: 7, updatedAt: now.products[0]?.updatedAt }, owner.cookies);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(page(saved).products.map((p) => [p.name, p.currency, p.priceMinor])).toEqual([["Water", "GBP", 150]]);
      const bar = await addProduct(gymId, owner.cookies, { name: "Bar", priceMinor: 200 });
      expect(bar.currency).toBe("GBP");
      expect((await sell(gymId, owner.cookies, sale(water.id, 150))).statusCode).toBe(201);
      expect((await sell(gymId, owner.cookies, sale(bar.id, 200, { method: "card_at_desk" }))).statusCode).toBe(201);
      now = await read(gymId, owner.cookies);
      expect(now.totals).toEqual({ count: 2, payments: 0, totalMinor: 350, taxMinor: 0, cash: 150, card_at_desk: 200, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 2 });
      // The rows keep the money each was taken in.
      expect((await salesOf(gymId)).map((r) => [r.currency, r.total_minor])).toEqual([["USD", 597], ["GBP", 150], ["GBP", 200]]);
    },
    T,
  );

  it(
    "a membership sold at the desk is given at the price the screen showed, or not at all",
    async () => {
      const owner = await makeUser("price-owner");
      const gymId = await makeGym(owner, "Reg Price Gym");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const type = { name: "One month", description: null, kind: "one_time", priceMinor: 4999, termCount: 1, termUnit: "month", packClasses: null, packDays: null, access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null, includesPt: false, ptLimit: null, ptPeriod: null };
      const made = await post(`/v1/orgs/${gymId}/membership-types`, type, owner.cookies);
      expect(made.statusCode, made.body).toBe(201);
      const first = (JSON.parse(made.body) as { types: { id: string; updatedAt: string }[] }).types[0];
      if (first === undefined) throw new Error("no type");
      const today = (await read(gymId, owner.cookies)).today;
      // The owner puts the price up while the desk's form is open at the old one.
      const raised = await put(`/v1/orgs/${gymId}/membership-types/${first.id}`, { ...type, priceMinor: 5999, updatedAt: first.updatedAt }, owner.cookies);
      expect(raised.statusCode, raised.body).toBe(200);
      const heldUrl = `/v1/orgs/${gymId}/member-list/entries/${maya}/memberships`;
      const rowsNow = async () => ({
        held: (await sql`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`)[0]?.["n"] as number,
        paid: await sql<{ amount_minor: number }[]>`SELECT amount_minor FROM gym_member_payments WHERE gym_id = ${gymId}`,
      });

      const stale = await post(heldUrl, { requestKey: nextKey(), typeId: first.id, startsOn: today, paid: true, method: "cash", priceMinor: 4999 }, owner.cookies);
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("membership_price_changed");
      expect(messageOf(stale)).toBe("The price of this membership changed while this was open. Nothing was saved: check the total and press again.");
      expect(await rowsNow()).toEqual({ held: 0, paid: [] });
      // A price below it is refused the same way: no number but the type's own gives it.
      expect((await post(heldUrl, { requestKey: nextKey(), typeId: first.id, startsOn: today, paid: true, method: "cash", priceMinor: 1 }, owner.cookies)).statusCode).toBe(409);
      expect((await post(heldUrl, { requestKey: nextKey(), typeId: first.id, startsOn: today, paid: true, method: "cash", priceMinor: -1 }, owner.cookies)).statusCode).toBe(400);
      expect(await rowsNow()).toEqual({ held: 0, paid: [] });
      // At the price as it is now, it is given and that is what is recorded.
      expect((await post(heldUrl, { requestKey: nextKey(), typeId: first.id, startsOn: today, paid: true, method: "cash", priceMinor: 5999 }, owner.cookies)).statusCode).toBe(201);
      expect(await rowsNow()).toEqual({ held: 1, paid: [{ amount_minor: 5999 }] });
    },
    T,
  );

  it(
    "the limits at ONE address: a desk that has used its sales up stops nobody at the gym next door, and somebody refused uses up nothing",
    async () => {
      const DESK = "10.94.249.7";
      const ownerA = await makeUser("lim-a");
      const ownerB = await makeUser("lim-b");
      const second = await makeUser("lim-a2");
      const outsider = await makeUser("lim-out");
      const gymA = await makeGym(ownerA, "Reg Limit A");
      const gymB = await makeGym(ownerB, "Reg Limit B");
      await staffWith(gymA, second, "manager", null);
      const a = await addProduct(gymA, ownerA.cookies, { name: "Water", priceMinor: 199 });
      const b = await addProduct(gymB, ownerB.cookies, { name: "Water", priceMinor: 199 });
      const at = (gymId: string, who: Person, productId: string) => sell(gymId, who.cookies, sale(productId, 199), DESK);

      // Somebody who is not on the staff asks again and again from the desk's address: the gym's address is not counted.
      for (let n = 0; n < 5; n++) expect((await at(gymA, outsider, a.id)).statusCode).toBe(404);
      expect(await redis.get(`rl:orgs_register_sell:ip:${gymA}:${DESK}`)).toBeNull();

      // One person's own allowance: counted into the store, then one more.
      for (let n = 1; n < 600; n++) await redis.incrWithTtl(`rl:orgs_register_sell:id:${ownerA.userId}`, 3600);
      expect((await at(gymA, ownerA, a.id)).statusCode).toBe(201);
      expect((await at(gymA, ownerA, a.id)).statusCode).toBe(429);
      // The other person at the same desk still sells.
      expect((await at(gymA, second, a.id)).statusCode).toBe(201);
      // The gym's address used up: nobody at gym A sells from it, and gym B at the same address does.
      for (let n = 0; n < 3000; n++) await redis.incrWithTtl(`rl:orgs_register_sell:ip:${gymA}:${DESK}`, 3600);
      expect((await at(gymA, second, a.id)).statusCode).toBe(429);
      expect((await at(gymB, ownerB, b.id)).statusCode).toBe(201);
      expect(await salesOf(gymA)).toHaveLength(2);
      expect(await salesOf(gymB)).toHaveLength(1);
    },
    T,
  );
});
