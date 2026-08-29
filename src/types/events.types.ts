/**
 * All event names and their payload types for QueueEventEmitter.
 */

import type { JobData } from "./job.types.js";
import type { WorkerStatus } from "./worker.types.js";

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

export interface QueueEvents<TPayload = unknown> {
  // Job events
  "job:enqueued": [job: JobData<TPayload>];
  "job:started": [job: JobData<TPayload>];
  "job:completed": [job: JobData<TPayload>];
  "job:failed": [job: JobData<TPayload>, error: Error];
  "job:retrying": [job: JobData<TPayload>, error: Error, nextRunAt: string];
  "job:dead": [job: JobData<TPayload>, error: Error];
  "job:stalled": [jobId: string];
  "job:recovered": [jobId: string];

  // Worker events
  "worker:started": [workerId: string];
  "worker:stopped": [workerId: string];
  "worker:status": [workerId: string, status: WorkerStatus];
  "worker:error": [workerId: string, error: Error];

  // Queue events
  "queue:error": [queueName: string, error: Error];

  // Generic catch-all
  error: [error: Error];
}
