# Changelog — events

Changes to the events module: `QueueEventEmitter` and related lifecycle event types.

---

## [1.0.0] — 2026-08-29

### Added

- `QueueEventEmitter` — strongly-typed lifecycle event bus shared across all components.
- Emits events for the full job lifecycle: enqueued, started, completed, failed, retrying, dead, stalled.
- All event payloads fully typed via `events.types.ts`.

---

<!-- Links -->
[1.0.0]: https://github.com/rafidahmed870/queue-jobs-worker/releases/tag/v1.0.0
