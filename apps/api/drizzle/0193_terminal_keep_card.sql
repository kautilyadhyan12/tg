-- The card kept from a Terminal payment (ROADMAP 18d-vi-c): the person agrees on the Terminal, pays, and the card is kept from that payment.
ALTER TABLE "gym_terminal_payments" ADD COLUMN "card_words" text;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "card_step" text;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "confirm_key" uuid;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "confirm_action_id" text;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "card_answered_at" timestamp with time zone;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "card_key" uuid;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "card_brand" text;
ALTER TABLE "gym_terminal_payments" ADD COLUMN "card_last4" text;
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_card_check" CHECK (("card_step" IS NULL) = ("card_words" IS NULL) AND ("card_step" IS NULL OR "card_step" IN ('agreeing','paying','declined','keeping','saved','not_saved','square_refused')));
CREATE INDEX "gym_terminal_payments_keeping_idx" ON "gym_terminal_payments" USING btree ("checked_at") WHERE "card_step" = 'keeping';
-- The membership a card was kept for, and room for the membership's line above the card agreement.
ALTER TABLE "gym_card_agreements" ADD COLUMN "held_membership_id" uuid;
ALTER TABLE "gym_card_agreements" DROP CONSTRAINT "gym_card_agreements_words_check";
ALTER TABLE "gym_card_agreements" ADD CONSTRAINT "gym_card_agreements_words_check" CHECK (char_length("words") BETWEEN 20 AND 1000);
CREATE INDEX "gym_card_agreements_membership_idx" ON "gym_card_agreements" USING btree ("gym_id","held_membership_id") WHERE "held_membership_id" IS NOT NULL;
