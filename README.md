![queue-jobs-worker](./assets/queue-jobs-worker-github.png)

# queue-jobs-worker

A durable, TypeScript-first job queue for Node.js built for asynchronous work, retries, scheduling, and recovery.

<p align="center">
  <a href="https://www.npmjs.com/package/queue-jobs-worker">
    <img src="https://img.shields.io/npm/v/queue-jobs-worker.svg" alt="npm version">
  </a>&nbsp;
  <a href="./LICENSE">
    <img src="https://img.shields.io/npm/l/queue-jobs-worker.svg" alt="license">
  </a>&nbsp;
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/node/v/queue-jobs-worker.svg" alt="node">
  </a>
</p>

---

## Overview

`queue-jobs-worker` helps you move background work out of the request lifecycle and into a reliable, persistent queue. Define the processor logic once and let the library handle enqueueing, persistence, retries, schedules, concurrency, rate limiting, and recovery.

It supports all major local and production-friendly backends:

- In-memory queue for development and tests
- Redis via `node-redis` v4+
- PostgreSQL via `pg`
- MySQL via `mysql2`

For a detailed feature breakdown, see [FEATURES.md](./FEATURES.md).

---

## Installation

```bash
npm install queue-jobs-worker
```

Install the driver you plan to use:

```bash
# Redis
npm install redis

# PostgreSQL
npm install pg

# MySQL
npm install mysql2
```

---

## Quick Start

```js
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient();
const emails = client.createQueue("emails");

emails.process("send-email", async (job) => {
  await sendEmail(job.data.to, job.data.subject);
  // Return to mark the job complete; throw to trigger retry or DLQ handling
});

emails.createWorker({ concurrency: 5 });

await emails.enqueue("send-email", {
  to: "user@example.com",
  subject: "Welcome!",
});

process.on("SIGTERM", async () => {
  await client.close();
  process.exit(0);
});
```

If you are using TypeScript, you can optionally make the queue payload type-safe with a generic like `client.createQueue<{ to: string; subject: string }>("emails")`.

---

## Supported Backends

### Memory

Use the in-memory backend for local development and tests. Data is not persisted across restarts.

```js
const client = new QueueClient();
// or explicitly:
const client = new QueueClient({ dialect: "memory" });
```

`init()` is effectively a no-op for this backend.

### Redis

```js
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "redis",
  connectionString: "redis://localhost:6379",
});

await client.init();
const jobs = client.createQueue("jobs");
```

With authentication:

```js
const client = new QueueClient({
  dialect: "redis",
  connectionString: "redis://:yourpassword@redis-host:6379/0",
});

await client.init();
```

With TLS:

```js
const client = new QueueClient({
  dialect: "redis",
  connectionString: "rediss://user:password@host:6380",
});

await client.init();
```

`init()` creates the Redis client, connects to the server, sends `PING`, and verifies the response is `PONG`.

### PostgreSQL

```js
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "postgres",
  connectionString: "postgresql://user:password@localhost:5432/mydb",
});

await client.init();
```

`init()` verifies connectivity with `SELECT 1` and creates the queue tables if they do not already exist.

### MySQL

```js
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "mysql",
  connectionString: "mysql://user:password@localhost:3306/mydb",
});

await client.init();
```

`init()` validates the connection and creates the required tables in the database.

---

## Core Concepts

| Concept | Description |
|---|---|
| `QueueClient` | Entry point that owns configuration, storage, and queues |
| `Queue` | A separate job stream with its own settings |
| `Job` | A unit of work passed to your processor |
| `Worker` | Claims and executes jobs |
| `Processor` | Your async function, e.g. `async (job) => { ... }` |
| `StorageAdapter` | A backend abstraction for durable storage |
| `DLQ` | Dead Letter Queue for permanently failed jobs |

---

## Configuration

Settings are layered so more specific config overrides broader defaults:

```
Client defaults → Queue options → Worker options → Job options
```

```js
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "redis",
  connectionString: process.env.REDIS_URL,

  defaults: {
    attempts: 3,
    retryDelay: 1000,
    backoff: "exponential",
    timeout: 30_000,
    concurrency: 10,
    pollInterval: 1_000,
    stalledInterval: 30_000,
    lockDuration: 60_000,
    rateLimit: {
      max: 100,
      duration: 60_000,
    },
  },
});

await client.init();
```

---

## Enqueueing Jobs

```js
const queue = client.createQueue("notifications");

await queue.enqueue("send-push", { userId: "u_123" });

await queue.enqueue("send-push", { userId: "u_123" }, {
  attempts: 5,
  retryDelay: 2000,
  backoff: "linear",
  timeout: 10_000,
  priority: 10,
});
```

If you want TypeScript type safety for `job.data`, pass a generic when creating the queue, such as `client.createQueue<{ userId: string }>("notifications")`.

---

## Processing Jobs

Register a processor before creating or starting a worker. Processors receive the `job` instance as well as an `AbortSignal` for cooperative cancellation when a job attempt times out:

