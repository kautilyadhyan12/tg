// Orgs repo — gyms / gym_codes / gym_members / gym_staff /
// gym_join_applications (v1 §6.2). Every query that reads or writes a
// tenant-owned row carries the gym id (and, for "my orgs" and the applicant's
// own list, the user id) in its WHERE — a fetch-by-id alone would be an IDOR
// (R3.2).
//
// THE HEADER USED TO SAY "the ONLY file that touches" those tables AND THAT
// WAS ALREADY FALSE when it was written: the DPDP Day-0 flow in
// `modules/users/repo.ts` closes `gym_members` inline, because the deletion
// cascade is cross-cutting and R7.1 forbids it calling into this repo. The
// 2026-08-19 waiting-room card added a second such statement beside it
// (cancelling pending applications) and corrected this sentence rather than
// adding a second breach of a rule the file claimed to keep. A record is a
// claim (:8707): the two DPDP statements are the whole exception, and any
// THIRD writer of these tables is a defect, not a precedent.
import type { Sql, TransactionSql } from "postgres";
import {
  orgApplicationStatusSchema,
  orgRoleSchema,
  orgStatusSchema,
  orgTypeSchema,
} from "@app/shared";
import type { OrgApplicationStatus, OrgRole, OrgStatus, OrgType } from "@app/shared";

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

/** A join application as its own applicant sees it (Kd ruling :11072). */
export interface ApplicationRow {
  id: string;
  status: OrgApplicationStatus;
  appliedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
}

