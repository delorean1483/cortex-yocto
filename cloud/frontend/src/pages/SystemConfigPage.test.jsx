import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const state = vi.hoisted(() => ({ role: 'admin', unit: 'TRUCK-001', shadow: null, mutate: null }))

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: state.role, selectedUnit: state.unit, setSelectedUnit: vi.fn() }),
}))
vi.mock('../data/hooks.js', () => ({
  useUnits: () => ({ data: [{ unit: 'TRUCK-001', demo: false }, { unit: 'APU-DEMO-01', demo: true }] }),
  useShadow: () => ({ data: state.shadow }),
  useUnitLatest: () => ({ data: { ts: Date.now(), apu_fw_version: 10104, error_n: 0, error: 'none', batt_v: 12.5, oil_ok: true, mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 } }),
  useSetConfig: () => ({ mutate: state.mutate, isPending: false }),
}))

import SystemConfigPage from './SystemConfigPage.jsx'

describe('SystemConfigPage', () => {
  beforeEach(() => {
    state.role = 'admin'
    state.unit = 'TRUCK-001'
    state.shadow = { reported: { poll_interval_s: 10, firmware_version: '1.2.57', ota_status: 'idle' } }
    state.mutate = vi.fn((vars, opts) => opts?.onSuccess?.())
  })

  it('shows the interval the unit reports and unit info', () => {
    render(<SystemConfigPage />)
    expect(screen.getByText('Every 10 seconds')).toBeTruthy()
    expect(screen.getByText('1.2.57')).toBeTruthy()
    expect(screen.getByText('1.1.4')).toBeTruthy()
    expect(screen.queryByText(/report mode/i)).toBeNull()
  })

  it('changes the interval through a confirmation and shows Pending', () => {
    render(<SystemConfigPage />)
    fireEvent.click(screen.getByRole('radio', { name: '15 s' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change interval' }))            // opens the dialog
    expect(state.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Change interval' }).at(-1)) // dialog's confirm
    expect(state.mutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', config: { poll_interval_s: 15 } })
    expect(screen.getByText(/Pending — waiting for the unit to confirm/)).toBeTruthy()
  })

  it('shows an out-of-range reported interval as-is', () => {
    state.shadow = { reported: { poll_interval_s: 30, firmware_version: '1.2.57' } }
    render(<SystemConfigPage />)
    expect(screen.getByText('Every 30 seconds')).toBeTruthy()
    expect(screen.getByText(/set outside this page/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: '5 s' })).toBeTruthy()
  })

  it('no shadow yet: dashes, no crash', () => {
    state.shadow = undefined
    render(<SystemConfigPage />)
    expect(screen.getByText('Not reported yet')).toBeTruthy()
  })

  it('reboot asks first, then sends reboot', () => {
    render(<SystemConfigPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Reboot unit' }))
    expect(screen.getByText(/cold power cycle and will be offline for about 1–2 minutes/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }))
    expect(state.mutate.mock.calls[0][0]).toEqual({ unit: 'TRUCK-001', config: { reboot: true } })
  })

  it('maint can change the interval but not reboot; eu can do neither', () => {
    state.role = 'maint'
    const { unmount } = render(<SystemConfigPage />)
    expect(screen.getByRole('radio', { name: '15 s' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reboot unit' })).toBeNull()
    unmount()
    state.role = 'eu'
    render(<SystemConfigPage />)
    expect(screen.queryByRole('radio', { name: '15 s' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reboot unit' })).toBeNull()
  })

  it('demo units are read-only', () => {
    state.unit = 'APU-DEMO-01'
    render(<SystemConfigPage />)
    expect(screen.getByText("Demo units can't be configured.")).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '15 s' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reboot unit' })).toBeNull()
  })
})
