import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ calls: [], series: [] }))
vi.mock('../../data/hooks.js', () => ({
  useTelemetrySeries: (unit, params) => {
    mocks.calls.push({ unit, params })
    return { data: mocks.series, isLoading: false }
  },
}))

// jsdom has no layout (or ResizeObserver), so ResponsiveContainer can't size the
// chart; hand the chart a fixed size instead.
vi.mock('recharts', async (importOriginal) => {
  const { cloneElement } = await import('react')
  const rc = await importOriginal()
  return { ...rc, ResponsiveContainer: ({ children }) => cloneElement(children, { width: 600, height: 180 }) }
})

import TelemetryTab, { tickLabel } from './TelemetryTab.jsx'

const lastParams = () => mocks.calls[mocks.calls.length - 1].params

describe('TelemetryTab', () => {
  beforeEach(() => {
    mocks.calls = []
    mocks.series = [
      { ts: Date.now() - 3600e3, batt_v: 12.4, cabin_temp_f: 70, rpm: 0 },
      { ts: Date.now(), batt_v: 12.3, cabin_temp_f: 71, rpm: 0 },
    ]
  })

  it('opens on the last 24 hours in 15-minute averages', () => {
    render(<TelemetryTab unit="TRUCK-001" />)
    expect(mocks.calls[0].unit).toBe('TRUCK-001')
    expect(lastParams()).toEqual({ start: '-24h', every: '15m' })
  })

  it('asks for hourly averages over a week when 7 days is picked', () => {
    render(<TelemetryTab unit="TRUCK-001" />)
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(lastParams()).toEqual({ start: '-7d', every: '1h' })
  })

  it('offers 1 hour, 24 hours, 7 days and 30 days', () => {
    render(<TelemetryTab unit="TRUCK-001" />)
    for (const name of ['1 hour', '24 hours', '7 days', '30 days']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    expect(lastParams()).toEqual({ start: '-30d', every: '6h' })
  })

  it('says each point is an average and what a gap means', () => {
    render(<TelemetryTab unit="TRUCK-001" />)
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(screen.getByText(/average over 1 hour/i)).toBeTruthy()
    expect(screen.getByText(/gaps? .*sent nothing/i)).toBeTruthy()
  })

  it('draws the battery, cabin and RPM charts when there are readings', () => {
    render(<TelemetryTab unit="TRUCK-001" />)
    expect(screen.getByText('Battery voltage')).toBeTruthy()
    expect(screen.getByText('Cabin temperature')).toBeTruthy()
    expect(screen.getByText('Engine RPM')).toBeTruthy()
  })

  it('says the unit sent nothing in the range when every bucket is empty', () => {
    mocks.series = [
      { ts: Date.now() - 3600e3, batt_v: null, cabin_temp_f: null, rpm: null },
      { ts: Date.now(), batt_v: null, cabin_temp_f: null, rpm: null },
    ]
    render(<TelemetryTab unit="TRUCK-001" />)
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(screen.getByText('No readings from this unit in the last 7 days.')).toBeTruthy()
    expect(screen.queryByText('Battery voltage')).toBeNull()
  })
})

describe('tickLabel', () => {
  const ts = new Date(2026, 9, 24, 14, 5).getTime()
  it('shows the time of day for ranges within a day', () => {
    expect(tickLabel(ts, '1h')).toBe('14:05')
    expect(tickLabel(ts, '24h')).toBe('14:05')
  })
  it('shows the date for multi-day ranges', () => {
    expect(tickLabel(ts, '7d')).toBe('Oct 24')
    expect(tickLabel(ts, '30d')).toBe('Oct 24')
  })
})
