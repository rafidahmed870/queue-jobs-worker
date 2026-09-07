## Situation
<!-- What was the problem or context behind this change? -->

Closes #

A job could be executed concurrently by multiple workers when its processor ran longer than the configured `lockDuration`. The worker set a lock when claiming a job, but there was no mechanism to renew the lock during execution. Once the lock expired, stalled-job recovery moved the still-running job back to `waiting`, allowing another worker to claim it, leading to duplicate processing.

This could cause critical side effects: duplicate emails, double charges, duplicate webhooks, or duplicate database writes.

## Task
<!-- What needed to be done? -->

- Implement a lock renewal / heartbeat mechanism so active workers can extend their lock while a processor is running.
- Make lock renewal ownership-aware — only the current lock owner can extend the lock.
- Make `complete`, `requeue`, `moveToDlq`, and `releaseLock` ownership-aware — a stale worker that has lost lock ownership must not be able to mutate job state.

## Action
<!-- What changes did you make to solve the problem? -->

**Worker (`src/core/worker.ts`)**
- Added a `setInterval` heartbeat inside `executeJob` that fires every `max(100, floor(lockDuration / 2))` ms.
- Heartbeat calls `storage.renewLock(job.id, this.id, lockDuration)` and stops itself if renewal fails.
- `complete`, `requeue`, `moveToDlq`, and `releaseLock` now always pass `this.id` as `lockId`.

**Storage Adapter interface (`src/types/storage.types.ts`)**
- Added `renewLock(jobId, lockId, lockDuration): Promise<boolean>` method.
- `complete(jobId, lockId?)`, `releaseLock(jobId, lockId?)` — optional ownership parameter.
- `RequeueInput.lockId?`, `MoveToDlqInput.lockId?` — optional ownership field.

**All storage adapters**
- Implemented `renewLock` with atomicity guarantees (Lua in Redis, `WHERE status='active' AND lock_id=?` in SQL adapters).
- `complete`, `requeue`, `moveToDlq`, `releaseLock` verify `lockId` ownership before mutating state when provided.

See [`docs/fix-lock-renewal-heartbeat.md`](../docs/fix-lock-renewal-heartbeat.md) for full technical details.

## Result
<!-- What is the outcome after this change? -->

- Long-running processors are protected from being reclaimed by other workers.
- A stale worker that loses lock ownership can no longer complete, requeue, or DLQ a job it no longer owns.
- The fix is backward-compatible — all new `lockId` parameters are optional for external callers.

## Testing
<!-- How did you verify the changes? -->

- [x] Tests added/updated
- [x] Existing tests passed
- [x] Manually tested

**New tests:**
- `in-memory-adapter.test.ts`: `renewLock` success/failure, stale worker ownership prevention
- `worker.test.ts`: Long-running processor (600ms) with `lockDuration: 200ms` + two concurrent workers → asserts job executed exactly once

```
npm run typecheck  ✓
npm run lint       ✓
npm test           ✓  40 tests, all passing
npm run build      ✓
```