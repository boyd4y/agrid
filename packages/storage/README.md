# @tabdo/storage

File storage contracts and implementations for local development and Railway.

- `@tabdo/storage`: object-key validation and byte-storage contract.
- `@tabdo/storage/local`: local directory storage.
- `@tabdo/storage/s3`: S3-compatible object storage with explicit credentials/config.

The backend owns permissions, upload metadata and file references. Providers only
write, read and remove object bytes. Railway API/worker instances should share an
S3 bucket; a local directory is not a shared volume between services.

Run `pnpm --filter @tabdo/storage test` for key validation and real temporary-file
coverage. No default test accesses a remote bucket or user uploads.
