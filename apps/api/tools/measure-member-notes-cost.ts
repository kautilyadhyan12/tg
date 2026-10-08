// What a person's notes and tags cost to read and to write (ROADMAP 5d; CLAUDE.md §4 "Cost
// at full size"). The launch shape: 20 gyms of 200 people, every person with 5 notes and
// 3 of the gym's 100 tags. One person holds the most the app allows: 200 notes of 2,000
// characters and 20 tags.
//
// Two numbers each: how long it takes, and how long the server's one thread is busy and
// answers nobody. Then a hundred staff reading at the same moment.
//
// And one person left with 10,000 notes of 2,000 characters by joins of full records (the
// 5d security pass's High): their page is the newest 200 whatever the pile, so it is read
// alone, by twenty staff at once, and one page further back.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-member-notes-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their lists, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { MEMBER_NOTE_MAX_CHARS, MEMBER_NOTES_MAX_PER_PERSON, MEMBER_NOTES_PAGE, MEMBER_TAGS_MAX_PER_GYM, MEMBER_TAGS_MAX_PER_PERSON } from "@app/shared";
import { addNote, addTag, deleteNote, readNotesAndTags, readOlderNotes, removeTag } from "../src/modules/orgs/memberList/notes.js";
import { createMemoryRedis } from "../src/redis.js";
import type { MemberListDeps } from "../src/modules/orgs/memberList/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-member-notes-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const PEOPLE = 200;
const RUNS = 20;
const BURST = 100;
/** The notes joins of full records leave on one person, and how many staff read them at once. */
const JOINED_NOTES = 10_000;
const JOINED_BURST = 20;
const PREFIX = "notes-cost-";
const PLAN = "zz_notes_cost";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_tags WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