/** One row of the console's confirm queue. */
export interface ApplicantRow {
  id: string;
  userId: string;
  displayName: string;
  appliedAt: Date;
  expiresAt: Date;
  groupLabel: string;
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

interface RawApplication {
  id: string;
  status: string;
  applied_at: Date;
  expires_at: Date;
  decided_at: Date | null;
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
function toApplicationStatus(value: string): OrgApplicationStatus {
  return orgApplicationStatusSchema.parse(value);
}

function toApplicationRow(raw: RawApplication): ApplicationRow {
  return {
    id: raw.id,
    status: toApplicationStatus(raw.status),
    appliedAt: raw.applied_at,
    expiresAt: raw.expires_at,
    decidedAt: raw.decided_at,
  };
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

export type ApplyOutcome =
  | { kind: "pending"; org: OrgRow; application: ApplicationRow }
  | { kind: "already_pending"; org: OrgRow; application: ApplicationRow }
  | { kind: "already_member"; org: OrgRow; membership: MembershipRow }
  | { kind: "no_such_code" }
  | { kind: "code_unusable"; reason: "paused" | "expired" | "exhausted" }
  | { kind: "org_archived" }
  | { kind: "consent_required" };

/** :11385's ratified default: a pending application dies after 14 days if
 *  nobody acts on it. Stamped at APPLY time rather than computed by the sweep,
 *  so the row carries its own deadline and the sweep is a reader — a deadline
 *  the sweep computes is a deadline that changes when the sweep changes. */
export const APPLICATION_TTL_DAYS = 14;

/** KD RULING 2026-08-19 (:11072) — typing a code creates an APPLICATION.
 *
 *  **NO SEAT IS TAKEN AND NO MEMBERSHIP ROW IS WRITTEN HERE.** That is the
 *  whole content of the ruling: a leaked code yields the owner a reject list
 *  rather than a full roster, and a real member is never locked out by
 *  strangers because strangers consume nothing while pending. The membership
 *  is created at CONFIRM, by `claimSeat` below, which is where Part 4 §4.2
 *  now lives.
 *
 *  **NO `FOR UPDATE` ON THE ORG ROW, deliberately.** §4.2's lock exists to
 *  serialise SEAT consumption; applying consumes nothing, so taking it would
 *  serialise every applicant in a gym gym-wide for no guarantee. Two
 *  simultaneous applies from one account race on
 *  `gym_join_applications_pending_uq` instead and `ON CONFLICT DO NOTHING`
 *  settles it — the same declarative idempotence §4.2 uses, for the same
 *  reason (a raised 23505 would abort the transaction).
 *
 *  **`uses` IS NOT INCREMENTED HERE EITHER** — see `claimSeat`. A code's
 *  `uses` counts memberships it created; if applying burned a use, a stranger
 *  with a leaked code could exhaust a `max_uses` code and shut a real gym's
 *  poster down without ever getting in.
 *
 *  Check ORDER is unchanged from the pre-ruling join: the code's own refusals
 *  come before the membership check, so an existing member re-typing a paused
 *  code still gets the code refusal. That is TRUE, therefore not :5807's
 *  class, and it was reviewed as correct at :10329 — do not "improve" it into
 *  an already_member answer. */
export async function applyByCode(
  sql: Sql,
  input: { userId: string; code: string; consent: boolean },
): Promise<ApplyOutcome> {
  const codeLookup = await sql<{ id: string; gym_id: string }[]>`
    SELECT id, gym_id FROM gym_codes WHERE code = ${input.code}`;
  const found = codeLookup[0];
  if (found === undefined) return { kind: "no_such_code" };

  return await sql.begin(async (tx) => {
    const orgRows = await tx<RawOrg[]>`
      SELECT id, slug, name, city, org_type, timezone, locale, currency_display, status
      FROM gyms WHERE id = ${found.gym_id}`;
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

    // Part 3 §2.4: joining a CLINIC code IS the consent record. The refusal
    // stays here and the TIMESTAMP is captured on the APPLICATION, then copied
    // onto the membership at confirm — so the consent record is dated to the
    // moment the person agreed, not to the moment the front desk got round to
    // them. (Clinics are out of the product per :10182; this path is reachable
    // only by a legacy row, and it stays live for exactly that reason.)
    if (org.orgType === "clinic" && !input.consent) return { kind: "consent_required" };

    const existingMember = await liveMembership(tx, org.id, input.userId);
    if (existingMember !== null) {
      return { kind: "already_member", org, membership: existingMember };
    }

    const consentAt = input.consent ? new Date() : null;
    const inserted = await tx<RawApplication[]>`
      INSERT INTO gym_join_applications (gym_id, user_id, code_id, consent_at, expires_at)
      VALUES (${org.id}, ${input.userId}, ${code.id}, ${consentAt},
              now() + (${APPLICATION_TTL_DAYS} * INTERVAL '1 day'))
      ON CONFLICT (gym_id, user_id) WHERE status = 'pending' DO NOTHING
      RETURNING id, status, applied_at, expires_at, decided_at`;

    const newRow = inserted[0];
    if (newRow === undefined) {
      const existingRows = await tx<RawApplication[]>`
        SELECT id, status, applied_at, expires_at, decided_at
        FROM gym_join_applications
        WHERE gym_id = ${org.id} AND user_id = ${input.userId} AND status = 'pending'`;
      const existing = existingRows[0];
      if (existing === undefined) {
        // The conflict fired, so a pending row existed a moment ago; nothing
        // in this transaction can have removed it. Loud rather than a
        // fabricated reply (the `gym_members` branch's own precedent).
        throw new Error("gym_join_applications conflict with no pending row to return");
      }
      return { kind: "already_pending", org, application: toApplicationRow(existing) };
    }

    // Part 3 §3.3: every mutating call writes `audit_log`. Applying is a
    // mutation by the MEMBER, and it is the row that answers "when did this
    // person first ask?" if a gym ever disputes it.
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: org.id,
      action: "org.join_applied",
      targetType: "gym_join_application",
      targetId: newRow.id,
      meta: { codeLabel: code.label },
    });

    return { kind: "pending", org, application: toApplicationRow(newRow) };
  });
}

/** The caller's LIVE membership in one org, or null. Extracted because the
 *  apply path, the seat claim and the confirm path all ask the same question
 *  and three spellings of it is how two of them drift. */
async function liveMembership(
  tx: SqlOrTx,
  gymId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const rows = await tx<{ id: string; joined_at: Date; label: string | null }[]>`
    SELECT m.id, m.joined_at, c.label
    FROM gym_members m
    LEFT JOIN gym_codes c ON c.id = m.code_id
    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL`;
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, joinedAt: row.joined_at, groupLabel: row.label };
}

export type ClaimSeatOutcome =
  | { kind: "joined"; membership: MembershipRow }
  | { kind: "already_member"; membership: MembershipRow }
  | { kind: "seat_cap"; cap: number };

