// A person's memberships: the only file that reads or writes them (spec Part 3
// §13.2; ROADMAP 17a-ii).
//
// Every statement carries `gym_id` in its WHERE, and a membership is found by its
// gym, its record and its id together, never the id alone. Every write takes the
// gym's row and then the record's, in the order a merge of two records does
// (`memberList/byHandService.ts`), so a membership is never written onto a record
// that is being deleted. What a write may do is decided by the one rule in
// `@app/shared` (`moveHeldMembership`), on the day the service passes in.
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
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { lockEntries, lockGym } from "../memberList/repo.js";

export interface HeldRow {
  id: string;
  typeId: string;
  typeName: string;
  priceMinor: number;
  currency: string;
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
  anchor_on: z.string(),
  status: heldMembershipStatusSchema,
  frozen_on: z.string().nullable(),
  cancelled_on: z.string().nullable(),
  paid_periods: z.number().int(),
  renews: z.boolean(),
  classes_left: z.number().int().nullable(),
});

function shape(row: unknown): HeldRow {
  const r = rawSchema.parse(row);
  return {
    id: r.id,
    typeId: r.membership_type_id,
    typeName: r.type_name,
    priceMinor: r.price_minor,
    currency: r.currency,
    membership: {
      kind: r.kind,
      termCount: r.term_count,
      termUnit: r.term_unit,
      packClasses: r.pack_classes,
      packDays: r.pack_days,
      free: r.price_minor === 0,
      startsOn: r.starts_on,
      anchorOn: r.anchor_on,
      status: r.status,
      frozenOn: r.frozen_on,
      cancelledOn: r.cancelled_on,
      paidPeriods: r.paid_periods,
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

function typeChoice(row: unknown): HeldMembershipTypeChoice {
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
const liveTypes = (sql: Sql | TransactionSql, gymId: string, typeId: string | null) => sql`
  SELECT id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days
  FROM gym_membership_types
  WHERE gym_id = ${gymId} AND archived_at IS NULL
    AND (${typeId}::uuid IS NULL OR id = ${typeId}::uuid)
  ORDER BY lower(name), id`;

const COLUMNS = (sql: Sql | TransactionSql) => sql`
  h.id, h.membership_type_id, t.name AS type_name, h.kind, h.price_minor, h.currency,
  h.term_count, h.term_unit, h.pack_classes, h.pack_days,
  h.starts_on::text AS starts_on, h.anchor_on::text AS anchor_on, h.status,
  h.frozen_on::text AS frozen_on, h.cancelled_on::text AS cancelled_on,
  h.paid_periods, h.renews, h.classes_left`;

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
}

/** A record's memberships, or null where the record is not this gym's. */
export async function readHeld(sql: Sql | TransactionSql, gymId: string, entryId: string): Promise<HeldList | null> {
  const [entries, inUse, over, totals, types] = await Promise.all([
    sql<{ past: boolean }[]>`
      SELECT former_at IS NOT NULL AS past FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND id = ${entryId}`,
    held(sql, gymId, entryId, IN_USE, IN_USE_READ),
    held(sql, gymId, entryId, OVER, HELD_EARLIER_PAGE),
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_held_memberships
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND status = ANY(${[...OVER]}::text[])`,
    liveTypes(sql, gymId, null),
  ]);
  const entry = entries[0];
  if (entry === undefined) return null;
  return {
    past: entry.past,
    inUse: inUse.map(shape),
    over: over.map(shape),
    overTotal: totals[0]?.n ?? 0,
    types: types.map(typeChoice),
  };
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
         term_count, term_unit, pack_classes, pack_days, starts_on, anchor_on, status,
         paid_periods, renews, classes_left)
      VALUES (${input.gymId}, ${input.entryId}, ${input.typeId}, ${input.requestKey}, ${m.kind},
              ${type.priceMinor}, ${type.currency}, ${m.termCount}, ${m.termUnit}, ${m.packClasses},
              ${m.packDays}, ${m.startsOn}::date, ${m.anchorOn}::date, ${m.status},
              ${m.paidPeriods}, ${m.renews}, ${m.classesLeft})
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
      SET status = ${m.status}, anchor_on = ${m.anchorOn}::date, frozen_on = ${m.frozenOn}::date,
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
