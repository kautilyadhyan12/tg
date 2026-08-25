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
  /** ISO 3166-1 alpha-2, or `null` for a gym created before migration `0014`
   *  wrote the column — the wizard asked and the server discarded the answer. */
  country: string | null;
  orgType: OrgType;
  timezone: string;
  locale: string;
  currencyDisplay: string;
  status: OrgStatus;
}

export interface MyOrgRow extends OrgRow {
  staffRole: OrgRole | null;
  /** THE STORED TICKS ON THE CALLER'S OWN STAFF ROW, raw. `null` means either no
   *  staff row at all (a plain member) or a row written before the column
   *  existed — the service's `privilegesFor` is the one place that tells those
   *  apart, exactly as it does for `getStaffAuthority`. Never interpreted here
   *  (T3 round 1 C/H-1). */
  privileges: string[] | null;
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
  /** Does this person occupy one of the gym's paid places? Derived, never
   *  stored — see `listMembers`, which writes out `claimSeat`'s count rule. */
  takesSeat: boolean;
}

export interface CodeRow {
  code: string;
  label: string;
  paused: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  /** People in the gym NOW who came through this code — see `toCodeRow`. */
  joined: number;
}

/** A join application as its own applicant sees it (Kd ruling :11072). */
export interface ApplicationRow {
  id: string;
  status: OrgApplicationStatus;
  appliedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  /** Last time this person tapped "Remind them" (:11385 mechanic 3). */
  nudgedAt: Date | null;
}

/** One row of the console's confirm queue. */
export interface ApplicantRow {
  id: string;
  userId: string;
  displayName: string;
  appliedAt: Date;
  expiresAt: Date;
  groupLabel: string;
  /** Stamped by the reminder sweep, and read by the expiry statement before it
   *  is allowed to touch this row — one fact, so the mark the owner sees and
   *  the gate the machine obeys cannot disagree (:11385's ordering rule). */
  gymNotifiedAt: Date | null;
  nudgedAt: Date | null;
}

interface RawOrg {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
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
  member_nudged_at: Date | null;
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
    nudgedAt: raw.member_nudged_at,
  };
}

function toOrgRow(raw: RawOrg): OrgRow {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    city: raw.city,
    country: raw.country,
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
  /** The country the wizard asked for, STORED from this card on. It used to
   *  reach the service, become a currency and evaporate — so every gym created
   *  before migration `0014` reads back `null` and no honest backfill exists. */
  country: string;
  orgType: OrgType;
  timezone: string;
  locale: string;
  currencyDisplay: string;
  code: string;
  codeLabel: string;
  /** The owner's starting ticks, computed by the service from the owner role's
   *  template — policy stays in one place, storage in this one. */
  ownerPrivileges: readonly string[];
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
        INSERT INTO gyms (slug, name, city, country, org_type, timezone, locale,
                          currency_display, owner_user_id)
        VALUES (${input.slug}, ${input.name}, ${input.city}, ${input.country},
                ${input.orgType}, ${input.timezone}, ${input.locale},
                ${input.currencyDisplay}, ${input.ownerUserId})
        RETURNING id, slug, name, city, country, org_type, timezone, locale,
                  currency_display, status`;
      const rawOrg = orgRows[0];
      if (rawOrg === undefined) throw new Error("INSERT INTO gyms returned no row");
      const org = toOrgRow(rawOrg);

      // The owner's ticks are written HERE, with the row, for the same reason
      // an appointment's are: a staff record whose effective set arrives later
      // is a record whose authority depends on when you looked. This is the
      // SECOND writer of `gym_staff` in the product and the one that is easy to
      // forget — the ticks card's own tests caught it doing exactly that.
      await tx`
        INSERT INTO gym_staff (gym_id, user_id, role, privileges)
        VALUES (${org.id}, ${input.ownerUserId}, 'owner', ${[...input.ownerPrivileges]})`;

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
export async function listOrgsForUser(sql: SqlOrTx, userId: string): Promise<MyOrgRow[]> {
  const rows = await sql<
    (RawOrg & {
      staff_role: string | null;
      privileges: string[] | null;
      is_member: boolean;
      joined_at: Date | null;
    })[]
  >`
    SELECT g.id, g.slug, g.name, g.city, g.country, g.org_type, g.timezone,
           g.locale, g.currency_display, g.status,
           s.role AS staff_role,
           s.privileges,
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
    privileges: r.privileges,
    isMember: r.is_member,
    joinedAt: r.joined_at,
  }));
}

export interface FormerOrgRow {
  org: OrgRow;
  removedAt: Date;
}

/** Gyms the caller was REMOVED from, recently enough to still be worth saying.
 *
 *  **Kd's ruling of 2026-08-20**: after a removal the app said nothing at all
 *  about that gym. The T3 round-1 fix stopped it saying something FALSE
 *  ("{gym} didn't confirm your request"); this is what makes it say something
 *  TRUE. A person who was let into a gym and then taken out is entitled to know
 *  that is what happened.
 *
 *  **Deliberately NOT folded into `listOrgsForUser`.** That reader means "gyms
 *  I have a live relationship with" and the CONSOLE reads the same response; a
 *  removed gym appearing in `orgs` would put a gym into a console list whose
 *  every subsequent read the server answers 404 to. Separate list, same
 *  response, one fact in one place.
 *
 *  **THIS CANNOT TELL A GYM'S REMOVAL FROM A PERSON'S OWN DELETION, and the
 *  earlier version of this comment claimed it could. T3 round 2 L2-2.** The
 *  DPDP Day-0 cascade closes memberships when somebody deletes their OWN
 *  account, and the claim that such a person can never be reading this — "by
 *  definition a live account" — is FALSE: `restoreUser` reactivates the account
 *  and DELIBERATELY leaves memberships closed (DECISIONS 2026-07-11, P2.2 T3
 *  finding 4 — auto-reopen could exceed seat caps). Both windows are 14 days
 *  (`DPDP_RETENTION_DAYS` and `DECIDED_VISIBLE_DAYS`), so a restored account
 *  reads this list carrying a `removed_at` it caused itself.
 *
 *  **Nothing user-visible is false today** — "You're no longer a member of X"
 *  is true however the membership ended — which is why this is a comment fix
 *  and not a code one. The sharp edge is real but narrow: an owner who deletes
 *  and restores their account is told they are no longer a member of their own
 *  gym while the console still lists them as its owner. **The durable fix is a
 *  reason column on `gym_members`** so the two endings can be told apart and
 *  worded differently; it is not built and is NOT invented here (R0.2), and it
 *  belongs with whatever card revisits restore at P3.10. */
export async function listFormerOrgsForUser(
  sql: SqlOrTx,
  userId: string,
): Promise<FormerOrgRow[]> {
  // DISTINCT ON IS LOAD-BEARING (T3 round 2 L2-3). `gym_members_live_uq` is a
  // PARTIAL unique index — `WHERE removed_at IS NULL` — so one person may hold
  // many CLOSED rows for one gym: join, removed, join again, removed again is
  // two. Without this the same gym arrives twice and `listOrgsForUser`'s own
  // promise one function above ("one row per org … so a caller can never render
  // the same gym twice") would be false of its neighbour in the same response.
  // The client happens to dedupe by org id, which is what kept it invisible —
  // a contract that holds only because of what the one caller does today.
  //
  // The inner ORDER BY is what DISTINCT ON picks with: gym first (required),
  // then the MOST RECENT removal, so the surviving row is the latest ending.
  const rows = await sql<(RawOrg & { removed_at: Date })[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (m.gym_id)
             g.id, g.slug, g.name, g.city, g.country, g.org_type, g.timezone,
             g.locale, g.currency_display, g.status, m.removed_at
      FROM gym_members m
      JOIN gyms g ON g.id = m.gym_id
      WHERE m.user_id = ${userId}
        AND m.removed_at IS NOT NULL
        AND m.removed_at > now() - (${DECIDED_VISIBLE_DAYS} * INTERVAL '1 day')
        -- Somebody who was removed and has since REJOINED is simply a member
        -- again; saying both would be one gym with two contradictory rows.
        AND NOT EXISTS (
          SELECT 1 FROM gym_members live
          WHERE live.gym_id = m.gym_id AND live.user_id = m.user_id
            AND live.removed_at IS NULL
        )
      ORDER BY m.gym_id, m.removed_at DESC
    ) latest
    ORDER BY latest.removed_at DESC, latest.id DESC
    LIMIT ${MY_ORGS_LIMIT}`;
  return rows.map((r) => ({ org: toOrgRow(r), removedAt: r.removed_at }));
}

export async function getOrgById(sql: SqlOrTx, gymId: string): Promise<OrgRow | null> {
  const rows = await sql<RawOrg[]>`
    SELECT id, slug, name, city, country, org_type, timezone, locale,
           currency_display, status
    FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : toOrgRow(row);
}

/** The gym's own editable details. **Only the keys that are PRESENT are
 *  written** — an absent key leaves that column alone, while `city: null`
 *  genuinely clears the city. A patch object cannot express that distinction
 *  with `undefined` alone once it crosses into SQL, so the writer below checks
 *  `in` rather than `!== undefined`. */