/** PART 4 §4.2, THE SEAT-SAFE JOIN — moved here INTACT when the join door
 *  became an application door (Kd ruling :11072). The statements and their
 *  order are the ones that were written and reviewed against §4.2; what
 *  changed is WHO triggers them (the gym's front desk, at confirm) and not
 *  WHAT they do.
 *
 *    -- caller holds:  SELECT 1 FROM gyms WHERE id=$gym FOR UPDATE
 *    seat check: (count live, non-complimentary members) < plan.seat_cap
 *    INSERT INTO gym_members ...
 *    UPDATE gym_codes SET uses = uses + 1
 *
 *  **THE ORG-ROW LOCK IS THE WHOLE POINT and this function does NOT take it —
 *  its caller does, and must.** It is a precondition rather than something
 *  taken here because the confirm path locks the APPLICATION row first and
 *  lock order has to be decided in one place: application → gym, always.
 *  Locking a COUNT instead of the org row would serialise nothing — the second
 *  transaction reads the same pre-insert number.
 *
 *  §4.2 finishes "on unique_violation of gym_members_live_uq → idempotent
 *  success". Done DECLARATIVELY with ON CONFLICT on the same partial index: a
 *  raised 23505 aborts the surrounding transaction, so catching it would mean
 *  re-running the whole claim to answer "already a member". A repeat
 *  deliberately does NOT increment the code's `uses`.
 *
 *  **THE CODE'S AUTOMATIC REFUSALS (paused / expired / max_uses) ARE NOT
 *  RE-APPLIED HERE, and that is a decision, not an omission.** They gate the
 *  APPLY door, where they stop a dead poster admitting strangers. At confirm a
 *  human being has looked at a named person and said yes; refusing them
 *  because the gym paused the code afterwards would be the app overruling the
 *  gym about its own member. The SEAT cap is different and is enforced — that
 *  one is money, and it is not the front desk's to waive. */
