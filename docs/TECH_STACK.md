# Tech Stack

`queue-jobs-worker` is a TypeScript-first Node.js queue system built for reliable background job processing, retries, scheduling, and worker coordination.

## Stack

| Category | Technology | Purpose |
|---|---|---|
| Language | TypeScript | Strong typing and safer package development |
| Runtime | Node.js | Worker execution and background processing |
| Package manager | npm | Dependency and package management |
| Module format | ESM + CommonJS | Broad compatibility across Node.js environments |
| Build tool | tsup | Fast TypeScript bundling |
| Testing | Vitest | Unit and integration testing |
| Linting | ESLint | Code quality and consistency |
| Formatting | Prettier | Clean, consistent formatting |

## Storage Backends

The core queue logic is separated from storage by a `StorageAdapter` layer.

Supported:
- Redis
- PostgreSQL
- MySQL

Not currently included:
- MongoDB

## Design Principles

- Strong TypeScript typing
- Modular architecture
- Clear separation of queue, worker, and storage responsibilities
- Reliable locking and job state transitions
- Secure-by-default handling of credentials and payloads
- Minimal runtime overhead

## Compatibility

The package targets modern Node.js versions and ships with both ESM and CommonJS builds. The public API stays intentionally simple and runtime-agnostic where possible.

For the architecture and feature details, see [ARCHITECTURE.md](./ARCHITECTURE.md) and [FEATURES.md](../FEATURES.md).
