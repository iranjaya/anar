# L2: import duplicate lookup and lead events

The integrator regenerates the single initial migration from the schema files,
paired with I2's import tables. No incremental migration or existing-data
upgrade. A DB whose journal already holds the old initial must be recreated.

- New `lead_events` table in `schema/leadEvents.ts`. Company columns and RLS
  policies come from `schema/companyRows.ts`.
- Composite FKs `(company_id, lead_id)` to leads and `(company_id,
  actor_member_id)` to company_members, restrict. `actor_user_id` FK to users,
  restrict. No cascade.
- Check: type is `imported` or `duplicate_import`. The lead owner widens it
  with each later event and its payload.
- `data` is `{batchId, rowNo}` for imported, plus `campaignName` (string or
  null) and `leadDate` (ISO UTC) for duplicate_import. `batchId` has no SQL FK.
- Indexes `(lead_id, created_at desc, id desc)` for a lead's history and
  `(company_id, created_at)`.
- `after.sql`: `ALTER TABLE public.lead_events FORCE ROW LEVEL SECURITY;`,
  revoke all from PUBLIC and anar_app, then `GRANT SELECT, INSERT, UPDATE`.
- `roles.sql`: add `lead_events` to the no-DELETE list.
- After I2 registers `import_batches`: composite FK `(company_id,
  import_batch_id)` from leads to import_batches `(company_id, id)`, restrict.

No event is written in S4. `findImportMatches` takes up to 500 distinct E.164
phones and returns live, unmerged leads of the scoped company only.
