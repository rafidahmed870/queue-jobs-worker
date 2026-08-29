# INSTRUCTIONS.md

## Purpose

This document defines how **QUEUE-JOBS-WORKER** should be developed, modified, tested, and maintained.

All development work must follow the architecture and rules defined in `ARCHITECTURE.md` and `RULES.md`.

---

## 1. Before Making Changes

Before modifying the codebase:

* Understand the existing architecture.
* Identify the affected components.
* Check existing interfaces and public APIs.
* Avoid changing unrelated components.
* Consider concurrency, failure, and recovery implications.

---

## 2. Architecture First

When implementing a feature:

1. Identify the correct architectural layer.
2. Keep responsibilities within that layer.
3. Prefer existing abstractions over introducing new ones.
4. Avoid coupling components unnecessarily.
5. Keep storage-specific logic inside storage adapters.

Do not bypass established abstractions without a clear architectural reason.

---

## 3. Public API

When modifying the public API:

* Keep the API minimal and predictable.
* Preserve backward compatibility where possible.
* Use strong TypeScript types.
* Avoid exposing internal implementation details.
* Document intentional breaking changes.

---

## 4. Job Processing

Job processing implementations must:

* Preserve job identity across retries.
* Maintain valid lifecycle transitions.
* Record failed attempts.
* Respect timeout, retry, priority, and scheduling configuration.
* Never silently discard a job.

---

## 5. Concurrency & Reliability

Any change affecting workers or queue operations must consider:

* Concurrent workers
* Atomic job claiming
* Distributed locking
* Race conditions
* Worker crashes
* Stalled jobs
* Retry behavior
* Graceful shutdown

Correctness must take priority over optimization.

---

## 6. Storage

Storage-related changes must:

* Use the `StorageAdapter` abstraction.
* Avoid provider-specific logic in the core.
* Preserve atomicity where required.
* Maintain consistent job state.
* Include adapter-level tests.

New storage providers must not be considered officially supported until properly implemented and tested.

---

## 7. Testing

Before considering a change complete:

* Add or update relevant tests.
* Test normal execution.
* Test failure scenarios.
* Test retry behavior where applicable.
* Test concurrency-sensitive behavior.
* Test recovery behavior for worker/storage failures.

All existing tests should continue to pass.

---

## 8. Error Handling

Errors must be:

* Explicit
* Actionable
* Properly typed where applicable
* Safe to expose

Do not swallow errors silently.

Never include secrets, credentials, or sensitive job payloads in errors or logs.

---

## 9. Performance

Performance optimizations must not compromise correctness.

Before optimizing:

* Identify the actual bottleneck.
* Measure where practical.
* Prefer simple solutions.
* Avoid unnecessary dependencies.
* Consider memory usage and worker concurrency.

---

## 10. Documentation

Update documentation when changes affect:

* Public APIs
* Configuration
* Supported storage
* Job lifecycle
* Retry behavior
* Worker behavior
* Architecture
* Security

Significant architectural decisions should have an ADR.

---

## 11. Code Style

Follow the project's configured:

* TypeScript conventions
* ESLint rules
* Prettier formatting
* Naming conventions
* Testing conventions

Keep modules focused and avoid unnecessary complexity.

---

## 12. Change Verification

Before finalizing a change:

1. Run formatting checks.
2. Run linting.
3. Run type checking.
4. Run relevant tests.
5. Run the full test suite when appropriate.
6. Review the public API for unintended changes.
7. Update documentation if required.

---

## 13. General Development Principle

**Understand → Design → Implement → Test → Verify → Document**

Every change should preserve the system's core properties:

**Reliability · Consistency · Safety · Scalability · Maintainability**
