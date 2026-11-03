# S10.1: push subscriptions

The integrator regenerates the single initial migration from the schema files.
No incremental migration or existing-data upgrade.

- New `push_subscriptions` table in `schema/pushSubscriptions.ts`. Company columns
  and RLS policies come from `schema/companyRows.ts`.
- `user_id` FK to users and `session_id` FK to sessions, both restrict. The
  service takes both from the current session, never from the browser.
- `endpoint` 1-1024 characters, `endpoint_hash` is lowercase SHA-256 hex.
  `p256dh`/`auth` are checked by the API before insert.
- Unique `(company_id, session_id, endpoint_hash)`: one row per browser per
  company. Same session can subscribe in several companies.
- Unique `(company_id, id)` for the S10.3 delivery FK.
- Index `(company_id, user_id)` for delivery fan-out.
- `after.sql`: `ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;`,
  revoke all from PUBLIC and anar_app, then `GRANT SELECT, INSERT, UPDATE`.

Turning a device off sets `disabled_at`; rows are never deleted. Endpoint and
keys are never returned by the API or written to logs or audit. One endpoint
belongs to one live session across companies through the auth-owned
`push_endpoint_bindings` table (`docs/migrations/auth/push-bindings.md`).
