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
