# RULES.md

## Purpose

This document defines the development and implementation rules for **QUEUE-JOBS-WORKER**.

All contributions and architectural changes should follow these rules.

---

## 1. Architecture

* Keep core components modular and loosely coupled.
* Do not couple core queue logic to a specific storage provider.
* Use interfaces and adapters for replaceable infrastructure.
* Keep responsibilities separated between QueueClient, Queue, Job, Worker, Storage, and Processor.
* Avoid unnecessary abstractions and dependencies.

---

## 2. Queue Rules

* Queue names must be unique within a client.
* Queues must remain independently configurable.
* Jobs must only be processed by their assigned queue.
* Queue operations must preserve job state consistency.
* Enqueue, dequeue/claim, and requeue operations must be safe under concurrency.

---

## 3. Job Rules

* Every job must have a unique and stable identity.
* Retries must never create a new job.
* Job state transitions must be explicit and valid.
* Attempt information and failure history must be preserved.
* Job payloads must not be logged by default.

---

## 4. Worker Rules

* Workers must respect configured concurrency.
* Workers must claim jobs atomically.
* A worker must not process the same job concurrently.
* Workers must support graceful shutdown.
* Interrupted jobs must remain recoverable.
* Workers must never silently discard jobs.

---

## 5. Retry & Failure Rules

* Failed jobs must be requeued when attempts remain.
* Retry delays and backoff policies must be respected.
* Failed attempts must be recorded.
* Jobs that exhaust their attempts must move to the DLQ.
* Retry logic must not create duplicate job identities.

---

## 6. Storage Rules

* Core logic must interact with storage only through adapters.
* Storage operations must use atomic mechanisms where required.
* Storage adapters must maintain consistent job state.
* Provider-specific behavior must remain inside the adapter.
* Unsupported storage providers must not be presented as officially supported.

---

## 7. Concurrency & Locking

* Job claiming must be atomic.
* Locks must prevent concurrent ownership of the same job.
* Locks must support expiration and recovery.
* Race conditions must be handled explicitly.
* Distributed workers must operate safely against shared storage.

---

## 8. Configuration

Configuration should follow this precedence:

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

## 9. Security

* Never expose credentials or secrets in logs.
* Never hard-code sensitive credentials.
* Do not log job payloads unless explicitly enabled.
* Validate externally supplied configuration and job data.
* Do not execute untrusted processors in the worker runtime.
* Avoid exposing sensitive information through errors.

---

## 10. TypeScript & Code Quality

* Use strict TypeScript typing.
* Avoid `any` unless explicitly justified.
* Prefer small, testable modules.
* Keep public APIs stable and predictable.
* Use clear and consistent naming.
* Avoid unnecessary runtime dependencies.

---

## 11. Testing

Every core behavior should have automated tests where practical.

Critical areas include:

* Queue operations
* Job lifecycle
* Job claiming
* Locking
* Concurrency
* Retry and backoff
* Failure recovery
* Scheduling
* DLQ behavior
* Graceful shutdown
* Storage adapters

Concurrency and failure scenarios should be tested explicitly.

---

## 12. API Compatibility

* Avoid breaking public APIs without a documented reason.
* Prefer backward-compatible changes.
* Document intentional breaking changes.
* Keep public interfaces minimal.
* Do not expose internal implementation details unnecessarily.

---

## 13. Dependencies

* Keep dependencies minimal.
* Prefer well-maintained dependencies.
* Avoid dependencies when native Node.js functionality is sufficient.
* Review dependencies for security and maintenance risks.
* Storage-specific dependencies should remain isolated from the core.

---

## 14. Documentation

Architectural changes must be reflected in the appropriate documentation.

Significant architectural decisions should be recorded as ADRs.

Documentation must clearly distinguish between:

* Supported features
* Unsupported features
* Optional features
* User responsibilities

---

## 15. General Rule

**Reliability and correctness take priority over convenience.**

Any implementation that can cause job loss, duplicate processing, corrupted state, or unsafe concurrency must be treated as a critical issue.
