import { describe, it, expect, afterEach, vi } from "vitest";
import { QueueClient } from "../src/core/client.js";

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
