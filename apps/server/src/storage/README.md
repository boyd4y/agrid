File lifecycle operations
=========================

Apply additive migration `0026_storage_gc_jobs` before starting this version.
The API runs `runFileGcOnce({ limit: 100 })` every 30 seconds, without overlapping
sweeps. Other entrypoints can call this exported function; deployments without
an API process must schedule it themselves. Failed removals retry after 60
seconds. Missing objects succeed. Completed jobs are retained for audit; ops
should periodically prune old `status = 'done'` rows.

Upload settings (bytes are integers):

- FILE_UPLOAD_MAX_CONCURRENT: 4 per API process.
- FILE_UPLOAD_MAX_CONCURRENT_PER_ORG: 2 per org per API process.
- FILE_STORAGE_ORG_QUOTA_BYTES: 1073741824; 0 disables quota.
- FILE_GC_GRACE_SECONDS: 60 for application journal entries.
- Existing FILE_UPLOAD_MAX_BYTES / FILE_UPLOAD_MAX_FILES /
  FILE_UPLOAD_MAX_REQUEST_BYTES remain enforced (25 MiB / 20 / 100 MiB).

Permits are acquired before body parsing and released idempotently. Multipart
parsing still materializes bounded File objects in memory; the counting stream
avoids accumulating and concatenating a second request buffer. Each Blob is
streamed to storage. Concurrency limits are process-local, so total parsing
memory grows with replicas. Quota checks and storage writes/metadata commits
serialize per org across processes via a PostgreSQL advisory transaction lock.
This holds a DB connection and table lock during storage I/O; monitor slow
storage and tune request timeouts/pool capacity accordingly.

A separately committed intent precedes every storage write. GC and uploads
share the org lock, and uploads verify their intent is still pending after
acquiring it. If GC swept a request waiting longer than the grace period, that
request fails before put and can be retried. Crash/insert-failure intents remain
collectible. GC skips live driver+key references. Column/table commands journal
in their deletion transaction; a BEFORE DELETE trigger also journals metadata
cascades, including Better Auth organization deletion (fixed 60-second grace).
Jobs have no organization foreign key and survive tenant deletion. Duplicate
jobs from command and trigger are harmless because removal is idempotent.

Storage locations are not versioned. Keep old local paths/S3 buckets and
credentials configured until their objects and jobs have drained; changing a
bucket or directory for the same driver can strand old blobs or address a new
location. Blobs orphaned before this migration are not discoverable from the
journal and still require a storage inventory reconciliation. No arbitrary
bucket/directory scan is performed. All writers must use this upload path and
its lock to preserve the ref-check race guarantee.
