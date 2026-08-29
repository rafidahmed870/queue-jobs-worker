/**
 * MySQLStorageAdapter  (mysql2/promise)
 *
 * Table prefix: "qjw_"
 *
 * Tables created on init (if they do not exist):
 *   qjw_jobs           — full job state
 *   qjw_rate_limits    — sliding-window rate-limit counters
 *
 * Atomicity
 * ─────────────────────────────────────────────────────────────────────────
 *  Claim uses SELECT … FOR UPDATE SKIP LOCKED inside a transaction —
 *  concurrent workers safely skip rows that are already being claimed.
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
// Lazy import — mysql2 is an optional peer dependency
// ---------------------------------------------------------------------------

// Type-only imports — runtime import is deferred inside loadMySQL2().
import type { Pool as MySQLPool, PoolConnection as MySQLConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type * as MySQL2Module from "mysql2/promise";

async function loadMySQL2(): Promise<typeof MySQL2Module> {
  try {
    return await import("mysql2/promise");
  } catch {
    throw new Error(
      'MySQLStorageAdapter requires the "mysql2" package.\n' + "Install it: npm install mysql2",
    );
  }
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const CREATE_JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS qjw_jobs (
  id               VARCHAR(36)  NOT NULL PRIMARY KEY,
  queue            VARCHAR(255) NOT NULL,
  type             VARCHAR(255) NOT NULL,
  payload          JSON         NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'waiting',
  attempts_made    INT          NOT NULL DEFAULT 0,
  max_attempts     INT          NOT NULL DEFAULT 3,
  retry_delay      INT          NOT NULL DEFAULT 1000,
  backoff          VARCHAR(20)  NOT NULL DEFAULT 'exponential',
  timeout          INT          NOT NULL DEFAULT 30000,
  priority         INT          NOT NULL DEFAULT 0,
  run_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cron             VARCHAR(255),
  attempts         JSON         NOT NULL,
  lock_id          VARCHAR(255),
  lock_expires_at  DATETIME(3),
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at     DATETIME(3),
  failed_at        DATETIME(3),
  INDEX qjw_jobs_claim_idx (queue, status, run_at, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

const CREATE_RATE_TABLE = `
CREATE TABLE IF NOT EXISTS qjw_rate_limits (
  queue        VARCHAR(255) NOT NULL PRIMARY KEY,
  count        INT          NOT NULL DEFAULT 0,
  window_start BIGINT       NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// ---------------------------------------------------------------------------
// Row → JobData
// ---------------------------------------------------------------------------

interface JobRow extends RowDataPacket {
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
  // mysql2 returns JSON columns as parsed objects when supportBigNumbers/parseJson is on.
  const payload =
    typeof row.payload === "string"
      ? (JSON.parse(row.payload) as TPayload)
      : (row.payload as TPayload);

  const attempts =
    typeof row.attempts === "string" ? JSON.parse(row.attempts) : (row.attempts ?? []);

  const job: JobData<TPayload> = {
    id: row.id,
    queue: row.queue,
    type: row.type,
    payload,
    status: row.status as JobStatus,
    attemptsMade: Number(row.attempts_made),
    maxAttempts: Number(row.max_attempts),
    retryDelay: Number(row.retry_delay),
    backoff: row.backoff as JobData<TPayload>["backoff"],
    timeout: Number(row.timeout),
    priority: Number(row.priority),
    runAt: row.run_at instanceof Date ? row.run_at.toISOString() : String(row.run_at),
    attempts: attempts as JobData<TPayload>["attempts"],
    lockId: row.lock_id,
    lockExpiresAt: row.lock_expires_at instanceof Date ? row.lock_expires_at.toISOString() : null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : null,
    failedAt: row.failed_at instanceof Date ? row.failed_at.toISOString() : null,
  };

  if (row.cron) job.cron = row.cron;
  return job;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MySQLStorageAdapter implements StorageAdapter {
  private pool!: MySQLPool;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    const mysql2 = await loadMySQL2();

    this.pool = mysql2.createPool({
      uri: this.connectionString,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Verify connectivity and auto-create tables.
    const conn: MySQLConnection = await this.pool.getConnection();
    try {
      await conn.query("SELECT 1");
      await conn.query(CREATE_JOBS_TABLE);
      await conn.query(CREATE_RATE_TABLE);
    } finally {
      conn.release();
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
    const runAtMs = new Date(input.runAt).getTime();
    const isDelayed = runAtMs > Date.now();
    const status = isDelayed ? "delayed" : "waiting";

    await this.pool.query(
      `INSERT IGNORE INTO qjw_jobs
         (id, queue, type, payload, status, attempts_made, max_attempts,
          retry_delay, backoff, timeout, priority, run_at, cron,
          attempts, lock_id, lock_expires_at, created_at, updated_at,
          completed_at, failed_at)
       VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,NULL,NULL,NOW(3),NOW(3),NULL,NULL)`,
      [
        input.id,
        input.queue,
        input.type,
        JSON.stringify(input.payload),
        status,
        input.maxAttempts,
        input.retryDelay,
        input.backoff,
        input.timeout,
        input.priority,
        input.runAt,
        input.cron ?? null,
        JSON.stringify([]),
      ],
    );

    const rows = await this.pool.query<JobRow[]>("SELECT * FROM qjw_jobs WHERE id = ?", [input.id]);
    const row = (rows[0] as unknown as JobRow[])[0] as JobRow;
    return rowToJob<TPayload>(row);
  }

  // -------------------------------------------------------------------------
  // Claim  (transaction + SELECT … FOR UPDATE SKIP LOCKED)
  // -------------------------------------------------------------------------

  async claim<TPayload = unknown>(input: ClaimInput): Promise<JobData<TPayload> | null> {
    const { queue, lockId, lockDuration, now } = input;
    const lockExpiresAt = new Date(new Date(now).getTime() + lockDuration)
      .toISOString()
      .slice(0, 23)
      .replace("T", " ");
    const nowMysql = new Date(now).toISOString().slice(0, 23).replace("T", " ");

    const conn: MySQLConnection = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<JobRow[]>(
        `SELECT * FROM qjw_jobs
         WHERE queue  = ?
           AND status IN ('waiting', 'delayed')
           AND run_at <= ?
           AND (lock_expires_at IS NULL OR lock_expires_at <= ?)
         ORDER BY priority DESC, run_at ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [queue, nowMysql, nowMysql],
      );

      if (!rows || rows.length === 0) {
        await conn.rollback();
        return null;
      }

      const row = rows[0] as JobRow;

      await conn.query(
        `UPDATE qjw_jobs
         SET status = 'active', lock_id = ?, lock_expires_at = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [lockId, lockExpiresAt, row.id],
      );

      await conn.commit();

      // Re-fetch the updated row.
      const [updated] = await this.pool.query<JobRow[]>("SELECT * FROM qjw_jobs WHERE id = ?", [
        row.id,
      ]);
      return rowToJob<TPayload>((updated as unknown as JobRow[])[0] as JobRow);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // -------------------------------------------------------------------------
  // Complete
  // -------------------------------------------------------------------------

  async complete(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE qjw_jobs
       SET status = 'completed', lock_id = NULL, lock_expires_at = NULL,
           completed_at = NOW(3), updated_at = NOW(3)
       WHERE id = ?`,
      [jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Requeue
  // -------------------------------------------------------------------------

  async requeue(input: RequeueInput): Promise<void> {
    const now = new Date().toISOString();
    const attempt = JSON.stringify({
      attempt: input.attemptNumber,
      startedAt: now,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    });

    // JSON_ARRAY_APPEND appends to the attempts JSON array atomically.
    await this.pool.query(
      `UPDATE qjw_jobs
       SET status          = 'waiting',
           attempts_made   = attempts_made + 1,
           attempts        = JSON_ARRAY_APPEND(attempts, '$', CAST(? AS JSON)),
           run_at          = ?,
           lock_id         = NULL,
           lock_expires_at = NULL,
           updated_at      = NOW(3)
       WHERE id = ?`,
      [attempt, input.runAt, input.jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Move to DLQ
  // -------------------------------------------------------------------------

  async moveToDlq(input: MoveToDlqInput): Promise<void> {
    const now = new Date().toISOString();
    const attempt = JSON.stringify({
      attempt: input.attemptNumber,
      startedAt: now,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    });

    await this.pool.query(
      `UPDATE qjw_jobs
       SET status          = 'dead',
           attempts_made   = attempts_made + 1,
           attempts        = JSON_ARRAY_APPEND(attempts, '$', CAST(? AS JSON)),
           lock_id         = NULL,
           lock_expires_at = NULL,
           failed_at       = NOW(3),
           updated_at      = NOW(3)
       WHERE id = ?`,
      [attempt, input.jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Release lock
  // -------------------------------------------------------------------------

  async releaseLock(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE qjw_jobs
       SET lock_id = NULL, lock_expires_at = NULL, updated_at = NOW(3)
       WHERE id = ?`,
      [jobId],
    );
  }

  // -------------------------------------------------------------------------
  // Recover stalled jobs  (atomic — SELECT … FOR UPDATE inside transaction)
  // -------------------------------------------------------------------------

  async recoverStalledJobs(queue: string, now: string): Promise<string[]> {
    const nowMysql = new Date(now).toISOString().slice(0, 23).replace("T", " ");

    const conn: MySQLConnection = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Lock the matching rows so no other worker can claim them concurrently.
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM qjw_jobs
         WHERE queue = ?
           AND status = 'active'
           AND lock_expires_at <= ?
         FOR UPDATE SKIP LOCKED`,
        [queue, nowMysql],
      );

      const ids = (rows as RowDataPacket[]).map((r) => String(r["id"]));

      if (ids.length > 0) {
        await conn.query(
          `UPDATE qjw_jobs
           SET status = 'waiting', lock_id = NULL, lock_expires_at = NULL, updated_at = NOW(3)
           WHERE id IN (?)`,
          [ids],
        );
      }

      await conn.commit();
      return ids;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getJob<TPayload = unknown>(jobId: string): Promise<JobData<TPayload> | null> {
    const [rows] = await this.pool.query<JobRow[]>("SELECT * FROM qjw_jobs WHERE id = ?", [jobId]);
    const list = rows as unknown as JobRow[];
    if (!list || list.length === 0) return null;
    return rowToJob<TPayload>(list[0] as JobRow);
  }

  async getJobs<TPayload = unknown>(filter: GetJobsFilter): Promise<JobData<TPayload>[]> {
    const { queue, status, limit = 100, offset = 0 } = filter;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (queue !== undefined) {
      conditions.push("queue = ?");
      params.push(queue);
    }
    if (status !== undefined) {
      conditions.push("status = ?");
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    const [rows] = await this.pool.query<JobRow[]>(
      `SELECT * FROM qjw_jobs ${where}
       ORDER BY priority DESC, run_at ASC, created_at ASC
       LIMIT ? OFFSET ?`,
      params,
    );

    return (rows as unknown as JobRow[]).map((r) => rowToJob<TPayload>(r));
  }

  async getJobCounts(queue: string): Promise<Record<JobStatus, number>> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT status, COUNT(*) AS count FROM qjw_jobs WHERE queue = ? GROUP BY status",
      [queue],
    );

    const counts: Record<JobStatus, number> = {
      waiting: 0,
      active: 0,
      completed: 0,
      delayed: 0,
      dead: 0,
    };

    for (const row of rows as RowDataPacket[]) {
      const s = String(row["status"]);
      if (s in counts) counts[s as JobStatus] = Number(row["count"]);
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

    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT count, window_start FROM qjw_rate_limits WHERE queue = ?",
      [queue],
    );

    const existing = (rows as RowDataPacket[])[0];

    if (!existing || nowMs - Number(existing["window_start"]) >= windowMs) {
      await this.pool.query(
        `INSERT INTO qjw_rate_limits (queue, count, window_start) VALUES (?,1,?)
         ON DUPLICATE KEY UPDATE count = 1, window_start = VALUES(window_start)`,
        [queue, nowMs],
      );
      return true;
    }

    if (Number(existing["count"]) >= max) return false;

    await this.pool.query("UPDATE qjw_rate_limits SET count = count + 1 WHERE queue = ?", [queue]);
    return true;
  }
}
