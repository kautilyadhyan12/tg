// Who gets a gym's meal plan (ROADMAP Stage 2 24a-ii; spec Part 6 §16.6): the only file that reads or
// writes `gym_meal_plan_audiences`. Every statement is keyed on the gym. Which plan a person gets is
// worked out from these reads by `gymMealPlanPick.ts`.
import type { Sql, TransactionSql } from "postgres";
import type { AudienceKind, Given } from "./gymMealPlanPick.js";

type SqlOrTx = Sql | TransactionSql;
export type Group = { kind: "everyone" } | { kind: "membership_type"; membershipTypeId: string } | { kind: "tag"; tagId: string };

interface GivenDbRow {
  id: string;
  plan_id: string;
  kind: AudienceKind;
  membership_type_id: string | null;
  tag_id: string | null;
  entry_id: string | null;
  given_at: Date;
}
const asGiven = (r: GivenDbRow): Given => ({
  audienceId: r.id,
  planId: r.plan_id,
  kind: r.kind,
  target: r.kind === "membership_type" ? r.membership_type_id : r.kind === "tag" ? r.tag_id : r.kind === "member" ? r.entry_id : null,
  givenAt: r.given_at,
});

/** Every group of the gym a plan is given to. With `entryIds`, the people ticked are only those. */
export async function givenOfGym(sql: SqlOrTx, gymId: string, entryIds: readonly string[] | null = null): Promise<Given[]> {
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<GivenDbRow[]>`
    SELECT id, plan_id, kind, membership_type_id, tag_id, entry_id, given_at
    FROM gym_meal_plan_audiences
    WHERE gym_id = ${gymId} AND (kind <> 'member' OR ${ids}::uuid[] IS NULL OR entry_id = ANY(${ids}::uuid[]))`;
  return rows.map(asGiven);
}

export interface PersonRow {
  id: string;
  name: string;
  tagIds: string[];
  /** The type the list's word for them names, and whether they ever held it here. */
  word: { typeId: string; everHeld: boolean } | null;
}

/** The current records asked about (every one, for null), in the list's order of names, with their
 *  tags and the type their list's word names. Another gym's id is nobody. */
export async function people(sql: SqlOrTx, gymId: string, entryIds: readonly string[] | null): Promise<PersonRow[]> {
  if (entryIds !== null && entryIds.length === 0) return [];
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<{ id: string; full_name: string; tag_ids: string[] | null; word_type: string | null; ever_held: boolean }[]>`
    SELECT e.id, e.full_name, tg.tag_ids,
           w.type_id AS word_type,
           (w.type_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM gym_held_memberships h WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.membership_type_id = w.type_id
           )) AS ever_held
    FROM gym_member_list_entries e
    LEFT JOIN LATERAL (
      SELECT coalesce(
        (SELECT l.membership_type_id FROM gym_membership_word_links l
         WHERE l.gym_id = e.gym_id AND l.word_key = lower(btrim(e.membership_type))),
        (SELECT t.id FROM gym_membership_types t
         WHERE t.gym_id = e.gym_id AND t.archived_at IS NULL AND lower(t.name) = lower(btrim(e.membership_type)))
      ) AS type_id
      WHERE btrim(coalesce(e.membership_type, '')) <> ''
    ) w ON TRUE
    LEFT JOIN (
      SELECT t.entry_id, array_agg(t.tag_id) AS tag_ids FROM gym_member_entry_tags t
      WHERE t.gym_id = ${gymId} AND (${ids}::uuid[] IS NULL OR t.entry_id = ANY(${ids}::uuid[]))
      GROUP BY t.entry_id
    ) tg ON tg.entry_id = e.id
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND (${ids}::uuid[] IS NULL OR e.id = ANY(${ids}::uuid[]))
    ORDER BY lower(e.full_name), e.listed_seq`;
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    tagIds: r.tag_ids ?? [],
    word: r.word_type === null ? null : { typeId: r.word_type, everHeld: r.ever_held },
  }));
}

/** The gym's own time zone, for its day. */
export async function gymTimeZone(sql: SqlOrTx, gymId: string): Promise<string> {
  const rows = await sql<{ timezone: string }[]>`SELECT timezone FROM gyms WHERE id = ${gymId}`;
  const zone = rows[0]?.timezone;
  if (zone === undefined) throw new Error(`gym ${gymId} has no row`);
  return zone;
}

export interface GroupLabel {
  audienceId: string;
  name: string | null;
  givenBy: string | null;
}

/** Each group's name (a type's or tag's) and who gave it, for these plans' rows. */
export async function labels(sql: SqlOrTx, gymId: string): Promise<Map<string, GroupLabel>> {
  const rows = await sql<{ id: string; name: string | null; given_by: string | null }[]>`
    SELECT a.id, coalesce(t.name, g.name) AS name,
           CASE WHEN u.status = 'active' THEN nullif(btrim(u.display_name), '') END AS given_by
    FROM gym_meal_plan_audiences a
    LEFT JOIN gym_membership_types t ON t.gym_id = a.gym_id AND t.id = a.membership_type_id
    LEFT JOIN gym_member_tags g ON g.gym_id = a.gym_id AND g.id = a.tag_id
    LEFT JOIN users u ON u.id = a.given_by_user_id
    WHERE a.gym_id = ${gymId}`;
  return new Map(rows.map((r) => [r.id, { audienceId: r.id, name: r.name, givenBy: r.given_by }]));
}

