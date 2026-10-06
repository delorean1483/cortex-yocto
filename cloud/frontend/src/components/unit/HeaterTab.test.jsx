import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('../../data/hooks.js', () => ({
  useCommand: () => ({ mutate, isPending: false }),
  useShadow: () => ({ data: { reported: { heater_desired_seq: 0 }, desired: {} } }),
}))
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

  it('keeps the legacy title when the unit has no coprocessor keys', () => {
    render(<HeaterTab tele={OFF} unit="APU-1" isDemo={false} />)
    expect(screen.getByText('VEVOR diesel heater — Off')).toBeTruthy()
  })

  it('AUTOTERM: shows type + phase and sends a setpoint', () => {
    mutate.mockClear()
    const T = { ...OFF, heater_comms_ok: true, heater_type: 'autoterm', heater_phase: 'running',
      heater_control: 'setpoint', heater_setpoint_f: 72, heater_fault: false }
    render(<HeaterTab tele={T} unit="APU-1" isDemo={false} />)
    expect(screen.getByText('AUTOTERM diesel heater — Running')).toBeTruthy()
    expect(screen.queryByText('Level')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '+' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { heater: { setpoint_f: 74 } } })
  })

  it('FAULT: Clear fault sends clear_fault and Turn on is disabled', () => {
    mutate.mockClear()
    const F = { ...OFF, heater_type: 'vevor', heater_phase: 'fault', heater_control: 'level',
      heater_fault: true, heater_error: 255 }
    render(<HeaterTab tele={F} unit="APU-1" isDemo={false} />)
    expect(screen.getByRole('button', { name: 'Turn on' }).disabled).toBe(true)
    expect(screen.queryByText(/Heater error code/)).toBeNull()       // 255 = no vendor code
    fireEvent.click(screen.getByRole('button', { name: 'Clear fault' }))
    expect(screen.getByText(/does not start the heater/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { heater: { clear_fault: true } } })
  })

  it('disables controls for demo units', () => {
    render(<HeaterTab tele={OFF} unit="APU-DEMO-01" isDemo={true} />)
    expect(screen.getByRole('button', { name: 'Turn on' }).disabled).toBe(true)
  })
})