export interface OrgPatch {
  name?: string;
  city?: string | null;
  country?: string;
  /** Never accepted from a caller — the service derives it from `country` and
   *  always sets the two together, so this key is present exactly when
   *  `country` is (R3.1, :10010). */
  currencyDisplay?: string;
  timezone?: string;
}

export type UpdateOrgOutcome =
  | { kind: "updated"; org: OrgRow; changed: readonly string[] }
  | { kind: "unchanged"; org: OrgRow }
  | { kind: "not_found" };

/** EDIT THE GYM'S OWN ROW (Kd's `org.manage`, 2026-08-26).
 *
 *  **The lock is taken for the AUDIT ROW, not for the write.** Two concurrent
 *  edits of different columns are last-write-wins and need no lock; what needs
 *  one is "did anything actually change", which is a read followed by a write
 *  and would otherwise let two owners saving at once produce an audit trail
 *  where one of them appears to have changed nothing. :14174 L-4's rule applied
 *  in the direction it points — a lock is warranted by the CONSEQUENCE — and the
 *  consequence here is the record of who changed a gym's billing country. It is
 *  `lockOrgRow`, the same instrument and the same order (org row → child rows)
 *  every other mutation in this module takes, so it adds no new deadlock edge.
 *
 *  **A NO-OP WRITES NOTHING AND SAYS SO.** Saving the same name twice must not
 *  leave two rows in `audit_log` claiming two changes; a log that records
 *  non-events is one nobody can read a real event out of.
 *
 *  `changed` names the columns that genuinely moved, so the service can put the
 *  before/after of exactly those into the audit meta rather than a whole-row
 *  snapshot nobody can diff. */
export async function updateOrg(
  sql: Sql,
  input: { gymId: string; patch: OrgPatch; actorUserId: string },
): Promise<UpdateOrgOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const before = await getOrgById(tx, input.gymId);
    if (before === null) return { kind: "not_found" };

    // Compared against the CURRENT row rather than trusted from the request:
    // a screen sending back every field it drew is the normal case, so without
    // this every save of an untouched form would write an audit row.
    const changed: string[] = [];
    if ("name" in input.patch && input.patch.name !== before.name) changed.push("name");
    if ("city" in input.patch && (input.patch.city ?? null) !== before.city) changed.push("city");
    if ("country" in input.patch && input.patch.country !== before.country) {
      changed.push("country");
      // The currency moves WITH the country and never on its own. It is listed
      // separately because it is what a gym is BILLED in — a reader of the audit
      // log asking "when did this gym's money change" must not have to know that
      // a country implies one.
      if (input.patch.currencyDisplay !== before.currencyDisplay) changed.push("currencyDisplay");
    }
    if ("timezone" in input.patch && input.patch.timezone !== before.timezone) {
      changed.push("timezone");
    }
    if (changed.length === 0) return { kind: "unchanged", org: before };

    // Written out column by column rather than assembled from a loop over the
    // patch's keys: a dynamic identifier built from caller-controlled data is
    // exactly what R3.8 forbids, and `coalesce` cannot express "clear the city"
    // because null is a legitimate destination. Each `${}` is a VALUE.
    const rows = await tx<RawOrg[]>`
      UPDATE gyms SET
        name = ${"name" in input.patch ? (input.patch.name ?? before.name) : before.name},
        city = ${"city" in input.patch ? (input.patch.city ?? null) : before.city},
        country = ${"country" in input.patch ? (input.patch.country ?? before.country) : before.country},
        currency_display = ${
          "country" in input.patch
            ? (input.patch.currencyDisplay ?? before.currencyDisplay)
            : before.currencyDisplay
        },
        timezone = ${"timezone" in input.patch ? (input.patch.timezone ?? before.timezone) : before.timezone}
      WHERE id = ${input.gymId}
      RETURNING id, slug, name, city, country, org_type, timezone, locale,
                currency_display, status`;
    const raw = rows[0];
    if (raw === undefined) throw new Error("UPDATE gyms changed no row under the org lock");

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.updated",
      targetType: "gyms",
      targetId: input.gymId,
      // WHICH FIELDS MOVED, and their before values. The after state is the row
      // itself, so recording it twice would only create somewhere for the two to
      // disagree. `null` is allowed in this meta for exactly the case it means
      // here — a city that was not set, or a country nobody had ever recorded.
      meta: {
        changed,
        name: changed.includes("name") ? before.name : null,
        city: changed.includes("city") ? before.city : null,
        country: changed.includes("country") ? before.country : null,
        currencyDisplay: changed.includes("currencyDisplay") ? before.currencyDisplay : null,
        timezone: changed.includes("timezone") ? before.timezone : null,
      },
    });

    return { kind: "updated", org: toOrgRow(raw), changed };
  });
}

/** A staff row's authority: the role it was appointed under, and the effective
 *  ticks stored on it. `privileges` is null only for a row written by code that
 *  predates the column (see the schema's own note). */
export interface StaffAuthority {
  role: OrgRole;
  privileges: string[] | null;
}

/** WHAT THE CALLER MAY DO IN ONE ORG — their role and the ticks stored beside
 *  it. Null means "not staff here", which the service turns into a 404 — a
 *  stranger must not learn the org exists.
 *
 *  **It reads the ticks in the SAME query as the role, deliberately.** Two
 *  reads would leave a window where the role is this person's and the ticks are
 *  from a moment before an owner changed them, and the seam would decide against
 *  a set that never existed. `privileges` null is the deploy window R4.4's
 *  expand-then-contract creates; `privilegesFor` in the service is the one place
 *  that decides what null means, and it means "the role's defaults".
 *
 *  **Renamed from `getStaffRole` in the same card that gave it the ticks** — it
 *  no longer answers "what role", it answers "what authority", and a name that
 *  says role invites a caller to compare it to one (the exact thing :11429's
 *  seam exists to stop).
 *
 *  **A STAFF ROW ALONE IS NOT AUTHORITY — it must belong to a live account that
 *  is still IN the gym.** T3 round 1 (2026-08-22) found two ways to hold a
 *  `gym_staff` row without being a member, and both hand somebody the whole
 *  roster of a gym they left:
 *    · appointing raced against removing them from the member list (fixed with
 *      a lock, below — this is the second line of defence, not the first);
 *    · **delete your account and restore it** — the DPDP Day-0 cascade closes
 *      `gym_members` and leaves `gym_staff` standing, and restore deliberately
 *      does NOT reopen memberships (2026-07-11 P2.2 T3 finding 4).
 *
 *  **THE RULE IS "NOT AN EX-MEMBER", NOT "MUST BE A MEMBER", AND THE DIFFERENCE
 *  IS THE WHOLE FINDING.** The reviewer's proposed one-liner was "require a live
 *  membership here", and it is WRONG — measured, not argued: it turned FIVE
 *  existing tests red, and reading them is what showed why. **Staff who are not
 *  members is the SPEC'S OWN MODEL** — §4.7 invites staff BY EMAIL, so an
 *  invited manager need never join — and this card only appoints from the roster
 *  because `EmailSender` cannot yet deliver an invite. Baking "staff ⇒ member"
 *  into AUTHORITY would have shipped a rule that breaks the day that deferral
 *  closes. :13552's standing lesson, earned again: a reviewer's fix is a claim
 *  and takes the same evidence as the code it replaces.
 *
 *  So the denial is precisely the ghost: **they HELD a membership here and it is
 *  closed.** Never-a-member is allowed (the invite flow, and today's fixtures);
 *  currently-a-member is allowed; left-the-gym is not.
 *
 *  **The owner is exempt on top of that, and it is not a convenience.**
 *  `gyms.owner_included_as_member` is READ by `createOrgAttempt` and the column
 *  is the authority, so a gym whose owner opted out of membership is a designed
 *  state with no route to reach it yet — and their §4.0-step-6 seat, once
 *  closed, would otherwise read as exactly the ghost this guard denies.
 *
 *  `users.status` is checked as well, so the window BEFORE a restore is shut
 *  too, not only the state after it. */
