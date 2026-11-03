# Append-only migrations

`0000_initial.sql`, its snapshot and its journal entry are frozen at
`f6a6723117f1275349ad96cbb033862e3013b5fe`. SHA-256 checksums and the original
journal are recorded in `frozen.json`. The journal checksum records the original
file; future migrations append entries while preserving its header and existing
entries. Never squash, regenerate, rename, reorder, remove or edit an applied
migration, its snapshot or its journal entry. Correct mistakes with another migration.

For every schema change, edit `packages/db/src/schema/`, then generate a new
numbered migration:

```sh
MIGRATION_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused pnpm --filter @anar/db generate --name=describe_change
```

Generation does not connect to Postgres. Keep the generated snapshot and appended
journal entry. Put reviewed custom SQL (grants, revokes, RLS and FORCE RLS) in that
new migration, separated with `--> statement-breakpoint`. Do not hand-edit snapshots.
`packages/db/initial-sql/` records the original extensions, custom foreign key and
permissions for fresh-schema comparison. It is no longer a squash template.

Every tenant table needs RLS, FORCE RLS and scoped SELECT/INSERT/UPDATE policies.
Company tables must check both company and agency scope. Revoke PUBLIC access and
limit `anar_app` to SELECT/INSERT/UPDATE; audit and follow-ups are append-only.
Platform `worker_heartbeats` keeps its existing DELETE grant.
Only the explicit platform list is exempt from tenant RLS. Repeated role bootstrap
must preserve these restrictions; update `ops/postgres/roles.sql` in the same change
when a new table needs restricted grants. Queue grants remain in `queueSetup.ts`.

Run `pnpm check:migrations`. It protects the frozen baseline and all migrations
already committed since the freeze, checks numbering, timestamp order and snapshot links,
and compares the latest snapshot with fresh Drizzle output. It applies the entire
history to an empty disposable Postgres 17 and compares its actual DDL with the
fresh schema, including checks, indexes, foreign keys and policies. It checks
tenant RLS and runtime grants before and after repeated role bootstrap.
Git checkouts need history back to the frozen revision so committed edits are
checked too. Source exports without Git retain the checksummed initial freeze.

Before accepting a migration, also prove fresh migration, repeated migration as a
no-op, and upgrade from the previous migration on a disposable database. Run the
DB and scripts suites, typecheck and lint serially. Use a unique container/project
name and unused ports; never reset the shared Compose stack or its volumes.
