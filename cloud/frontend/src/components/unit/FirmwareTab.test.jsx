import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('../../data/hooks.js', () => ({
  useCommand: () => ({ mutate, isPending: false }),
  useReleases: () => ({ data: { releases: [], latest: null }, isLoading: false, error: null }),
}))
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ role: 'admin' }) }))

// Flip APU_OTA_ENABLED per-test via a getter-backed mock so both the shipped
// (flag off) and future (flag on) paths are covered in one file.
let apuOtaEnabled = false
vi.mock('../../config/flags.js', () => ({
  get APU_OTA_ENABLED() { return apuOtaEnabled },
}))

import FirmwareTab from './FirmwareTab.jsx'

// apu_fw_version is the encoded STM32 reg 2 (1.1.1); bundled arrives as a semver
// string from the image manifest once the agent publishes it.
const TELE = {
  ts: Date.now(),
  apu_fw_version: 10101,
  apu_bundled_fw_version: '1.1.1',
  apu_flash_state: 'idle',
}

beforeEach(() => { mutate.mockClear(); apuOtaEnabled = false })

describe('FirmwareTab — APU controller firmware section', () => {
  it('always renders the read-only APU status (decoded versions)', () => {
    render(<FirmwareTab tele={TELE} unit="APU-1" isDemo={false} />)
    expect(screen.getByText('APU controller firmware')).toBeTruthy()
    // decoded, not the raw encoded 10101
    expect(screen.getAllByText('1.1.1').length).toBeGreaterThan(0)
    expect(screen.queryByText('10101')).toBeNull()
  })

  it('with the flag OFF, shows no live Flash button (pending bench)', () => {
    render(<FirmwareTab tele={TELE} unit="APU-1" isDemo={false} />)
    expect(screen.queryByRole('button', { name: /flash apu firmware/i })).toBeNull()
    expect(screen.getByText(/after bench validation/i)).toBeTruthy()
  })

  it('with the flag ON, shows an enabled Flash button for an admin on a live unit', () => {
    apuOtaEnabled = true
    render(<FirmwareTab tele={TELE} unit="APU-1" isDemo={false} />)
    const btn = screen.getByRole('button', { name: /flash apu firmware/i })
    expect(btn.disabled).toBe(false)
  })

  it('with the flag ON, disables the Flash button for demo units', () => {
    apuOtaEnabled = true
    render(<FirmwareTab tele={TELE} unit="APU-DEMO-01" isDemo={true} />)
    expect(screen.getByRole('button', { name: /flash apu firmware/i }).disabled).toBe(true)
  })
})
