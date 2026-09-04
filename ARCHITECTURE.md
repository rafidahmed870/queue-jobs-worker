# ARCHITECTURE.md

## Introduction

**QUEUE-JOBS-WORKER** is a production-ready npm package for queue management and background job processing in Node.js applications.

It enables applications to execute asynchronous, time-consuming, or resource-intensive tasks outside the main request lifecycle using persistent queues and dedicated workers.

It is suitable for workloads such as email delivery, notifications, webhooks, file processing, media processing, report generation, and other asynchronous operations.

For a full feature reference, see [FEATURES.md](./FEATURES.md).

The package does not implement business logic. Users provide job processors, while **QUEUE-JOBS-WORKER** manages queueing, persistence, execution, reliability, and worker lifecycle.

---

## Goals & Requirements

The primary goal is to provide reliable, fault-tolerant, scalable, and developer-friendly background job processing with an infrastructure-independent architecture.

Key design properties: **reliability · consistency · safety · scalability · maintainability**.

For the full feature set that satisfies these goals, see [FEATURES.md](./FEATURES.md).

---

## System Overview

**QUEUE-JOBS-WORKER** follows a producer-consumer architecture where applications enqueue jobs into persistent queues and workers claim and process them asynchronously.

```text
Application
    │
    │ Enqueue
    ▼
QueueClient
    │
    ▼
Queue
    │
    ▼
Storage Adapter
    │
    ▼
Persistent Storage
    │
    │ Dequeue / Claim
    ▼
Worker
    │
    ▼
User-defined Processor
```

### Core Components

* **QueueClient** — Configures the queue system and provides access to queues.
* **Queue** — Represents an independent stream of jobs and queue-level configuration.
* **Job** — Represents a unit of background work and its execution state.
* **Storage Adapter** — Abstracts the underlying persistence mechanism.
* **Worker** — Claims and executes available jobs.
* **Processor** — User-defined function containing job business logic.
* **Dead Letter Queue (DLQ)** — Holds jobs that permanently fail after exhausting their retry attempts.

### Delivery Model

The system is designed around **at-least-once job processing**.

A job may be processed again after a worker failure, lock expiration, or retryable failure. Therefore, user-defined processors should be designed to be **idempotent** where duplicate execution could cause side effects.

### Job Flow

```text
Create
  │
  ▼
Enqueue
  │
  ▼
Persist
  │
  ▼
Claim
  │
  ▼
Process
  │
  ├── Success ───────► Completed
  │
  └── Failure
        │
        ▼
   Attempts Remaining?
      /         \
    Yes          No
     │            │
     ▼            ▼
  Requeue         DLQ
     │
     ▼
  Waiting
```

The package manages persistence, claiming, execution, retry, recovery, and lifecycle coordination, while users remain responsible for job business logic.

---

## Queue Client

The **QueueClient** is the primary entry point for configuring and interacting with the queue system.

### Responsibilities

* Configure storage dialect and connection.
* Define global defaults.
* Create and access queues.
* Manage shared infrastructure resources.
* Coordinate client lifecycle operations.

### Configuration

```ts
const client = new QueueClient({
  dialect: "redis",
  connectionString: "...",
  defaults: {
    attempts: 3,
    retryDelay: 1000,
    timeout: 30000,
    concurrency: 10,
    rateLimit: { max: 100, duration: 60000 },
  },
});
```

