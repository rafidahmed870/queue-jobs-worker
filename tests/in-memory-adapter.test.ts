import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStorageAdapter } from "../src/storage/in-memory.adapter.js";

describe("InMemoryStorageAdapter", () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(async () => {
    adapter = new InMemoryStorageAdapter();
    await adapter.initialize();
  });

  const baseInput = () => ({
    id: "job-1",
    queue: "test",
    type: "send-email",
    payload: { to: "user@example.com" },
    maxAttempts: 3,
    retryDelay: 1000,
    backoff: "exponential" as const,
    timeout: 5000,
    priority: 0,
    runAt: new Date(Date.now() - 1).toISOString(), // eligible immediately
  });

  it("enqueues a job with waiting status", async () => {
    const job = await adapter.enqueue(baseInput());
    expect(job.id).toBe("job-1");
    expect(job.status).toBe("waiting");
  });

  it("enqueue is idempotent for same id", async () => {
    await adapter.enqueue(baseInput());
    const second = await adapter.enqueue(baseInput());
    expect(second.id).toBe("job-1");
    const counts = await adapter.getJobCounts("test");
    expect(counts.waiting).toBe(1);
  });

  it("sets delayed status when runAt is in the future", async () => {
    const input = { ...baseInput(), runAt: new Date(Date.now() + 60_000).toISOString() };
    const job = await adapter.enqueue(input);
    expect(job.status).toBe("delayed");
  });

  it("claim returns null when no jobs are eligible", async () => {
    const result = await adapter.claim({
      queue: "test",
      lockId: "worker-1",
      lockDuration: 30_000,
      now: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it("claims an eligible job and locks it", async () => {
    await adapter.enqueue(baseInput());
    const claimed = await adapter.claim({
      queue: "test",
      lockId: "worker-1",
      lockDuration: 30_000,
      now: new Date().toISOString(),
    });
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("active");
    expect(claimed!.lockId).toBe("worker-1");
  });

  it("two concurrent claims do not return the same job", async () => {
    await adapter.enqueue(baseInput());
    const now = new Date().toISOString();
    const [a, b] = await Promise.all([
      adapter.claim({ queue: "test", lockId: "w1", lockDuration: 30_000, now }),
      adapter.claim({ queue: "test", lockId: "w2", lockDuration: 30_000, now }),
    ]);
    // Only one claim should succeed (Map iteration is synchronous).
    const successCount = [a, b].filter(Boolean).length;
    expect(successCount).toBe(1);
  });

  it("completes a job", async () => {
    await adapter.enqueue(baseInput());
    await adapter.claim({
      queue: "test",
      lockId: "w1",
      lockDuration: 30_000,
      now: new Date().toISOString(),
    });
    await adapter.complete("job-1");
    const job = await adapter.getJob("job-1");
    expect(job!.status).toBe("completed");
    expect(job!.completedAt).not.toBeNull();
  });

  it("requeues a failed job", async () => {
    await adapter.enqueue(baseInput());
    await adapter.claim({
      queue: "test",
      lockId: "w1",
      lockDuration: 30_000,
      now: new Date().toISOString(),
    });
    const future = new Date(Date.now() + 2000).toISOString();
    await adapter.requeue({ jobId: "job-1", runAt: future, error: "timeout" });
    const job = await adapter.getJob("job-1");
    expect(job!.status).toBe("waiting");
    expect(job!.attempts).toHaveLength(1);
    expect(job!.attempts[0]!.error).toBe("timeout");
  });

  it("moves a job to the DLQ", async () => {
    await adapter.enqueue(baseInput());
    await adapter.claim({
      queue: "test",
      lockId: "w1",
      lockDuration: 30_000,
      now: new Date().toISOString(),
    });
    await adapter.moveToDlq({ jobId: "job-1", error: "exhausted" });
    const job = await adapter.getJob("job-1");
    expect(job!.status).toBe("dead");
    expect(job!.failedAt).not.toBeNull();
  });

  it("recovers a stalled job", async () => {
    await adapter.enqueue(baseInput());
    const now = new Date().toISOString();
    // Claim the job to put it in active state.
    await adapter.claim({ queue: "test", lockId: "w1", lockDuration: 30_000, now });

    // Directly mutate the internal job record to simulate an expired lock
    // (the adapter returns the same object reference from the Map).
    const stored = await adapter.getJob("job-1");
    expect(stored).not.toBeNull();
    (stored as { lockExpiresAt: string }).lockExpiresAt = new Date(
      Date.now() - 10_000,
    ).toISOString();

    const recovered = await adapter.recoverStalledJobs("test", new Date().toISOString());
    expect(recovered).toContain("job-1");
    const job = await adapter.getJob("job-1");
    expect(job!.status).toBe("waiting");
  });

  it("rate limiting allows within window and blocks when exceeded", async () => {
    const now = new Date().toISOString();
    const first = await adapter.checkAndIncrementRateLimit("test", 2, 60_000, now);
    const second = await adapter.checkAndIncrementRateLimit("test", 2, 60_000, now);
    const third = await adapter.checkAndIncrementRateLimit("test", 2, 60_000, now);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(third).toBe(false);
  });

  it("getJobCounts returns correct counts", async () => {
    await adapter.enqueue(baseInput());
    await adapter.enqueue({ ...baseInput(), id: "job-2" });
    await adapter.claim({
      queue: "test",
      lockId: "w1",
      lockDuration: 30_000,
      now: new Date().toISOString(),
    });
    const counts = await adapter.getJobCounts("test");
    expect(counts.waiting).toBe(1);
    expect(counts.active).toBe(1);
  });
});
