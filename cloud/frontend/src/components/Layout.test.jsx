import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { email: 'tech@ecofleet.io' }, role: 'admin', setRole: vi.fn(), logout: vi.fn() }),
  ROLE_CFG: { admin: { lbl: 'EcoFleet Admin', badge: 'rb-admin', nav: ['/', '/map', '/alerts'] } },
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
  beforeEach(() => { window.innerWidth = 1440 })

  it('desktop: full sidebar with text labels, no menu button', () => {
    renderAt(1440)
    expect(screen.getByRole('button', { name: 'Dashboard' }).textContent).toContain('Dashboard')
    expect(screen.getByText('tech@ecofleet.io')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
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
