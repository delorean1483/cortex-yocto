import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('../../data/hooks.js', () => ({
  useCommand: () => ({ mutate, isPending: false }),
  useShadow: () => ({ data: { reported: { firmware_version: '1.2.57' } } }),
}))
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: 'admin' }) }))

import OverviewTab from './OverviewTab.jsx'

const BASE = {
  ts: Date.now(), batt_v: 12.3, cabin_temp_f: 74, ext_temp_f: 78, rpm: 0,
  oil_ok: true, ignition: false, mode: 'off', control_status: 'off', engine_status: 'off',
  error: 'none', error_n: 0, engine_hrs: 4, oil_hrs: 0, machine_hrs: 84, apu_fw_version: 10104,
  fan_speed: 0, clmt_setpoint_f: 67,
  heater_present: true, heater_state: 'off', heater_comms_ok: false, heater_target_level: 1,
}

function renderTab(tele, props = {}) {
  return render(<OverviewTab tele={tele} unit="TRUCK-001" isDemo={false} onOpenTab={() => {}} {...props} />)
}

describe('OverviewTab', () => {
  beforeEach(() => mutate.mockClear())

  it('leads with a fault banner naming the fault', () => {
    renderTab({ ...BASE, error: 'Low oil pressure', error_n: 1, oil_ok: false })
    expect(screen.getByRole('heading', { name: /Fault: Low oil pressure/ })).toBeTruthy()
  })

  it('groups readings by system', () => {
    renderTab(BASE)
    for (const g of ['Power', 'Climate', 'Engine', 'Diesel heater', 'Quick actions', 'Unit info']) {
      expect(screen.getByRole('heading', { name: g })).toBeTruthy()
    }
    expect(screen.getByText('1.1.4')).toBeTruthy()
    expect(screen.getByText('1.2.57')).toBeTruthy()
    expect(screen.getByText('1 of 10')).toBeTruthy()
  })

  it('starts climate from Quick actions through the crank confirmation', () => {
    renderTab(BASE)
    fireEvent.click(screen.getByRole('button', { name: /start climate/i }))
    expect(screen.getByText(/crank/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', body: { apu_command: 'climate' } })
  })

  it('turns the heater on through a confirmation', () => {
    renderTab(BASE)
    fireEvent.click(screen.getByRole('button', { name: /turn heater on/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', body: { heater: { on: 1 } } })
  })

  it('offline: blocks anything that would start, keeps Stop available', () => {
    renderTab({ ...BASE, ts: Date.now() - 2 * 3600000 })
    expect(screen.getByRole('heading', { name: /Offline/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /start climate/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /start battery/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /turn heater on/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /stop apu/i }).disabled).toBe(false)
    expect(screen.getByText(/offline/i, { selector: '.actions-note' })).toBeTruthy()
  })

  it('demo units cannot be controlled', () => {
    renderTab(BASE, { unit: 'APU-DEMO-01', isDemo: true })
    expect(screen.getByRole('button', { name: /stop apu/i }).disabled).toBe(true)
  })
})
