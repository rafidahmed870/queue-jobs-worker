/**
 * QueueClient
 *
 * Primary entry point for the queue-jobs-worker package.
 *
 * Usage:
 *
 *   // In-memory (dev / tests)
 *   const client = new QueueClient();
 *   // init() is optional for "memory" but always safe to call
 *
 *   // Redis
 *   const client = new QueueClient({ dialect: "redis", connectionString: "redis://localhost:6379" });
 *   await client.init();   // connects, pings Redis
 *
 *   // PostgreSQL
 *   const client = new QueueClient({ dialect: "postgres", connectionString: "postgresql://..." });
 *   await client.init();   // connects, auto-creates qjw_ tables if missing
 *
 *   // MySQL
 *   const client = new QueueClient({ dialect: "mysql", connectionString: "mysql://..." });
 *   await client.init();   // connects, auto-creates qjw_ tables if missing
 */

import type { QueueClientOptions, ClientDefaults } from "../types/client.types.js";
import type { QueueOptions } from "../types/queue.types.js";
import type { StorageAdapter } from "../types/storage.types.js";
import type { QueueEvents } from "../types/events.types.js";
import { Queue } from "./queue.js";
import { InMemoryStorageAdapter } from "../storage/in-memory.adapter.js";
import { QueueEventEmitter } from "../events/emitter.js";

// ---------------------------------------------------------------------------
// Hard defaults
// ---------------------------------------------------------------------------

const HARD_DEFAULTS: Required<ClientDefaults> = {
  attempts: 3,
  retryDelay: 1_000,
  backoff: "exponential",
  timeout: 30_000,
  concurrency: 10,
  rateLimit: undefined as unknown as Required<ClientDefaults>["rateLimit"],
  pollInterval: 1_000,
  stalledInterval: 30_000,
  lockDuration: 60_000,
};

// ---------------------------------------------------------------------------
// QueueClient
// ---------------------------------------------------------------------------

export class QueueClient {
  /** @internal — mutable so withAdapter() can replace it */
  _storage: StorageAdapter;

  private readonly emitter: QueueEventEmitter;
  private readonly defaults: Required<ClientDefaults>;
  private readonly dialect: string;
  private readonly connectionString: string | undefined;
  private readonly queues = new Map<string, Queue<unknown>>();
  private initialised = false;
  private closed = false;

  constructor(options: QueueClientOptions = {}) {
    this.defaults = { ...HARD_DEFAULTS, ...options.defaults };
    this.dialect = options.dialect ?? "memory";
    this.connectionString = options.connectionString;

    // Memory adapter is built eagerly (no I/O needed).
    // External adapters are built eagerly too, but require init() before use.
    this._storage = this.buildMemoryOrEagerAdapter();
    this.emitter = new QueueEventEmitter();
  }

  // -------------------------------------------------------------------------
  // Eager adapter construction (memory only; external adapters built in init)
  // -------------------------------------------------------------------------

