/**
 * Durable recording chunk queue helpers (Phase 2D-4).
 *
 * Chunks are shifted only after a successful persist. On failure the item is
 * put back at the front so Stop & Save can retry instead of silently dropping
 * the lecture tail.
 */

export type PersistQueueItem = { index: number; blob: Blob }

export type PersistQueueItemFn = (item: PersistQueueItem) => Promise<void>

export type FlushPersistQueueOptions = {
  maxAttempts?: number
  retryDelayMs?: number
}

/**
 * Drain `queue` in order. Mutates `queue` in place (same ref the recorder holds).
 * Failed items are re-queued at the front and the flush is retried up to
 * `maxAttempts` times before rejecting.
 */
export async function flushPersistQueue(
  queue: PersistQueueItem[],
  persist: PersistQueueItemFn,
  options: FlushPersistQueueOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 5
  const retryDelayMs = options.retryDelayMs ?? 50
  let attempts = 0

  while (queue.length > 0) {
    try {
      while (queue.length > 0) {
        const item = queue.shift()!
        try {
          await persist(item)
        } catch (err) {
          queue.unshift(item)
          throw err
        }
      }
    } catch (err) {
      attempts += 1
      if (attempts >= maxAttempts) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new Error(
          `Could not persist recording audio to local storage after ${maxAttempts} attempts: ${detail}`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempts))
    }
  }
}
