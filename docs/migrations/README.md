# Before the first real deployment

Sishir's 2026-10-29 rule replaces earlier follow-up/immutable migration instructions:
there are no deployed databases or real data. Keep exactly one `0000_initial.sql`
and its snapshot/journal. Writers edit schema files; the integrator regenerates
the initial migration after each accepted schema change. Do not add numbered
follow-up migrations or hand-merge snapshots.

Delete the migration files and empty metadata directory, then run:

```sh
MIGRATION_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm --filter @anar/db generate --name=initial
```

Generation does not connect to Postgres. Prepend `packages/db/initial-sql/before.sql`
and append `packages/db/initial-sql/after.sql`, separated from generated DDL by
`--> statement-breakpoint`. These files hold reviewed custom SQL: create `citext`
before its tables; grant users, OTP, limits, sessions,
agencies, invites, agency members, companies and company members only SELECT/INSERT/UPDATE; grant audit only SELECT/INSERT.
Revoke PUBLIC access. Preserve any future reviewed RLS policies and grants too.
`roles.sql` must keep restrictions after repeated bootstrap. Queue setup and its
restricted grants remain in `queueSetup.ts`; this squash does not change them.

Current schema checks, indexes and foreign keys come from Drizzle. The old
legacy-role conversion preflight is unnecessary on a fresh empty database;
the initial owner-only role check and singleton owner index enforce its invariants.
The eight original tables remain explicit platform exceptions. `agency_members`
and `companies` and `company_members` are tenant-scoped: their schemas generate scope policies and enable
RLS; custom SQL forces RLS and limits runtime grants. Tenant-table coverage excludes only the
explicit platform list and requires RLS and FORCE RLS on every remaining table.

`pnpm check:migrations` checks the working tree, accepts a regenerated initial
migration before commit, rejects additional migrations and compares fresh generated
DDL plus custom SQL and the snapshot. SQL-only changes cannot bypass this check.
Prove each accepted regeneration on an empty disposable Postgres, repeat migration
and role bootstrap, then run DB/auth proofs. Do not reset the shared Compose stack.
Before the first real deploy, replace this workflow with append-only migrations.
