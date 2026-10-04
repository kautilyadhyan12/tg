// A GYM'S UPDATES (spec Part 3 §15.2; ROADMAP 19b-i). Mirrors `0071_gym_posts.sql`,
// which is the record.
//
// A post is the gym's: its author and the member of staff who removed it are the only
// user links, both `ON DELETE set null`, so `gym_posts` is on
// `USER_LINKED_NOT_PURGED_TABLES`. A reaction is the person's own and is deleted with
// their account (`DIRECT_DELETE_TABLES`).
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
  },
  (t) => [
    unique("gym_posts_gym_id_uq").on(t.gymId, t.id),
    unique("gym_posts_post_key_uq").on(t.gymId, t.postKey),
    check("gym_posts_body_len_check", sql`char_length(${t.body}) <= 2000`),
    check("gym_posts_removed_not_pinned_check", sql`${t.removedAt} IS NULL OR ${t.pinnedAt} IS NULL`),
    index("gym_posts_feed_idx").on(t.gymId, t.createdAt.desc(), t.id.desc()).where(sql`${t.removedAt} IS NULL`),
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
