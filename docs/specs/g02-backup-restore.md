# G0.2 backup and restore

Status: plan for review. No backup or restore has run.

Back up Postgres and pending import files together. Restore them into a new,
isolated stack and prove that history, permissions and import recovery survive.
Only disposable synthetic stacks are used during implementation and proof.

## Contracts and files

- `scripts/local-backup.ts`: coordinate quiescence, dump, uploads archive and manifest.
- `scripts/local-restore.ts`: verify an artifact and restore into an empty isolated target.
- `scripts/backup/{manifest,archive,retention}.ts`: validate metadata, safe archive paths and retention candidates.
- Matching script tests, a disposable integration harness and restored browser checks.
- `docs/local-mvp.md`: operator commands, recovery steps and measured evidence.
- u4 owns package commands, Compose overlays, runtime restart and restore grants.

Keep the spec manifest shape:
`{format:1,createdAt,sourceRevision,schemaVersion,databaseSha256,uploadsSha256,rowCounts}`.
Store no credentials or row contents in metadata. Output stays outside the repo,
with directory mode 0700 and artifact modes 0600. Publish a complete set only after
its checksums, archive listing and dump catalog verify. Refuse overwriting a set.

Restore requires a fresh `anar-restore-*` project and rejects every existing project,
container or target volume. This also rejects the source project without adding a
project name to the manifest. A failed target stays marked incomplete and cannot
be started as a successful restore.

## Flow

```diff
+ backup(output, sourceProject)
+   validate private output and named source
+   stop ingress; stop/drain API and worker
+   capture migration version and scoped table counts
+   pg_dump 17 custom format, no owner/ACL
+   archive complete uploads tree without following symlinks
+   checksum and verify both artifacts; publish manifest last
+   finally restart through the local runtime launcher, including failure/signal
+   report retention candidates and metadata-only status
+ restore(input, newProject)
+   verify manifest, checksums, dump catalog and every archive entry
+   reject absolute paths, traversal, links and occupied targets before creation
+   create isolated DB/uploads volumes with outbound delivery disabled
+   bootstrap roles; pg_restore as anar_migrate, no owner/ACL
+   reapply reviewed idempotent grants/FORCE RLS and queue grants
+   extract uploads under their original relative paths
+   compare counts, references, scores and runtime access
+   start isolated app with fake mail/push; mark verified only after checks
```

Never run table-creation migrations against restored schema. Restart after backup
must not run migrations either. Database passwords remain inside runtime container
configuration; command arguments, manifests and error reports expose no values.
Implementation tests inject command runners and temporary configuration; agents
do not read the real `.env` or real lead files.

## Slices and proof

1. Artifact validation and backup coordination, source review then tests. Test
   dump/archive failures and interruption; source services restart and the last
   verified set remains usable. No source volume is removed.
2. Isolated restore, source review then tests. Test wrong/occupied target,
   checksum mismatch, traversal and partial restore. Prove row counts and actual
   tenant relationships for leads/events/follow-ups/import rows/notifications,
   scores, sessions and encrypted queued mail; verify restricted roles and RLS.
3. Recovery drill and operator integration. Resume a synthetic import stopped at
   row 500 without duplicate ledger/events. Browser login, detail/timeline, Today
   and import report at both widths, with a unique output folder. Record restore
   duration against 60 minutes. Run the required full gate after source acceptance.

Retention computes 7 daily and 4 weekly complete sets only after a new set verifies.
The session forbids deleting data, so this slice reports candidates and preserves
all sets. Automatic pruning needs a separate explicit change to that rule.
Scheduling uses a 02:00 local job plus next-launch catch-up, with a metadata-only
last-success record and an operator warning after 24 hours. It never enters lead UI.

## Exact u4 requests

1. Add `local:backup` and `local:restore` package commands after source review.
2. Expose a local restart operation that starts existing services without migrations,
   and a scoped quiesce operation; restore prior running state on backup failure.
3. Supply an idempotent restore-grants entry, separated from CREATE TABLE migrations,
   including FORCE RLS, runtime role restrictions and queue grants.
4. Supply an isolated restore overlay with new volumes, dynamic allowed host ports,
   fake email/push and no real outbound delivery, plus the local scheduler/launch
   catch-up hook. Keep the source project and its volumes untouched.

Review focus: interruption during quiescence, files changing between dump/archive,
archive links and path containment, empty-target races, restored queues sending
real messages, and migrations accidentally running on restored schema.
