BEGIN;

REVOKE ALL ON SCHEMA public, pgboss FROM PUBLIC;
GRANT USAGE ON SCHEMA public, pgboss TO anar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anar_app;

REVOKE ALL ON TABLE public.users, public.otp_codes, public.auth_rate_limits,
  public.sessions, public.agencies, public.invites, public.audit_log,
  public.agency_members, public.companies, public.company_members,
  public.notifications, public.fields, public.stages, public.outcomes,
  public.lost_reasons, public.leads, public.scoring_configs,
  public.lead_events, public.import_batches, public.import_rows,
  public.mapping_templates, public.push_subscriptions,
  public.push_endpoint_bindings, public.notification_deliveries,
  public.import_runs, public.follow_ups, public.company_job_periods
  FROM PUBLIC, anar_app;

GRANT SELECT, INSERT, UPDATE ON TABLE public.users, public.otp_codes,
  public.auth_rate_limits, public.sessions, public.agencies, public.invites,
  public.agency_members, public.companies, public.company_members,
  public.notifications, public.fields, public.stages, public.outcomes,
  public.lost_reasons, public.leads, public.scoring_configs,
  public.lead_events, public.import_batches, public.import_rows,
  public.mapping_templates, public.push_subscriptions,
  public.push_endpoint_bindings, public.notification_deliveries,
  public.import_runs, public.company_job_periods TO anar_app;
GRANT SELECT, INSERT ON TABLE public.audit_log, public.follow_ups TO anar_app;

ALTER TABLE public.agency_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fields FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lost_reasons FORCE ROW LEVEL SECURITY;
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mapping_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_job_periods FORCE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM PUBLIC, anar_app;
GRANT SELECT ON pgboss.version TO anar_app;
GRANT UPDATE (flow_on, monitor_backoff_on) ON pgboss.version TO anar_app;
GRANT SELECT, UPDATE ON pgboss.queue TO anar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  pgboss.job, pgboss.job_common, pgboss.schedule, pgboss.subscription,
  pgboss.warning, pgboss.queue_stats, pgboss.job_dependency,
  pgboss.instance TO anar_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC, anar_app;
GRANT EXECUTE ON FUNCTION pgboss.job_now() TO anar_app;

COMMIT;
