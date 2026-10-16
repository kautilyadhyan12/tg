// What Delete permanently costs at its biggest press (5e-ii; CLAUDE.md §4 "Cost at full
// size"): the most one press may delete, past members of a gym with 10,000 people, in one transaction
// that is rolled back, so nothing is left behind.
//
//   DATABASE_URL=postgres://… corepack pnpm --filter api exec tsx tools/measure-delete-selected.ts
//
// Prints the whole press (the database's time, under the gym's lock) and the server's own
// work on the records (the time it answers nobody).
import postgres from "postgres";
import { MEMBER_LIST_DELETE_MAX } from "@app/shared";
import { deleteEntry, recordsAmong } from "../src/modules/orgs/memberList/repo.js";
import { keptWith } from "../src/modules/orgs/memberList/memberNumbers.js";
import { selectionDigest } from "../src/modules/orgs/memberList/selection.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || !/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL must be a local database");
const sql = postgres(url, { prepare: false, max: 1 });

const PEOPLE = 10_000;

class RollBack extends Error {}

try {
  await sql.begin(async (tx) => {
    const owner = (await tx<{ id: string }[]>`SELECT id FROM users LIMIT 1`)[0]?.id;
    if (owner === undefined) throw new Error("the local database has no user to own the gym");
    const gym = (await tx<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id) VALUES ('measure-delete-5e', 'Measure Delete', ${owner}) RETURNING id`)[0]?.id;
    if (gym === undefined) throw new Error("no gym");
    const ids = (
      await tx<{ id: string }[]>`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, member_number, identity_key, source, former_at)
        SELECT ${gym}, 'Person ' || i, 'p' || i || '@measure.example', lpad(i::text, 5, '0'),
               encode(sha256(('measure-delete' || i)::bytea), 'hex'), 'upload',
               CASE WHEN i <= ${MEMBER_LIST_DELETE_MAX} THEN now() END
        FROM generate_series(1, ${PEOPLE}) AS i
        RETURNING id`
    ).map((row) => row.id);

    let t = performance.now();
    const records = await recordsAmong(tx, gym, ids.slice(0, MEMBER_LIST_DELETE_MAX));
    const read = performance.now() - t;
    t = performance.now();
    const past = records.filter((record) => record.past);
    selectionDigest(gym, past.map((record) => record.id));
    let kept: Readonly<Record<string, string>> = {};
    for (const record of past) if (record.memberNumber !== null) kept = keptWith(kept, record.memberNumber) ?? kept;
    const server = performance.now() - t;
    t = performance.now();
    for (const record of past) await deleteEntry(tx, gym, record.id, new Date());
    const deletes = performance.now() - t;

    console.log(`gym: ${String(PEOPLE)} people; press: ${String(past.length)} past members`);
    console.log(`read of the records (database):      ${read.toFixed(1)} ms`);
    console.log(`the server's own work (answers nobody): ${server.toFixed(1)} ms`);
    console.log(`the deletes (database, under the lock): ${deletes.toFixed(0)} ms`);
    throw new RollBack();
  });
} catch (err) {
  if (!(err instanceof RollBack)) throw err;
} finally {
  await sql.end({ timeout: 5 });
}
