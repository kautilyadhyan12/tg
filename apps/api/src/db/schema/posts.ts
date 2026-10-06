// A GYM'S UPDATES (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a). Mirrors
// `0071_gym_posts.sql` and `0072_member_posts.sql`, which are the record.
//
// A staff post is the gym's: its author and the member of staff who removed it are the
// only user links, both `ON DELETE set null`, so `gym_posts` is on
// `USER_LINKED_NOT_PURGED_TABLES`. A member's own post (`by_member`) is the person's and
// is deleted with their account by a statement of its own (`privacy/repo.ts`), as their
// reactions, reports and a stop on their posting are (`DIRECT_DELETE_TABLES`).
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymPosts = pgTable(
  "gym_posts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The browser's key for the post: sent twice, it is one post. */
    postKey: uuid("post_key").notNull(),
    body: text("body").notNull(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: createdAt(),
    /** Removed by staff: gone for everyone, its photos and reactions deleted. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: uuid("removed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** A member's own post, as against one by the gym's staff. */
    byMember: boolean("by_member").notNull().default(false),
    /** When its fifth waiting report landed (`0077_post_hidden_at.sql`): hidden from
     *  members until staff keep or remove it. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  },
  (t) => [
    unique("gym_posts_gym_id_uq").on(t.gymId, t.id),
    unique("gym_posts_post_key_uq").on(t.gymId, t.postKey),
    check("gym_posts_body_len_check", sql`char_length(${t.body}) <= 2000`),
    check("gym_posts_removed_not_pinned_check", sql`${t.removedAt} IS NULL OR ${t.pinnedAt} IS NULL`),
    index("gym_posts_feed_idx").on(t.gymId, t.createdAt.desc(), t.id.desc()).where(sql`${t.removedAt} IS NULL`),
    index("gym_posts_member_author_idx").on(t.authorUserId, t.gymId, t.createdAt.desc()).where(sql`${t.byMember}`),
  ],
);

/** A post's photos, in the order they are shown. The file is in the photo store under
 *  `storage_key`. */
export const gymPostPhotos = pgTable(
  "gym_post_photos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    position: smallint("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "gym_post_photos_post_fk", columns: [t.gymId, t.postId], foreignColumns: [gymPosts.gymId, gymPosts.id] }).onDelete("cascade"),
    unique("gym_post_photos_storage_key_uq").on(t.storageKey),
    unique("gym_post_photos_position_uq").on(t.postId, t.position),
    check("gym_post_photos_type_check", sql`${t.contentType} IN ('image/jpeg','image/png','image/webp')`),
    check("gym_post_photos_size_check", sql`${t.byteSize} BETWEEN 1 AND 2097152`),
    check("gym_post_photos_width_check", sql`${t.width} BETWEEN 1 AND 8000`),
    check("gym_post_photos_height_check", sql`${t.height} BETWEEN 1 AND 8000`),
    check("gym_post_photos_position_check", sql`${t.position} BETWEEN 0 AND 3`),
  ],
);

/** One reaction a person a post; tapping another replaces it. */
export const gymPostReactions = pgTable(
  "gym_post_reactions",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_post_reactions_pk", columns: [t.postId, t.userId] }),
    foreignKey({ name: "gym_post_reactions_post_fk", columns: [t.gymId, t.postId], foreignColumns: [gymPosts.gymId, gymPosts.id] }).onDelete("cascade"),
    check("gym_post_reactions_reaction_check", sql`${t.reaction} IN ('like','love','strong','fire')`),
    index("gym_post_reactions_user_idx").on(t.userId),
  ],
);

/** One report a person a post: open until staff remove the post or keep it. */
export const gymPostReports = pgTable(
  "gym_post_reports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    /** What the person typed beside their reason, if anything. */
    note: text("note"),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    outcome: text("outcome"),
  },
  (t) => [
    foreignKey({ name: "gym_post_reports_post_fk", columns: [t.gymId, t.postId], foreignColumns: [gymPosts.gymId, gymPosts.id] }).onDelete("cascade"),
    unique("gym_post_reports_one_each_uq").on(t.postId, t.userId),
    check("gym_post_reports_reason_check", sql`${t.reason} IN ('unkind','photo_of_someone','nudity','spam','other')`),
    check("gym_post_reports_note_check", sql`char_length(${t.note}) BETWEEN 1 AND 300`),
    check("gym_post_reports_outcome_check", sql`${t.outcome} IN ('removed','kept')`),
    check("gym_post_reports_closed_check", sql`(${t.closedAt} IS NULL) = (${t.outcome} IS NULL)`),
    index("gym_post_reports_open_idx").on(t.gymId, t.postId).where(sql`${t.closedAt} IS NULL`),
    index("gym_post_reports_user_idx").on(t.userId),
  ],
);

/** A person the gym has stopped posting. */
export const gymPostStops = pgTable(
  "gym_post_stops",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: "gym_post_stops_pk", columns: [t.gymId, t.userId] }), index("gym_post_stops_user_idx").on(t.userId)],
);

/** One member has blocked another at this gym: `userId` no longer sees `blockedUserId`'s
 *  posts or reactions there. */
export const gymPostBlocks = pgTable(
  "gym_post_blocks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_post_blocks_one_each_uq").on(t.gymId, t.userId, t.blockedUserId),
    check("gym_post_blocks_not_self_check", sql`${t.userId} <> ${t.blockedUserId}`),
    index("gym_post_blocks_user_idx").on(t.userId),
    index("gym_post_blocks_blocked_idx").on(t.blockedUserId),
  ],
);

/** Photo files still to be removed from the store (`0076_photo_files_to_remove.sql`): a
 *  key is here from the step that deletes its row until its file has gone. */
export const photoFilesToRemove = pgTable(
  "photo_files_to_remove",
  {
    storageKey: text("storage_key").primaryKey(),
    createdAt: createdAt(),
  },
  (t) => [index("photo_files_to_remove_created_idx").on(t.createdAt)],
);
