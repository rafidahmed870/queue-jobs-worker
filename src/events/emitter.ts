/**
 * QueueEventEmitter
 *
 * A strongly-typed, lightweight event emitter built on top of Node.js
 * EventEmitter.  All queue/worker/job lifecycle events flow through here.
 *
 * Using typed generics ensures that each event name maps to its exact
 * argument tuple — no runtime guessing.
 */

import { EventEmitter } from "node:events";
import type { QueueEvents } from "../types/events.types.js";

// ---------------------------------------------------------------------------
// Typed emitter
// ---------------------------------------------------------------------------

type EventKey = keyof QueueEvents;
type EventArgs<K extends EventKey> = QueueEvents[K];

export class QueueEventEmitter {
  private readonly emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Prevent Node.js from printing "MaxListenersExceededWarning" in tests
    // where many listeners are registered.
    this.emitter.setMaxListeners(100);
  }

  // -------------------------------------------------------------------------
  // Subscribe
  // -------------------------------------------------------------------------

  on<K extends EventKey>(event: K, listener: (...args: EventArgs<K>) => void): this {
    this.emitter.on(event as string, listener as (...a: unknown[]) => void);
    return this;
  }

  once<K extends EventKey>(event: K, listener: (...args: EventArgs<K>) => void): this {
    this.emitter.once(event as string, listener as (...a: unknown[]) => void);
    return this;
  }

  off<K extends EventKey>(event: K, listener: (...args: EventArgs<K>) => void): this {
    this.emitter.off(event as string, listener as (...a: unknown[]) => void);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  emit<K extends EventKey>(event: K, ...args: EventArgs<K>): boolean {
    return this.emitter.emit(event as string, ...args);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  removeAllListeners(event?: EventKey): this {
    if (event) {
      this.emitter.removeAllListeners(event as string);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  listenerCount(event: EventKey): number {
    return this.emitter.listenerCount(event as string);
  }
}
