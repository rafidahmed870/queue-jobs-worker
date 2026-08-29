/**
 * queue-jobs-worker
 *
 * Reliable job queue and background worker system for Node.js.
 *
 * Quick start:
 *
 *   import { QueueClient } from "queue-jobs-worker";
 *
 *   // In-memory (dev / tests)
 *   const client = new QueueClient();
 *
 *   // Redis
 *   const client = new QueueClient({ dialect: "redis", connectionString: "redis://localhost:6379" });
 *   await client.init();
 *
 *   // PostgreSQL
 *   const client = new QueueClient({ dialect: "postgres", connectionString: "postgresql://..." });
 *   await client.init();
 *
 *   // MySQL
 *   const client = new QueueClient({ dialect: "mysql", connectionString: "mysql://..." });
 *   await client.init();
 *
 * @module queue-jobs-worker
 */

// Core
export { QueueClient } from "./core/client.js";
export { Queue } from "./core/queue.js";
export { Job } from "./core/job.js";
export { Worker } from "./core/worker.js";

// Storage adapters
export { InMemoryStorageAdapter } from "./storage/in-memory.adapter.js";
export { RedisStorageAdapter } from "./storage/redis.adapter.js";
export { PostgreSQLStorageAdapter } from "./storage/postgres.adapter.js";
export { MySQLStorageAdapter } from "./storage/mysql.adapter.js";

// Event emitter
export { QueueEventEmitter } from "./events/emitter.js";

// Utilities
export { calculateBackoff, nextRunAt } from "./core/backoff.js";
export { generateJobId } from "./core/id.js";

// All public types
export type {
  JobStatus,
  JobAttempt,
  JobSchedule,
  JobOptions,
  BackoffStrategy,
  JobData,
  RateLimitOptions,
  QueueOptions,
  Processor,
  WorkerOptions,
  WorkerStatus,
  StorageAdapter,
  EnqueueInput,
  ClaimInput,
  ClaimResult,
  RequeueInput,
  MoveToDlqInput,
  GetJobsFilter,
  StorageDialect,
  ClientDefaults,
  QueueClientOptions,
  QueueEvents,
} from "./types/index.js";
