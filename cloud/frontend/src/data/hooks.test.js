import { describe, it, expect, vi } from 'vitest'

const seen = vi.hoisted(() => [])
const qc = vi.hoisted(() => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts) => { seen.push(opts); return {} },
  useMutation: (opts) => { seen.push(opts); return {} },
  useQueryClient: () => qc,
}))
vi.mock('../api/client.js', () => ({ api: {} }))

import { useUnitLatest, useSetMyAlerts, LATEST_POLL_MS } from './hooks.js'

describe('useUnitLatest', () => {
  it('polls every 15s — each poll is an InfluxDB query per unit per open tab', () => {
    useUnitLatest('TRUCK-001')
    expect(LATEST_POLL_MS).toBe(15000)
    expect(seen.at(-1).refetchInterval).toBe(15000)
  })
})

describe('useSetMyAlerts', () => {
  // A save that errored may still have landed (lost response): re-read the
  // stored value instead of trusting what the switch showed before.
  it('re-reads the stored preference after a failed save', () => {
    useSetMyAlerts()
    seen.at(-1).onError(new Error('HTTP 502'))
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['me', 'alerts'] })
  })
})
