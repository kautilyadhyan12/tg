// Orgs repo — the ONLY file that touches gyms / gym_codes / gym_members /
// gym_staff (v1 §6.2). Every query that reads or writes a tenant-owned row
// carries the gym id (and, for "my orgs", the user id) in its WHERE — a
// fetch-by-id alone would be an IDOR (R3.2).
import type { Sql, TransactionSql } from "postgres";
import { orgRoleSchema, orgStatusSchema, orgTypeSchema } from "@app/shared";
import type { OrgRole, OrgStatus, OrgType } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  orgType: OrgType;
  timezone: string;
  locale: string;
  currencyDisplay: string;
  status: OrgStatus;
}

export interface MyOrgRow extends OrgRow {
  staffRole: OrgRole | null;
  isMember: boolean;
  joinedAt: Date | null;
}

export interface MembershipRow {
  id: string;
  joinedAt: Date;
  groupLabel: string | null;
}

export interface MemberRow {
  id: string;
  userId: string;
  displayName: string;
  joinedAt: Date;
  groupLabel: string | null;
  complimentary: boolean;
}

export interface CodeRow {
  code: string;
  label: string;
  paused: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
}

interface RawOrg {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  org_type: string;
  timezone: string;
  locale: string;
  currency_display: string;
  status: string;
}

/** The DB CHECK constraints (Part 4 §3.2) already guarantee these vocabularies.
 *  Parsing rather than casting (R2.2) means that if a constraint is ever
 *  dropped, this throws loudly here instead of quietly widening a response
 *  shape the clients trust. */
function toOrgType(value: string): OrgType {
  return orgTypeSchema.parse(value);
}
function toOrgStatus(value: string): OrgStatus {
  return orgStatusSchema.parse(value);
}
function toOrgRole(value: string): OrgRole {
  return orgRoleSchema.parse(value);
}

function toOrgRow(raw: RawOrg): OrgRow {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    city: raw.city,
    orgType: toOrgType(raw.org_type),
    timezone: raw.timezone,
    locale: raw.locale,
    currencyDisplay: raw.currency_display,
    status: toOrgStatus(raw.status),
  };
}

/** A 23505 from any statement in this module. TS narrows via `in` — no cast. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

/** Which unique index a 23505 came from. `gyms.slug` and `gym_codes.code` are
 *  both minted from randomness and both retried, but they are retried
 *  DIFFERENTLY (a slug keeps the readable stem, a code is thrown away whole),
 *  so the caller has to be able to tell them apart. */
export type TakenWhat = "slug" | "code";

export class OrgNameTakenError extends Error {
  readonly what: TakenWhat;
  constructor(what: TakenWhat) {
    super(`org create lost a uniqueness race on ${what}`);
    this.name = "OrgNameTakenError";
    this.what = what;
  }
}

export interface CreateOrgInput {
  ownerUserId: string;
  slug: string;
  name: string;
  city: string | null;
  orgType: OrgType;
  timezone: string;
  locale: string;
  currencyDisplay: string;
  code: string;
  codeLabel: string;
}

export interface CreateOrgResult {
  org: OrgRow;
  code: { code: string; label: string };
}

/** One attempt at Part 3 §4.0's steps 1, 4 and 6 as a single transaction: the
 *  org, its owner staff row, its first join code, and (per
 *  `owner_included_as_member`) the owner's own complimentary membership.
 *
 *  All four or none. A gym that exists with no code is a gym nobody can join,
 *  and an owner who is not a member cannot demo the app on their own phone in
 *  the car park — which is the entire point of step 6.
 *
 *  Throws `OrgNameTakenError` on a uniqueness race; the SERVICE decides how to
 *  retry, because it owns the randomness. */
