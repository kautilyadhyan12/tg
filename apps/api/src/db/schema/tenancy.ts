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
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false),
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
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.userId] }),
    check("gym_staff_role_check", sql`${t.role} IN ('owner','manager','trainer')`),
  ],
);
