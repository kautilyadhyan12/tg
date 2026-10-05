-- Photo files still to be removed from the store (ROADMAP Stage 2 item 19b; spec Part 3
-- §15.2). A post's photo rows are deleted in the database's own step and the files after
-- it; a file that would not go was known to nobody. Its key is kept here until it has.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
CREATE TABLE "photo_files_to_remove" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "photo_files_to_remove_created_idx" ON "photo_files_to_remove" ("created_at");
