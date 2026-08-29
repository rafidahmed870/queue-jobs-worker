# CONTRIBUTING.md

# Contributing to QUEUE-JOBS-WORKER

Thank you for contributing to **QUEUE-JOBS-WORKER**.

Contributions are welcome, including bug fixes, improvements, documentation, tests, and new features.

---

## Getting Started

Before contributing:

1. Fork the repository.
2. Clone your fork.
3. Install dependencies.
4. Create a dedicated branch.
5. Make your changes.
6. Run the required checks.
7. Open a pull request.

---

## Development Setup

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Run type checking:

```bash
npm run typecheck
```

Run linting:

```bash
npm run lint
```

Build the package:

```bash
npm run build
```

Use the project's existing scripts when available rather than introducing duplicate tooling.

---

## Branching

Create a dedicated branch for each change.

Recommended format:

```text
feature/<name>
fix/<name>
refactor/<name>
docs/<name>
test/<name>
chore/<name>
```

Avoid making unrelated changes in the same branch.

---

## Code Guidelines

Contributions must:

* Follow `ARCHITECTURE.md`.
* Follow `RULES.md`.
* Follow `INSTRUCTIONS.md`.
* Use TypeScript conventions already established in the project.
* Keep changes focused and minimal.
* Avoid unnecessary dependencies.
* Preserve existing public APIs where possible.

---

## Queue & Worker Changes

Changes involving queue processing require additional care.

Consider:

* Job lifecycle consistency
* Atomic job claiming
* Distributed locking
* Concurrent workers
* Retry and backoff behavior
* Stalled-job recovery
* DLQ behavior
* Graceful shutdown
* Storage consistency

Any change that can cause job loss or duplicate processing requires thorough testing.

---

## Storage Contributions

New storage support should be implemented through the `StorageAdapter` abstraction.

Storage-specific logic must remain isolated from the core queue system.

A new storage adapter should include:

* Adapter implementation
* Required tests
* Configuration documentation
* Any required dependencies

A storage provider should not be documented as officially supported until the implementation is stable and tested.

---

## Testing

New functionality should include appropriate tests.

At minimum, test:

* Expected behavior
* Failure behavior
* Edge cases
* Concurrency-sensitive behavior where applicable

Bug fixes should include a regression test when practical.

---

## Commit Messages

Use clear and consistent commit messages.

Recommended format:

```text
type: description
```

Examples:

```text
feat: add delayed job support
fix: recover stalled jobs correctly
refactor: simplify worker lifecycle
test: add retry failure cases
docs: update storage documentation
chore: update dependencies
```

Keep commits focused and avoid unrelated changes.

---

## Pull Requests

Pull requests should:

* Clearly describe the change.
* Explain why the change is needed.
* Include relevant tests.
* Mention breaking changes.
* Update documentation when necessary.
* Keep unrelated modifications out of the PR.

For significant architectural changes, include or reference an appropriate ADR.

---

## Breaking Changes

Breaking changes must be clearly identified.

They should include:

* What changed
* Why it changed
* Migration requirements
* API or behavior differences

Do not introduce breaking changes without documenting their impact.

---

## Issues & Bug Reports

Before opening an issue:

* Search existing issues.
* Confirm the issue is reproducible.
* Use the latest supported version when possible.

Bug reports should include:

* Package version
* Node.js version
* Storage dialect
* Minimal reproduction
* Expected behavior
* Actual behavior
* Relevant error output

Do not include credentials, secrets, or sensitive job data.

---

## Security Issues

Do not report security vulnerabilities through public issues.

Follow the security reporting process defined in `SECURITY.md`.

---

## Documentation

Documentation contributions are welcome.

Keep documentation:

* Accurate
* Concise
* Consistent with the implementation
* Clear about supported and unsupported features

Architectural documentation should be updated when the architecture changes.

---

## Contributor Checklist

Before submitting a PR:

* [ ] Code follows project architecture.
* [ ] Tests added or updated.
* [ ] Type checking passes.
* [ ] Linting passes.
* [ ] Build succeeds.
* [ ] Documentation updated if required.
* [ ] No secrets or sensitive data included.
* [ ] Changes are focused and reviewable.

---

## Code of Conduct

All contributors are expected to communicate professionally and respectfully.

Harassment, discrimination, personal attacks, and disruptive behavior are not acceptable.
