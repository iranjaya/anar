# S1.8a checkpoint 1: pending agency and first invite

Nothing is deployed. B generates one clean `0000_initial.sql` from the schema
and initial SQL. These are constraints and grants for that fresh schema, not an
incremental migration or an upgrade path.

Create `agencies` from `schema/agencies.ts` and `invites` from
`schema/platform.ts`. Both are exact platform exceptions. Agency rows contain
registry metadata only. Invites are auth-owned and reachable only through the
validated owner operation or the token/delivery reference. No company, staff
membership, acceptance or resend route is introduced in this checkpoint.

Agency status is pending/active/suspended/closing; creation always writes pending.
Slugs are globally unique. `created_by` references users with ON DELETE RESTRICT.
The `(created_at,id)` index supports descending pages of 50. Agency timestamps use
millisecond precision so the timestamp in a cursor round-trips without skipping
rows that share a creation time.

Invites have an agency FK, creator FK, unique SHA-256 token hash, expiry,
acceptance/revocation times and a partial unique `(agency_id,email)` index where
both acceptance and revocation are null. Email is citext. For this checkpoint,
`role = 'agency_staff' AND company_id IS NULL` is the enforced target check.
Company roles and the composite company FK arrive with the company schema.
Agency-member storage, its FORCE RLS and scope bridges arrive with checkpoint 2.

Add the audit agency FK and the check that company_id requires agency_id. Preserve
historical audit rows and INSERT/SELECT-only runtime access. Agency creation adds
one `agency.created` event with its initial invite ID, never a fabricated member.

Exact grants for each new table:

```sql
REVOKE ALL ON TABLE public.agencies, public.invites FROM PUBLIC, anar_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agencies, public.invites TO anar_app;
```

Do not grant DELETE, TRUNCATE, DDL, ownership or BYPASSRLS. Existing users, audit,
OTP, session and queue grants stay unchanged. B adds agencies to the platform
import allowlist and both tables to the migration/schema coverage exception list.
Agency registry access is not authority for company/member/lead reads.

Proof starts with an empty disposable database. Run the initial migration twice
to prove runner idempotence. No backfill or existing-data upgrade is required.

Creation locks the owner user/session through withPlatformSession, checks current
owner role and OTP age, then creates agency/invite/audit/job in that transaction.
A duplicate slug produces a generic conflict. Tokens are 32 random bytes, expire
after seven days and appear only in the encrypted email link `/invite#token=...`.
The delivery key is `invite:<id>:<tokenHash>` so later token replacement invalidates
queued old mail even if expiry timestamps match. Delivery rechecks pending agency,
matching agency creator, active owner issuer, unaccepted/unrevoked invite and expiry.

B wiring:

- Register `agencies` and `invites` in schema/index.ts; expose domain `./agencies`.
- Compose auth `invites.create({ publicOrigin, mailCodec, now })`, then agency
  `service.create({ sessions, createInitialInvite, now })`; register agency routes.
- Re-export `agencies.readInitialInviteAgency` through the API jobs entry and pass
  it into emailJob.start in the worker. Auth receives this narrow callback and
  never imports the agencies module.

Proof after source review: owner-only create/list; stale OTP and stale/revoked
actor; strict inputs/reserved and duplicate slugs; 50-row cursor pagination;
registry projection excludes staff email/company data. Force audit/queue failure
and verify all four writes roll back. Deliver first-staff HTML/text via Mailpit;
raw token absent from DB/audit/output. Skip expired/revoked/accepted/replaced invites,
inactive owner and nonpending agency. Re-run OTP delivery and auth regressions.
Use disposable Postgres as anar_app and remove it afterward.

Rollback: disable these routes and invite delivery before reverting application
code. Retain agency/invite/audit history; no automatic down migration drops data.
