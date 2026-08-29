/**
 * Job
 *
 * A rich wrapper around the raw JobData record stored in the storage layer.
 * Exposes read-only accessors for all fields and a small set of helpers used
 * by Queue and Worker internals.
 *
 * The Job instance is passed directly to user-supplied Processor functions.
 * Users should never mutate the internal data object — all mutations happen
 * through the storage adapter.
 */

import type { JobData, JobStatus, JobAttempt, BackoffStrategy } from "../types/job.types.js";

export class Job<TPayload = unknown> {
  /** @internal Raw data record — treat as immutable outside storage layer. */
  readonly _data: JobData<TPayload>;

  constructor(data: JobData<TPayload>) {
    this._data = data;
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** Unique, stable job identifier. */
  get id(): string {
    return this._data.id;
  }

  /** Name of the queue this job belongs to. */
  get queue(): string {
    return this._data.queue;
  }

  /** Application-defined job type (matches the registered processor). */
  get type(): string {
    return this._data.type;
  }

  // -------------------------------------------------------------------------
  // Payload
  // -------------------------------------------------------------------------

  /**
   * User-supplied job payload.
   * Never log this value — it may contain sensitive data.
   */
  get data(): TPayload {
    return this._data.payload;
  }

  // -------------------------------------------------------------------------
  // Status & attempts
  // -------------------------------------------------------------------------

  /** Current lifecycle status. */
  get status(): JobStatus {
    return this._data.status;
  }

  /** Number of attempts already executed (0 = not yet started). */
  get attemptsMade(): number {
    return this._data.attemptsMade;
  }

  /** Maximum allowed attempts. */
  get maxAttempts(): number {
    return this._data.maxAttempts;
  }

  /** How many attempts remain (including the current one). */
  get attemptsRemaining(): number {
    return Math.max(0, this._data.maxAttempts - this._data.attemptsMade);
  }

  /** Ordered list of past attempt records. */
  get attemptHistory(): readonly JobAttempt[] {
    return this._data.attempts;
  }

  // -------------------------------------------------------------------------
  // Retry configuration
  // -------------------------------------------------------------------------

  /** Base delay in ms between retry attempts. */
  get retryDelay(): number {
    return this._data.retryDelay;
  }

  /** Backoff strategy applied on retry. */
  get backoff(): BackoffStrategy {
    return this._data.backoff;
  }

  // -------------------------------------------------------------------------
  // Execution config
  // -------------------------------------------------------------------------

  /** Per-attempt timeout in ms. */
  get timeout(): number {
    return this._data.timeout;
  }

  /** Processing priority — higher numbers are processed first. */
  get priority(): number {
    return this._data.priority;
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /** ISO timestamp when this job is eligible to run. */
  get runAt(): string {
    return this._data.runAt;
  }

  /** Cron expression for recurring jobs, or undefined. */
  get cron(): string | undefined {
    return this._data.cron;
  }

  // -------------------------------------------------------------------------
  // Lock
  // -------------------------------------------------------------------------

  /** ID of the worker currently holding the lock, or null. */
  get lockId(): string | null {
    return this._data.lockId;
  }

  /** ISO timestamp when the current lock expires, or null. */
  get lockExpiresAt(): string | null {
    return this._data.lockExpiresAt;
  }

  // -------------------------------------------------------------------------
  // Timestamps
  // -------------------------------------------------------------------------

  /** ISO timestamp when the job was first enqueued. */
  get createdAt(): string {
    return this._data.createdAt;
  }

  /** ISO timestamp of the last status change. */
  get updatedAt(): string {
    return this._data.updatedAt;
  }

  /** ISO timestamp when the job completed successfully, or null. */
  get completedAt(): string | null {
    return this._data.completedAt;
  }

  /** ISO timestamp when the job was moved to the DLQ, or null. */
  get failedAt(): string | null {
    return this._data.failedAt;
  }

  // -------------------------------------------------------------------------
  // Derived helpers
  // -------------------------------------------------------------------------

  /** Returns true when the job has been successfully processed. */
  isCompleted(): boolean {
    return this._data.status === "completed";
  }

  /** Returns true when the job is in the Dead Letter Queue. */
  isDead(): boolean {
    return this._data.status === "dead";
  }

  /** Returns true when the job is currently being processed by a worker. */
  isActive(): boolean {
    return this._data.status === "active";
  }

  /** Returns true when the job is waiting to be claimed. */
  isWaiting(): boolean {
    return this._data.status === "waiting";
  }

  /** Returns true when the job is scheduled for a future time. */
  isDelayed(): boolean {
    return this._data.status === "delayed";
  }

  // -------------------------------------------------------------------------
  // Debug representation (intentionally omits payload)
  // -------------------------------------------------------------------------

  toJSON(): Record<string, unknown> {
    return {
      id: this._data.id,
      queue: this._data.queue,
      type: this._data.type,
      status: this._data.status,
      attemptsMade: this._data.attemptsMade,
      maxAttempts: this._data.maxAttempts,
      priority: this._data.priority,
      runAt: this._data.runAt,
      createdAt: this._data.createdAt,
      updatedAt: this._data.updatedAt,
      completedAt: this._data.completedAt,
      failedAt: this._data.failedAt,
      // Payload intentionally excluded to prevent accidental logging.
    };
  }

  toString(): string {
    return `Job(${this._data.id}, type=${this._data.type}, status=${this._data.status}, attempt=${this._data.attemptsMade}/${this._data.maxAttempts})`;
  }
}
