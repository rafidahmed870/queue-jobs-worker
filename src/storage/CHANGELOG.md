# Changelog — storage

Changes to the storage module: `StorageAdapter` interface and all adapter implementations.

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
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
