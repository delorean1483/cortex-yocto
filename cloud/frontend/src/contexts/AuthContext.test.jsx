import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext.jsx'

const jwt = (payload) => `h.${btoa(JSON.stringify(payload))}.s`

let auth
function Probe() {
  auth = useAuth()
  return <div data-testid="p">{`${auth.role}|${auth.realRole}|${auth.canPreview}`}</div>
}

function mount() {
  return render(<AuthProvider><Probe /></AuthProvider>)
}

describe('AuthContext real role', () => {
  beforeEach(() => { localStorage.clear() })

  it('login with an fm token: role and realRole fm, no preview', () => {
    mount()
    act(() => { auth.login(jwt({ email: 'a@b.c', role: 'fm' }), 'rt') })
    expect(auth.role).toBe('fm')
    expect(auth.realRole).toBe('fm')
    expect(auth.canPreview).toBe(false)
    expect(localStorage.getItem('eco_real_role')).toBe('fm')
  })

  it('login with an admin token enables preview', () => {
    mount()
    act(() => { auth.login(jwt({ email: 'a@b.c', role: 'admin' }), 'rt') })
    expect(auth.realRole).toBe('admin')
    expect(auth.canPreview).toBe(true)
  })

  it('a stored preview role is ignored for a non-admin', () => {
    localStorage.setItem('eco_role', 'admin')
    localStorage.setItem('eco_real_role', 'fm')
    localStorage.setItem('eco_rt', 'x')
    localStorage.setItem('eco_user', JSON.stringify({ email: 'a@b.c' }))
    mount()
    expect(screen.getByTestId('p').textContent).toBe('fm|fm|false')
  })

  it('a pre-upgrade session (no eco_real_role) renders with preview off', () => {
    localStorage.setItem('eco_role', 'maint')
    mount()
    expect(screen.getByTestId('p').textContent).toBe('maint|null|false')
  })

  it('logout clears eco_real_role', () => {
    mount()
    act(() => { auth.login(jwt({ email: 'a@b.c', role: 'fm' }), 'rt') })
    act(() => { auth.logout() })
    expect(localStorage.getItem('eco_real_role')).toBeNull()
    expect(auth.realRole).toBeNull()
  })

  it('login with an unknown role falls back to end user, no preview', () => {
    localStorage.setItem('eco_real_role', 'admin')
    mount()
    act(() => { auth.login(jwt({ email: 'a@b.c', role: 'superuser' }), 'rt') })
    expect(auth.role).toBe('eu')
    expect(auth.realRole).toBeNull()
    expect(auth.canPreview).toBe(false)
    expect(localStorage.getItem('eco_role')).toBe('eu')
    expect(localStorage.getItem('eco_real_role')).toBeNull()
  })
})
