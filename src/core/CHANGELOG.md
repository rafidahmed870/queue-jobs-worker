# Changelog — core

Changes to the core module: `QueueClient`, `Queue`, `Job`, `Worker`, `backoff`, and `id` utilities.

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
[1.0.1]: https://github.com/rafidahmed870/queue-jobs-worker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
