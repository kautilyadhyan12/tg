-- A person's own size and name for a cup, mug or bowl everybody has (Kd, 2026-10-30): one row for
-- each person and dish, read under the dish's fixed id, so nobody else's dish changes. No row is the
-- dish as everybody has it. Forward-only. Hand-written, as `0016` onwards are; its journal entry is
-- part of this commit.
ALTER TABLE "user_dishware" ADD COLUMN "standard_id" uuid;
CREATE UNIQUE INDEX "user_dishware_user_standard_uniq" ON "user_dishware" ("user_id", "standard_id");
