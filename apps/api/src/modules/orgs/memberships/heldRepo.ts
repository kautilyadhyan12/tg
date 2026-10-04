// A person's memberships: the only file that reads or writes them (spec Part 3
// §13.2; ROADMAP 17a-ii).
//
// Every statement carries `gym_id` in its WHERE, and a membership is found by its
// gym, its record and its id together, never the id alone. Every write takes the
// gym's row and then the record's, in the order a merge of two records does
// (`memberList/byHandService.ts`), so a membership is never written onto a record
// that is being deleted. What a write may do is decided by the one rule in
// `@app/shared` (`moveHeldMembership`), on the day the service passes in.
// The one other writer is `wordsRepo.ts`, which gives a type to everybody who carries
// one of the list's words, under the same gym lock.
//
// `status` holds the last status written, and the clock ends a membership without
// writing: every write first marks the record's memberships the clock has ended
// (`settle`), so the rows still stored `active` stay few, and every read passes each
// row through the rule.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  HELD_EARLIER_PAGE,
  HELD_LIVE_MAX,
  giveHeldMembership,
  heldMembershipStatusSchema,
  heldMembershipView,
  membershipKindSchema,
  membershipTermUnitSchema,
  moveHeldMembership,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTypeChoice,
  type ListedMembership,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { lockEntries, lockGym } from "../memberList/repo.js";

export interface HeldRow {
  id: string;
  typeId: string;
  typeName: string;
  priceMinor: number;
  currency: string;
  fromList: boolean;
  membership: HeldMembership;
}

// Text columns under a CHECK: parsed, so a value the rule does not know fails here.
const rawSchema = z.object({
  id: z.string(),
  membership_type_id: z.string(),
  type_name: z.string(),
  kind: membershipKindSchema,
  price_minor: z.number().int(),
  currency: z.string(),
  term_count: z.number().int().nullable(),
  term_unit: membershipTermUnitSchema.nullable(),
  pack_classes: z.number().int().nullable(),
  pack_days: z.number().int().nullable(),
  starts_on: z.string(),
  frozen_days: z.number().int(),
  status: heldMembershipStatusSchema,
  frozen_on: z.string().nullable(),
  cancelled_on: z.string().nullable(),
  paid_periods: z.number().int(),
  paid_floor: z.number().int(),
  renews: z.boolean(),
  classes_left: z.number().int().nullable(),
  from_list: z.boolean(),
});

function shape(row: unknown): HeldRow {
  const r = rawSchema.parse(row);
  return {
    id: r.id,
    typeId: r.membership_type_id,
    typeName: r.type_name,
    priceMinor: r.price_minor,
    currency: r.currency,
    fromList: r.from_list,
    membership: {
      kind: r.kind,
      termCount: r.term_count,
      termUnit: r.term_unit,
      packClasses: r.pack_classes,
      packDays: r.pack_days,
      free: r.price_minor === 0,
      startsOn: r.starts_on,
      frozenDays: r.frozen_days,
      status: r.status,
      frozenOn: r.frozen_on,
      cancelledOn: r.cancelled_on,
      paidPeriods: r.paid_periods,
      paidFloor: r.paid_floor,
      renews: r.renews,
      classesLeft: r.classes_left,
    },
  };
}

const typeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: membershipKindSchema,
  price_minor: z.number().int(),
  currency: z.string(),
  term_count: z.number().int().nullable(),
  term_unit: membershipTermUnitSchema.nullable(),
  pack_classes: z.number().int().nullable(),
  pack_days: z.number().int().nullable(),
});

export function typeChoice(row: unknown): HeldMembershipTypeChoice {
  const t = typeSchema.parse(row);
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    priceMinor: t.price_minor,
    currency: t.currency,
    termCount: t.term_count,
    termUnit: t.term_unit,
    packClasses: t.pack_classes,
    packDays: t.pack_days,
  };
}

/** A gym's live types, or the one named; a gym has at most 60. */
export const liveTypes = (sql: Sql | TransactionSql, gymId: string, typeId: string | null) => sql`
  SELECT id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days
  FROM gym_membership_types
  WHERE gym_id = ${gymId} AND archived_at IS NULL
    AND (${typeId}::uuid IS NULL OR id = ${typeId}::uuid)
  ORDER BY lower(name), id`;