Configuration follows a layered hierarchy: client defaults → queue options → worker options → job options. See [FEATURES.md → Layered Configuration](./FEATURES.md#layered-configuration).

### Queue Access

```ts
const emails = client.createQueue("emails");
const media = client.createQueue("media");

const existing = client.getQueue("emails");
```

Each queue must have a unique name within the client.

---

## Queue

A **Queue** represents an independent stream of jobs with its own processing configuration.

### Responsibilities

* Accept new jobs.
* Provide eligible jobs for workers.
* Requeue retryable jobs.
* Support multiple job types.
* Apply ordering and priority rules.
* Apply queue-specific execution limits.

```text
QueueClient
│
├── emails
├── notifications
├── media
└── webhooks
```

### Queue Configuration

Queue-specific options may override client defaults.

```ts
const emails = client.createQueue("emails", {
  concurrency: 10,
  attempts: 5,

  rateLimit: {
    max: 50,
    duration: 60000,
  },
});
```

---

## Job

A **Job** represents a single unit of background work containing everything needed to identify, execute, track, retry, and recover it.

```ts
await emails.enqueue("send-email", { to: "user@example.com" });
```

### Job Identity

A job retains the same unique identity throughout its lifecycle. Retrying or recovering a job does not create a new job identity.

```text
job_123
  │
  ├── Attempt 1
  ├── Attempt 2
  └── Attempt 3
```

Failed attempts are retained in the job's execution history. For the full `JobData` field reference, see [FEATURES.md → Job Identity & Metadata](./FEATURES.md#job-identity--metadata).

---

## Worker

A **Worker** claims jobs from one or more queues and executes their registered processors independently from the application's request lifecycle.

### Responsibilities

* Claim available jobs.
* Execute user-defined processors.
* Respect concurrency and rate limits.
* Handle successful and failed executions.
* Trigger retry and requeue behavior.
* Detect stalled jobs.
* Support graceful shutdown.

```text
Queue
  │
  │ Claim
  ▼
Worker
  │
  ▼
Processor
  │
  ├── Success
  └── Failure
```

### User-Defined Processors

The package does not implement job-specific business logic.

Users register processors for their job types.

```ts
emails.process("send-email", async (job) => {
  await sendEmail(job.data);
});
```

The worker executes the processor and manages its execution lifecycle.

### Worker Concurrency

```ts
const worker = emails.createWorker({
  concurrency: 10,
});
```

Concurrency determines the maximum number of jobs a worker may process simultaneously.

---

## Job Lifecycle

A job progresses through a controlled lifecycle from creation to completion or permanent failure.

```text
Created
   │
   ▼
Waiting
   │
   ▼
Active
   │
   ├── Success ─────────► Completed
   │
   └── Failure
          │
          ▼
    Attempts Remaining?
       /          \
     Yes           No
      │             │
      ▼             ▼
   Requeue          DLQ
      │
      ▼
   Waiting
      │
      └──────► Active
```

A retryable job returns to the queue as the **same job**, preserving its ID and failure history. When all attempts are exhausted it moves to the **Dead Letter Queue (DLQ)**. See [FEATURES.md → Job Lifecycle](./FEATURES.md#job-lifecycle) and [FEATURES.md → Dead Letter Queue](./FEATURES.md#dead-letter-queue).

---

## Storage

The **Storage** layer provides persistent storage for queues, jobs, locks, and execution metadata.

The core system communicates with storage through a **Storage Adapter**, keeping storage implementation independent from queue logic.

### Responsibilities

* Persist queues and jobs.
* Store job state and execution metadata.
* Support enqueue, claim, and requeue operations.
* Provide required atomic operations.
* Persist failure history.
* Support locking and recovery operations.

```text
QueueClient
    │
    ▼
Storage Adapter
    │
    ├── Redis
    ├── PostgreSQL
    └── MySQL
```

The core system must not directly depend on a specific storage implementation.

---

## Locking

The **Locking** system prevents multiple workers from concurrently claiming the same job.

A successfully claimed job receives a lock with a defined expiration.

```text
Worker A ──► Claim ──► Lock Acquired ──► Process

Worker B ──► Claim ──► Already Locked
```

### Responsibilities

* Atomically claim jobs.
* Prevent concurrent ownership of the same job.
* Track lock ownership and expiration.
* Renew locks when required.
* Release locks after execution.

Expired locks must be recoverable after worker failure.

---

## Retry

The **Retry** system controls how failed jobs are reattempted. A retryable failure requeues the existing job instead of creating a new one.

```text
Attempt
   │
   ▼
Failure
   │
   ▼
Retry Delay / Backoff
   │
   ▼
Requeue
```

Each failed attempt is recorded in the job's failure history. When no attempts remain, the job moves to the DLQ. See [FEATURES.md → Retry & Backoff](./FEATURES.md#retry--backoff).

---

## Failure Recovery

The **Failure Recovery** system handles jobs interrupted by worker or infrastructure failures.

```text
Worker
   │
   └── Process Failure
          │
          ▼
    Detect Stalled Job
          │
          ▼
     Recover Lock
          │
          ▼
       Requeue
```

Recovered jobs are reattempted consistent with the at-least-once delivery model. See [FEATURES.md → Stalled-Job Recovery](./FEATURES.md#stalled-job-recovery).

---

## Scheduling

The **Scheduling** system controls when jobs become eligible for processing (delayed, scheduled at an absolute time, or recurring via cron).

```text
Create
  │
  ▼
Scheduled / Delayed
  │
  ▼
Ready
  │
  ▼
Queue
  │
  ▼
Worker
```

Jobs must not become eligible before their scheduled execution time. See [FEATURES.md → Scheduling](./FEATURES.md#scheduling).

---

## Priority & Rate Limiting

**Priority** determines processing order — higher-priority jobs are selected first when multiple jobs are eligible.

**Rate limiting** restricts the number of jobs processed within a defined time window. When the limit is reached, eligible jobs stay queued until the window resets.

See [FEATURES.md → Priority](./FEATURES.md#priority) and [FEATURES.md → Rate Limiting](./FEATURES.md#rate-limiting).

---

## Events

The **Events** system exposes lifecycle events for jobs and workers, allowing applications to integrate their own logging and observability. See [FEATURES.md → Event System](./FEATURES.md#event-system).

---

## Concurrency

Concurrency controls the number of jobs processed simultaneously and may be configured at client, queue, or worker level. Concurrent workers coordinate through the storage and locking mechanisms to prevent duplicate job ownership. See [FEATURES.md → Workers & Concurrency](./FEATURES.md#workers--concurrency).

---

## Scaling

**QUEUE-JOBS-WORKER** supports horizontal worker scaling by allowing multiple independent worker processes to consume the same queues.

```text
                 Queue
              /    |    \
             ▼     ▼     ▼
         Worker  Worker  Worker
```

Additional workers can be added without changing the producer application.

Infrastructure and process-level scaling remain the responsibility of the deployment environment.

---

## Graceful Shutdown

Workers must support graceful shutdown: stop claiming new jobs, allow active jobs to finish within configured limits, release locks, and exit cleanly. Interrupted jobs remain recoverable via the failure-recovery system. See [FEATURES.md → Graceful Shutdown](./FEATURES.md#graceful-shutdown).

---

## Monitoring

The package exposes queue, job, and worker states through events and query APIs that applications may use for observability. External monitoring infrastructure is outside the package's core responsibility. See [FEATURES.md → Event System](./FEATURES.md#event-system) and [FEATURES.md → Job Querying](./FEATURES.md#job-querying).

---

## Security

The package follows a secure-by-default approach: payloads are never logged, credentials stay in environment variables, and sensitive data is kept out of errors. Processor execution isolation is the responsibility of the deployment environment. See [FEATURES.md → Security Defaults](./FEATURES.md#security-defaults) and [SECURITY.md](./SECURITY.md).

---

## Extensibility

The architecture is built around modular and replaceable components. Primary extension points are storage adapters, retry/backoff strategies, scheduling mechanisms, and event integrations. Extensions should not require changes to the core queue-processing model.

---

## ADRs

**Architecture Decision Records (ADRs)** document significant architectural decisions and their rationale.

ADRs should be created for decisions such as:

* Storage architecture
* Locking and job-claim strategy
* Delivery semantics
* Retry behavior
* Scheduling model
* Worker execution model

Each ADR should document:

* Context
* Decision
* Alternatives considered
* Consequences