async function claimSeat(
  tx: TransactionSql,
  input: {
    org: OrgRow;
    userId: string;
    codeId: string;
    codeLabel: string;
    consentAt: Date | null;
  },
): Promise<ClaimSeatOutcome> {
  // T3 ROUND 1 C/H-1 (carried forward verbatim): the seat check must not run
  // for somebody who ALREADY holds a seat. They are inside `used` themselves,
  // so at the cap this returned "this gym has no free places" about a person
  // already standing in the gym. Read under the caller's org lock, so it
  // cannot race with the insert below.
  const held = await liveMembership(tx, input.org.id, input.userId);

  if (held === null) {
    const cap = await seatCapFor(tx, input.org.id);
    if (cap !== null) {
      const countRows = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_members
        WHERE gym_id = ${input.org.id} AND removed_at IS NULL AND complimentary = false`;
      const used = countRows[0]?.n ?? 0;
      if (used >= cap) return { kind: "seat_cap", cap };
    }
  }

  const inserted = await tx<{ id: string; joined_at: Date }[]>`
    INSERT INTO gym_members (gym_id, user_id, code_id, consent_at, complimentary)
    VALUES (${input.org.id}, ${input.userId}, ${input.codeId}, ${input.consentAt}, false)
    ON CONFLICT (gym_id, user_id) WHERE removed_at IS NULL DO NOTHING
    RETURNING id, joined_at`;

  const newRow = inserted[0];
  if (newRow === undefined) {
    const existing = held ?? (await liveMembership(tx, input.org.id, input.userId));
    if (existing === null) {
      // The conflict fired, so a live row existed a moment ago; nothing in
      // this transaction can remove it. Loud rather than a fabricated reply.
      throw new Error("gym_members conflict with no live row to return");
    }
    return { kind: "already_member", membership: existing };
  }

  await tx`UPDATE gym_codes SET uses = uses + 1 WHERE id = ${input.codeId}`;
  return {
    kind: "joined",
    membership: { id: newRow.id, joinedAt: newRow.joined_at, groupLabel: input.codeLabel },
  };
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

export type DecideOutcome =
  /** `applicantUserId` travels WITH the outcome rather than being re-read by
   *  the service: the person whose entitlements just changed is the applicant,
   *  and a second query to find out who they were is a second query that can
   *  disagree with the row this transaction just wrote. */
  | { kind: "confirmed"; membership: MembershipRow; applicantUserId: string }
  | { kind: "already_confirmed"; memberId: string | null }
  | { kind: "rejected" }
  | { kind: "not_found" }
  | { kind: "not_pending"; status: OrgApplicationStatus }
  | { kind: "org_archived" }
  | { kind: "seat_cap"; cap: number };

/** THE FRONT DESK'S TAP — the only path in the product that turns a code into
 *  a membership (Kd ruling :11072).
 *
 *  **LOCK ORDER IS application → gym, ALWAYS, and it is decided here** because
 *  this is the only function that takes both. `claimSeat` takes neither on
 *  purpose (see its comment): a second lock order anywhere in this module is a
 *  deadlock waiting for two front-desk staff working the queue at once.
 *
 *  **A FULL GYM DOES NOT DESTROY THE APPLICATION.** `seat_cap` returns with
 *  the row still `pending`, so the owner adds a seat and taps again rather
 *  than hunting for a person the app threw away — the same instinct behind
 *  §4.2's idempotent success, applied to the failure side.
 *
 *  Tenancy is the WHERE (R3.2): the application is addressed by `id` AND
 *  `gym_id`, so a staff member of one gym cannot decide another gym's
 *  application even holding its uuid. */
export async function confirmApplication(
  sql: Sql,
  input: { gymId: string; applicationId: string; actorUserId: string },
): Promise<DecideOutcome> {
  return await sql.begin(async (tx) => {
    const appRows = await tx<
      (RawApplication & { user_id: string; code_id: string; consent_at: Date | null; member_id: string | null })[]
    >`
      SELECT id, status, applied_at, expires_at, decided_at,
             user_id, code_id, consent_at, member_id
      FROM gym_join_applications
      WHERE id = ${input.applicationId} AND gym_id = ${input.gymId}
      FOR UPDATE`;
    const app = appRows[0];
    if (app === undefined) return { kind: "not_found" };

    const status = toApplicationStatus(app.status);
    // A double tap on Confirm is a person pressing a button twice, not an
    // error: report the same outcome rather than "that is not pending".
    if (status === "confirmed") return { kind: "already_confirmed", memberId: app.member_id };
    if (status !== "pending") return { kind: "not_pending", status };

    const orgRows = await tx<RawOrg[]>`
      SELECT id, slug, name, city, org_type, timezone, locale, currency_display, status
      FROM gyms WHERE id = ${input.gymId} FOR UPDATE`;
    const rawOrg = orgRows[0];
    if (rawOrg === undefined) return { kind: "not_found" };
    const org = toOrgRow(rawOrg);
    if (org.status !== "active") return { kind: "org_archived" };

    const codeRows = await tx<{ label: string }[]>`
      SELECT label FROM gym_codes WHERE id = ${app.code_id} AND gym_id = ${input.gymId}`;
    const codeLabel = codeRows[0]?.label ?? null;
    if (codeLabel === null) {
      // The FK is NOT NULL and gym-scoped, so this cannot happen without the
      // code row being deleted out from under a live application. Loud.
      throw new Error("join application references a code that is not this gym's");
    }

    const claim = await claimSeat(tx, {
      org,
      userId: app.user_id,
      codeId: app.code_id,
      codeLabel,
      consentAt: app.consent_at,
    });
    if (claim.kind === "seat_cap") return { kind: "seat_cap", cap: claim.cap };

    await tx`
      UPDATE gym_join_applications
      SET status = 'confirmed', decided_at = now(),
          decided_by_user_id = ${input.actorUserId}, member_id = ${claim.membership.id}
      WHERE id = ${app.id}`;

    // The actor is the STAFF member who confirmed, not the joiner — that is
    // the whole point of the record. `applicantUserId` is in `meta` because
    // `target_id` is the membership the tap produced.
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: org.id,
      action: "org.member_joined",
      targetType: "gym_member",
      targetId: claim.membership.id,
      meta: {
        codeLabel,
        applicationId: app.id,
        applicantUserId: app.user_id,
        via: "front_desk_confirm",
      },
    });

    return { kind: "confirmed", membership: claim.membership, applicantUserId: app.user_id };
  });
}

/** "Not this person." The row is closed, not deleted — a rejection is history
 *  the gym may need, and :11385's re-apply is free, so the applicant is not
 *  locked out by it (the per-route rate limit is what bounds a stranger's
 *  retries, never a permanent block on a real member who was mis-tapped). */
export async function rejectApplication(
  sql: Sql,
  input: { gymId: string; applicationId: string; actorUserId: string },
): Promise<DecideOutcome> {
  return await sql.begin(async (tx) => {
    const appRows = await tx<(RawApplication & { user_id: string })[]>`
      SELECT id, status, applied_at, expires_at, decided_at, user_id
      FROM gym_join_applications
      WHERE id = ${input.applicationId} AND gym_id = ${input.gymId}
      FOR UPDATE`;
    const app = appRows[0];
    if (app === undefined) return { kind: "not_found" };

    const status = toApplicationStatus(app.status);
    if (status !== "pending") return { kind: "not_pending", status };

    await tx`
      UPDATE gym_join_applications
      SET status = 'rejected', decided_at = now(), decided_by_user_id = ${input.actorUserId}
      WHERE id = ${app.id}`;

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.join_rejected",
      targetType: "gym_join_application",
      targetId: app.id,
      meta: { applicantUserId: app.user_id },
    });

    return { kind: "rejected" };
  });
}

/** The console's confirm queue: pending applications for ONE gym, OLDEST
 *  FIRST — a queue is answered in the order people asked, and the person who
 *  has waited longest is the one closest to :11385's expiry.
 *
 *  `pendingCount` is an EXACT count over the whole queue, not this page's
 *  length: :10402's rule, because "3 people waiting" printed off a page of 3
 *  out of 90 is a wrong number on screen (:5807).
 *
 *  **THE CURSOR IS THE ROW'S ID AND THE COMPARISON READS THE ROW'S OWN STORED
 *  TIMESTAMP, which is NOT how the roster next door does it — and the
 *  difference is a bug this card's own new test caught.** Postgres stores
 *  `timestamptz` to the MICROSECOND (measured: `now()` = …467902) while a JS
 *  `Date` and therefore `toISOString()` carry MILLISECONDS (…467). A cursor
 *  built from the serialized timestamp is thus slightly SMALLER than the row it
 *  names, so an ASC `>` comparison lets that row back in and **the last row of
 *  every page reappears as the first row of the next.** Feeding the id back and
 *  letting SQL fetch the true value removes the round trip through a lossy
 *  format entirely.
 *
 *  **The roster's cursor has the mirror-image latent defect and is NOT touched
 *  here (R1.1):** DESC + `<` against a too-small cursor EXCLUDES rather than
 *  repeats, so instead of a duplicate it can silently SKIP a member whose
 *  `joined_at` falls between the truncated millisecond and the true value. It
 *  needs two rows inside the same millisecond to bite, which is why four
 *  fixtures created seconds apart have never shown it. Own `OWED.md` line. */
export async function listApplications(
  sql: Sql,
  input: { gymId: string; limit: number; cursor: string | null },
): Promise<{ items: ApplicantRow[]; nextCursor: string | null; pendingCount: number }> {
  const cursorId = input.cursor;
  // T3 L-2 — WHY THE `NOT EXISTS` ARM BELOW EXISTS. A well-formed cursor
  // naming a row this gym does not have must fall back to the FIRST page, not
  // blank the queue. The scalar subquery yields no row, so
  // `(a.applied_at, a.id) > NULL` evaluates to NULL rather than false, and NULL
  // filters every row out: the page came back empty while `pendingCount` still
  // reported the true total — a console showing "3 people waiting" over an
  // empty list. Verified against the live database rather than reasoned:
  // `((now(), gen_random_uuid()) > (SELECT ... WHERE false)) IS NULL` → true.
  // It also restores the convention the service states out loud, since a
  // MALFORMED cursor already restarted and a stale one must behave the same.
  //
  // (Written here and not as a SQL comment inside the query on purpose: this
  // paragraph names identifiers in backticks, and a backtick inside the
  // template literal ENDS it — which is exactly how the first attempt turned
  // into six parse errors.)
  const rows = await sql<
    {
      id: string;
      user_id: string;
      display_name: string;
      applied_at: Date;
      expires_at: Date;
      group_label: string;
    }[]
  >`
    SELECT a.id, a.user_id, u.display_name, a.applied_at, a.expires_at,
           c.label AS group_label
    FROM gym_join_applications a
    JOIN users u ON u.id = a.user_id
    JOIN gym_codes c ON c.id = a.code_id
    WHERE a.gym_id = ${input.gymId}
      AND a.status = 'pending'
      AND (
        ${cursorId}::uuid IS NULL
        -- T3 L-2, explained above this query: an unknown cursor restarts.
        OR NOT EXISTS (
          SELECT 1 FROM gym_join_applications c
          WHERE c.id = ${cursorId}::uuid AND c.gym_id = ${input.gymId}
        )
        OR (a.applied_at, a.id) > (
          SELECT c.applied_at, c.id FROM gym_join_applications c
          WHERE c.id = ${cursorId}::uuid AND c.gym_id = ${input.gymId}
        )
      )
    ORDER BY a.applied_at ASC, a.id ASC
    LIMIT ${input.limit + 1}`;

  const countRows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_join_applications
    WHERE gym_id = ${input.gymId} AND status = 'pending'`;

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > input.limit && last !== undefined ? last.id : null;
  return {
    items: page.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name,
      appliedAt: r.applied_at,
      expiresAt: r.expires_at,
      groupLabel: r.group_label,
    })),
    nextCursor,
    pendingCount: countRows[0]?.n ?? 0,
  };
}

