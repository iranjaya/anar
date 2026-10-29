CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agencies_status_check" CHECK ("agencies"."status" IN ('pending', 'active', 'suspended', 'closing'))
);
--> statement-breakpoint
CREATE TABLE "agency_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"deactivated_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "agency_members_status_check" CHECK ("agency_members"."status" IN ('active', 'deactivated'))
);
--> statement-breakpoint
ALTER TABLE "agency_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid,
	"company_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_company_agency_check" CHECK ("audit_log"."company_id" IS NULL OR "audit_log"."agency_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"hits" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"company_id" uuid,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_target_check" CHECK ("invites"."role" = 'agency_staff' AND "invites"."company_id" IS NULL)
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
	CONSTRAINT "otp_codes_purpose_session_check" CHECK (("otp_codes"."purpose" = 'login' AND "otp_codes"."session_id" IS NULL) OR ("otp_codes"."purpose" = 'step_up' AND "otp_codes"."session_id" IS NOT NULL))
);
--> statement-breakpoint
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"platform_role" text,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_platform_role_check" CHECK ("users"."platform_role" IS NULL OR "users"."platform_role" = 'owner')
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agencies_created_idx" ON "agencies" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_members_agency_id_idx" ON "agency_members" USING btree ("agency_id","id");--> statement-breakpoint
CREATE INDEX "agency_members_agency_status_idx" ON "agency_members" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_agency_time_idx" ON "audit_log" USING btree ("agency_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_company_time_idx" ON "audit_log" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_time_idx" ON "audit_log" USING btree ("actor_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pending_staff_idx" ON "invites" USING btree ("agency_id","email") WHERE "invites"."accepted_at" IS NULL AND "invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_live_user_idx" ON "otp_codes" USING btree ("user_id") WHERE "otp_codes"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_owner_idx" ON "users" USING btree ((true)) WHERE "users"."platform_role" = 'owner';--> statement-breakpoint
CREATE POLICY "agency_members_select" ON "agency_members" AS PERMISSIVE FOR SELECT TO "anar_app" USING ((current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid) OR (current_setting('app.scope_kind', true) = 'identity' AND "agency_members"."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "agency_members_insert" ON "agency_members" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "agency_members_update" ON "agency_members" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid) WITH CHECK (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "agency_members_delete" ON "agency_members" AS PERMISSIVE FOR DELETE TO "anar_app" USING (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON TABLE public.users, public.otp_codes, public.auth_rate_limits, public.sessions, public.agencies, public.invites FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.users, public.otp_codes, public.auth_rate_limits, public.sessions, public.agencies, public.invites TO anar_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.audit_log TO anar_app;
--> statement-breakpoint
ALTER TABLE public.agency_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.agency_members FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.agency_members TO anar_app;
