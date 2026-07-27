import { describe, expect, it, vi } from 'vitest'
import { flushPersistQueue, type PersistQueueItem } from './recordingPersistQueue'

function item(index: number, size = 10): PersistQueueItem {
  return { index, blob: new Blob([new Uint8Array(size)]) }
}

describe('flushPersistQueue', () => {
  it('persists every queued chunk in order', async () => {
    const queue = [item(0), item(1), item(2)]
    const seen: number[] = []
    await flushPersistQueue(queue, async (q) => {
      seen.push(q.index)
    })
    expect(seen).toEqual([0, 1, 2])
    expect(queue).toEqual([])
  })

  it('re-queues a failed item and retries until success (no silent drop)', async () => {
    const queue = [item(5), item(6)]
    const seen: number[] = []
    let failOnce = true
    await flushPersistQueue(
      queue,
      async (q) => {
        if (q.index === 5 && failOnce) {
          failOnce = false
          throw new Error('QuotaExceededError')
        }
        seen.push(q.index)
      },
      { maxAttempts: 5, retryDelayMs: 1 },
    )
    expect(seen).toEqual([5, 6])
    expect(queue).toEqual([])
  })

  it('leaves the failed item at the front when retries are exhausted', async () => {
    const queue = [item(3), item(4)]
    await expect(
      flushPersistQueue(
        queue,
        async () => {
          throw new Error('IndexedDB abort')
        },
        { maxAttempts: 3, retryDelayMs: 1 },
      ),
    ).rejects.toThrow(/Could not persist recording audio/)
    expect(queue.map((q) => q.index)).toEqual([3, 4])
  })

  it('does not drop later chunks when an earlier persist fails mid-drain', async () => {
    const queue = [item(0), item(1), item(2)]
    const persist = vi.fn(async (q: PersistQueueItem) => {
      if (q.index === 1) throw new Error('transient')
    })
    await expect(
      flushPersistQueue(queue, persist, { maxAttempts: 1, retryDelayMs: 1 }),
    ).rejects.toThrow(/Could not persist/)
    // Index 0 succeeded (shifted away). Index 1 failed and was unshifted.
    // Index 2 must still be present — never shifted while 1 was failing.
    expect(queue.map((q) => q.index)).toEqual([1, 2])
  })
})
