CREATE TABLE "gym_join_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp with time zone,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"member_id" uuid,
	"gym_notified_at" timestamp with time zone,
	"member_nudged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_join_applications_status_check" CHECK ("gym_join_applications"."status" IN ('pending','confirmed','rejected','cancelled','expired'))
);
--> statement-breakpoint
ALTER TABLE "gym_join_applications" ADD CONSTRAINT "gym_join_applications_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_join_applications" ADD CONSTRAINT "gym_join_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_join_applications" ADD CONSTRAINT "gym_join_applications_code_id_gym_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."gym_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_join_applications" ADD CONSTRAINT "gym_join_applications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_join_applications" ADD CONSTRAINT "gym_join_applications_member_id_gym_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_join_applications_pending_uq" ON "gym_join_applications" USING btree ("gym_id","user_id") WHERE "gym_join_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "gym_join_applications_gym_status_idx" ON "gym_join_applications" USING btree ("gym_id","status","applied_at");--> statement-breakpoint
CREATE INDEX "gym_join_applications_user_status_idx" ON "gym_join_applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "gym_join_applications_expiry_idx" ON "gym_join_applications" USING btree ("expires_at") WHERE "gym_join_applications"."status" = 'pending';