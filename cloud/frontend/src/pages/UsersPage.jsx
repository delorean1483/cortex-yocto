import { useState, useEffect } from 'react'
import { IconUserPlus, IconTrash, IconRefresh, IconLoader2 } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth, ROLE_CFG } from '../contexts/AuthContext.jsx'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'EcoFleet Admin' },
  { value: 'fm',    label: 'Fleet Manager' },
  { value: 'maint', label: 'Maintenance' },
  { value: 'eu',    label: 'End User' },
]

function StatusPill({ status }) {
  if (status === 'CONFIRMED') return <span className="pill p-g">Active</span>
  if (status === 'FORCE_CHANGE_PASSWORD') return <span className="pill p-a">Pending</span>
  return <span className="pill p-n">{status}</span>
}

export default function UsersPage() {
  const { role: myRole, user: me } = useAuth()
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [msg, setMsg]           = useState('')
  const [showForm, setShowForm] = useState(false)

  // Create form
  const [fEmail, setFEmail]     = useState('')
  const [fRole, setFRole]       = useState('eu')
  const [fPass, setFPass]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isAdmin = myRole === 'admin'

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    try {
      const d = await api.listUsers()
      setUsers(d.users || [])
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSubmitting(true)
    setMsg('')
    try {
      await api.createUser({ email: fEmail, role: fRole, password: fPass })
      setMsg(`User ${fEmail} created.`)
      setFEmail(''); setFPass('')
      setShowForm(false)
      fetchUsers()
      setTimeout(() => setMsg(''), 4000)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRoleChange(email, role) {
    setMsg('')
    try {
      await api.updateUser(email, { role })
      setUsers(prev => prev.map(u => u.email === email ? { ...u, role } : u))
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    }
  }

  async function handleDelete(email) {
    if (!confirm(`Delete user ${email}?`)) return
    setMsg('')
    try {
      await api.deleteUser(email)
      setUsers(prev => prev.filter(u => u.email !== email))
      setMsg(`User ${email} deleted.`)
      setTimeout(() => setMsg(''), 3000)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm" onClick={fetchUsers}>
          <IconRefresh size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {isAdmin && !showForm && (
          <button className="btn btn-amber btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
            <IconUserPlus size={13} /> Add user
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="card">
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 12 }}>New user</div>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2, minWidth: 180 }}>
                <label style={lblStyle}>Email</label>
                <input type="email" required value={fEmail} onChange={e => setFEmail(e.target.value)}
                  placeholder="user@example.com" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={lblStyle}>Role</label>
                <select value={fRole} onChange={e => setFRole(e.target.value)} style={inputStyle}>
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
                <label style={lblStyle}>Initial password</label>
                <input type="password" required minLength={12} value={fPass} onChange={e => setFPass(e.target.value)}
                  placeholder="Min 12 chars" style={inputStyle} />
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
              No welcome email is sent — share credentials with the user directly.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-amber btn-sm" disabled={submitting}>
                {submitting ? <IconLoader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <IconUserPlus size={13} />}
                Create
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 11.5, color: msg.startsWith('Error') ? '#E24B4A' : '#1D9E75' }}>{msg}</div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading && <div className="notice" style={{ fontSize: 11 }}>Loading…</div>}
        {!loading && users.length === 0 && (
          <div className="notice" style={{ fontSize: 11 }}>No users found.</div>
        )}
        {!loading && users.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {['Email', 'Role', 'Status', isAdmin ? 'Actions' : ''].filter(Boolean).map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.email} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <td style={tdStyle}>{u.email}</td>
                  <td style={tdStyle}>
                    {isAdmin ? (
                      <select value={u.role} onChange={e => handleRoleChange(u.email, e.target.value)}
                        style={{ ...inputStyle, width: 'auto', fontSize: 11.5, padding: '3px 6px' }}>
                        {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    ) : (
                      <span>{ROLE_CFG[u.role]?.lbl || u.role}</span>
                    )}
                  </td>
                  <td style={tdStyle}><StatusPill status={u.status} /></td>
                  {isAdmin && (
                    <td style={tdStyle}>
                      {u.email !== me?.email && (
                        <button className="btn btn-sm btn-red" style={{ padding: '3px 8px' }} onClick={() => handleDelete(u.email)}>
                          <IconTrash size={12} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

const inputStyle = { fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', width: '100%' }
const lblStyle   = { fontSize: 10.5, color: 'var(--color-text-tertiary)' }
const tdStyle    = { padding: '8px 12px', verticalAlign: 'middle' }
