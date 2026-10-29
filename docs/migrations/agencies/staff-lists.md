# S1.8b checkpoint 1: own-agency lists

B regenerates the single initial migration from the schema files. No incremental
migration or existing-data upgrade is requested.

- `invites.created_at` uses precision 3 so its ISO cursor preserves exact time.
- Add `(agency_id,created_at,id)` indexes to invites and agency_members for the
  descending, 50-row staff and pending-invite pages.
- Keep existing agency_members FORCE RLS, policies and grants unchanged.

Reads resolve the current agency through the session and own membership, then
lock/recheck session, agency and membership in the existing context transaction.
Staff rows are agency-scoped before auth receives their user IDs for names/emails.
Invites are filtered by that agency, agency_staff role, company null and both
accepted/revoked null. Expired invitations remain visible for later resend.
Neither read uses browser-supplied agency IDs, exposes token hashes or grants
owner access. Staff pages include both active and deactivated memberships.

Wire contracts live in domain/agencies.ts. Permission names live in context.ts;
the Permission type is also re-exported through the existing agencies entry.
This checkpoint advertises agency.staff.list and sessions.manage_own only.
Invite/resend capabilities join the table when their endpoints are implemented.

Proof after source review: two agencies, equal-time pagination, no identity or
token leaks, expired/revoked/accepted invitation visibility, inactive agency or
membership and stale context denial, owner/ordinary-user denial, strict query
selectors, and same-transaction identity projection. The compiled API must serve
the registered routes. No S1.8b proof has run at this source stop.
