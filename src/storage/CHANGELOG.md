# Changelog — storage

Changes to the storage module: `StorageAdapter` interface and all adapter implementations.

---

## [1.0.2] — 2026-09-05

### Fixed

- **`recoverStalledJobs()` race condition — stale recovery overwrites a live job** ([#6](https://github.com/rafidahmed870/queue-jobs-worker/issues/6))

  The previous implementation used a two-phase read-then-write pattern:

  1. A fetch pipeline read `lockExpiresAt` and `priority` for all active jobs.
  2. A separate write pipeline recovered every job whose lock appeared expired.

  Between those two phases a worker could complete the job, fail it, or renew
  its lock.  The write pipeline had no knowledge of that change and would
  unconditionally overwrite the job back to `"waiting"`, causing duplicate
  processing or data loss.

  **`RedisStorageAdapter`** — the write pipeline has been replaced with a
  per-job Lua script (`RECOVER_STALLED_LUA`) that implements a
  **compare-and-swap (CAS)** guard.  The script atomically re-reads
  `lockExpiresAt`, `lockId`, and `status` from the hash and aborts if any of
  the three values differ from what the caller observed in the read phase.
  Because Redis executes Lua scripts as a single indivisible command, no
  concurrent write can slip between the re-read and the state update.  The
  pre-filter (skip jobs whose lock has not yet expired) is preserved as an
  optimisation to avoid unnecessary Lua round-trips.

  **`InMemoryStorageAdapter`** — all operations run within a single event-loop
  tick so the race is theoretical, but an equivalent CAS guard has been added
  for consistency: `lockId` and `lockExpiresAt` are snapshotted at decision
  time and re-validated immediately before the write.  Any interleaving that
  mutated those fields will cause the recovery to be skipped.

---

## [1.0.1] — 2026-08-31

### Fixed

- **`releaseLock()` leaves jobs permanently stuck in `active` status** ([#1](https://github.com/rafidahmed870/queue-jobs-worker/issues/1))

  All four adapters were clearing `lockExpiresAt` to `null` / empty string
  while keeping `status` as `"active"`. Because `recoverStalledJobs()` requires
  a non-null, already-expired `lockExpiresAt` to match a stalled job, those
  jobs were silently skipped and could never be reclaimed or retried.

  - `InMemoryStorageAdapter.releaseLock()` — `lockExpiresAt` now set to `new Date().toISOString()` instead of `null`.
  - `RedisStorageAdapter.releaseLock()` — `lockExpiresAt` hash field now set to the current ISO timestamp instead of `""`.
  - `PostgreSQLStorageAdapter.releaseLock()` — `lock_expires_at` column now set to `NOW()` instead of `NULL`.
  - `MySQLStorageAdapter.releaseLock()` — `lock_expires_at` column now set to `NOW(3)` instead of `NULL`.

---

## [1.0.0] — 2026-08-29

### Added

- `StorageAdapter` interface — clean abstraction; all core logic talks through this interface only.
- `InMemoryStorageAdapter` — full-featured in-process adapter for development and testing.
  - Atomic job claiming inside a single event-loop tick.
  - Supports priority ordering, delayed jobs, stalled-job detection, and rate limiting.
- `RedisStorageAdapter` — adapter stub for Redis-backed persistence (peer dep: `redis >=4`).
- `PostgresStorageAdapter` — adapter stub for PostgreSQL-backed persistence (peer dep: `pg >=8`).
- `MySQLStorageAdapter` — adapter stub for MySQL-backed persistence (peer dep: `mysql2 >=3`).
- All provider-specific logic isolated behind `StorageAdapter`; core never imports adapter internals.

---

<!-- Links -->
[1.0.2]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
