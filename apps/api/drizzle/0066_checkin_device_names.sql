-- A check-in device's name is its own among its gym's switched-on devices (the two extra
-- passes over check-in; spec Part 3 §12.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- "Add device" pressed twice at once made two devices of one name, and the live log names
-- a visit's desk by that name. Devices already sharing a name: the oldest keeps it, and
-- each other gets the start of its own id after it, so the index builds on any database.
UPDATE "gym_checkin_devices" d
SET "name" = left(d."name", 49) || ' (' || left(d."id"::text, 8) || ')'
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "gym_id", lower("name") ORDER BY "created_at", "id") AS rn
  FROM "gym_checkin_devices"
  WHERE "switched_off_at" IS NULL
) n
WHERE n."id" = d."id" AND n.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_checkin_devices_gym_name_uq" ON "gym_checkin_devices" ("gym_id", lower("name")) WHERE "switched_off_at" IS NULL;
