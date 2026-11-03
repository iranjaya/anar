# I2: import batches, rows and mapping templates

The integrator regenerates the single initial migration from the schema files,
together with L2. No incremental migration or existing-data upgrade. A DB whose
journal already holds the old initial must be recreated.

- New `mapping_templates`, `import_batches` and `import_rows` tables in
  `schema/{mappingTemplates,imports}.ts`. Company columns and RLS policies come
  from `schema/companyRows.ts`. Unique `(company_id, id)` on templates and batches.
- mapping_templates: unique `(company_id, header_fingerprint)`, index
  `(company_id, form_name)`. `created_by` FK users, restrict.
- import_batches: `uploaded_by` FK users; composite FK `(company_id,
  mapping_template_id)` to templates. Checks on source kind, encoding, delimiter,
  status and non-negative counts. `profile` holds the CSV profile (dates as ISO
  strings), `draft` the saved mapping and preview, `preview_revision` default 0.
  Index `(company_id, created_at, id)`. S4 only writes `uploaded`.
- import_rows: composite FKs `(company_id, batch_id)` to batches and `(company_id,
  lead_id)` to leads, restrict. Unique `(batch_id, row_no)`, index `lead_id`.
  Stays empty in S4; S5 writes it.
- leads: composite FK `(company_id, import_batch_id)` to import_batches
  `(company_id, id)`, restrict (the L2 note's pending FK).
- `after.sql`: FORCE RLS on all three, revoke all from PUBLIC and anar_app, then
  `GRANT SELECT, INSERT, UPDATE`. `roles.sql`: add all three to the no-DELETE list.

Upload writes the file before the batch row. A crash between the two can leave an
unreferenced file under `uploads/imports/<companyId>/`; S14 owns cleaning names
older than 24 hours. Filesystem and DB are not one transaction.
