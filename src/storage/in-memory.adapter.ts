/**
 * InMemoryStorageAdapter
 *
 * A fully-featured, in-process storage adapter backed by a plain Map.
 * Intended for development, testing, and single-process scenarios.
 * Data is NOT persisted between process restarts.
 *
 * All "atomic" operations are synchronous under the hood — safe within a
 * single Node.js event-loop tick.
 */

import type { StorageAdapter } from "../types/storage.types.js";
import type {
  EnqueueInput,
  ClaimInput,
  RequeueInput,
  MoveToDlqInput,
  GetJobsFilter,
} from "../types/storage.types.js";
import type { JobData, JobStatus } from "../types/job.types.js";

// ---------------------------------------------------------------------------
// Rate-limit window bucket
// ---------------------------------------------------------------------------

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly jobs = new Map<string, JobData<unknown>>();
  private readonly rateLimitBuckets = new Map<string, RateLimitBucket>();

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    // Nothing to set up for in-memory storage.
  }

  async close(): Promise<void> {
    this.jobs.clear();
    this.rateLimitBuckets.clear();
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  async enqueue<TPayload = unknown>(input: EnqueueInput<TPayload>): Promise<JobData<TPayload>> {
    // Idempotent: return existing job if already stored with the same id.
    if (this.jobs.has(input.id)) {
      return this.jobs.get(input.id) as JobData<TPayload>;
    }

    const now = new Date().toISOString();
    const runAt = input.runAt;
    const isDelayed = new Date(runAt).getTime() > Date.now();

    const job: JobData<TPayload> = {
      id: input.id,
      queue: input.queue,
      type: input.type,
      payload: input.payload,
      status: isDelayed ? "delayed" : "waiting",
      attemptsMade: 0,
      maxAttempts: input.maxAttempts,
      retryDelay: input.retryDelay,
      backoff: input.backoff,
      timeout: input.timeout,
      priority: input.priority,
      runAt,
      ...(input.cron !== undefined && { cron: input.cron }),
      attempts: [],
      lockId: null,
      lockExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failedAt: null,
    };

    this.jobs.set(job.id, job as JobData<unknown>);
    return job;
  }

  // -------------------------------------------------------------------------
  // Claim (atomic within a single event-loop tick)
  // -------------------------------------------------------------------------

  async claim<TPayload = unknown>(input: ClaimInput): Promise<JobData<TPayload> | null> {
    const { queue, lockId, lockDuration, now } = input;
    const nowMs = new Date(now).getTime();

    // Collect eligible jobs: same queue, waiting/delayed, runAt <= now,
    // and no valid lock held.
    const eligible: JobData<unknown>[] = [];

    for (const job of this.jobs.values()) {
      if (job.queue !== queue) continue;
      if (job.status !== "waiting" && job.status !== "delayed") continue;
      if (new Date(job.runAt).getTime() > nowMs) continue;
      if (job.lockId !== null && job.lockExpiresAt !== null) {
        const lockExpiry = new Date(job.lockExpiresAt).getTime();
        if (lockExpiry > nowMs) continue; // still locked
      }
      eligible.push(job);
    }

    if (eligible.length === 0) return null;

    // Sort: higher priority first; break ties by earliest runAt then createdAt.
    eligible.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const runAtDiff = new Date(a.runAt).getTime() - new Date(b.runAt).getTime();
      if (runAtDiff !== 0) return runAtDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const job = eligible[0];
    if (!job) return null;

    const lockExpiresAt = new Date(nowMs + lockDuration).toISOString();

    job.status = "active";
    job.lockId = lockId;
    job.lockExpiresAt = lockExpiresAt;
    job.updatedAt = now;

    return job as JobData<TPayload>;
  }

  // -------------------------------------------------------------------------
  // Complete
  // -------------------------------------------------------------------------

  async complete(jobId: string): Promise<void> {
    const job = this.requireJob(jobId);
    const now = new Date().toISOString();

    job.status = "completed";
    job.lockId = null;
    job.lockExpiresAt = null;
    job.completedAt = now;
    job.updatedAt = now;
  }

  // -------------------------------------------------------------------------
  // Requeue (retry)
  // -------------------------------------------------------------------------

  async requeue(input: RequeueInput): Promise<void> {
    const job = this.requireJob(input.jobId);
    const now = new Date().toISOString();

    // Record this attempt in history using the canonical attempt number from input.
    job.attempts.push({
      attempt: input.attemptNumber,
      startedAt: job.updatedAt,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined && { stack: input.stack }),
    });

    job.attemptsMade = input.attemptNumber;
    job.status = "waiting";
    job.runAt = input.runAt;
    job.lockId = null;
    job.lockExpiresAt = null;
    job.updatedAt = now;
  }

  // -------------------------------------------------------------------------
  // Move to DLQ
  // -------------------------------------------------------------------------

  async moveToDlq(input: MoveToDlqInput): Promise<void> {
    const job = this.requireJob(input.jobId);
    const now = new Date().toISOString();

    job.attempts.push({
      attempt: input.attemptNumber,
      startedAt: job.updatedAt,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined && { stack: input.stack }),
    });

    job.attemptsMade = input.attemptNumber;
    job.status = "dead";
    job.lockId = null;
    job.lockExpiresAt = null;
    job.failedAt = now;
    job.updatedAt = now;
  }

  // -------------------------------------------------------------------------
  // Release lock
  // -------------------------------------------------------------------------

  async releaseLock(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.lockId = null;
    job.lockExpiresAt = null;
    // Keep the job as "active" so it will be recovered by stalled-job detection.
    job.updatedAt = new Date().toISOString();
  }

  // -------------------------------------------------------------------------
  // Recover stalled jobs
  // -------------------------------------------------------------------------

  async recoverStalledJobs(queue: string, now: string): Promise<string[]> {
    const nowMs = new Date(now).getTime();
    const recovered: string[] = [];

    for (const job of this.jobs.values()) {
      if (job.queue !== queue) continue;
      if (job.status !== "active") continue;
      if (job.lockExpiresAt === null) continue;

      const lockExpiry = new Date(job.lockExpiresAt).getTime();
      if (lockExpiry <= nowMs) {
        // Lock expired — return the job to waiting so it can be reclaimed.
        job.status = "waiting";
        job.lockId = null;
        job.lockExpiresAt = null;
        job.updatedAt = now;
        recovered.push(job.id);
      }
    }

    return recovered;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getJob<TPayload = unknown>(jobId: string): Promise<JobData<TPayload> | null> {
    return (this.jobs.get(jobId) as JobData<TPayload>) ?? null;
  }

  async getJobs<TPayload = unknown>(filter: GetJobsFilter): Promise<JobData<TPayload>[]> {
    const { queue, status, limit = 100, offset = 0 } = filter;
    const results: JobData<unknown>[] = [];

    for (const job of this.jobs.values()) {
      if (queue !== undefined && job.queue !== queue) continue;
      if (status !== undefined && job.status !== status) continue;
      results.push(job);
    }

    // Sort by priority desc, then createdAt asc.
    results.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return results.slice(offset, offset + limit) as JobData<TPayload>[];
  }

  async getJobCounts(queue: string): Promise<Record<JobStatus, number>> {
    const counts: Record<JobStatus, number> = {
      waiting: 0,
      active: 0,
      completed: 0,
      delayed: 0,
      dead: 0,
    };

    for (const job of this.jobs.values()) {
      if (job.queue !== queue) continue;
      counts[job.status] += 1;
    }

    return counts;
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  async checkAndIncrementRateLimit(
    queue: string,
    max: number,
    windowMs: number,
    now: string,
  ): Promise<boolean> {
    const nowMs = new Date(now).getTime();
    const existing = this.rateLimitBuckets.get(queue);

    if (!existing || nowMs - existing.windowStart >= windowMs) {
      // Start a fresh window.
      this.rateLimitBuckets.set(queue, { count: 1, windowStart: nowMs });
      return true;
    }

    if (existing.count >= max) {
      return false; // Rate limit reached.
    }

    existing.count += 1;
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireJob(jobId: string): JobData<unknown> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return job;
  }
}
