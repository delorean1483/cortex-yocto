import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('../../data/hooks.js', () => ({
  useCommand: () => ({ mutate, isPending: false }),
}))
let role = 'admin'
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role }) }))

import RemoteControlTab from './RemoteControlTab.jsx'

const OFF     = { ts: Date.now(), mode: 'off',     engine_status: 'stopped', control_status: 'off',     rpm: 0,    ignition: false }
const CLIMATE = { ts: Date.now(), mode: 'climate', engine_status: 'running', control_status: 'climate', rpm: 1800, ignition: true }

describe('RemoteControlTab', () => {
  beforeEach(() => { mutate.mockClear(); role = 'admin' })

  it('starts the APU in Climate mode with a crank confirmation', () => {
    render(<RemoteControlTab tele={OFF} unit="APU-1" isDemo={false} />)
    fireEvent.click(screen.getByRole('button', { name: /climate/i }))
    expect(screen.getByText(/Climate mode/i)).toBeTruthy()
    expect(screen.getByText(/crank/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { apu_command: 'climate' } })
  })

  it('starts the APU in Battery mode', () => {
    render(<RemoteControlTab tele={OFF} unit="APU-1" isDemo={false} />)
    fireEvent.click(screen.getByRole('button', { name: /battery/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { apu_command: 'battery' } })
  })

  it('stops the APU', () => {
    render(<RemoteControlTab tele={CLIMATE} unit="APU-1" isDemo={false} />)
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(mutate.mock.calls[0][0]).toEqual({ unit: 'APU-1', body: { apu_command: 'stop' } })
  })

  it('disables the mode already active (no-op guard)', () => {
    render(<RemoteControlTab tele={CLIMATE} unit="APU-1" isDemo={false} />)
    expect(screen.getByRole('button', { name: /climate/i }).disabled).toBe(true)   // already in climate
    expect(screen.getByRole('button', { name: /battery/i }).disabled).toBe(false)  // switch is allowed
    expect(screen.getByRole('button', { name: /stop/i }).disabled).toBe(false)
  })

  it('keeps Stop available even when reported mode is off (a running APU may report mode 0)', () => {
    render(<RemoteControlTab tele={OFF} unit="APU-1" isDemo={false} />)
    expect(screen.getByRole('button', { name: /stop/i }).disabled).toBe(false)
  })

  it('disables all controls for demo units', () => {
    render(<RemoteControlTab tele={OFF} unit="APU-DEMO-01" isDemo={true} />)
    expect(screen.getByRole('button', { name: /climate/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /battery/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /stop/i }).disabled).toBe(true)
  })

  it('disables controls for read-only (eu) role', () => {
    role = 'eu'
    render(<RemoteControlTab tele={OFF} unit="APU-1" isDemo={false} />)
    expect(screen.getByRole('button', { name: /climate/i }).disabled).toBe(true)
  })
})