export async function getStaffAuthority(
  sql: Sql,
  gymId: string,
  userId: string,
): Promise<StaffAuthority | null> {
  const rows = await sql<{ role: string; privileges: string[] | null }[]>`
    SELECT s.role, s.privileges
    FROM gym_staff s
    JOIN users u ON u.id = s.user_id
    JOIN gyms g ON g.id = s.gym_id
    WHERE s.gym_id = ${gymId}
      AND s.user_id = ${userId}
      AND u.status = 'active'
      AND (
        g.owner_user_id = s.user_id
        OR EXISTS (
          SELECT 1 FROM gym_members m
          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL
        )
        OR NOT EXISTS (
          SELECT 1 FROM gym_members m
          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id
        )
      )`;
  const row = rows[0];
  return row === undefined ? null : { role: toOrgRole(row.role), privileges: row.privileges };
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
      SELECT id, slug, name, city, country, org_type, timezone, locale,
           currency_display, status
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
        joined: number;
        max_uses: number | null;
      }[]
    >`
      SELECT c.id, c.label, c.paused, c.expires_at, c.max_uses,
             (SELECT count(*)::int FROM gym_members m
               WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)
               AS joined
      FROM gym_codes c WHERE c.id = ${found.id} AND c.gym_id = ${found.gym_id}`;
    const code = codeRows[0];
    if (code === undefined) return { kind: "no_such_code" };
    if (code.paused) return { kind: "code_unusable", reason: "paused" };
    if (code.expires_at !== null && code.expires_at.getTime() <= Date.now()) {
      return { kind: "code_unusable", reason: "expired" };
    }
    // MEASURED AGAINST PEOPLE WHO ARE STILL IN, not against claims ever made
    // (Kd's smoke, 2026-08-21). A gym that limits a code to 20 means twenty
    // people at once; under the old `uses` counter a member who left took their
    // place with them and the code died one short, which no screen explained.
    // `toCodeRow`'s comment carries the definition and the list of sites.
    if (code.max_uses !== null && code.joined >= code.max_uses) {
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
      RETURNING id, status, applied_at, expires_at, decided_at, member_nudged_at`;

    const newRow = inserted[0];
    if (newRow === undefined) {
      const existingRows = await tx<RawApplication[]>`
        SELECT id, status, applied_at, expires_at, decided_at, member_nudged_at
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
      // KD RULING 2026-08-22, "yes staff seats free" — ENFORCED HERE, which is
      // where seats are counted, rather than by flagging staff `complimentary`.
      //
      // **THE FLAG WAS THE FIRST IMPLEMENTATION AND IT WAS WRONG (T3 round 1,
      // C/H-1).** `complimentary` does not mean "this seat is unpaid", it means
      // "this person did not JOIN" — the owner's §4.0-step-6 seat — and THREE
      // readers act on that meaning: the console's `joinedCount`, which printed
      // "Nobody has joined yet" under a gym with two members; the `max_uses`
      // gate at the join door, which quietly gave a code limited to one person
      // another place; and `orgCodeSchema.joined`. Kd's ruling is about MONEY,
      // so it belongs in the money count and nowhere else.
      //
      // **A DEPARTURE FROM §4.2's WORDING, recorded rather than slipped past
      // (R0.1):** the spec's seat check is the prose "count live,
      // non-complimentary members", which this narrows with "and not staff".
      // The RULING is Kd's and predates the fix; what changed is the mechanism,
      // because the literal reading was satisfied only by corrupting the flag.
      //
      // **THESE TWO CONDITIONS ARE ALSO WRITTEN OUT IN `listMembers`, which is
      // what the roster's "Complimentary" badge now reads (:14953).** A shared
      // `sql` fragment is R3.8's forbidden shape, so they are duplicated on
      // purpose and anchored by a test that drives BOTH — the cap's refusal and
      // the roster's answer — on one fixture. Editing either without the other
      // puts the screen and the door back into disagreement about who costs
      // money, which is the defect Kd found.
      const countRows = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_members m
        WHERE m.gym_id = ${input.org.id} AND m.removed_at IS NULL
          AND m.complimentary = false
          AND NOT EXISTS (
            SELECT 1 FROM gym_staff s
            WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)`;
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
      SELECT id, status, applied_at, expires_at, decided_at, member_nudged_at,
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
      SELECT id, slug, name, city, country, org_type, timezone, locale,
           currency_display, status
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
      SELECT id, status, applied_at, expires_at, decided_at, member_nudged_at, user_id
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
      gym_notified_at: Date | null;
      member_nudged_at: Date | null;
    }[]
  >`
    SELECT a.id, a.user_id, u.display_name, a.applied_at, a.expires_at,
           a.gym_notified_at, a.member_nudged_at,
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
      gymNotifiedAt: r.gym_notified_at,
      nudgedAt: r.member_nudged_at,
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
 *  readers claiming the same thing is two readers that can disagree.
 *
 *  **THE `NOT EXISTS` ARM IS T3 ROUND 1's C/H-1 AND IT IS LOAD-BEARING.** That
 *  deliberate exclusion had a cost nobody had priced: a person who was refused,
 *  asked again, was CONFIRMED, and was then REMOVED had exactly one surviving
 *  row — the refusal — because the confirmation is invisible here by design and
 *  `/v1/orgs/mine` drops the gym the moment `removed_at` is set. Their
 *  dashboard read "{gym} didn't confirm your request", with a Try again link,
 *  which is the app stating something FALSE (:5807) about a decision the gym
 *  had already made in their favour. Found live on the smoke's own account.
 *
 *  **The fix belongs HERE and could not live in the client**: the client cannot
 *  see the confirmation that supersedes the refusal, so it has nothing to rank
 *  it against — `gymMembershipView.js`'s member-beats-waiting-beats-refused is
 *  correct and was simply never handed the winning row.
 *
 *  It compares TIMESTAMPS rather than asking "was this person ever confirmed
 *  here", because the mirror case is real and must still show: confirmed →
 *  removed → asks again → refused leaves a refusal that is the NEWEST fact, and
 *  hiding that one would leave a genuinely turned-away person with a blank
 *  screen. Both directions carry a test. */
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
    member_nudged_at: Date | null;
    org_id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    org_type: string;
    timezone: string;
    locale: string;
    currency_display: string;
    org_status: string;
  }
  const rows = await sql<RawMyApplication[]>`
    SELECT a.id AS app_id, a.status AS app_status, a.applied_at, a.expires_at,
           a.decided_at, a.member_nudged_at,
           g.id AS org_id, g.slug, g.name, g.city, g.country, g.org_type,
           g.timezone, g.locale, g.currency_display, g.status AS org_status
    FROM gym_join_applications a
    JOIN gyms g ON g.id = a.gym_id
    WHERE a.user_id = ${userId}
      AND (
        a.status = 'pending'
        OR (a.status IN ('rejected','expired')
            AND coalesce(a.decided_at, a.expires_at)
                > now() - (${DECIDED_VISIBLE_DAYS} * INTERVAL '1 day')
            AND NOT EXISTS (
              SELECT 1 FROM gym_join_applications newer
              WHERE newer.user_id = a.user_id
                AND newer.gym_id = a.gym_id
                AND newer.status = 'confirmed'
                AND (newer.applied_at, newer.id) > (a.applied_at, a.id)
            ))
      )
    ORDER BY a.applied_at DESC, a.id DESC
    LIMIT ${MY_APPLICATIONS_LIMIT}`;
  return rows.map((r) => ({
    org: toOrgRow({
      id: r.org_id,
      slug: r.slug,
      name: r.name,
      city: r.city,
      country: r.country,
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
      member_nudged_at: r.member_nudged_at,
    }),
  }));
}

/** :11385 mechanic 3, ratified by Kd 2026-08-20: the waiting member may remind
 *  the gym at most ONCE A DAY. */
export const NUDGE_INTERVAL_HOURS = 24;

export type NudgeOutcome =
  | { kind: "sent"; nudgedAt: Date; nextNudgeAt: Date }
  | { kind: "too_soon"; nudgedAt: Date; nextNudgeAt: Date }
  | { kind: "not_found" }
  | { kind: "not_pending"; status: OrgApplicationStatus };

/** THE WAITING MEMBER'S NUDGE — :11385's third mechanic, and the only one of
 *  the three the person waiting can set off themselves.
 *
 *  **THE ONCE-A-DAY LIMIT IS IN THE DATABASE, NOT IN REDIS, and that is the
 *  decision worth not re-deriving.** Every other limit in this module is a
 *  request-rate floor living in a counter that a restart or an eviction may
 *  drop — which is correct for "how hard may you hammer this endpoint" and
 *  wrong for "how often may this happen at all". A dropped counter here would
 *  hand somebody a second reminder the ruling says they do not get, and the
 *  front desk would see a person asking twice in an hour. The column IS the
 *  rule, `now()` is the database's own clock, and the comparison happens inside
 *  the same transaction that writes it, so two taps racing cannot both win.
 *
 *  **Tenancy is the WHERE (R3.2) and carries NO gym id**, because the caller is
 *  addressing their OWN application: `id` AND `user_id`. Holding somebody
 *  else's application uuid nudges nobody and — like every other 404 in this
 *  module — is indistinguishable from an id that never existed.
 *
 *  **Nothing is DELIVERED anywhere and the name is honest about it.** There is
 *  no email in this product and no push on web; what this writes is a mark the
 *  console renders beside that person's row. The copy on both screens says
 *  exactly that and promises no message. */
