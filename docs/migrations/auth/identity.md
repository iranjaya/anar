# S1.1 identity migration request

Integrator B registers only `users` and `auditLog` from the new schema files in
`packages/db/src/schema/index.ts`, then generates the next migration on the accepted
snapshot. No migration numbers are reserved here.

- Prerequisite: provision `citext` in `public` using migration/bootstrap administration.
  Runtime never creates extensions. `users.email` is `citext UNIQUE`.
- Create `users` and `audit_log` from the Drizzle schema under `anar_migrate`.
  UUIDs come from the application, timestamps are `timestamptz`, and the audit actor
  FK restricts deletion. Company references wait for the S1.8 company table.
- Both tables are platform exceptions, without tenant RLS. Do not add any other
  platform exceptions until their tables arrive in their assigned slices.
- Grant `anar_app` SELECT/INSERT/UPDATE on `users`. Revoke DELETE/TRUNCATE.
  Revoke UPDATE/DELETE/TRUNCATE on `audit_log`, including the grants inherited from
  S0 default privileges; grant only SELECT/INSERT. Re-running the S0 role bootstrap
  currently re-grants UPDATE/DELETE and must preserve these restrictions.
- No user rows are inserted by migrations. Bootstrap is an explicit operator
  command using `anar_app`, `ANAR_ENV`, `DATABASE_URL`, `--environment`, `--email`
  and `--name`; no session, credential or invitation is issued.

Data impact: two new empty tables; no existing rows are rewritten. Repeat operator
bootstrap retains the existing DNA identity, name and deactivation state. An
existing non-DNA email is refused, including a concurrent conflict. A new identity
and its one `auth.bootstrap_dna` audit record commit in the same transaction.

Upgrade/rollback: no existing reader is changed. Roll back application code first;
retain identities and audit history. Do not drop populated tables as rollback.

After source review, prove on a unique disposable Postgres 17 instance, using a free
loopback port other than 3000/3001/3100: fresh install, upgrade from S0, repeated
migrate/bootstrap, concurrent operator bootstrap, non-DNA refusal, audit-insert
failure rolling back the identity, runtime audit UPDATE/DELETE denial, runtime
DDL denial, forbidden platform-import fixtures, and shared tenant transaction
rollback/context reset. Remove the disposable container afterward.
