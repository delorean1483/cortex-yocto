import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ totals: null }))
vi.mock('../api/client.js', () => ({
  api: { getReports: () => Promise.resolve({ totals: state.totals, operators: [] }) },
}))

import ReportsPage from './ReportsPage.jsx'

describe('ReportsPage', () => {
  beforeEach(() => { state.totals = null })

  it('explains a period with no runtime instead of showing bare zeros', async () => {
    state.totals = { runtime_hrs: 0, fuel_saved_usd: 0, mtbf_hrs: 0, fault_events: 0 }
    render(<ReportsPage />)
    expect(await screen.findByText(/No APU runtime in the last 7 days/)).toBeTruthy()
    expect(screen.getByText('No faults')).toBeTruthy()
  })

  it('shows runtime, savings with its estimate caption, and MTBF', async () => {
    state.totals = { runtime_hrs: 1240, fuel_saved_usd: 2976, mtbf_hrs: 310, fault_events: 4 }
    render(<ReportsPage />)
    expect(await screen.findByText('1,240')).toBeTruthy()
    expect(screen.getByText('$2,976')).toBeTruthy()
    expect(screen.getByText(/\$2\.40 per APU runtime hour/)).toBeTruthy()
    expect(screen.getByText('310')).toBeTruthy()
    expect(screen.queryByText(/No APU runtime/)).toBeNull()
  })

  it('range picker marks the selected range', async () => {
    render(<ReportsPage />)
    expect((await screen.findByRole('radio', { name: '7 days' })).checked).toBe(true)
  })
})
