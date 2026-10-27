import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mutate = vi.fn()
const mocks = vi.hoisted(() => ({ data: undefined, loading: false, pending: false, error: false }))
vi.mock('../data/hooks.js', () => ({
  useMyAlerts: () => ({ data: mocks.data, isLoading: mocks.loading }),
  useSetMyAlerts: () => ({ mutate, isPending: mocks.pending, isError: mocks.error }),
}))

import AlertsSwitch from './AlertsSwitch.jsx'

const EMAIL = 'tech@ecofleet.io'
const setStored = (on) => { mocks.data = { email: EMAIL, email_alerts: on } }

describe('AlertsSwitch', () => {
  beforeEach(() => {
    mutate.mockClear()
    Object.assign(mocks, { loading: false, pending: false, error: false })
    setStored(false)
  })

  it('shows the stored preference and where emails go', () => {
    setStored(true)
    render(<AlertsSwitch compact={false} email={EMAIL} />)
    expect(screen.getByRole('switch', { name: 'Email alerts' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(`Sent to ${EMAIL}`)).toBeTruthy()
  })

  it('turns alerts on when off, and off when on', () => {
    const { unmount } = render(<AlertsSwitch compact={false} email={EMAIL} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Email alerts' }))
    expect(mutate).toHaveBeenLastCalledWith(true)
    unmount()
    setStored(true)
    render(<AlertsSwitch compact={false} email={EMAIL} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Email alerts' }))
    expect(mutate).toHaveBeenLastCalledWith(false)
  })

  it('is disabled while saving', () => {
    mocks.pending = true
    render(<AlertsSwitch compact={false} email={EMAIL} />)
    expect(screen.getByRole('switch', { name: 'Email alerts' }).disabled).toBe(true)
  })

  it('says a failed save did not stick and keeps showing the stored value', () => {
    mocks.error = true
    render(<AlertsSwitch compact={false} email={EMAIL} />)
    expect(screen.getByText("Couldn't save. Try again.")).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Email alerts' }).getAttribute('aria-checked')).toBe('false')
  })

  it('is a bell button in the narrow menu that names its state', () => {
    const { unmount } = render(<AlertsSwitch compact email={EMAIL} />)
    const off = screen.getByRole('button', { name: 'Email alerts: off' })
    expect(off.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(off)
    expect(mutate).toHaveBeenLastCalledWith(true)
    unmount()
    setStored(true)
    render(<AlertsSwitch compact email={EMAIL} />)
    expect(screen.getByRole('button', { name: 'Email alerts: on' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('is disabled while the preference loads', () => {
    mocks.loading = true
    mocks.data = undefined
    render(<AlertsSwitch compact={false} email={EMAIL} />)
    expect(screen.getByRole('switch', { name: 'Email alerts' }).disabled).toBe(true)
  })
})
