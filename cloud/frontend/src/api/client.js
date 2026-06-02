const BASE = import.meta.env.VITE_API_URL || 'https://tphro82ot9.execute-api.us-east-1.amazonaws.com'

let _token = null
let _refreshToken = null

export function setTokens(token, refreshToken) {
  _token = token
  if (refreshToken) {
    _refreshToken = refreshToken
    localStorage.setItem('eco_rt', refreshToken)
  }
}

export function loadRefreshToken() {
  _refreshToken = localStorage.getItem('eco_rt')
  return _refreshToken
}

export function clearTokens() {
  _token = null
  _refreshToken = null
  localStorage.removeItem('eco_rt')
  localStorage.removeItem('eco_user')
}

async function tryRefresh() {
  if (!_refreshToken) throw new Error('no refresh token')
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: _refreshToken }),
  })
  if (!res.ok) throw new Error('refresh failed')
  const data = await res.json()
  _token = data.token
}

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (_token) headers['Authorization'] = `Bearer ${_token}`

  let res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401 && _refreshToken) {
    try {
      await tryRefresh()
      headers['Authorization'] = `Bearer ${_token}`
      res = await fetch(`${BASE}${path}`, { ...options, headers })
    } catch {
      clearTokens()
      window.location.replace('/login')
      throw new Error('Session expired')
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }

  return res.json()
}

export const api = {
  login: (email, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  listUnits: () => apiFetch('/fleet/units'),

  getTelemetry: (unit, params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiFetch(`/fleet/units/${encodeURIComponent(unit)}/telemetry${qs ? '?' + qs : ''}`)
  },

  getFaults: (unit, params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiFetch(`/fleet/units/${encodeURIComponent(unit)}/faults${qs ? '?' + qs : ''}`)
  },

  getShadow: (unit) => apiFetch(`/fleet/shadow?unit=${encodeURIComponent(unit)}`),

  setConfig: (unit, config) =>
    apiFetch('/fleet/config', { method: 'POST', body: JSON.stringify({ unit, config }) }),

  getMaintenance: (unit, params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiFetch(`/fleet/units/${encodeURIComponent(unit)}/maintenance${qs ? '?' + qs : ''}`)
  },

  addMaintenance: (record) =>
    apiFetch('/fleet/maintenance', { method: 'POST', body: JSON.stringify(record) }),

  listUsers: () => apiFetch('/fleet/users'),

  createUser: (user) =>
    apiFetch('/fleet/users', { method: 'POST', body: JSON.stringify(user) }),

  deleteUser: (email) =>
    apiFetch(`/fleet/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  updateUser: (email, patch) =>
    apiFetch(`/fleet/users/${encodeURIComponent(email)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getReports: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiFetch(`/fleet/reports${qs ? '?' + qs : ''}`)
  },
}
