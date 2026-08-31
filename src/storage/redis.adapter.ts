/**
 * RedisStorageAdapter  (node-redis v4/v5)
 *
 * Key layout  — prefix: "qjw:"
 * ─────────────────────────────────────────────────────────────────────────
 *  qjw:job:{id}                → Hash   — all job fields (flat strings)
 *  qjw:queue:{name}:waiting    → Sorted Set  score = -priority
 *                                            (ZPOPMIN → highest priority first)
 *  qjw:queue:{name}:delayed    → Sorted Set  score = runAt epoch-ms
 *  qjw:queue:{name}:active     → Set
 *  qjw:queue:{name}:completed  → Set
 *  qjw:queue:{name}:dead       → Set
 *  qjw:rate:{name}             → String  sliding-window counter
 *  qjw:rate:{name}:ts          → String  window-start epoch-ms
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Atomic claim
 * ─────────────────────────────────────────────────────────────────────────
 *  A Lua script executed by Redis guarantees that two concurrent workers
 *  cannot claim the same job.
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
import type { JobData, JobStatus, JobAttempt } from "../types/job.types.js";

// ---------------------------------------------------------------------------
// Lazy import — redis is an optional peer dependency
// ---------------------------------------------------------------------------

// Type-only import — runtime import is deferred inside loadRedis().
import type { RedisClientType } from "redis";
import type * as RedisModule from "redis";

async function loadRedis(): Promise<typeof RedisModule> {
  try {
    return await import("redis");
  } catch {
    throw new Error(
      'RedisStorageAdapter requires the "redis" package (node-redis v4+).\n' +
        "Install it: npm install redis",
    );
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

const PREFIX = "qjw:";

const k = {
  job: (id: string) => `${PREFIX}job:${id}`,
  waiting: (q: string) => `${PREFIX}queue:${q}:waiting`,
  delayed: (q: string) => `${PREFIX}queue:${q}:delayed`,
  active: (q: string) => `${PREFIX}queue:${q}:active`,
  completed: (q: string) => `${PREFIX}queue:${q}:completed`,
  dead: (q: string) => `${PREFIX}queue:${q}:dead`,
  rateCount: (q: string) => `${PREFIX}rate:${q}`,
  rateTs: (q: string) => `${PREFIX}rate:${q}:ts`,
};

// ---------------------------------------------------------------------------
// Lua — atomic claim
//
// KEYS[1]  waiting sorted set
// KEYS[2]  delayed sorted set
// KEYS[3]  active set
// ARGV[1]  lock ID  (worker id)
// ARGV[2]  lockExpiresAt ISO string
// ARGV[3]  now epoch-ms (string)
// ARGV[4]  PREFIX  (passed as arg to keep the script host-agnostic)
//
// Returns claimed job ID or empty string.
// ---------------------------------------------------------------------------

const CLAIM_LUA = `
local prefix    = ARGV[4]
local now_ms    = tonumber(ARGV[3])

-- Promote due delayed jobs into the waiting set.
local due = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now_ms)
for _, jid in ipairs(due) do
  local pri_raw = redis.call('HGET', prefix .. 'job:' .. jid, 'priority')
  local pri = tonumber(pri_raw) or 0
  redis.call('ZADD',  KEYS[1], -pri, jid)
  redis.call('ZREM',  KEYS[2], jid)
  redis.call('HSET',  prefix .. 'job:' .. jid, 'status', 'waiting')
end

-- Pop the top-priority job.
local items = redis.call('ZPOPMIN', KEYS[1], 1)
if #items == 0 then return '' end
local job_id = items[1]

-- Lock it.
redis.call('SADD', KEYS[3], job_id)
redis.call('HSET', prefix .. 'job:' .. job_id,
  'status',        'active',
  'lockId',        ARGV[1],
  'lockExpiresAt', ARGV[2],
  'updatedAt',     ARGV[2]
)
return job_id
`;

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

type FlatHash = Record<string, string>;

function jobToHash(job: JobData<unknown>): FlatHash {
  return {
    id: job.id,
    queue: job.queue,
    type: job.type,
    payload: JSON.stringify(job.payload),
    status: job.status,
    attemptsMade: String(job.attemptsMade),
    maxAttempts: String(job.maxAttempts),
    retryDelay: String(job.retryDelay),
    backoff: job.backoff,
    timeout: String(job.timeout),
    priority: String(job.priority),
    runAt: job.runAt,
    ...(job.cron !== undefined ? { cron: job.cron } : {}),
    attempts: JSON.stringify(job.attempts),
    lockId: job.lockId ?? "",
    lockExpiresAt: job.lockExpiresAt ?? "",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? "",
    failedAt: job.failedAt ?? "",
  };
}

function hashToJob<TPayload>(h: FlatHash): JobData<TPayload> {
  const job: JobData<TPayload> = {
    id: h["id"] ?? "",
    queue: h["queue"] ?? "",
    type: h["type"] ?? "",
    payload: JSON.parse(h["payload"] ?? "null") as TPayload,
    status: (h["status"] ?? "waiting") as JobStatus,
    attemptsMade: Number(h["attemptsMade"] ?? 0),
    maxAttempts: Number(h["maxAttempts"] ?? 1),
    retryDelay: Number(h["retryDelay"] ?? 1000),
    backoff: (h["backoff"] ?? "exponential") as JobData<TPayload>["backoff"],
    timeout: Number(h["timeout"] ?? 30000),
    priority: Number(h["priority"] ?? 0),
    runAt: h["runAt"] ?? new Date().toISOString(),
    attempts: JSON.parse(h["attempts"] ?? "[]") as JobAttempt[],
    lockId: h["lockId"] || null,
    lockExpiresAt: h["lockExpiresAt"] || null,
    createdAt: h["createdAt"] ?? new Date().toISOString(),
    updatedAt: h["updatedAt"] ?? new Date().toISOString(),
    completedAt: h["completedAt"] || null,
    failedAt: h["failedAt"] || null,
  };
  if (h["cron"]) job.cron = h["cron"];
  return job;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RedisStorageAdapter implements StorageAdapter {
  private client!: RedisClientType;
  private readonly url: string;

  constructor(connectionString: string) {
    this.url = connectionString;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    const { createClient } = await loadRedis();

    this.client = createClient({ url: this.url }) as RedisClientType;

    // Surface connection errors as exceptions (node-redis v4 hides them otherwise).
    this.client.on("error", () => {
      // Handled by the connect() rejection below on first connect.
      // Subsequent errors are emitted on the client; callers should listen if needed.
    });

    await this.client.connect();

    // Verify the connection is healthy.
    const pong = await this.client.ping();
    if (pong !== "PONG") {
      throw new Error(
        "RedisStorageAdapter: PING returned unexpected response. Connection may be unhealthy.",
      );
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  async enqueue<TPayload = unknown>(input: EnqueueInput<TPayload>): Promise<JobData<TPayload>> {
    const now = new Date().toISOString();
    const runAtMs = new Date(input.runAt).getTime();
    const isDelayed = runAtMs > Date.now();

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
      runAt: input.runAt,
      ...(input.cron !== undefined ? { cron: input.cron } : {}),
      attempts: [],
      lockId: null,
      lockExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failedAt: null,
    };

    const key = k.job(input.id);

    // Idempotent — return existing job if already present.
    const exists = await this.client.exists(key);
    if (exists) {
      const hash = await this.client.hGetAll(key);
      return hashToJob<TPayload>(hash);
    }

    // Persist in a pipeline.
    const multi = this.client.multi();
    multi.hSet(key, jobToHash(job as JobData<unknown>));

    if (isDelayed) {
      multi.zAdd(k.delayed(input.queue), { score: runAtMs, value: input.id });
    } else {
      // Negative priority score → ZPOPMIN yields highest priority first.
      multi.zAdd(k.waiting(input.queue), { score: -input.priority, value: input.id });
    }

    await multi.exec();
    return job;
  }

  // -------------------------------------------------------------------------
  // Claim  (atomic Lua)
  // -------------------------------------------------------------------------

  async claim<TPayload = unknown>(input: ClaimInput): Promise<JobData<TPayload> | null> {
    const { queue, lockId, lockDuration, now } = input;
    const nowMs = new Date(now).getTime();
    const lockExpiresAt = new Date(nowMs + lockDuration).toISOString();

    // node-redis v4 eval signature:
    //   client.eval(script, { keys, arguments })
    const jobId = (await this.client.eval(CLAIM_LUA, {
      keys: [k.waiting(queue), k.delayed(queue), k.active(queue)],
      arguments: [lockId, lockExpiresAt, String(nowMs), PREFIX],
    })) as string;

    if (!jobId) return null;

    const hash = await this.client.hGetAll(k.job(jobId));
    if (!hash || Object.keys(hash).length === 0) return null;

    return hashToJob<TPayload>(hash);
  }

  // -------------------------------------------------------------------------
  // Complete
  // -------------------------------------------------------------------------

  async complete(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    const hash = await this.client.hGetAll(k.job(jobId));
    if (!hash) return;

    const queue = hash["queue"] ?? "";
    const multi = this.client.multi();
    multi.hSet(k.job(jobId), {
      status: "completed",
      lockId: "",
      lockExpiresAt: "",
      completedAt: now,
      updatedAt: now,
    });
    multi.sRem(k.active(queue), jobId);
    multi.sAdd(k.completed(queue), jobId);
    await multi.exec();
  }

  // -------------------------------------------------------------------------
  // Requeue
  // -------------------------------------------------------------------------

  async requeue(input: RequeueInput): Promise<void> {
    const now = new Date().toISOString();
    const hash = await this.client.hGetAll(k.job(input.jobId));
    if (!hash) return;

    const queue = hash["queue"] ?? "";
    const attempts: JobAttempt[] = JSON.parse(hash["attempts"] ?? "[]") as JobAttempt[];

    attempts.push({
      attempt: input.attemptNumber,
      startedAt: hash["updatedAt"] ?? now,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    });

    const multi = this.client.multi();
    multi.hSet(k.job(input.jobId), {
      status: "waiting",
      attemptsMade: String(input.attemptNumber),
      attempts: JSON.stringify(attempts),
      runAt: input.runAt,
      lockId: "",
      lockExpiresAt: "",
      updatedAt: now,
    });
    multi.sRem(k.active(queue), input.jobId);
    // Put back in delayed set so the claim script can promote it when due.
    multi.zAdd(k.delayed(queue), {
      score: new Date(input.runAt).getTime(),
      value: input.jobId,
    });
    await multi.exec();
  }

  // -------------------------------------------------------------------------
  // Move to DLQ
  // -------------------------------------------------------------------------

  async moveToDlq(input: MoveToDlqInput): Promise<void> {
    const now = new Date().toISOString();
    const hash = await this.client.hGetAll(k.job(input.jobId));
    if (!hash) return;

    const queue = hash["queue"] ?? "";
    const attempts: JobAttempt[] = JSON.parse(hash["attempts"] ?? "[]") as JobAttempt[];

    attempts.push({
      attempt: input.attemptNumber,
      startedAt: hash["updatedAt"] ?? now,
      finishedAt: now,
      error: input.error,
      ...(input.stack !== undefined ? { stack: input.stack } : {}),
    });

    const multi = this.client.multi();
    multi.hSet(k.job(input.jobId), {
      status: "dead",
      attemptsMade: String(input.attemptNumber),
      attempts: JSON.stringify(attempts),
      lockId: "",
      lockExpiresAt: "",
      failedAt: now,
      updatedAt: now,
    });
    multi.sRem(k.active(queue), input.jobId);
    multi.sAdd(k.dead(queue), input.jobId);
    await multi.exec();
  }

  // -------------------------------------------------------------------------
  // Release lock
  // -------------------------------------------------------------------------

  async releaseLock(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    // Set lockExpiresAt to now (already-expired) rather than clearing it to an
    // empty string. recoverStalledJobs() skips entries where lockExpiresAt is
    // falsy, so an empty string would leave the job permanently stuck.
    await this.client.hSet(k.job(jobId), {
      lockId: "",
      lockExpiresAt: now,
      updatedAt: now,
    });
  }

  // -------------------------------------------------------------------------
  // Recover stalled jobs  (batched — one pipeline per stalled job)
  // -------------------------------------------------------------------------

  async recoverStalledJobs(queue: string, now: string): Promise<string[]> {
    const nowMs = new Date(now).getTime();
    const activeIds = await this.client.sMembers(k.active(queue));
    if (activeIds.length === 0) return [];

    // Fetch lockExpiresAt and priority for all active jobs in a single pipeline.
    const fetchPipeline = this.client.multi();
    for (const jobId of activeIds) {
      fetchPipeline.hmGet(k.job(jobId), ["lockExpiresAt", "priority"]);
    }
    const fetchResults = await fetchPipeline.exec();

    const recovered: string[] = [];
    const recoverPipeline = this.client.multi();

    for (let i = 0; i < activeIds.length; i++) {
      const jobId = activeIds[i] as string;
      const fields = fetchResults[i] as unknown as [string | null, string | null] | null;
      if (!fields) continue;

      const [lockExpiresAt, priorityStr] = fields;
      if (!lockExpiresAt) continue;
      if (new Date(lockExpiresAt).getTime() > nowMs) continue;

      const priority = Number(priorityStr ?? "0");
      recoverPipeline.hSet(k.job(jobId), {
        status: "waiting",
        lockId: "",
        lockExpiresAt: "",
        updatedAt: now,
      });
      recoverPipeline.sRem(k.active(queue), jobId);
      recoverPipeline.zAdd(k.waiting(queue), { score: -priority, value: jobId });
      recovered.push(jobId);
    }

    if (recovered.length > 0) {
      await recoverPipeline.exec();
    }

    return recovered;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getJob<TPayload = unknown>(jobId: string): Promise<JobData<TPayload> | null> {
    const hash = await this.client.hGetAll(k.job(jobId));
    if (!hash || Object.keys(hash).length === 0) return null;
    return hashToJob<TPayload>(hash);
  }

  async getJobs<TPayload = unknown>(filter: GetJobsFilter): Promise<JobData<TPayload>[]> {
    const { queue, status, limit = 100, offset = 0 } = filter;

    let ids: string[] = [];

    if (queue && status) {
      switch (status) {
        case "waiting":
          ids = await this.client.zRange(k.waiting(queue), 0, -1);
          break;
        case "delayed":
          ids = await this.client.zRange(k.delayed(queue), 0, -1);
          break;
        case "active":
          ids = await this.client.sMembers(k.active(queue));
          break;
        case "completed":
          ids = await this.client.sMembers(k.completed(queue));
          break;
        case "dead":
          ids = await this.client.sMembers(k.dead(queue));
          break;
        default:
          ids = [];
      }
    } else {
      // Scan all job keys — suitable for dev/small datasets only.
      for await (const key of this.client.scanIterator({
        MATCH: `${PREFIX}job:*`,
        COUNT: 500,
      })) {
        const keyStr: string = Array.isArray(key) ? String(key[0]) : String(key);
        ids.push(keyStr.replace(`${PREFIX}job:`, ""));
      }
    }

    const results: JobData<TPayload>[] = [];
    const page = ids.slice(offset, offset + limit);

    for (const id of page) {
      const job = await this.getJob<TPayload>(id);
      if (!job) continue;
      if (queue && job.queue !== queue) continue;
      if (status && job.status !== status) continue;
      results.push(job);
    }

    return results;
  }

  async getJobCounts(queue: string): Promise<Record<JobStatus, number>> {
    const [waiting, delayed, active, completed, dead] = await Promise.all([
      this.client.zCard(k.waiting(queue)),
      this.client.zCard(k.delayed(queue)),
      this.client.sCard(k.active(queue)),
      this.client.sCard(k.completed(queue)),
      this.client.sCard(k.dead(queue)),
    ]);

    return { waiting, delayed, active, completed, dead };
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
    const ck = k.rateCount(queue);
    const tk = k.rateTs(queue);

    const windowStart = await this.client.get(tk);
    const ttlSec = Math.ceil(windowMs / 1000);

    if (!windowStart || nowMs - Number(windowStart) >= windowMs) {
      // Fresh window.
      const multi = this.client.multi();
      multi.set(ck, "1");
      multi.expire(ck, ttlSec);
      multi.set(tk, String(nowMs));
      multi.expire(tk, ttlSec);
      await multi.exec();
      return true;
    }

    const count = await this.client.incr(ck);
    if (count > max) {
      await this.client.decr(ck);
      return false;
    }

    return true;
  }
}
