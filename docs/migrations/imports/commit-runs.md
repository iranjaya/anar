# S5.2: import runs and frozen commit

Regenerated into the single initial migration by the integrator. No backfill.

- New `import_runs` in `schema/imports.ts`: company columns and policies,
  composite FK `(company_id, batch_id)` to batches, `actor_user_id` FK users,
  `role`, `authorized_at`, `mapping_revision`, `state`, `failure_count` 0 to 3,
  nullable `job_id` and `stop_code`. Unique `(company_id, id)` and
  `(company_id, batch_id, run_no)`; check `run_no > 0`.
- `import_batches` adds `active_run_id` (composite FK to `import_runs`, restrict)
  and `frozen` JSON (the settings commit used; written once by S5.4).
- `import_rows` adds index `(batch_id, phone_e164)` for the earlier-phone lookup.
- `after.sql`: FORCE RLS on `import_runs`, revoke from PUBLIC and anar_app, then
  `GRANT SELECT, INSERT, UPDATE`. `roles.sql`: add `import_runs` to the no-DELETE list.

The two FKs between batches and runs form a cycle; `active_run_id` stays null
until the run row exists.
