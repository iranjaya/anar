# S1.9: company Super Admin invites

`POST /api/companies/inviteSuperAdmin` accepts exactly `{ companyId, email,
name }` and returns `{ ok: true, data: { inviteId } }`. Own active agency staff
and fresh OTP are required. The server fixes the role to `super_admin`.
Company entry is not required. Foreign and inactive companies return the same
not-found response. Duplicate pending email returns conflict. Expired pending
invites are revoked before reissue in the same transaction.

The existing invitation issuer creates a seven-day hash-only token and uses
the existing Super Admin email template. Invite, encrypted email job and
`company.super_admin_invited` audit commit together. Delivery resolves the
stored agency/company pair and rechecks active staff, agency and company.
Company invite inspect/accept remains S1.10; this slice does not enable it.

The agency context transaction locks actor users, sessions, agency, company,
staff membership, then invitation rows. The company lock runs through the
company owner's callback before staff locking, so later membership mutations
can retain the shared lock order.

Register `companyMembers` from schema/members.ts and regenerate the single
initial migration. No incremental ALTER migration. ENABLE and FORCE RLS on
company_members; grant anar_app SELECT, INSERT and UPDATE only. Require the
agency/company composite FK, unique company/user and company/id constraints,
and the user lookup index. Normal access requires company scope with both IDs;
identity SELECT reads only the current user's memberships and never queries
companies. The companies identity SELECT policy uses active memberships.
Identity scope has no mutation policy on either table.

The invite target check permits agency_staff only without company and
super_admin/admin only with company. Preserve the composite agency/company FK.
Pending uniqueness is agency/email for staff, company/email for company roles;
both exclude accepted and revoked rows. Include company_members in migration
RLS/grant coverage, not the unscoped platform exception list.

Domain `./members` exports `dist/members.d.ts` and `dist/members.js`.
API jobs/index exports `readCompanyInviteTarget` from companies/service.ts;
worker passes it to auth email startup with `readInitialInviteAgency`.
API route/main wiring and test fixtures are handled by A.

Members owns `activateInvitedMember`, `requireActiveMember`, `hasMembership`
and `countActive`. Activation requires the caller's validated invitation,
locked users/target and company scope; existing membership rows conflict and
are never revived. The initial-staff acceptance path now checks for any
company membership under recipient identity scope. Company list summaries
use real active member counts in separate company scopes, bounded by the
50-row page. Pending invites are not members. Lead/import placeholders remain
until those owners exist; query failures are not converted to zero.

Proof after source approval: Mailpit Super Admin copy and fragment link,
hash-only persistence, expired/revoked/accepted/stale-token job skips, inactive
issuer/agency/company, foreign target, strict role/agency rejection, duplicate
and expired reissue, transaction rollback, queued actor revocation, runtime
member/identity policies and composite FKs, recipient role conflicts, and
real per-company member counts without cross-company leakage.
