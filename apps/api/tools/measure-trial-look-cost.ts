// What the "have a look" list costs at full size (2e-ii; CLAUDE.md §4 "Cost at full size"):
// 20,000 gyms in 50 cities, every one with an address, 200 of them on a free trial, in one
// transaction that is rolled back, so nothing is left behind.
//
//   DATABASE_URL=postgres://… corepack pnpm --filter api exec tsx tools/measure-trial-look-cost.ts
//
// Prints the whole read (the database and the server) and the server's own work on the gyms
// (the time it answers nobody, when the admin page reads the list).
import postgres from "postgres";
import { trialClues, type LookGym } from "../src/modules/orgs/trialLook/clues.js";
import { trialLookWarnings } from "../src/modules/orgs/trialLook/repo.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || !/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL must be a local database");
const sql = postgres(url, { prepare: false, max: 1 });

const GYMS = 20_000;
const TRIALS = 200;
const CITIES = 50;
const OWNERS = 2_000;
const WORDS = ["Iron", "Power", "Muscle", "Spartan", "Titan", "Beast", "Body", "Core", "Pulse", "Flex",
  "Elite", "Prime", "Alpha", "Zen", "Urban", "Royal", "Gold", "Steel", "Peak", "Strong"];
const KINDS = ["Gym", "Fitness", "Studio", "Club", "Fitness Centre", "Yoga", "MMA", "CrossFit"];

class RollBack extends Error {}

try {
  await sql.begin(async (tx) => {
    const owners = (await tx<{ id: string }[]>`
      INSERT INTO users (email, display_name)
      SELECT 'measure-trial-look-' || i || '@gmail.com', 'Measure ' || i FROM generate_series(1, ${OWNERS}) AS i
      RETURNING id`).map((r) => r.id);
    const gyms = (await tx<{ id: string }[]>`
      INSERT INTO gyms (slug, name, city, postal_address, owner_user_id, created_at)
      SELECT 'measure-trial-look-' || i,
             (${WORDS}::text[])[1 + i % 20] || ' ' || (${WORDS}::text[])[1 + (i / 20) % 20] || ' ' || (${KINDS}::text[])[1 + (i / 400) % 8],
             'City ' || (i % ${CITIES}),
             'Shop ' || (i % 300) || ', ' || (i % 97) || ' Market Road, City ' || (i % ${CITIES}) || ' ' || (400000 + i % 500),
             (${owners}::uuid[])[1 + i % ${OWNERS}],
             now() - make_interval(mins => ${GYMS} - i)
      FROM generate_series(1, ${GYMS}) AS i
      ORDER BY i
      RETURNING id`).map((r) => r.id);
    await tx`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at)
      SELECT 'gym', g, (SELECT id FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1), 'trialing', 'none', now() + INTERVAL '10 days'
      FROM unnest(${gyms.slice(-TRIALS)}::uuid[]) AS g`;

    const times: number[] = [];
    let count = 0;
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      count = (await trialLookWarnings(tx)).length;
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`whole read, ${String(GYMS)} gyms, ${String(TRIALS)} on a free trial: median ${times[2]?.toFixed(1) ?? "?"} ms, ${String(count)} gyms listed`);

    // The server's own part: the same rows, compared in memory.
    const rows = await tx<{ id: string; name: string; city: string | null; postal_address: string | null; owner_user_id: string; created_at: Date }[]>`
      SELECT id, name, city, postal_address, owner_user_id, created_at FROM gyms WHERE slug LIKE 'measure-trial-look-%'`;
    const all: LookGym[] = rows.map((r) => ({
      id: r.id, name: r.name, city: r.city, address: r.postal_address, owner: r.owner_user_id, createdAt: r.created_at,
    }));
    const trialIds = new Set(gyms.slice(-TRIALS));
    const trials = all.filter((g) => trialIds.has(g.id)).map((g) => ({ ...g, firstPeopleGymId: null }));
    const js: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      trialClues(trials, all);
      js.push(performance.now() - t);
    }
    js.sort((a, b) => a - b);
    console.log(`the server's own work (answering nobody): median ${js[2]?.toFixed(1) ?? "?"} ms`);
    throw new RollBack();
  });
} catch (e) {
  if (!(e instanceof RollBack)) throw e;
} finally {
  await sql.end();
}
