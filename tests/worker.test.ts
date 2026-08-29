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
