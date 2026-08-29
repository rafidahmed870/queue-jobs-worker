# ARCHITECTURE.md

## Introduction

**QUEUE-JOBS-WORKER** is a production-ready npm package for queue management and background job processing in Node.js applications.

It enables applications to execute asynchronous, time-consuming, or resource-intensive tasks outside the main request lifecycle using persistent queues and dedicated workers.

The package provides:

* Multiple independent queues
* User-defined job processors
* Worker-based job execution
* Concurrency control
* Retry and failure handling
* Delayed, scheduled, and recurring jobs
* Priority and rate limiting
* Worker lifecycle management

It is suitable for workloads such as email delivery, notifications, webhooks, file processing, media processing, report generation, and other asynchronous operations.

The package does not implement business logic. Users provide job processors, while **QUEUE-JOBS-WORKER** manages queueing, persistence, execution, reliability, and worker lifecycle.

---

## Goals & Requirements

### Goals

The primary goal is to provide reliable, fault-tolerant, scalable, and developer-friendly background job processing.

* Reliability and durability
* Multiple queue and worker support
* Configurable concurrency and resource control
* Retry and failure recovery
* Simple and extensible API
* Infrastructure-independent architecture

### Functional Requirements

* Multiple independent queues
* Job creation and lifecycle management
* User-defined processors
* Multiple job types
* Concurrent job processing
* Independent workers with configurable concurrency
* Retry and backoff handling
* Delayed, scheduled, and recurring jobs
* Priority and rate limiting
* Stalled-job detection and recovery
* Job and worker events
* Graceful worker shutdown

### Non-Functional Requirements

* Durable and consistent job state
* Safe concurrent execution
* Fault recovery
* Efficient resource usage
* Strong TypeScript support
* Modular architecture
* Secure-by-default design

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

    rateLimit: {
      max: 100,
      duration: 60000,
    },
  },
});
```

Default options may include:

* **`attempts`** — Maximum processing attempts for a job.
* **`retryDelay`** — Delay before a failed job is requeued.
* **`timeout`** — Maximum execution time allowed for one attempt.
* **`concurrency`** — Maximum number of jobs processed concurrently.
* **`rateLimit`** — Maximum number of processing operations allowed within a configured time window.

Queue-level and job-level configuration may override applicable defaults.

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

A **Job** represents a single unit of background work.

A job contains the information required to identify, execute, track, retry, and recover the work.

### Job Data

A job may contain:

* Unique job ID
* Queue name
* Job type
* Payload
* Status
* Attempt information
* Retry configuration
* Priority
* Scheduling information
* Timeout
* Failure history
* Lifecycle timestamps

Example:

```ts
await emails.enqueue("send-email", {
  to: "user@example.com",
});
```

### Job Identity

A job retains the same unique identity throughout its lifecycle.

Retrying or recovering a job does not create a new job identity.

```text
job_123
  │
  ├── Attempt 1
  ├── Attempt 2
  └── Attempt 3
```

Failed attempts are retained in the job's execution history.

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

### Requeue

A retryable job is returned to the queue as the **same job**, preserving its ID and failure history.

```text
Job A
 │
 ├── Attempt 1 → Failed
 ├── Requeue
 ├── Attempt 2 → Failed
 ├── Requeue
 └── Attempt 3 → Success
```

The requeued job follows the configured delay, priority, scheduling, and ordering rules.

### Dead Letter Queue

When a job exhausts its configured retry attempts, it is moved to the **Dead Letter Queue (DLQ)**.

The DLQ preserves permanently failed jobs for inspection or recovery.

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

The **Retry** system controls how failed jobs are attempted again.

A retryable failure requeues the existing job instead of creating a new one.

### Retry Configuration

Retry behavior may include:

* Maximum attempts
* Retry delay
* Backoff strategy

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

Each failed attempt is recorded in the job's failure history.

When no attempts remain, the job is moved to the **DLQ**.

---

## Failure Recovery

The **Failure Recovery** system handles jobs interrupted by worker or infrastructure failures.

An active job whose worker becomes unavailable must be detected and recovered.

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

### Responsibilities

* Detect stalled or abandoned jobs.
* Recover expired locks.
* Return recoverable jobs to the queue.
* Preserve execution history.
* Respect the configured retry policy.

Recovery may result in another processing attempt, consistent with the system's at-least-once delivery model.

---

## Scheduling

The **Scheduling** system controls when jobs become eligible for processing.

### Supported Scheduling

* **Delayed Jobs** — Become available after a specified delay.
* **Scheduled Jobs** — Become available at a specific time.
* **Recurring Jobs** — Repeat according to a configured schedule.

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

Jobs must not become eligible for processing before their scheduled execution time.

---

## Priority & Rate Limiting

### Priority

Priority determines the processing order of eligible jobs.

Higher-priority jobs are selected before lower-priority jobs when both are ready.

```text
Queue
├── Job A → Priority 10
├── Job B → Priority 2
└── Job C → Priority 5

Order:
A → C → B
```

Priority must remain consistent with scheduling and queue ordering rules.

### Rate Limiting

Rate limiting restricts the number of jobs processed within a defined time window.

```ts
rateLimit: {
  max: 100,
  duration: 60000,
}
```

This configuration allows up to **100 processing operations per 60 seconds** within the configured rate-limit scope.

When the limit is reached, eligible jobs remain queued until processing becomes available.

Rate limits may be configured as defaults and overridden at supported scopes.

---

## Events

The **Events** system exposes lifecycle events for jobs and workers.

Supported events may include:

* Job queued, started, completed, failed, retried, and moved to DLQ
* Worker started, stopped, and errored
* Queue lifecycle events

Events allow applications to integrate their own logging and observability systems.

---

## Concurrency

The **Concurrency** system controls the number of jobs processed simultaneously.

Concurrency may be configured through client defaults and overridden at queue or worker level.

```ts
const worker = queue.createWorker({
  concurrency: 10,
});
```

Concurrent workers must coordinate through the storage and locking mechanisms to prevent duplicate job ownership.

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

Workers must support graceful shutdown.

During shutdown, a worker should:

1. Stop claiming new jobs.
2. Allow active jobs to finish within configured limits.
3. Release required resources and locks.
4. Exit cleanly.

Interrupted jobs remain recoverable according to the failure-recovery policy.

---

## Monitoring

The package exposes queue, job, worker states, and lifecycle events that applications may use for observability.

Available information may include:

* Queue and job states
* Worker state
* Processing and failure information
* Retry and DLQ information

External monitoring infrastructure is outside the package's core responsibility.

---

## Security

The package follows a secure-by-default approach.

Key considerations include:

* Secure storage connections
* Secure credential handling
* Job payload validation
* Controlled queue access
* Safe handling of processor errors
* Avoiding sensitive data in logs and failure history

Processor execution isolation is the responsibility of the deployment environment when untrusted code or workloads are involved.

---

## Extensibility

The architecture is built around modular and replaceable components.

Primary extension points include:

* Storage adapters
* Retry and backoff strategies
* Scheduling mechanisms
* Queue and worker configuration
* Event integrations

Extensions should not require changes to the core queue-processing model.

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