export async function nudgeApplication(
  sql: Sql,
  input: { applicationId: string; userId: string },
): Promise<NudgeOutcome> {
  return await sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; status: string; gym_id: string; member_nudged_at: Date | null }[]
    >`
      SELECT id, status, gym_id, member_nudged_at
      FROM gym_join_applications
      WHERE id = ${input.applicationId} AND user_id = ${input.userId}
      FOR UPDATE`;
    const app = rows[0];
    if (app === undefined) return { kind: "not_found" };

    const status = toApplicationStatus(app.status);
    // Only a WAITING person has anything to remind anybody about. A confirmed
    // application would nudge a gym about somebody already inside it, and a
    // rejected or expired one would ask them to reconsider a decision this
    // endpoint has no business reopening — re-applying is the door for that,
    // and :11385 made it free precisely so this one does not have to be.
    if (status !== "pending") return { kind: "not_pending", status };

    // One statement decides AND writes. Splitting it into "is it due?" then
    // "write it" is the shape that lets two taps a millisecond apart both read
    // yesterday's timestamp and both write today's; the row lock above already
    // serialises them, and this keeps the rule true even if the lock is ever
    // relaxed.
    const updated = await tx<{ member_nudged_at: Date; next_nudge_at: Date }[]>`
      UPDATE gym_join_applications
      SET member_nudged_at = now()
      WHERE id = ${app.id}
        AND (member_nudged_at IS NULL
             OR member_nudged_at <= now() - (${NUDGE_INTERVAL_HOURS} * INTERVAL '1 hour'))
      RETURNING member_nudged_at,
                member_nudged_at + (${NUDGE_INTERVAL_HOURS} * INTERVAL '1 hour') AS next_nudge_at`;

    const sent = updated[0];
    if (sent === undefined) {
      // Not an error: a person tapped a button twice, or came back the same
      // afternoon. The screen needs the two times so it can say WHEN they can
      // ask again rather than computing a date of its own.
      const held = app.member_nudged_at;
      if (held === null) {
        // The UPDATE's own WHERE admits a null, so a null here means the row
        // changed under a lock we hold — impossible, and loud rather than a
        // fabricated time (the `already_pending` branch's precedent).
        throw new Error("nudge refused a never-nudged application");
      }
      return {
        kind: "too_soon",
        nudgedAt: held,
        nextNudgeAt: new Date(held.getTime() + NUDGE_INTERVAL_HOURS * 60 * 60 * 1000),
      };
    }

    // Part 3 §3.3: every mutating call writes `audit_log`. This is the row that
    // answers "we never heard from them" if a gym and a member ever disagree
    // about who was waiting on whom.
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: app.gym_id,
      action: "org.join_nudged",
      targetType: "gym_join_application",
      targetId: app.id,
      meta: {},
    });

    return { kind: "sent", nudgedAt: sent.member_nudged_at, nextNudgeAt: sent.next_nudge_at };
  });
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
    // THE ORG LOCK, added by T3 round 1's C/H-2 (2026-08-22). This function
    // reads `gym_staff` and `addStaff` reads live membership; without a shared
    // lock they interleave into a staff row over a closed membership, i.e.
    // somebody holding `members.read` on a gym they are no longer in. Same
    // lock, same order, as `addStaff`, `removeStaff` and `claimSeat`.
    await lockOrgRow(tx, input.gymId);

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
 *  repeats rows silently.
 *
 *  **`takes_seat` IS `claimSeat`'s COUNT RULE, WRITTEN OUT A SECOND TIME — and
 *  the duplication is deliberate (Kd's finding at the staff re-smoke,
 *  :14953).** The screen drew its badge off `gym_members.complimentary`, which
 *  is deliberately NOT written for staff, so a trainer sat on the roster
 *  looking exactly like somebody occupying a paid place: the door and the
 *  screen disagreed about who costs money.
 *
 *  **The fix is NOT to write `complimentary` for staff — that is precisely the
 *  defect :14401 C/H-1 removed.** That column means "did not JOIN", not "unpaid
 *  seat", and three readers act on that meaning (`joinedCount`, the join door's
 *  `max_uses` gate, `orgCodeSchema.joined`), which is how an appointment once
 *  printed "Nobody has joined yet" over a two-member gym. Kd's ruling is about
 *  MONEY, so the answer is derived where money is counted and nowhere else.
 *
 *  **A shared `sql` fragment is R3.8's forbidden shape**, so the two conditions
 *  are spelled out in both places, exactly as `listStaff` and `getStaffRole`
 *  spell out their eligibility test (:14493 Low-2). What stops them drifting is
 *  a test that drives BOTH on one fixture — the roster's answer and the cap's
 *  refusal — per :14013's six-site precedent. Change one, change the other. */
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
      takes_seat: boolean;
    }[]
  >`
    SELECT m.id, m.user_id, u.display_name, m.joined_at,
           c.label AS group_label, m.complimentary,
           (m.complimentary = false
            AND NOT EXISTS (
              SELECT 1 FROM gym_staff s
              WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)) AS takes_seat
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
      takesSeat: r.takes_seat,
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
  const rows = await sql<RawCode[]>`
    SELECT c.code, c.label, c.paused, c.expires_at, c.max_uses,
           (SELECT count(*)::int FROM gym_members m
             WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)
             AS joined
    FROM gym_codes c
    WHERE c.gym_id = ${gymId} AND c.removed_at IS NULL
    ORDER BY c.created_at ASC, c.code ASC
    LIMIT ${ORG_CODES_LIMIT}`;
  return rows.map(toCodeRow);
}

/** THE SHAPE EVERY `gym_codes` READ RETURNS, mapped in ONE place.
 *
 *  The column LIST is written out in each query rather than interpolated from a
 *  shared string: `sql.unsafe`/`sql.raw` with any interpolated value is
 *  forbidden (R3.8, playbook trap #4) and a constant that is safe today is a
 *  constant somebody parameterises tomorrow. What is shared is this MAPPER, so
 *  a query that stops selecting `paused` fails to compile here rather than
 *  quietly handing a console a code the join path will refuse. */
interface RawCode {
  code: string;
  label: string;
  paused: boolean;
  expires_at: Date | null;
  max_uses: number | null;
  joined: number;
}

/** THE NUMBER, DEFINED ONCE IN PROSE BECAUSE SQL CANNOT SHARE IT SAFELY.
 *
 *  `joined` is **live memberships this code created, complimentary excluded** —
 *  people who are in the gym RIGHT NOW and came through this code. Not seat
 *  claims (that is the `uses` column, displayed nowhere) and not the owner, whose
 *  §4.0-step-6 seat carries the first code's id and who never "joined" anything.
 *
 *  It is written out as the same correlated subquery at every site rather than
 *  built from a shared string, for the reason the column lists are (R3.8): a
 *  fragment that is safe today is one somebody parameterises tomorrow. **The
 *  sites are: `listCodes`, `applyByCode`, `updateCode`, `rotateCode`'s retired
 *  row — plus `createCode` and `rotateCode`'s minted row, which select the
 *  literal `0` because a code minted in this transaction cannot have a member.**
 *  A change to the definition is a change to all six, and `orgs.routes.test.ts`
 *  holds a test that the door and the screen agree on it — drift between the two
 *  is the defect this shape exists to prevent, not a style question. */
function toCodeRow(raw: RawCode): CodeRow {
  return {
    code: raw.code,
    label: raw.label,
    paused: raw.paused,
    expiresAt: raw.expires_at,
    maxUses: raw.max_uses,
    joined: raw.joined,
  };
}

/** HOW MANY CODES ONE GYM MAY HOLD, and the number is DERIVED rather than
 *  chosen: it is `ORG_CODES_LIMIT`, the ceiling `listCodes` already reads to.
 *
 *  Without a cap, `listCodes`' `LIMIT 100 ... ORDER BY created_at ASC` returns
 *  the OLDEST hundred — so the 101st code a gym minted would be invisible to
 *  the console that minted it, while the join path happily honoured it. Capping
 *  creation at the same figure makes the list provably whole instead of
 *  provably truncated, which is worth more than any larger number would be.
 *
 *  **REMOVED CODES DO NOT COUNT** (T3 L-5 — this paragraph said the opposite
 *  until removal shipped in the same diff that made it false). Switched-off ones
 *  still do: they stay on the list, a gym should be able to see the code it
 *  turned off last month, and every visible code is one `listCodes` must be able
 *  to return. What a gym does when it reaches the cap is take a finished code
 *  off the list — which is what the refusal now tells them to do, and, unlike
 *  the "delete one" it used to say, is a button that exists. */
export const ORG_CODES_MAX = ORG_CODES_LIMIT;

/** Serialise everything that follows against the SAME gym.
 *
 *  §4.2's instrument, on §4.2's row: the seat claim locks `gyms` and not a
 *  COUNT, because locking a count serialises nothing — a second transaction
 *  reads the same pre-insert number and passes the same check. A cap enforced by
 *  "count, then insert, in one transaction" has exactly that hole under READ
 *  COMMITTED, which is what this database runs and what every statement here has
 *  always assumed (T3 L-3).
 *
 *  **CALL IT FIRST, BEFORE ANY `gym_codes` ROW IS LOCKED.** Lock order in this
 *  module is org row → child rows, always, and it is stated in one place —
 *  `claimSeat` — for the same reason: an ordering decided per-function is an
 *  ordering that eventually reverses somewhere and deadlocks. */
async function lockOrgRow(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`SELECT 1 FROM gyms WHERE id = ${gymId} FOR UPDATE`;
}

export type CreateCodeOutcome =
  | { kind: "created"; code: CodeRow }
  | { kind: "too_many"; cap: number };

/** Mint one more code for a gym.
 *
 *  **`code` is generated by the SERVICE, not here**, for the same reason
 *  `createOrgAttempt` takes one: the collision retry needs fresh randomness and
 *  the repo does not own randomness. A `gym_codes_code_unique` violation THROWS
 *  `OrgNameTakenError('code')` and the service retries — the same typed error
 *  and the same division of labour `createOrgAttempt` already uses, rather than
 *  a second mechanism for one situation. Codes are globally unique (that
 *  constraint is in `0001_init`, not merely in Drizzle's mind), which is what
 *  lets `applyByCode` look one up without being told the gym.
 *
 *  **THE CAP IS SERIALISED ON THE GYM ROW, and one transaction was NOT enough**
 *  (T3 L-3 — this comment claimed the transaction alone did it, and under
 *  READ COMMITTED, which is what this database runs, it does not: two staff
 *  members creating at once both read 99 and both insert). The lock is §4.2's
 *  own instrument, taken on the same row and in the same order the seat claim
 *  takes it — org row first, `gym_codes` after — so the two cannot deadlock
 *  against each other. Nothing in this module locks `gym_codes` and then reaches
 *  for `gyms`, which is the ordering that would.
 *
 *  Cheap by construction: it serialises creating a code for ONE gym, an action a
 *  gym takes a handful of times a year. */
export async function createCode(
  sql: Sql,
  input: {
    gymId: string;
    code: string;
    label: string;
    expiresAt: Date | null;
    maxUses: number | null;
    actorUserId: string;
  },
): Promise<CreateCodeOutcome> {
  try {
    return await sql.begin(async (tx) => {
      await lockOrgRow(tx, input.gymId);
      const counted = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_codes
        WHERE gym_id = ${input.gymId} AND removed_at IS NULL`;
      if ((counted[0]?.n ?? 0) >= ORG_CODES_MAX) {
        return { kind: "too_many", cap: ORG_CODES_MAX };
      }

      const rows = await tx<RawCode[]>`
        INSERT INTO gym_codes (gym_id, code, label, expires_at, max_uses)
        VALUES (${input.gymId}, ${input.code}, ${input.label},
                ${input.expiresAt}, ${input.maxUses})
        RETURNING code, label, paused, expires_at, max_uses, 0::int AS joined`;
      const raw = rows[0];
      if (raw === undefined) throw new Error("INSERT INTO gym_codes returned no row");

      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.code_created",
        targetType: "gym_code",
        targetId: raw.code,
        // Strings by construction (`insertAudit`'s own rule). "none" rather than
        // an absent key: a human reading this row weeks later should see that
        // the question was asked and answered, not wonder whether the writer
        // forgot the field.
        meta: {
          expiresAt: raw.expires_at === null ? "none" : raw.expires_at.toISOString(),
          maxUses: raw.max_uses === null ? "none" : String(raw.max_uses),
        },
      });

      return { kind: "created", code: toCodeRow(raw) };
    });
  } catch (err) {
    // Only ONE unique constraint is reachable from these transactions
    // (`gym_codes_code_unique`), so unlike `createOrgAttempt` there is nothing
    // to disambiguate — but the error type is shared so the service's retry is
    // one mechanism rather than two.
    if (isUniqueViolation(err)) throw new OrgNameTakenError("code");
    throw err;
  }
}

