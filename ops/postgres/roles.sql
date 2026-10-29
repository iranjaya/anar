\getenv app_password APP_DATABASE_PASSWORD
\getenv migration_password MIGRATION_DATABASE_PASSWORD

BEGIN;

SELECT format(
  'CREATE ROLE anar_migrate LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
  :'migration_password'
) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anar_migrate')
\gexec

SELECT format(
  'CREATE ROLE anar_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
  :'app_password'
) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anar_app')
\gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database())
\gexec
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO anar_migrate', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO anar_app', current_database())
\gexec

ALTER SCHEMA public OWNER TO anar_migrate;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anar_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE anar_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE anar_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anar_app;

SELECT 'REVOKE DELETE, TRUNCATE ON TABLE public.users FROM anar_app'
WHERE to_regclass('public.users') IS NOT NULL
\gexec
SELECT format('REVOKE DELETE, TRUNCATE ON TABLE public.%I FROM anar_app', tablename)
FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('otp_codes', 'auth_rate_limits', 'sessions')
\gexec
SELECT 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM anar_app'
WHERE to_regclass('public.audit_log') IS NOT NULL
\gexec

COMMIT;
