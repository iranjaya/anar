# S3.1: settings reference tables and defaults

The integrator regenerates the single initial migration with L1. No incremental
migration, startup backfill or seed for existing local shells is requested.

- `schema/settings.ts` adds `fields`, `stages`, `outcomes`, `lost_reasons`,
  each with company columns and RLS from `schema/companyRows.ts`.
- Unique `(company_id, key)` on fields; `(company_id, name)` on the other three,
  archived rows included. Unique `(company_id, id)` on all four for composite FKs.
- Stages, outcomes and lost reasons have a nullable `seed_key`, unique per
  company. Custom rows keep it null. Seeding finds a renamed default by it.
- Checks: field type enum, dropdown iff options set, stage kind enum,
  nonnegative positions, a default stage is active and open. Partial unique
  index allows one default stage per company.
- `after.sql`: FORCE RLS, revoke all from PUBLIC and anar_app, then
  `GRANT SELECT, INSERT, UPDATE` to anar_app on all four tables.

`seedDefaults(tx)` inserts only missing seeds and never resets names, order,
default choice, failed flags, labels or archives. A seeded field that lost a
required code or changed type is a conflict. Company creation calls it inside
the same transaction as the company and its audit, so a failure leaves nothing.