export type UpdateCodeOutcome =
  | { kind: "updated"; code: CodeRow }
  | { kind: "not_found" }
  | { kind: "max_uses_below_uses"; joined: number };

export interface CodePatch {
  paused?: boolean;
  expiresAt?: Date | null;
  maxUses?: number | null;
}

/** Pause, wake, or move a restriction on one existing code.
 *
 *  **TENANCY IS THE PAIR (gym, code), never the code alone** (R3.2). A code is
 *  globally unique, so `WHERE code = $1` would have worked and would have let
 *  one gym's manager pause a DIFFERENT gym's poster by typing six characters —
 *  the textbook IDOR, hiding behind a column that happens to be unique.
 *
 *  `SELECT ... FOR UPDATE OF c` then `UPDATE` in one transaction, rather than one
 *  clever statement, because the new `max_uses` has to be compared against a
 *  count read in the same breath, and because two front-desk staff moving the
 *  limit at once must not each read a row the other has already changed.
 *
 *  **WHAT THE LOCK DOES NOT COVER, stated because the comment here used to imply
 *  otherwise (T3 L-4): `joined` is counted from `gym_members`, and locking this
 *  `gym_codes` row does not hold that count still.** A confirm landing between
 *  the count and the UPDATE can leave `max_uses` one below the people actually
 *  in. **Left as it is, deliberately.** The consequence is a code that reads
 *  "Fully used" a little early and revives the moment anybody leaves — no seat is
 *  lost, no member is affected, nothing is written that a later read disagrees
 *  with. The alternative is taking the gym's row lock on every limit edit, which
 *  serialises an owner's typing against every confirm in the gym to prevent a
 *  self-healing display. `createCode` takes that lock because ITS race admits a
 *  code the console can never list; this one does not, because it does not.
 *
 *  **A field the caller did not send is left ALONE**, which is what makes this a
 *  PATCH rather than a PUT: a screen that only knows about `paused` must not
 *  silently clear an expiry it never displayed. */
export async function updateCode(
  sql: Sql,
  input: { gymId: string; code: string; patch: CodePatch; actorUserId: string },
): Promise<UpdateCodeOutcome> {
  return await sql.begin(async (tx) => {
    const existing = await tx<(RawCode & { removed_at: Date | null })[]>`
      SELECT c.code, c.label, c.paused, c.expires_at, c.max_uses, c.removed_at,
             (SELECT count(*)::int FROM gym_members m
               WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)
               AS joined
      FROM gym_codes c
      WHERE c.gym_id = ${input.gymId} AND c.code = ${input.code}
      FOR UPDATE OF c`;
    const before = existing[0];
    if (before === undefined) return { kind: "not_found" };
    // A code the gym has TIDIED AWAY is not on any screen, so nothing legitimate
    // can be asking to change it — and answering 404 keeps "removed" and "never
    // existed" indistinguishable, which is the same standing 404 this module
    // gives another gym's code.
    if (before.removed_at !== null) return { kind: "not_found" };

    const nextPaused = input.patch.paused ?? before.paused;
    const nextExpiresAt =
      input.patch.expiresAt === undefined ? before.expires_at : input.patch.expiresAt;
    const nextMaxUses = input.patch.maxUses === undefined ? before.max_uses : input.patch.maxUses;

    // A limit BELOW the number of people who already joined would kill the code
    // on the spot, and the owner who typed it would see "Fully used" over a
    // change they read as "let 10 more people in". Pause already means "off
    // now", so refusing here takes nothing away and removes the surprise. The
    // live count travels back so the refusal can name it.
    if (nextMaxUses !== null && nextMaxUses < before.joined) {
      return { kind: "max_uses_below_uses", joined: before.joined };
    }

    const rows = await tx<RawCode[]>`
      UPDATE gym_codes AS c
      SET paused = ${nextPaused}, expires_at = ${nextExpiresAt}, max_uses = ${nextMaxUses}
      WHERE c.gym_id = ${input.gymId} AND c.code = ${input.code}
      RETURNING c.code, c.label, c.paused, c.expires_at, c.max_uses,
                (SELECT count(*)::int FROM gym_members m
                  WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)
                  AS joined`;
    const raw = rows[0];
    if (raw === undefined) throw new Error("UPDATE gym_codes returned no row under FOR UPDATE");

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.code_updated",
      targetType: "gym_code",
      targetId: raw.code,
      // BEFORE and AFTER, not just after. "who turned the poster off" is the
      // question this row exists to answer, and an after-only row cannot tell a
      // pause from a no-op re-save.
      meta: {
        pausedFrom: String(before.paused),
        pausedTo: String(raw.paused),
        expiresAtFrom: before.expires_at === null ? "none" : before.expires_at.toISOString(),
        expiresAtTo: raw.expires_at === null ? "none" : raw.expires_at.toISOString(),
        maxUsesFrom: before.max_uses === null ? "none" : String(before.max_uses),
        maxUsesTo: raw.max_uses === null ? "none" : String(raw.max_uses),
      },
    });

    return { kind: "updated", code: toCodeRow(raw) };
  });
}

export type RotateCodeOutcome =
  | { kind: "rotated"; code: CodeRow; replaced: CodeRow }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number };

/** ROTATE — Part 3 §7's "code leaked publicly → rotate".
 *
 *  ONE TRANSACTION, and that is the whole reason this is a route rather than
 *  two client calls. Pausing the old code and minting the new one are useless
 *  apart: the half that lands first decides whether the gym is left with two
 *  live codes (harmless) or none (a gym nobody can join). Both or neither.
 *
 *  **The new code carries the old one's LABEL and NOTHING ELSE.** Copying the
 *  expiry forward would hand back a code that is already dead, and copying
 *  `max_uses` forward would hand back one that is already exhausted — a rotate
 *  whose entire point is producing something usable. The label travels because
 *  it is the group tag (§2.1) and the replacement stands in the same place in
 *  the gym as the code it replaces. */
