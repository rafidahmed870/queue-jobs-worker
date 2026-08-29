# Changelog

All notable changes to **queue-jobs-worker** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-08-29

### Added

**Core**

- `QueueClient` — primary entry point; configures storage, exposes queues, and coordinates lifecycle.
- `Queue` — independent job stream with per-queue configuration overrides.
- `Job` — rich wrapper around the raw job data record; passed to user processors.
- `Worker` — claims and executes jobs with configurable concurrency and graceful shutdown.
- `QueueEventEmitter` — strongly-typed lifecycle event bus shared across all components.

**Job processing**

- At-least-once delivery guarantee.
- Stable job identity preserved across all retries (no duplicate job IDs).
- Full attempt history stored per job.
- Per-job processor timeout enforcement.
- Priority-ordered job claiming (higher priority = claimed first).
- Delayed and scheduled job support via `schedule.delay` and `schedule.runAt`.
- Recurring job support via `schedule.cron` field (cron expression stored; recurrence integration point provided).

**Reliability**

- Configurable retry with `attempts`, `retryDelay`, and `backoff` strategy.
- Three backoff strategies: `fixed`, `linear`, `exponential` (capped at 10 minutes).
- Dead Letter Queue (DLQ): jobs moved to `dead` status after exhausting all attempts.
- Stalled-job recovery: expired locks on `active` jobs are detected and re-queued automatically.
- Configurable lock duration (`lockDuration`) per queue.

**Concurrency**

- Per-worker concurrency limit (`concurrency`).
- Atomic job claiming inside `InMemoryStorageAdapter` (single event-loop tick).

**Rate limiting**

- Sliding-window rate limiter configurable per queue (`rateLimit.max` / `rateLimit.duration`).

**Storage**

- `StorageAdapter` interface — clean abstraction; all core logic talks through this interface.
- `InMemoryStorageAdapter` — full-featured in-process adapter for development and testing.

**Configuration**

- Layered configuration: Client defaults → Queue options → Worker options → Job options.
- `QueueClient.withAdapter()` static factory for supplying a custom storage adapter.

**TypeScript**

- Full strict TypeScript types with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- All public types exported from the top-level `index.ts`.

**Build**

- Dual ESM + CJS output via `tsup`.
- Declaration files (`.d.ts` + `.d.ts.map`) generated via `tsc`.

**Tests**

- 31 tests across backoff strategies, storage adapter, queue client, and worker behaviour.
- Coverage: job lifecycle, retry, DLQ, concurrency, stalled recovery, rate limiting, graceful shutdown.

---

[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
