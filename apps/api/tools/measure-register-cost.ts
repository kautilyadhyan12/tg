// What the Sell page costs (ROADMAP 18b-i; CLAUDE.md §4 "Cost at full size"). One gym at
// the biggest size the app sells, 2,000 people on its list with three former records for
// each, 50 products and a year of 300 sales a day, beside 19 gyms of 200 with 30 sales a
// day. Today holds a full day's sales in every gym.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. For each thing staff do: open the page, find a person as they type,
// record a sale, open a person's purchases.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-register-cost.ts
//
// --keep leaves the gyms in place for a look at a statement's plan; --clean removes them
// and measures nothing.
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, products and sales, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { findPeople, getPurchases, getRegister, sellProduct, type RegisterDeps } from "../src/modules/orgs/register/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-register-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const KEEP = process.argv.includes("--keep");
const CLEAN_ONLY = process.argv.includes("--clean");
const PEOPLE = 2000;
const FORMER_EACH = 3;
const PRODUCTS = 50;
const DAYS = 365;
const BIG_SALES_A_DAY = 300;
const OTHER_GYMS = 19;
const OTHER_PEOPLE = 200;
const OTHER_SALES_A_DAY = 30;
const RUNS = 20;
const PREFIX = "register-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_sales WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_products WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
}

const DAY_MS = 86_400_000;
const now = new Date();
const TZ = "Europe/London";
const [{ today } = { today: "" }] = await sql<{ today: string }[]>`SELECT to_char((${now}::timestamptz AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS today`;

interface Made {
  gymId: string;
  owner: string;
  sales: number;
  productId: string;
  buyer: string;
}

