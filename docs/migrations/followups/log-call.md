# S8.2 call history

Add `follow_ups` after leads and settings. Each row keeps the caller's user ID, nullable member ID, active outcome chosen at write time, notes, stage and next-action snapshots, and the saved response for the request ID. The outcome's failed and site-visit flags are copied into the row so later settings edits do not change past counts.

`(company_id, by_user_id, request_id)` is unique. The API serializes that key before it changes a lead, then saves the call, lead, events, audit and response in one transaction. A replay checks current lead access and only returns the saved next lead while it remains eligible. Call rows have no application update or delete path.

Keep company RLS and composite company FKs. Grant the app role `SELECT, INSERT` on `follow_ups`; no `UPDATE` or `DELETE`. Add the generated migration and SQL grant in the integrator merge. Existing rows need no backfill.