export async function rotateCode(
  sql: Sql,
  input: { gymId: string; code: string; newCode: string; actorUserId: string },
): Promise<RotateCodeOutcome> {
  try {
    return await sql.begin(async (tx) => {
      // BEFORE the code row is locked, so this path and `createCode` take the
      // gym's row in the same order (T3 L-3's fix; `lockOrgRow` carries the why).
      await lockOrgRow(tx, input.gymId);
      const existing = await tx<(RawCode & { removed_at: Date | null })[]>`
        SELECT c.code, c.label, c.paused, c.expires_at, c.max_uses, c.removed_at,
               (SELECT count(*)::int FROM gym_members m
                 WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)
                 AS joined
        FROM gym_codes c
        WHERE c.gym_id = ${input.gymId} AND c.code = ${input.code}
        FOR UPDATE OF c`;
      const before = existing[0];
      if (before === undefined) return { kind: "not_found" };
      // Same 404 as `updateCode`: a tidied-away code is on no screen, so nothing
      // legitimate is asking to replace it.
      if (before.removed_at !== null) return { kind: "not_found" };

      const counted = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_codes
        WHERE gym_id = ${input.gymId} AND removed_at IS NULL`;
      if ((counted[0]?.n ?? 0) >= ORG_CODES_MAX) {
        return { kind: "too_many", cap: ORG_CODES_MAX };
      }

      const mintedRows = await tx<RawCode[]>`
        INSERT INTO gym_codes (gym_id, code, label)
        VALUES (${input.gymId}, ${input.newCode}, ${before.label})
        RETURNING code, label, paused, expires_at, max_uses, 0::int AS joined`;
      const minted = mintedRows[0];
      if (minted === undefined) throw new Error("INSERT INTO gym_codes returned no row");

      const retiredRows = await tx<RawCode[]>`
        UPDATE gym_codes AS c SET paused = true
        WHERE c.gym_id = ${input.gymId} AND c.code = ${input.code}
        RETURNING c.code, c.label, c.paused, c.expires_at, c.max_uses,
                  (SELECT count(*)::int FROM gym_members m
                    WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)
                    AS joined`;
      const retired = retiredRows[0];
      if (retired === undefined) throw new Error("UPDATE gym_codes returned no row under FOR UPDATE");

      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.code_rotated",
        targetType: "gym_code",
        // The row this audit is ABOUT is the one that was taken out of service —
        // "when did this code stop working, and who did it" is the question a
        // leaked poster raises. The replacement is named in the meta.
        targetId: retired.code,
        meta: { replacedBy: minted.code },
      });

      return { kind: "rotated", code: toCodeRow(minted), replaced: toCodeRow(retired) };
    });
  } catch (err) {
    // Only ONE unique constraint is reachable from these transactions
    // (`gym_codes_code_unique`), so unlike `createOrgAttempt` there is nothing
    // to disambiguate — but the error type is shared so the service's retry is
    // one mechanism rather than two.
    if (isUniqueViolation(err)) throw new OrgNameTakenError("code");
    throw err;
  }
}

export type RemoveCodeOutcome =
  | { kind: "removed" }
  | { kind: "not_found" }
  | { kind: "still_usable" };

/** TAKE A FINISHED CODE OFF THE GYM'S LIST — Kd, 2026-08-21: *"codes will pile
 *  up should have a option to delete"*.
 *
 *  **IT IS NOT A `DELETE`, and the reason is the members.** `gym_members.code_id`
 *  and `gym_join_applications.code_id` reference this row, both `ON DELETE
 *  RESTRICT` by the schema's default (R4.3). A real delete would therefore either
 *  be refused by Postgres for exactly the codes a gym most wants gone — the ones
 *  people used — or, if the constraint were relaxed, erase the record of how
 *  today's members got in. `removed_at` is the same soft-state shape
 *  `gym_members.removed_at` already uses for the same reason.
 *
 *  **ONLY A CODE THAT CANNOT ADMIT ANYBODY MAY BE REMOVED** (paused, or past its
 *  end date), and the UPDATE pauses it in the same statement. That pairing is the
 *  whole safety argument: a code missing from the console can never be a code
 *  still opening the door, so an owner tidying their screen cannot accidentally
 *  leave a live one running unwatched. A code that is merely FULL is not
 *  removable — a member leaving revives it, and hiding it would strand a code
 *  that is about to work again.
 *
 *  Removing twice is a SUCCESS, not a 404: the second tap of a slow button must
 *  leave the same state and say the same thing (the `DELETE /members/:userId`
 *  precedent). */
export async function removeCode(
  sql: Sql,
  input: { gymId: string; code: string; actorUserId: string },
): Promise<RemoveCodeOutcome> {
  return await sql.begin(async (tx) => {
    // TENANCY IS THE PAIR (gym, code), never the code alone (R3.2). Codes are
    // globally unique, so `WHERE code = $1` would compile, work, and let one
    // gym's manager tidy away another gym's poster.
    const rows = await tx<
      { code: string; paused: boolean; expires_at: Date | null; removed_at: Date | null }[]
    >`
      SELECT code, paused, expires_at, removed_at
      FROM gym_codes
      WHERE gym_id = ${input.gymId} AND code = ${input.code}
      FOR UPDATE`;
    const before = rows[0];
    if (before === undefined) return { kind: "not_found" };
    if (before.removed_at !== null) return { kind: "removed" };

    const expired = before.expires_at !== null && before.expires_at.getTime() <= Date.now();
    if (!before.paused && !expired) return { kind: "still_usable" };

    const updated = await tx<{ code: string }[]>`
      UPDATE gym_codes SET removed_at = now(), paused = true
      WHERE gym_id = ${input.gymId} AND code = ${input.code}
      RETURNING code`;
    if (updated[0] === undefined) {
      throw new Error("UPDATE gym_codes returned no row under FOR UPDATE");
    }

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.code_removed",
      targetType: "gym_code",
      targetId: before.code,
      // The row is still in the table and this is how a human finds out why it
      // stopped being on screen. "was it already off" answers the only question
      // a later reader has: whether the removal itself took a code out of service.
      meta: { pausedBefore: String(before.paused) },
    });

    return { kind: "removed" };
  });
}

// ---------------------------------------------------------------------------
// STAFF — Part 3 §4.7. Until this card, the ONLY `INSERT INTO gym_staff` in the
// product was the one inside `createOrgAttempt`, hard-coded to `'owner'`
// (grep-verified before a line was written), so a gym had exactly one person
// who could do anything and no way to appoint another. The join door's whole
// design says "the front desk confirms" and no gym could have a front desk.
// ---------------------------------------------------------------------------

export interface StaffRow {
  userId: string;
  displayName: string;
  email: string | null;
  role: OrgRole;
  /** The stored ticks, RAW — null meaning "this row predates the column". The
   *  service turns that into the role's defaults; nothing here decides it, so
   *  the rule lives in one place rather than in every reader. */
  privileges: string[] | null;
  since: Date;
}

/** Everyone who runs this gym, owner first and then oldest appointment first.
 *
 *  UNBOUNDED, and unlike `listCodes`' cap that is defensible rather than
 *  overlooked: a staff row can only be created by an owner naming an existing
 *  member of the same gym, so the ceiling is the roster and the only person who
 *  can approach it is the person reading this list. `ORG_CODES_LIMIT` exists
 *  because a code is minted by a tap; a staff row costs a deliberate act
 *  against a named human.
 *
 *  Tenancy IS the WHERE (R3.2). There is no read-a-staff-row-by-id anywhere in
 *  this module, so a staff row is only ever reachable through a gym the caller
 *  was authorised against first.
 *
 *  **THE ELIGIBILITY TEST IS WRITTEN OUT AGAIN HERE, MATCHING `getStaffRole`
 *  WORD FOR WORD, and the duplication is deliberate** (T3 round 2, Low-2). Round
 *  1's C/H-3 fix taught `getStaffRole` to refuse an ex-member and left this
 *  reader alone, so the LIST said "manager" about somebody whose authority was
 *  already `null` — the fix is what made the row false. Two readers of
 *  `gym_staff` that disagree is the defect; a shared `sql` fragment is R3.8's
 *  forbidden shape, so they are spelled twice and **anchored by a test that
 *  drives BOTH** (:14013's six-site precedent, same reasoning). Change one and
 *  the test fails; change neither and a screen lies about who holds keys. */
export async function listStaff(sql: Sql, gymId: string): Promise<StaffRow[]> {
  const rows = await sql<
    {
      user_id: string;
      display_name: string;
      email: string | null;
      role: string;
      privileges: string[] | null;
      since: Date;
    }[]
  >`
    SELECT s.user_id, u.display_name, u.email, s.role, s.privileges, s.created_at AS since
    FROM gym_staff s
    JOIN users u ON u.id = s.user_id
    JOIN gyms g ON g.id = s.gym_id
    WHERE s.gym_id = ${gymId}
      AND u.status = 'active'
      AND (
        g.owner_user_id = s.user_id
        OR EXISTS (
          SELECT 1 FROM gym_members m
          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL
        )
        OR NOT EXISTS (
          SELECT 1 FROM gym_members m
          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id
        )
      )
    ORDER BY (s.role = 'owner') DESC, s.created_at ASC, s.user_id ASC`;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    role: toOrgRole(r.role),
    privileges: r.privileges,
    since: r.since,
  }));
}

/** One staff row by (gym, user) — the shape every mutation answers with, read
 *  back through `listStaff`'s own projection so the list and the mutation can
 *  never describe the same person differently. */
async function readStaffRow(
  tx: TransactionSql,
  gymId: string,
  userId: string,
): Promise<StaffRow | null> {
  const rows = await tx<
    {
      user_id: string;
      display_name: string;
      email: string | null;
      role: string;
      privileges: string[] | null;
      since: Date;
    }[]
  >`
    SELECT s.user_id, u.display_name, u.email, s.role, s.privileges, s.created_at AS since
    FROM gym_staff s
    JOIN users u ON u.id = s.user_id
    WHERE s.gym_id = ${gymId} AND s.user_id = ${userId}`;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        role: toOrgRole(row.role),
        privileges: row.privileges,
        since: row.since,
      };
}

export type AddStaffOutcome =
  | { kind: "added"; staff: StaffRow }
  | { kind: "not_a_member" }
  | { kind: "already_staff"; staff: StaffRow };

/** Appoint a member of this gym as staff.
 *
 *  **THE LOOKUP IS SCOPED TO THIS GYM'S LIVE ROSTER, and that is the security
 *  property, not a convenience.** Resolving the email against `users` globally
 *  would answer "does this address have an account" for anything an owner types.
 *  Joined to `gym_members` with `removed_at IS NULL`, the only addresses that
 *  resolve are people already on a roster the caller can read.
 *
 *  `email` is `citext` (Part 4 §3.1), so the equality is case-insensitive in the
 *  DATABASE rather than by a `lower()` this file would have to remember.
 *
 *  **IT TAKES THE ORG LOCK, and the first version of this function did not —
 *  that was T3 round 1's C/H-2 (2026-08-22).** The race that matters is not two
 *  people appointing at once (one primary key, `ON CONFLICT DO NOTHING`, the
 *  loser reads the winner's row and `already_staff` is right either way). It is
 *  **appointing racing REMOVE-FROM-MEMBERS**: this function reads live
 *  membership and `removeMember` reads `gym_staff`, so interleaved they commit a
 *  staff row and a closed membership — somebody running a gym they are not in,
 *  holding `members.read` over the whole roster. Reproduced 12 times out of 12.
 *  :14174's rule is unchanged and is what selects the fix: a lock is warranted
 *  by the CONSEQUENCE, and the consequence here is an authorisation hole rather
 *  than a retryable collision. `removeMember` takes the same lock in the same
 *  order. */
export async function addStaff(
  sql: Sql,
  input: {
    gymId: string;
    email: string;
    role: OrgRole;
    /** The starting ticks, computed by the SERVICE from the role's template.
     *  Written with the row so a staff record is never a moment old without an
     *  effective set (:11429's snapshot). */
    privileges: readonly string[];
    actorUserId: string;
  },
): Promise<AddStaffOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);

    const candidates = await tx<{ user_id: string }[]>`
      SELECT m.user_id
      FROM gym_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.gym_id = ${input.gymId}
        AND m.removed_at IS NULL
        AND u.email = ${input.email}
      LIMIT 1`;
    const candidate = candidates[0];
    if (candidate === undefined) return { kind: "not_a_member" };

    const inserted = await tx<{ user_id: string }[]>`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${input.gymId}, ${candidate.user_id}, ${input.role}, ${[...input.privileges]})
      ON CONFLICT (gym_id, user_id) DO NOTHING
      RETURNING user_id`;

    const staff = await readStaffRow(tx, input.gymId, candidate.user_id);
    if (staff === null) throw new Error("gym_staff row missing immediately after insert");

    // The row already existed. Its role is REPORTED, never overwritten — a
    // second POST must not silently demote a manager to trainer because a stale
    // screen still offered "add as trainer". Changing a role is the PATCH.
    if (inserted[0] === undefined) return { kind: "already_staff", staff };

    // NOTHING IS WRITTEN TO `gym_members` HERE. Kd's "staff seats free" is
    // enforced in `claimSeat`'s count (see the note there); the first version
    // wrote `complimentary = true` and three other readers acted on it.

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.staff_added",
      targetType: "gym_staff",
      targetId: candidate.user_id,
      meta: { role: input.role, privileges: [...input.privileges] },
    });

    return { kind: "added", staff };
  });
}

export type UpdateStaffOutcome =
  | { kind: "updated"; staff: StaffRow }
  | { kind: "unchanged"; staff: StaffRow }
  | { kind: "not_staff" }
  | { kind: "is_owner" };

/** Change somebody between manager and trainer.
 *
 *  **AN OWNER'S ROLE IS REFUSED HERE.** Demoting the owner is last-owner lockout
 *  wearing a different hat — §4.7 blocks removing them and :11429's rule 2 makes
 *  the point that reaching the same lockout by another door is the same defect —
 *  and PROMOTING somebody to owner is the transfer question this card defers
 *  (`staffAssignableRoleSchema` refuses that direction at the boundary; this
 *  refuses the other one at the row).
 *
 *  `unchanged` is a distinct outcome rather than a silent success because it
 *  decides whether an audit row is written: "the owner set Priya to trainer" in
 *  a history is a claim about something that happened, and a no-op tap did not
 *  happen. The CALLER cannot tell the two apart and does not need to — both are
 *  a 200 carrying the same row. */
export async function updateStaffRole(
  sql: Sql,
  input: {
    gymId: string;
    userId: string;
    role: OrgRole;
    /** The new role's DEFAULT ticks. A role change RESETS them — see the
     *  service's note: without that, "demote to trainer" would leave every
     *  manager tick standing and demote nobody. */
    privileges: readonly string[];
    actorUserId: string;
  },
): Promise<UpdateStaffOutcome> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ role: string }[]>`
      SELECT role FROM gym_staff
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}
      FOR UPDATE`;
    const before = rows[0];
    if (before === undefined) return { kind: "not_staff" };
    const previous = toOrgRole(before.role);
    if (previous === "owner") return { kind: "is_owner" };

    if (previous === input.role) {
      const staff = await readStaffRow(tx, input.gymId, input.userId);
      if (staff === null) throw new Error("gym_staff row vanished under FOR UPDATE");
      return { kind: "unchanged", staff };
    }

    await tx`
      UPDATE gym_staff SET role = ${input.role}, privileges = ${[...input.privileges]}
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;

    const staff = await readStaffRow(tx, input.gymId, input.userId);
    if (staff === null) throw new Error("gym_staff row vanished under FOR UPDATE");

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.staff_role_changed",
      targetType: "gym_staff",
      targetId: input.userId,
      // BOTH ends, because the question a human asks weeks later is "what did
      // they used to be able to do", which the new role alone cannot answer.
      // The ticks the change RESET them to are recorded for the same reason: a
      // role change is now also a permission change, and an audit row that
      // names only the role would hide half of what happened.
      meta: { from: previous, to: input.role, privileges: [...input.privileges] },
    });

    return { kind: "updated", staff };
  });
}

