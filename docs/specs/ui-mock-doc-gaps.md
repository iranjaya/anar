# UI mock slice: doc gaps

Date: 2026-10-28. Found while writing `ui-mock-slice.md`. For the real slices, not for the mock.

Names and shapes added in `ui-mock-slice.md` that the doc should take on in the slice that makes them real:

- `requireContext()` has no company input; a user in two companies needs one. Here: `requireContext(slug)` (S1, S2).
- `getMyToday.counts`, `LeadRow`, `TeamOverview.tiles` and the per-member table columns are not defined, or do not cover what the designed screens show. Defined in `ui-mock-slice.md` section 5 (S6, S8, S11).
- `POST /api/imports` returns no lead date range; the brief asks for it. Added `dateRange` (S4).
- The doc has dry-run counts but no function, and the map page needs the upload result again after a reload. Named `dryRunImport` and `getUploadResult`; `UploadResult` also gets `proposedFields` for the new-field rows (S4).
- `dismissLostSuggestion` resets only the counter. With `lostSuggestedAt` still set, five more failed calls would never suggest again. S8 should clear both.
- Rows with a bad phone have no key, so every overlapping daily file imports them again. The mock does not show it, its import results are fixed (S5, business question 5).
- Site visits count the `Site Visit Done` outcome, per the default in business question 25 (S11).
- Quick picks for the next follow-up land at 10:00 company time; the design has no time picker (S8).

Left out of the mock on purpose, so the real slices decide them:

- The failed-call counter and when a Lost suggestion starts (S8).
- Scoring (S9). The mock carries fixed scores.
- Dedupe, phone parsing and the one-phone-column check on the mapping (S4, S5). The mock carries fixed import results.
