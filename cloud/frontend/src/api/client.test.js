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