/** The plans' names, for a plan somebody gets instead. */
export async function planNames(sql: SqlOrTx, gymId: string): Promise<Map<string, string>> {
  const rows = await sql<{ id: string; name: string }[]>`SELECT id, name FROM gym_meal_plans WHERE gym_id = ${gymId}`;
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The name of the group asked for, or null when it is not this gym's. Everybody is always there. */
export async function groupName(sql: SqlOrTx, gymId: string, group: Group): Promise<{ name: string | null } | null> {
  if (group.kind === "everyone") return { name: null };
  const rows =
    group.kind === "tag"
      ? await sql<{ name: string }[]>`SELECT name FROM gym_member_tags WHERE gym_id = ${gymId} AND id = ${group.tagId}`
      : await sql<{ name: string }[]>`SELECT name FROM gym_membership_types WHERE gym_id = ${gymId} AND id = ${group.membershipTypeId}`;
  const r = rows[0];
  return r === undefined ? null : { name: r.name };
}

/** Give a plan to a group: the group's row moves to this plan, given now, or is made. */
export async function giveToGroup(sql: SqlOrTx, gymId: string, planId: string, userId: string, group: Group): Promise<void> {
  if (group.kind === "everyone") {
    await sql`
      INSERT INTO gym_meal_plan_audiences (gym_id, plan_id, kind, given_by_user_id)
      VALUES (${gymId}, ${planId}, 'everyone', ${userId})
      ON CONFLICT (gym_id) WHERE kind = 'everyone'
      DO UPDATE SET plan_id = EXCLUDED.plan_id, given_by_user_id = EXCLUDED.given_by_user_id, given_at = now()`;
  } else if (group.kind === "tag") {
    await sql`
      INSERT INTO gym_meal_plan_audiences (gym_id, plan_id, kind, tag_id, given_by_user_id)
      VALUES (${gymId}, ${planId}, 'tag', ${group.tagId}, ${userId})
      ON CONFLICT (gym_id, tag_id) WHERE kind = 'tag'
      DO UPDATE SET plan_id = EXCLUDED.plan_id, given_by_user_id = EXCLUDED.given_by_user_id, given_at = now()`;
  } else {
    await sql`
      INSERT INTO gym_meal_plan_audiences (gym_id, plan_id, kind, membership_type_id, given_by_user_id)
      VALUES (${gymId}, ${planId}, 'membership_type', ${group.membershipTypeId}, ${userId})
      ON CONFLICT (gym_id, membership_type_id) WHERE kind = 'membership_type'
      DO UPDATE SET plan_id = EXCLUDED.plan_id, given_by_user_id = EXCLUDED.given_by_user_id, given_at = now()`;
  }
}

/** Give a plan to these records, each its own row: only the gym's current records are written.
 *  How many were given. */
export async function giveToRecords(sql: SqlOrTx, gymId: string, planId: string, userId: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_meal_plan_audiences (gym_id, plan_id, kind, entry_id, given_by_user_id)
    SELECT e.gym_id, ${planId}, 'member', e.id, ${userId}
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND e.id = ANY(${[...ids]}::uuid[])
    ON CONFLICT (gym_id, entry_id) WHERE kind = 'member'
    DO UPDATE SET plan_id = EXCLUDED.plan_id, given_by_user_id = EXCLUDED.given_by_user_id, given_at = now()
    RETURNING id`;
  return rows.length;
}

/** Stop giving a plan to these of its groups. A row of another plan or gym is left alone. */
export async function stop(sql: SqlOrTx, gymId: string, planId: string, audienceIds: readonly string[]): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_meal_plan_audiences WHERE gym_id = ${gymId} AND plan_id = ${planId} AND id = ANY(${[...audienceIds]}::uuid[])
    RETURNING id`;
  return rows.length;
}

/** The gym's live membership types and its tags, by name. */
export async function groupChoices(sql: SqlOrTx, gymId: string): Promise<{ membershipTypes: { id: string; name: string }[]; tags: { id: string; name: string }[] }> {
  const membershipTypes = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM gym_membership_types WHERE gym_id = ${gymId} AND archived_at IS NULL ORDER BY lower(name), id`;
  const tags = await sql<{ id: string; name: string }[]>`SELECT id, name FROM gym_member_tags WHERE gym_id = ${gymId} ORDER BY lower(name), id`;
  return { membershipTypes: [...membershipTypes], tags: [...tags] };
}

/** Two records joined (Merge duplicate): a plan chosen for either is the kept record's; chosen for
 *  both, the one given last stands. */
export async function moveChosen(tx: SqlOrTx, gymId: string, goneId: string, keepId: string): Promise<void> {
  await tx`
    DELETE FROM gym_meal_plan_audiences a
    WHERE a.gym_id = ${gymId} AND a.kind = 'member' AND a.entry_id IN (${goneId}, ${keepId})
      AND EXISTS (
        SELECT 1 FROM gym_meal_plan_audiences b
        WHERE b.gym_id = a.gym_id AND b.kind = 'member' AND b.entry_id IN (${goneId}, ${keepId}) AND b.id <> a.id
          AND (b.given_at, b.id) > (a.given_at, a.id)
      )`;
  await tx`UPDATE gym_meal_plan_audiences SET entry_id = ${keepId} WHERE gym_id = ${gymId} AND kind = 'member' AND entry_id = ${goneId}`;
}

/** A live member of this gym. */
export async function isLiveMember(sql: SqlOrTx, gymId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM gym_members WHERE gym_id = ${gymId} AND user_id = ${userId} AND removed_at IS NULL LIMIT 1`;
  return rows.length > 0;
}
