# S1.2a queue setup

Pin `pg-boss@12.38.0`: Node >=22.12, public `fromDrizzle(tx, sql)` adapter,
Postgres schema version managed by the pinned package. Current Node is 24.22.1
and Drizzle is 0.45.4. S1.2a real-role proof uses
`pnpm --filter @anar/db test:integration` on disposable Postgres 17: atomic
publish/rollback, duplicate refusal, repeat setup/grants, runtime DDL denial and
runtime claim/retry/complete/maintenance. Email delivery remains S1.2b.

Setup command: `MIGRATION_DATABASE_URL=<anar_migrate URL> pnpm db:migrate`.
The migration entry runs application migrations first, then `setupQueue` under
`anar_migrate`. A session advisory lock serializes vendor setup and grants.
Vendor installation and queue creation run only here, never in the publisher.
No existing product rows are changed. No identities are seeded.

`notify.email` uses the short policy, three retries with ten-second exponential
backoff, a thirty-second active timeout, ten-minute waiting retention and one-day
completed retention. The singleton key identifies the delivery revision. A refused
duplicate publish throws so the caller cannot commit a write without a new job.
Credential expiry and validity checks belong to the auth handler in S1.3.

Runtime grants are explicit in `queueSetup.ts`: schema USAGE; version SELECT
and UPDATE of only `flow_on`/`monitor_backoff_on` for vendor maintenance;
queue SELECT/UPDATE for vendor maintenance; job/job_common, schedule,
subscription, warning, queue_stats, job_dependency and instance CRUD; only the
`job_now()` function is executable. Runtime gets no schema CREATE, queue
INSERT/DELETE, vendor DDL helpers, BAM access or TRUNCATE. PUBLIC grants are
revoked. Vendor objects remain owned by `anar_migrate`.

S1.2b must run the worker with `migrate: false`, `createSchema: false`, `schedule: false`,
`reindex: false` and `persistQueueStats: false`. Automatic reindexing requires
ownership; persisted statistics rotate partitions with DDL. Job maintenance can
still run. Index maintenance stays an explicit migration-role operation.

For the tests step: fresh/repeated setup, real `PlatformDb.transaction` commit
and rollback, runtime queue/schema DDL denial, queue retry/complete/maintenance,
and forbidden imports. Use a unique disposable Postgres 17 container and free
loopback port. Email transport, heartbeat storage and worker lifecycle are S1.2b.

## S1.2b source

The next generated migration adds only `worker_heartbeats`. No existing rows are
changed. Runtime queue startup checks `anar_app`, disables migration, scheduling,
automatic reindexing and persisted statistics, and uses the existing DB pool
foundation with five-second connect, ten-second statement and twelve-second
client query timeouts. Shutdown drains active handlers for
up to fifteen seconds before closing the pool. Queue failures stop heartbeat.

`registerJobs({ queue, jobs })` registers an explicit list. Production passes an
empty list until auth owns `notify.email` in S1.3; no test handler is exported.
Tests will inject a synthetic handler through `startWorker(signal, options)`.

Mail transport takes explicit Mailpit/Resend config and has a ten-second timeout.
Without explicit constructor config it reads `EMAIL_TRANSPORT`, `EMAIL_FROM`,
`RESEND_API_KEY` (Resend) and `MAILPIT_URL` (Mailpit). Dev selects Mailpit;
staging/production select Resend. The Resend URL override exists only on explicit
constructor config for the local HTTP test server, never in environment config.
Resend sends the delivery key as `Idempotency-Key`; no real credential is stored.
AES-256-GCM uses a separate base64-encoded 32-byte mail key, a random 12-byte nonce,
and the delivery key as authenticated data. The encoded value is nonce, tag and
ciphertext in base64url. Provider errors and job failures store only safe errors;
successful handlers store no return value. Delivery keys survive retries.

Worker integration tests exercise synthetic encrypted Mailpit delivery,
rollback, expiry, retries, restart consumption, signal shutdown, failed-start
cleanup, lock-blocked startup and periodic heartbeat failure against disposable
Postgres 17 and Mailpit v1.32.0. Crypto unit tests cover tampering and wrong keys.
S0 worker and DB tests now use the new lifecycle and heartbeat table.
Dev Mailpit uses its HTTP Send API;
the loopback UI port is configurable with `MAILPIT_HTTP_PORT`.

The separately requested Resend adapter test uses only a local loopback HTTP
server and fake credentials. It checks config selection, sender/body/auth headers,
stable idempotency key, safe failures without adapter retries and cancellation.

`pnpm test` keeps DB-backed worker cases out of unit runs; the API restart case
now runs with the DB-backed worker integration tests. `pnpm test:integration`
builds dependencies and runs the DB suite followed by the worker suite. Shared
disposable service helpers live under `test/support`, importable only by backend
tests. Synthetic handlers and queues exist only in worker tests.