```js
queue.process("send-push", async (job, signal) => {
  const { userId } = job.data;

  // Pass signal to APIs that support cancellation (e.g. fetch, DB queries):
  await pushService.send(userId, "You have a new message", { signal });

  // Or check signal.aborted before performing expensive steps:
  if (signal.aborted) return;

  // Return to mark the job complete.
  // Throw any error to trigger retry logic or DLQ handling.
});
```

> **Note on Timeout Cancellation**: In Node.js, asynchronous operations cannot be forcibly terminated from the outside. Processors should cooperate with cancellation by checking `signal.aborted` or forwarding `signal` to abortable APIs to ensure timed-out executions do not continue running in the background.

See [FEATURES.md](./FEATURES.md) for the full `job` model and helper methods.

---

## Workers

```js
const worker = queue.createWorker({
  concurrency: 10,
  shutdownTimeout: 30_000,
});

console.log(worker.status);
console.log(worker.id);

await worker.stop();
```

Multiple workers can share the same queue and coordinate through the storage layer:

```js
const w1 = queue.createWorker({ concurrency: 5 });
const w2 = queue.createWorker({ concurrency: 5 });
// total capacity: 10 concurrent jobs
```

---

## Events

The client emits lifecycle events that are useful for monitoring and alerting:

```js
client.on("job:completed", (job) => console.log("Done:", job.id));
client.on("job:failed", (job, err) => console.error("Failed:", job.id, err.message));
client.on("job:dead", (job, err) => console.error("DLQ:", job.id, err.message));
client.on("worker:error", (workerId, err) => console.error("Worker error:", err));

client.off("job:completed", myListener);
client.once("job:dead", (job, err) => alertTeam(job, err));
```

---

## Querying Jobs

```js
const job = await queue.getJob("job-id-here");
if (job) {
  console.log(job.status, job.attemptsMade);
}

const waiting = await queue.getJobs("waiting", 50, 0);
const active = await queue.getJobs("active");
const completed = await queue.getJobs("completed", 100, 0);
const dead = await queue.getJobs("dead");

const counts = await queue.getJobCounts();
// {
//   waiting: 12,
//   active: 3,
//   completed: 204,
//   delayed: 5,
//   dead: 1
// }
```

---

## Retry & Backoff

Retries can be configured at the client, queue, or job level:

```js
const queue = client.createQueue("tasks", {
  attempts: 5,
  retryDelay: 2000,
  backoff: "exponential",
});

await queue.enqueue("task", payload, {
  attempts: 3,
  retryDelay: 500,
  backoff: "fixed",
});
```

Available strategies are `fixed`, `linear`, and `exponential`. Each failure is tracked in `job.attemptHistory` so you can inspect what happened without losing context.

---

## Scheduling

```js
await queue.enqueue("reminder", payload, { schedule: { delay: 30_000 } });
await queue.enqueue("report", payload, { schedule: { runAt: "2026-09-01T09:00:00Z" } });
await queue.enqueue("cleanup", payload, { schedule: { cron: "0 3 * * *" } });
```

Delayed jobs stay dormant until their scheduled time is reached.

---

## Priority

Jobs with a higher priority value are processed sooner. The default is `0`.

```js
await queue.enqueue("urgent-task", payload, { priority: 100 });
await queue.enqueue("normal-task", payload, { priority: 0 });
await queue.enqueue("low-task", payload, { priority: -10 });
// order: urgent → normal → low
```

---

## Rate Limiting

```js
const queue = client.createQueue("webhooks", {
  rateLimit: { max: 50, duration: 60_000 },
});
```

When a queue reaches its limit, workers pause claiming new jobs until the time window resets. Jobs are not discarded.

---

## Dead Letter Queue

When a job reaches the end of its retry budget, it is moved to the dead-letter queue with status `"dead"`.

```js
client.on("job:dead", async (job, error) => {
  await alertOncall({ jobId: job.id, type: job.type, error: error.message });
});

const deadJobs = await queue.getJobs("dead");
```

All failure history remains attached to the job record.

---

## Graceful Shutdown

Call `client.close()` before your process exits:

```js
process.on("SIGTERM", async () => {
  await client.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});
```

This stops workers cleanly, releases locks, and allows stalled-job recovery to continue safely after restarts.

---

## Custom Storage Adapter

You can provide a custom backend by implementing the `StorageAdapter` interface. The same idea applies in JavaScript or TypeScript; the main difference is whether you add explicit interface typing in TypeScript.

```js
const { QueueClient } = require("queue-jobs-worker");

class MongoStorageAdapter {
  async initialize() { /* connect, create indexes */ }
  async close() { /* disconnect */ }
  async enqueue(input) { /* ... */ }
  async claim(input) { /* atomic claim */ }
  async complete(jobId) { /* ... */ }
  async requeue(input) { /* ... */ }
  async moveToDlq(input) { /* ... */ }
  async releaseLock(jobId) { /* ... */ }
  async recoverStalledJobs(queue, now) { /* ... */ }
  async getJob(jobId) { /* ... */ }
  async getJobs(filter) { /* ... */ }
  async getJobCounts(queue) { /* ... */ }
  async checkAndIncrementRateLimit(queue, max, windowMs, now) { /* ... */ }
}

const client = QueueClient.withAdapter(new MongoStorageAdapter(), {
  defaults: { attempts: 5 },
});

await client.init();
```