/** How long a DECIDED application stays visible to the person who made it.
 *
 *  It exists because a rejected applicant must be TOLD — leaving "waiting for
 *  Iron House" on screen after the gym said no is the app stating something
 *  false (:5807), and silently vanishing the card leaves a real member who was
 *  mis-tapped with no idea what happened. It is a DISPLAY window and not a
 *  rule about the data; 14 days mirrors the application's own life so a person
 *  cannot see the outcome for longer than the wait that produced it. */
export const DECIDED_VISIBLE_DAYS = 14;

/** Bounded like `MY_ORGS_LIMIT` and for the same reason. A person applies to
 *  one or two gyms; this ceiling exists so the response has one at all. */
export const MY_APPLICATIONS_LIMIT = 50;

/** The applicant's own applications: everything still pending, plus anything
 *  recently decided AGAINST them so the screen can say so.
 *
 *  `confirmed` rows are deliberately excluded — once a confirm lands the
 *  person is a member, `/v1/orgs/mine` is where that fact lives, and two
 *  readers claiming the same thing is two readers that can disagree. */
export async function listApplicationsForUser(
  sql: Sql,
  userId: string,
): Promise<{ org: OrgRow; application: ApplicationRow }[]> {
  // Every column is aliased explicitly. The two tables BOTH carry `id` and
  // `status`, and an unaliased join would hand one of each to the row object —
  // silently parsing a gym's 'active' as an application status, or worse the
  // other way round. Naming them is the guard.
  interface RawMyApplication {
    app_id: string;
    app_status: string;
    applied_at: Date;
    expires_at: Date;
    decided_at: Date | null;
    org_id: string;
    slug: string;
    name: string;
    city: string | null;
    org_type: string;
    timezone: string;
    locale: string;
    currency_display: string;
    org_status: string;
  }
  const rows = await sql<RawMyApplication[]>`
    SELECT a.id AS app_id, a.status AS app_status, a.applied_at, a.expires_at,
           a.decided_at,
           g.id AS org_id, g.slug, g.name, g.city, g.org_type, g.timezone,
           g.locale, g.currency_display, g.status AS org_status
    FROM gym_join_applications a
    JOIN gyms g ON g.id = a.gym_id
    WHERE a.user_id = ${userId}
      AND (
        a.status = 'pending'
        OR (a.status IN ('rejected','expired')
            AND coalesce(a.decided_at, a.expires_at)
                > now() - (${DECIDED_VISIBLE_DAYS} * INTERVAL '1 day'))
      )
    ORDER BY a.applied_at DESC, a.id DESC
    LIMIT ${MY_APPLICATIONS_LIMIT}`;
  return rows.map((r) => ({
    org: toOrgRow({
      id: r.org_id,
      slug: r.slug,
      name: r.name,
      city: r.city,
      org_type: r.org_type,
      timezone: r.timezone,
      locale: r.locale,
      currency_display: r.currency_display,
      status: r.org_status,
    }),
    application: toApplicationRow({
      id: r.app_id,
      status: r.app_status,
      applied_at: r.applied_at,
      expires_at: r.expires_at,
      decided_at: r.decided_at,
    }),
  }));
}

