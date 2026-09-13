import { describe, it, expect, afterEach, vi } from "vitest";
import { QueueClient } from "../src/core/client.js";
import type { StorageAdapter, EnqueueInput, ClaimInput, RequeueInput, MoveToDlqInput, GetJobsFilter } from "../src/types/storage.types.js";
import type { JobData, JobStatus } from "../src/types/job.types.js";

describe("QueueClient", () => {
  let client: QueueClient;

  afterEach(async () => {
    await client.close();
  });

  it("creates a queue", () => {
    client = new QueueClient();
    const q = client.createQueue("emails");
    expect(q.name).toBe("emails");
  });

  it("throws when creating a duplicate queue name", () => {
    client = new QueueClient();
    client.createQueue("emails");
    expect(() => client.createQueue("emails")).toThrow(/already exists/);
  });

  it("getQueue returns undefined for unknown queues", () => {
    client = new QueueClient();
    expect(client.getQueue("missing")).toBeUndefined();
  });

  it("requireQueue throws for unknown queues", () => {
    client = new QueueClient();
    expect(() => client.requireQueue("missing")).toThrow(/not found/);
  });

  it("enqueues a job and retrieves it", async () => {
    client = new QueueClient();
    const queue = client.createQueue<{ msg: string }>("test");
    const job = await queue.enqueue("greet", { msg: "hello" });
    expect(job.id).toBeTruthy();
    expect(job.type).toBe("greet");
    expect(job.status).toBe("waiting");

    const fetched = await queue.getJob(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(job.id);
  });

  it("emits job:enqueued event", async () => {
    client = new QueueClient();
    const queue = client.createQueue("events-test");
    const listener = vi.fn();
    client.on("job:enqueued", listener);
    await queue.enqueue("task", {});
    expect(listener).toHaveBeenCalledOnce();
  });

  it("closes without error", async () => {
    client = new QueueClient();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("close is idempotent", async () => {
    client = new QueueClient();
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });
});

/** Minimal StorageAdapter stub that records initialize() calls. */
class TestAdapter implements StorageAdapter {
  initializeCount = 0;

  async initialize(): Promise<void> {
    this.initializeCount++;
  }

  async close(): Promise<void> {}
  async enqueue<TPayload = unknown>(_input: EnqueueInput<TPayload>): Promise<JobData<TPayload>> {
    return undefined as unknown as JobData<TPayload>;
  }
  async claim<TPayload = unknown>(_input: ClaimInput): Promise<JobData<TPayload> | null> {
    return null;
  }
  async renewLock(_jobId: string, _lockId: string, _lockDuration: number): Promise<boolean> {
    return false;
  }
  async complete(_jobId: string, _lockId?: string): Promise<void> {}
  async requeue(_input: RequeueInput): Promise<void> {}
  async moveToDlq(_input: MoveToDlqInput): Promise<void> {}
  async releaseLock(_jobId: string, _lockId?: string): Promise<void> {}
  async recoverStalledJobs(_queue: string, _now: string): Promise<string[]> {
    return [];
  }
  async getJob<TPayload = unknown>(_jobId: string): Promise<JobData<TPayload> | null> {
    return null;
  }
  async getJobs<TPayload = unknown>(_filter: GetJobsFilter): Promise<JobData<TPayload>[]> {
    return [];
  }
  async getJobCounts(_queue: string): Promise<Record<JobStatus, number>> {
    return {} as Record<JobStatus, number>;
  }
  async checkAndIncrementRateLimit(
    _queue: string,
    _max: number,
    _windowMs: number,
    _now: string,
  ): Promise<boolean> {
    return true;
  }
}

describe("QueueClient.withAdapter() — regression #13", () => {
  let client: QueueClient;

  afterEach(async () => {
    await client.close();
  });

  it("preserves the custom adapter after init()", async () => {
    const adapter = new TestAdapter();

    client = QueueClient.withAdapter(adapter);
    await client.init();

    // The adapter instance must be the same object stored on the client.
    expect(client._storage).toBe(adapter);
    // initialize() must have been called exactly once by init().
    expect(adapter.initializeCount).toBe(1);
  });

  it("init() is idempotent — adapter.initialize() is called exactly once", async () => {
    const adapter = new TestAdapter();

    client = QueueClient.withAdapter(adapter);
    await client.init();
    await client.init(); // second call must be a no-op

    expect(adapter.initializeCount).toBe(1);
  });
});
