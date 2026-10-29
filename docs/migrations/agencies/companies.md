# S1.8c: own-agency company shells

B registers `companies` from schema/platform.ts and regenerates the single
initial migration. No incremental migration or existing-data upgrade.

Companies have a required agency FK, global unique slug, unique `(agency_id,id)`
and `(agency_id,created_at,id)` list index. Timestamp precision is 3 so cursors
round-trip. Status is active/suspended/closing; country NP and timezone
Asia/Kathmandu are checked. Initial settings contain only
`super_admin_can_import: false`. No settings/scoring/member rows are created.

Enable and FORCE RLS. The schema policies permit agency scope only for matching
agency_id, and company scope only when both agency_id and company ID match.
Identity and absent scope deny all company access. S1.9 adds identity SELECT
with company_members; do not add that arm before its table exists.

Grant anar_app SELECT, INSERT and UPDATE only. Do not put companies in the
unscoped platform exception list. Add it to tenant-table migration coverage.
Keep table ownership with anar_migrate and preserve existing grants/policies.

Add the session acting_company_id FK to companies.id. Invites and audit_log use
composite `(agency_id,company_id)` FKs to companies. Keep the current staff-only
invite role check until S1.9; company_id stays null for staff invitations.

Company creation derives agency_id from the locked current agency context.
Fresh OTP, company insert and audit occur in one transaction. The API supplies
no agency-update operation. Global slug conflicts use a generic response.

The named listSummaries query filters by authorized agency before pagination.
Member/lead counts are zero and lastImportAt null while their tables do not
exist. S1.9/S3/S4 must replace these projections before those product writes
are enabled. Query errors are never converted to empty lists or zero counts.

B also exposes domain `./companies` with `types: ./dist/companies.d.ts` and
`default: ./dist/companies.js`. App/main wiring is already handled by A.

Proof after source approval: agency isolation and company-scope pair checks,
missing/identity scope refusal, owner/ordinary/inactive/stale staff denial,
strict input and slug conflict handling, equal-time pagination, atomic audit
rollback, exact settings default and composite FKs. Update existing acting
session fixtures to reference real companies before rerunning auth proofs.
