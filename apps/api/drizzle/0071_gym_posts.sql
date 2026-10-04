-- A gym's Updates (ROADMAP Stage 2 item 19b-i; spec Part 3 §15.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A post by the gym's staff. `post_key` is the browser's key for it: sent twice, one post.
-- A removed post keeps its row with who removed it; its photos and reactions are deleted.
CREATE TABLE "gym_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"post_key" uuid NOT NULL,
	"body" text NOT NULL,
	"pinned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	CONSTRAINT "gym_posts_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_posts_post_key_uq" UNIQUE ("gym_id", "post_key"),
	CONSTRAINT "gym_posts_body_len_check" CHECK (char_length("body") <= 2000),
	CONSTRAINT "gym_posts_removed_not_pinned_check" CHECK ("removed_at" IS NULL OR "pinned_at" IS NULL)
);--> statement-breakpoint
CREATE INDEX "gym_posts_feed_idx" ON "gym_posts" ("gym_id", "created_at" DESC, "id" DESC) WHERE "removed_at" IS NULL;--> statement-breakpoint

-- A post's photos, in the order shown; the file is in the photo store under `storage_key`.
-- The same limits as `gym_page_photos`.
CREATE TABLE "gym_post_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"post_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_post_photos_post_fk" FOREIGN KEY ("gym_id", "post_id") REFERENCES "gym_posts" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_post_photos_storage_key_uq" UNIQUE ("storage_key"),
	CONSTRAINT "gym_post_photos_position_uq" UNIQUE ("post_id", "position"),
	CONSTRAINT "gym_post_photos_type_check" CHECK ("content_type" IN ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "gym_post_photos_size_check" CHECK ("byte_size" BETWEEN 1 AND 2097152),
	CONSTRAINT "gym_post_photos_width_check" CHECK ("width" BETWEEN 1 AND 8000),
	CONSTRAINT "gym_post_photos_height_check" CHECK ("height" BETWEEN 1 AND 8000),
	CONSTRAINT "gym_post_photos_position_check" CHECK ("position" BETWEEN 0 AND 3)
);--> statement-breakpoint

-- One reaction a person a post.
CREATE TABLE "gym_post_reactions" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_post_reactions_pk" PRIMARY KEY ("post_id", "user_id"),
	CONSTRAINT "gym_post_reactions_post_fk" FOREIGN KEY ("gym_id", "post_id") REFERENCES "gym_posts" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_post_reactions_reaction_check" CHECK ("reaction" IN ('like','love','strong','fire'))
);--> statement-breakpoint
CREATE INDEX "gym_post_reactions_user_idx" ON "gym_post_reactions" ("user_id");--> statement-breakpoint

-- A fourteenth privilege, `posts.manage`: owner and manager by default, and the owner can
-- tick it for a trainer. The list below is `ORG_PRIVILEGES` in `@app/shared`, and
-- `db.migration.test.ts` reads the deployed predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark','leaderboard.manage','memberships.manage','posts.manage']::text[]);--> statement-breakpoint

-- Every owner and manager row holding its own ticks gets it, as `0069` did for
-- `memberships.manage`. A trainer's row, a NULL set (which reads the role's defaults), and a
-- person on one of the gym's own roles (whose ticks the owner chose) are left alone.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'posts.manage')
WHERE "privileges" IS NOT NULL
  AND "role" IN ('owner','manager')
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['posts.manage']::text[]);--> statement-breakpoint

-- A manager's invitation still waiting gets it too. A gym's own saved roles, and an
-- invitation to one of them, are left alone: their ticks are the owner's own choice.
UPDATE "gym_staff_invites"
SET "privileges" = array_append("privileges", 'posts.manage')
WHERE "state" = 'pending'
  AND "role" = 'manager'
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['posts.manage']::text[]);
