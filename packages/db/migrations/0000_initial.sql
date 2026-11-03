CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
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
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"default_country" text NOT NULL,
	"timezone" text NOT NULL,
	"settings" jsonb DEFAULT '{"super_admin_can_import":false}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "companies_agency_id_idx" UNIQUE("agency_id","id"),
	CONSTRAINT "companies_status_check" CHECK ("companies"."status" IN ('active', 'suspended', 'closing')),
	CONSTRAINT "companies_country_check" CHECK ("companies"."default_country" = 'NP'),
	CONSTRAINT "companies_timezone_check" CHECK ("companies"."timezone" = 'Asia/Kathmandu')
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_job_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"job_name" text NOT NULL,
	"period_key" text NOT NULL,
	"scheduled_at" timestamp (3) with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" text NOT NULL,
	"cursor" text,
	"snapshot" jsonb,
	CONSTRAINT "company_job_periods_unique_key" UNIQUE("company_id","job_name","period_key"),
	CONSTRAINT "company_job_periods_status_check" CHECK ("company_job_periods"."status" IN ('pending', 'running', 'done'))
);
--> statement-breakpoint
ALTER TABLE "company_job_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"deactivated_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_members_company_user_key" UNIQUE("company_id","user_id"),
	CONSTRAINT "company_members_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "company_members_role_check" CHECK ("company_members"."role" IN ('super_admin', 'admin')),
	CONSTRAINT "company_members_status_check" CHECK ("company_members"."status" IN ('invited', 'active', 'deactivated'))
);
--> statement-breakpoint
ALTER TABLE "company_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"is_system" boolean NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "fields_company_key_key" UNIQUE("company_id","key"),
	CONSTRAINT "fields_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "fields_type_check" CHECK ("fields"."type" IN ('text', 'number', 'date', 'dropdown')),
	CONSTRAINT "fields_options_check" CHECK (("fields"."type" = 'dropdown') = ("fields"."options" IS NOT NULL)),
	CONSTRAINT "fields_position_check" CHECK ("fields"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid NOT NULL,
	"by_member_id" uuid,
	"by_user_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"notes" text,
	"happened_at" timestamp (3) with time zone NOT NULL,
	"next_action_at" timestamp (3) with time zone,
	"stage_before_id" uuid NOT NULL,
	"stage_after_id" uuid NOT NULL,
	"counts_as_failed" boolean NOT NULL,
	"is_site_visit" boolean NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	CONSTRAINT "follow_ups_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "follow_ups_request_key" UNIQUE("company_id","by_user_id","request_id"),
	CONSTRAINT "follow_ups_notes_length_check" CHECK (length("follow_ups"."notes") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer NOT NULL,
	"encoding" text NOT NULL,
	"delimiter" text NOT NULL,
	"row_count" integer NOT NULL,
	"status" text NOT NULL,
	"mapping_template_id" uuid,
	"mapping" jsonb,
	"last_row_no" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"error" text,
	"profile" jsonb NOT NULL,
	"draft" jsonb,
	"preview_revision" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"active_run_id" uuid,
	"frozen" jsonb,
	CONSTRAINT "import_batches_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "import_batches_source_kind_check" CHECK ("import_batches"."source_kind" = 'csv'),
	CONSTRAINT "import_batches_encoding_check" CHECK ("import_batches"."encoding" IN ('utf-8', 'utf-16le', 'utf-16be', 'windows-1252')),
	CONSTRAINT "import_batches_delimiter_check" CHECK ("import_batches"."delimiter" IN (',', E'\t', E'\x3B', '|')),
	CONSTRAINT "import_batches_status_check" CHECK ("import_batches"."status" IN ('uploaded', 'mapped', 'running', 'done', 'failed')),
	CONSTRAINT "import_batches_counts_check" CHECK ("import_batches"."file_size" >= 0 AND "import_batches"."row_count" >= 0 AND "import_batches"."last_row_no" >= 0 AND "import_batches"."preview_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb,
	"phone_e164" text,
	"result" text NOT NULL,
	"lead_id" uuid,
	"reason" text,
	"issues" jsonb NOT NULL,
	CONSTRAINT "import_rows_batch_row_key" UNIQUE("batch_id","row_no"),
	CONSTRAINT "import_rows_result_check" CHECK ("import_rows"."result" IN ('imported', 'duplicate_db', 'duplicate_file', 'invalid', 'error'))
);
--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"batch_id" uuid NOT NULL,
	"run_no" integer NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"authorized_at" timestamp (3) with time zone NOT NULL,
	"mapping_revision" integer NOT NULL,
	"state" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"job_id" uuid,
	"stop_code" text,
	CONSTRAINT "import_runs_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "import_runs_batch_run_key" UNIQUE("company_id","batch_id","run_no"),
	CONSTRAINT "import_runs_run_no_check" CHECK ("import_runs"."run_no" > 0),
	CONSTRAINT "import_runs_role_check" CHECK ("import_runs"."role" IN ('agency_staff', 'super_admin')),
	CONSTRAINT "import_runs_state_check" CHECK ("import_runs"."state" IN ('queued', 'running', 'retrying', 'stopped', 'done')),
	CONSTRAINT "import_runs_failure_count_check" CHECK ("import_runs"."failure_count" BETWEEN 0 AND 3),
	CONSTRAINT "import_runs_stop_code_check" CHECK ("import_runs"."stop_code" IN ('file_missing', 'file_changed', 'schema_changed', 'access_removed', 'processing_failed'))
);
--> statement-breakpoint
ALTER TABLE "import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_target_check" CHECK (("invites"."role" = 'agency_staff' AND "invites"."company_id" IS NULL) OR ("invites"."role" IN ('super_admin', 'admin') AND "invites"."company_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_member_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "lead_events_type_check" CHECK ("lead_events"."type" IN ('imported', 'duplicate_import', 'fields_updated', 'score_changed', 'stage_changed', 'assigned', 'unassigned', 'follow_up_logged', 'lost_suggested', 'lost_suggestion_dismissed'))
);
--> statement-breakpoint
ALTER TABLE "lead_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"full_name" text,
	"phone_e164" text,
	"phone_raw" text,
	"phone_valid" boolean NOT NULL,
	"email" text,
	"source" text,
	"source_kind" text NOT NULL,
	"external_id" text,
	"lead_date" timestamp (3) with time zone NOT NULL,
	"campaign_name" text,
	"form_name" text,
	"assigned_to" uuid,
	"stage_id" uuid NOT NULL,
	"lost_reason_id" uuid,
	"custom" jsonb NOT NULL,
	"score" integer NOT NULL,
	"priority" text NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"scored_at" timestamp (3) with time zone NOT NULL,
	"next_action_at" timestamp (3) with time zone,
	"last_contacted_at" timestamp (3) with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"lost_suggested_at" timestamp (3) with time zone,
	"import_batch_id" uuid,
	"merged_into_id" uuid,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "leads_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" IN ('facebook', 'instagram', 'event', 'web', 'other')),
	CONSTRAINT "leads_source_kind_check" CHECK ("leads"."source_kind" IN ('import', 'manual', 'api')),
	CONSTRAINT "leads_priority_check" CHECK ("leads"."priority" IN ('hot', 'warm', 'cold')),
	CONSTRAINT "leads_failed_attempts_check" CHECK ("leads"."failed_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lost_reasons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"seed_key" text,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "lost_reasons_company_name_key" UNIQUE("company_id","name"),
	CONSTRAINT "lost_reasons_company_seed_key" UNIQUE("company_id","seed_key"),
	CONSTRAINT "lost_reasons_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "lost_reasons_position_check" CHECK ("lost_reasons"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lost_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mapping_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"header_fingerprint" text NOT NULL,
	"headers" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"form_name" text,
	"campaign_name" text,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	CONSTRAINT "mapping_templates_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "mapping_templates_fingerprint_key" UNIQUE("company_id","header_fingerprint")
);
--> statement-breakpoint
ALTER TABLE "mapping_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"target_key" text NOT NULL,
	"subscription_id" uuid,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp (3) with time zone,
	"first_attempt_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"delivered_at" timestamp (3) with time zone,
	"encrypted_message" text,
	"message_hash" text,
	CONSTRAINT "notification_deliveries_target_key" UNIQUE("company_id","notification_id","channel","target_key"),
	CONSTRAINT "notification_deliveries_state_check" CHECK ("notification_deliveries"."channel" IN ('push', 'email') AND "notification_deliveries"."state" IN ('pending', 'sending', 'sent', 'skipped', 'failed', 'indeterminate') AND "notification_deliveries"."attempts" BETWEEN 0 AND 4),
	CONSTRAINT "notification_deliveries_target_check" CHECK (("notification_deliveries"."channel" = 'push' AND ("notification_deliveries"."target_key" = 'none' OR "notification_deliveries"."target_key" = "notification_deliveries"."subscription_id"::text)) OR ("notification_deliveries"."channel" = 'email' AND "notification_deliveries"."target_key" = 'email' AND "notification_deliveries"."subscription_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"data" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp (3) with time zone,
	"pushed_at" timestamp (3) with time zone,
	"emailed_at" timestamp (3) with time zone,
	CONSTRAINT "notifications_user_key" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "notifications_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('import_complete', 'assigned', 'lost_suggested', 'overdue', 'daily', 'weekly') AND "notifications"."data"->>'type' = "notifications"."type"),
	CONSTRAINT "notifications_text_check" CHECK (char_length("notifications"."title") BETWEEN 1 AND 160 AND char_length("notifications"."body") BETWEEN 1 AND 500 AND char_length("notifications"."dedupe_key") BETWEEN 1 AND 240)
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"counts_as_failed" boolean NOT NULL,
	"position" integer NOT NULL,
	"seed_key" text,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "outcomes_company_name_key" UNIQUE("company_id","name"),
	CONSTRAINT "outcomes_company_seed_key" UNIQUE("company_id","seed_key"),
	CONSTRAINT "outcomes_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "outcomes_position_check" CHECK ("outcomes"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_endpoint_bindings" (
	"endpoint_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "push_endpoint_bindings_hash_check" CHECK ("push_endpoint_bindings"."endpoint_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"endpoint_hash" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"disabled_at" timestamp (3) with time zone,
	CONSTRAINT "push_subscriptions_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "push_subscriptions_session_endpoint_key" UNIQUE("company_id","session_id","endpoint_hash"),
	CONSTRAINT "push_subscriptions_text_check" CHECK (char_length("push_subscriptions"."endpoint") BETWEEN 1 AND 1024 AND "push_subscriptions"."endpoint_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scoring_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"version" integer NOT NULL,
	"base_points" integer NOT NULL,
	"hot_min" integer NOT NULL,
	"warm_min" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "scoring_configs_company_version_key" UNIQUE("company_id","version"),
	CONSTRAINT "scoring_configs_numbers_check" CHECK ("scoring_configs"."version" >= 1 AND "scoring_configs"."base_points" >= 0 AND "scoring_configs"."warm_min" >= 0 AND "scoring_configs"."warm_min" < "scoring_configs"."hot_min"),
	CONSTRAINT "scoring_configs_rules_check" CHECK (jsonb_typeof("scoring_configs"."rules") = 'array')
);
--> statement-breakpoint
ALTER TABLE "scoring_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"is_default" boolean NOT NULL,
	"seed_key" text,
	"archived_at" timestamp (3) with time zone,
	CONSTRAINT "stages_company_name_key" UNIQUE("company_id","name"),
	CONSTRAINT "stages_company_seed_key" UNIQUE("company_id","seed_key"),
	CONSTRAINT "stages_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "stages_kind_check" CHECK ("stages"."kind" IN ('open', 'won', 'lost')),
	CONSTRAINT "stages_position_check" CHECK ("stages"."position" >= 0),
	CONSTRAINT "stages_default_check" CHECK (NOT "stages"."is_default" OR ("stages"."archived_at" IS NULL AND "stages"."kind" = 'open'))
);
--> statement-breakpoint
ALTER TABLE "stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agency_id_company_id_companies_agency_id_id_fk" FOREIGN KEY ("agency_id","company_id") REFERENCES "public"."companies"("agency_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_job_periods" ADD CONSTRAINT "company_job_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_agency_id_company_id_companies_agency_id_id_fk" FOREIGN KEY ("agency_id","company_id") REFERENCES "public"."companies"("agency_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_lead_id_leads_company_id_id_fk" FOREIGN KEY ("company_id","lead_id") REFERENCES "public"."leads"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_by_member_id_company_members_company_id_id_fk" FOREIGN KEY ("company_id","by_member_id") REFERENCES "public"."company_members"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_outcome_id_outcomes_company_id_id_fk" FOREIGN KEY ("company_id","outcome_id") REFERENCES "public"."outcomes"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_stage_before_id_stages_company_id_id_fk" FOREIGN KEY ("company_id","stage_before_id") REFERENCES "public"."stages"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_company_id_stage_after_id_stages_company_id_id_fk" FOREIGN KEY ("company_id","stage_after_id") REFERENCES "public"."stages"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_active_run_id_import_runs_company_id_id_fk" FOREIGN KEY ("company_id","active_run_id") REFERENCES "public"."import_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_mapping_template_id_mapping_templates_company_id_id_fk" FOREIGN KEY ("company_id","mapping_template_id") REFERENCES "public"."mapping_templates"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_batch_id_import_batches_company_id_id_fk" FOREIGN KEY ("company_id","batch_id") REFERENCES "public"."import_batches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_lead_id_leads_company_id_id_fk" FOREIGN KEY ("company_id","lead_id") REFERENCES "public"."leads"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_company_id_batch_id_import_batches_company_id_id_fk" FOREIGN KEY ("company_id","batch_id") REFERENCES "public"."import_batches"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_agency_id_company_id_companies_agency_id_id_fk" FOREIGN KEY ("agency_id","company_id") REFERENCES "public"."companies"("agency_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_company_id_lead_id_leads_company_id_id_fk" FOREIGN KEY ("company_id","lead_id") REFERENCES "public"."leads"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_company_id_actor_member_id_company_members_company_id_id_fk" FOREIGN KEY ("company_id","actor_member_id") REFERENCES "public"."company_members"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_stage_id_stages_company_id_id_fk" FOREIGN KEY ("company_id","stage_id") REFERENCES "public"."stages"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_lost_reason_id_lost_reasons_company_id_id_fk" FOREIGN KEY ("company_id","lost_reason_id") REFERENCES "public"."lost_reasons"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_assigned_to_company_members_company_id_id_fk" FOREIGN KEY ("company_id","assigned_to") REFERENCES "public"."company_members"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_merged_into_id_leads_company_id_id_fk" FOREIGN KEY ("company_id","merged_into_id") REFERENCES "public"."leads"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_reasons" ADD CONSTRAINT "lost_reasons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_company_id_notification_id_notifications_company_id_id_fk" FOREIGN KEY ("company_id","notification_id") REFERENCES "public"."notifications"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_company_id_subscription_id_push_subscriptions_company_id_id_fk" FOREIGN KEY ("company_id","subscription_id") REFERENCES "public"."push_subscriptions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_endpoint_bindings" ADD CONSTRAINT "push_endpoint_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_endpoint_bindings" ADD CONSTRAINT "push_endpoint_bindings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_configs" ADD CONSTRAINT "scoring_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_configs" ADD CONSTRAINT "scoring_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_company_id_companies_id_fk" FOREIGN KEY ("acting_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agencies_created_idx" ON "agencies" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_members_agency_id_idx" ON "agency_members" USING btree ("agency_id","id");--> statement-breakpoint
CREATE INDEX "agency_members_agency_status_idx" ON "agency_members" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX "agency_members_agency_created_idx" ON "agency_members" USING btree ("agency_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_agency_time_idx" ON "audit_log" USING btree ("agency_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_company_time_idx" ON "audit_log" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_time_idx" ON "audit_log" USING btree ("actor_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "companies_agency_created_idx" ON "companies" USING btree ("agency_id","created_at","id");--> statement-breakpoint
CREATE INDEX "company_job_periods_status_idx" ON "company_job_periods" USING btree ("company_id","job_name","status");--> statement-breakpoint
CREATE INDEX "company_members_user_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "follow_ups_lead_time_idx" ON "follow_ups" USING btree ("company_id","lead_id","happened_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follow_ups_member_time_idx" ON "follow_ups" USING btree ("company_id","by_member_id","happened_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "import_rows_lead_idx" ON "import_rows" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "import_rows_batch_phone_idx" ON "import_rows" USING btree ("batch_id","phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pending_staff_idx" ON "invites" USING btree ("agency_id","email") WHERE "invites"."role" = 'agency_staff' AND "invites"."accepted_at" IS NULL AND "invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pending_company_idx" ON "invites" USING btree ("company_id","email") WHERE "invites"."company_id" IS NOT NULL AND "invites"."accepted_at" IS NULL AND "invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "invites_agency_created_idx" ON "invites" USING btree ("agency_id","created_at","id");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_events_company_created_idx" ON "lead_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_live_phone_idx" ON "leads" USING btree ("company_id","phone_e164") WHERE "leads"."phone_e164" IS NOT NULL AND "leads"."merged_into_id" IS NULL AND "leads"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_id_idx" ON "leads" USING btree ("company_id","external_id") WHERE "leads"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_assignee_next_action_idx" ON "leads" USING btree ("company_id","assigned_to","next_action_at");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("company_id","stage_id");--> statement-breakpoint
CREATE INDEX "leads_lead_date_idx" ON "leads" USING btree ("company_id","lead_date" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "leads_priority_idx" ON "leads" USING btree ("company_id","priority");--> statement-breakpoint
CREATE INDEX "leads_custom_idx" ON "leads" USING gin ("custom" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "leads_name_trgm_idx" ON "leads" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "leads_phone_prefix_idx" ON "leads" USING btree ("company_id","phone_e164" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "mapping_templates_form_idx" ON "mapping_templates" USING btree ("company_id","form_name");--> statement-breakpoint
CREATE INDEX "notification_deliveries_open_idx" ON "notification_deliveries" USING btree ("company_id","notification_id","state");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("company_id","user_id","read_at","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_live_user_idx" ON "otp_codes" USING btree ("user_id") WHERE "otp_codes"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_endpoint_bindings_session_idx" ON "push_endpoint_bindings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_configs_active_idx" ON "scoring_configs" USING btree ("company_id") WHERE "scoring_configs"."active";--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_one_default_idx" ON "stages" USING btree ("company_id") WHERE "stages"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_owner_idx" ON "users" USING btree ((true)) WHERE "users"."platform_role" = 'owner';--> statement-breakpoint
CREATE POLICY "agency_members_select" ON "agency_members" AS PERMISSIVE FOR SELECT TO "anar_app" USING ((current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid) OR (current_setting('app.scope_kind', true) = 'identity' AND "agency_members"."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "agency_members_insert" ON "agency_members" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "agency_members_update" ON "agency_members" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid) WITH CHECK (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "agency_members_delete" ON "agency_members" AS PERMISSIVE FOR DELETE TO "anar_app" USING (current_setting('app.scope_kind', true) IN ('agency', 'company') AND "agency_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "companies_select" ON "companies" AS PERMISSIVE FOR SELECT TO "anar_app" USING ("companies"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND (
    current_setting('app.scope_kind', true) = 'agency' OR (
      current_setting('app.scope_kind', true) = 'company' AND "companies"."id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    )));--> statement-breakpoint
CREATE POLICY "companies_scheduler_catalog_select" ON "companies" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'scheduler_catalog'
          AND current_setting('app.actor_kind', true) = 'scheduler'
          AND "companies"."status" = 'active'
          AND EXISTS (SELECT 1 FROM public.agencies AS agency
            WHERE agency.id = "companies"."agency_id" AND agency.status = 'active'));--> statement-breakpoint
CREATE POLICY "companies_identity_select" ON "companies" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'identity' AND EXISTS (
          SELECT 1 FROM public.company_members AS member
          WHERE member.agency_id = "companies"."agency_id" AND member.company_id = "companies"."id"
          AND member.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND member.status = 'active'
        ));--> statement-breakpoint
CREATE POLICY "companies_insert" ON "companies" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK ("companies"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND (
    current_setting('app.scope_kind', true) = 'agency' OR (
      current_setting('app.scope_kind', true) = 'company' AND "companies"."id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    )));--> statement-breakpoint
CREATE POLICY "companies_update" ON "companies" AS PERMISSIVE FOR UPDATE TO "anar_app" USING ("companies"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND (
    current_setting('app.scope_kind', true) = 'agency' OR (
      current_setting('app.scope_kind', true) = 'company' AND "companies"."id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    ))) WITH CHECK ("companies"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND (
    current_setting('app.scope_kind', true) = 'agency' OR (
      current_setting('app.scope_kind', true) = 'company' AND "companies"."id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    )));--> statement-breakpoint
CREATE POLICY "companies_delete" ON "companies" AS PERMISSIVE FOR DELETE TO "anar_app" USING ("companies"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND (
    current_setting('app.scope_kind', true) = 'agency' OR (
      current_setting('app.scope_kind', true) = 'company' AND "companies"."id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    )));--> statement-breakpoint
CREATE POLICY "company_job_periods_select" ON "company_job_periods" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "company_job_periods"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "company_job_periods"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "company_job_periods_insert" ON "company_job_periods" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "company_job_periods"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "company_job_periods"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "company_job_periods_update" ON "company_job_periods" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "company_job_periods"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "company_job_periods"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "company_job_periods"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "company_job_periods"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "company_members_select" ON "company_members" AS PERMISSIVE FOR SELECT TO "anar_app" USING ((current_setting('app.scope_kind', true) = 'company' AND "company_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND "company_members"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid) OR (current_setting('app.scope_kind', true) = 'identity' AND "company_members"."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "company_members_insert" ON "company_members" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company' AND "company_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND "company_members"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "company_members_update" ON "company_members" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company' AND "company_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND "company_members"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid) WITH CHECK (current_setting('app.scope_kind', true) = 'company' AND "company_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND "company_members"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "company_members_delete" ON "company_members" AS PERMISSIVE FOR DELETE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company' AND "company_members"."agency_id" = NULLIF(current_setting('app.agency_id', true), '')::uuid AND "company_members"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fields_select" ON "fields" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "fields"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "fields"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "fields_insert" ON "fields" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "fields"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "fields"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "fields_update" ON "fields" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "fields"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "fields"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "fields"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "fields"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "follow_ups_select" ON "follow_ups" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "follow_ups"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "follow_ups"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "follow_ups_insert" ON "follow_ups" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "follow_ups"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "follow_ups"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "follow_ups_update" ON "follow_ups" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "follow_ups"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "follow_ups"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "follow_ups"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "follow_ups"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_batches_select" ON "import_batches" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "import_batches"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_batches"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_batches_insert" ON "import_batches" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "import_batches"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_batches"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_batches_update" ON "import_batches" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "import_batches"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_batches"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "import_batches"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_batches"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_rows_select" ON "import_rows" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "import_rows"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_rows"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_rows_insert" ON "import_rows" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "import_rows"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_rows"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_rows_update" ON "import_rows" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "import_rows"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_rows"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "import_rows"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_rows"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_runs_select" ON "import_runs" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "import_runs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_runs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_runs_insert" ON "import_runs" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "import_runs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_runs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "import_runs_update" ON "import_runs" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "import_runs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_runs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "import_runs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "import_runs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "lead_events_select" ON "lead_events" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "lead_events"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lead_events"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "lead_events_insert" ON "lead_events" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "lead_events"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lead_events"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "lead_events_update" ON "lead_events" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "lead_events"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lead_events"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "lead_events"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lead_events"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "leads_select" ON "leads" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "leads"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "leads"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "leads_insert" ON "leads" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "leads"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "leads"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "leads_update" ON "leads" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "leads"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "leads"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "leads"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "leads"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "lost_reasons_select" ON "lost_reasons" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "lost_reasons"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lost_reasons"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "lost_reasons_insert" ON "lost_reasons" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "lost_reasons"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lost_reasons"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "lost_reasons_update" ON "lost_reasons" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "lost_reasons"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lost_reasons"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "lost_reasons"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "lost_reasons"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "mapping_templates_select" ON "mapping_templates" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "mapping_templates"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "mapping_templates"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "mapping_templates_insert" ON "mapping_templates" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "mapping_templates"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "mapping_templates"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "mapping_templates_update" ON "mapping_templates" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "mapping_templates"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "mapping_templates"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "mapping_templates"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "mapping_templates"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "notification_deliveries_select" ON "notification_deliveries" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "notification_deliveries"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notification_deliveries"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "notification_deliveries_insert" ON "notification_deliveries" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "notification_deliveries"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notification_deliveries"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "notification_deliveries_update" ON "notification_deliveries" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "notification_deliveries"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notification_deliveries"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "notification_deliveries"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notification_deliveries"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "notifications_select" ON "notifications" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "notifications"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notifications"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "notifications_insert" ON "notifications" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "notifications"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notifications"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "notifications_update" ON "notifications" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "notifications"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notifications"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "notifications"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "notifications"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "outcomes_select" ON "outcomes" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "outcomes"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "outcomes"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "outcomes_insert" ON "outcomes" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "outcomes"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "outcomes"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "outcomes_update" ON "outcomes" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "outcomes"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "outcomes"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "outcomes"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "outcomes"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "push_subscriptions_select" ON "push_subscriptions" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "push_subscriptions"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "push_subscriptions"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "push_subscriptions_insert" ON "push_subscriptions" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "push_subscriptions"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "push_subscriptions"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "push_subscriptions_update" ON "push_subscriptions" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "push_subscriptions"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "push_subscriptions"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "push_subscriptions"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "push_subscriptions"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "scoring_configs_select" ON "scoring_configs" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "scoring_configs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "scoring_configs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "scoring_configs_insert" ON "scoring_configs" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "scoring_configs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "scoring_configs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "scoring_configs_update" ON "scoring_configs" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "scoring_configs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "scoring_configs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "scoring_configs"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "scoring_configs"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "stages_select" ON "stages" AS PERMISSIVE FOR SELECT TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "stages"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "stages"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "stages_insert" ON "stages" AS PERMISSIVE FOR INSERT TO "anar_app" WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "stages"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "stages"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));--> statement-breakpoint
CREATE POLICY "stages_update" ON "stages" AS PERMISSIVE FOR UPDATE TO "anar_app" USING (current_setting('app.scope_kind', true) = 'company'
    AND "stages"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "stages"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    )) WITH CHECK (current_setting('app.scope_kind', true) = 'company'
    AND "stages"."company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.companies AS company
      WHERE company.id = "stages"."company_id"
      AND company.agency_id = NULLIF(current_setting('app.agency_id', true), '')::uuid
    ));
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
--> statement-breakpoint
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.companies FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.companies TO anar_app;
--> statement-breakpoint
ALTER TABLE public.company_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.company_members FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.company_members TO anar_app;
--> statement-breakpoint
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.notifications TO anar_app;
--> statement-breakpoint
ALTER TABLE public.fields FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.fields FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.fields TO anar_app;
--> statement-breakpoint
ALTER TABLE public.stages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.stages FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.stages TO anar_app;
--> statement-breakpoint
ALTER TABLE public.outcomes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.outcomes FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.outcomes TO anar_app;
--> statement-breakpoint
ALTER TABLE public.lost_reasons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lost_reasons FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lost_reasons TO anar_app;
--> statement-breakpoint
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.leads FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.leads TO anar_app;
--> statement-breakpoint
ALTER TABLE public.scoring_configs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.scoring_configs FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.scoring_configs TO anar_app;
--> statement-breakpoint
ALTER TABLE public.lead_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lead_events FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lead_events TO anar_app;
--> statement-breakpoint
ALTER TABLE public.import_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.import_batches FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.import_batches TO anar_app;
--> statement-breakpoint
ALTER TABLE public.import_rows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.import_rows FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.import_rows TO anar_app;
--> statement-breakpoint
ALTER TABLE public.mapping_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.mapping_templates FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.mapping_templates TO anar_app;
--> statement-breakpoint
ALTER TABLE public.leads ADD CONSTRAINT leads_import_batch_fk FOREIGN KEY (company_id, import_batch_id) REFERENCES public.import_batches (company_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.push_subscriptions TO anar_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.push_endpoint_bindings FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.push_endpoint_bindings TO anar_app;
--> statement-breakpoint
ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.notification_deliveries FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_deliveries TO anar_app;
--> statement-breakpoint
ALTER TABLE public.import_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.import_runs FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.import_runs TO anar_app;
--> statement-breakpoint
ALTER TABLE public.follow_ups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.follow_ups FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.follow_ups TO anar_app;
--> statement-breakpoint
ALTER TABLE public.company_job_periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.company_job_periods FROM PUBLIC, anar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.company_job_periods TO anar_app;
