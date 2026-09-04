/**
 * Worker
 *
 * Claims jobs from a queue and executes registered processors concurrently.
 *
 * Key guarantees:
 *  - At-most `concurrency` jobs run simultaneously.
 *  - Job claiming is delegated to the storage adapter's atomic `claim()` call.
 *  - Failed jobs are requeued (with backoff) or moved to the DLQ.
 *  - Stalled jobs (expired locks from crashed workers) are recovered
 *    periodically.
 *  - Graceful shutdown: stop claiming, wait for active jobs, release any
 *    locks that could not be finished within shutdownTimeout.
 *  - Cron jobs: re-enqueued immediately after each successful execution.
 */

import { randomUUID } from "node:crypto";
import type { StorageAdapter } from "../types/storage.types.js";
import type { WorkerOptions, WorkerStatus, Processor } from "../types/worker.types.js";
import type { QueueOptions } from "../types/queue.types.js";
import type { ClientDefaults } from "../types/client.types.js";
import { Job } from "./job.js";
import { calculateBackoff, nextRunAt } from "./backoff.js";
import { generateJobId } from "./id.js";
import type { QueueEventEmitter } from "../events/emitter.js";

type ResolvedDefaults = Required<ClientDefaults>;

// ---------------------------------------------------------------------------
// Resolved config helper
// ---------------------------------------------------------------------------

