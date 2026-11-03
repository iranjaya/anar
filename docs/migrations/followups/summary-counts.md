# S8.4 summary counts

The `follow_ups.is_site_visit` bit is fixed when a call is logged from the active outcome's immutable `site_visit_done` seed key. Weekly totals use that saved bit and `happened_at` inside a half-open local Monday interval, so later outcome renames or archival do not change history. Staff calls keep `by_member_id=NULL` and count in company totals and `staffCalls`, outside Admin ranking.

Bookings use saved `stage_changed` event `fromKind` and `toKind`, counting non-won to won transitions in the interval. Lead arrivals use `created_at`; overdue is a current open, assigned, active-member snapshot. The summary period stores the first calculated content before sending, so retries reuse the same counts and recipient list.

The existing `follow_ups_lead_time_idx` and `follow_ups_member_time_idx` serve lead history and member-day reads. The company-wide weekly scan uses the company RLS key and period filter; no new index is added for the initial local MVP because this periodic read has no measured large-company bottleneck. Revisit with `EXPLAIN ANALYZE` and real row counts before adding a company/time index.
