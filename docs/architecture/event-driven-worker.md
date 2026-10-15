# Event-driven background work

Normal execution waits on Redis/BullMQ. PostgreSQL remains the durable authority for business changes, outbox delivery, schedule cursors, receipts and execution fences.

- `@tabdo/db` owns generic transaction commit effects, including savepoint rollback. Effects run only after the outer commit and never turn a committed write into an HTTP failure.
- `@tabdo/queue` owns delayed transport delivery; it knows nothing about schedules or automations.
- Server business services request typed wakeups through injected dependencies. They neither import Redis nor publish inside a transaction.
- Server composition batches best-effort post-commit wakeups into a separate Redis control queue. Consumers drain durable outbox work, reconcile native completion, and arm the next schedule/outbox deadline as delayed messages.
- Startup and a low-frequency safety sweep recover notifications lost between PostgreSQL commit and Redis publication, Redis data loss, process crashes and expired claims. The default safety interval is 15 minutes, exceeding Neon's normal idle window. This is an explicit recovery-latency tradeoff, not an exactly-once or zero-database-traffic guarantee.

Schedule edits invalidate behavior through the SQL rule version/cursor; a stale Redis timer can wake a check but cannot authorize stale execution. Occurrence uniqueness, outbox claim tokens, generations and receipts remain authoritative. Redis retries and delayed outbox deadlines preserve prompt recovery during normal operation.

Validation must cover commit/rollback, wakeup failure after commit, idle query counts, delayed schedules and edits, outbox retry deadlines, startup recovery, native continuation races, duplicate messages and graceful shutdown. Real Neon/Railway acceptance remains separate from isolated local PostgreSQL/Redis tests.