export type SetStaffPrivilegesOutcome =
  | { kind: "updated"; staff: StaffRow }
  | { kind: "unchanged"; staff: StaffRow }
  | { kind: "not_staff" }
  | { kind: "owner_only_privilege" }
  | { kind: "last_owner_locked" };

/** REPLACE ONE PERSON'S TICKS with the set an owner just looked at.
 *
 *  **THE WHOLE SET IS WRITTEN, never a diff** — see the request schema for why:
 *  a diff applied to a row somebody else edited produces a set nobody chose.
 *
 *  **THE LAST-OWNER GUARD IS A COUNT INSIDE THE ORG LOCK, and it is the same
 *  shape as `removeStaff`'s for the same reason** (:11429 rule 2, :14174's rule
 *  on when a lock is warranted). Reading "how many owners are there" and then
 *  writing is check-then-act; the loser of that race is a gym whose last owner
 *  can no longer manage staff, which **nobody inside the gym can repair**,
 *  because handing out `staff.manage` requires `staff.manage`. That is the
 *  severity that buys a lock, in contrast to the self-healing races :14174 says
 *  do not.
 *
 *  It counts OWNERS rather than asking "is this the owner", so it stays correct
 *  on the day a second owner becomes possible — `removeStaff`'s wording, kept
 *  deliberately identical because it is the same rule pointed at a different
 *  door.
 *
 *  **`unchanged` is a distinct outcome because it decides whether an audit row
 *  is written**: "the owner changed what Priya can do" in a gym's history is a
 *  claim about something that happened, and re-saving the same set did not
 *  happen. The caller cannot tell the two apart and does not need to. */
