import { describe, expect, it } from 'vitest'
import {
  clearPasswordRecoveryPending,
  hasPasswordRecoveryPending,
  markPasswordRecoveryPending,
  type PasswordRecoveryStorage,
} from './passwordRecoverySession'

class MemoryStorage implements PasswordRecoveryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('password recovery pending marker', () => {
  it('survives process state loss until explicitly cleared', () => {
    const storage = new MemoryStorage()

    expect(hasPasswordRecoveryPending(storage)).toBe(false)
    markPasswordRecoveryPending(storage)
    expect(hasPasswordRecoveryPending(storage)).toBe(true)

    clearPasswordRecoveryPending(storage)
    expect(hasPasswordRecoveryPending(storage)).toBe(false)
  })

  it('fails closed when storage is unavailable', () => {
    const brokenStorage: PasswordRecoveryStorage = {
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {
        throw new Error('storage unavailable')
      },
      removeItem: () => {
        throw new Error('storage unavailable')
      },
    }

    expect(() => markPasswordRecoveryPending(brokenStorage)).not.toThrow()
    expect(hasPasswordRecoveryPending(brokenStorage)).toBe(false)
    expect(() => clearPasswordRecoveryPending(brokenStorage)).not.toThrow()
  })
})