export type RemoveMemberOutcome =
  | { kind: "removed" }
  | { kind: "already_removed" }
  | { kind: "never_member" }
  | { kind: "is_staff"; role: OrgRole };

/** PART 3 §4.3's REMOVE — "sets `removed_at` (seat freed instantly; history
 *  retained)".
 *
 *  **Why this exists at all, and it is Kd's finding:** shown that a confirmed
 *  member could not be removed by anyone, he answered *"if someone joins once
 *  can not be removed what is this"*. Measured before building: the only
 *  statement in the whole product that had ever written `removed_at` was the
 *  DPDP Day-0 cascade in `users/repo.ts`, i.e. a person deleting their own
 *  account. A gym had no way to correct a mis-tap, and Confirm was therefore a
 *  one-way door.
 *
 *  **THE ROW IS CLOSED, NEVER DELETED.** `[joined_at, removed_at)` is the
 *  membership interval every org-side reader is scoped by (§2.1), so closing
 *  it ends the relationship without touching a single workout: the member
 *  keeps their history, and the gym keeps the record that this person was
 *  theirs for that period. A DELETE would silently rewrite both.
 *
 *  **THE SEAT IS FREED BY THE SAME STATEMENT** — `claimSeat` counts live,
 *  non-complimentary rows, so there is no counter to decrement and no second
 *  place to get wrong.
 *
 *  **STAFF ARE REFUSED HERE, DELIBERATELY.** An owner is member #1 of their own
 *  gym (§4.0 step 6) and a manager may be too, so this route is one tap away
 *  from an owner closing their own seat — with no restore built and no staff
 *  screen to undo it from. §4.7 blocks last-owner removal for the same family
 *  of reason; this is the narrower, safer version of it while the staff card is
 *  unbuilt. A gym that genuinely needs to remove a staff member's membership
 *  waits for that card rather than losing one irreversibly here.
 *
 *  Tenancy is the WHERE (R3.2): gym id AND user id, so holding a uuid from
 *  another gym removes nobody. */
