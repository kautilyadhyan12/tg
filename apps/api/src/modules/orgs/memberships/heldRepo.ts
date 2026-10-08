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
// one of the list's words, under the same gym lock. A class booking (17c-i,
// `classes/bookingsRepo.ts`) reads a record's memberships and takes a class off a pack or
// gives it back through `heldForBooking`, `chargePack` and `givePackClassBack` below,
// under that lock too.
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
  membershipAccessSchema,
  membershipKindSchema,
  membershipLimitPeriodSchema,
  membershipTermUnitSchema,
  moveHeldMembership,
  type HeldCover,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTypeChoice,
  type ListedMembership,
  type PtHeld,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { lockEntries, lockGym } from "../memberList/repo.js";
import type { HasBookings, MembershipEndConfirmed } from "../classes/bookingChanges.js";
import type { MembershipScope } from "../classes/bookingsRepo.js";

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
  SELECT id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, updated_at
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
 *  name tied to an archived type is not set up, as the Memberships page says of it. */
async function listedMembership(
  tx: TransactionSql,
  gymId: string,
  entryId: string,
  entry: { membership_type: string | null; ends_on: string | null; ends_on_kind: string | null },
): Promise<ListedMembership | null> {
  const word = entry.membership_type;
  if (word === null || word === "") return null;
  const [type] = await tx<{ id: string; name: string; own_name: boolean; held: boolean }[]>`
    SELECT t.id, t.name, (lower(t.name) = lower(${word})) AS own_name,
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
    ownName: type?.own_name ?? false,
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
export async function settle(tx: TransactionSql, gymId: string, entryId: string, today: string, now: Date): Promise<number> {
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

/** What a cancel does about the places booked on the membership, handed in by the service
 *  so this file runs none of the booking code (which imports this one; its types alone
 *  are read here): `ask` answers the question to put first, or null to go ahead; `end`
 *  ends them. Both run in the cancel's transaction, under the gym's lock. */
export interface CancelBookings {
  ask: (tx: TransactionSql, gymId: string, scope: MembershipScope, confirmed: MembershipEndConfirmed) => Promise<HasBookings | null>;
  end: (
    tx: TransactionSql,
    gymId: string,
    scope: MembershipScope,
    now: Date,
  ) => Promise<{ booked: number; packClasses: number; ptSessions?: number; ptPackSessions?: number }>;
}

/** One change to a held membership, decided by the rule on the row as it is under its
 *  lock. A change that is already so writes nothing and answers ok. A cancel that would
 *  end bookings answers who they are until the request sends their number back. */
export async function moveHeld(
  sql: Sql,
  bookings: CancelBookings,
  input: {
    gymId: string;
    entryId: string;
    membershipId: string;
    event: HeldMembershipEvent;
    /** The gym's own day. */
    today: string;
    /** A cancel: the number of bookings the screen was told it would end. */
    confirmBookings: number | null;
    /** A cancel: the mark of the personal training sessions it was told it would end. */
    confirmPtSessions?: string | null;
    actorUserId: string;
    now: Date;
  },
): Promise<HeldWriteOutcome | HasBookings> {
  return await sql.begin(async (tx): Promise<HeldWriteOutcome | HasBookings> => {
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

    // A cancel ends the places booked on it (17c-iii): every class not yet started, or,
    // where it runs on to the end of what is paid, the classes after its last day.
    let ends: MembershipScope | null = null;
    if (input.event.type === "cancel") {
      const last = m.status === "cancelled" ? null : heldMembershipView(m, input.today).endsOn;
      if (m.status === "cancelled" || last !== null) ends = { membership: before.id, now: input.now, afterDay: last };
    }
    if (ends !== null) {
      const ask = await bookings.ask(tx, input.gymId, ends, { bookings: input.confirmBookings, ptSessions: input.confirmPtSessions ?? null });
      if (ask !== null) return ask;
    }

    await tx`
      UPDATE gym_held_memberships
      SET status = ${m.status}, frozen_days = ${m.frozenDays}, frozen_on = ${m.frozenOn}::date,
          cancelled_on = ${m.cancelledOn}::date, paid_periods = ${m.paidPeriods}, renews = ${m.renews},
          updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND entry_id = ${input.entryId} AND id = ${input.membershipId}`;
    const ended = ends === null ? null : await bookings.end(tx, input.gymId, ends, input.now);

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
        ...(ended === null
          ? {}
          : {
              bookingsEnded: String(ended.booked),
              packClassesBack: String(ended.packClasses),
              ptSessionsEnded: String(ended.ptSessions ?? 0),
              ptPackSessionsBack: String(ended.ptPackSessions ?? 0),
            }),
      },
    });
    return { kind: "ok" };
  });
}

const forBookingSchema = z.object({
  entry_id: z.string(),
  access: membershipAccessSchema,
  bookings_limit: z.number().int().nullable(),
  bookings_period: membershipLimitPeriodSchema.nullable(),
  covers_class: z.boolean(),
});

const forClassesSchema = forBookingSchema.omit({ covers_class: true }).extend({ covers_all: z.boolean(), class_type_ids: z.array(z.string()) });

/** These records' memberships in use, each with the kinds of class its type names (17d):
 *  what `heldForBooking` answers for one class, for every class at once. A plain read. */
export async function heldForClasses(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[],
): Promise<(Omit<HeldCover, "used" | "coversClass"> & { entryId: string; coversAll: boolean; classTypeIds: string[] })[]> {
  const rows = await sql`
    SELECT ${COLUMNS(sql)}, h.entry_id, t.access, t.bookings_limit, t.bookings_period, t.covers_all_classes AS covers_all,
           ARRAY(SELECT c.class_type_id::text FROM gym_membership_type_classes c
                 WHERE c.gym_id = t.gym_id AND c.membership_type_id = t.id) AS class_type_ids
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[]) AND h.status = ANY(${[...IN_USE]}::text[])
    ORDER BY h.id`;
  return rows.map((row) => {
    const extra = forClassesSchema.parse(row);
    const h = shape(row);
    return {
      entryId: extra.entry_id,
      id: h.id,
      membership: h.membership,
      access: extra.access,
      coversAll: extra.covers_all,
      classTypeIds: extra.class_type_ids,
      bookingsLimit: extra.bookings_limit,
      bookingsPeriod: extra.bookings_period,
    };
  });
}

/** These records' memberships in use, each with what its type includes for one class
 *  (17c-i). `used` is the booking repo's to count. For a booking, under the gym's lock. */
export async function heldForBooking(
  tx: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[],
  classTypeId: string,
): Promise<(Omit<HeldCover, "used"> & { entryId: string })[]> {
  const rows = await tx`
    SELECT ${COLUMNS(tx)}, h.entry_id, t.access, t.bookings_limit, t.bookings_period,
           (t.covers_all_classes OR EXISTS (
             SELECT 1 FROM gym_membership_type_classes c
             WHERE c.gym_id = t.gym_id AND c.membership_type_id = t.id AND c.class_type_id = ${classTypeId}
           )) AS covers_class
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[]) AND h.status = ANY(${[...IN_USE]}::text[])
    ORDER BY h.id`;
  return rows.map((row) => {
    const extra = forBookingSchema.parse(row);
    const h = shape(row);
    return {
      entryId: extra.entry_id,
      id: h.id,
      membership: h.membership,
      access: extra.access,
      coversClass: extra.covers_class,
      bookingsLimit: extra.bookings_limit,
      bookingsPeriod: extra.bookings_period,
    };
  });
}

const forPtSchema = z.object({
  entry_id: z.string(),
  includes_pt: z.boolean(),
  pt_limit: z.number().int().nullable(),
  pt_period: membershipLimitPeriodSchema.nullable(),
});

/** These records' memberships in use, each with whether its type includes personal training
 *  and its limit on sessions (17e-i, 17e-v), its record and its type's name. `used` is the
 *  personal training repo's to count. For a session's booking, under the gym's lock; a
 *  plain read for the list of people to book and a member's own page, which run the
 *  booking's own rule on it. */
export async function heldForPtOf(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[],
): Promise<(Omit<PtHeld, "used"> & { entryId: string; typeName: string })[]> {
  if (entryIds.length === 0) return [];
  const rows = await sql`
    SELECT ${COLUMNS(sql)}, h.entry_id, t.includes_pt, t.pt_limit, t.pt_period
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.entry_id = ANY(${[...entryIds]}::uuid[]) AND h.status = ANY(${[...IN_USE]}::text[])
    ORDER BY h.id`;
  return rows.map((row) => {
    const h = shape(row);
    const extra = forPtSchema.parse(row);
    return {
      id: h.id,
      membership: h.membership,
      includesPt: extra.includes_pt,
      ptLimit: extra.pt_limit,
      ptPeriod: extra.pt_period,
      entryId: extra.entry_id,
      typeName: h.typeName,
    };
  });
}

// ── What the Members list reads (23a-i) ─────────────────────────────────────
//
// The list asks about every person of a gym at once (its Filter and its counts), so these
// two reads return plain rows and check them by hand: parsing each of a few thousand rows
// through a schema kept the server's one thread busy for 150 ms at 2,100 people
// (`tools/measure-members-held-cost.ts`). Past members are left out: their memberships
// are kept and not in use.

/** One membership as the list's rule needs it. */
export interface ListHeld {
  id: string;
  typeName: string;
  fromList: boolean;
  membership: HeldMembership;
}

interface ListHeldColumns {
  id: string;
  type_name: string;
  kind: string;
  term_count: number | null;
  term_unit: string | null;
  pack_classes: number | null;
  pack_days: number | null;
  free: boolean;
  starts_on: string;
  frozen_days: number;
  status: string;
  frozen_on: string | null;
  cancelled_on: string | null;
  paid_periods: number;
  paid_floor: number;
  renews: boolean;
  classes_left: number | null;
  from_list: boolean;
}

/** A row of an outer join: every column may be missing. */
type Nullable<T> = { [K in keyof T]: T[K] | null };

const LIST_COLUMNS = (sql: Sql | TransactionSql) => sql`
  h.id, t.name AS type_name, h.kind, h.term_count, h.term_unit, h.pack_classes, h.pack_days,
  (h.price_minor = 0) AS free, h.starts_on::text AS starts_on, h.frozen_days, h.status,
  h.frozen_on::text AS frozen_on, h.cancelled_on::text AS cancelled_on,
  h.paid_periods, h.paid_floor, h.renews, h.classes_left, h.from_list`;

/** A text column under a CHECK, as one of the values the rule knows: a value this build
 *  does not know fails here, as it does in `shape`. */
function oneOf<T extends string>(options: readonly T[], value: string, what: string): T {
  const found = options.find((option) => option === value);
  if (found === undefined) throw new Error(`a held membership holds a ${what} that no longer parses: ${value}`);
  return found;
}

function listHeld(row: ListHeldColumns): ListHeld {
  return {
    id: row.id,
    typeName: row.type_name,
    fromList: row.from_list,
    membership: {
      kind: oneOf(membershipKindSchema.options, row.kind, "kind"),
      termCount: row.term_count,
      termUnit: row.term_unit === null ? null : oneOf(membershipTermUnitSchema.options, row.term_unit, "term unit"),
      packClasses: row.pack_classes,
      packDays: row.pack_days,
      free: row.free,
      startsOn: row.starts_on,
      frozenDays: row.frozen_days,
      status: oneOf(heldMembershipStatusSchema.options, row.status, "status"),
      frozenOn: row.frozen_on,
      cancelledOn: row.cancelled_on,
      paidPeriods: row.paid_periods,
      paidFloor: row.paid_floor,
      renews: row.renews,
      classesLeft: row.classes_left,
    },
  };
}

/** Every membership stored in use of the current records named (`entryIds`), or of every
 *  current record of the gym (null). A plain read. */
export async function inUseForList(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[] | null,
): Promise<{ entryId: string; noEmail: boolean; held: ListHeld }[]> {
  if (entryIds !== null && entryIds.length === 0) return [];
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<(ListHeldColumns & { entry_id: string; no_email: boolean })[]>`
    SELECT ${LIST_COLUMNS(sql)}, h.entry_id, (e.email IS NULL) AS no_email
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    WHERE h.gym_id = ${gymId} AND h.status = ANY(${[...IN_USE]}::text[])
      AND (${ids}::uuid[] IS NULL OR h.entry_id = ANY(${ids}::uuid[]))`;
  return rows.map((row) => ({ entryId: row.entry_id, noEmail: row.no_email, held: listHeld(row) }));
}

export interface OverForList {
  entryId: string;
  /** The record has no address: what a chip's "can be invited" count needs. */
  noEmail: boolean;
  /** The membership name the gym's own list gives this record, where it names something
   *  the person does not hold and never has; null otherwise. */
  listedUnheld: string | null;
  /** The membership of theirs stored over that finished last; null where none is. */
  held: ListHeld | null;
}

/** For the current records with nothing stored in use: the membership of each stored over
 *  that finished last, and what the list's own word names. Asked of the records named
 *  (`entryIds`) or of the whole gym (null), and also of `alsoIds` whatever they hold: the
 *  records whose every membership stored in use the clock has ended. `today` is the gym's
 *  own day. A plain read.
 *
 *  **Which stored row.** One a record, by the rule's own order (`finishedLast` in
 *  `@app/shared`): the day it finished, a membership before a pack on the same day, then the
 *  newest start. The day is worked out here as the rule works it out, since a person who
 *  buys a day pass a visit has hundreds of rows and all of them cannot be read: the day it
 *  was cancelled; else its last day (the start, so many terms on, plus the days frozen,
 *  less one); a pack used up before that day by its start day. Postgres adds months and
 *  years as the rule does (31 Jan and a month is 28 Feb). `memberships.overForList.test.ts`
 *  holds the two to the same choice.
 *
 *  **`listedUnheld`** is the list's word where it names something this record has never
 *  held: no membership of theirs is of the type staff said that word is, nor of a type of
 *  that very name. A type archived since still counts, so somebody cancelled here does not
 *  go back to their old file's words because the type left the price list (a person's own
 *  page says "Not set up" of an archived type, which is about setting it up again). */
export async function overForList(
  sql: Sql | TransactionSql,
  gymId: string,
  entryIds: readonly string[] | null,
  alsoIds: readonly string[],
  today: string,
): Promise<OverForList[]> {
  if (entryIds !== null && entryIds.length === 0 && alsoIds.length === 0) return [];
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<(Nullable<ListHeldColumns> & { entry_id: string; no_email: boolean; listed_unheld: string | null })[]>`
    WITH asked AS (
      SELECT DISTINCT x.entry_id
      FROM gym_held_memberships x
      WHERE x.gym_id = ${gymId} AND x.status = ANY(${[...OVER]}::text[])
        AND (${ids}::uuid[] IS NULL OR x.entry_id = ANY(${ids}::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM gym_held_memberships y
          WHERE y.gym_id = x.gym_id AND y.entry_id = x.entry_id AND y.status = ANY(${[...IN_USE]}::text[])
        )
      UNION
      SELECT unnest(${[...alsoIds]}::uuid[])
    )
    SELECT e.id AS entry_id, (e.email IS NULL) AS no_email, o.*,
           CASE
             WHEN e.membership_type IS NULL OR e.membership_type = '' THEN NULL
             WHEN EXISTS (
               SELECT 1
               FROM gym_held_memberships lh
               JOIN gym_membership_types lt ON lt.gym_id = lh.gym_id AND lt.id = lh.membership_type_id
               WHERE lh.gym_id = e.gym_id AND lh.entry_id = e.id
                 AND (lower(lt.name) = lower(e.membership_type)
                      OR lt.id = (SELECT l.membership_type_id FROM gym_membership_word_links l
                                  WHERE l.gym_id = e.gym_id AND l.word_key = lower(e.membership_type)))
             ) THEN NULL
             ELSE e.membership_type
           END AS listed_unheld
    FROM asked
    JOIN gym_member_list_entries e ON e.gym_id = ${gymId} AND e.id = asked.entry_id AND e.former_at IS NULL
    LEFT JOIN LATERAL (
      SELECT ${LIST_COLUMNS(sql)}
      FROM gym_held_memberships h
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      WHERE h.gym_id = e.gym_id AND h.entry_id = e.id AND h.status = ANY(${[...OVER]}::text[])
      ORDER BY
        CASE
          WHEN h.status = 'cancelled' THEN h.cancelled_on
          -- One that renews has no last day; the rule falls back on its start day.
          WHEN h.kind = 'recurring' AND h.renews THEN h.starts_on
          ELSE (
            SELECT CASE WHEN d.last_day <= ${today}::date THEN d.last_day ELSE h.starts_on END
            FROM (
              SELECT (h.starts_on + make_interval(
                       years  => CASE WHEN h.kind <> 'pack' AND h.term_unit = 'year'  THEN h.term_count * n.periods ELSE 0 END,
                       months => CASE WHEN h.kind <> 'pack' AND h.term_unit = 'month' THEN h.term_count * n.periods ELSE 0 END,
                       weeks  => CASE WHEN h.kind <> 'pack' AND h.term_unit = 'week'  THEN h.term_count * n.periods ELSE 0 END,
                       days   => CASE WHEN h.kind = 'pack' THEN h.pack_days
                                      WHEN h.term_unit = 'day' THEN h.term_count * n.periods ELSE 0 END
                     ))::date + h.frozen_days - 1 AS last_day
              -- A repeating one that will not renew runs to the end of what is paid.
              FROM (SELECT CASE WHEN h.kind = 'recurring' THEN h.paid_periods ELSE 1 END AS periods) n
            ) d
          )
        END DESC,
        (h.kind = 'pack') ASC,
        h.starts_on DESC,
        h.id::text ASC
      LIMIT 1
    ) o ON true`;
  return rows.map((row) => ({
    entryId: row.entry_id,
    noEmail: row.no_email,
    listedUnheld: row.listed_unheld,
    held: wholeRow(row),
  }));
}

/** The LEFT JOIN's membership: null where the record has none stored over, and every
 *  column of it where it has. */
function wholeRow(row: Nullable<ListHeldColumns>): ListHeld | null {
  const { id, type_name, kind, free, starts_on, frozen_days, status, paid_periods, paid_floor, renews, from_list } = row;
  if (id === null) return null;
  if (
    type_name === null ||
    kind === null ||
    free === null ||
    starts_on === null ||
    frozen_days === null ||
    status === null ||
    paid_periods === null ||
    paid_floor === null ||
    renews === null ||
    from_list === null
  ) {
    throw new Error("a held membership came back without one of its columns");
  }
  return listHeld({
    id,
    type_name,
    kind,
    free,
    starts_on,
    frozen_days,
    status,
    paid_periods,
    paid_floor,
    renews,
    from_list,
    term_count: row.term_count,
    term_unit: row.term_unit,
    pack_classes: row.pack_classes,
    pack_days: row.pack_days,
    frozen_on: row.frozen_on,
    cancelled_on: row.cancelled_on,
    classes_left: row.classes_left,
  });
}

/** One class off a pack, for a booking. False where the pack has none left: the caller
 *  holds the gym's lock and has just read one, so that is a fault and it throws. */
export async function chargePack(tx: TransactionSql, gymId: string, membershipId: string, now: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_held_memberships SET classes_left = classes_left - 1, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${membershipId} AND kind = 'pack' AND classes_left > 0
    RETURNING id`;
  return rows.length === 1;
}

