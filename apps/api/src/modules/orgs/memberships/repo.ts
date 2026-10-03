// A gym's membership types: the only file that reads or writes them (spec Part 3
// §13.1; ROADMAP 17a-i).
//
// Every statement carries `gym_id` in its WHERE, the ones holding a type's id
// included: the pair is the key, never the id alone. Every write takes the gym's
// row lock first, so the cap, the name check and the classes a type covers are
// decided against a list nobody else is changing.
import type { Sql, TransactionSql } from "postgres";
import { MEMBERSHIP_ARCHIVED_PAGE, MEMBERSHIP_TYPES_MAX } from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";

export interface MembershipTypeRow {
  id: string;
  name: string;
  kind: string;
  priceMinor: number;
  currency: string;
  termCount: number | null;
  termUnit: string | null;
  packClasses: number | null;
  packDays: number | null;
  access: string;
  weeklyBookings: number | null;
  /** null: every class. */
  classTypes: { id: string; name: string }[] | null;
  archivedAt: Date | null;
}

export interface PriceListRow {
  country: string | null;
  types: MembershipTypeRow[];
  archived: MembershipTypeRow[];
  archivedTotal: number;
  classChoices: { id: string; name: string }[];
}

interface RawType {
  id: string;
  name: string;
  kind: string;
  price_minor: number;
  currency: string;
  term_count: number | null;
  term_unit: string | null;
  pack_classes: number | null;
  pack_days: number | null;
  access: string;
  weekly_bookings: number | null;
  covers_all_classes: boolean;
  archived_at: Date | null;
}

/** The whole price list, or null where the gym does not exist. The live list is
 *  bounded by the cap the writes enforce; the archived list is a page, newest
 *  first, with the gym's real count beside it. */
export async function readPriceList(sql: Sql, gymId: string): Promise<PriceListRow | null> {
  const readTypes = (archived: boolean, limit: number) => sql<RawType[]>`
    SELECT id, name, kind, price_minor, currency, term_count, term_unit, pack_classes,
           pack_days, access, weekly_bookings, covers_all_classes, archived_at
    FROM gym_membership_types
    WHERE gym_id = ${gymId} AND (archived_at IS NOT NULL) = ${archived}
    ORDER BY ${archived ? sql`archived_at DESC, id` : sql`lower(name), id`}
    LIMIT ${limit}`;

  const [gymRows, live, archived, totals, covered, classChoices] = await Promise.all([
    sql<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${gymId}`,
    readTypes(false, MEMBERSHIP_TYPES_MAX),
    readTypes(true, MEMBERSHIP_ARCHIVED_PAGE),
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_membership_types
      WHERE gym_id = ${gymId} AND archived_at IS NOT NULL`,
    sql<{ membership_type_id: string; id: string; name: string }[]>`
      SELECT c.membership_type_id, t.id, t.name
      FROM gym_membership_type_classes c
      JOIN gym_class_types t ON t.id = c.class_type_id AND t.gym_id = c.gym_id
      WHERE c.gym_id = ${gymId}
      ORDER BY lower(t.name), t.id`,
    sql<{ id: string; name: string }[]>`
      SELECT id, name FROM gym_class_types
      WHERE gym_id = ${gymId} AND archived_at IS NULL
      ORDER BY lower(name), id`,
  ]);
  const gym = gymRows[0];
  if (gym === undefined) return null;

  const coveredByType = new Map<string, { id: string; name: string }[]>();
  for (const row of covered) {
    const list = coveredByType.get(row.membership_type_id) ?? [];
    list.push({ id: row.id, name: row.name });
    coveredByType.set(row.membership_type_id, list);
  }
  const shape = (r: RawType): MembershipTypeRow => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    priceMinor: r.price_minor,
    currency: r.currency,
    termCount: r.term_count,
    termUnit: r.term_unit,
    packClasses: r.pack_classes,
    packDays: r.pack_days,
    access: r.access,
    weeklyBookings: r.weekly_bookings,
    classTypes: r.covers_all_classes ? null : (coveredByType.get(r.id) ?? []),
    archivedAt: r.archived_at,
  });
  return {
    country: gym.country,
    types: live.map(shape),
    archived: archived.map(shape),
    archivedTotal: totals[0]?.n ?? 0,
    classChoices: classChoices.map((c) => ({ id: c.id, name: c.name })),
  };
}

export interface MembershipTypeInput {
  name: string;
  kind: string;
  priceMinor: number;
  termCount: number | null;
  termUnit: string | null;
  packClasses: number | null;
  packDays: number | null;
  access: string;
  weeklyBookings: number | null;
  /** null: every class. */
  classTypeIds: string[] | null;
}

export type MembershipWriteOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "name_taken" }
  /** A class named in `classTypeIds` is not one of this gym's. */
  | { kind: "class_not_in_gym" }
  /** An update tried to change the type's kind. */
  | { kind: "kind_fixed" };

async function liveCount(tx: TransactionSql, gymId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL`;
  return row?.n ?? 0;
}

/** Is a live type of this name already on the gym's list, other than `exceptId`? */
async function nameTaken(
  tx: TransactionSql,
  gymId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL AND lower(name) = lower(${name})`;
  return rows.some((r) => r.id !== exceptId);
}

/** Every class named is this gym's own. Archived classes count: a type may go on
 *  covering a class the gym has since stopped running. */
