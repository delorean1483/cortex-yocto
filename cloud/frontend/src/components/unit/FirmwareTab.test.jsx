import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mutate = vi.fn()
let otaStatus = 'idle'
let cortexCurrent           // shadow.reported.firmware_version (the running cortex/image version)
let releasesLatest = null   // useReleases().latest
let releasesList = []       // useReleases().releases
vi.mock('../../data/hooks.js', () => ({
  useCommand: () => ({ mutate, isPending: false }),
  useReleases: () => ({ data: { releases: releasesList, latest: releasesLatest }, isLoading: false, error: null }),
  useShadow: () => ({ data: { reported: { ota_status: otaStatus, firmware_version: cortexCurrent } } }),
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

beforeEach(() => {
  mutate.mockClear(); apuOtaEnabled = false; otaStatus = 'idle'
  cortexCurrent = undefined; releasesLatest = null; releasesList = []
})

describe('FirmwareTab — cortex firmware current vs latest', () => {
  it('shows the running cortex version and flags when it is behind the latest', () => {
    cortexCurrent = '1.2.50'          // distinct from the release list -> unambiguous in the DOM
    releasesLatest = '1.2.56'
    releasesList = ['1.2.56', '1.2.55']
    render(<FirmwareTab tele={TELE} unit="TRUCK-1" isDemo={false} />)
    expect(screen.getByText('1.2.50')).toBeTruthy()          // the running version is shown, not just "latest"
    expect(screen.getByText(/update available/i)).toBeTruthy()
  })

  it('shows "up to date" when the running version equals the latest', () => {
    cortexCurrent = '1.2.56'
    releasesLatest = '1.2.56'
    releasesList = ['1.2.56']
    render(<FirmwareTab tele={TELE} unit="TRUCK-1" isDemo={false} />)
    expect(screen.getByText(/up to date/i)).toBeTruthy()
    expect(screen.queryByText(/update available/i)).toBeNull()
  })
})

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

describe('FirmwareTab — live OTA status', () => {
  it('shows the unit-reported OTA status when active', () => {
    otaStatus = 'downloading 1.2.49'
    render(<FirmwareTab tele={TELE} unit="APU-1" isDemo={false} />)
    expect(screen.getByText('downloading 1.2.49')).toBeTruthy()
  })

  it('shows a failure so it is not a silent stuck "pending"', () => {
    otaStatus = 'failed: download 9.9.9'
    render(<FirmwareTab tele={TELE} unit="APU-1" isDemo={false} />)
    expect(screen.getByText('failed: download 9.9.9')).toBeTruthy()
  })

  it('shows no OTA status pill when idle', () => {
    otaStatus = 'idle'
    render(<FirmwareTab tele={TELE} unit="APU-1" isDemo={false} />)
    expect(screen.queryByText(/downloading|installing|failed/i)).toBeNull()
  })
})
