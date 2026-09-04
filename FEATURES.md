# FEATURES.md

A comprehensive reference of every feature provided by **queue-jobs-worker**.

---

## Storage Backends

Four storage adapters are available out of the box. The core system never talks directly to a database — it always goes through the `StorageAdapter` interface, so backends are fully interchangeable.

| Backend    | Use Case                        | Persistence | Atomic Claim          |
| ---------- | ------------------------------- | ----------- | --------------------- |
| Memory     | Development / testing           | No          | Yes (in-process Map)  |
| Redis      | High-throughput production      | Yes         | Yes (Lua script)      |
| PostgreSQL | Relational / transactional apps | Yes         | Yes (`SKIP LOCKED`)   |
| MySQL      | Relational / transactional apps | Yes         | Yes (`SKIP LOCKED`)   |

The `InMemoryStorageAdapter` requires no setup — it is the default dialect. All other adapters require `client.init()` before use.

Custom backends can be added by implementing the `StorageAdapter` interface and passing the instance to `QueueClient.withAdapter(adapter)`.

---

## Multiple Independent Queues

A single `QueueClient` manages any number of named queues. Each queue is a fully independent job stream with its own configuration, workers, and processors.

```ts
const emails       = client.createQueue("emails");
const media        = client.createQueue("media");
const webhooks     = client.createQueue("webhooks");
```

Queue names must be unique within a client. Jobs are always processed by the queue they were enqueued into.

---

## Job Lifecycle

Every job moves through a controlled set of statuses:

```
waiting → active → completed
                 ↘ (retry) → waiting → active → ...
                           ↘ (exhausted) → dead
delayed → waiting → active → ...
```

| Status      | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| `waiting`   | Persisted, eligible to be claimed by a worker         |
| `delayed`   | Scheduled for a future time, not yet eligible         |
| `active`    | Claimed by a worker and currently being processed     |
| `completed` | Processor returned without throwing                   |
| `dead`      | All retry attempts exhausted — moved to the DLQ       |

A job retains the same unique `id` throughout its entire lifecycle, including across retries. Retrying never creates a new job identity.

---

## Job Identity & Metadata

Every job carries a stable set of fields accessible inside the processor:

| Field               | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `id`                | Unique stable identifier                              |
| `type`              | Job type string (matches processor registration)      |
| `data`              | User-supplied payload (never logged by default)       |
| `status`            | Current lifecycle status                              |
| `attemptsMade`      | Number of attempts already executed                   |
| `maxAttempts`       | Maximum allowed attempts                              |
| `attemptsRemaining` | Computed remaining attempts                           |
| `attemptHistory`    | Ordered list of past attempt records                  |
| `priority`          | Processing priority (higher = sooner)                 |
| `runAt`             | Earliest eligible execution time                      |
| `createdAt`         | Enqueue timestamp                                     |
| `updatedAt`         | Last status-change timestamp                          |

Helper methods: `isActive()`, `isCompleted()`, `isWaiting()`, `isDelayed()`, `isDead()`.

---

## User-Defined Processors

Business logic is kept entirely outside the library. Processors are async functions registered per job type:

```ts
emails.process("send-email", async (job) => {
  await sendEmail(job.data.to, job.data.subject);
  // Return  → job marked completed
  // Throw   → job marked failed (triggers retry or DLQ)
});
```

Multiple job types can be registered on the same queue. Each type has its own processor function.

---

## Workers & Concurrency

Workers claim and execute jobs independently of the application's request lifecycle.

```ts
const worker = queue.createWorker({ concurrency: 10 });
```

- `concurrency` controls the maximum number of jobs processed simultaneously by that worker instance.
- Multiple workers can be created on the same queue — they coordinate safely through the storage layer to prevent duplicate claiming.
- Worker state is exposed via `worker.status`: `"idle" | "running" | "stopping" | "stopped"`.
- Each worker has a unique `worker.id`.

---

## Retry & Backoff

Failed jobs are automatically requeued when attempts remain. Three backoff strategies are available:

| Strategy      | Formula                              | Example (base = 1 s)     |
| ------------- | ------------------------------------ | ------------------------ |
| `fixed`       | `baseDelay`                          | 1 s, 1 s, 1 s            |
| `linear`      | `baseDelay × attempt`                | 1 s, 2 s, 3 s            |
| `exponential` | `baseDelay × 2^(attempt-1)` (≤10 min)| 1 s, 2 s, 4 s, 8 s       |

Every failed attempt is recorded in `job.attemptHistory` with its start time, finish time, error message, and stack trace.

Retry behavior is configurable at client, queue, or individual job level.

---

## Scheduling

Jobs can be made eligible at a future point in time rather than immediately.

```ts
// Relative delay
await queue.enqueue("reminder", payload, { schedule: { delay: 30_000 } });

// Absolute timestamp
await queue.enqueue("report", payload, { schedule: { runAt: "2026-09-01T09:00:00Z" } });

// Cron expression (stored for recurring jobs)
await queue.enqueue("cleanup", payload, { schedule: { cron: "0 3 * * *" } });
```

