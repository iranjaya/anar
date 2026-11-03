# C2: scoring config v1

The integrator regenerates the single initial migration from the schema files.
No incremental migration or existing-data upgrade. A DB whose journal already
holds the old initial must be recreated.

- New `scoring_configs` table in `schema/scoring.ts`. Company columns and RLS
  policies come from `schema/companyRows.ts`.
- `created_by` FK to users, restrict. `rules` is a JSON array, checked by the
  domain schema on read.
- Checks: version >= 1, base >= 0, 0 <= warm_min < hot_min.
- Unique `(company_id, version)`, and one active row per company by a partial
  unique index.
- `after.sql`: FORCE RLS, revoke all from PUBLIC and anar_app, then
  `GRANT SELECT, INSERT, UPDATE`. `roles.sql` revokes DELETE and TRUNCATE.

New companies get version 1 in the same transaction as the company, after the
settings defaults: base 1, Warm 5, Hot 8, timeline 4/3/2/1 for both code sets,
budget fit Yes 3 / Maybe 2, decision maker Yes 2 / Shared 1. A repeat is a
no-op when an active config exists. Missing seeded fields or codes roll back the
company. Existing local companies are not seeded by this change.
