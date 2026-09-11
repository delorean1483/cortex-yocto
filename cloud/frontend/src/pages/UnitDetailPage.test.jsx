import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const SNAP = {
  ts: Date.now(), batt_v: 12.6, cabin_temp_f: 96, ext_temp_f: 71, rpm: 0,
  oil_ok: true, ignition: false, mode: 'battery', control_status: 'idle',
  engine_status: 'off', error: 'none', error_n: 0,
  engine_hrs: 4, oil_hrs: 4, machine_hrs: 128, apu_fw_version: 10240,
  fan_speed: 0, clmt_setpoint_f: 72,
  heater_present: true, heater_state: 'off', heater_comms_ok: false,
  heater_flags: 16, heater_target_level: 3, heater_active_level: 0,
  heater_error: 0, heater_exchanger: 0, heater_fan_rpm: 0, heater_pump_hz: 0,
  heater_supply_v: 0, heater_state_seconds: 0,
  heater_valid_frames: 0, heater_checksum_failures: 0, heater_transport_errors: 42,
  diag_active: false, diag_outputs: 0,
}

vi.mock('../data/hooks.js', () => ({
  useUnitLatest: () => ({ data: SNAP }),
  useTelemetrySeries: () => ({ data: [], isLoading: false }),
  useFaults: () => ({ data: [], isLoading: false }),
  useCommand: () => ({ mutate: vi.fn(), isPending: false }),
  useShadow: () => ({ data: null }),
}))
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: 'admin' }) }))

import UnitDetailPage from './UnitDetailPage.jsx'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/units/APU-1']}>
      <Routes><Route path="/units/:id" element={<UnitDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('UnitDetailPage', () => {
  it('renders unit id + connection pill', () => {
    renderPage()
    expect(screen.getByText('APU-1')).toBeTruthy()
    expect(screen.getByText('live')).toBeTruthy()
  })
  it('renders all tab buttons', () => {
    renderPage()
    for (const t of ['Overview', 'Telemetry', 'Heater', 'Component Test', 'History']) {
      expect(screen.getByRole('button', { name: t })).toBeTruthy()
    }
  })
  it('switches to the heater tab', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Heater' }))
    expect(screen.getByText(/VEVOR diesel heater/i)).toBeTruthy()
  })
})
