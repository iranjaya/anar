# S10.3: push delivery ledger

The integrator regenerates the single initial migration from the schema files.
No incremental migration or existing-data upgrade.

- `notifications` gains unique `(company_id, id)` for the ledger FK.
- New `notification_deliveries` table in `schema/notificationDeliveries.ts`. Company
  columns and RLS policies come from `schema/companyRows.ts`.
- One row per notification, channel and target. Push targets are a subscription
  ID, or `none` when the person had no live device (recorded as skipped). Email
  targets are `email` (S10.6).
- Composite FKs `(company_id, notification_id)` to notifications and
  `(company_id, subscription_id)` to push_subscriptions, restrict.
- Checks: channel push/email, state one of six, attempts 0-4, target key matches
  the channel.
- Unique `(company_id, notification_id, channel, target_key)`, so a retry never
  adds a second row or resends a sent one.
- `after.sql`: `ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;`,
  revoke all from PUBLIC and anar_app, then `GRANT SELECT, INSERT, UPDATE`.

Rows are written only by the worker for notifications created after push is on.
Old notifications are never pushed.
