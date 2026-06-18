const PASSWORD_RECOVERY_PENDING_KEY = 'youmi.auth.passwordRecoveryPending'

export type PasswordRecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function resolveStorage(storage?: PasswordRecoveryStorage): PasswordRecoveryStorage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function markPasswordRecoveryPending(storage?: PasswordRecoveryStorage): void {
  try {
    resolveStorage(storage)?.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1')
  } catch {
    /* ignore storage failures; React state still protects the current process */
  }
}

export function clearPasswordRecoveryPending(storage?: PasswordRecoveryStorage): void {
  try {
    resolveStorage(storage)?.removeItem(PASSWORD_RECOVERY_PENDING_KEY)
  } catch {
    /* ignore */
  }
}

export function hasPasswordRecoveryPending(storage?: PasswordRecoveryStorage): boolean {
  try {
    return resolveStorage(storage)?.getItem(PASSWORD_RECOVERY_PENDING_KEY) === '1'
  } catch {
    return false
  }
}