export async function setStaffPrivileges(
  sql: Sql,
  input: {
    gymId: string;
    userId: string;
    /** Already canonical (sorted, de-duplicated) — the service does that, so
     *  the stored order is one order and "did anything change" is a question
     *  about ACCESS rather than about ordering. */
    privileges: readonly string[];
    /** What the LAST owner may not be stripped of. Passed in rather than named
     *  here: which privileges are lockout-capable is a policy question and the
     *  service owns policy (`LAST_OWNER_REQUIRED_PRIVILEGES`). */
    lastOwnerRequires: readonly string[];
    /** Privileges that only an OWNER's row may carry (§2.2's owner-alone rows,
     *  :11429 rule 1). Policy, so it is the service's — `OWNER_ONLY_PRIVILEGES`
     *  — and this file only enforces it. */
    ownerOnly: readonly string[];
    actorUserId: string;
  },
): Promise<SetStaffPrivilegesOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);

    const rows = await tx<{ role: string; privileges: string[] | null }[]>`
      SELECT role, privileges FROM gym_staff
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;
    const before = rows[0];
    if (before === undefined) return { kind: "not_staff" };
    const role = toOrgRole(before.role);

    // T3 C/H-1, and it is a PRIVILEGE ESCALATION rather than a tidiness point:
    // `staff.manage` gates this very route, so handing it to a manager hands
    // them the power to change ANYBODY's ticks — the owner's included. The
    // reviewer proved the whole chain by running it: a manager granted the tick
    // stripped the owner, and the owner then got a 403 on their own roster.
    //
    // :11429 rule 1 is what this restores — "only an OWNER may change anybody's
    // ticks… this ruling does not widen it" — and rule 3's licence to widen
    // rests on it ("safe BECAUSE rule 1 means only an owner can hand out the
    // keys"). The route's own gate could not enforce rule 1, because until this
    // card nobody could hold that tick but an owner: **this card is what made
    // the gate's premise false.**
    //
    // Refused HERE, at the write, rather than at the route: this is the only
    // door that can put an owner-only privilege on a non-owner row (the other
    // two writers copy a role TEMPLATE, and no template contains one), so the
    // rule is enforced where the value is stored rather than where it is asked
    // for. A DB-level CHECK across `role` and `privileges` was considered and
    // NOT taken: it would need a second migration inside a fix round (:5348
    // rule 6) and would hard-code the vocabulary into DDL a third time, which
    // is the drift T3 Low-5's new guard exists to prevent.
    if (role !== "owner" && input.ownerOnly.some((p) => input.privileges.includes(p))) {
      return { kind: "owner_only_privilege" };
    }

    // T3 Low-1: this counted owner ROWS, and stripping a privilege does not
    // remove a row, so with two owners each could strip the other and the count
    // never fell — measured by the reviewer, both owners left unable to manage
    // staff and nobody inside the gym able to repair it. `removeStaff`'s
    // identically-shaped count is correct because DELETE does decrement it;
    // copying the shape did not transfer the property.
    //
    // It now counts owners who still HOLD every required privilege, excluding
    // this row — whose state after this write is the incoming set, which the
    // condition above has already found wanting. A NULL row counts as a holder
    // because `privilegesFor` gives it the owner template (the deploy window).
    if (role === "owner" && input.lastOwnerRequires.some((p) => !input.privileges.includes(p))) {
      const others = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_staff
        WHERE gym_id = ${input.gymId}
          AND role = 'owner'
          AND user_id <> ${input.userId}
          AND (privileges IS NULL OR privileges @> ${[...input.lastOwnerRequires]})`;
      if ((others[0]?.n ?? 0) === 0) return { kind: "last_owner_locked" };
    }

    // A row that predates the column (`null`) is never "unchanged": writing it
    // is what materialises the snapshot, so the deploy-window fallback stops
    // applying to this person from here on.
    const previous = before.privileges === null ? null : [...before.privileges].sort();
    const next = [...input.privileges];
    if (previous !== null && previous.length === next.length && previous.every((p, i) => p === next[i])) {
      const staff = await readStaffRow(tx, input.gymId, input.userId);
      if (staff === null) throw new Error("gym_staff row vanished under the org lock");
      return { kind: "unchanged", staff };
    }

    await tx`
      UPDATE gym_staff SET privileges = ${next}
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;

    const staff = await readStaffRow(tx, input.gymId, input.userId);
    if (staff === null) throw new Error("gym_staff row vanished under the org lock");

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.staff_privileges_changed",
      targetType: "gym_staff",
      targetId: input.userId,
      // BOTH ends, `updateStaffRole`'s reason: the question asked weeks later is
      // "what could they do before", which the new set alone cannot answer. A
      // null `from` is the honest record of a row that predated the column.
      meta: { role, from: previous, to: next },
    });

    return { kind: "updated", staff };
  });
}

export type RemoveStaffOutcome =
  | { kind: "removed" }
  | { kind: "not_staff" }
  | { kind: "last_owner" };

/** Take somebody off staff. **They stay a MEMBER** — the two are different
 *  relationships and Kd was shown that before approving: this takes away the
 *  keys, `removeMember` takes away the membership, and only the second one costs
 *  them the gym's perks.
 *
 *  **THE LAST-OWNER GUARD IS A COUNT INSIDE THE ORG LOCK, and the lock is the
 *  point.** Counting owners and then deleting one is check-then-act — :14174's
 *  L-3 exactly — and the consequence of losing that race is a gym with ZERO
 *  owners, which nobody inside the gym can repair, because appointing staff is
 *  owner-only. That is the severity :14174 says warrants a lock, in contrast to
 *  the self-healing count it says does not.
 *
 *  It is written as a COUNT rather than as "is this the owner" so it stays
 *  correct on the day a second owner becomes possible: today every owner is the
 *  last one, and the guard does not have to be rewritten to notice when that
 *  stops being true.
 *
 *  The seat reverts to paid in the same transaction. If that pushes the gym over
 *  its cap, the cap does what it does everywhere else — it refuses the NEXT join
 *  rather than evicting anybody — which is the honest direction. */
export async function removeStaff(
  sql: Sql,
  input: {
    gymId: string;
    userId: string;
    /** What the last owner may not be left without — the SAME list
     *  `setStaffPrivileges` takes, because it is the same question at the other
     *  door (T3 round 2, Low-1). Policy stays in the service. */
    lastOwnerRequires: readonly string[];
    actorUserId: string;
  },
): Promise<RemoveStaffOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);

    const rows = await tx<{ role: string }[]>`
      SELECT role FROM gym_staff
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;
    const before = rows[0];
    if (before === undefined) return { kind: "not_staff" };
    const role = toOrgRole(before.role);

    // T3 round 2, Low-1 — THE SAME LOCKOUT AT THIS DOOR, and the third time this
    // guard has been copied and got the same thing wrong.
    //
    // Counting owner ROWS was right when a row was the only thing that carried
    // authority. Since the ticks card an owner can be ticked DOWN, so two owner
    // rows can mean one person who can manage staff: remove that person and the
    // gym keeps an owner and loses the ability to appoint anybody — the same
    // unrepairable state `setStaffPrivileges` was fixed for one round earlier.
    //
    // **The question both doors now ask is identical: does anybody ELSE still
    // HOLD every privilege the last owner may not lose.** It is written out
    // TWICE rather than shared, because a shared `sql` fragment is R3.8's
    // forbidden shape (:14493 Low-2) — and, exactly as there, ONE TEST DRIVES
    // BOTH DOORS so the copies cannot drift (:14013's precedent). Edit one, edit
    // the other, or a gym can lock itself out through whichever you left behind.
    if (role === "owner") {
      const otherOwners = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_staff
        WHERE gym_id = ${input.gymId}
          AND role = 'owner'
          AND user_id <> ${input.userId}
          AND (privileges IS NULL OR privileges @> ${[...input.lastOwnerRequires]})`;
      if ((otherOwners[0]?.n ?? 0) === 0) return { kind: "last_owner" };
    }

    const deleted = await tx<{ user_id: string }[]>`
      DELETE FROM gym_staff
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}
      RETURNING user_id`;
    if (deleted[0] === undefined) {
      throw new Error("DELETE FROM gym_staff removed no row under the org lock");
    }

    // Nothing to undo on `gym_members`: their seat starts counting again the
    // moment the staff row is gone, because `claimSeat` asks `gym_staff` rather
    // than reading a flag somebody has to remember to clear.

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.staff_removed",
      targetType: "gym_staff",
      targetId: input.userId,
      meta: { role },
    });

    return { kind: "removed" };
  });
}

/** Part 3 §3.3: "every mutating call writes `audit_log`". Written inside the
 *  caller's transaction, so a join that is rolled back leaves no audit row
 *  claiming it happened, and a committed join can never be missing one. */
export async function insertAudit(
  tx: TransactionSql,
  entry: {
    /** NULL means NOBODY DID THIS — the expiry sweep is the only writer that
     *  passes one, and it passes null because no human decided. The column has
     *  always been nullable (Part 4 §3.6); what changed on 2026-08-20 is that
     *  something finally acts without an actor. Recording a system action under
     *  some stand-in user id would be the more convenient lie. */
    actorUserId: string | null;
    gymId: string;
    action: string;
    targetType: string;
    targetId: string;
    /** Strings, or a LIST of strings — and the list arrived on the terms this
     *  comment set: "widen it when a caller genuinely needs structure, not
     *  before". The ticks card is that caller. A permission change's whole
     *  content is which privileges moved, and flattening them into one string
     *  would put the interesting part inside a value nothing can query — the
     *  opposite of what the original rule was protecting.
     *
     *  Still deliberately NOT `unknown`: no nested objects, no dates, nothing a
     *  human reading the row weeks later has to unpack. `null` is allowed for
     *  exactly one thing — a "before" state that genuinely did not exist. */
    meta: Record<string, string | readonly string[] | null>;
  },
): Promise<void> {
  await tx`
    INSERT INTO audit_log (actor_user_id, gym_id, action, target_type, target_id, meta)
    VALUES (${entry.actorUserId}, ${entry.gymId}, ${entry.action},
            ${entry.targetType}, ${entry.targetId}, ${tx.json(entry.meta)})`;
}
