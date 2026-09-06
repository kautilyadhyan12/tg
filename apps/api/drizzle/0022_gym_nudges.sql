-- A GYM CAN ASK A MEMBER WHO HAS STOPPED COMING TO COME BACK — the "slipping
-- away" list's one-tap nudge (Part 3 §4.1, Kd's choice of panel 2026-09-06 at
-- :36503, his rulings 2026-09-07 at :36694 and :36816). Expand-only,
-- forward-only, no backfill inside the DDL (R4.4).
--
-- Reviewed as SQL by Kd before it was applied to any database (T5, R4.4) — the
-- ordering that protects him is that no database sees it first.
--
-- **HAND-WRITTEN, for `0016`–`0021`'s recorded reason and not by preference.**
-- `drizzle/meta/` stops at `0012_snapshot.json`, so `drizzle-kit generate` diffs
-- today's schema against one ten migrations old and re-emits everything since,
-- dying on an already-existing column (42701). This is the TENTH hand-written
-- migration in a row; the snapshot debt has its own `OWED.md` line and this does
-- NOT fix it and must not be read as fixing it.
--
-- **AND ITS JOURNAL ENTRY IS PART OF THIS COMMIT** (:28221 §6): a `.sql` file
-- that `drizzle/meta/_journal.json` does not name is INVISIBLE to
-- `drizzle-kit migrate`, which then prints "migrations applied successfully"
-- having applied nothing. That failure is silent and green, so the table and its
-- CHECK are read back out of `pg_catalog` by the migration test rather than
-- trusted (:20222).

-- 1 · WHY A SECOND TABLE RATHER THAN A FIFTH PRESET ON `gym_cheers`, WHICH IS
--    THE THING THIS CARD WAS SOLD ON AND IS WRONG.
--
--    :36503 §2 bought this card on the argument that the cheer and the nudge are
--    *"ONE MECHANISM pointed opposite ways — same store, same cap, same one
--    tap"*. **The "same cap" half was already struck by :35762 the day before**,
--    and the "same store" half was inherited from the same dead premise rather
--    than re-checked — :7298's class, a sentence outliving the condition that
--    raised it.
--
--    **MEASURED BEFORE THIS FILE WAS WRITTEN, AND IT IS THREE BREAKAGES RATHER
--    THAN AN OPINION. All three readers of `gym_cheers` filter on `gym_id` and
--    `user_id` and NOTHING ELSE** — the `latestCheer` lateral, `cheerable_at` in
--    `getGymRegulars`, and the cap's own check in `sendGymCheer`. A nudge row
--    stored in that table would:
--
--      (a) BLOCK THAT DAY'S CHEER, because the cap counts rows and not kinds;
--      (b) DRAW THE CHEER BUTTON DEAD, because `cheerable_at` is set by any row;
--      (c) ARRIVE ON THE MEMBER'S My Gyms CARD AS THE LATEST CHEER, through a
--          preset code the web bundle may not know — and `orgsApi.js` treats a
--          contract mismatch as a HARD failure, so the member's whole gym list
--          would draw nothing. That is `OWED.md`'s open "a fifth cheer preset
--          would blank every member's gym list" line, walked into deliberately.
--
--    Teaching all three readers a `kind` filter instead is a change where
--    forgetting ONE is silent. **What survives of "one mechanism" is the SHAPE**
--    — store-and-show, one tap, a preset CHECK, a cap under `lockOrgRow`, an
--    audit row, one `.default(null)` field on `/v1/orgs/mine` — and that is most
--    of the work. Kd was given this as a call with its cost and one line to
--    reverse it (`CARD-gym-overview-people.md` §S2.6.2 item 1); he approved.

-- 2 · `preset` IS AN ENUM IN A CHECK, AND THAT IS THE RULING RATHER THAN A
--    DETAIL — the same argument `0021` makes, for the same reason.
--
--    Kd ruled *"an emoji plus a ready-made line, ONE TAP, no free-text box"* for
--    the cheer (:29961 ruling 4) and chose the same shape for the PACT
--    (:18128, *"no free text ever, only one-tap compliments"*). The four lines
--    here are his, approved 2026-09-07 (:36816).
--
--    **PUTTING THE FOUR NAMES IN A CHECK IS WHAT MAKES THAT RULING SURVIVE THIS
--    CARD'S AUTHOR** (:27992 §1's shape — "the ruling lives in a constraint
--    rather than in a comment"). A later writer that accepts a typed string gets
--    23514 from Postgres, loudly, on the first attempt.
--
--    **THE COLUMN STORES THE KEY AND NEVER THE SENTENCE.** The words live in the
--    web bundle, so changing the copy is a deploy and not a data migration — and
--    a stored English string would freeze the wording of every nudge ever sent,
--    in one language, for ever.
--
--    **AND NO PRESET MAY EVER CONTAIN A NUMBER OR A DATE.** *"3 weeks away!"* is
--    true the minute it is sent and false the week after, which is :7298's
--    recorded class; the "last came" figure is drawn live beside the name.

