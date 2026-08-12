/**
 * progress.mjs — pure progress-report helpers for the plugin run loop.
 */

export const DEFAULT_REPORT_EVERY = 200;

/**
 * Decide whether a progress report is due.
 *
 * First report (processed 0), every interval boundary, and the final report
 * are always emitted. This is deliberately a pure function so the traversal
 * loop stays testable without a UI or timers.
 */
export function shouldReport(processed, total, lastReported, every = DEFAULT_REPORT_EVERY) {
  const step = Number.isFinite(every) && every > 0 ? every : DEFAULT_REPORT_EVERY;
  if (processed <= 0 || processed >= total) return true;
  return processed - lastReported >= step;
}

/** Small wall-clock timer used to report per-stage elapsed time. */
export function createStageTimer() {
  const startedAt = Date.now();
  return {
    elapsedMs() {
      return Date.now() - startedAt;
    },
  };
}
