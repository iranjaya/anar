# S10: push endpoint bindings

The integrator regenerates the single initial migration from the schema files.
No incremental migration or existing-data upgrade.

- New platform table `push_endpoint_bindings` in `schema/pushBindings.ts`, owned
  by auth. Not company scoped: one browser endpoint may be used in several
  companies, but only by one live session at a time.
- Primary key `endpoint_hash` (lowercase SHA-256 hex of the endpoint). The
  endpoint itself is never stored here.
- `user_id` FK to users and `session_id` FK to sessions, both restrict.
  `bound_at` set on every bind, `released_at` set on logout or revoke.
- Index `session_id` for release.
- `after.sql`: revoke all from PUBLIC and anar_app, then
  `GRANT SELECT, INSERT, UPDATE`. `roles.sql` revokes DELETE and TRUNCATE.
- Only platform owners may import it (boundary check).

`bindPushEndpoint` binds in one statement: it takes the row when it is free,
already this session's, released, or held by a revoked, expired or deactivated
session. Two sessions binding at once cannot both win. Logout, revoking one
session and revoking all of a user's sessions release that session's rows.
