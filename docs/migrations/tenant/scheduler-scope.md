# Scheduler scopes

The worker uses `scheduler_catalog` only to list active company IDs, agency IDs, and timezones. Its companies SELECT policy also requires an active agency. Each scheduled job then opens a separate company transaction with `app.actor_kind=scheduler`, the validated agency/company IDs, and an empty `app.user_id`.

The ordinary identity, agency, and company scopes keep their user IDs. The overdue handler rechecks active company and agency status before reading tenant rows. No HTTP route exposes either scheduler scope.
