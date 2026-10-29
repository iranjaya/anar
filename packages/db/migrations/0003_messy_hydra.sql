CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text NOT NULL,
	"user_agent" text NOT NULL,
	"ip" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_otp_at" timestamp with time zone NOT NULL,
	"acting_company_id" uuid,
	"acting_reason" text,
	"acting_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_acting_check" CHECK ((
      "sessions"."acting_company_id" IS NULL AND "sessions"."acting_reason" IS NULL AND "sessions"."acting_until" IS NULL
    ) OR (
      "sessions"."acting_company_id" IS NOT NULL AND "sessions"."acting_reason" IS NOT NULL AND "sessions"."acting_until" IS NOT NULL
    ))
);
--> statement-breakpoint
ALTER TABLE "otp_codes" DROP CONSTRAINT "otp_codes_purpose_session_check";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_purpose_session_check" CHECK (("otp_codes"."purpose" = 'login' AND "otp_codes"."session_id" IS NULL) OR ("otp_codes"."purpose" = 'step_up' AND "otp_codes"."session_id" IS NOT NULL));
--> statement-breakpoint
REVOKE ALL ON TABLE public.sessions FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.sessions TO anar_app;
