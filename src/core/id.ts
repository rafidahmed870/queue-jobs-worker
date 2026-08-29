/**
 * Job ID generation
 *
 * Uses the built-in `crypto.randomUUID()` available in Node.js >= 14.17.
 * No external dependency needed.
 */

import { randomUUID } from "node:crypto";

/** Generate a new unique job ID. */
export function generateJobId(): string {
  return randomUUID();
}
