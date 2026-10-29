# S1.4 OTP verification and sessions

B registers `sessions` from `schema/platform.ts`, then generates a separate session
migration after the approved S1.3 OTP/limits migration. This working schema includes
S1.4 source now; do not fold sessions or its FK into the S1.3 migration or proof.

Create `sessions` with UUIDv7 application IDs, hash-only unique session tokens,
restrictive users FK, user/expiry indexes, and `timestamptz` session/OTP times. Acting
fields are all null or all present. The company FK waits until S1.8. Add the
`otp_codes.session_id` FK to sessions and replace the login-only purpose check with
login/null-session or step_up/non-null-session consistency. No step-up endpoint or
refresh behavior is introduced in S1.4.

Treat sessions as an exact platform exception. Grant runtime SELECT/INSERT/UPDATE
only, with no DELETE/TRUNCATE, PUBLIC access, ownership, DDL or bypass privilege.
Preserve those restrictions when repeating roles bootstrap. Existing identity,
audit and OTP/limit grants remain required.

Data impact: one new empty table, one nullable FK and a purpose-check change. No
identities, OTP hashes or timestamps are backfilled. Existing S1.3 login challenges
remain valid and session IDs are already null. Roll back the verification route
before runtime code; retain stored session and OTP history.

Lock order for login is user then challenge; session insertion shares that
transaction. Wrong attempts commit before returning unauthorized. The fifth wrong
attempt consumes the challenge, including concurrent requests; a correct replay
cannot create another session. A failed session insertion rolls back consumption.
Platform mutations lock user then session and pass fresh DB state to their callback;
role/permission/freshness checks must use that current state in their own slices.

Session tokens are 32 random bytes, base64url in the cookie and SHA-256 hex in DB.
`SessionIssue` remains backend-only: `{ cookie, redirectTo: '/workspaces' }`; only
`{ redirectTo }` enters the HTTP success payload. The cookie is host-only, Path=/,
HttpOnly, SameSite=Lax. Transport is explicit `{ protocol: 'https' }` or
`{ protocol: 'http', local: true }`; request Host/proto never chooses Secure.
Stored expiry is rounded to seconds to match the Expires header, 30 days after the
login time. Reads do not renew it. Company-aware redirect selection comes in S1.11.

After source review: prove five wrong attempts and sixth/correct refusal, exact
expiry, replay and concurrent success, wrong-purpose rejection, inactive users,
hash-only storage and cookie flags in both allowed transports. Prove stale session
rejection after revoke/deactivation and locked platform revalidation with fresh
role/OTP state. Force session-insert failure to check challenge rollback. Invalid
Origin must fail before all writes. Use a unique disposable Postgres and remove it.
