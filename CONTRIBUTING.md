# Contributing to QUEUE-JOBS-WORKER

Thank you for your interest in contributing to **QUEUE-JOBS-WORKER**! We welcome all contributions including bug fixes, feature implementations, documentation improvements, unit tests, and performance optimizations.

Please take a moment to review this guide before submitting a pull request or opening an issue.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment & Prerequisites](#development-environment--prerequisites)
- [Available Scripts & Tooling](#available-scripts--tooling)
- [Architecture & Design Rules](#architecture--design-rules)
- [Queue & Worker Implementation Guidelines](#queue--worker-implementation-guidelines)
- [Adding New Storage Adapters](#adding-new-storage-adapters)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Conventions](#commit-message-conventions)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Handling Breaking Changes](#handling-breaking-changes)
- [Reporting Issues & Bug Reports](#reporting-issues--bug-reports)
- [Security Vulnerabilities](#security-vulnerabilities)
- [Contributor Checklist](#contributor-checklist)

---

## Code of Conduct

All contributors and maintainers are expected to uphold a professional and respectful environment.
- Be polite, constructive, and respectful in code reviews, discussions, and issue trackers.
- Personal attacks, harassment, offensive comments, or unprofessional behavior will not be tolerated.

---

## Getting Started

Follow these steps to set up your local development workflow:

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/queue-jobs-worker.git
   cd queue-jobs-worker
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a feature branch**:
   ```bash
   git checkout -b feature/my-new-feature
   ```
5. **Implement your changes**, ensuring all tests, linting, and type checks pass.
6. **Commit and push** your branch to GitHub.
7. **Open a Pull Request** against the `main` branch.

---

## Development Environment & Prerequisites

### System Requirements

- **Node.js**: `>=18.0.0`
- **npm**: `>=9.0.0`
- **Git**: Latest stable version

### Optional Services (For Database Adapter Testing)

If you are developing or testing specific storage adapters, ensure you have access to:
- **Redis** (`>=4.0.0`)
- **PostgreSQL** (`>=8.0.0`)
- **MySQL** (`>=3.0.0`)

You can easily run these services locally using Docker or Docker Compose if needed.

---

## Available Scripts & Tooling

The project uses `tsup` for bundling, `Vitest` for testing, `ESLint` for linting, `Prettier` for formatting, `TypeScript` for type checking, and `Husky` for git hooks.

### Core NPM Commands

| Command | Description |
|---|---|
| `npm run build` | Builds CommonJS (`.cjs`), ESM (`.js`), and TypeScript declaration files (`.d.ts`) into `dist/` |
| `npm run dev` | Runs `tsup` in watch mode for development |
| `npm test` | Runs the full Vitest unit & integration test suite once |
| `npm run test:watch` | Runs Vitest in interactive watch mode |
| `npm run test:coverage` | Generates code coverage reports |
| `npm run typecheck` | Runs `tsc --noEmit` to verify strict TypeScript types |
| `npm run lint` | Runs ESLint across the codebase |
| `npm run lint:fix` | Automatically fixes auto-fixable ESLint issues |
| `npm run format` | Formats all `.ts` files using Prettier |
| `npm run format:check` | Verifies code formatting with Prettier without modifying files |

---

## Architecture & Design Rules

Before making any architectural or structural modifications, read the core documentation:

* [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Comprehensive architectural overview, lifecycle diagrams, and subsystem roles.
* [`docs/RULES.md`](./docs/RULES.md) — Core principles and system invariants.
* [`docs/INSTRUCTIONS.md`](./docs/INSTRUCTIONS.md) — Developer workflow and change instructions.
* [`docs/TECH_STACK.md`](./docs/TECH_STACK.md) — Technologies, dependencies, and design principles.

### Key Invariants

1. **Separation of Concerns**: Core queue and worker logic must never import database-specific packages. All persistence operations must go through the `StorageAdapter` interface.
2. **Modular Components**: Keep `QueueClient`, `Queue`, `Job`, `Worker`, `Processor`, `StorageAdapter`, and `QueueEventEmitter` cleanly separated.
3. **Minimal External Dependencies**: Avoid adding new runtime dependencies unless strictly required and approved.

---

## Queue & Worker Implementation Guidelines

When working on job processing or worker concurrency:

- **Stable Job Identity**: A job's `id` must remain unchanged across retries and failure recoveries. Never recreate or clone a job ID when re-enqueueing or requeueing.
- **Atomic Job Claiming**: Worker job claims must be strictly atomic. Two workers must never claim the same job simultaneously.
- **Distributed Locking & Expiration**: Locks must have explicit expiration (`lockDuration`) and be recoverable via `recoverStalledJobs()`.
- **Failure History Preservation**: Every attempt, error message, and stack trace must be preserved in `job.attemptHistory`.
- **Rate Limiting**: Quota must only be consumed when a job is successfully claimed for execution—never on empty-queue polling cycles.
- **Graceful Shutdown**: `worker.stop()` and `client.close()` must stop polling, wait for in-flight jobs up to `shutdownTimeout`, and clean up locks/connections safely without data loss.

---

## Adding New Storage Adapters

New storage providers (e.g., MongoDB, SQLite, DynamoDB) must be implemented behind the `StorageAdapter` interface:

1. Create a dedicated file under `src/storage/<name>.adapter.ts`.
2. Export the adapter from `src/storage/index.ts`.
3. Ensure all atomic operations (`claim`, `checkAndIncrementRateLimit`) use native atomic primitives (e.g., Lua scripts, `FOR UPDATE SKIP LOCKED`, or atomic transactions).
4. Add comprehensive unit and integration tests in `tests/<name>-adapter.test.ts`.
5. Update [`README.md`](./README.md), [`FEATURES.md`](./FEATURES.md), and [`docs/TECH_STACK.md`](./docs/TECH_STACK.md) matrix upon completion.

---

## Testing Guidelines

All contributions must include appropriate automated tests.

- **Location**: Store tests in the `tests/` directory with a `.test.ts` extension.
- **Coverage Requirements**: Include tests for:
  - Normal execution path (happy path)
  - Failure modes, retries, and backoff strategies (`fixed`, `linear`, `exponential`)
  - Edge cases (null/undefined payloads, timeout handling, expired locks)
  - Concurrency and race conditions (simultaneous workers claiming jobs)
  - Dead-letter queue (DLQ) state transitions
- **Running Specific Tests**:
  ```bash
  npx vitest run tests/worker.test.ts
  ```

---

## Commit Message Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short summary>
```

### Allowed Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `perf`: A code change that improves performance
- `chore`: Maintenance, dependencies, or configuration updates

### Examples

```text
feat(worker): add support for custom poll intervals
fix(storage): prevent rate-limit quota consumption on empty poll cycles
docs(readme): add MySQL storage configuration example
test(backoff): add unit tests for exponential backoff cap
```

---

## Submitting a Pull Request

Before submitting your PR, ensure you have completed the following steps:

1. **Keep PRs Focused**: Each PR should address a single feature, bug fix, or improvement.
2. **Run Quality Checks**:
   ```bash
   npm run format
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```
3. **Fill Out the PR Description**: Describe what was changed, why it was changed, and how it was tested. Refer to any associated issue numbers (e.g., `Fixes #12`).
4. **Respond to Code Review**: Maintainers may request changes or clarifications. Address feedback promptly.

---

## Handling Breaking Changes

Treat the public API as stable. Avoid breaking changes whenever possible.

If a breaking change is unavoidable:
1. Clearly justify the breaking change in the PR description.
2. Highlight migration steps for existing users.
3. Update relevant TypeScript definitions and public exports in `src/index.ts`.

---

## Reporting Issues & Bug Reports

Before opening an issue on GitHub Issues:
- Search existing open and closed issues to avoid duplicates.
- Ensure you are using the latest version of `queue-jobs-worker`.

When submitting a bug report, please include:
- **Package Version**: (e.g., `1.0.1`)
- **Node.js Version**: (e.g., `v20.11.0`)
- **Storage Backend**: (e.g., `memory`, `redis`, `postgres`, `mysql`)
- **Reproduction Steps**: Minimal reproducible code example.
- **Expected vs Actual Behavior**
- **Error Stack Trace** (do not include passwords, connection strings, or sensitive payloads)

---

## Security Vulnerabilities

Please **do not** report security vulnerabilities via public GitHub issues.

Follow our security reporting guidelines documented in [`SECURITY.md`](./SECURITY.md).

---

## Contributor Checklist

Before submitting your pull request, double-check this list:

- [ ] Code adheres to project design rules in [`docs/RULES.md`](./docs/RULES.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- [ ] TypeScript strict mode passes with `npm run typecheck`.
- [ ] Code linting passes with `npm run lint`.
- [ ] Code formatting is verified with `npm run format:check`.
- [ ] All Vitest tests pass with `npm test`.
- [ ] Package builds successfully with `npm run build`.
- [ ] Unit/integration tests are added or updated for new code.
- [ ] Documentation (`README.md`, `CONTRIBUTING.md`, or `docs/`) is updated if API/behavior changed.
- [ ] Commit messages follow Conventional Commits format.
- [ ] No secrets, credentials, or sensitive data are committed.

