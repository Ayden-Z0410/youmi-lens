import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternalContact, openExternalUrl } from './openExternalContact'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('openExternalUrl', () => {
  it('accepts https and http', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', {
      open,
      location: { protocol: 'http:', hostname: 'localhost' },
    })
    await openExternalUrl('https://checkout.stripe.com/c/test')
    await openExternalUrl('http://localhost:3000/return')
    expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/c/test', '_blank', 'noopener,noreferrer')
    expect(open).toHaveBeenCalledWith('http://localhost:3000/return', '_blank', 'noopener,noreferrer')
  })

  it('rejects javascript, data, file, malformed, and empty', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', {
      open,
      location: { protocol: 'http:', hostname: 'localhost' },
    })
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow(/external_url/)
    await expect(openExternalUrl('data:text/html,hi')).rejects.toThrow(/external_url/)
    await expect(openExternalUrl('file:///etc/passwd')).rejects.toThrow(/external_url/)
    await expect(openExternalUrl('not a url')).rejects.toThrow(/external_url/)
    await expect(openExternalUrl('')).rejects.toThrow(/external_url/)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('openExternalContact', () => {
  it('preserves prior behavior (opens without http(s)-only restriction)', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', {
      open,
      location: { protocol: 'http:', hostname: 'localhost' },
    })
    const gmail =
      'https://mail.google.com/mail/?view=cm&fs=1&to=youmilens@gmail.com&su=Youmi%20Lens%20Access%20Request'
    await openExternalContact(gmail)
    expect(open).toHaveBeenCalledWith(gmail, '_blank', 'noopener,noreferrer')
  })
})
