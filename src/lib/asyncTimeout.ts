/** Rejects if `promise` does not settle within `ms` milliseconds. */
export class AsyncTimeoutError extends Error {
  readonly label: string
  readonly timeoutMs: number

  constructor(label: string, timeoutMs: number) {
    super(
      `${label} timed out after ${Math.round(timeoutMs / 1000)}s. Check your network and try again.`,
    )
    this.name = 'AsyncTimeoutError'
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => {
      reject(new AsyncTimeoutError(label, ms))
    }, ms)
    promise.then(
      (v) => {
        window.clearTimeout(id)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(id)
        reject(e)
      },
    )
  })
}
