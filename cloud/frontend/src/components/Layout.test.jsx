import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const authState = vi.hoisted(() => ({ canPreview: false }))

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { email: 'tech@ecofleet.io' }, role: 'admin', realRole: authState.canPreview ? 'admin' : 'fm', canPreview: authState.canPreview, setRole: vi.fn(), logout: vi.fn() }),
  ROLE_CFG: { admin: { lbl: 'EcoFleet Admin', badge: 'rb-admin', nav: ['/', '/map', '/alerts', '/config'] } },
}))

import Layout from './Layout.jsx'

function setWidth(w) {
  window.innerWidth = w
  act(() => { window.dispatchEvent(new Event('resize')) })
}

function renderAt(width, path = '/') {
  window.innerWidth = width
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Layout><div>page body</div></Layout>} />
      </Routes>
    </MemoryRouter>,
  )
}

const dialog = () => screen.queryByRole('dialog', { name: 'Navigation' })

describe('Layout', () => {
  beforeEach(() => { window.innerWidth = 1440; authState.canPreview = false })

  it('desktop: full sidebar with text labels, no menu button', () => {
    renderAt(1440)
    expect(screen.getByRole('button', { name: 'Dashboard' }).textContent).toContain('Dashboard')
    expect(screen.getByText('tech@ecofleet.io')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(document.querySelector('.rbadge')).toBeNull()
  })

  it('a malformed unit id in the URL does not crash the shell', () => {
    renderAt(1440, '/units/%E0%A4%A')
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/')
    expect(screen.getByText('%E0%A4%A')).toBeTruthy()
  })

  it('config nav entry and topbar title are labelled Unit settings', () => {
    renderAt(1440, '/config')
    expect(screen.getByRole('button', { name: 'Unit settings' })).toBeTruthy()
    expect(screen.queryByText('System config')).toBeNull()
  })

  it('preview select is hidden unless canPreview', () => {
    renderAt(1440)
    expect(screen.queryByRole('combobox', { name: /Preview as/ })).toBeNull()
  })

  it('preview select shows for canPreview', () => {
    authState.canPreview = true
    renderAt(1440)
    expect(screen.getByRole('combobox', { name: /Preview as/ })).toBeTruthy()
  })

  it('unit page shows a Dashboard breadcrumb and the unit id', () => {
    renderAt(1440, '/units/APU-000123')
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link.getAttribute('href')).toBe('/')
    expect(screen.getByText('APU-000123')).toBeTruthy()
  })

  it('phone: unit page shows the unit id without the Dashboard breadcrumb', () => {
    renderAt(390, '/units/APU-000123')
    expect(screen.getByText('APU-000123')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
  })

  it('phone: the DEMO tag is hidden but the preview select stays', () => {
    authState.canPreview = true
    renderAt(390)
    expect(screen.queryByText('DEMO')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Preview as role' })).toBeTruthy()
  })

  it('tablet: icon rail — buttons keep accessible names, labels and email hidden', () => {
    renderAt(1024)
    const dash = screen.getByRole('button', { name: 'Dashboard' })
    expect(dash.textContent).toBe('')
    expect(dash.getAttribute('title')).toBe('Dashboard')
    expect(screen.queryByText('tech@ecofleet.io')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('tablet: expand opens the full sidebar as an overlay; Esc closes it', () => {
    renderAt(1024)
    fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }))
    expect(dialog()).toBeTruthy()
    expect(screen.getByText('tech@ecofleet.io')).toBeTruthy()
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(dialog()).toBeNull()
  })

  it('phone: no sidebar; the menu button opens the drawer and choosing a page closes it', () => {
    renderAt(390)
    expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(dialog()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }))
    expect(dialog()).toBeNull()
    expect(screen.getByText('Alerts', { selector: 'h1' })).toBeTruthy()
  })

  it('phone: the backdrop closes the drawer and focus returns to the menu button', () => {
    renderAt(390)
    const menu = screen.getByRole('button', { name: 'Open navigation' })
    fireEvent.click(menu)
    fireEvent.click(screen.getByTestId('nav-backdrop'))
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(menu)
  })

  it('an open drawer closes when the window grows to desktop width', () => {
    renderAt(390)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    setWidth(1440)
    expect(dialog()).toBeNull()
    expect(screen.getByText('tech@ecofleet.io')).toBeTruthy()
  })
})
