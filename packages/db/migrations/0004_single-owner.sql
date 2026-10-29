DO $$
BEGIN
  LOCK TABLE "public"."users" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM "public"."users"
    WHERE "platform_role" IS NOT NULL AND "platform_role" <> 'owner'
  ) THEN
    RAISE EXCEPTION 'Owner migration refused: unreviewed privileged roles';
  END IF;
  IF (SELECT count(*) FROM "public"."users" WHERE "platform_role" = 'owner') > 1 THEN
    RAISE EXCEPTION 'Owner migration refused: multiple existing owners';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_platform_role_check";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_log_agency_time_idx" ON "audit_log" USING btree ("agency_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_single_owner_idx" ON "users" USING btree ((true)) WHERE "users"."platform_role" = 'owner';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_platform_role_check" CHECK ("users"."platform_role" IS NULL OR "users"."platform_role" = 'owner');
