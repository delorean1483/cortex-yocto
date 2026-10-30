import { useState, useEffect } from 'react'
import { IconUserPlus, IconTrash, IconRefresh, IconLoader2 } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth, ROLE_CFG } from '../contexts/AuthContext.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import FilterChips from '../components/FilterChips.jsx'
import SearchInput from '../components/SearchInput.jsx'
import { userStatusView, assignableRoles } from '../api/contract.js'
import { passwordProblem, generatePassword, PASSWORD_HINT } from '../api/password.js'

const ROLE_ORDER = ['admin', 'fm', 'maint', 'eu']

export default function UsersPage() {
  const { role: myRole, user: me } = useAuth()
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [msg, setMsg]           = useState('')
  const [showForm, setShowForm] = useState(false)
  const [delEmail, setDelEmail] = useState(null)   // pending delete confirmation
  const [deleting, setDeleting] = useState(false)
  const [q, setQ]               = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [roleEdit, setRoleEdit] = useState(null)   // { email, role } pending role change
  const [roleSaving, setRoleSaving] = useState(false)
  const [pwEdit, setPwEdit]     = useState(null)   // { email, password } pending password reset
  const [pwSaving, setPwSaving] = useState(false)

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

  async function doRoleChange() {
    const { email, role } = roleEdit
    setRoleSaving(true)
    setMsg('')
    try {
      await api.updateUser(email, { role })
      setUsers(prev => prev.map(u => u.email === email ? { ...u, role } : u))
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setRoleSaving(false)
      setRoleEdit(null)
    }
  }

  async function doSetPassword() {
    const { email, password } = pwEdit
    setPwSaving(true)
    setMsg('')
    try {
      await api.setUserPassword(email, password)
      setMsg(`Password for ${email} updated. Share it with them directly.`)
      setTimeout(() => setMsg(''), 6000)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setPwSaving(false)
      setPwEdit(null)
    }
  }

  async function doDelete() {
    const email = delEmail
    setDeleting(true)
    setMsg('')
    try {
      await api.deleteUser(email)
      setUsers(prev => prev.filter(u => u.email !== email))
      setMsg(`User ${email} deleted.`)
      setTimeout(() => setMsg(''), 3000)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setDeleting(false)
      setDelEmail(null)
    }
  }

  const pwProblem = pwEdit ? passwordProblem(pwEdit.password) : null

  const needle = q.trim().toLowerCase()
  const visible = users.filter(u =>
    (roleFilter === 'all' || u.role === roleFilter) &&
    (!needle || u.email.toLowerCase().includes(needle)))
  const roleOptions = [
    { value: 'all', label: `All roles · ${users.length}` },
    ...ROLE_ORDER.map(r => ({ value: r, label: r === 'admin' ? 'Admin' : (ROLE_CFG[r]?.lbl || r) })),
  ]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Filter by email" width={280} />
        <FilterChips label="Role" options={roleOptions} value={roleFilter} onChange={setRoleFilter} />
        <button className="btn" style={{ padding: 0, width: 36 }} aria-label="Refresh" title="Refresh" onClick={fetchUsers}>
          <IconRefresh size={16} className={loading ? 'spin' : undefined} />
        </button>
        {isAdmin && !showForm && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
            <IconUserPlus size={16} /> Add user
          </button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>New user</div>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 2, minWidth: 180 }}>
                <label htmlFor="nu-email">Email</label>
                <input id="nu-email" className="control" type="email" required value={fEmail}
                  onChange={e => setFEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="field">
                <label htmlFor="nu-role">Role</label>
                <select id="nu-role" className="control" value={fRole} onChange={e => setFRole(e.target.value)}>
                  {assignableRoles('admin').map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="nu-pass">Initial password</label>
                <input id="nu-pass" className="control" type="password" required minLength={12} value={fPass}
                  onChange={e => setFPass(e.target.value)} placeholder="Min 12 chars" />
              </div>
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>
              No welcome email is sent — share credentials with the user directly.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <IconLoader2 size={16} className="spin" /> : <IconUserPlus size={16} />}
                Create
              </button>
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 14, color: msg.startsWith('Error') ? 'var(--err)' : 'var(--ok)' }}>{msg}</div>
      )}

      <div className="panel panel-x">
        {loading && <div className="notice">Loading…</div>}
        {!loading && users.length === 0 && <div className="notice">No users found.</div>}
        {!loading && users.length > 0 && visible.length === 0 && <div className="notice">No users match.</div>}
        {!loading && visible.length > 0 && (
          <table className="dtbl roomy">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Fleet</th>
                <th>Status</th>
                {isAdmin && <th className="num w-200">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(u => {
                const st = userStatusView(u.status)
                const isMe = u.email === me?.email
                const hasFleet = u.fleet && u.fleet !== '—'
                return (
                  <tr key={u.email}>
                    <td className="strong">
                      {u.email}
                      {isMe && <span className="subline"> (you)</span>}
                    </td>
                    <td>
                      <span className={`rbadge ${ROLE_CFG[u.role]?.badge || ''}`}>
                        {ROLE_CFG[u.role]?.lbl || u.role}
                      </span>
                    </td>
                    <td>
                      {hasFleet ? u.fleet : <span className="subline">All fleets</span>}
                    </td>
                    <td><span className={`badge badge-sm t-${st.tone}`}>{st.label}</span></td>
                    {isAdmin && (
                      <td className="num">
                        {!isMe && (
                          <span style={{ display: 'inline-flex', gap: 8 }}>
                            <button className="btn btn-sm" aria-label={`Change role for ${u.email}`}
                              onClick={() => setRoleEdit({ email: u.email, role: u.role })}>
                              Change role
                            </button>
                            <button className="btn btn-sm" aria-label={`Reset password for ${u.email}`}
                              onClick={() => setPwEdit({ email: u.email, password: generatePassword() })}>
                              Reset password
                            </button>
                            <button className="btn btn-sm btn-red" aria-label={`Delete ${u.email}`}
                              onClick={() => setDelEmail(u.email)}>
                              <IconTrash size={16} />
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!roleEdit}
        title="Change role"
        body={roleEdit && (
          <div className="field">
            <label htmlFor="role-edit">New role</label>
            <select id="role-edit" className="control" value={roleEdit.role}
              onChange={e => setRoleEdit({ ...roleEdit, role: e.target.value })}>
              {assignableRoles(myRole).map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}
        confirmLabel="Change role"
        pending={roleSaving}
        onConfirm={doRoleChange}
        onCancel={() => setRoleEdit(null)}
      />

      <ConfirmDialog
        open={!!pwEdit}
        title="Reset password"
        body={pwEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field">
              <label htmlFor="pw-edit">New password</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="pw-edit" className="control" type="text" autoComplete="off" spellCheck={false}
                  style={{ flex: 1, minWidth: 0 }} value={pwEdit.password}
                  onChange={e => setPwEdit({ ...pwEdit, password: e.target.value })} />
                <button type="button" className="btn"
                  onClick={() => setPwEdit({ ...pwEdit, password: generatePassword() })}>
                  Generate
                </button>
              </div>
            </div>
            <div style={{ fontSize: 14, color: pwProblem ? 'var(--err)' : 'var(--color-text-tertiary)' }}>
              {pwProblem || PASSWORD_HINT}
            </div>
            <div>
              For {pwEdit.email}. Works right away; copy it and share it with them directly.
              They can choose their own later with "Forgot password?" on the sign-in page.
            </div>
          </div>
        )}
        confirmLabel="Set password"
        confirmDisabled={!!pwProblem}
        pending={pwSaving}
        onConfirm={doSetPassword}
        onCancel={() => setPwEdit(null)}
      />

      <ConfirmDialog
        open={!!delEmail}
        title="Delete user"
        body={`Delete user ${delEmail}? This removes their account and access.`}
        confirmLabel="Delete user"
        danger
        pending={deleting}
        onConfirm={doDelete}
        onCancel={() => setDelEmail(null)}
      />
    </>
  )
}
