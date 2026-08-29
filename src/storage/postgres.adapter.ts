/**
 * PostgreSQLStorageAdapter  (pg / node-postgres)
 *
 * Table prefix: "qjw_"
 *
 * Tables created on init (if they do not exist):
 *   qjw_jobs           — persists every job and its full state
 *   qjw_rate_limits    — sliding-window rate-limit counters
 *
 * Atomicity
 * ─────────────────────────────────────────────────────────────────────────
 *  Claim uses SELECT … FOR UPDATE SKIP LOCKED inside a transaction so
 *  concurrent workers never receive the same row.
 * ─────────────────────────────────────────────────────────────────────────
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
// Lazy import — pg is an optional peer dependency
// ---------------------------------------------------------------------------

// These type-only imports are used solely for type annotations.
// The actual runtime import is deferred inside loadPg() to keep pg optional.
import type { Pool as PgPool, PoolClient as PgPoolClient } from "pg";
import type * as PgModule from "pg";

async function loadPg(): Promise<typeof PgModule> {
  try {
    return await import("pg");
  } catch {
    throw new Error(
      'PostgreSQLStorageAdapter requires the "pg" package (node-postgres).\n' +
        "Install it: npm install pg",
    );
  }
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const CREATE_JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS qjw_jobs (
  id               TEXT        NOT NULL PRIMARY KEY,
  queue            TEXT        NOT NULL,
  type             TEXT        NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'waiting',
  attempts_made    INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 3,
  retry_delay      INTEGER     NOT NULL DEFAULT 1000,
  backoff          TEXT        NOT NULL DEFAULT 'exponential',
  timeout          INTEGER     NOT NULL DEFAULT 30000,
  priority         INTEGER     NOT NULL DEFAULT 0,
  run_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cron             TEXT,
  attempts         JSONB       NOT NULL DEFAULT '[]',
  lock_id          TEXT,
  lock_expires_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS qjw_jobs_claim_idx
  ON qjw_jobs (queue, status, run_at, priority DESC)
  WHERE status IN ('waiting', 'delayed');
`;

const CREATE_RATE_TABLE = `
CREATE TABLE IF NOT EXISTS qjw_rate_limits (
  queue        TEXT    NOT NULL PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start BIGINT  NOT NULL DEFAULT 0
);
`;

// ---------------------------------------------------------------------------
// Row → JobData
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  queue: string;
  type: string;
  payload: unknown;
  status: string;
  attempts_made: number;
  max_attempts: number;
  retry_delay: number;
  backoff: string;
  timeout: number;
  priority: number;
  run_at: Date;
  cron: string | null;
  attempts: unknown;
  lock_id: string | null;
  lock_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
}

function rowToJob<TPayload>(row: JobRow): JobData<TPayload> {
  const job: JobData<TPayload> = {
    id: row.id,
    queue: row.queue,
    type: row.type,
    payload: row.payload as TPayload,
    status: row.status as JobStatus,
    attemptsMade: row.attempts_made,
    maxAttempts: row.max_attempts,
    retryDelay: row.retry_delay,
    backoff: row.backoff as JobData<TPayload>["backoff"],
    timeout: row.timeout,
    priority: row.priority,
    runAt: row.run_at.toISOString(),
    attempts: row.attempts as JobData<TPayload>["attempts"],
    lockId: row.lock_id,
    lockExpiresAt: row.lock_expires_at ? row.lock_expires_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    failedAt: row.failed_at ? row.failed_at.toISOString() : null,
  };
  if (row.cron) job.cron = row.cron;
  return job;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PostgreSQLStorageAdapter implements StorageAdapter {
  private pool!: PgPool;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    const { Pool } = await loadPg();

    this.pool = new Pool({ connectionString: this.connectionString });

    // Verify connectivity.
    const client: PgPoolClient = await this.pool.connect();
    try {
      await client.query("SELECT 1");

      // Auto-create tables (idempotent).
      await client.query(CREATE_JOBS_TABLE);
      await client.query(CREATE_RATE_TABLE);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  async enqueue<TPayload = unknown>(input: EnqueueInput<TPayload>): Promise<JobData<TPayload>> {
    const res = await this.pool.query<JobRow>(
      `INSERT INTO qjw_jobs
         (id, queue, type, payload, status, attempts_made, max_attempts,
          retry_delay, backoff, timeout, priority, run_at, cron,
          attempts, lock_id, lock_expires_at, created_at, updated_at,
          completed_at, failed_at)
       VALUES ($1,$2,$3,$4,
         CASE WHEN $5::timestamptz > NOW() THEN 'delayed' ELSE 'waiting' END,
         0,$6,$7,$8,$9,$10,$5,$11,
         '[]'::jsonb, NULL, NULL, NOW(), NOW(), NULL, NULL)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        input.id,
        input.queue,
        input.type,
        JSON.stringify(input.payload),
        input.runAt,
        input.maxAttempts,
        input.retryDelay,
        input.backoff,
        input.timeout,
        input.priority,
        input.cron ?? null,
      ],
    );

    if (res.rows.length > 0) {
      return rowToJob<TPayload>(res.rows[0] as JobRow);
    }

    // Row already exists — return it.
    const existing = await this.pool.query<JobRow>("SELECT * FROM qjw_jobs WHERE id = $1", [
      input.id,
    ]);
    return rowToJob<TPayload>(existing.rows[0] as JobRow);
  }

  // -------------------------------------------------------------------------
  // Claim  (SELECT … FOR UPDATE SKIP LOCKED)
  // -------------------------------------------------------------------------

  async claim<TPayload = unknown>(input: ClaimInput): Promise<JobData<TPayload> | null> {
    const { queue, lockId, lockDuration, now } = input;
    const lockExpiresAt = new Date(new Date(now).getTime() + lockDuration).toISOString();

    const client: PgPoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const res = await client.query<JobRow>(
        `SELECT * FROM qjw_jobs
         WHERE queue  = $1
           AND status IN ('waiting', 'delayed')
           AND run_at <= $2::timestamptz
           AND (lock_expires_at IS NULL OR lock_expires_at <= $2::timestamptz)
         ORDER BY priority DESC, run_at ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [queue, now],
      );

      if (res.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const row = res.rows[0] as JobRow;

      await client.query(
        `UPDATE qjw_jobs
         SET status = 'active', lock_id = $1, lock_expires_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [lockId, lockExpiresAt, row.id],
      );

      await client.query("COMMIT");

      // Return the fresh row.
      const updated = await this.pool.query<JobRow>("SELECT * FROM qjw_jobs WHERE id = $1", [
        row.id,
      ]);
      return rowToJob<TPayload>(updated.rows[0] as JobRow);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Complete
  // -------------------------------------------------------------------------

  async complete(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE qjw_jobs
       SET status = 'completed', lock_id = NULL, lock_expires_at = NULL,
           completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Requeue
  // -------------------------------------------------------------------------

  async requeue(input: RequeueInput): Promise<void> {
    const now = new Date().toISOString();
    const attempt = {
      attempt: input.attemptNumber,
      startedAt: now,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    };

    await this.pool.query(
      `UPDATE qjw_jobs
       SET status         = 'waiting',
           attempts_made  = attempts_made + 1,
           attempts       = attempts || $1::jsonb,
           run_at         = $2::timestamptz,
           lock_id        = NULL,
           lock_expires_at = NULL,
           updated_at     = NOW()
       WHERE id = $3`,
      [JSON.stringify([attempt]), input.runAt, input.jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Move to DLQ
  // -------------------------------------------------------------------------

  async moveToDlq(input: MoveToDlqInput): Promise<void> {
    const now = new Date().toISOString();
    const attempt = {
      attempt: input.attemptNumber,
      startedAt: now,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    };

    await this.pool.query(
      `UPDATE qjw_jobs
       SET status          = 'dead',
           attempts_made   = attempts_made + 1,
           attempts        = attempts || $1::jsonb,
           lock_id         = NULL,
           lock_expires_at = NULL,
           failed_at       = NOW(),
           updated_at      = NOW()
       WHERE id = $2`,
      [JSON.stringify([attempt]), input.jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Release lock
  // -------------------------------------------------------------------------

  async releaseLock(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE qjw_jobs
       SET lock_id = NULL, lock_expires_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Recover stalled jobs
  // -------------------------------------------------------------------------

  async recoverStalledJobs(queue: string, now: string): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `UPDATE qjw_jobs
       SET status = 'waiting', lock_id = NULL, lock_expires_at = NULL, updated_at = NOW()
       WHERE queue = $1
         AND status = 'active'
         AND lock_expires_at <= $2::timestamptz
       RETURNING id`,
      [queue, now],
    );
    return res.rows.map((r) => r.id);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getJob<TPayload = unknown>(jobId: string): Promise<JobData<TPayload> | null> {
    const res = await this.pool.query<JobRow>("SELECT * FROM qjw_jobs WHERE id = $1", [jobId]);
    if (res.rows.length === 0) return null;
    return rowToJob<TPayload>(res.rows[0] as JobRow);
  }

  async getJobs<TPayload = unknown>(filter: GetJobsFilter): Promise<JobData<TPayload>[]> {
    const { queue, status, limit = 100, offset = 0 } = filter;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (queue !== undefined) {
      conditions.push(`queue = $${idx++}`);
      params.push(queue);
    }
    if (status !== undefined) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    const res = await this.pool.query<JobRow>(
      `SELECT * FROM qjw_jobs ${where}
       ORDER BY priority DESC, run_at ASC, created_at ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    return res.rows.map((r) => rowToJob<TPayload>(r));
  }

  async getJobCounts(queue: string): Promise<Record<JobStatus, number>> {
    const res = await this.pool.query<{ status: string; count: string }>(
      "SELECT status, COUNT(*)::int AS count FROM qjw_jobs WHERE queue = $1 GROUP BY status",
      [queue],
    );

    const counts: Record<JobStatus, number> = {
      waiting: 0,
      active: 0,
      completed: 0,
      delayed: 0,
      dead: 0,
    };

    for (const row of res.rows) {
      if (row.status in counts) {
        counts[row.status as JobStatus] = Number(row.count);
      }
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

    const res = await this.pool.query<{ count: number; window_start: string }>(
      "SELECT count, window_start FROM qjw_rate_limits WHERE queue = $1",
      [queue],
    );

    if (res.rows.length === 0 || nowMs - Number(res.rows[0]?.window_start ?? 0) >= windowMs) {
      // New window — upsert with count = 1.
      await this.pool.query(
        `INSERT INTO qjw_rate_limits (queue, count, window_start)
         VALUES ($1, 1, $2)
         ON CONFLICT (queue) DO UPDATE
           SET count = 1, window_start = EXCLUDED.window_start`,
        [queue, nowMs],
      );
      return true;
    }

    const current = res.rows[0]!.count;
    if (current >= max) return false;

    await this.pool.query("UPDATE qjw_rate_limits SET count = count + 1 WHERE queue = $1", [queue]);
    return true;
  }
}
