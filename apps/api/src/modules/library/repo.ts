// The Exercise Library's tables (spec Part 2 §13.4, job 60b; migration 0243): the only file that
// touches `library_exercises` and `library_copies`, and the only Library file that touches
// `exercises`. The Library is one list for the whole app, not a business's or a person's: no row
// has an owner, so no owner goes in a WHERE.
import type { Sql, TransactionSql } from "postgres";
import { libraryListSchema, type LibraryEntry } from "@app/shared";
import { sha256 } from "./canonical.js";
import type { PublishedRow } from "./plan.js";

export type Channel = "live" | "beta";

/** One publish at a time, everywhere: the seed of every test file and every deploy publish the
 *  same folder, and the second waits for the first and then finds nothing changed. */
export async function lockPublishing(tx: TransactionSql): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext('library:publish'))`;
}

/** Every Library row, removed ones included. `old` is one of the old 58: its `exercises` row has the
 *  old facts, so the old save route can still name it. */
export async function publishedRows(tx: TransactionSql): Promise<PublishedRow[]> {
  const rows = await tx<{ exercise_id: string; slug: string; status: string; old: boolean; entry: unknown }[]>`
    SELECT l.exercise_id, e.slug, l.status, e.family IS NOT NULL AS old, l.entry
    FROM library_exercises l JOIN exercises e ON e.id = l.exercise_id`;
  return rows.map((r) => ({ exerciseId: r.exercise_id, slug: r.slug, status: r.status, old: r.old, entry: r.entry }));
}

/** Of these exercises, the ones a saved set names: one index lookup for each (workout_sets'
 *  exercise index), never a read of every set. */
export async function namedBySavedSets(tx: TransactionSql, exerciseIds: readonly string[]): Promise<Set<string>> {
  if (exerciseIds.length === 0) return new Set();
  const rows = await tx<{ id: string }[]>`
    SELECT x.id FROM unnest(${[...exerciseIds]}::uuid[]) AS x(id)
    WHERE EXISTS (SELECT 1 FROM workout_sets s WHERE s.exercise_id = x.id)`;
  return new Set(rows.map((r) => r.id));
}

/** The `exercises` row for each id word, making one where there is none. A row made here is not one
 *  of the old 58: it is 'hidden' to the old routes and has none of their old facts (0243). */
export async function exerciseRowsFor(
  tx: TransactionSql,
  wanted: readonly { slug: string; met: number }[],
): Promise<Map<string, string>> {
  if (wanted.length === 0) return new Map();
  await tx`
    INSERT INTO exercises (slug, name_key, family, tier, tracking, status, met)
    SELECT x.slug, NULL, NULL, NULL, NULL, 'hidden', x.met
    FROM jsonb_to_recordset(${tx.json(wanted.map((w) => ({ slug: w.slug, met: w.met })))}::jsonb) AS x(slug text, met numeric)
    ON CONFLICT (slug) DO NOTHING`;
  const rows = await tx<{ id: string; slug: string }[]>`
    SELECT id, slug FROM exercises WHERE slug = ANY(${wanted.map((w) => w.slug)}::text[])`;
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Writes each row's facts and entry in one statement. The MET on a row the Library made in
 *  `exercises` follows it; the old 58 rows' own MET is never changed (the old pages reckon with it). */
export async function writeRows(tx: TransactionSql, rows: readonly { exerciseId: string; entry: LibraryEntry }[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) => ({
    exercise_id: r.exerciseId,
    status: r.entry.status,
    met: r.entry.met,
    compendium: r.entry.energy.compendium,
    measured_in: r.entry.set.measuredIn,
    weight: r.entry.set.weight,
    each_side: r.entry.set.eachSide,
    entry: r.entry,
  }));
  await tx`
    INSERT INTO library_exercises (exercise_id, status, met, compendium, measured_in, weight, each_side, entry, updated_at)
    SELECT x.exercise_id, x.status, x.met, x.compendium, x.measured_in, x.weight, x.each_side, x.entry, now()
    FROM jsonb_to_recordset(${tx.json(values)}::jsonb)
      AS x(exercise_id uuid, status text, met numeric, compendium text, measured_in text, weight text, each_side boolean, entry jsonb)
    ON CONFLICT (exercise_id) DO UPDATE SET
      status = EXCLUDED.status, met = EXCLUDED.met, compendium = EXCLUDED.compendium,
      measured_in = EXCLUDED.measured_in, weight = EXCLUDED.weight, each_side = EXCLUDED.each_side,
      entry = EXCLUDED.entry, updated_at = now()`;
  await tx`
    UPDATE exercises e SET met = x.met
    FROM jsonb_to_recordset(${tx.json(values.map((v) => ({ id: v.exercise_id, met: v.met })))}::jsonb) AS x(id uuid, met numeric)
    WHERE e.id = x.id AND e.family IS NULL AND e.met <> x.met`;
}

/** Marks rows removed: out of the download, their entry kept. A Library row is never deleted. */
export async function markRemoved(tx: TransactionSql, exerciseIds: readonly string[]): Promise<void> {
  if (exerciseIds.length === 0) return;
  await tx`
    UPDATE library_exercises SET status = 'removed', updated_at = now()
    WHERE exercise_id = ANY(${[...exerciseIds]}::uuid[]) AND status <> 'removed'`;
}

export interface CopyHead {
  version: number;
  sha256: string;
}

export async function newestCopy(sql: Sql | TransactionSql, channel: Channel): Promise<CopyHead | null> {
  const rows = await sql<{ version: number; sha256: string }[]>`
    SELECT version, sha256 FROM library_copies WHERE channel = ${channel}
    ORDER BY version DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function addCopy(tx: TransactionSql, channel: Channel, sha256: string, body: string): Promise<number> {
  const rows = await tx<{ version: number }[]>`
    INSERT INTO library_copies (channel, sha256, body) VALUES (${channel}, ${sha256}, ${body})
    RETURNING version`;
  const row = rows[0];
  if (row === undefined) throw new Error("library_copies insert returned no row");
  return row.version;
}

/** The newest copy a person on this channel downloads: a tester on beta is given live while beta
 *  has no copy. */
export async function newestCopyFor(sql: Sql | TransactionSql, channel: Channel): Promise<CopyHead | null> {
  return (await newestCopy(sql, channel)) ?? (channel === "beta" ? await newestCopy(sql, "live") : null);
}

/** One copy's text, checked before it reaches any phone: it must match its fingerprint and read as a
 *  list. A copy that does not is a fault of the server's own data, so this throws (a 500). */
export async function checkedCopyText(sql: Sql | TransactionSql, version: number): Promise<string> {
  const rows = await sql<{ sha256: string; body: string }[]>`
    SELECT sha256, body FROM library_copies WHERE version = ${version}`;
  const copy = rows[0];
  if (copy === undefined) throw new Error(`library copy ${String(version)} is gone`);
  if (sha256(copy.body) !== copy.sha256) throw new Error(`library copy ${String(version)} does not match its fingerprint`);
  libraryListSchema.parse(JSON.parse(copy.body));
  return copy.body;
}

/** The rules of the one flag that puts a person on beta (Part 2 §9.3): the same flag as the old
 *  definitions' beta, so a tester is on beta for both. */
export async function betaFlagRules(sql: Sql | TransactionSql): Promise<unknown> {
  const rows = await sql<{ rules: unknown }[]>`SELECT rules FROM feature_flags WHERE key = 'beta_definitions'`;
  return rows[0]?.rules ?? null;
}
