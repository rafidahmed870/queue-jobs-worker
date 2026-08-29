/**
 * Backoff strategies
 *
 * Calculates the delay (in ms) before a failed job is re-queued.
 *
 * - fixed       — always uses `baseDelay`
 * - linear      — baseDelay × attemptNumber
 * - exponential — baseDelay × 2^(attemptNumber - 1), capped at MAX_DELAY
 */

import type { BackoffStrategy } from "../types/job.types.js";

/** Maximum delay cap for exponential backoff (10 minutes). */
const MAX_DELAY_MS = 10 * 60 * 1_000;

/**
 * Returns the retry delay in milliseconds for the given attempt.
 *
 * @param strategy    - Backoff strategy name.
 * @param baseDelay   - Base delay in ms (from job / queue / client config).
 * @param attemptNumber - The 1-based attempt number that just failed.
 */
export function calculateBackoff(
  strategy: BackoffStrategy,
  baseDelay: number,
  attemptNumber: number,
): number {
  const attempt = Math.max(1, attemptNumber);

  switch (strategy) {
    case "fixed":
      return baseDelay;

    case "linear":
      return baseDelay * attempt;

    case "exponential": {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      return Math.min(delay, MAX_DELAY_MS);
    }

    default: {
      // Exhaustive guard — TypeScript will catch unhandled variants at
      // compile time; this is a runtime safety net.
      const _exhaustive: never = strategy;
      void _exhaustive;
      return baseDelay;
    }
  }
}

/**
 * Returns the ISO timestamp at which a job should next become eligible,
 * given the current time and the calculated delay.
 */
export function nextRunAt(delayMs: number, fromDate: Date = new Date()): string {
  return new Date(fromDate.getTime() + delayMs).toISOString();
}
