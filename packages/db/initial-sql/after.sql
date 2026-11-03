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