const COLUMNS = (sql: Sql | TransactionSql) => sql`
  h.id, h.membership_type_id, t.name AS type_name, h.kind, h.price_minor, h.currency,
  h.term_count, h.term_unit, h.pack_classes, h.pack_days,
  h.starts_on::text AS starts_on, h.frozen_days, h.status,
  h.frozen_on::text AS frozen_on, h.cancelled_on::text AS cancelled_on,
  h.paid_periods, h.paid_floor, h.renews, h.classes_left, h.from_list`;

/** The record's memberships of the statuses named, newest start first. */
const held = (sql: Sql | TransactionSql, gymId: string, entryId: string, statuses: readonly string[], limit: number) => sql`
  SELECT ${COLUMNS(sql)}
  FROM gym_held_memberships h
  JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
  WHERE h.gym_id = ${gymId} AND h.entry_id = ${entryId} AND h.status = ANY(${[...statuses]}::text[])
  ORDER BY h.starts_on DESC, h.id
  LIMIT ${limit}`;

const IN_USE = ["active", "frozen"] as const;
const OVER = ["ended", "cancelled"] as const;
/** Rows stored `active` or `frozen`: at most `HELD_LIVE_MAX` in use, and the ones the
 *  clock has ended since the record's last write. */
const IN_USE_READ = 500;

export interface HeldList {
  /** The record is a past member's. */
  past: boolean;
  /** Stored `active` or `frozen`; the rule says which of them the clock has ended. */
  inUse: HeldRow[];
  /** Stored `ended` or `cancelled`: a page, newest start first, and how many there are. */
  over: HeldRow[];
  overTotal: number;
  types: HeldMembershipTypeChoice[];
  /** What the member list says their membership is; null where it says nothing, and for
   *  a past member. */
  listed: ListedMembership | null;
}

/** What the list says this record's membership is, and how that name stands with the
 *  price list: the live type staff said it is (`gym_membership_word_links`), else the
 *  live type of that very name, matched as the list's chips fold a word (`lower`). A
 *  name tied to an archived type is not set up, as Settings says of it. */
async function listedMembership(
  tx: TransactionSql,
  gymId: string,
  entryId: string,
  entry: { membership_type: string | null; ends_on: string | null; ends_on_kind: string | null },
): Promise<ListedMembership | null> {
  const word = entry.membership_type;
  if (word === null || word === "") return null;
  const [type] = await tx<{ id: string; name: string; held: boolean }[]>`
    SELECT t.id, t.name,
           EXISTS (
             SELECT 1 FROM gym_held_memberships h
             WHERE h.gym_id = t.gym_id AND h.entry_id = ${entryId} AND h.membership_type_id = t.id
           ) AS held
    FROM gym_membership_types t
    WHERE t.gym_id = ${gymId} AND t.archived_at IS NULL
      AND t.id = COALESCE(
        (SELECT l.membership_type_id FROM gym_membership_word_links l
         WHERE l.gym_id = ${gymId} AND l.word_key = lower(${word})),
        (SELECT s.id FROM gym_membership_types s
         WHERE s.gym_id = ${gymId} AND s.archived_at IS NULL AND lower(s.name) = lower(${word}))
      )`;
  return {
    word,
    endsOn: entry.ends_on,
    // Text under a CHECK: a kind this build does not know reads as the list's default, an end day.
    endsOnKind: entry.ends_on === null || entry.ends_on_kind === null ? null : entry.ends_on_kind === "renews" ? "renews" : "ends",
    type: type === undefined ? null : { id: type.id, name: type.name },
    held: type?.held ?? false,
  };
}

