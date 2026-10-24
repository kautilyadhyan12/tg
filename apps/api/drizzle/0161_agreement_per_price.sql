-- An agreement for each line of the price list (ROADMAP Stage 2 item 18u-ii-a;
-- rulings/2026-10-23-18u-i.md). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- A business keeps its main agreement (`name` null) and may write others, each with a name of
-- its own. Each wording saved is still a row of `gym_agreements`, now numbered within its
-- agreement. A line of the price list uses the agreement it names, or the main one (null).
CREATE TABLE "gym_agreement_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gym_agreement_documents_name_check" CHECK ("name" IS NULL OR char_length("name") BETWEEN 1 AND 60),
  CONSTRAINT "gym_agreement_documents_gym_id_uq" UNIQUE ("gym_id", "id")
);--> statement-breakpoint
-- One main agreement a business, and no two others of one name.
CREATE UNIQUE INDEX "gym_agreement_documents_main_uq" ON "gym_agreement_documents" ("gym_id") WHERE "name" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_agreement_documents_name_uq" ON "gym_agreement_documents" ("gym_id", lower("name")) WHERE "name" IS NOT NULL;--> statement-breakpoint
-- Every wording saved so far is the main agreement's.
INSERT INTO "gym_agreement_documents" ("gym_id", "created_at")
SELECT "gym_id", min("saved_at") FROM "gym_agreements" GROUP BY "gym_id";--> statement-breakpoint
ALTER TABLE "gym_agreements" ADD COLUMN "document_id" uuid;--> statement-breakpoint
UPDATE "gym_agreements" a SET "document_id" = d."id"
FROM "gym_agreement_documents" d WHERE d."gym_id" = a."gym_id" AND d."name" IS NULL;--> statement-breakpoint
ALTER TABLE "gym_agreements" ALTER COLUMN "document_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_agreements" ADD CONSTRAINT "gym_agreements_document_fk" FOREIGN KEY ("gym_id", "document_id") REFERENCES "gym_agreement_documents"("gym_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gym_agreements" DROP CONSTRAINT "gym_agreements_gym_version_uq";--> statement-breakpoint
ALTER TABLE "gym_agreements" ADD CONSTRAINT "gym_agreements_document_version_uq" UNIQUE ("document_id", "version");--> statement-breakpoint
-- The line of the price list names another agreement; null is the main one.
ALTER TABLE "gym_membership_types" ADD COLUMN "agreement_document_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_agreement_fk" FOREIGN KEY ("gym_id", "agreement_document_id") REFERENCES "gym_agreement_documents"("gym_id", "id") ON DELETE SET NULL ("agreement_document_id");--> statement-breakpoint
CREATE INDEX "gym_membership_types_agreement_idx" ON "gym_membership_types" ("gym_id", "agreement_document_id") WHERE "agreement_document_id" IS NOT NULL;
