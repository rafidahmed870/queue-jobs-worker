/**
 * Types for the StorageAdapter abstraction.
 */

import type { JobData, JobStatus, BackoffStrategy } from "./job.types.js";

// ---------------------------------------------------------------------------
// Enqueue input
// ---------------------------------------------------------------------------

export interface EnqueueInput<TPayload = unknown> {
  id: string;
  queue: string;
  type: string;
  payload: TPayload;
  maxAttempts: number;
  retryDelay: number;
  backoff: BackoffStrategy;
  timeout: number;
  priority: number;
  runAt: string;
  cron?: string | undefined;
}

// ---------------------------------------------------------------------------
// Claim input / output
// ---------------------------------------------------------------------------

export interface ClaimInput {
  queue: string;
  lockId: string;
  lockDuration: number;
  now: string;
}

export interface ClaimResult<TPayload = unknown> {
  job: JobData<TPayload>;
}

// ---------------------------------------------------------------------------
// Requeue input
// ---------------------------------------------------------------------------

export interface RequeueInput {
  jobId: string;
  runAt: string;
  error: string;
  stack?: string | undefined;
  /** 1-based attempt number that just failed (used to populate attempt history). */
  attemptNumber: number;
}

// ---------------------------------------------------------------------------
// DLQ move input
// ---------------------------------------------------------------------------

export interface MoveToDlqInput {
  jobId: string;
  error: string;
  stack?: string | undefined;
  /** 1-based attempt number that just failed (used to populate attempt history). */
  attemptNumber: number;
}

// ---------------------------------------------------------------------------
// Job filters
// ---------------------------------------------------------------------------

export interface GetJobsFilter {
  queue?: string | undefined;
  status?: JobStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// ---------------------------------------------------------------------------
// Storage Adapter interface
// ---------------------------------------------------------------------------

/**
 * StorageAdapter is the only way the core interacts with persistence.
 *
 * All implementations must honour the atomicity requirements documented on each
 * method.
 */
export interface StorageAdapter {
  /**
   * Initialise the adapter (create tables, indexes, connection pools, etc.).
   * Called once by QueueClient before any queue or worker operation.
   */
  initialize(): Promise<void>;

  /**
   * Tear down the adapter (close connections, flush buffers).
   * Called once when the client is closing.
   */
  close(): Promise<void>;

  // -------------------------------------------------------------------------
  // Job lifecycle
  // -------------------------------------------------------------------------

  /**
   * Persist a new job in `waiting` (or `delayed`) status.
   * Must be idempotent when called with the same `id`.
   */
  enqueue<TPayload = unknown>(input: EnqueueInput<TPayload>): Promise<JobData<TPayload>>;

  /**
   * Atomically claim the next eligible job in `queue`.
   *
   * Eligible means:
   *   - status === 'waiting'
   *   - runAt <= now
   *   - no valid (non-expired) lock held
   *
   * The implementation MUST guarantee that concurrent callers cannot claim the
   * same job.  Returns `null` when no eligible job is found.
   */
  claim<TPayload = unknown>(input: ClaimInput): Promise<JobData<TPayload> | null>;

  /**
   * Mark a job as successfully completed and release its lock.
   */
  complete(jobId: string): Promise<void>;

  /**
   * Requeue a failed job for another attempt (retry).
   * Records the failure in `attempts` history.
   * Must NOT create a new job identity.
   */
  requeue(input: RequeueInput): Promise<void>;

  /**
   * Move a permanently-failed job to the DLQ.
   * Sets status to `'dead'` and records the final failure.
   */
  moveToDlq(input: MoveToDlqInput): Promise<void>;

  /**
   * Release the lock on a job without changing its status.
   * Used during graceful shutdown when a job cannot complete in time.
   */
  releaseLock(jobId: string): Promise<void>;

  /**
   * Recover stalled jobs — jobs that are `active` but whose lock has expired.
   * Returns the list of recovered job IDs.
   */
  recoverStalledJobs(queue: string, now: string): Promise<string[]>;

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Fetch a single job by its ID. Returns `null` if not found. */
  getJob<TPayload = unknown>(jobId: string): Promise<JobData<TPayload> | null>;

  /** Fetch multiple jobs matching the given filter. */
  getJobs<TPayload = unknown>(filter: GetJobsFilter): Promise<JobData<TPayload>[]>;

  /** Count jobs by status in a queue. */
  getJobCounts(queue: string): Promise<Record<JobStatus, number>>;

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  /**
   * Increment the rate-limit counter for `queue` within the current window.
   * Returns `true` when the job is allowed to proceed, `false` when the rate
   * limit has been reached.
   */
  checkAndIncrementRateLimit(
    queue: string,
    max: number,
    windowMs: number,
    now: string,
  ): Promise<boolean>;
}
