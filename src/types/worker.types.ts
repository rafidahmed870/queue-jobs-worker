/**
 * Types for Worker configuration, processor functions, and worker state.
 */

import type { Job } from "../core/job.js";

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * A user-supplied function that handles a single job.
 *
 * Must resolve to indicate success.
 * Throwing (or rejecting) marks the job as failed for this attempt.
 */
export type Processor<TPayload = unknown> = (job: Job<TPayload>) => Promise<void>;

// ---------------------------------------------------------------------------
// Worker options
// ---------------------------------------------------------------------------

export interface WorkerOptions {
  /**
   * Maximum number of jobs processed concurrently by this worker.
   * Overrides the queue-level concurrency setting.
   */
  concurrency?: number;

  /**
   * How long to wait for active jobs to finish during graceful shutdown (ms).
   * Default: 30 000 ms.
   */
  shutdownTimeout?: number;
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

export type WorkerStatus = "idle" | "running" | "stopping" | "stopped";