---

## API Reference

### `new QueueClient(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `dialect` | `"memory" \| "redis" \| "postgres" \| "mysql"` | `"memory"` | Storage backend |
| `connectionString` | `string` | — | Required for Redis/PostgreSQL/MySQL |
| `defaults.attempts` | `number` | `3` | Max retries per job |
| `defaults.retryDelay` | `number` | `1000` | Base retry delay in ms |
| `defaults.backoff` | `"fixed" \| "linear" \| "exponential"` | `"exponential"` | Retry strategy |
| `defaults.timeout` | `number` | `30000` | Per-attempt timeout in ms |
| `defaults.concurrency` | `number` | `10` | Default worker concurrency |
| `defaults.pollInterval` | `number` | `1000` | Poll interval in ms |
| `defaults.stalledInterval` | `number` | `30000` | Stalled-job check interval in ms |
| `defaults.lockDuration` | `number` | `60000` | Lock TTL in ms |
| `defaults.rateLimit` | `{ max, duration }` | — | Optional rate limiting |

### `client.init()`

Initializes the configured backend. This is required for Redis, PostgreSQL, and MySQL before queue operations. It is safe to call more than once.

### `client.createQueue<TPayload>(name, options?)`

Creates and returns a queue. Queue-specific options override client defaults.

### `client.getQueue<TPayload>(name)` / `client.requireQueue<TPayload>(name)`

Fetches an existing queue by name. `requireQueue()` throws if none exists.

### `client.on(event, listener)` / `client.once(...)` / `client.off(...)`

Registers and removes event listeners for queue and worker lifecycle events.

### `client.close()`

Stops workers and closes storage connections gracefully.

### `QueueClient.withAdapter(adapter, options?)`

Creates a client using a custom storage backend.

### `queue.enqueue(type, payload, options?)`

| Option | Type | Description |
|---|---|---|
| `attempts` | `number` | Maximum attempts for this job |
| `retryDelay` | `number` | Base retry delay in ms |
| `backoff` | `string` | Retry backoff strategy |
| `timeout` | `number` | Per-attempt timeout in ms |
| `priority` | `number` | Higher values are processed first |
| `schedule.delay` | `number` | Delay before the job becomes eligible |
| `schedule.runAt` | `string \| number` | Absolute run time |
| `schedule.cron` | `string` | Cron expression for recurring jobs |

### `queue.process(type, processor)`

Registers an async processor for a job type. The processor signature is `async (job, signal) => ...`, where `signal` is an `AbortSignal` aborted when the per-attempt timeout is reached.

### `queue.createWorker(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | queue config | Maximum simultaneous job executions |
| `shutdownTimeout` | `number` | `30000` | Graceful shutdown wait time in ms |

### `queue.getJob(id)` / `queue.getJobs(status?, limit?, offset?)`
### `queue.getJobCounts()`

---

## Storage Support Matrix

| Feature | Memory | Redis | PostgreSQL | MySQL |
|---|:---:|:---:|:---:|:---:|
| Persistence | — | ✓ | ✓ | ✓ |
| Atomic claim | ✓ | ✓ (Lua) | ✓ (SKIP LOCKED) | ✓ (SKIP LOCKED) |
| Priority ordering | ✓ | ✓ | ✓ | ✓ |
| Delayed jobs | ✓ | ✓ | ✓ | ✓ |
| Retry + backoff | ✓ | ✓ | ✓ | ✓ |
| DLQ | ✓ | ✓ | ✓ | ✓ |
| Stalled recovery | ✓ | ✓ | ✓ | ✓ |
| Rate limiting | ✓ | ✓ | ✓ | ✓ |
| Connection check on init | — | ✓ PING | ✓ SELECT 1 | ✓ SELECT 1 |
| Auto-create schema | — | — | ✓ | ✓ |

---

## Security

- Job payloads are not logged by default.
- Error messages do not expose payload data.
- Connection strings should come from environment variables rather than source code.
- See [SECURITY.md](./SECURITY.md) for the full policy.

```js
// Good
const client = new QueueClient({
  dialect: "postgres",
  connectionString: process.env.DATABASE_URL,
});

// Bad — never hard-code credentials
const client = new QueueClient({
  dialect: "postgres",
  connectionString: "postgresql://admin:secret@prod-db:5432/app",
});
```

---

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

---

## License

MIT — [LICENSE](./LICENSE)

## Donation

If this project has been useful to you, consider supporting it with a coffee.

**BTC:** `12dxgVQ3sRFhc4g7M6oydsN2tTMMthJJqS`
