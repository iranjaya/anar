# S5.1: commit snapshot

No schema change. A successful check saves `snapshot` inside the existing
`import_batches.draft` JSON: `{fileSha256, schemaFingerprint, commitHash}`. The
API never returns it. S5.2 adds the frozen commit columns.
