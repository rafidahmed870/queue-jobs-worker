# Changelog — core

Changes to the core module: `QueueClient`, `Queue`, `Job`, `Worker`, `backoff`, and `id` utilities.

---

## [1.0.2] — 2026-09-05

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

## [1.0.1] — 2026-08-31

### Fixed

- **`Worker.stop()` — clarified `releaseLock()` behavior in shutdown comment** ([#1](https://github.com/rafidahmed870/queue-jobs-worker/issues/1))

  The inline comment in `worker.ts` now correctly explains that `releaseLock()`
  sets `lockExpiresAt` to an already-expired timestamp (not null/empty), so
  `recoverStalledJobs()` on any worker will immediately reclaim the job on the
  next stall-check cycle.

---

## [1.0.0] — 2026-08-29

### Added

- `QueueClient` — primary entry point; configures storage, exposes queues, and coordinates lifecycle.
  - `QueueClient.withAdapter()` static factory for supplying a custom storage adapter.
  - Layered configuration: Client defaults → Queue options → Worker options → Job options.
- `Queue` — independent job stream with per-queue configuration overrides.
- `Job` — rich wrapper around the raw job data record; passed to user processors.
- `Worker` — claims and executes jobs with configurable concurrency and graceful shutdown.
  - Per-worker concurrency limit (`concurrency`).
  - Atomic job claiming delegated to `StorageAdapter`.
- Stable job identity preserved across all retries (no duplicate job IDs).
- Full attempt history stored per job.
- Per-job processor timeout enforcement.
- Priority-ordered job claiming (higher priority = claimed first).
- Delayed and scheduled job support via `schedule.delay` and `schedule.runAt`.
- Recurring job support via `schedule.cron` field.
- Configurable retry with `attempts`, `retryDelay`, and `backoff` strategy.
- Three backoff strategies: `fixed`, `linear`, `exponential` (capped at 10 minutes).
- Dead Letter Queue (DLQ): jobs moved to `dead` status after exhausting all attempts.
- Stalled-job recovery: expired locks on `active` jobs are detected and re-queued automatically.
- Configurable lock duration (`lockDuration`) per queue.
- Sliding-window rate limiter configurable per queue (`rateLimit.max` / `rateLimit.duration`).
- `id` utility — generates stable unique job identifiers.
- Full strict TypeScript types with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.

---

<!-- Links -->
[1.0.2]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
