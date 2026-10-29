-- A change to a meal sent twice is made once (ROADMAP Stage 5 item 32b-ii-a). The phone keeps a
-- change made with no signal and sends it with an id of its own until the server answers; a send
-- it gave up on may still have reached the server, and a change to a meal's foods sent again
-- would then be refused as made from an older state of them. The meal keeps the id of its last
-- change, written under the row's lock, and the same id again is answered with the meal as it is.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
ALTER TABLE "meal_logs" ADD COLUMN "last_change_id" uuid;
