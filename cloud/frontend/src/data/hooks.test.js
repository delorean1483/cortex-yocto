import { describe, it, expect, vi } from 'vitest'

const seen = vi.hoisted(() => [])
const qc = vi.hoisted(() => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts) => { seen.push(opts); return {} },
  useQueries: ({ queries }) => { seen.push(...queries); return queries.map(() => ({})) },
  useMutation: (opts) => { seen.push(opts); return {} },
  useQueryClient: () => qc,
}))
vi.mock('../api/client.js', () => ({ api: {} }))

import { useUnitLatest, useFleetLatest, useSetMyAlerts, LATEST_POLL_MS } from './hooks.js'

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

// The shadow's APU-link report rides along on the telemetry for every caller,
// so a unit with a silent APU reads "No APU data" fleet-wide, not "Offline".
describe('latest telemetry carries the APU link', () => {
  const link = { apu: 'down', since: 1, heartbeat_ts: 2 }
  it('useUnitLatest', () => {
    useUnitLatest('TRUCK-001')
    expect(seen.at(-1).select({ unit: 'TRUCK-001', latest: { ts: 5 }, link })).toEqual({ ts: 5, link })
  })
  it('useFleetLatest', () => {
    useFleetLatest(['TRUCK-001'])
    expect(seen.at(-1).select({ unit: 'TRUCK-001', latest: null, link })).toEqual({ link })
  })
})
