# Instructions

Follow the architecture and rules in [ARCHITECTURE.md](./ARCHITECTURE.md) and [RULES.md](./RULES.md) before changing the codebase.

## Before You Change Code

- Understand the current design and affected components.
- Check the existing interfaces and public API.
- Keep changes focused and avoid unrelated refactors.
- Think through reliability, concurrency, retries, and recovery impact.

## Design Rules

- Keep responsibilities in the correct layer.
- Prefer existing abstractions over new ones.
- Keep storage-specific logic inside storage adapters.
- Do not bypass established locking or state transitions.

## Public API

- Keep the API simple and predictable.
- Preserve backward compatibility when possible.
- Use clear TypeScript types.
- Avoid exposing internals.
- Document intentional breaking changes.

## Job and Worker Safety

- Preserve job identity across retries.
- Keep lifecycle transitions valid.
- Record failed attempts and retry data.
- Respect timeout, priority, scheduling, and retry configuration.
- Never silently drop a job.
- Consider concurrency, lock ownership, stalled jobs, and graceful shutdown.

## Storage

- Use the `StorageAdapter` abstraction.
- Keep provider-specific code isolated.
- Preserve atomic operations where required.
- Maintain consistent job state.
- Add or update adapter tests for storage-related changes.

## Testing

Before a change is considered complete:

- add or update the relevant tests
- cover normal flows and failure paths
- include retry and concurrency checks where applicable
- verify recovery behavior when workers or storage fail
- keep the full existing test suite passing when appropriate

## Error Handling

- Fail clearly and explicitly.
- Avoid swallowing errors silently.
- Do not leak secrets, credentials, or sensitive payloads in logs or errors.

## Documentation

Update docs when a change affects:

- public API
- configuration
- storage support
- job lifecycle
- retry behavior
- worker behavior
- architecture or security

## Verification

Before finishing work, check:

1. formatting
2. linting
3. type checking
4. relevant tests
5. broader validation when needed

## Working Principle

Understand → Design → Implement → Test → Verify → Document

The system should stay reliable, consistent, safe, and maintainable.
