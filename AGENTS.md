# AGENTS.md

# QUEUE-JOBS-WORKER — Agent Instructions

This document defines the instructions for AI coding agents working on **QUEUE-JOBS-WORKER**.

## 1. Project Context

**QUEUE-JOBS-WORKER** is a production-oriented Node.js/TypeScript package for persistent background job processing.

Core concepts:

* `QueueClient`
* `Queue`
* `Job`
* `Worker`
* `Processor`
* `StorageAdapter`
* Locking
* Retry & Backoff
* Failure Recovery
* Scheduling
* Priority & Rate Limiting
* Dead Letter Queue

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before making architectural changes.

---

## 2. Required Instructions

Before modifying code:

1. Inspect the relevant implementation.
2. Understand existing abstractions.
3. Check related tests.
4. Follow [`RULES.md`](./RULES.md).
5. Follow [`INSTRUCTIONS.md`](./INSTRUCTIONS.md).
6. Make the smallest appropriate change.

Do not redesign unrelated parts of the system.

---

## 3. Architecture Rules

* Keep core queue logic independent of storage providers.
* Use `StorageAdapter` for storage operations.
* Keep queue, job, worker, and processor responsibilities separated.
* Prefer existing abstractions over introducing new ones.
* Avoid unnecessary dependencies.
* Do not bypass locking or atomic storage operations.

---

## 4. Job Processing

When modifying job processing:

* Preserve stable job identity across retries.
* Maintain valid job state transitions.
* Preserve attempt and failure history.
* Respect timeout, retry, scheduling, priority, and rate-limit configuration.
* Never silently discard jobs.
* Do not recreate a job when retrying.

---

## 5. Worker & Concurrency

Worker-related changes must consider:

* Concurrent workers
* Atomic job claiming
* Lock ownership
* Lock expiration
* Stalled jobs
* Worker crashes
* Graceful shutdown
* Duplicate processing

Any change affecting concurrency must include appropriate tests.

---

## 6. Storage

Storage implementations must remain behind the `StorageAdapter`.

When adding or modifying an adapter:

* Keep provider-specific logic isolated.
* Preserve atomic operations where required.
* Maintain consistent job state.
* Add adapter-specific tests.
* Do not claim support for an untested provider.

---

## 7. Public API

Treat the public API as stable.

Before changing it:

* Check existing usage and tests.
* Prefer backward-compatible changes.
* Preserve strong TypeScript typing.
* Avoid exposing internal implementation details.
* Document intentional breaking changes.

---

## 8. Testing & Verification

After making changes, run the relevant checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

If a script does not exist, use the project's available equivalent.

For reliability-related changes, test failure and concurrency scenarios explicitly.

---

## 9. Security

Never:

* Expose secrets or credentials.
* Log sensitive job payloads by default.
* Hard-code connection credentials.
* Execute untrusted processors.
* Include sensitive information in errors.

Follow [`SECURITY.md`](./SECURITY.md) for security-related work.

---

## 10. Documentation

Update documentation when changes affect:

* Public API
* Configuration
* Architecture
* Supported storage
* Job lifecycle
* Retry behavior
* Worker behavior
* Security

Significant architectural decisions should be documented through ADRs.

---

## 11. Change Discipline

Keep changes:

* Focused
* Minimal
* Testable
* Backward-compatible where possible
* Consistent with the existing architecture

Do not perform unrelated refactoring while implementing a feature or bug fix.

---

## 12. Agent Workflow

Use this workflow for every task:

```text
Understand
   ↓
Inspect
   ↓
Plan
   ↓
Implement
   ↓
Test
   ↓
Verify
   ↓
Document
```

**Correctness, reliability, and data safety take priority over implementation speed.**
