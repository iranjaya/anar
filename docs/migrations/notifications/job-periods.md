# Company job periods

`company_job_periods` records one row per company, job name, and period key. The overdue scan stores its first run time, timezone, and local date once. Each page locks that row and commits notifications with the cursor in the same transaction. A completed period does not reopen on retries.

The table has company RLS, FORCE RLS, and SELECT/INSERT/UPDATE grants for `anar_app`. No DELETE grant is added. The unique company/job/period key is the durable admission rule; the queue singleton key only limits duplicate deliveries.
