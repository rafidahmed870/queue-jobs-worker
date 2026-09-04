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

## API Design

The public API is designed around a small set of primary abstractions: `QueueClient`, `Queue`, `Job`, `Worker`, `Processor`, and `StorageAdapter`.

For the full feature set (reliability mechanisms, scheduling, priority, rate limiting, concurrency, DLQ, events) see [FEATURES.md](./FEATURES.md). For component responsibilities and architecture diagrams see [ARCHITECTURE.md](./ARCHITECTURE.md).

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
