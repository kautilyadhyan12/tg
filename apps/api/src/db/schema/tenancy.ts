// Part 4 §3.2 — Organizations & membership. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const gyms = pgTable(
  "gyms", // the org table; name kept for continuity (v1 §8)
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    city: text("city"),
    /** ISO 3166-1 alpha-2, and the one field the create wizard collected and
     *  the server then DISCARDED (migration `0014` adds it).
     *
     *  It is stored because `currency_display` is derived FROM it (:10010) and a
     *  derived value cannot answer "where is this gym" — EUR is twenty
     *  countries. Without the column a console can show what a gym is billed in
     *  and never what it asked for, so an owner correcting their country would
     *  be typing into a box that reads back empty for ever.
     *
     *  NULLABLE because nothing honest can be back-filled: `INR` is this
     *  column's neighbour's DEFAULT, so inverting the currency map would write
     *  'IN' onto rows where nobody said anything. NULL means "we never asked".
     *
     *  The CHECK is SHAPE ONLY. Whether we are OPEN in a country is
     *  `supportedCountrySchema`'s answer, in code, and it grows as Kd opens
     *  markets — a copy of that list in DDL would be a second answer that goes
     *  stale silently. */
    country: text("country"),
    orgType: text("org_type").notNull().default("gym"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    locale: text("locale").notNull().default("en"),
    currencyDisplay: text("currency_display").notNull().default("INR"),
    logoKey: text("logo_key"), // R2 gym-assets/
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    ownerIncludedAsMember: boolean("owner_included_as_member").notNull().default(true),
    activation: jsonb("activation").notNull().default(sql`'{}'`), // Part 3 §5.1 checklist state
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("gyms_org_type_check", sql`${t.orgType} IN ('gym','studio','clinic')`),
    check("gyms_status_check", sql`${t.status} IN ('active','archived')`),
    check("gyms_country_check", sql`${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

export const gymCodes = pgTable("gym_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  gymId: uuid("gym_id")
    .notNull()
    .references(() => gyms.id, { onDelete: "cascade" }),
  code: text("code").unique().notNull(), // 6-char, ambiguity-free alphabet
  label: text("label").notNull().default("Front Desk"), // the group mechanism (Part 3 §2.1)
  maxUses: integer("max_uses"),
  /** LIFETIME TALLY OF SEAT CLAIMS — kept, written, and DISPLAYED NOWHERE.
   *
   *  Kd's smoke of 2026-08-21 read "2 people have joined with it" off this
   *  column for a code ONE person had used: they joined, were removed, and
   *  joined again, and each claim bumped it. A count of EVENTS was being printed
   *  under a sentence about PEOPLE, and it gated `max_uses` too — so a member who
   *  left took their place in the limit with them.
   *
   *  What a screen shows and what the door enforces now come from the
   *  memberships themselves (`repo.ts`'s `joined` subquery: live, complimentary
   *  excluded), which has ONE source of truth and cannot drift. This column
   *  stays because it answers a different and still-honest question — how many
   *  times has this code ever admitted somebody — which no other row records.
   *  Do NOT wire it back to a screen or a limit. */
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false),
  /** TIDIED AWAY, NOT DELETED (Kd 2026-08-21: "codes will pile up should have a
   *  option to delete").
   *
   *  A finished code leaves the console's list and the ROW stays, because
   *  `gym_members.code_id` and `gym_join_applications.code_id` point at it: a
   *  real `DELETE` would either be refused by those foreign keys or erase how
   *  today's members got in. Only a code that can no longer admit anybody is
   *  removable, and removal pauses it in the same statement, so "not in the
   *  list" and "cannot let anyone in" can never disagree. */
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const gymMembers = pgTable(
  "gym_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    codeId: uuid("code_id").references(() => gymCodes.id), // group attribution at join
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }), // membership = [joined_at, removed_at)
    // Clinic join consent (Part 3 §2.4). Enforced in the ORGS REPO, inside the
    // join transaction (`joinByCode`) — this comment said "in service" from
    // 0001_init and that was always where it was expected to live rather than
    // where it landed (T3 round 2 L-2). NULL is a real value and means nobody
    // was asked: the owner's silent seat (§4.0 step 6) carries it.
    consentAt: timestamp("consent_at", { withTimezone: true }),
    hiddenFromBoards: boolean("hidden_from_boards").notNull().default(false),
    complimentary: boolean("complimentary").notNull().default(false), // owner seat (Part 3 §4.0); excluded from seat counts
    createdAt: createdAt(),
  },
  (t) => [
    // The leave/rejoin design: one LIVE membership per (gym,user); history rows stack.
    uniqueIndex("gym_members_live_uq")
      .on(t.gymId, t.userId)
      .where(sql`${t.removedAt} IS NULL`),
    index("gym_members_gym_removed_idx").on(t.gymId, t.removedAt), // roster & seat count
    // "how many people are in through THIS code" — the number the console prints
    // and the number `max_uses` is measured against, read once per code on every
    // console load and once per join at the door.
    index("gym_members_code_live_idx").on(t.codeId).where(sql`${t.removedAt} IS NULL`),
    index("gym_members_user_removed_idx").on(t.userId, t.removedAt), // entitlement resolver
    index("gym_members_gym_joined_idx").on(t.gymId, t.joinedAt), // interval joins (rollups)
  ],
);

/** THE WAITING ROOM (Kd ruling 2026-08-19, DECISIONS :11072): typing a join
 *  code creates an APPLICATION, not a membership. An unknown person is PENDING
 *  — no seat, no gym-paid features — until the gym's front desk confirms them.
 *
 *  **WHY THIS IS A TABLE OF ITS OWN AND NOT A `status` COLUMN ON
 *  `gym_members`.** Eleven places across six server files already read
 *  `removed_at IS NULL` as "this person is a live member" (measured
 *  2026-08-19): the entitlement resolver's §4.1 canonical SQL, the three
 *  per-module `getLiveGymId` spend-attribution lookups, the roster, `/mine`,
 *  the §4.2 seat count and the DPDP Day-0 close. A status column makes every
 *  one of them OPT-OUT, and the one that gets missed hands a stranger the
 *  gym's paid entitlements with nothing on any screen to show for it (:5807's
 *  class, and :1239's "fix the class, not the case" from the side where the
 *  class is created rather than discovered). A separate table leaves Part 4
 *  §4.1's and §4.2's canonical SQL VERBATIM (R4.5) and correct by
 *  construction — no edit, therefore no missed edit.
 *
 *  An ADDITION with no governing §: Part 4 §3.2 models membership only, and
 *  Part 3 §4.3 says the opposite in as many words ("code used by a stranger →
 *  they're a member like any other"). Kd's ruling supersedes that line; it is
 *  named here rather than slipped past (R0.2/R0.3). */
export const gymJoinApplications = pgTable(
  "gym_join_applications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // NOT NULL, unlike `gym_members.code_id`: an application exists only
    // because somebody typed a code. The roster IMPORT creates memberships
    // with no code, which is why the membership column is nullable and this
    // one is not.
    codeId: uuid("code_id")
      .notNull()
      .references(() => gymCodes.id),
    status: text("status").notNull().default("pending"),
    // Part 3 §2.4's clinic consent, captured when the person APPLIES and
    // copied onto the membership at confirm — so the record is dated to the
    // moment they agreed, not to the moment the front desk got round to it.
    consentAt: timestamp("consent_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    // Ruled at :11385 (14 days, ratified at this card): a leaked code's pile of
    // applications clears itself, and re-applying costs a real member seconds.
    // Written here from day one so the sweep that acts on it is a worker and
    // not a backfill.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    /** The membership a confirm created — the audit trail from "who let this
     *  person in" to the row it produced. */
    memberId: uuid("member_id").references(() => gymMembers.id),
    /** :11385's ordering rule is load-bearing and these two columns are what
     *  make it checkable: nothing may EXPIRE before the gym has been told at
     *  least once. Written by the reminder sweep (its own card); NULL here
     *  means "nobody has been told", never "told at the epoch". */
    gymNotifiedAt: timestamp("gym_notified_at", { withTimezone: true }),
    memberNudgedAt: timestamp("member_nudged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_join_applications_status_check",
      sql`${t.status} IN ('pending','confirmed','rejected','cancelled','expired')`,
    ),
    // Deliberately the same partial-index shape as `gym_members_live_uq`: one
    // LIVE application per (gym,user), history rows stack. A second tap on
    // Apply is then idempotent at the DATABASE, not by the service
    // remembering to check — the same reason §4.2 leans on its own index.
    uniqueIndex("gym_join_applications_pending_uq")
      .on(t.gymId, t.userId)
      .where(sql`${t.status} = 'pending'`),
    index("gym_join_applications_gym_status_idx").on(t.gymId, t.status, t.appliedAt), // the queue
    index("gym_join_applications_user_status_idx").on(t.userId, t.status), // the member's own card + Day-0 cancel
    index("gym_join_applications_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`), // the expiry sweep (its own card)
  ],
);

