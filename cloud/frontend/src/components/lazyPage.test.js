import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadWithReload } from './lazyPage.js'

describe('loadWithReload', () => {
  let reload
  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn()
  })

  it('returns the module and clears the reload guard on success', async () => {
    sessionStorage.setItem('ef-chunk-reload', '1')
    const mod = { default: () => null }
    await expect(loadWithReload(() => Promise.resolve(mod), reload)).resolves.toBe(mod)
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('ef-chunk-reload')).toBeNull()
  })

  it('reloads once when a chunk from an older deploy is gone', async () => {
    const p = loadWithReload(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')), reload)
    await Promise.resolve(); await Promise.resolve()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('ef-chunk-reload')).toBe('1')
    // the pending promise never settles, so React keeps showing the fallback until the reload
    const settled = await Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(settled).toBe('pending')
  })

  it('surfaces the error instead of looping if the reload did not help', async () => {
    sessionStorage.setItem('ef-chunk-reload', '1')
    const err = new TypeError('Failed to fetch dynamically imported module')
    await expect(loadWithReload(() => Promise.reject(err), reload)).rejects.toBe(err)
    expect(reload).not.toHaveBeenCalled()
  })
})
