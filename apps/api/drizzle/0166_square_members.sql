-- Members in Square (ROADMAP Stage 2 item 18d-iii-b-ii-b-i; spec Part 3 §14.8). Forward-only. Hand-written,
-- as `0016` onwards are; its journal entry is part of this commit.
--
-- The owner puts the gym's current members into its Square customer list. One row a gym and Square
-- environment (`gym_square_member_runs`): the check the owner's press started (`run_id`), where it stands
-- (`checking` reads Square's customers a page at a time from `cursor`, to the end at `listed_at`, and decides
-- for the records on the list when it began, up to `listed_upto`; `checked` waits for the press of
-- Add for an hour; `adding`; `added`; `failed` with why), and, once members were added, `automatic`: each
-- new member is added by itself, looked for again when the gym's list moves past `list_version` or at
-- `look_due_at`. `lease_until`: whoever is working on it now, the page's own press or the worker.
--
-- While a check reads Square, the customers that share an email or a phone with a record here, or name a
-- record of this gym as their reference, are kept (`gym_square_member_candidates`), and nobody else's:
-- removed when the check has decided.
--
-- What the check decided for each record not yet in Square (`gym_square_member_plan`): `ours` (the
-- customer the app made for it before, its answer lost), `link` (Square already has them: the same email
-- or phone and the same name), `add`, or left out (`several_customers`, `several_people`); whether Square's
-- own subscriptions charge the customer it is linked to (`billed`); the record's name, email and phone as
-- the check read them (`digest`), so a record changed since is not added on an old reading (`changed`);
-- and what adding did (`done`, `changed`, or `refused` by Square).
--
-- `gym_square_customers.joined_at`: the record was linked to a customer Square already had, rather than
-- one the app made (the later job that keeps them up to date takes out of Square only what the app made).
CREATE TABLE "gym_square_member_runs" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"state" text NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"started_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"started_at" timestamp with time zone NOT NULL,
	"cursor" text,
	"looked" integer DEFAULT 0 NOT NULL,
	"listed_at" timestamp with time zone,
	"listed_upto" bigint,
	"checked_at" timestamp with time zone,
	"added_at" timestamp with time zone,
	"failure" text,
	"unanswered_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"list_version" bigint,
	"look_due_at" timestamp with time zone,
	CONSTRAINT "gym_square_member_runs_pk" PRIMARY KEY("gym_id","environment"),
	CONSTRAINT "gym_square_member_runs_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_member_runs_account_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "gym_square_member_runs_state_check" CHECK ("state" IN ('checking','checked','adding','added','failed')),
	CONSTRAINT "gym_square_member_runs_failure_check" CHECK (("state" = 'failed') = ("failure" IS NOT NULL) AND ("failure" IS NULL OR "failure" IN ('square_refused','square_unauthorized'))),
	CONSTRAINT "gym_square_member_runs_checked_check" CHECK ("state" NOT IN ('checked','adding','added') OR "checked_at" IS NOT NULL),
	CONSTRAINT "gym_square_member_runs_added_check" CHECK (NOT "automatic" OR "added_at" IS NOT NULL),
	CONSTRAINT "gym_square_member_runs_cursor_check" CHECK (("cursor" IS NULL OR char_length("cursor") BETWEEN 1 AND 2048) AND "looked" >= 0)
);
--> statement-breakpoint
CREATE INDEX "gym_square_member_runs_work_idx" ON "gym_square_member_runs" USING btree ("environment") WHERE "state" IN ('checking','adding') OR "automatic";
--> statement-breakpoint
CREATE TABLE "gym_square_member_candidates" (
	"gym_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"run_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"given_name" text,
	"family_name" text,
	"email" text,
	"phone_e164" text,
	"reference_id" text,
	CONSTRAINT "gym_square_member_candidates_pk" PRIMARY KEY("gym_id","environment","run_id","customer_id"),
	CONSTRAINT "gym_square_member_candidates_run_fk" FOREIGN KEY ("gym_id","environment") REFERENCES "gym_square_member_runs"("gym_id","environment") ON DELETE CASCADE,
	CONSTRAINT "gym_square_member_candidates_ids_check" CHECK ("customer_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "gym_square_member_candidates_text_check" CHECK (("given_name" IS NULL OR char_length("given_name") <= 300) AND ("family_name" IS NULL OR char_length("family_name") <= 300) AND ("email" IS NULL OR char_length("email") <= 320) AND ("phone_e164" IS NULL OR "phone_e164" ~ '^\+[1-9][0-9]{6,14}$') AND ("reference_id" IS NULL OR char_length("reference_id") <= 255))
);
--> statement-breakpoint
CREATE TABLE "gym_square_member_plan" (
	"gym_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"customer_id" text,
	"digest" text NOT NULL,
	"billed" boolean DEFAULT false NOT NULL,
	"looked_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"done_at" timestamp with time zone,
	CONSTRAINT "gym_square_member_plan_pk" PRIMARY KEY("gym_id","environment","entry_id"),
	CONSTRAINT "gym_square_member_plan_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "gym_member_list_entries"("gym_id","id") ON DELETE CASCADE,
	CONSTRAINT "gym_square_member_plan_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_member_plan_decision_check" CHECK ("decision" IN ('ours','link','add','several_customers','several_people') AND ("decision" IN ('ours','link')) = ("customer_id" IS NOT NULL) AND ("customer_id" IS NULL OR "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$')),
	CONSTRAINT "gym_square_member_plan_digest_check" CHECK ("digest" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "gym_square_member_plan_outcome_check" CHECK (("outcome" IS NULL) = ("done_at" IS NULL) AND ("outcome" IS NULL OR ("outcome" IN ('done','changed','refused') AND "decision" IN ('ours','link','add'))))
);
--> statement-breakpoint
CREATE INDEX "gym_square_member_plan_run_idx" ON "gym_square_member_plan" USING btree ("gym_id","environment","run_id");
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD COLUMN "joined_at" timestamp with time zone;