async function classesAreThisGyms(tx: TransactionSql, gymId: string, ids: string[] | null): Promise<boolean> {
  if (ids === null) return true;
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_class_types
    WHERE gym_id = ${gymId} AND id = ANY(${ids}::uuid[])`;
  return (row?.n ?? 0) === ids.length;
}

async function writeCoveredClasses(
  tx: TransactionSql,
  gymId: string,
  typeId: string,
  ids: string[] | null,
): Promise<void> {
  await tx`
    DELETE FROM gym_membership_type_classes
    WHERE membership_type_id = ${typeId} AND gym_id = ${gymId}`;
  if (ids === null) return;
  await tx`
    INSERT INTO gym_membership_type_classes (membership_type_id, class_type_id, gym_id)
    SELECT ${typeId}, id, ${gymId} FROM gym_class_types
    WHERE gym_id = ${gymId} AND id = ANY(${ids}::uuid[])`;
}

export async function createMembershipType(
  sql: Sql,
  input: MembershipTypeInput & { gymId: string; currency: string; actorUserId: string },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [gym] = await tx<{ id: string }[]>`SELECT id FROM gyms WHERE id = ${input.gymId}`;
    if (gym === undefined) return { kind: "not_found" };
    if ((await liveCount(tx, input.gymId)) >= MEMBERSHIP_TYPES_MAX) {
      return { kind: "too_many", cap: MEMBERSHIP_TYPES_MAX };
    }
    if (await nameTaken(tx, input.gymId, input.name, null)) return { kind: "name_taken" };
    if (!(await classesAreThisGyms(tx, input.gymId, input.classTypeIds))) {
      return { kind: "class_not_in_gym" };
    }

    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes,
         pack_days, access, weekly_bookings, covers_all_classes)
      VALUES (${input.gymId}, ${input.name}, ${input.kind}, ${input.priceMinor}, ${input.currency},
              ${input.termCount}, ${input.termUnit}, ${input.packClasses}, ${input.packDays},
              ${input.access}, ${input.weeklyBookings}, ${input.classTypeIds === null})
      RETURNING id`;
    if (created === undefined) throw new Error("membership type insert returned no row");
    await writeCoveredClasses(tx, input.gymId, created.id, input.classTypeIds);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_created",
      targetType: "gym_membership_type",
      targetId: created.id,
      meta: {
        name: input.name,
        kind: input.kind,
        priceMinor: String(input.priceMinor),
        currency: input.currency,
      },
    });
    return { kind: "ok" };
  });
}

/** Replace a live type's fields. Its kind and its currency never change: people
 *  will hold it (17a-ii), and a monthly membership that became a pack, or a
 *  price that changed money, would rewrite what they were sold. */
export async function updateMembershipType(
  sql: Sql,
  input: MembershipTypeInput & { gymId: string; typeId: string; actorUserId: string; now: Date },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string; kind: string; price_minor: number }[]>`
      SELECT name, kind, price_minor FROM gym_membership_types
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    if (before.kind !== input.kind) return { kind: "kind_fixed" };
    if (await nameTaken(tx, input.gymId, input.name, input.typeId)) return { kind: "name_taken" };
    if (!(await classesAreThisGyms(tx, input.gymId, input.classTypeIds))) {
      return { kind: "class_not_in_gym" };
    }

    await tx`
      UPDATE gym_membership_types
      SET name = ${input.name}, price_minor = ${input.priceMinor},
          term_count = ${input.termCount}, term_unit = ${input.termUnit},
          pack_classes = ${input.packClasses}, pack_days = ${input.packDays},
          access = ${input.access}, weekly_bookings = ${input.weeklyBookings},
          covers_all_classes = ${input.classTypeIds === null}, updated_at = ${input.now}
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId}`;
    await writeCoveredClasses(tx, input.gymId, input.typeId, input.classTypeIds);

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_updated",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: {
        before: before.name,
        after: input.name,
        priceBefore: String(before.price_minor),
        priceAfter: String(input.priceMinor),
      },
    });
    return { kind: "ok" };
  });
}

/** Archive: the type leaves the price list and is kept. */
export async function archiveMembershipType(
  sql: Sql,
  input: { gymId: string; typeId: string; actorUserId: string; now: Date },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string }[]>`
      SELECT name FROM gym_membership_types
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    await tx`
      UPDATE gym_membership_types SET archived_at = ${input.now}, updated_at = ${input.now}
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_archived",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}

/** Put an archived type back on the price list. It counts against the cap, and
 *  a live type may have taken its name while it was away. */
export async function restoreMembershipType(
  sql: Sql,
  input: { gymId: string; typeId: string; actorUserId: string; now: Date },
): Promise<MembershipWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string }[]>`
      SELECT name FROM gym_membership_types
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId} AND archived_at IS NOT NULL`;
    if (before === undefined) return { kind: "not_found" };
    if ((await liveCount(tx, input.gymId)) >= MEMBERSHIP_TYPES_MAX) {
      return { kind: "too_many", cap: MEMBERSHIP_TYPES_MAX };
    }
    if (await nameTaken(tx, input.gymId, before.name, input.typeId)) return { kind: "name_taken" };
    await tx`
      UPDATE gym_membership_types SET archived_at = NULL, updated_at = ${input.now}
      WHERE id = ${input.typeId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.membership_type_restored",
      targetType: "gym_membership_type",
      targetId: input.typeId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}
