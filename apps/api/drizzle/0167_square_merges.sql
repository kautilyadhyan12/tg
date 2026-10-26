-- Square's merges followed (ROADMAP Stage 2 item 18d-iii-b-ii-b-ii-a; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Square merges customers into a new one with a new id (the business, in its Dashboard; or Square by
-- itself) and deletes the old ones. Its API answers an old id with the new customer; a payment taken before
-- keeps the old id. Square's advice: "detect customer merges and store the merged IDs" and "update your ID
-- mappings immediately" ("Duplicated customers", read 2026-10-26). `gym_square_customer_merges`: each old id
-- of a Square account and the customer it is now (a merge of a merged customer rewrites the older rows, so
-- one step always reaches the newest), so a payment taken under an old id still finds its member. Square's
-- ids, never a person's details; a Square account's, not a gym's: two gyms can share one account.
--
-- `gym_square_old_customers`: the old customer each record of a gym was, at a merge (round one, Critical 1): a
-- payment Sam took under his own old customer before Square merged it into his mum's is his, never hers; only an
-- old id no record of the gym was is read as the customer it is now. It goes with its record.
--
-- `gym_terminal_card_saves.outcome` `merged_away`: a card the Terminal saved on a customer Square merged the person
-- into, another person's, let go (round one's re-check, Low B).
--
-- `gym_member_cards.merged_away_at`: Square merged the customer a card is saved on into somebody of another name.
-- Square keeps the card there and it is still charged through that customer, but the customer says nothing of
-- whose payments are whose: a card so marked never links its customer to its record.
--
-- `gym_square_member_plan.separated_at`: Square merged this record's customer into somebody of another name
-- (Sam, added on his mum's email, merged into "Pat Smith"); he is looked at again at once and added again.
-- `merged_away`: it happened again within 30 days, so he is left out until his email or phone changes,
-- rather than added for Square to merge once more.
CREATE TABLE "gym_square_customer_merges" (
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"from_customer_id" text NOT NULL,
	"to_customer_id" text NOT NULL,
	"merged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gym_square_customer_merges_pk" PRIMARY KEY("environment","account_id","from_customer_id"),
	CONSTRAINT "gym_square_customer_merges_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_customer_merges_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "from_customer_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "to_customer_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "from_customer_id" <> "to_customer_id")
);
--> statement-breakpoint
CREATE INDEX "gym_square_customer_merges_to_idx" ON "gym_square_customer_merges" USING btree ("environment","account_id","to_customer_id");
--> statement-breakpoint
CREATE TABLE "gym_square_old_customers" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"merged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gym_square_old_customers_pk" PRIMARY KEY("gym_id","environment","account_id","customer_id","entry_id"),
	CONSTRAINT "gym_square_old_customers_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "gym_member_list_entries"("gym_id","id") ON DELETE CASCADE,
	CONSTRAINT "gym_square_old_customers_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_old_customers_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "gym_square_member_plan" ADD COLUMN "separated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "gym_member_cards" ADD COLUMN "merged_away_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "gym_square_member_plan" DROP CONSTRAINT "gym_square_member_plan_decision_check";
--> statement-breakpoint
ALTER TABLE "gym_terminal_card_saves" DROP CONSTRAINT "gym_terminal_card_saves_outcome_check";
--> statement-breakpoint
ALTER TABLE "gym_terminal_card_saves" ADD CONSTRAINT "gym_terminal_card_saves_outcome_check" CHECK (("state" IN ('agreeing','saving')) = ("outcome" IS NULL AND "finished_at" IS NULL) AND ("outcome" IS NULL OR "outcome" IN ('saved','not_agreed','cancelled_on_terminal','timed_out','no_answer','cancelled','refused','gone','merged_away')));
--> statement-breakpoint
ALTER TABLE "gym_square_member_plan" ADD CONSTRAINT "gym_square_member_plan_decision_check" CHECK ("decision" IN ('ours','link','add','several_customers','several_people','merged_away') AND ("decision" IN ('ours','link')) = ("customer_id" IS NOT NULL) AND ("customer_id" IS NULL OR "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$'));