function resolveConfig(
  workerOptions: WorkerOptions,
  queueOptions: QueueOptions,
  defaults: ResolvedDefaults,
) {
  return {
    concurrency: workerOptions.concurrency ?? queueOptions.concurrency ?? defaults.concurrency,
    shutdownTimeout: workerOptions.shutdownTimeout ?? 30_000,
    pollInterval: queueOptions.pollInterval ?? defaults.pollInterval,
    stalledInterval: queueOptions.stalledInterval ?? defaults.stalledInterval,
    lockDuration: queueOptions.lockDuration ?? defaults.lockDuration,
    rateLimit: queueOptions.rateLimit ?? defaults.rateLimit,
  };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class Worker {
  /** Unique identifier for this worker instance. */
  readonly id: string;

  private readonly queueName: string;
  private readonly storage: StorageAdapter;
  private readonly emitter: QueueEventEmitter;
  private readonly processors: Map<string, Processor<unknown>>;
  private readonly config: ReturnType<typeof resolveConfig>;

  private _status: WorkerStatus = "idle";
  private activeCount = 0;

  /**
   * Tracks job IDs currently being processed so we can release their locks
   * when graceful shutdown times out before they finish.
   */
  private readonly activeJobIds = new Set<string>();

  private pollTimer: NodeJS.Timeout | null = null;
  private stalledTimer: NodeJS.Timeout | null = null;

  /** Resolves when all active jobs finish during shutdown. */
  private drainResolve: (() => void) | null = null;

  constructor(
    queueName: string,
    storage: StorageAdapter,
    emitter: QueueEventEmitter,
    processors: Map<string, Processor<unknown>>,
    workerOptions: WorkerOptions,
    queueOptions: QueueOptions,
    defaults: ResolvedDefaults,
  ) {
    this.id = `worker:${queueName}:${randomUUID()}`;
    this.queueName = queueName;
    this.storage = storage;
    this.emitter = emitter;
    this.processors = processors;
    this.config = resolveConfig(workerOptions, queueOptions, defaults);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get status(): WorkerStatus {
    return this._status;
  }

  /** Start polling for jobs. */
  start(): void {
    if (this._status !== "idle" && this._status !== "stopped") {
      return;
    }

    this._status = "running";
    this.emitter.emit("worker:started", this.id);
    this.emitter.emit("worker:status", this.id, this._status);

    this.schedulePoll();
    this.scheduleStallCheck();
  }

  /**
   * Gracefully stop the worker.
   *
   * 1. Stop accepting new jobs.
   * 2. Wait up to `shutdownTimeout` ms for active jobs to finish.
   * 3. Release locks on any jobs that did not finish in time so another
   *    worker can reclaim them.
   * 4. Emit stopped event.
   */
  async stop(): Promise<void> {
    if (this._status === "stopped" || this._status === "stopping") {
      return;
    }

    this._status = "stopping";
    this.emitter.emit("worker:status", this.id, this._status);

    // Cancel timers.
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.stalledTimer) {
      clearTimeout(this.stalledTimer);
      this.stalledTimer = null;
    }

    // Wait for active jobs to finish, but no longer than shutdownTimeout.
    if (this.activeCount > 0) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.drainResolve = resolve;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, this.config.shutdownTimeout)),
      ]);
    }

    // Release locks for any jobs that did not finish in time.
    // releaseLock() sets lockExpiresAt to an already-expired timestamp so that
    // recoverStalledJobs() on any worker will immediately pick them up and
    // return them to "waiting" — rather than leaving them stuck in "active"
    // forever (which would happen if lockExpiresAt were cleared to null/empty,
    // since every adapter's stalled-job check requires a non-null expired value).
    if (this.activeJobIds.size > 0) {
      await Promise.all(
        Array.from(this.activeJobIds).map((jobId) =>
          this.storage.releaseLock(jobId).catch(() => {
            // Best-effort — storage may already be unavailable during shutdown.
          }),
        ),
      );
    }

    this._status = "stopped";
    this.emitter.emit("worker:stopped", this.id);
    this.emitter.emit("worker:status", this.id, this._status);
  }

  // -------------------------------------------------------------------------
  // Poll loop
  // -------------------------------------------------------------------------

  private schedulePoll(): void {
    if (this._status !== "running") return;

    this.pollTimer = setTimeout(() => {
      void this.poll();
    }, this.config.pollInterval);
  }

  private async poll(): Promise<void> {
    if (this._status !== "running") return;

    try {
      // Fill up to concurrency limit.
      while (this._status === "running" && this.activeCount < this.config.concurrency) {
        const claimed = await this.claimNext();
        if (!claimed) break; // No eligible jobs right now.
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitter.emit("queue:error", this.queueName, error);
      this.emitter.emit("worker:error", this.id, error);
    }

    this.schedulePoll();
  }

  // -------------------------------------------------------------------------
  // Claim & execute
  // -------------------------------------------------------------------------

  private async claimNext(): Promise<boolean> {
    const now = new Date().toISOString();

    // Attempt to claim a job before touching the rate-limit counter.
    // The counter must only be consumed when a job is actually claimed for
    // processing — polling an empty queue must not burn quota (issue #4).
    const raw = await this.storage.claim({
      queue: this.queueName,
      lockId: this.id,
      lockDuration: this.config.lockDuration,
      now,
    });

    if (!raw) return false;

    // A job was claimed. Now enforce the rate limit.  If the limit has been
    // reached we immediately release the lock so the job is recoverable and
    // return false — the poll loop will stop trying until the next cycle.
    if (this.config.rateLimit) {
      const allowed = await this.storage.checkAndIncrementRateLimit(
        this.queueName,
        this.config.rateLimit.max,
        this.config.rateLimit.duration,
        now,
      );
      if (!allowed) {
        await this.storage.releaseLock(raw.id);
        return false;
      }
    }

    const job = new Job(raw);
    this.activeCount += 1;
    this.activeJobIds.add(job.id);

    // Fire-and-forget — errors are caught inside executeJob.
    void this.executeJob(job);

    return true;
  }

  private async executeJob(job: Job<unknown>): Promise<void> {
    this.emitter.emit("job:started", job._data);

    const processor = this.processors.get(job.type);

    if (!processor) {
      // No processor registered → treat as a permanent failure.
      const error = new Error(
        `No processor registered for job type "${job.type}" in queue "${this.queueName}"`,
      );
      await this.handleFailure(job, error);
      return;
    }

    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        // Enforce per-attempt timeout.
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Job timed out after ${job.timeout}ms`));
        }, job.timeout);

        Promise.resolve(processor(job)).then(resolve, reject);
      });

      // Success path.
      if (timeoutHandle) clearTimeout(timeoutHandle);
      await this.storage.complete(job.id);

      const completedData = (await this.storage.getJob(job.id)) ?? job._data;
      this.emitter.emit("job:completed", completedData);

      // Re-enqueue cron job for its next run.
      if (job.cron) {
        await this.enqueueCronNext(job);
      }
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const error = err instanceof Error ? err : new Error(String(err));
      await this.handleFailure(job, error);
    } finally {
      this.activeJobIds.delete(job.id);
      this.activeCount -= 1;
      // Signal drain waiter if we've reached zero active jobs.
      if (this.activeCount === 0 && this.drainResolve) {
        this.drainResolve();
        this.drainResolve = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cron — re-enqueue the next occurrence after a successful run
  // -------------------------------------------------------------------------

  private async enqueueCronNext(job: Job<unknown>): Promise<void> {
    try {
      // Resolve the next runAt using the cron expression.
      // We depend on the optional "croner" or "cron-parser" package only if
      // the user has actually configured a cron job.  To avoid a hard
      // dependency we attempt a dynamic import; if neither package is
      // available we fall back to a 1-minute interval and emit a warning.
      let nextMs: number;

      try {
        // Use a computed specifier so TypeScript does not statically resolve
        // "croner" — it is an optional peer dependency that may not be installed.
        const specifier = "croner";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const croner = (await import(/* @vite-ignore */ specifier)) as any;
        const CronClass = croner.Cron ?? croner.default?.Cron ?? croner.default;
        if (typeof CronClass === "function") {
          const cronInstance = new CronClass(job.cron as string) as {
            nextRun: () => Date | null;
          };
          const nextDate = cronInstance.nextRun();
          nextMs = nextDate ? nextDate.getTime() : Date.now() + 60_000;
        } else {
          nextMs = Date.now() + 60_000;
        }
      } catch {
        // croner not installed — fall back to a 1-minute interval.
        nextMs = Date.now() + 60_000;
      }

      const runAt = new Date(nextMs).toISOString();

      await this.storage.enqueue({
        id: generateJobId(),
        queue: this.queueName,
        type: job.type,
        payload: job._data.payload,
        maxAttempts: job.maxAttempts,
        retryDelay: job.retryDelay,
        backoff: job.backoff,
        timeout: job.timeout,
        priority: job.priority,
        runAt,
        cron: job.cron,
      });
    } catch (err) {
      // Cron re-enqueue failures must not crash the worker.
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitter.emit("worker:error", this.id, error);
    }
  }

  // -------------------------------------------------------------------------
  // Failure handling — requeue or DLQ
  // -------------------------------------------------------------------------

  private async handleFailure(job: Job<unknown>, error: Error): Promise<void> {
    const attemptNumber = job.attemptsMade + 1; // the attempt that just failed
    const hasMore = attemptNumber < job.maxAttempts;

    this.emitter.emit("job:failed", job._data, error);

    if (hasMore) {
      const delayMs = calculateBackoff(job.backoff, job.retryDelay, attemptNumber);
      const runAt = nextRunAt(delayMs);

      await this.storage.requeue({
        jobId: job.id,
        runAt,
        error: error.message,
        attemptNumber,
        ...(error.stack !== undefined && { stack: error.stack }),
      });

      const updated = await this.storage.getJob(job.id);
      if (updated) {
        this.emitter.emit("job:retrying", updated, error, runAt);
      }
    } else {
      // No attempts remaining → Dead Letter Queue.
      await this.storage.moveToDlq({
        jobId: job.id,
        error: error.message,
        attemptNumber,
        ...(error.stack !== undefined && { stack: error.stack }),
      });

      const dead = await this.storage.getJob(job.id);
      if (dead) {
        this.emitter.emit("job:dead", dead, error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stalled-job recovery
  // -------------------------------------------------------------------------

  private scheduleStallCheck(): void {
    if (this._status !== "running") return;

    this.stalledTimer = setTimeout(() => {
      void this.recoverStalledJobs();
    }, this.config.stalledInterval);
  }

  private async recoverStalledJobs(): Promise<void> {
    if (this._status !== "running") return;

    try {
      const now = new Date().toISOString();
      const recovered = await this.storage.recoverStalledJobs(this.queueName, now);

      for (const jobId of recovered) {
        this.emitter.emit("job:stalled", jobId);
        this.emitter.emit("job:recovered", jobId);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitter.emit("worker:error", this.id, error);
    }

    this.scheduleStallCheck();
  }
}
