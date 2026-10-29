# S1.8a checkpoint 2: initial acceptance

Edit schema files directly. B registers `agencyMembers` and regenerates the
single initial migration. No incremental migration is requested.

`agency_members` has agency/user/inviter foreign keys, unique `user_id` across
all statuses, unique `(agency_id,id)`, an agency/status index and an active or
deactivated status check. Enable and FORCE RLS. Grant anar_app only SELECT,
INSERT and UPDATE. The schema policies allow identity SELECT of the current
user's membership, and agency/company scope access only to the selected agency.
Identity scope cannot write. No scope cannot read. Preserve other tables' grants.

Every scope switch sets all four transaction-local settings: scope_kind,
user_id, agency_id, company_id. Unused selectors become empty strings.
`withPlatformIdentity`, `withPlatformAgency` and `withPlatformTenant` reuse the
same transaction and scope setter. `TenantScope` now requires agencyId.

Acceptance resolves the token-bound recipient, locks issuer and recipient users
in ID order, then agency and invite. A new user is inserted in the transaction
before these locks; competing inserts resolve the unique email before taking
issuer locks. It rejects inactive users, owners and any existing staff membership.
Company membership conflicts must join this check when the company schema lands.
Acceptance preserves an existing user's name and creates no session. User,
membership, agency activation, token consumption and audit commit together.

Inspect and accept share the durable auth limiter. Admission commits before the
business transaction so failed attempts count. Origin is checked first. Inspect
allows 60/IP/minute; accept allows 10/IP/hour; refusal is 429 with Retry-After.

B wiring: register auth/inviteRoutes.register with `invites`; compose
inviteAcceptance.start with connectionString, otpPepper, now and the four agency
callbacks readInitialInviteAgency, lockInitialInviteAgency, hasStaffMembership,
activateInvitedStaff. Close its DB handle with the API. Agency context helpers
stay internal until their consuming agency routes arrive.
