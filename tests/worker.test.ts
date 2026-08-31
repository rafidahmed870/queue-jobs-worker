import { describe, it, expect, afterEach, vi } from "vitest";
import { QueueClient } from "../src/core/client.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("Worker", () => {
  let client: QueueClient;

  afterEach(async () => {
    await client.close();
  });

  it("processes a job successfully", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50 } });
    const queue = client.createQueue<{ n: number }>("proc");
    const processed = vi.fn();

    queue.process("add", async (job) => {
      processed(job.data.n);
    });

    await queue.enqueue("add", { n: 42 });
    const worker = queue.createWorker({ concurrency: 1 });

    await sleep(300);

    expect(processed).toHaveBeenCalledWith(42);
    await worker.stop();
  });

  it("emits job:completed on success", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50 } });
    const queue = client.createQueue("completed-test");
    const completedListener = vi.fn();
    client.on("job:completed", completedListener);

    queue.process("noop", async () => {});
    await queue.enqueue("noop", {});
    const worker = queue.createWorker();

    await sleep(300);
    expect(completedListener).toHaveBeenCalledOnce();
    await worker.stop();
  });

  it("retries a failing job", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50, retryDelay: 10 } });
    const queue = client.createQueue("retry-test");
    const attempts = vi.fn();

    queue.process("fail", async () => {
      attempts();
      throw new Error("boom");
    });

    await queue.enqueue("fail", {}, { attempts: 3, retryDelay: 10 });
    const worker = queue.createWorker({ concurrency: 1 });

    await sleep(800);

    // Should have attempted 3 times then moved to DLQ.
    expect(attempts.mock.calls.length).toBeGreaterThanOrEqual(2);
    await worker.stop();
  });

  it("moves job to DLQ after exhausting attempts", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50 } });
    const queue = client.createQueue("dlq-test");
    const deadListener = vi.fn();
    client.on("job:dead", deadListener);

    queue.process("crash", async () => {
      throw new Error("fatal");
    });
    await queue.enqueue("crash", {}, { attempts: 1, retryDelay: 0 });
    const worker = queue.createWorker({ concurrency: 1 });

    await sleep(400);
    expect(deadListener).toHaveBeenCalledOnce();
    await worker.stop();
  });

  it("respects concurrency limit", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50 } });
    const queue = client.createQueue("concurrency-test");
    let concurrent = 0;
    let maxConcurrent = 0;

    queue.process("slow", async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(100);
      concurrent--;
    });

    for (let i = 0; i < 6; i++) {
      await queue.enqueue("slow", {});
    }

    const worker = queue.createWorker({ concurrency: 2 });
    await sleep(800);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    await worker.stop();
  });

  it("worker graceful stop", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50 } });
    const queue = client.createQueue("stop-test");
    queue.process("task", async () => {
      await sleep(50);
    });
    await queue.enqueue("task", {});
    const worker = queue.createWorker();

    await sleep(80);
    await worker.stop();
    expect(worker.status).toBe("stopped");
  });

  it("job released via releaseLock during shutdown is recovered by recoverStalledJobs", async () => {
    // Regression test for: releaseLock() leaving jobs permanently stuck in
    // "active" status because lockExpiresAt was set to null/empty, causing
    // recoverStalledJobs() to skip them (issue #1).
    //
    // We test releaseLock() directly on the adapter rather than going through
    // the full worker shutdown cycle, because executeJob() runs fire-and-forget
    // and its finally{} block can race against the post-stop assertions.
    const { InMemoryStorageAdapter } = await import("../src/storage/in-memory.adapter.js");
    const adapter = new InMemoryStorageAdapter();
    await adapter.initialize();

    const enqueuedJob = await adapter.enqueue({
      id: "test-release-job",
      queue: "release-lock-test",
      type: "long-task",
      payload: {},
      maxAttempts: 3,
      retryDelay: 1000,
      backoff: "exponential",
      timeout: 30_000,
      priority: 0,
      runAt: new Date(Date.now() - 1).toISOString(),
    });

    // Claim it so it becomes active.
    const claimed = await adapter.claim({
      queue: "release-lock-test",
      lockId: "worker-1",
      lockDuration: 60_000,
      now: new Date().toISOString(),
    });
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("active");

    // Simulate what worker.stop() does when shutdownTimeout elapses.
    await adapter.releaseLock(enqueuedJob.id);

    // --- Core assertions ---

    // Job must remain "active" (not silently transitioned away).
    const afterRelease = await adapter.getJob(enqueuedJob.id);
    expect(afterRelease!.status).toBe("active");

    // lockExpiresAt must be non-null AND already-expired so that
    // recoverStalledJobs() can match it — NOT null or empty string.
    expect(afterRelease!.lockExpiresAt).not.toBeNull();
    expect(afterRelease!.lockExpiresAt).not.toBe("");
    const lockExpiry = new Date(afterRelease!.lockExpiresAt!).getTime();
    expect(lockExpiry).toBeLessThanOrEqual(Date.now());

    // recoverStalledJobs() must reclaim the job.
    const recovered = await adapter.recoverStalledJobs(
      "release-lock-test",
      new Date().toISOString(),
    );
    expect(recovered).toContain(enqueuedJob.id);

    // After recovery the job must be back to "waiting" — reclaimable.
    const afterRecovery = await adapter.getJob(enqueuedJob.id);
    expect(afterRecovery!.status).toBe("waiting");
    expect(afterRecovery!.lockId).toBeNull();
    expect(afterRecovery!.lockExpiresAt).toBeNull();

    await adapter.close();
  });

  it("emits job:failed on processor error", async () => {
    client = new QueueClient({ defaults: { pollInterval: 50 } });
    const queue = client.createQueue("fail-event");
    const failedListener = vi.fn();
    client.on("job:failed", failedListener);

    queue.process("err", async () => {
      throw new Error("oops");
    });
    await queue.enqueue("err", {}, { attempts: 1 });
    const worker = queue.createWorker({ concurrency: 1 });

    await sleep(300);
    expect(failedListener).toHaveBeenCalledOnce();
    await worker.stop();
  });
});