export async function removeMember(
  sql: Sql,
  input: { gymId: string; userId: string; actorUserId: string },
): Promise<RemoveMemberOutcome> {
  return await sql.begin(async (tx) => {
    const staffRows = await tx<{ role: string }[]>`
      SELECT role FROM gym_staff WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;
    const staff = staffRows[0];
    if (staff !== undefined) return { kind: "is_staff", role: toOrgRole(staff.role) };

    const closed = await tx<{ id: string }[]>`
      UPDATE gym_members SET removed_at = now()
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND removed_at IS NULL
      RETURNING id`;
    const row = closed[0];

    if (row === undefined) {
      // Two different facts, and they are not merged: a SECOND tap (a row
      // exists, already closed) is idempotent success, while a request naming
      // somebody who was never in this gym is a 404 — the console only offers
      // this button on a roster row, so that case means the screen is stale or
      // the id came from somewhere it should not have. Answering "removed" to
      // it would be a true-sounding reply to a request nothing honoured.
      const everRows = await tx<{ id: string }[]>`
        SELECT id FROM gym_members
        WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}
        LIMIT 1`;
      return everRows[0] === undefined ? { kind: "never_member" } : { kind: "already_removed" };
    }

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.member_removed",
      targetType: "gym_member",
      targetId: row.id,
      meta: { removedUserId: input.userId },
    });

    return { kind: "removed" };
  });
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
/** T3 L-1: a bound, for the same reason `MY_ORGS_LIMIT` has one — every other
 *  list in this module is bounded and this one was not. Unreachable today (a gym
 *  has exactly one code, minted with it), but `POST /codes` is already owed and
 *  a gym running a code per class could pass this. Whoever first has a caller
 *  near it owes the cursor; the roster reader is the worked pattern. */
export const ORG_CODES_LIMIT = 100;

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
    ORDER BY created_at ASC, code ASC
    LIMIT ${ORG_CODES_LIMIT}`;
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
