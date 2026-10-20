import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ totals: null, operators: [] }))
vi.mock('../api/client.js', () => ({
  api: { getReports: () => Promise.resolve({ totals: state.totals, operators: state.operators }) },
}))

import ReportsPage from './ReportsPage.jsx'

describe('ReportsPage', () => {
  beforeEach(() => { state.totals = null; state.operators = [] })

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

  it('shows the explicit date range next to the period picker', async () => {
    state.totals = { runtime_hrs: 10, fuel_saved_usd: 24, mtbf_hrs: 10, fault_events: 1 }
    render(<ReportsPage />)
    expect(await screen.findByText(/ – .*, \d{4} · real units only/)).toBeTruthy()
  })

  it('lists operators with numeric columns and a Total row', async () => {
    state.totals = { runtime_hrs: 10, fuel_saved_usd: 24, mtbf_hrs: 10, fault_events: 1 }
    state.operators = [
      { operator: 'a@x.com', fleet: 'F1', starts: 142, stops: 138, fw_updates: 3 },
      { operator: 'b@x.com', fleet: 'F2', starts: 89, stops: 91, fw_updates: 1 },
    ]
    render(<ReportsPage />)
    expect(await screen.findByRole('heading', { name: /Operator activity/ })).toBeTruthy()
    expect(screen.getByText('2 operators')).toBeTruthy()
    const total = screen.getByText('Total').closest('tr')
    expect(total.textContent).toContain('231')
    expect(total.textContent).toContain('229')
    expect(screen.getByText('142').className).toContain('num')
  })

  it('does not colour the savings figure green', async () => {
    state.totals = { runtime_hrs: 1240, fuel_saved_usd: 2976, mtbf_hrs: 310, fault_events: 4 }
    render(<ReportsPage />)
    expect((await screen.findByText('$2,976')).getAttribute('style') || '').not.toContain('--ok')
  })
})