  private buildMemoryOrEagerAdapter(): StorageAdapter {
    if (this.dialect === "memory") {
      return new InMemoryStorageAdapter();
    }
    // For external dialects we return a sentinel that will be replaced in init().
    // This lets the constructor stay synchronous.
    return new InMemoryStorageAdapter(); // replaced in init()
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Initialise the client and storage adapter.
   *
   * **Must be called** before creating queues when using Redis, PostgreSQL,
   * or MySQL.
   *
   * What each adapter does:
   *  - **memory**   — no-op (always safe to call)
   *  - **redis**    — connects, sends PING, verifies PONG
   *  - **postgres** — connects, runs `SELECT 1`, auto-creates `qjw_` tables
   *  - **mysql**    — connects, runs `SELECT 1`, auto-creates `qjw_` tables
   *
   * Idempotent — safe to call multiple times.
   */
  async init(): Promise<void> {
    if (this.initialised) return;

    // Build the real adapter (lazy import keeps optional peer deps optional).
    this._storage = await this.resolveAdapter();

    await this._storage.initialize();
    this.initialised = true;
  }

  /** @deprecated Use `init()`. */
  async initialize(): Promise<void> {
    return this.init();
  }

  private async resolveAdapter(): Promise<StorageAdapter> {
    const cs = this.connectionString;

    switch (this.dialect) {
      case "memory":
        return new InMemoryStorageAdapter();

      case "redis": {
        if (!cs) throw new Error('dialect "redis" requires a connectionString.');
        const { RedisStorageAdapter } = await import("../storage/redis.adapter.js");
        return new RedisStorageAdapter(cs);
      }

      case "postgres": {
        if (!cs) throw new Error('dialect "postgres" requires a connectionString.');
        const { PostgreSQLStorageAdapter } = await import("../storage/postgres.adapter.js");
        return new PostgreSQLStorageAdapter(cs);
      }

      case "mysql": {
        if (!cs) throw new Error('dialect "mysql" requires a connectionString.');
        const { MySQLStorageAdapter } = await import("../storage/mysql.adapter.js");
        return new MySQLStorageAdapter(cs);
      }

      default:
        throw new Error(`Unknown storage dialect: "${this.dialect}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Queue management
  // -------------------------------------------------------------------------

  /**
   * Create a named queue with optional per-queue configuration.
   *
   * For external dialects (redis/postgres/mysql), call `await client.init()`
   * first.
   */
  createQueue<TPayload = unknown>(name: string, options?: QueueOptions): Queue<TPayload> {
    if (this.closed) throw new Error("QueueClient has been closed.");
    if (this.queues.has(name)) {
      throw new Error(`A queue named "${name}" already exists on this client.`);
    }

    // Auto-init for memory (harmless no-op).
    if (!this.initialised && this.dialect === "memory") {
      void this.init();
    }

    const queue = new Queue<TPayload>(name, this._storage, this.emitter, options, this.defaults);
    this.queues.set(name, queue as Queue<unknown>);
    return queue;
  }

  /** Returns the queue with the given name, or `undefined`. */
  getQueue<TPayload = unknown>(name: string): Queue<TPayload> | undefined {
    return this.queues.get(name) as Queue<TPayload> | undefined;
  }

  /** Returns the queue with the given name, or throws. */
  requireQueue<TPayload = unknown>(name: string): Queue<TPayload> {
    const queue = this.getQueue<TPayload>(name);
    if (!queue) {
      throw new Error(`Queue "${name}" not found. Did you call createQueue("${name}")?`);
    }
    return queue;
  }

  /** Names of all queues registered on this client. */
  get queueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  /** `true` after `init()` has completed successfully. */
  get isInitialised(): boolean {
    return this.initialised;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  on<K extends keyof QueueEvents>(event: K, listener: (...args: QueueEvents[K]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  once<K extends keyof QueueEvents>(event: K, listener: (...args: QueueEvents[K]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }

  off<K extends keyof QueueEvents>(event: K, listener: (...args: QueueEvents[K]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  /**
   * Stop all workers, close all queues, and release the storage connection.
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await Promise.all(Array.from(this.queues.values()).map((q) => q.close()));
    await this._storage.close();
    this.emitter.removeAllListeners();
  }

  // -------------------------------------------------------------------------
  // Advanced: custom StorageAdapter
  // -------------------------------------------------------------------------

  /**
   * Create a QueueClient with a fully custom StorageAdapter.
   *
   * `init()` will call `adapter.initialize()`.
   *
   * @example
   * const client = QueueClient.withAdapter(myAdapter);
   * await client.init();
   */
  static withAdapter(
    adapter: StorageAdapter,
    options: Omit<QueueClientOptions, "dialect" | "connectionString"> = {},
  ): QueueClient {
    const client = new QueueClient(options);
    client._storage = adapter;
    return client;
  }
}
