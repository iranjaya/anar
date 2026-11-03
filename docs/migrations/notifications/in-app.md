# N1: in-app notifications

The integrator regenerates the single initial migration from the schema files.
No incremental migration or existing-data upgrade. A DB whose journal already
holds the old initial must be recreated.

- New `notifications` table in `schema/notifications.ts`. Company columns and RLS
  policies come from `schema/companyRows.ts`.
- `user_id` FK to users, restrict. No SQL FK for the identifiers inside `data`:
  the producing feature checks them in its own transaction before notify.
- Checks: type is one of the six kinds and equals `data->>'type'`; title 1-160,
  body 1-500, dedupe key 1-240 characters.
- Unique `(user_id, dedupe_key)`, so one event reaches each recipient once. Keys
  always hold the company ID, so one user in two companies gets both.
- Index `(company_id, user_id, read_at, created_at desc, id desc)` for the list
  and unread count.
- `after.sql`: `ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;`,
  revoke all from PUBLIC and anar_app, then `GRANT SELECT, INSERT, UPDATE`.

RLS is company scoped like other feature tables. The read and mark-read service
adds `user_id = current user`. Insert is not limited to the current user, because
an uploader's job notifies managers too.
