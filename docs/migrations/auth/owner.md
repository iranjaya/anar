# S1.1a single owner correction

B generates a follow-up migration from accepted `42fa1cf`; migrations 0000 through
0003 and their snapshots stay immutable. No migration number is reserved here.

Before replacing constraints, refuse any `users.platform_role` value outside
`NULL/owner`, including legacy `dna`. Also refuse multiple existing owners. Use
fixed diagnostic text without identities or credentials. Do not promote, demote,
delete, rename or silently map any legacy privileged identity. No live row count or
legacy conversion is claimed or authorized; a failed guard needs the separate
reviewed mapping/data-change decision from spec §10.

Replace the users role check with `platform_role IS NULL OR platform_role = 'owner'`.
Add `users_single_owner_idx`, a unique constant key `(true)` where role is owner.
Include inactive owners in that index. This is the concurrent second-owner guard,
not a count-before-insert check. Ordinary users remain null-role identities.

Add nullable `audit_log.agency_id` and its `(agency_id,created_at,id)` index. Keep
historical actor roles/action text and every audit row unchanged. Actor role storage
stays text so old `dna` history is not reinterpreted as current authority. New owner
bootstrap records `auth.bootstrap_owner`, actor role owner, and null agency/company
IDs. Agency/company references and their FK checks wait for those tables.

Preserve runtime SELECT/INSERT-only audit grants, users SELECT/INSERT/UPDATE, and
existing role-bootstrap restrictions. There are no new privileges or identities
inserted by the migration. New users and their one bootstrap audit share one
runtime-role transaction. A failed audit leaves no owner behind. Same-email active
owner repeat preserves all fields and adds no audit; ordinary-user promotion,
inactive-owner repeat and different-email additional owner all return conflict.

Replace API package script `bootstrap:dna` with
`"bootstrap:owner": "node dist/modules/auth/bootstrap.js"`. Retain explicit
`ANAR_ENV`/`DATABASE_URL` and `--environment --email --name`; no HTTP bootstrap,
cookie, credential or identity output. The operator must pick a new owner email,
never an existing ordinary user's email.

Proof after source review and B integration: fresh/repeated setup, upgrade with
ordinary users and historical audit preserved, refusal/atomic rollback on legacy
privileged rows, same/different-email concurrency, direct second-owner index
refusal, ordinary-user refusal, inactive-owner refusal, environment mismatch,
silent credentials, and forced audit failure rollback. Run the existing bootstrap
proof harness and DB grants proof on unique disposable Postgres, then remove it.
Update real auth fixtures to null-role identities plus one explicit owner; demo
types/fixtures and UI stay unchanged.
