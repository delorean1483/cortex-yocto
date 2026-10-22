import { createContext, useContext, useState, useEffect } from 'react'
import { setTokens, clearTokens, loadRefreshToken, onTokenRefresh } from '../api/client.js'

function parseJwtPayload(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) }
  catch { return null }
}

const AuthContext = createContext(null)

// RBAC config mirrors the prototype
export const ROLE_CFG = {
  admin: { lbl: 'EcoFleet Admin', badge: 'rb-admin', nav: ['/', '/map', '/remote', '/maintenance', '/firmware', '/alerts', '/reports', '/history', '/users', '/config'] },
  fm:    { lbl: 'Fleet Manager',  badge: 'rb-fm',    nav: ['/', '/map', '/remote', '/maintenance', '/firmware', '/alerts', '/reports', '/history', '/users'] },
  maint: { lbl: 'Maintenance',    badge: 'rb-maint',  nav: ['/', '/remote', '/maintenance', '/firmware', '/history'] },
  eu:    { lbl: 'End User',       badge: 'rb-eu',    nav: ['/', '/remote', '/maintenance', '/firmware', '/alerts', '/history'] },
}

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null)
  const [role, setRoleState]          = useState('admin')
  const [realRole, setRealRole]       = useState(null)
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    const rt = loadRefreshToken()
    if (rt) {
      const stored = localStorage.getItem('eco_user')
      if (stored) {
        try { setUser(JSON.parse(stored)) } catch { /* ignore */ }
      }
    }
    const savedReal = localStorage.getItem('eco_real_role')
    const real = savedReal && ROLE_CFG[savedReal] ? savedReal : null
    setRealRole(real)
    const savedRole = localStorage.getItem('eco_role')
    if (real && real !== 'admin') setRoleState(real)
    else if (savedRole && ROLE_CFG[savedRole]) setRoleState(savedRole)
    setLoading(false)
    // The first API call after a load refreshes the token; its role is the
    // real one. An admin keeps the role being previewed.
    onTokenRefresh((token) => adoptRole(parseJwtPayload(token)?.role, false))
    return () => onTokenRefresh(null)
  }, [])

  function setRole(r) {
    setRoleState(r)
    localStorage.setItem('eco_role', r)
  }

  // Real role from a signed token. `resetPreview` (sign-in) also drops any
  // role being previewed; a non-admin never keeps one.
  function adoptRole(jwtRole, resetPreview) {
    if (jwtRole && ROLE_CFG[jwtRole]) {
      setRealRole(jwtRole)
      localStorage.setItem('eco_real_role', jwtRole)
      if (resetPreview || jwtRole !== 'admin') {
        setRoleState(jwtRole)
        localStorage.setItem('eco_role', jwtRole)
      }
    } else {
      // Unknown or missing role: least privilege, never the 'admin' default.
      setRoleState('eu')
      setRealRole(null)
      localStorage.setItem('eco_role', 'eu')
      localStorage.removeItem('eco_real_role')
    }
  }

  function login(token, refreshToken) {
    setTokens(token, refreshToken)
    const payload = parseJwtPayload(token)
    const u = { email: payload?.email || '' }
    setUser(u)
    localStorage.setItem('eco_user', JSON.stringify(u))
    adoptRole(payload?.role, true)
  }

  function logout() {
    clearTokens()
    localStorage.removeItem('eco_real_role')
    setRealRole(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, role, realRole, canPreview: realRole === 'admin', setRole, selectedUnit, setSelectedUnit, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
