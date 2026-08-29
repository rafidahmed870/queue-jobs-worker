/**
 * Types for Queue configuration and queue-level options.
 */

import type { BackoffStrategy } from "./job.types.js";

// ---------------------------------------------------------------------------
// Rate limit configuration
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Maximum number of jobs to process within `duration`. */
  max: number;
  /** Time window in milliseconds. */
  duration: number;
}

// ---------------------------------------------------------------------------
// Queue configuration
// ---------------------------------------------------------------------------

export interface QueueOptions {
  /**
   * Maximum concurrent jobs processed across all workers of this queue.
   * Default: 10.
   */
  concurrency?: number;

  /** Default max attempts for jobs in this queue. */
  attempts?: number;

  /** Default base retry delay in ms for jobs in this queue. */
  retryDelay?: number;

  /** Default backoff strategy. */
  backoff?: BackoffStrategy;

  /** Default per-attempt timeout in ms. */
  timeout?: number;

  /** Queue-level rate limiting. */
  rateLimit?: RateLimitOptions;

  /**
   * Interval in ms between each poll cycle (how often the worker checks for
   * new jobs). Default: 1 000 ms.
   */
  pollInterval?: number;

  /**
   * Interval in ms between stalled-job recovery checks.
   * Default: 30 000 ms.
   */
  stalledInterval?: number;

  /**
   * How long a lock is valid before it is considered expired.
   * Default: 60 000 ms.
   */
  lockDuration?: number;
}