/** A pack's class given back by a free cancel. A pack marked ended because its last class
 *  was used runs again; one over by its days stays over by the rule's own reading. */
export async function givePackClassBack(tx: TransactionSql, gymId: string, membershipId: string, now: Date): Promise<void> {
  await tx`
    UPDATE gym_held_memberships
    SET status = CASE WHEN status = 'ended' AND classes_left = 0 THEN 'active' ELSE status END,
        classes_left = classes_left + 1, updated_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${membershipId} AND kind = 'pack' AND classes_left < pack_classes`;
}

/** Several packs given their classes back in one statement (`n` each), for bookings ended
 *  with a class or with a person's membership. Never past what the pack was sold with. */
export async function givePackClassesBack(tx: TransactionSql, gymId: string, back: ReadonlyMap<string, number>, now: Date): Promise<void> {
  if (back.size === 0) return;
  const payload = [...back].map(([id, n]) => ({ id, n }));
  await tx`
    UPDATE gym_held_memberships h
    SET status = CASE WHEN h.status = 'ended' AND h.classes_left = 0 THEN 'active' ELSE h.status END,
        classes_left = LEAST(h.pack_classes, h.classes_left + r.n), updated_at = ${now}
    FROM jsonb_to_recordset(${tx.json(payload)}) AS r(id uuid, n int)
    WHERE h.gym_id = ${gymId} AND h.id = r.id AND h.kind = 'pack'`;
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
