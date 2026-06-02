import { createContext, useContext, useState, useEffect } from 'react'
import { setTokens, clearTokens, loadRefreshToken } from '../api/client.js'

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
    const savedRole = localStorage.getItem('eco_role')
    if (savedRole && ROLE_CFG[savedRole]) setRoleState(savedRole)
    setLoading(false)
  }, [])

  function setRole(r) {
    setRoleState(r)
    localStorage.setItem('eco_role', r)
  }

  function login(token, refreshToken) {
    setTokens(token, refreshToken)
    const payload = parseJwtPayload(token)
    const email   = payload?.email || ''
    const jwtRole = payload?.role
    const u = { email }
    setUser(u)
    localStorage.setItem('eco_user', JSON.stringify(u))
    if (jwtRole && ROLE_CFG[jwtRole]) {
      setRoleState(jwtRole)
      localStorage.setItem('eco_role', jwtRole)
    }
  }

  function logout() {
    clearTokens()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, role, setRole, selectedUnit, setSelectedUnit, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
