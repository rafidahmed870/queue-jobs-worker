# queue-jobs-worker

A production-ready background job queue for Node.js — persistent, reliable, and TypeScript-first.

[![npm version](https://img.shields.io/npm/v/queue-jobs-worker.svg)](https://www.npmjs.com/package/queue-jobs-worker)
[![license](https://img.shields.io/npm/l/queue-jobs-worker.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/queue-jobs-worker.svg)](https://nodejs.org)

---

## Overview

`queue-jobs-worker` lets you push work into a persistent queue and process it in the background — outside the main request lifecycle. You define the processor; the library handles everything else: queueing, persistence, retries, scheduling, concurrency, and failure recovery.

**Supports:**
- In-memory (dev / testing)
- Redis (node-redis v4+)
- PostgreSQL (node-postgres / pg)
- MySQL (mysql2)

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Dialects](#dialects)
  - [Memory](#memory-no-setup-required)
  - [Redis](#redis)
  - [PostgreSQL](#postgresql)
  - [MySQL](#mysql)
- [Core Concepts](#core-concepts)
- [Configuration](#configuration)
- [Enqueueing Jobs](#enqueueing-jobs)
- [Processing Jobs](#processing-jobs)
- [Workers](#workers)
- [Events](#events)
- [Querying Jobs](#querying-jobs)
- [Retry & Backoff](#retry--backoff)
- [Scheduling](#scheduling)
- [Priority](#priority)
- [Rate Limiting](#rate-limiting)
- [Dead Letter Queue](#dead-letter-queue)
- [Graceful Shutdown](#graceful-shutdown)
- [Custom Storage Adapter](#custom-storage-adapter)
- [API Reference](#api-reference)

---

## Installation

```bash
npm install queue-jobs-worker
```

Install only the driver(s) you actually use:

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

**TypeScript**
```ts
import { QueueClient } from "queue-jobs-worker";

const client = new QueueClient();

// Generic type parameter gives you typed job.data
const emails = client.createQueue<{ to: string; subject: string }>("emails");

emails.process("send-email", async (job) => {
  await sendEmail(job.data.to, job.data.subject);
  // Throw to trigger retry; return to mark as completed
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

**JavaScript**
```js
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient();

// No generic — job.data is untyped
const emails = client.createQueue("emails");

emails.process("send-email", async (job) => {
  await sendEmail(job.data.to, job.data.subject);
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

---

## Dialects

### Memory (no setup required)

Uses an in-process Map. Data is lost on restart. Perfect for development and tests.

```js
const client = new QueueClient();
// or explicitly:
const client = new QueueClient({ dialect: "memory" });
```

`init()` is optional for memory — it's a no-op. All other dialects require it.

---

### Redis

Requires `redis` (node-redis v4+): `npm install redis`

```js
// TypeScript: import { QueueClient } from "queue-jobs-worker";
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "redis",
  connectionString: "redis://localhost:6379",
});

await client.init(); // connects + PING — throws if unreachable

const jobs = client.createQueue("jobs");
```

**With authentication:**
```js
const client = new QueueClient({
  dialect: "redis",
  connectionString: "redis://:yourpassword@redis-host:6379/0",
});
await client.init();
```

**With TLS (Redis Cloud, Upstash, etc.):**
```js
const client = new QueueClient({
  dialect: "redis",
  connectionString: "rediss://user:password@host:6380",
});
await client.init();
```

**What `init()` does for Redis:**
- Creates the node-redis client
- Calls `client.connect()`
- Sends `PING` and asserts the response is `PONG`
- Throws a descriptive error if the connection fails

**Key structure in Redis** (prefix: `qjw:`):
```
qjw:job:{id}                  → Hash (all job fields)
qjw:queue:{name}:waiting      → Sorted Set (score = -priority)
qjw:queue:{name}:delayed      → Sorted Set (score = runAt ms)
qjw:queue:{name}:active       → Set
qjw:queue:{name}:completed    → Set
qjw:queue:{name}:dead         → Set
qjw:rate:{name}               → String (rate-limit counter)
```

Job claiming uses a **Lua script** so it is atomic — two concurrent workers can never claim the same job.

---

### PostgreSQL

Requires `pg` (node-postgres): `npm install pg`

```js
// TypeScript: import { QueueClient } from "queue-jobs-worker";
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "postgres",
  connectionString: "postgresql://user:password@localhost:5432/mydb",
});

await client.init(); // connects + SELECT 1 + creates tables
```

**What `init()` does for PostgreSQL:**
- Creates a connection pool (`pg.Pool`)
- Runs `SELECT 1` to verify connectivity
- Executes `CREATE TABLE IF NOT EXISTS` for `qjw_jobs` and `qjw_rate_limits` — **idempotent, safe to run on every startup**
- Throws a descriptive error if the connection fails

**Tables created automatically** (prefix: `qjw_`):
```sql
qjw_jobs          -- stores every job and its full lifecycle state
qjw_rate_limits   -- sliding-window rate-limit counters
```

Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction — safe for any number of concurrent workers.

**With SSL (Heroku, Supabase, Neon, etc.):**
```js
const client = new QueueClient({
  dialect: "postgres",
  connectionString: process.env.DATABASE_URL,
  // pg respects ?sslmode=require in the connection string
});
await client.init();
```

---

### MySQL

Requires `mysql2`: `npm install mysql2`

```js
// TypeScript: import { QueueClient } from "queue-jobs-worker";
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "mysql",
  connectionString: "mysql://user:password@localhost:3306/mydb",
});

await client.init(); // connects + SELECT 1 + creates tables
```

**What `init()` does for MySQL:**
- Creates a connection pool (`mysql2.createPool`)
- Runs `SELECT 1` to verify connectivity
- Executes `CREATE TABLE IF NOT EXISTS` for `qjw_jobs` and `qjw_rate_limits` — **idempotent**
- Throws a descriptive error if the connection fails

**Tables created automatically** (prefix: `qjw_`):
```sql
qjw_jobs          -- full job state (InnoDB, utf8mb4)
qjw_rate_limits   -- sliding-window rate-limit counters
```

Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction.

---

## Core Concepts

| Concept | Description |
|---|---|
| `QueueClient` | Entry point — holds config, storage, and all queues |
| `Queue` | An independent stream of jobs with its own config |
| `Job` | A unit of work — passed to your processor |
| `Worker` | Claims and executes jobs from a queue |
| `Processor` | Your function — `async (job) => { ... }` |
| `StorageAdapter` | Interface between the core and the database |
| DLQ | Dead Letter Queue — permanently failed jobs land here |

---

## Configuration

Config is layered — more specific settings override broader ones:

```
Client defaults → Queue options → Worker options → Job options
```

```js
// TypeScript: import { QueueClient } from "queue-jobs-worker";
const { QueueClient } = require("queue-jobs-worker");

const client = new QueueClient({
  dialect: "redis",
  connectionString: process.env.REDIS_URL,

  defaults: {
    attempts: 3,            // max retry attempts per job
    retryDelay: 1000,       // base retry delay in ms
    backoff: "exponential", // "fixed" | "linear" | "exponential"
    timeout: 30_000,        // per-attempt timeout in ms
    concurrency: 10,        // worker concurrency
    pollInterval: 1_000,    // how often workers poll for new jobs (ms)
    stalledInterval: 30_000,// how often to check for stalled jobs (ms)
    lockDuration: 60_000,   // how long a job lock is valid (ms)
    rateLimit: {
      max: 100,
      duration: 60_000,     // 100 jobs per minute
    },
  },
});

await client.init();
```

---

## Enqueueing Jobs

**TypeScript**
```ts
// Generic type gives you autocomplete and type-safety on job.data
const queue = client.createQueue<{ userId: string }>("notifications");

await queue.enqueue("send-push", { userId: "u_123" });

// With options
await queue.enqueue("send-push", { userId: "u_123" }, {
  attempts: 5,
  retryDelay: 2000,
  backoff: "linear",
  timeout: 10_000,
  priority: 10,      // higher = processed first (default: 0)
});
```

**JavaScript**
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

---

## Processing Jobs

Register a processor before starting the worker:

```js
queue.process("send-push", async (job) => {
  const { userId } = job.data;

  await pushService.send(userId, "You have a new message");

  // Return to mark as completed.
  // Throw any error to mark as failed (triggers retry or DLQ).
});
```

The `job` object exposes:

```js
job.id                // unique stable ID
job.type              // job type string
job.data              // your payload (never logged)
job.attemptsMade      // attempts already executed
job.maxAttempts       // maximum allowed
job.attemptsRemaining
job.attemptHistory    // array of past attempt records
job.status            // current status
job.priority
job.runAt
job.createdAt
job.updatedAt

// helpers
job.isActive()
job.isCompleted()
job.isWaiting()
job.isDelayed()
job.isDead()
```

---

## Workers

```js
const worker = queue.createWorker({
  concurrency: 10,          // max simultaneous jobs
  shutdownTimeout: 30_000,  // ms to wait for active jobs during shutdown
});

console.log(worker.status); // "idle" | "running" | "stopping" | "stopped"
console.log(worker.id);     // unique worker ID

await worker.stop();
```

You can create multiple workers on the same queue — they coordinate through the storage layer:

```js
const w1 = queue.createWorker({ concurrency: 5 });
const w2 = queue.createWorker({ concurrency: 5 });
// Total capacity: 10 concurrent jobs
```

---

## Events

All lifecycle events are emitted on the client. Subscribe before creating queues/workers:

```js
// Job events
client.on("job:enqueued",  (job) => console.log("Enqueued:", job.id));
client.on("job:started",   (job) => console.log("Started:", job.id));
client.on("job:completed", (job) => console.log("Done:", job.id));
client.on("job:failed",    (job, err) => console.error("Failed:", job.id, err.message));
client.on("job:retrying",  (job, err, nextRunAt) => {
  console.log(`Retrying ${job.id} at ${nextRunAt}`);
});
client.on("job:dead",      (job, err) => console.error("DLQ:", job.id, err.message));
client.on("job:stalled",   (jobId) => console.warn("Stalled:", jobId));
client.on("job:recovered", (jobId) => console.log("Recovered:", jobId));

// Worker events
client.on("worker:started", (workerId) => console.log("Worker started:", workerId));
client.on("worker:stopped", (workerId) => console.log("Worker stopped:", workerId));
client.on("worker:status",  (workerId, status) => console.log(workerId, "→", status));
client.on("worker:error",   (workerId, err) => console.error("Worker error:", err));

// Queue / system errors
client.on("queue:error", (queueName, err) => console.error("Queue error:", queueName, err));
client.on("error",       (err) => console.error("Error:", err));

// Remove a listener
client.off("job:completed", myListener);

// One-time listener
client.once("job:dead", (job, err) => alertTeam(job, err));
```

---

## Querying Jobs

```js
const job = await queue.getJob("job-id-here");
if (job) {
  console.log(job.status, job.attemptsMade);
}

// Jobs by status (paginated)
const waiting   = await queue.getJobs("waiting", 50, 0);   // limit, offset
const active    = await queue.getJobs("active");
const completed = await queue.getJobs("completed", 100, 0);
const dead      = await queue.getJobs("dead");

// Counts per status
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

Control retry behaviour at the client, queue, or job level:

```js
// Queue-level
const queue = client.createQueue("tasks", {
  attempts: 5,
  retryDelay: 2000,
  backoff: "exponential",
});

// Job-level override
await queue.enqueue("task", payload, {
  attempts: 3,
  retryDelay: 500,
  backoff: "fixed",
});
```

**Backoff strategies:**

| Strategy | Formula | Example (base = 1 s) |
|---|---|---|
| `fixed` | `baseDelay` | 1 s, 1 s, 1 s |
| `linear` | `baseDelay × attempt` | 1 s, 2 s, 3 s |
| `exponential` | `baseDelay × 2^(attempt-1)` (max 10 min) | 1 s, 2 s, 4 s, 8 s |

Each failed attempt is recorded in `job.attemptHistory`:

```js
job.attemptHistory.forEach((attempt) => {
  console.log(`Attempt ${attempt.attempt}: ${attempt.error}`);
});
```

---

## Scheduling

```js
// Run 30 seconds from now
await queue.enqueue("reminder", payload, {
  schedule: { delay: 30_000 },
});

// Run at a specific time
await queue.enqueue("report", payload, {
  schedule: { runAt: "2026-09-01T09:00:00Z" },
});

// Store a cron expression (integration point for recurring jobs)
await queue.enqueue("cleanup", payload, {
  schedule: { cron: "0 3 * * *" },
});
```

Delayed jobs are not eligible until their `runAt` time. The Redis adapter promotes them automatically inside the Lua claim script; SQL adapters check `run_at` in the `WHERE` clause.

---

## Priority

Higher values are processed first. Default is `0`.

```js
await queue.enqueue("urgent-task", payload, { priority: 100 });
await queue.enqueue("normal-task", payload, { priority: 0 });
await queue.enqueue("low-task",    payload, { priority: -10 });

// Processing order: urgent → normal → low
```

---

## Rate Limiting

Limit how many jobs are processed per time window:

```js
// Queue-level rate limit
const queue = client.createQueue("webhooks", {
  rateLimit: {
    max: 50,          // max 50 jobs
    duration: 60_000, // per 60 seconds
  },
});

// Or as a client default
const client = new QueueClient({
  defaults: {
    rateLimit: { max: 100, duration: 60_000 },
  },
});
```

When the limit is reached, workers skip claiming until the window resets. Jobs stay in the queue and are not lost.

---

## Dead Letter Queue

When a job exhausts all retry attempts it is moved to the DLQ (status: `"dead"`).

```js
client.on("job:dead", async (job, error) => {
  await alertOncall({
    jobId: job.id,
    type: job.type,
    error: error.message,
    attempts: job.attemptsMade,
  });
});

// Query dead jobs
const deadJobs = await queue.getJobs("dead");

// Inspect a dead job's full attempt history
const job = await queue.getJob(jobId);
if (job) {
  job.attemptHistory.forEach((a) => {
    console.log(`Attempt ${a.attempt} failed: ${a.error}`);
  });
}
```

---

## Graceful Shutdown

Always call `client.close()` before your process exits:

```js
async function shutdown() {
  await client.close(); // stops workers, releases locks, closes DB connections
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
```

During shutdown each worker:
1. Stops polling for new jobs
2. Waits up to `shutdownTimeout` (default 30 s) for active jobs to finish
3. Releases DB/Redis connections

Interrupted jobs remain recoverable — the stalled-job recovery mechanism will reclaim them on the next startup.

---

## Custom Storage Adapter

Implement the `StorageAdapter` interface to add your own backend:

**TypeScript**
```ts
import type { StorageAdapter } from "queue-jobs-worker";

class MongoStorageAdapter implements StorageAdapter {
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

**JavaScript**
```js
const { QueueClient } = require("queue-jobs-worker");

// In JS there's no interface to implement — just match the method signatures
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
| `connectionString` | `string` | — | Required for redis/postgres/mysql |
| `defaults.attempts` | `number` | `3` | Default max attempts |
| `defaults.retryDelay` | `number` | `1000` | Default base retry delay (ms) |
| `defaults.backoff` | `"fixed" \| "linear" \| "exponential"` | `"exponential"` | Default backoff strategy |
| `defaults.timeout` | `number` | `30000` | Default per-attempt timeout (ms) |
| `defaults.concurrency` | `number` | `10` | Default worker concurrency |
| `defaults.pollInterval` | `number` | `1000` | Worker poll interval (ms) |
| `defaults.stalledInterval` | `number` | `30000` | Stalled-job check interval (ms) |
| `defaults.lockDuration` | `number` | `60000` | Lock TTL (ms) |
| `defaults.rateLimit` | `{ max, duration }` | — | Optional rate limit |

### `client.init()`

Initialises the storage backend. Required for redis/postgres/mysql before any queue operations. Idempotent.

### `client.createQueue<TPayload>(name, options?)`

Creates and returns a `Queue`. `options` override `defaults` for this queue. The generic `<TPayload>` is TypeScript-only — omit it in JavaScript.

### `client.getQueue<TPayload>(name)` / `client.requireQueue<TPayload>(name)`

Returns an existing queue by name (`requireQueue` throws if not found).

### `client.on(event, listener)` / `client.once(...)` / `client.off(...)`

Subscribe/unsubscribe from lifecycle events.

### `client.close()`

Gracefully shut down. Safe to call multiple times.

### `QueueClient.withAdapter(adapter, options?)`

Static factory for custom storage adapters.

---

### `queue.enqueue(type, payload, options?)`

| Option | Type | Description |
|---|---|---|
| `attempts` | `number` | Max attempts for this job |
| `retryDelay` | `number` | Base retry delay (ms) |
| `backoff` | `string` | Backoff strategy |
| `timeout` | `number` | Per-attempt timeout (ms) |
| `priority` | `number` | Higher = sooner (default: 0) |
| `schedule.delay` | `number` | Delay before eligible (ms) |
| `schedule.runAt` | `string \| number` | Absolute run time |
| `schedule.cron` | `string` | Cron expression (stored) |

### `queue.process(type, processor)`

Register an async processor function for a job type.

### `queue.createWorker(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | queue config | Max concurrent jobs |
| `shutdownTimeout` | `number` | `30000` | Drain timeout on stop (ms) |

### `queue.getJob(id)` / `queue.getJobs(status?, limit?, offset?)`
### `queue.getJobCounts()`

---

## Storage Support Matrix

| Feature | Memory | Redis | PostgreSQL | MySQL |
|---|:---:|:---:|:---:|:---:|
| Persistence | | ✓ | ✓ | ✓ |
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

- Job payloads are never logged by default.
- Error messages do not include payload data.
- Connection strings should always come from environment variables, not source code.
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

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT — [LICENSE](./LICENSE)