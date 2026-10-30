import { describe, it, expect, vi, beforeEach } from 'vitest'
import { realApi as api } from './client.js'

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }))
})

describe('api.getLatest', () => {
  it('GETs the latest path', async () => {
    await api.getLatest('APU-1')
    expect(global.fetch).toHaveBeenCalled()
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/fleet/units/APU-1/latest')
  })
})

describe('api.sendCommand', () => {
  it('POSTs the command with body', async () => {
    await api.sendCommand('APU-1', { heater: { on: 1 } })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toContain('/fleet/units/APU-1/command')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ heater: { on: 1 } })
  })
})

describe('password reset calls', () => {
  it('forgotPassword POSTs the email', async () => {
    await api.forgotPassword('a@b.co')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toMatch(/\/auth\/forgot-password$/)
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.co' })
  })

  it('resetPassword POSTs email, code and new password', async () => {
    await api.resetPassword({ email: 'a@b.co', code: '123456', password: 'Abcdefgh123!' })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toMatch(/\/auth\/reset-password$/)
    expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.co', code: '123456', password: 'Abcdefgh123!' })
  })

  it('setUserPassword POSTs to the user, email encoded in the path', async () => {
    await api.setUserPassword('a+x@b.co', 'Abcdefgh123!')
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toMatch(/\/fleet\/users\/a%2Bx%40b\.co\/password$/)
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ password: 'Abcdefgh123!' })
  })
})