/** A record's memberships, or null where the record is not this gym's. */
export async function readHeld(sql: Sql, gymId: string, entryId: string): Promise<HeldList | null> {
  // One connection and one moment: the page of earlier ones and their count agree.
  return await sql.begin("isolation level repeatable read read only", async (tx): Promise<HeldList | null> => {
    const [entry] = await tx<{ past: boolean; membership_type: string | null; ends_on: string | null; ends_on_kind: string | null }[]>`
      SELECT former_at IS NOT NULL AS past, membership_type, ends_on::text AS ends_on, ends_on_kind
      FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND id = ${entryId}`;
    if (entry === undefined) return null;
    const listed = entry.past ? null : await listedMembership(tx, gymId, entryId, entry);
    const inUse = await held(tx, gymId, entryId, IN_USE, IN_USE_READ);
    const over = await held(tx, gymId, entryId, OVER, HELD_EARLIER_PAGE);
    const [total] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_held_memberships
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND status = ANY(${[...OVER]}::text[])`;
    const types = await liveTypes(tx, gymId, null);
    return {
      past: entry.past,
      inUse: inUse.map(shape),
      over: over.map(shape),
      overTotal: total?.n ?? 0,
      types: types.map(typeChoice),
      listed,
    };
  });
}

export type HeldWriteOutcome =
  | { kind: "ok" }
  | { kind: "entry_not_found" }
  /** A past member holds nothing in use: put them back first. */
  | { kind: "past_member" }
  /** No live type of this gym has that id. */
  | { kind: "type_not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "start_out_of_range" }
  | { kind: "already_over" }
  /** The key of this request already gave somebody else a membership. */
  | { kind: "request_reused" }
  | { kind: "membership_not_found" }
  /** The rule refuses this change of the membership as it is today. */
  | { kind: "not_allowed" };

/** The record under the gym's lock and its own: null where it is not this gym's. */
async function lockedEntry(tx: TransactionSql, gymId: string, entryId: string): Promise<{ past: boolean } | null> {
  await lockGym(tx, gymId);
  await lockEntries(tx, gymId, [entryId]);
  const [entry] = await tx<{ past: boolean }[]>`
    SELECT former_at IS NOT NULL AS past FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId}`;
  return entry ?? null;
}

/** Mark the record's memberships the clock has ended, and answer how many are still in
 *  use. Under the record's lock. */
async function settle(tx: TransactionSql, gymId: string, entryId: string, today: string, now: Date): Promise<number> {
  const rows = (await held(tx, gymId, entryId, IN_USE, IN_USE_READ)).map(shape);
  const ended = rows.filter((row) => heldMembershipView(row.membership, today).status === "ended").map((row) => row.id);
  if (ended.length > 0) {
    await tx`
      UPDATE gym_held_memberships SET status = 'ended', updated_at = ${now}
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND status = 'active' AND id = ANY(${ended}::uuid[])`;
  }
  return rows.length - ended.length;
}

export async function giveHeld(
  sql: Sql,
  input: {
    gymId: string;
    entryId: string;
    typeId: string;
    requestKey: string;
    startsOn: string;
    paid: boolean;
    /** The gym's own day. */
    today: string;
    actorUserId: string;
    now: Date;
  },
): Promise<HeldWriteOutcome> {
  return await sql.begin(async (tx): Promise<HeldWriteOutcome> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };

    // The same request again: the membership it gave stands, and nothing is added.
    const [again] = await tx<{ entry_id: string }[]>`
      SELECT entry_id FROM gym_held_memberships
      WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
    if (again !== undefined) return again.entry_id === input.entryId ? { kind: "ok" } : { kind: "request_reused" };

    if (entry.past) return { kind: "past_member" };
    const inUse = await settle(tx, input.gymId, input.entryId, input.today, input.now);
    if (inUse >= HELD_LIVE_MAX) return { kind: "too_many", cap: HELD_LIVE_MAX };

    const [rawType] = await liveTypes(tx, input.gymId, input.typeId);
    if (rawType === undefined) return { kind: "type_not_found" };
    const type = typeChoice(rawType);

    const given = giveHeldMembership(type, input.startsOn, input.paid, input.today);
    if (!given.ok) return { kind: given.reason };
    const m = given.membership;

    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency,
         term_count, term_unit, pack_classes, pack_days, starts_on, status,
         paid_periods, paid_floor, renews, classes_left)
      VALUES (${input.gymId}, ${input.entryId}, ${input.typeId}, ${input.requestKey}, ${m.kind},
              ${type.priceMinor}, ${type.currency}, ${m.termCount}, ${m.termUnit}, ${m.packClasses},
              ${m.packDays}, ${m.startsOn}::date, ${m.status},
              ${m.paidPeriods}, ${m.paidFloor}, ${m.renews}, ${m.classesLeft})
      RETURNING id`;
    if (created === undefined) throw new Error("held membership insert returned no row");

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.held_membership_given",
      targetType: "gym_held_membership",
      targetId: created.id,
      meta: {
        entryId: input.entryId,
        type: type.name,
        startsOn: m.startsOn,
        paidPeriods: String(m.paidPeriods),
        priceMinor: String(type.priceMinor),
        currency: type.currency,
      },
    });
    return { kind: "ok" };
  });
}

const AUDIT_ACTION: Record<HeldMembershipEvent["type"], string> = {
  freeze: "org.held_membership_frozen",
  unfreeze: "org.held_membership_unfrozen",
  cancel: "org.held_membership_cancelled",
  paid: "org.held_membership_paid",
};

/** One change to a held membership, decided by the rule on the row as it is under its
 *  lock. A change that is already so writes nothing and answers ok. */
export async function moveHeld(
  sql: Sql,
  input: {
    gymId: string;
    entryId: string;
    membershipId: string;
    event: HeldMembershipEvent;
    /** The gym's own day. */
    today: string;
    actorUserId: string;
    now: Date;
  },
): Promise<HeldWriteOutcome> {
  return await sql.begin(async (tx): Promise<HeldWriteOutcome> => {
    const entry = await lockedEntry(tx, input.gymId, input.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    const [raw] = await tx`
      SELECT ${COLUMNS(tx)}
      FROM gym_held_memberships h
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      WHERE h.gym_id = ${input.gymId} AND h.entry_id = ${input.entryId} AND h.id = ${input.membershipId}
      FOR UPDATE OF h`;
    if (raw === undefined) return { kind: "membership_not_found" };
    if (entry.past) return { kind: "past_member" };
    await settle(tx, input.gymId, input.entryId, input.today, input.now);
    const before = shape(raw);

    const move = moveHeldMembership(before.membership, input.event, input.today);
    if (!move.ok) return { kind: "not_allowed" };
    if (!move.changed) return { kind: "ok" };
    const m = move.membership;

    await tx`
      UPDATE gym_held_memberships
      SET status = ${m.status}, frozen_days = ${m.frozenDays}, frozen_on = ${m.frozenOn}::date,
          cancelled_on = ${m.cancelledOn}::date, paid_periods = ${m.paidPeriods}, renews = ${m.renews},
          updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND entry_id = ${input.entryId} AND id = ${input.membershipId}`;

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: AUDIT_ACTION[input.event.type],
      targetType: "gym_held_membership",
      targetId: before.id,
      meta: {
        entryId: input.entryId,
        type: before.typeName,
        on: input.today,
        statusBefore: before.membership.status,
        statusAfter: m.status,
        paidBefore: String(before.membership.paidPeriods),
        paidAfter: String(m.paidPeriods),
        renews: String(m.renews),
      },
    });
    return { kind: "ok" };
  });
}

/** How many memberships each of these records has in use on `today`, by the rule: a
 *  stored `active` row the clock has ended is not counted. Only records with at least
 *  `atLeast` stored in use are read. */
export async function inUseByRule(
  tx: TransactionSql,
  gymId: string,
  entryIds: readonly string[],
  today: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (entryIds.length === 0) return counts;
  const rows = await tx`
    SELECT h.entry_id, ${COLUMNS(tx)}
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[])
      AND h.status = ANY(${[...IN_USE]}::text[])`;
  for (const row of rows) {
    const entryId = z.object({ entry_id: z.string() }).passthrough().parse(row).entry_id;
    if (heldMembershipView(shape(row).membership, today).status === "ended") continue;
    counts.set(entryId, (counts.get(entryId) ?? 0) + 1);
  }
  return counts;
}
