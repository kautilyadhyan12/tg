// What giving a member number costs at the biggest list (ROADMAP 5e-i; CLAUDE.md §4 "Cost
// at full size"): a gym with 10,000 people, numbered, plus 2,000 past members. Everything
// is written inside one transaction that is rolled back, so nothing is left behind.
//
//   DATABASE_URL=postgres://… corepack pnpm --filter api exec tsx tools/measure-member-numbers.ts
//
// Prints how long the database takes to read the numbers and how long the rule takes on
// them: the rule's time is the time the server answers nobody.
import postgres from "postgres";
import { giveMemberNumber, offeredMemberNumber } from "../src/modules/orgs/memberList/repo.js";
import { nextMemberNumber } from "../src/modules/orgs/memberList/memberNumbers.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || !/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL must be a local database");
const sql = postgres(url, { prepare: false, max: 1 });

const PEOPLE = 10_000;
const PAST = 2_000;
const RUNS = 20;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;

class RollBack extends Error {}

try {
  await sql.begin(async (tx) => {
    const owner = (await tx<{ id: string }[]>`SELECT id FROM users LIMIT 1`)[0]?.id;
    if (owner === undefined) throw new Error("the local database has no user to own the gym");
    const gym = (await tx<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id) VALUES ('measure-numbers-5e', 'Measure Numbers', ${owner}) RETURNING id`)[0]?.id;
    if (gym === undefined) throw new Error("no gym");
    await tx`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, member_number, identity_key, source, former_at)
      SELECT ${gym}, 'Person ' || i, 'p' || i || '@measure.example', 'M' || lpad(i::text, 5, '0'),
             encode(sha256(('measure' || i)::bytea), 'hex'), 'upload',
             CASE WHEN i > ${PEOPLE} THEN now() END
      FROM generate_series(1, ${PEOPLE + PAST}) AS i`;

    const reads: number[] = [];
    const rules: number[] = [];
    const gives: number[] = [];
    let offered: string | null = null;
    for (let run = 0; run < RUNS; run++) {
      let t = performance.now();
      const rows = await tx<{ n: string }[]>`
        SELECT member_number AS n FROM gym_member_list_entries WHERE gym_id = ${gym} AND member_number ~ '[0-9]$'`;
      reads.push(performance.now() - t);
      const numbers = rows.map((row) => row.n);
      t = performance.now();
      nextMemberNumber(numbers);
      rules.push(performance.now() - t);
      t = performance.now();
      offered = await offeredMemberNumber(tx, gym);
      gives.push(performance.now() - t);
    }
    let t = performance.now();
    const given = await giveMemberNumber(tx, gym);
    const giveOnce = performance.now() - t;
    t = performance.now();
    await giveMemberNumber(tx, gym);
    const giveTwice = performance.now() - t;

    console.log(`records: ${String(PEOPLE)} current + ${String(PAST)} past; ${String(RUNS)} runs each`);
    console.log(`read of the numbers (database):      median ${median(reads).toFixed(1)} ms`);
    console.log(`the rule on them (server answers nobody): median ${median(rules).toFixed(1)} ms, worst ${Math.max(...rules).toFixed(1)} ms`);
    console.log(`next-number read, whole:              median ${median(gives).toFixed(1)} ms -> ${String(offered)}`);
    console.log(`a number given (read, rule, keep):    ${giveOnce.toFixed(1)} ms -> ${String(given)}; again ${giveTwice.toFixed(1)} ms`);
    throw new RollBack();
  });
} catch (err) {
  if (!(err instanceof RollBack)) throw err;
} finally {
  await sql.end({ timeout: 5 });
}
