# S1.3 OTP and durable request limits

B registers `otpCodes` from `schema/platform.ts` and `authRateLimits` from
`schema/authLimits.ts`, then generates the next migration on the accepted snapshot.
No generated migration or shared schema index is changed by writer A.

Create `otp_codes` with UUIDv7 application IDs, a restrictive users FK, hash-only
codes, attempts 0..5, and one unconsumed challenge per user through the partial
unique index. This step permits only login purpose with null session ID. S1.4
adds the sessions FK and changes that check when session storage exists; S1.7
introduces session-bound step-up requests. Expired unconsumed challenges are
consumed before replacement, within the same locked-user transaction.

Create `auth_rate_limits` with hashed keys, scope, bounded `timestamptz[]` hits,
and creation/update times. Both tables are exact platform exceptions, without
tenant RLS. Grant `anar_app` SELECT/INSERT/UPDATE only, with no DELETE/TRUNCATE,
PUBLIC access, ownership, DDL or bypass privileges. Preserve these restrictions
when repeating the S0 roles bootstrap, as already done for users and audit.

Lock order is IP limiter, email limiter, then user. IP consumes at most 20 hits
per hour before any new email key is created; email consumes at most 3 per ten
minutes. A throttled email still charges the IP request. Unknown/deactivated
identities take this same limiter path. Prune at the window boundary under row
lock; rejected requests never append beyond the threshold. Challenge replacement,
limit writes and `enqueue` share one transaction, so queue failure rolls them back.

`OTP_PEPPER` is a backend-only base64 32-byte key, separate from
`MAIL_ENCRYPTION_KEY`. Configure the same stable pepper across API instances;
rotation invalidates outstanding OTP hashes and limiter keys and needs an explicit
operational decision. No raw code/token or limiter email/IP goes into queued data
or logs. Queue payload uses B's authenticated mail codec and a stable `otp:<id>`
delivery key. The worker skips expired, consumed, replaced and deactivated-user
challenges before sending through B's sender, with the same key on every retry.

Data impact: two new empty tables, no identities rewritten or backfilled. Upgrade
requires the accepted identity and transactional queue foundations. Roll back API
and worker registrations before rolling back runtime code; retain challenge/limit
storage. Never drop populated identities or audit history as rollback.

After source review: prove fresh/upgrade/repeated migration and runtime grants,
known/unknown/throttled response equality, parallel email/IP limits across two API
instances, atomic queue rollback, replacement invalidation, and worker skips at
exact expiry/after consumption or deactivation. Missing/null/hostile Origin must
produce no limiter, challenge or queue write. Use isolated Postgres/Mailpit and
remove all disposable services afterward.
