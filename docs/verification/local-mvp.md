# G1 local MVP verification

Revision:  
Local project:  
Image versions:  
Run date:  
Commands and evidence folder:  
Browser widths: phone 390×844; desktop 1440×900.

| Proof step | Result |
| --- | --- |
| Preconditions: preceding slices accepted, Q1–Q4 decided, full integrated gates pass; record fresh commands/counts. | |
| 1. Local stack healthy; real auth, no demo actions, restricted DB role, volumes survive stop/start; worker reads uploads and queue. Record secret presence only. | |
| 2. Authorized inbox: actual OTP and daily summary with push off; verify HTML/text/link, provider ID and receipt time. | |
| 2. Restore push: summary without email fallback; Android and installed iPhone receive overdue push while closed, open link, revoke session, suppress later delivery. | |
| 3. Synthetic Meta export: upload → columns → preview → commit → report → assignment → Today → call → reminder/summary, both widths. Intercept call links. | |
| 4. Separate six-row fixture: imported 4, phone review 1, duplicate file 1, invalid structure 1, duplicate DB 0, errors 0. | |
| 4. Re-upload: 3 valid-phone DB duplicates; invalid-phone row imports again; file duplicate and invalid row remain. Changed campaign/date creates a resubmission event without editing the lead. | |
| 5. Assign, repair invalid phone, prove Admin isolation and manager history. Five failed calls create one suggestion; Keep resets; Mark Lost requires reason and removes closed lead from Today. | |
| 5. Separate 600-row import: pause after row 500, restart/resume, verify exact ledger/events and staff-entry expiry; both widths. | |
| 6. Isolated restore: source unchanged with source worker still stopped, counts/history/RLS/scores preserved, pending import resumes with fake delivery; recovery ≤60 minutes. Retain verified backup. | |
| 7. Before retained customer data: append-only migration boundary recorded and enforced; retained volumes used. | |

## Prepared input

`apps/web/e2e-auth/fixtures/meta-leads-600.csv` contains only synthetic contacts.
It has 600 data rows and the ten Meta headers in spec order: UTF-16LE BOM,
tab-separated, CRLF. Rows 1–598 have distinct synthetic phones, row 599 has an
invalid phone, and row 600 repeats row 1's phone. All emails use `example.test`.
First fresh import should produce 599 imported, 1 phone review, 1 file duplicate,
0 structural invalid rows, 0 DB duplicates and 0 errors. This is the large resume
input; the separate six-row proof above has different expected counts.

Record automated, inbox, native-device, walkthrough and restore evidence separately.
Empty results mean no proof recorded. Do not put secrets, inbox contents, backups
or real lead data in this document.
