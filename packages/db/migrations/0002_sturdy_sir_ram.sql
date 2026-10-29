CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"hits" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts_check" CHECK ("otp_codes"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "otp_codes_purpose_session_check" CHECK ("otp_codes"."purpose" = 'login' AND "otp_codes"."session_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_live_user_idx" ON "otp_codes" USING btree ("user_id") WHERE "otp_codes"."consumed_at" IS NULL;
--> statement-breakpoint
REVOKE ALL ON TABLE public.otp_codes, public.auth_rate_limits FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.otp_codes, public.auth_rate_limits TO anar_app;
