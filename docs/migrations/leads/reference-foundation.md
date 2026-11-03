# L1: lead storage and reference counts

The integrator regenerates the single initial migration from the schema files,
together with S3.1 settings. No incremental migration or existing-data upgrade
is requested. A DB whose journal already holds the old initial must be recreated.

- New `leads` table in `schema/leads.ts`, every domain Lead field plus
  `updated_at`. Company columns and RLS policies come from `schema/companyRows.ts`.
- Composite FKs `(company_id, x)` to stages, lost_reasons, company_members and
  leads itself (merged_into). Nullable references use normal MATCH SIMPLE.
- `import_batch_id` has no FK until L2 adds import batches.
- Indexes: live phone unique (phone set, not merged, not deleted), external_id
  partial unique, assignee/next action, stage, lead_date desc, priority, custom
  GIN `jsonb_path_ops`, full_name trigram GIN, phone prefix `text_pattern_ops`.
- `before.sql`: `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`
- `after.sql`: `ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;`, revoke all
  from PUBLIC and anar_app, then `GRANT SELECT, INSERT, UPDATE` to anar_app.

RLS needs company scope, `company_id = app.company_id` and a parent company in
`app.agency_id`. Agency, identity and missing scope see no rows.

Field and stage counts include merged and deleted rows. A field counts as used
when its custom value is present and not JSON null, so `0` and `""` count.
Open member counts skip merged/deleted leads and count only open stages; overdue
adds `next_action_at < at`. The functions refuse to run without company scope.

There is no lead write path in this slice. Proof after source review: scoped
counts, foreign composite FKs refused, zero-valued custom data, merged rows,
open/closed stages, no DELETE grant, and member removal refused with open leads.
