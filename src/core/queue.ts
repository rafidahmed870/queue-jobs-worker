/**
 * Queue
 *
 * Represents an independent stream of jobs.  Applications use a Queue to:
 *  - Enqueue jobs (with optional scheduling, priority, retry config).
 *  - Register processors for job types.
 *  - Create workers that consume jobs from this queue.
 *  - Query job state and counts.
 *
 * Queue-level configuration overrides client defaults.
 * Job-level options override queue configuration where applicable.
 */

import type { StorageAdapter } from "../types/storage.types.js";
import type { JobOptions, JobStatus } from "../types/job.types.js";
import type { QueueOptions } from "../types/queue.types.js";
import type { WorkerOptions, Processor } from "../types/worker.types.js";
import type { ClientDefaults } from "../types/client.types.js";
import { Job } from "./job.js";
import { Worker } from "./worker.js";
import { generateJobId } from "./id.js";
import type { QueueEventEmitter } from "../events/emitter.js";

type ResolvedDefaults = Required<ClientDefaults>;

// ---------------------------------------------------------------------------
// Resolved queue-level config
// ---------------------------------------------------------------------------

function mergeQueueConfig(
  options: QueueOptions | undefined,
  defaults: ResolvedDefaults,
): Required<QueueOptions> {
  return {
    concurrency: options?.concurrency ?? defaults.concurrency,
    attempts: options?.attempts ?? defaults.attempts,
    retryDelay: options?.retryDelay ?? defaults.retryDelay,
    backoff: options?.backoff ?? defaults.backoff,
    timeout: options?.timeout ?? defaults.timeout,
    rateLimit: options?.rateLimit ?? defaults.rateLimit ?? undefined,
    pollInterval: options?.pollInterval ?? defaults.pollInterval,
    stalledInterval: options?.stalledInterval ?? defaults.stalledInterval,
    lockDuration: options?.lockDuration ?? defaults.lockDuration,
  } as Required<QueueOptions>;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export class Queue<TPayload = unknown> {
  /** The name of this queue — unique within a QueueClient. */
  readonly name: string;

  private readonly storage: StorageAdapter;
  private readonly emitter: QueueEventEmitter;
  private readonly resolvedConfig: Required<QueueOptions>;
  private readonly clientDefaults: ResolvedDefaults;

  /** Registered processors keyed by job type. */
  private readonly processors = new Map<string, Processor<unknown>>();

  /** Active worker instances created by this queue. */
  private readonly workers: Worker[] = [];

  constructor(
    name: string,
    storage: StorageAdapter,
    emitter: QueueEventEmitter,
    options: QueueOptions | undefined,
    defaults: ResolvedDefaults,
  ) {
    this.name = name;
    this.storage = storage;
    this.emitter = emitter;
    this.clientDefaults = defaults;
    this.resolvedConfig = mergeQueueConfig(options, defaults);
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  /**
   * Add a new job to the queue.
   *
   * @param type    - Job type string, must match a registered processor.
   * @param payload - Arbitrary serialisable payload (never logged by default).
   * @param options - Per-job overrides (attempts, delay, priority, etc.).
   */
  async enqueue(type: string, payload: TPayload, options?: JobOptions): Promise<Job<TPayload>> {
    const cfg = this.resolvedConfig;
    const now = new Date();

    // Resolve runAt from schedule options.
    let runAt: Date;
    if (options?.schedule?.runAt !== undefined) {
      runAt = new Date(options.schedule.runAt);
    } else if (options?.schedule?.delay !== undefined) {
      runAt = new Date(now.getTime() + options.schedule.delay);
    } else {
      runAt = now;
    }

    const raw = await this.storage.enqueue<TPayload>({
      id: generateJobId(),
      queue: this.name,
      type,
      payload,
      maxAttempts: options?.attempts ?? cfg.attempts,
      retryDelay: options?.retryDelay ?? cfg.retryDelay,
      backoff: options?.backoff ?? cfg.backoff,
      timeout: options?.timeout ?? cfg.timeout,
      priority: options?.priority ?? 0,
      runAt: runAt.toISOString(),
      ...(options?.schedule?.cron !== undefined && { cron: options.schedule.cron }),
    });

    const job = new Job<TPayload>(raw);
    this.emitter.emit("job:enqueued", raw);
    return job;
  }

  // -------------------------------------------------------------------------
  // Processor registration
  // -------------------------------------------------------------------------

  /**
   * Register a processor function for a given job type.
   *
   * Only one processor per type per queue is supported.
   * Registering a second processor for the same type replaces the first.
   */
  process<P = TPayload>(type: string, processor: Processor<P>): void {
    this.processors.set(type, processor as Processor<unknown>);
  }

  // -------------------------------------------------------------------------
  // Worker creation
  // -------------------------------------------------------------------------

  /**
   * Create and start a Worker that consumes jobs from this queue.
   *
   * Worker-level `concurrency` overrides queue-level concurrency.
   */
  createWorker(options?: WorkerOptions): Worker {
    const worker = new Worker(
      this.name,
      this.storage,
      this.emitter,
      this.processors,
      options ?? {},
      this.resolvedConfig,
      this.clientDefaults,
    );

    this.workers.push(worker);
    worker.start();
    return worker;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Fetch a single job by its ID. Returns null if not found or wrong queue. */
  async getJob(jobId: string): Promise<Job<TPayload> | null> {
    const raw = await this.storage.getJob<TPayload>(jobId);
    if (!raw || raw.queue !== this.name) return null;
    return new Job<TPayload>(raw);
  }

  /** Fetch jobs from this queue, optionally filtered by status. */
  async getJobs(status?: JobStatus, limit = 100, offset = 0): Promise<Job<TPayload>[]> {
    const raws = await this.storage.getJobs<TPayload>({
      queue: this.name,
      ...(status !== undefined && { status }),
      limit,
      offset,
    });
    return raws.map((r) => new Job<TPayload>(r));
  }

  /** Get job counts by status for this queue. */
  async getJobCounts(): Promise<Record<JobStatus, number>> {
    return this.storage.getJobCounts(this.name);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Gracefully stop all workers attached to this queue.
   * Called automatically by QueueClient.close().
   */
  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.stop()));
  }

  /** Return all active worker instances on this queue. */
  getWorkers(): readonly Worker[] {
    return this.workers;
  }
}