export const gymStaff = pgTable(
  "gym_staff",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    /** WHAT THIS PERSON MAY ACTUALLY DO — the EFFECTIVE set, stored as a
     *  snapshot on the row (Kd ruling :11429's K4 call, ratified at this card;
     *  amended :14745 and again 2026-08-22 when he chose "nobody changes on
     *  their own — I tap a button").
     *
     *  **The ROLE picks the starting ticks; the TICKS are what the server
     *  enforces** (`requirePrivilege`). Storing the effective set rather than a
     *  diff against the role's template is what makes "what can this person do"
     *  answerable without knowing which version of the template they were
     *  appointed under — and it is what stops a template edit silently widening
     *  ten people's access, which is exactly what Kd ruled against.
     *
     *  **`text[]` and not JSONB, decided against R4.2 at the card as :11429
     *  asked.** JSONB is for values the app treats as a document; this is a set
     *  of enumerated strings, and the moment anything filters on one privilege
     *  (:11429 names the notifications case — "email every staff member who can
     *  manage members") an array answers it in SQL with `= ANY` and a GIN index,
     *  where a JSONB field would have to become a column.
     *
     *  **NULLABLE ONLY FOR THE DEPLOY WINDOW (R4.4 expand-then-contract), not
     *  as a model.** Every writer fills it in, and `0013`'s own backfill filled
     *  the rows that predate it, so after that migration no row is NULL —
     *  measured. The window that needs the nullability is the one where the
     *  MIGRATION has landed and the new code has not: old `createOrgAttempt` and
     *  old `addStaff` insert without this column, and a NOT NULL would break
     *  creating a gym. The reader falls back to the role's defaults for exactly
     *  those rows. Contracting to NOT NULL is owed (`OWED.md`).
     *
     *  The CHECK constrains the vocabulary the way every status column in this
     *  schema does — `text` + CHECK, never a PG enum (R4.2) — so a privilege
     *  nobody defined cannot be stored even if a caller invents one. It does NOT
     *  forbid duplicates; the write path stores a sorted, de-duplicated set. */
    privileges: text("privileges").array(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.userId] }),
    check("gym_staff_role_check", sql`${t.role} IN ('owner','manager','trainer')`),
    check(
      "gym_staff_privileges_check",
      sql`${t.privileges} IS NULL OR ${t.privileges} <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage']::text[]`,
    ),
  ],
);
