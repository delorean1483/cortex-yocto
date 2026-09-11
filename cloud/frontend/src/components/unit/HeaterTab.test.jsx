import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('../../data/hooks.js', () => ({ useCommand: () => ({ mutate, isPending: false }) }))
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: 'admin' }) }))

import HeaterTab from './HeaterTab.jsx'

const OFF = {
  ts: Date.now(), heater_present: true, heater_state: 'off', heater_comms_ok: false,
  heater_flags: 16, heater_target_level: 3, heater_active_level: 0, heater_error: 0,
  heater_exchanger: 0, heater_fan_rpm: 0, heater_pump_hz: 0, heater_supply_v: 0,
  heater_state_seconds: 0, heater_valid_frames: 0, heater_checksum_failures: 0, heater_transport_errors: 0,
}

describe('HeaterTab control', () => {
  it('turns the heater on with confirm', () => {
    mutate.mockClear()
    render(<HeaterTab tele={OFF} unit="APU-1" isDemo={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(screen.getByText(/Turn heater ON/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { heater: { on: 1 } } })
  })

  it('disables controls for demo units', () => {
    render(<HeaterTab tele={OFF} unit="APU-DEMO-01" isDemo={true} />)
    expect(screen.getByRole('button', { name: 'Turn on' }).disabled).toBe(true)
  })
})