export async function createOrgAttempt(
  sql: Sql,
  input: CreateOrgInput,
): Promise<CreateOrgResult> {
  try {
    return await sql.begin(async (tx) => {
      const orgRows = await tx<RawOrg[]>`
        INSERT INTO gyms (slug, name, city, org_type, timezone, locale,
                          currency_display, owner_user_id)
        VALUES (${input.slug}, ${input.name}, ${input.city}, ${input.orgType},
                ${input.timezone}, ${input.locale}, ${input.currencyDisplay},
                ${input.ownerUserId})
        RETURNING id, slug, name, city, org_type, timezone, locale,
                  currency_display, status`;
      const rawOrg = orgRows[0];
      if (rawOrg === undefined) throw new Error("INSERT INTO gyms returned no row");
      const org = toOrgRow(rawOrg);

      await tx`
        INSERT INTO gym_staff (gym_id, user_id, role)
        VALUES (${org.id}, ${input.ownerUserId}, 'owner')`;

      const codeRows = await tx<{ id: string; code: string; label: string }[]>`
        INSERT INTO gym_codes (gym_id, code, label)
        VALUES (${org.id}, ${input.code}, ${input.codeLabel})
        RETURNING id, code, label`;
      const codeRow = codeRows[0];
      if (codeRow === undefined) throw new Error("INSERT INTO gym_codes returned no row");

      // Step 6, honouring the column rather than assuming it: the default is
      // true, but the column is the authority and a later settings screen will
      // flip it.
      const includeRows = await tx<{ owner_included_as_member: boolean }[]>`
        SELECT owner_included_as_member FROM gyms WHERE id = ${org.id}`;
      if (includeRows[0]?.owner_included_as_member === true) {
        // T3 ROUND 1 C/H-2: `consent_at` stays NULL, and that is the honest
        // value — this membership is created silently by §4.0 step 6 and
        // NOBODY ASKED THE OWNER anything. The first version wrote `now()`,
        // reasoning that creating the org is itself the owner's choice. That
        // reasoning is fine for a gym and indefensible for a clinic, where
        // §2.4 makes this exact column the DPDP/GDPR consent record: a
        // timestamp there is the app asserting that a person agreed to
        // something they were never shown.
        //
        // Kd's answer to the question was larger than the question (2026-08-18,
        // "no click will be there only gyms and fitness centers"): clinics are
        // out of the product, so no NEW row here can be a clinic's. The NULL
        // stays regardless — a consent record nobody collected is wrong on a
        // gym too, it is merely harmless there.
        await tx`
          INSERT INTO gym_members (gym_id, user_id, code_id, consent_at, complimentary)
          VALUES (${org.id}, ${input.ownerUserId}, ${codeRow.id}, NULL, true)`;
      }

      await insertAudit(tx, {
        actorUserId: input.ownerUserId,
        gymId: org.id,
        action: "org.created",
        targetType: "gym",
        targetId: org.id,
        meta: { orgType: org.orgType },
      });

      return { org, code: { code: codeRow.code, label: codeRow.label } };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Only two unique constraints are reachable from this transaction.
      const constraint =
        typeof err === "object" && err !== null && "constraint_name" in err
          ? String(err.constraint_name)
          : "";
      throw new OrgNameTakenError(constraint.includes("code") ? "code" : "slug");
    }
    throw err;
  }
}

/** How many orgs `/mine` will return. A person belongs to one or two gyms; a
 *  multi-site owner might reach a dozen. The bound exists so the response has a
 *  ceiling at all (T3 round 1 L-4) — an unbounded list is a shape that works
 *  until the day it does not. Its own `OWED.md` line covers paginating this
 *  properly if anyone ever approaches it. */
export const MY_ORGS_LIMIT = 100;

/** Every org the caller has ANY relationship with. One row per org even when
 *  they are both staff and member (the default for an owner), so a caller can
 *  never render the same gym twice. */
export async function listOrgsForUser(sql: Sql, userId: string): Promise<MyOrgRow[]> {
  const rows = await sql<
    (RawOrg & { staff_role: string | null; is_member: boolean; joined_at: Date | null })[]
  >`
    SELECT g.id, g.slug, g.name, g.city, g.org_type, g.timezone, g.locale,
           g.currency_display, g.status,
           s.role AS staff_role,
           (m.id IS NOT NULL) AS is_member,
           m.joined_at
    FROM gyms g
    LEFT JOIN gym_staff s ON s.gym_id = g.id AND s.user_id = ${userId}
    LEFT JOIN gym_members m ON m.gym_id = g.id AND m.user_id = ${userId}
                           AND m.removed_at IS NULL
    WHERE s.user_id IS NOT NULL OR m.id IS NOT NULL
    ORDER BY g.created_at DESC, g.id DESC
    LIMIT ${MY_ORGS_LIMIT}`;
  return rows.map((r) => ({
    ...toOrgRow(r),
    staffRole: r.staff_role === null ? null : toOrgRole(r.staff_role),
    isMember: r.is_member,
    joinedAt: r.joined_at,
  }));
}

export async function getOrgById(sql: SqlOrTx, gymId: string): Promise<OrgRow | null> {
  const rows = await sql<RawOrg[]>`
    SELECT id, slug, name, city, org_type, timezone, locale, currency_display, status
    FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : toOrgRow(row);
}

/** The caller's staff role in ONE org. Null means "not staff here", which the
 *  service turns into a 404 — a stranger must not learn the org exists. */
export async function getStaffRole(
  sql: Sql,
  gymId: string,
  userId: string,
): Promise<OrgRole | null> {
  const rows = await sql<{ role: string }[]>`
    SELECT role FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
  const row = rows[0];
  return row === undefined ? null : toOrgRole(row.role);
}

export type JoinOutcome =
  | { kind: "joined"; org: OrgRow; membership: MembershipRow }
  | { kind: "already_member"; org: OrgRow; membership: MembershipRow }
  | { kind: "no_such_code" }
  | { kind: "code_unusable"; reason: "paused" | "expired" | "exhausted" }
  | { kind: "org_archived" }
  | { kind: "consent_required" }
  | { kind: "seat_cap"; cap: number };

/** Part 4 §4.2, the seat-safe join, implemented in its stated order:
 *
 *    BEGIN
 *    SELECT 1 FROM gyms WHERE id=$gym FOR UPDATE   -- serialize joins per org
 *    validate the code (exists, not paused/expired, uses < max_uses)
 *    seat check against the plan's cap
 *    INSERT INTO gym_members ...
 *    UPDATE gym_codes SET uses = uses + 1
 *    COMMIT
 *
 *  THE LOCK IS THE WHOLE POINT and it is on the ORG ROW, not on a count: two
 *  people scanning the same poster at the same instant are serialised here, so
 *  the "last seat" cannot be sold twice. Locking a count would not — the second
 *  transaction would read the same pre-insert number.
 *
 *  §4.2 finishes "on unique_violation of gym_members_live_uq → idempotent
 *  success". That is done DECLARATIVELY, with ON CONFLICT on the same partial
 *  index, for one reason worth keeping: a raised 23505 aborts the surrounding
 *  transaction, so catching it would mean re-running the whole join to answer
 *  "you were already a member". The outcome §4.2 specifies is identical, and a
 *  repeat join deliberately does NOT increment the code's `uses`. */
export async function joinByCode(
  sql: Sql,
  input: { userId: string; code: string; consent: boolean },
): Promise<JoinOutcome> {
  // Which org does this code belong to? Read outside the lock because the
  // gym id is what we have to lock, and re-read INSIDE it below — between
  // these two reads the code could be paused, expired or exhausted by
  // somebody else, and only the second read is authoritative.
  const codeLookup = await sql<{ id: string; gym_id: string }[]>`
    SELECT id, gym_id FROM gym_codes WHERE code = ${input.code}`;
  const found = codeLookup[0];
  if (found === undefined) return { kind: "no_such_code" };

  return await sql.begin(async (tx) => {
    const orgRows = await tx<RawOrg[]>`
      SELECT id, slug, name, city, org_type, timezone, locale, currency_display, status
      FROM gyms WHERE id = ${found.gym_id} FOR UPDATE`;
    const rawOrg = orgRows[0];
    if (rawOrg === undefined) return { kind: "no_such_code" };
    const org = toOrgRow(rawOrg);
    if (org.status !== "active") return { kind: "org_archived" };

    const codeRows = await tx<
      {
        id: string;
        label: string;
        paused: boolean;
        expires_at: Date | null;
        uses: number;
        max_uses: number | null;
      }[]
    >`
      SELECT id, label, paused, expires_at, uses, max_uses
      FROM gym_codes WHERE id = ${found.id} AND gym_id = ${found.gym_id}`;
    const code = codeRows[0];
    if (code === undefined) return { kind: "no_such_code" };
    if (code.paused) return { kind: "code_unusable", reason: "paused" };
    if (code.expires_at !== null && code.expires_at.getTime() <= Date.now()) {
      return { kind: "code_unusable", reason: "expired" };
    }
    if (code.max_uses !== null && code.uses >= code.max_uses) {
      return { kind: "code_unusable", reason: "exhausted" };
    }

    // Part 3 §2.4: joining a CLINIC code IS the consent record. Enforced HERE,
    // in the repo, inside the join transaction — the DDL's comment says "in
    // service", which is where it was expected to live rather than where it
    // ended up (T3 round 2 L-2, corrected in both places). This is the better
    // home anyway: the refusal and the timestamp are then decided in the same
    // transaction as the membership row, so a consented row and its timestamp
    // cannot come apart.
    if (org.orgType === "clinic" && !input.consent) return { kind: "consent_required" };

    // T3 ROUND 1 C/H-1: the seat check must not run for somebody who ALREADY
    // holds a seat. They are inside `used` themselves, so at the cap their
    // second tap on Join came back "this gym has no free places" to a person
    // standing in the gym — §4.2's idempotent success turned into a 409, and
    // the only reason no user hit it is that no gym has a subscription yet.
    // Read under the org lock, so it cannot race with the insert below.
    const heldRows = await tx<{ id: string }[]>`
      SELECT id FROM gym_members
      WHERE gym_id = ${org.id} AND user_id = ${input.userId} AND removed_at IS NULL`;
    const alreadyHolds = heldRows[0] !== undefined;

    if (!alreadyHolds) {
      const cap = await seatCapFor(tx, org.id);
      if (cap !== null) {
        const countRows = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM gym_members
          WHERE gym_id = ${org.id} AND removed_at IS NULL AND complimentary = false`;
        const used = countRows[0]?.n ?? 0;
        if (used >= cap) return { kind: "seat_cap", cap };
      }
    }

    const consentAt = input.consent ? new Date() : null;
    const inserted = await tx<{ id: string; joined_at: Date }[]>`
      INSERT INTO gym_members (gym_id, user_id, code_id, consent_at, complimentary)
      VALUES (${org.id}, ${input.userId}, ${code.id}, ${consentAt}, false)
      ON CONFLICT (gym_id, user_id) WHERE removed_at IS NULL DO NOTHING
      RETURNING id, joined_at`;

    const newRow = inserted[0];
    if (newRow === undefined) {
      const existingRows = await tx<{ id: string; joined_at: Date; label: string | null }[]>`
        SELECT m.id, m.joined_at, c.label
        FROM gym_members m
        LEFT JOIN gym_codes c ON c.id = m.code_id
        WHERE m.gym_id = ${org.id} AND m.user_id = ${input.userId}
          AND m.removed_at IS NULL`;
      const existing = existingRows[0];
      if (existing === undefined) {
        // The conflict fired, so a live row existed a moment ago; nothing in
        // this transaction can remove it. Loud rather than a fabricated reply.
        throw new Error("gym_members conflict with no live row to return");
      }
      return {
        kind: "already_member",
        org,
        membership: {
          id: existing.id,
          joinedAt: existing.joined_at,
          groupLabel: existing.label,
        },
      };
    }

    await tx`UPDATE gym_codes SET uses = uses + 1 WHERE id = ${code.id}`;
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: org.id,
      action: "org.member_joined",
      targetType: "gym_member",
      targetId: newRow.id,
      meta: { codeLabel: code.label },
    });

    return {
      kind: "joined",
      org,
      membership: { id: newRow.id, joinedAt: newRow.joined_at, groupLabel: code.label },
    };
  });
}

/** The org's seat cap, or null when nothing caps it.
 *
 *  Null has TWO causes and they are deliberately not distinguished here: the
 *  plan declares no cap (`seat_cap` is nullable for capless tiers), or the org
 *  has no live subscription at all — which today is EVERY org, because billing
 *  does not exist yet. The uncapped-without-a-plan case is a tracked deferral
 *  (OWED.md), not an oversight: the check below is live and correct the moment
 *  a subscription row exists.
 *
 *  Status set is §4.1's, so `past_due` still grants during v1 §10's grace. */
async function seatCapFor(tx: TransactionSql, gymId: string): Promise<number | null> {
  const rows = await tx<{ seat_cap: number | null }[]>`
    SELECT p.seat_cap
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.owner_type = 'gym' AND s.owner_id = ${gymId}
      AND s.status IN ('trialing','active','past_due')`;
  return rows[0]?.seat_cap ?? null;
}

/** Roster page, keyset-ordered on (joined_at, id) DESC.
 *
 *  Part 3 §4.3's default sort is last-active desc; that column comes from
 *  `org_member_stats`, which this slice does not build, so the order here is
 *  newest-joined-first and the cursor matches it exactly. Sorting is not
 *  cosmetic for a cursor walk: an ordering the cursor does not match drops or
 *  repeats rows silently. */
export async function listMembers(
  sql: Sql,
  input: { gymId: string; limit: number; cursor: { joinedAt: string; id: string } | null },
): Promise<{ items: MemberRow[]; nextCursor: { joinedAt: Date; id: string } | null }> {
  const cursorJoinedAt = input.cursor?.joinedAt ?? null;
  const cursorId = input.cursor?.id ?? null;
  const rows = await sql<
    {
      id: string;
      user_id: string;
      display_name: string;
      joined_at: Date;
      group_label: string | null;
      complimentary: boolean;
    }[]
  >`
    SELECT m.id, m.user_id, u.display_name, m.joined_at,
           c.label AS group_label, m.complimentary
    FROM gym_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN gym_codes c ON c.id = m.code_id
    WHERE m.gym_id = ${input.gymId}
      AND m.removed_at IS NULL
      AND (
        ${cursorJoinedAt}::timestamptz IS NULL
        OR (m.joined_at, m.id) < (${cursorJoinedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY m.joined_at DESC, m.id DESC
    LIMIT ${input.limit + 1}`;

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > input.limit && last !== undefined
      ? { joinedAt: last.joined_at, id: last.id }
      : null;
  return {
    items: page.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name,
      joinedAt: r.joined_at,
      groupLabel: r.group_label,
      complimentary: r.complimentary,
    })),
    nextCursor,
  };
}

/** Every join code belonging to ONE org, oldest first — so Part 3 §4.0 step 4's
 *  "Front Desk" code, the one created with the gym, is the one at the top of an
 *  owner's screen.
 *
 *  Tenancy IS the WHERE (R3.2), and note what is deliberately absent: this
 *  module has no read-a-code-by-id anywhere, so a code can only ever be reached
 *  through a gym the caller was authorised against first. The join path's own
 *  lookup is by `code` and returns nothing but the ids it needs to lock. */
export async function listCodes(sql: Sql, gymId: string): Promise<CodeRow[]> {
  const rows = await sql<
    {
      code: string;
      label: string;
      paused: boolean;
      expires_at: Date | null;
      max_uses: number | null;
      uses: number;
    }[]
  >`
    SELECT code, label, paused, expires_at, max_uses, uses
    FROM gym_codes
    WHERE gym_id = ${gymId}
    ORDER BY created_at ASC, code ASC`;
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    paused: r.paused,
    expiresAt: r.expires_at,
    maxUses: r.max_uses,
    uses: r.uses,
  }));
}

/** Part 3 §3.3: "every mutating call writes `audit_log`". Written inside the
 *  caller's transaction, so a join that is rolled back leaves no audit row
 *  claiming it happened, and a committed join can never be missing one. */
export async function insertAudit(
  tx: TransactionSql,
  entry: {
    actorUserId: string;
    gymId: string;
    action: string;
    targetType: string;
    targetId: string;
    /** String-valued by construction: an audit row is read by a human weeks
     *  later, and a nested object is where the interesting field goes to hide.
     *  Widen it when a caller genuinely needs structure, not before. */
    meta: Record<string, string>;
  },
): Promise<void> {
  await tx`
    INSERT INTO audit_log (actor_user_id, gym_id, action, target_type, target_id, meta)
    VALUES (${entry.actorUserId}, ${entry.gymId}, ${entry.action},
            ${entry.targetType}, ${entry.targetId}, ${tx.json(entry.meta)})`;
}