await cleanup();
// Whatever happens below, the gyms and their lists are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;

  let busiest = { gymId: "", entryId: "", plainEntryId: "", joinedEntryId: "" };
  for (let g = 0; g < GYMS; g++) {
    const gymId = randomUUID();
    await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    const entries = Array.from({ length: PEOPLE }, (_, i) => {
      const id = randomUUID();
      return {
        id,
        gym_id: gymId,
        full_name: `Person${String(i)} Cost`,
        email: `${PREFIX}l-${String(i)}-${id}@example.com`,
        identity_key: createHash("sha256").update(id).digest("hex"),
        source: "upload",
      };
    });
    await sql`INSERT INTO gym_member_list_entries ${sql(entries)}`;
    await sql`
      INSERT INTO gym_member_tags (gym_id, name)
      SELECT ${gymId}, 'Tag ' || lpad(n::text, 3, '0') FROM generate_series(1, ${MEMBER_TAGS_MAX_PER_GYM - 1}) AS n`;
    await sql`
      INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key)
      SELECT e.gym_id, e.id, repeat('A short note about this person. ', 4), ${owner}, gen_random_uuid()
      FROM gym_member_list_entries e CROSS JOIN generate_series(1, 5) WHERE e.gym_id = ${gymId}`;
    await sql`
      INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id)
      SELECT e.gym_id, e.id, t.id
      FROM gym_member_list_entries e
      CROSS JOIN LATERAL (SELECT id FROM gym_member_tags WHERE gym_id = e.gym_id ORDER BY name LIMIT 3) t
      WHERE e.gym_id = ${gymId}`;
    busiest = { gymId, entryId: entries[0]?.id ?? "", plainEntryId: entries[1]?.id ?? "", joinedEntryId: entries[2]?.id ?? "" };
  }
  // One person with as much as the app allows, less one note and one tag so a write fits.
  const { gymId, entryId, plainEntryId, joinedEntryId } = busiest;
  await sql`
    INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key, created_at)
    SELECT ${gymId}, ${joinedEntryId}, repeat('x', ${MEMBER_NOTE_MAX_CHARS}), ${owner}, gen_random_uuid(), now() - n * interval '1 minute'
    FROM generate_series(1, ${JOINED_NOTES}) AS n`;
  await sql`
    INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key)
    SELECT ${gymId}, ${entryId}, repeat('x', ${MEMBER_NOTE_MAX_CHARS}), ${owner}, gen_random_uuid()
    FROM generate_series(1, ${MEMBER_NOTES_MAX_PER_PERSON - 6})`;
  await sql`
    INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id)
    SELECT ${gymId}, ${entryId}, id FROM gym_member_tags WHERE gym_id = ${gymId} ORDER BY name LIMIT ${MEMBER_TAGS_MAX_PER_PERSON - 1}
    ON CONFLICT DO NOTHING`;
  for (const table of ["gym_member_notes", "gym_member_tags", "gym_member_entry_tags", "gym_member_list_entries"]) await sql`ANALYZE ${sql(table)}`;

  const deps: MemberListDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => new Date(), invites: null };
  const yes = (): Promise<boolean> => Promise.resolve(true);
  const read = async (who: string, notes: number, tags: number): Promise<void> => {
    const state = await readNotesAndTags(deps, owner, gymId, who, yes);
    if (state === null || state.notes.length !== notes || state.tags.length !== tags || state.gymTags.length !== MEMBER_TAGS_MAX_PER_GYM - 1) {
      throw new Error(`expected ${String(notes)} notes and ${String(tags)} tags, read ${String(state?.notes.length)} and ${String(state?.tags.length)}`);
    }
  };
  /** The joined person's page as it is sent: read, and written out as the reply is. */
  const readJoined = async (): Promise<string> => {
    const state = await readNotesAndTags(deps, owner, gymId, joinedEntryId, yes);
    if (state === null || state.notes.length !== MEMBER_NOTES_PAGE || state.notesTotal !== JOINED_NOTES + 5) {
      throw new Error(`the joined page read ${String(state?.notes.length)} of ${String(state?.notesTotal)}`);
    }
    return JSON.stringify(state);
  };
  const joinedPage = await readNotesAndTags(deps, owner, gymId, joinedEntryId, yes);
  const lastShown = joinedPage?.notes[MEMBER_NOTES_PAGE - 1]?.id ?? "";
  const readOlder = async (): Promise<string> => {
    const older = await readOlderNotes(deps, owner, gymId, joinedEntryId, lastShown, yes);
    if (older === null || older.notes.length !== MEMBER_NOTES_PAGE || !older.more) throw new Error("the older page was not a full one");
    return JSON.stringify(older);
  };
  const FULL_NOTES = MEMBER_NOTES_MAX_PER_PERSON - 1;
  const FULL_TAGS = MEMBER_TAGS_MAX_PER_PERSON - 1;
  /** Save a note of the longest size, then delete it: two writes. */
  const noteAndBack = async (): Promise<void> => {
    const state = await addNote(deps, owner, gymId, entryId, { body: "y".repeat(MEMBER_NOTE_MAX_CHARS), requestKey: randomUUID() }, yes);
    const made = state?.notes[0]?.id;
    if (made === undefined) throw new Error("no note came back");
    await deleteNote(deps, owner, gymId, entryId, made, yes);
  };
  /** Put a tag of the gym's on, then take it off: two writes, the first holding the gym's row. */
  const tagAndBack = async (): Promise<void> => {
    const state = await addTag(deps, owner, gymId, entryId, { name: "Tag 099" }, yes);
    const made = state?.tags.find((tag) => tag.name === "Tag 099")?.id;
    if (made === undefined) throw new Error("no tag came back");
    await removeTag(deps, owner, gymId, entryId, made, yes);
  };

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const measure = async (name: string, run: () => Promise<unknown>): Promise<void> => {
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
      `  ${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(busy))} (worst ${fmt(Math.max(...busy))}) · longest stall ${fmt(Math.max(...stalls))}`,
    );
  };

  const usualWaits: number[] = [];
  const cpu = os.cpus()[0];
  console.log(
    `measure-member-notes-cost: ${String(GYMS)} gyms of ${String(PEOPLE)} · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`,
  );
  await measure("a usual person's page: 5 notes, 3 tags", () => read(plainEntryId, 5, 3));
  await measure(`${String(BURST)} staff reading that at the same moment`, () => Promise.all(Array.from({ length: BURST }, () => read(plainEntryId, 5, 3))));
  await measure(`the fullest page: ${String(FULL_NOTES)} notes of 2,000, ${String(FULL_TAGS)} tags`, () => read(entryId, FULL_NOTES, FULL_TAGS));
  await measure(`${String(BURST)} staff reading that at the same moment`, () => Promise.all(Array.from({ length: BURST }, () => read(entryId, FULL_NOTES, FULL_TAGS))));
  await measure("save the longest note on the fullest page, then delete it", noteAndBack);
  await measure("put a tag on the fullest page, then take it off", tagAndBack);
  const joined = JOINED_NOTES.toLocaleString("en");
  console.log(`  a person left with ${joined} notes of 2,000 by joins: the page sent is ${String(Math.round((await readJoined()).length / 1000))} kB`);
  await measure(`their page (the newest ${String(MEMBER_NOTES_PAGE)} of ${joined})`, readJoined);
  await measure(`${String(JOINED_BURST)} staff reading that at the same moment`, () => Promise.all(Array.from({ length: JOINED_BURST }, readJoined)));
  await measure("the next page back (Show older notes)", readOlder);
  await measure("a usual person's page while ten read the joined page", async () => {
    const big = Promise.all(Array.from({ length: 10 }, readJoined));
    const start = performance.now();
    await read(plainEntryId, 5, 3);
    const waited = performance.now() - start;
    await big;
    usualWaits.push(waited);
  });
  console.log(`  the usual page's own wait in those runs: median ${fmt(median(usualWaits.slice(1)))}, worst ${fmt(Math.max(...usualWaits.slice(1)))}`);
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
