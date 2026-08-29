/**
 * All types related to Job identity, state, configuration, and lifecycle.
 */

// ---------------------------------------------------------------------------
// Job status
// ---------------------------------------------------------------------------

export type JobStatus =
  | "waiting" // Persisted, waiting to be claimed
  | "active" // Claimed by a worker, currently being processed
  | "completed" // Successfully processed
  | "delayed" // Scheduled for future execution
  | "dead"; // All attempts exhausted — in the Dead Letter Queue

// ---------------------------------------------------------------------------
// Attempt history
// ---------------------------------------------------------------------------

export interface JobAttempt {
  /** 1-based attempt number. */
  readonly attempt: number;
  /** ISO timestamp when this attempt started. */
  readonly startedAt: string;
  /** ISO timestamp when this attempt finished (success or failure). */
  readonly finishedAt: string;
  /** Error message if the attempt failed. */
  readonly error?: string;
  /** Error stack trace if the attempt failed (never logged by default). */
  readonly stack?: string | undefined;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface JobSchedule {
  /**
   * Delay in milliseconds before the job becomes eligible.
   * Mutually exclusive with `runAt`.
   */
  delay?: number;

  /**
   * Absolute timestamp (ISO string or epoch ms) when the job becomes eligible.
   * Mutually exclusive with `delay`.
   */
  runAt?: string | number;

  /**
   * Cron expression for recurring jobs.
   * When set the job re-enqueues itself after each successful execution.
   */
  cron?: string;
}

// ---------------------------------------------------------------------------
// Job configuration (per-job overrides)
// ---------------------------------------------------------------------------

export interface JobOptions {
  /** Maximum number of processing attempts (default: inherited from queue/client). */
  attempts?: number;

  /**
   * Base delay in milliseconds between retry attempts.
   * Used by the backoff strategy.
   */
  retryDelay?: number;

  /** Backoff strategy applied on retry. */
  backoff?: BackoffStrategy;

  /** Maximum execution time in milliseconds for a single attempt. */
  timeout?: number;

  /**
   * Priority value — higher numbers are processed first.
   * Default: 0.
   */
  priority?: number;

  /** Scheduling options (delay / runAt / cron). */
  schedule?: JobSchedule;
}

// ---------------------------------------------------------------------------
// Backoff strategies
// ---------------------------------------------------------------------------

export type BackoffStrategy = "fixed" | "exponential" | "linear";

// ---------------------------------------------------------------------------
// Core Job data structure
// ---------------------------------------------------------------------------

export interface JobData<TPayload = unknown> {
  /** Unique, stable job identifier. */
  readonly id: string;

  /** Name of the queue this job belongs to. */
  readonly queue: string;

  /** Application-defined job type (matches processor registration). */
  readonly type: string;

  /** User-supplied job payload. Never logged by default. */
  readonly payload: TPayload;

  /** Current lifecycle status. */
  status: JobStatus;

  /** Number of attempts already executed (0 = not yet started). */
  attemptsMade: number;

  /** Maximum allowed attempts. */
  maxAttempts: number;

  /** Base delay in ms between retries. */
  retryDelay: number;

  /** Backoff strategy. */
  backoff: BackoffStrategy;

  /** Per-attempt timeout in ms. */
  timeout: number;

  /** Processing priority — higher = sooner. */
  priority: number;

  /** ISO timestamp when the job is eligible to run (for delayed/scheduled jobs). */
  runAt: string;

  /** Cron expression (recurring jobs only). */
  cron?: string | undefined;

  /** Ordered list of past attempt records. */
  attempts: JobAttempt[];

  /** ID of the worker lock currently owning this job (null when not active). */
  lockId: string | null;

  /** ISO timestamp when the current lock expires. */
  lockExpiresAt: string | null;

  /** ISO timestamp when the job was enqueued. */
  readonly createdAt: string;

  /** ISO timestamp of the last status change. */
  updatedAt: string;

  /** ISO timestamp when processing completed successfully. */
  completedAt: string | null;

  /** ISO timestamp when the job was moved to the DLQ. */
  failedAt: string | null;
}
