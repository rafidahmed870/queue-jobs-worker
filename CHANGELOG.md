# Changelog

All notable changes to **queue-jobs-worker** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---
## [1.0.2] — 2026-09-05

### Core

### Fixed

- **`Worker` — croner added as a required dependency; invalid expressions no longer fall back to a 1-minute interval** ([#5](https://github.com/rafidahmed870/queue-jobs-worker/issues/5))

  `enqueueCronNext()` previously attempted a dynamic `import("croner")` inside
  a try/catch. If the import failed — or if the resolved `Cron` class was not a
  function — the code silently fell back to `Date.now() + 60_000`, scheduling
  the next run 60 seconds later regardless of the configured cron expression.
  The same silent fallback was also triggered for invalid cron expressions that
  caused the `Cron` constructor to throw.

  After the fix:

  - `croner` is now declared as a proper `dependency` in `package.json`
    (`^10.0.1`) and imported statically, so it is always available without any
    dynamic-import dance.
  - If the `Cron` constructor throws (invalid expression), a descriptive
    `worker:error` event is emitted and re-enqueue is skipped. The worker
    remains running.
  - If `cronInstance.nextRun()` returns `null` (the schedule has no future
    occurrences), a `worker:error` is emitted and re-enqueue is skipped. Again,
    the worker keeps running.
  - The 1-minute fallback path has been removed entirely — there is no silent
    fallback under any failure condition.

- **`Worker` — rate-limit quota no longer consumed on empty-queue polls** ([#4](https://github.com/rafidahmed870/queue-jobs-worker/issues/4))

  `claimNext()` previously called `checkAndIncrementRateLimit()` before
  attempting to claim a job. This meant every poll cycle against an empty queue
  burned a quota slot, potentially exhausting the configured window budget
  before any real work was done. After the fix, the storage `claim()` call
  happens first; the rate-limit counter is only incremented when a job is
  actually claimed for processing. If the rate limit is reached at that point
  the lock is immediately released via `releaseLock()` so the job remains
  reclaimable on the next window.

---

### Events

### Added

- `QueueEventEmitter` — strongly-typed lifecycle event bus shared across all components.
- Emits events for the full job lifecycle: enqueued, started, completed, failed, retrying, dead, stalled.
- All event payloads fully typed via `events.types.ts`.

---

<!-- Links -->
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0

### Storage

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

### Core

### Fixed

- **`Worker.stop()` — clarified `releaseLock()` behavior in shutdown comment** ([#1](https://github.com/rafidahmed870/queue-jobs-worker/issues/1))

  The inline comment in `worker.ts` now correctly explains that `releaseLock()`
  sets `lockExpiresAt` to an already-expired timestamp (not null/empty), so
  `recoverStalledJobs()` on any worker will immediately reclaim the job on the
  next stall-check cycle.

---

### Events

### Added

- `QueueEventEmitter` — strongly-typed lifecycle event bus shared across all components.
- Emits events for the full job lifecycle: enqueued, started, completed, failed, retrying, dead, stalled.
- All event payloads fully typed via `events.types.ts`.

---

<!-- Links -->

[1.0.2]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
[1.0.1]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
