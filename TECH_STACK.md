# TECH_STACK.md

## Overview

**QUEUE-JOBS-WORKER** is a TypeScript-based Node.js package designed for reliable background job processing, persistent queues, and distributed workers.

The stack is selected to prioritize reliability, type safety, portability, performance, and extensibility.

---

## Core Stack

| Category        | Technology     | Purpose                                        |
| --------------- | -------------- | ---------------------------------------------- |
| Language        | TypeScript     | Type-safe package development                  |
| Runtime         | Node.js        | Job execution and worker runtime               |
| Package Manager | npm            | Package distribution and dependency management |
| Module System   | ESM + CommonJS | Broad Node.js compatibility                    |
| Build Tool      | tsup           | Fast TypeScript bundling                       |
| Testing         | Vitest         | Unit and integration testing                   |
| Linting         | ESLint         | Code quality and consistency                   |
| Formatting      | Prettier       | Consistent code formatting                     |

---

## Storage

The queue system uses a **Storage Adapter** abstraction so the core architecture remains independent of a specific storage technology.

### Currently Supported

* Redis
* PostgreSQL
* MySQL

### Currently Unsupported

* MongoDB

MongoDB may be considered for future support through a dedicated storage adapter.

Storage implementations are responsible for persistence, atomic queue operations, job state management, and recovery-related data.

---

## Queue Architecture

The queue layer consists of:

* **QueueClient** — Client configuration and queue management.
* **Queue** — Independent job stream and queue configuration.
* **Job** — Unit of background work and lifecycle state.
* **Worker** — Job claiming and processor execution.
* **Processor** — User-defined job logic.
* **Storage Adapter** — Storage abstraction.
* **Dead Letter Queue** — Permanently failed jobs.

---

## Reliability

Reliability mechanisms are implemented at the queue and worker layers:

* Persistent job state
* Atomic job claiming
* Distributed locking
* Retry and backoff
* Job timeout
* Stalled-job recovery
* Dead Letter Queue
* Graceful worker shutdown

---

## Scheduling & Control

The system supports:

* Delayed jobs
* Scheduled jobs
* Recurring jobs
* Job priority
* Concurrency limits
* Rate limiting

These features are configurable through the client, queue, worker, or job where applicable.

---

## API Design

The public API is designed around a small set of primary abstractions:

```ts
QueueClient
Queue
Job
Worker
Processor
StorageAdapter
```

Configuration follows a layered model:

```text
Client Defaults
      ↓
Queue Configuration
      ↓
Worker Configuration
      ↓
Job Configuration
```

More specific configuration overrides broader defaults where supported.

---

## Development Principles

The implementation should follow:

* Strong TypeScript typing
* Modular architecture
* Low coupling between components
* Storage abstraction
* Explicit lifecycle management
* Secure-by-default practices
* Testable core components
* Minimal runtime overhead

---

## Compatibility

The package targets modern Node.js environments and is distributed with both **ESM** and **CommonJS** builds.

The public API should remain runtime-agnostic wherever possible and avoid unnecessary platform-specific dependencies.