async function makeGym(people: number, salesADay: number): Promise<Made> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, sales_tax_bp, sales_tax_included) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', ${TZ}, 'GB', ${owner}, 2000, true)`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;

  const total = people * (1 + FORMER_EACH);
  const entries = Array.from({ length: total }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      gym_id: gymId,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}l-${String(i)}-${id}@example.com`,
      identity_key: createHash("sha256").update(id).digest("hex"),
      source: "upload",
      created_at: new Date(now.getTime() - 400 * DAY_MS),
      former_at: i >= people ? new Date(now.getTime() - 200 * DAY_MS) : null,
    };
  });
  for (let i = 0; i < entries.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;

  const products = Array.from({ length: PRODUCTS }, (_, i) => ({ id: randomUUID(), gym_id: gymId, name: `Product ${String(i)}`, price_minor: 100 + i * 25, currency: "GBP", taxed: i % 5 !== 0, stock: i % 2 === 0 ? 100_000 : null }));
  await sql`INSERT INTO gym_products ${sql(products)}`;
  const productIds = products.map((p) => p.id);
  const entryIds = entries.slice(0, people).map((e) => e.id);

  // A year of sales, the newest day today: two in three for a member, the rest walk-ins.
  await sql`
    INSERT INTO gym_sales (gym_id, request_key, product_id, entry_id, item_name, quantity, unit_price_minor, net_minor, tax_minor, total_minor,
                           tax_bp, tax_included, currency, method, sold_on, recorded_by, created_at)
    SELECT ${gymId}, gen_random_uuid(), (${productIds}::uuid[])[1 + (n % ${PRODUCTS})],
           CASE WHEN n % 3 = 0 THEN NULL ELSE (${entryIds}::uuid[])[1 + (n % ${people})] END,
           'Product ' || (n % ${PRODUCTS}), 1, 240, 200, 40, 240, 2000, true, 'GBP',
           (ARRAY['cash','card_at_desk','bank_transfer'])[1 + (n % 3)],
           ${today}::date - d, ${owner}, ${now}::timestamptz - make_interval(days => d, mins => n)
    FROM generate_series(0, ${DAYS - 1}) AS d, generate_series(0, ${salesADay - 1}) AS n`;
  return { gymId, owner, sales: DAYS * salesADay, productId: products[1]?.id ?? "", buyer: entryIds[1] ?? "" };
}

await cleanup();
if (CLEAN_ONLY) {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
// Whatever happens below, the gyms and what they hold are removed.
try {
  const big = await makeGym(PEOPLE, BIG_SALES_A_DAY);
  const others: Made[] = [];
  for (let i = 0; i < OTHER_GYMS; i++) others.push(await makeGym(OTHER_PEOPLE, OTHER_SALES_A_DAY));
  for (const table of ["gym_member_list_entries", "gym_sales", "gym_products", "users"]) await sql`ANALYZE ${sql(table)}`;

  const deps: RegisterDeps = { sql, now: () => now };
  const viewer = { timezone: TZ, canSell: true, canManage: true, seesEmail: true };
  const open = async (gym: Made, salesADay: number): Promise<number> => {
    const page = await getRegister(deps, gym.gymId, viewer);
    if (page.totals.count !== salesADay || page.products.length !== PRODUCTS) throw new Error(`read ${String(page.totals.count)} sales and ${String(page.products.length)} products`);
    return JSON.stringify(page).length;
  };
  const find = async (gym: Made, query: string): Promise<void> => {
    const found = await findPeople(deps, gym.gymId, viewer, query);
    if (found.people.length === 0) throw new Error("the search found nobody");
  };
  // Not taxed, not counted: the price is the total, and the day's count is put back after.
  const product = (gym: Made) => sql<{ id: string; price_minor: number }[]>`SELECT id, price_minor FROM gym_products WHERE gym_id = ${gym.gymId} AND NOT taxed AND stock IS NULL LIMIT 1`;
  const [untaxed] = await product(big);
  if (untaxed === undefined) throw new Error("no product to sell");
  const sold: string[] = [];
  const sell = async (gym: Made): Promise<void> => {
    const answer = await sellProduct(deps, gym.owner, gym.gymId, viewer, { requestKey: randomUUID(), productId: untaxed.id, quantity: 1, entryId: gym.buyer, method: "cash", totalMinor: untaxed.price_minor, discountId: null });
    sold.push(answer.saleId);
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });

  async function measure(name: string, run: () => Promise<unknown>): Promise<void> {
    const walls: number[] = [];
    const busy: number[] = [];
    const stalls: number[] = [];
    for (let i = 0; i < RUNS + 1; i++) {
      delay.reset();
      delay.enable();
      const before = performance.eventLoopUtilization();
      const start = performance.now();
      await run();
      const wall = performance.now() - start;
      delay.disable();
      // The first run warms the connections and is not counted.
      if (i === 0) continue;
      walls.push(wall);
      busy.push(performance.eventLoopUtilization(before).active);
      stalls.push(delay.max / 1e6);
    }
    console.log(
      `  ${name.padEnd(46)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  }

  const cpu = os.cpus()[0];
  console.log(`measure-register-cost: ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`);
  console.log(
    `one gym of ${String(PEOPLE)} on its list (${String(PEOPLE * (1 + FORMER_EACH))} records) with ${String(PRODUCTS)} products and ${String(big.sales)} sales in a year, ${String(BIG_SALES_A_DAY)} of them today, beside ${String(OTHER_GYMS)} gyms of ${String(OTHER_PEOPLE)} with ${String(others[0]?.sales ?? 0)} sales each`,
  );
  console.log(`  the big gym's page is ${String(await open(big, BIG_SALES_A_DAY))} characters`);
  await measure("the big gym opens Sell, one read", () => open(big, BIG_SALES_A_DAY));
  await measure("its 5 staff at the same moment", () => Promise.all(Array.from({ length: 5 }, () => open(big, BIG_SALES_A_DAY))));
  await measure("one gym of 200 opens Sell", () => open(others[0] ?? big, OTHER_SALES_A_DAY));
  await measure("all 20 gyms open Sell at the same moment", () => Promise.all([open(big, BIG_SALES_A_DAY), ...others.map((gym) => open(gym, OTHER_SALES_A_DAY))]));
  await measure("find a person, a name most records hold", () => find(big, "pers"));
  await measure("find a person, one record's name", () => find(big, "Person1999 "));
  await measure("find a person, all 20 gyms at one moment", () => Promise.all([find(big, "son19"), ...others.map((gym) => find(gym, "son19"))]));
  await measure("one person's purchases", () => getPurchases(deps, big.gymId, viewer, big.buyer));
  await measure("one sale recorded, and the page read after it", () => sell(big));
  await sql`DELETE FROM gym_sales WHERE id = ANY(${sold}::uuid[])`;
  sold.length = 0;
  await measure("5 staff each record a sale at one moment", () => Promise.all(Array.from({ length: 5 }, () => sell(big))));
  if (KEEP) console.log(`kept: the big gym is ${big.gymId}`);
} finally {
  if (!KEEP) await cleanup();
  await sql.end({ timeout: 5 });
}
