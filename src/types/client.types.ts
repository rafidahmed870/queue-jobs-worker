/**
 * Types for QueueClient configuration and supported storage dialects.
 */

import type { BackoffStrategy } from "./job.types.js";
import type { RateLimitOptions } from "./queue.types.js";

// ---------------------------------------------------------------------------
// Supported storage dialects
// ---------------------------------------------------------------------------

export type StorageDialect = "memory" | "redis" | "postgres" | "mysql";

// ---------------------------------------------------------------------------
// Client-level defaults
// ---------------------------------------------------------------------------

export interface ClientDefaults {
  /** Default max attempts for all queues/jobs. Default: 3. */
  attempts?: number;

  /** Default base retry delay in ms. Default: 1 000. */
  retryDelay?: number;

  /** Default backoff strategy. Default: "exponential". */
  backoff?: BackoffStrategy;

  /** Default per-attempt timeout in ms. Default: 30 000. */
  timeout?: number;

  /** Default worker concurrency. Default: 10. */
  concurrency?: number;

  /** Default rate limiting. */
  rateLimit?: RateLimitOptions;

  /** Default polling interval in ms. Default: 1 000. */
  pollInterval?: number;

  /** Default stalled-job check interval in ms. Default: 30 000. */
  stalledInterval?: number;

  /** Default lock duration in ms. Default: 60 000. */
  lockDuration?: number;
}

// ---------------------------------------------------------------------------
// QueueClient options
// ---------------------------------------------------------------------------

export interface QueueClientOptions {
  /**
   * Storage backend to use.
   * Default: "memory" (in-process, non-persistent — for development/testing).
   */
  dialect?: StorageDialect;

  /**
   * Connection string for the selected storage backend.
   * Not required for the "memory" dialect.
   */
  connectionString?: string;

  /** Global defaults applied to all queues and workers. */
  defaults?: ClientDefaults;
}