-- 3 · WHAT ENFORCES THE CAP, AND WHY IT IS NOT A UNIQUE — TRUE HERE, AND NO
--    LONGER TRUE IN `0021`, WHICH IS THE EASIEST MISTAKE ON THIS CARD.
--
--    **The nudge's cap is Part 3 §4.1's `rate-limit 1/member/7d`, which is a
--    ROLLING seven days, and no UNIQUE or CHECK in Postgres can express a
--    rolling window.** So the rule is a check inside the transaction under
--    `lockOrgRow` — this module's existing seat-claim pattern — and its guard is
--    a test plus a mutant, stated here rather than implied.
--
--    **DO NOT COPY `0021`'s CURRENT COMMENT ACROSS.** That migration argued the
--    same thing and :35762 made it obsolete *for the cheer only*, by turning the
--    cheer's cap into a CALENDAR GYM-DAY — which a stored day column plus a
--    UNIQUE could express, and `sendGymCheer`'s docblock now says so. The
--    paragraph is dead there and alive here. Read that docblock, not `0021`.
--
--    (An `EXCLUDE USING gist` over a `tstzrange` WOULD express the rolling
--    window in the database. It needs `btree_gist`, which this schema does not
--    install, and a new extension for one constraint is a dependency decision
--    nobody has asked for — R1.4. Recorded so the next reader knows it was
--    considered rather than missed. `0021` §3 recorded the same and it is the
--    same answer.)
--
--    **THE CAP'S SEVEN IS NOT THE QUIET WINDOW'S THREE.** There are THREE
--    sevens in this feature and only one number moved (:36816 §2, and it is
--    :35762's coincidence trap arriving a second time on one card): the quiet
--    WINDOW is Kd's three days, the CAP is the spec's rolling seven, and the
--    message EXPIRY is seven because it is DERIVED FROM THE CAP. Folding them
--    into one constant reverses a Kd ruling and breaks a spec limit in one edit.

-- 4 · THE TWO INDEXES, EACH FOR A NAMED READ — `0021`'s shape, because the two
--    tables are read in the same two directions.
--
--    `gym_nudges_gym_user_created_idx` serves the cap check — "has THIS gym
--    nudged THIS member inside seven days" — which runs on every send, under a
--    lock, and is the one read that must not degrade as the table grows. It also
--    serves `nudgeableAt` on the overview payload, which asks the same question
--    for every listed member at once.
--
--    `gym_nudges_user_created_idx` serves the member's own side: `/v1/orgs/mine`
--    reads the newest nudge per gym for the person asking, and that predicate
--    leads with the user.
--
--    **`ON DELETE RESTRICT` ON ALL THREE FOREIGN KEYS** — R4.3's default, and
--    what `0021` uses. It costs nothing today because gyms are soft-stated
--    (`removed_at`, `status`) and never hard-deleted. The one hard-delete path
--    in this product is the DPDP §5.2 cascade, and **this table joins
--    `USER_LINKED_NOT_PURGED_TABLES` in this same commit** — not as a courtesy
--    but because `privacy/tables.ts` runs an automated walk of every FK to
--    `users` and the suite goes red on a table that has joined neither list.
--    That guard exists because `gym_join_applications` and `gym_attendance` both
--    had to be noticed by a person, the second one a card late.
CREATE TABLE "gym_nudges" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id"          uuid NOT NULL REFERENCES "gyms"("id") ON DELETE RESTRICT,
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "sent_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "preset"          text NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "gym_nudges_preset_check" CHECK ("preset" IN (
    'miss_you', 'door_open', 'start_again', 'checking_in'
  ))
);--> statement-breakpoint
CREATE INDEX "gym_nudges_gym_user_created_idx"
  ON "gym_nudges" ("gym_id", "user_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "gym_nudges_user_created_idx"
  ON "gym_nudges" ("user_id", "created_at" DESC);
