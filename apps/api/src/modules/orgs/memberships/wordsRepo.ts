// A list's membership word linked to a type (spec Part 3 §13.2; ROADMAP 17a-iii).
//
// Every statement carries `gym_id` in its WHERE. A word is matched whole with its
// capitals folded by Postgres on both sides (`lower`), the fold the list's own chips
// use, so "Gold" is "GOLD" and never "Gold Plus". The link takes the gym's row and
// then the records', as every other write of a held membership does (`heldRepo.ts`),
// and gives everybody their membership in one statement or nobody.
import type { Sql, TransactionSql } from "postgres";
import {
  HELD_LIVE_MAX,
  MEMBER_LIST_STATUS_CHIPS_MAX,
  type HeldMembershipTypeChoice,
  type MembershipLinkGroup,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { lockEntries, lockGym } from "../memberList/repo.js";
import { inUseByRule, liveTypes, typeChoice } from "./heldRepo.js";
import { placePeople, type PlacedPerson, type WordPerson } from "./words.js";

export interface WordRow {
  word: string;
  people: number;
  link: { typeId: string; typeName: string; typeArchived: boolean; waiting: number } | null;
}

/** The list's membership words in the list's own order, each with its link, and the
 *  gym's live types. */
export async function readWords(sql: Sql, gymId: string): Promise<{ words: WordRow[]; types: HeldMembershipTypeChoice[] }> {
  return await sql.begin("isolation level repeatable read read only", async (tx) => {
    const rows = await tx<
      { word: string; people: number; type_id: string | null; type_name: string | null; archived: boolean | null; waiting: number }[]
    >`
      WITH mine AS MATERIALIZED (
        SELECT membership_type, listed_seq FROM gym_member_list_entries
        WHERE gym_id = ${gymId} AND former_at IS NULL AND membership_type IS NOT NULL AND membership_type <> ''
      ),
      grouped AS (
        SELECT lower(membership_type) AS key,
               (array_agg(membership_type ORDER BY listed_seq))[1] AS word,
               count(*)::int AS people,
               min(listed_seq) AS first_seq
        FROM mine GROUP BY lower(membership_type)
      ),
      -- How many people with each linked word have ever held its type. From the link to
      -- its memberships to their records, each step by an index: a join of the whole list
      -- against the gym's memberships took a second straight after 2,100 were given.
      holding AS MATERIALIZED (
        SELECT l.word_key AS key, count(DISTINCT h.entry_id)::int AS holders
        FROM gym_membership_word_links l
        JOIN gym_held_memberships h ON h.gym_id = l.gym_id AND h.membership_type_id = l.membership_type_id
        JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
        WHERE l.gym_id = ${gymId} AND e.former_at IS NULL AND lower(e.membership_type) = l.word_key
        GROUP BY l.word_key
      )
      SELECT g.word, g.people, l.membership_type_id AS type_id, t.name AS type_name,
             (t.archived_at IS NOT NULL) AS archived,
             -- The people with the word who have never held the type it is linked to.
             CASE WHEN l.membership_type_id IS NULL THEN 0
                  ELSE GREATEST(g.people - coalesce(ho.holders, 0), 0) END AS waiting
      FROM grouped g
      LEFT JOIN gym_membership_word_links l ON l.gym_id = ${gymId} AND l.word_key = g.key
      LEFT JOIN holding ho ON ho.key = g.key
      LEFT JOIN gym_membership_types t ON t.gym_id = ${gymId} AND t.id = l.membership_type_id
      ORDER BY g.first_seq
      LIMIT ${MEMBER_LIST_STATUS_CHIPS_MAX}`;
    const types = await liveTypes(tx, gymId, null);
    return {
      words: rows.map((row) => ({
        word: row.word,
        people: row.people,
        link:
          row.type_id === null || row.type_name === null
            ? null
            : { typeId: row.type_id, typeName: row.type_name, typeArchived: row.archived === true, waiting: row.waiting },
      })),
      types: types.map(typeChoice),
    };
  });
}

interface PersonRow {
  id: string;
  full_name: string;
  ends_on: string | null;
  ends_on_kind: string | null;
  held_type: boolean;
  in_use: number;
}

/** `ends_on_kind` is text under a CHECK: a value this build does not know reads as the
 *  list's default, an end day. */
const kindOf = (kind: string | null): "ends" | "renews" | null => (kind === null ? null : kind === "renews" ? "renews" : "ends");

/** The word as the list wrote it first, and how many past members carry it; `word`
 *  is null where nobody on the list has it now. */
async function wordOnList(tx: TransactionSql, gymId: string, word: string): Promise<{ word: string | null; past: number }> {
  const [row] = await tx<{ word: string | null; past: number }[]>`
    SELECT (array_agg(membership_type ORDER BY listed_seq) FILTER (WHERE former_at IS NULL))[1] AS word,
           count(*) FILTER (WHERE former_at IS NOT NULL)::int AS past
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND lower(membership_type) = lower(${word})`;
  return { word: row?.word ?? null, past: row?.past ?? 0 };
}

/** Everybody on the list who carries the word, by name; `only` narrows it to records
 *  already locked. */
async function peopleWithWord(
  tx: TransactionSql,
  gymId: string,
  word: string,
  typeId: string,
  today: string,
  only: readonly string[] | null,
): Promise<WordPerson[]> {
  const rows = await tx<PersonRow[]>`
    SELECT e.id, e.full_name, e.ends_on::text AS ends_on, e.ends_on_kind,
           EXISTS (
             SELECT 1 FROM gym_held_memberships h
             WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.membership_type_id = ${typeId}
           ) AS held_type,
           (SELECT count(*)::int FROM gym_held_memberships h
            WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.status IN ('active','frozen')) AS in_use
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND lower(e.membership_type) = lower(${word})
      AND (${only === null} OR e.id = ANY(${only === null ? [] : [...only]}::uuid[]))
    ORDER BY lower(e.full_name), e.id`;
  const people = rows.map(
    (r): WordPerson => ({
      entryId: r.id,
      fullName: r.full_name,
      endsOn: r.ends_on,
      endsOnKind: kindOf(r.ends_on_kind),
      heldType: r.held_type,
      inUse: r.in_use,
    }),
  );
  // A stored `active` row may be one the clock has ended: the few people at the cap
  // are counted again by the rule, so nobody is refused for memberships that are over.
  const atCap = people.filter((p) => p.inUse >= HELD_LIVE_MAX).map((p) => p.entryId);
  if (atCap.length === 0) return people;
  const counted = await inUseByRule(tx, gymId, atCap, today);
  return people.map((p) => (p.inUse >= HELD_LIVE_MAX ? { ...p, inUse: counted.get(p.entryId) ?? 0 } : p));
}

/** `placePeople` a few hundred at a time, letting the server answer other requests in
 *  between: a list holds up to 10,000 people, and placing them in one go kept the one
 *  thread busy for a quarter of a second. */
const TURN = 250;
async function placeInTurns(
  people: readonly WordPerson[],
  type: HeldMembershipTypeChoice,
  paid: boolean,
  today: string,
): Promise<PlacedPerson[]> {
  const placed: PlacedPerson[] = [];
  for (let at = 0; at < people.length; at += TURN) {
    if (at > 0) await new Promise<void>((resolve) => setImmediate(resolve));
    placed.push(...placePeople(people.slice(at, at + TURN), type, paid, today));
  }
  return placed;
}

export type WordPreview =
  | { kind: "ok"; word: string; past: number; type: HeldMembershipTypeChoice; placed: PlacedPerson[] }
  | { kind: "word_not_found" }
  | { kind: "type_not_found" };

/** What linking the word to the type would do today. Nothing is written. */
export async function previewLink(
  sql: Sql,
  input: { gymId: string; word: string; typeId: string; today: string },
): Promise<WordPreview> {
  return await sql.begin("isolation level repeatable read read only", async (tx): Promise<WordPreview> => {
    const onList = await wordOnList(tx, input.gymId, input.word);
    if (onList.word === null) return { kind: "word_not_found" };
    const [rawType] = await liveTypes(tx, input.gymId, input.typeId);
    if (rawType === undefined) return { kind: "type_not_found" };
    const type = typeChoice(rawType);
    const people = await peopleWithWord(tx, input.gymId, input.word, input.typeId, input.today, null);
    return { kind: "ok", word: onList.word, past: onList.past, type, placed: await placeInTurns(people, type, false, input.today) };
  });
}

export type LinkOutcome =
  | { kind: "ok"; given: number }
  | { kind: "word_not_found" }
  | { kind: "type_not_found" }
  /** The word is linked to another type already. */
  | { kind: "linked_elsewhere"; typeName: string }
  /** The people the box showed are not the people the list holds now. */
  | { kind: "changed" }
  /** People the list does not settle were ticked, and nobody said whether they paid. */
  | { kind: "paid_not_answered" };

const GIVE_GROUPS = ["settled", "due", "ask"] as const satisfies readonly MembershipLinkGroup[];
type GiveGroup = (typeof GIVE_GROUPS)[number];
const isGiveGroup = (group: MembershipLinkGroup): group is GiveGroup => GIVE_GROUPS.some((g) => g === group);

export async function linkWord(
  sql: Sql,
  input: {
    gymId: string;
    word: string;
    typeId: string;
    groups: Record<GiveGroup, boolean>;
    expected: Record<GiveGroup, number>;
    paid: boolean | null;
    /** The gym's own day. */
    today: string;
    actorUserId: string;
  },
): Promise<LinkOutcome> {
  return await sql.begin(async (tx): Promise<LinkOutcome> => {
    await lockGym(tx, input.gymId);
    const onList = await wordOnList(tx, input.gymId, input.word);
    if (onList.word === null) return { kind: "word_not_found" };

    const [linked] = await tx<{ membership_type_id: string; name: string }[]>`
      SELECT l.membership_type_id, t.name
      FROM gym_membership_word_links l
      JOIN gym_membership_types t ON t.gym_id = l.gym_id AND t.id = l.membership_type_id
      WHERE l.gym_id = ${input.gymId} AND l.word_key = lower(${input.word})`;
    if (linked !== undefined && linked.membership_type_id !== input.typeId) {
      return { kind: "linked_elsewhere", typeName: linked.name };
    }

    const [rawType] = await liveTypes(tx, input.gymId, input.typeId);
    if (rawType === undefined) return { kind: "type_not_found" };
    const type = typeChoice(rawType);

    // The records are held, then read: a join of two records or a delete waits.
    const ids = await tx<{ id: string }[]>`
      SELECT id FROM gym_member_list_entries
      WHERE gym_id = ${input.gymId} AND former_at IS NULL AND lower(membership_type) = lower(${input.word})`;
    await lockEntries(tx, input.gymId, ids.map((row) => row.id));
    const people = await peopleWithWord(tx, input.gymId, input.word, input.typeId, input.today, ids.map((row) => row.id));
    const placed = await placeInTurns(people, type, input.paid ?? false, input.today);

    const count = (group: GiveGroup) => placed.filter((p) => p.group === group).length;
    if (GIVE_GROUPS.some((group) => count(group) !== input.expected[group])) return { kind: "changed" };
    if (input.groups.ask && count("ask") > 0 && input.paid === null) return { kind: "paid_not_answered" };

    const rows = placed.flatMap((p) =>
      p.membership !== null && isGiveGroup(p.group) && input.groups[p.group]
        ? [
            {
              entry_id: p.person.entryId,
              starts_on: p.membership.startsOn,
              frozen_days: p.membership.frozenDays,
              paid_periods: p.membership.paidPeriods,
              paid_floor: p.membership.paidFloor,
              // Its start day was worked back from the list's day; with no day it starts today.
              from_list: p.person.endsOn !== null,
            },
          ]
        : [],
    );
    if (rows.length > 0) {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO gym_held_memberships
          (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency,
           term_count, term_unit, pack_classes, pack_days, starts_on, frozen_days, status,
           paid_periods, paid_floor, renews, classes_left, from_list)
        SELECT ${input.gymId}, r.entry_id, ${input.typeId}, gen_random_uuid(), ${type.kind},
               ${type.priceMinor}, ${type.currency}, ${type.termCount}::int, ${type.termUnit}::text,
               ${type.packClasses}::int, ${type.packDays}::int, r.starts_on, r.frozen_days, 'active',
               r.paid_periods, r.paid_floor, ${type.kind === "recurring"},
               ${type.kind === "pack" ? type.packClasses : null}::int, r.from_list
        FROM jsonb_to_recordset(${tx.json(rows)})
          AS r(entry_id uuid, starts_on date, frozen_days int, paid_periods int, paid_floor int,
               from_list boolean)
        RETURNING id`;
      if (inserted.length !== rows.length) throw new Error("a linked membership was not written");
    }

    await tx`
      INSERT INTO gym_membership_word_links (gym_id, word_key, word, membership_type_id, linked_by)
      VALUES (${input.gymId}, lower(${onList.word}), ${onList.word}, ${input.typeId}, ${input.actorUserId})
      ON CONFLICT (gym_id, word_key) DO NOTHING`;

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_word_linked",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: {
        word: onList.word,
        type: type.name,
        given: String(rows.length),
        on: input.today,
        paid: input.paid === null ? "not asked" : String(input.paid),
      },
    });
    return { kind: "ok", given: rows.length };
  });
}

/** Forget a word's link. Nobody's membership changes. A word with no link answers ok. */
export async function unlinkWord(
  sql: Sql,
  input: { gymId: string; word: string; actorUserId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    await lockGym(tx, input.gymId);
    const [gone] = await tx<{ word: string; membership_type_id: string }[]>`
      DELETE FROM gym_membership_word_links
      WHERE gym_id = ${input.gymId} AND word_key = lower(${input.word})
      RETURNING word, membership_type_id`;
    if (gone === undefined) return;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_word_unlinked",
      targetType: "gym_membership_type",
      targetId: gone.membership_type_id,
      meta: { word: gone.word },
    });
  });
}
