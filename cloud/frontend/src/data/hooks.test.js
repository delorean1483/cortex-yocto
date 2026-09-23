import { describe, it, expect, vi } from 'vitest'

const seen = vi.hoisted(() => [])
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts) => { seen.push(opts); return {} },
  useMutation: () => ({}),
  useQueryClient: () => ({}),
}))
vi.mock('../api/client.js', () => ({ api: {} }))

import { useUnitLatest, LATEST_POLL_MS } from './hooks.js'

describe('useUnitLatest', () => {
  it('polls every 15s — each poll is an InfluxDB query per unit per open tab', () => {
    useUnitLatest('TRUCK-001')
    expect(LATEST_POLL_MS).toBe(15000)
    expect(seen.at(-1).refetchInterval).toBe(15000)
  })
})
