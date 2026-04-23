/**
 * Bounded-concurrency worker pool. Each spawned worker pulls the next item off a shared
 * queue and runs `runOne(item)` on it; when the queue drains the worker exits, and the
 * outer promise resolves once every worker has exited.
 *
 * Mirrors the inline pattern used by the upload audit preview
 * ({@link useListWorkspaceNegotiation} → `runAuditWebeposPreview`) so any page that needs
 * the same "open N tabs, do work, close them" rhythm can share a single implementation.
 *
 * @template T
 * @param {T[]} items                  Items to process. A shallow copy is taken — caller's array is not mutated.
 * @param {(item: T) => Promise<unknown>} runOne   Per-item async worker. Errors are swallowed and logged so one
 *                                                 bad item doesn't stop the whole queue; capture per-item failures
 *                                                 inside `runOne` itself if you need them surfaced.
 * @param {number} [concurrency=4]     Max workers to run in parallel. Clamped to `items.length` so we never spin
 *                                     up empty workers.
 * @returns {Promise<void>}
 */
export async function runWithConcurrency(items, runOne, concurrency = 4) {
  if (!Array.isArray(items) || items.length === 0) return;
  const cap = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const queue = [...items];
  const worker = async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      try {
        await runOne(next);
      } catch (err) {
        console.warn('[runWithConcurrency] worker threw — continuing with next item', err);
      }
    }
  };
  await Promise.all(Array.from({ length: cap }, () => worker()));
}
