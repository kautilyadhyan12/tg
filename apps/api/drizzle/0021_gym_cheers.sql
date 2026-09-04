-- A GYM CAN CHEER A MEMBER ON (Kd ruling 2026-09-02 :29961 ruling 4, and his
-- choice of feature 2026-09-04). Expand-only, forward-only, no backfill inside
-- the DDL (R4.4).
--
-- Reviewed as SQL by Kd before anything else was written (T5, R4.4) — he was
-- shown this table and its two indexes and answered "approve".
--
-- **HAND-WRITTEN, for `0016`–`0020`'s recorded reason and not by preference.**
-- `drizzle/meta/` stops at `0012_snapshot.json`, so `drizzle-kit generate` diffs
-- today's schema against one nine migrations old and re-emits everything since,
-- dying on an already-existing column (42701). This is the NINTH hand-written
-- migration in a row; the snapshot debt has its own `OWED.md` line and this does
-- NOT fix it and must not be read as fixing it.
--
-- **AND ITS JOURNAL ENTRY IS PART OF THIS COMMIT** (:28221 §6): a `.sql` file
-- that `drizzle/meta/_journal.json` does not name is INVISIBLE to
-- `drizzle-kit migrate`, which then prints "migrations applied successfully"
-- having applied nothing. That failure is silent and green, so the table and its
-- CHECK are read back out of `pg_catalog` by the migration test rather than
-- trusted.

-- 1 · WHY A TABLE AT ALL, WHEN NOTHING IN THIS PRODUCT SENDS ANYTHING.
--
--    Kd's words: *"if some mebers comes to gym reguraly and maintains a
--    continous streak the gym can send inpiring things like emojy short message
--    etc"*.
--
--    **In this product "send" means "write something a screen will show"**
--    (:29961 §4, and it is written as a STANDING lesson there). Measured before
--    that ruling and re-measured for this card: there is no mailer, no SMTP
--    client, no push, and no notifications table anywhere in `apps/api/src`.
--    So a cheer is STORED here, the member reads it on `My Gyms` (:28822), and
--    it becomes a real notification for free when the phone app lands at
--    stage 6 with nothing rebuilt. `nudgeApplication` is the same shape already
--    in this module — a timestamp the other side's screen reads.
--
--    **A card that promised the member would be NOTIFIED would be promising a
--    channel that does not exist**, which is why §1 of the card says so in
--    plain words instead.

-- 2 · `preset` IS AN ENUM IN A CHECK, AND THAT IS THE RULING RATHER THAN A
--    DETAIL.
--
--    Kd ruled *"an emoji plus a ready-made line, ONE TAP, no free-text box"*,
--    against a "let the owner type" arm whose full cost he was shown (a length
--    cap, a rate limit, a report path for the member, and an operator view of
--    what was sent — a card of its own). It agrees with his own PACT design,
--    where he ruled *"no free text ever, only one-tap compliments"* (:18128) —
--    the second time he has chosen that shape.
--
--    **PUTTING THE FOUR NAMES IN A CHECK IS WHAT MAKES THAT RULING SURVIVE THIS
--    CARD'S AUTHOR** (:27992 §1's shape — "the ruling lives in a constraint
--    rather than in a comment"). A later writer that accepts a typed string gets
--    23514 from Postgres, loudly, on the first attempt. A comment saying "these
--    are the only four" is satisfied by anybody who does not read it.
--
--    **THE COLUMN STORES THE KEY AND NEVER THE SENTENCE.** The words live in the
--    web bundle, so fixing a typo or changing the copy is a deploy and not a
--    data migration — and a stored English string would also freeze the wording
--    of every cheer ever sent, in one language, forever.
--
--    **AND NO PRESET MAY EVER CONTAIN A NUMBER**, which is a build rule and not
--    a style note: "4 weeks!" is true the minute it is sent and false the week
--    after, and a stored sentence outliving the condition that raised it is
--    :7298's recorded class. The streak figure is drawn live beside the name.

-- 3 · WHAT ENFORCES "ONE PER MEMBER PER WEEK", AND WHY IT IS NOT A UNIQUE.
--
--    Kd ruled *"capped at one per member per week"* and Part 3 §4.1 specifies
--    the same cap for the at-risk nudge in the same breath — **`rate-limit
--    1/member/7d`** (`03-part3-org-console.md:280`). Both are ROLLING SEVEN
--    DAYS, and no UNIQUE or CHECK in Postgres can express a rolling window.
--
--    **SO THE RULE IS A CHECK INSIDE THE TRANSACTION, UNDER `lockOrgRow`** —
--    this module's existing seat-claim pattern — and its guard is a test plus a
--    mutant, stated here rather than implied. :27992's "put the ruling in a
--    constraint" applies where a constraint CAN say it; this one cannot, and
--    pretending otherwise is worse than saying so.
--
--    **THE ALTERNATIVE CONSIDERED AND REJECTED: a calendar-week UNIQUE on
--    `(gym_id, user_id, week_start)`.** It is expressible, and it is WRONG in a
--    way that looks right — a cheer late on Sunday and another on Monday morning
--    are in two calendar weeks and one day apart, so the constraint would
--    faithfully enforce a rule nobody asked for while appearing to enforce Kd's.
--
--    (An `EXCLUDE USING gist` over a `tstzrange` WOULD express the rolling
--    window in the database. It needs `btree_gist`, which this schema does not
--    install, and a new extension for one constraint is a dependency decision
--    nobody has asked for — R1.4. Recorded so the next reader knows it was
--    considered rather than missed.)

-- 4 · THE TWO INDEXES, EACH FOR A NAMED READ.
--
--    `gym_cheers_gym_user_created_idx` serves the cap check — "has THIS gym
--    cheered THIS member inside seven days" — which runs on every send, under a
--    lock, and is the one read that must not degrade as the table grows.
--
--    `gym_cheers_user_created_idx` serves the member's own side: `/v1/orgs/mine`
--    reads the newest cheer per gym for the person asking, and that predicate
--    leads with the user.
--
--    **`ON DELETE RESTRICT` ON ALL THREE FOREIGN KEYS** — R4.3's default, and
--    what Kd approved. It costs nothing today because gyms are soft-stated
--    (`removed_at`, `status`) and never hard-deleted. The one hard-delete path
--    in this product is the DPDP §5.2 cascade, and **this table joins
--    `USER_LINKED_NOT_PURGED_TABLES` in this same commit** — not as a courtesy
--    but because `privacy/tables.ts` runs an automated walk of every FK to
--    `users` and the suite goes red on a table that has joined neither list.
--    That guard exists because `gym_join_applications` and `gym_attendance` both
--    had to be noticed by a person, the second one a card late.
CREATE TABLE "gym_cheers" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id"          uuid NOT NULL REFERENCES "gyms"("id") ON DELETE RESTRICT,
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "sent_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "preset"          text NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "gym_cheers_preset_check" CHECK ("preset" IN (
    'keep_going', 'on_a_roll', 'consistency', 'strong_streak'
  ))
);--> statement-breakpoint
CREATE INDEX "gym_cheers_gym_user_created_idx"
  ON "gym_cheers" ("gym_id", "user_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "gym_cheers_user_created_idx"
  ON "gym_cheers" ("user_id", "created_at" DESC);