A delayed job has status `"delayed"` and is not eligible for processing until its `runAt` time is reached.

---

## Priority

Higher-priority jobs are processed before lower-priority ones when both are eligible.

```ts
await queue.enqueue("urgent", payload, { priority: 100 });
await queue.enqueue("normal", payload, { priority: 0 });   // default
await queue.enqueue("low",    payload, { priority: -10 });
// Processing order: urgent → normal → low
```

Priority is respected consistently across all storage adapters.

---

## Rate Limiting

Caps the number of jobs processed within a sliding time window.

```ts
const queue = client.createQueue("webhooks", {
  rateLimit: { max: 50, duration: 60_000 }, // 50 jobs per minute
});
```

When the limit is reached, workers skip claiming until the window resets. Jobs remain in the queue and are never discarded.

Rate limits can be set as client defaults and overridden at queue level.

---

## Dead Letter Queue (DLQ)

When a job exhausts all its retry attempts it is moved to the DLQ (`status: "dead"`).

- DLQ jobs are preserved indefinitely for inspection and manual recovery.
- Full attempt history (including errors and stack traces) is retained.
- Dead jobs are queryable via `queue.getJobs("dead")`.
- The `job:dead` event fires when a job enters the DLQ.

---

## Stalled-Job Recovery

If a worker crashes or a lock expires while a job is `active`, the stalled-job recovery system detects and requeues it automatically.

- A background check runs on each worker at the configured `stalledInterval` (default: 30 s).
- Recovered jobs are re-attempted consistent with the configured retry policy.
- The `job:stalled` and `job:recovered` events fire accordingly.

---

## Distributed Locking

Atomic job claiming prevents two concurrent workers from ever processing the same job.

- Redis: implemented with a Lua script (single atomic operation).
- PostgreSQL / MySQL: implemented with `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction.
- Locks carry a configurable TTL (`lockDuration`, default: 60 s) to enable stalled-job recovery.

---

## Layered Configuration

Configuration flows from broad to specific — more specific settings override broader defaults:

```
Client defaults → Queue options → Worker options → Job options
```

Every configurable property (`attempts`, `retryDelay`, `backoff`, `timeout`, `concurrency`, `pollInterval`, `stalledInterval`, `lockDuration`, `rateLimit`) participates in this hierarchy.

---

## Event System

All lifecycle events are emitted on the `QueueClient` instance.

**Job events**

| Event           | Payload                    |
| --------------- | -------------------------- |
| `job:enqueued`  | `job`                      |
| `job:started`   | `job`                      |
| `job:completed` | `job`                      |
| `job:failed`    | `job, error`               |
| `job:retrying`  | `job, error, nextRunAt`    |
| `job:dead`      | `job, error`               |
| `job:stalled`   | `jobId`                    |
| `job:recovered` | `jobId`                    |

**Worker events**

| Event            | Payload              |
| ---------------- | -------------------- |
| `worker:started` | `workerId`           |
| `worker:stopped` | `workerId`           |
| `worker:status`  | `workerId, status`   |
| `worker:error`   | `workerId, error`    |

**System events:** `queue:error`, `error`.

Subscription methods: `client.on()`, `client.once()`, `client.off()`.

---

## Job Querying

```ts
const job    = await queue.getJob("job-id");
const active = await queue.getJobs("active");
const dead   = await queue.getJobs("dead", 100, 0);  // limit, offset
const counts = await queue.getJobCounts();
// { waiting: 12, active: 3, completed: 204, delayed: 5, dead: 1 }
```

---

## Graceful Shutdown

Workers shut down cleanly without dropping in-flight jobs.

Shutdown sequence (per worker):
1. Stop polling for new jobs.
2. Wait up to `shutdownTimeout` (default: 30 s) for active jobs to finish.
3. Release locks and close storage connections.

`client.close()` coordinates all workers and closes the underlying connection pool.

```ts
process.on("SIGTERM", async () => {
  await client.close();
  process.exit(0);
});
```

Jobs still active at shutdown remain recoverable via stalled-job recovery on the next startup.

---

## TypeScript Support

The entire public API is written in TypeScript with strict typings.

- Generic `<TPayload>` type parameter on `createQueue<TPayload>()` propagates typed `job.data` through to the processor with full autocomplete.
- All public interfaces and types are exported (`JobStatus`, `JobOptions`, `QueueOptions`, `WorkerOptions`, `StorageAdapter`, etc.).
- Both ESM and CommonJS builds are distributed — the package works in TypeScript and JavaScript projects alike.

---

## Security Defaults

- Job payloads are **never logged** by default.
- Error messages do not include payload data.
- Stack traces are stored in attempt history but not surfaced through logs.
- Connection strings must be provided at runtime (environment variables) — never hard-coded.
- The `StorageAdapter` interface keeps provider-specific credentials isolated inside the adapter.
