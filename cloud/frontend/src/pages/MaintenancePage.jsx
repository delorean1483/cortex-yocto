import { useState, useEffect } from 'react'
import { IconPlus, IconTool, IconRefresh, IconLoader2 } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const TYPE_LABELS = {
  oil_change:  'Oil change',
  filter:      'Filter',
  inspection:  'Inspection',
  repair:      'Repair',
  firmware:    'Firmware update',
  other:       'Other',
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function MaintenancePage() {
  const { selectedUnit, setSelectedUnit, role } = useAuth()
  const [units, setUnits]     = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg]         = useState('')

  // Form state
  const [fType, setFType]         = useState('inspection')
  const [fNotes, setFNotes]       = useState('')
  const [fTech, setFTech]         = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canAdd = ['admin', 'fm', 'maint'].includes(role)

  useEffect(() => {
    api.listUnits().then(d => {
      const list = d.units || []
      setUnits(list)
      if (!selectedUnit && list.length > 0) setSelectedUnit(list[0])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedUnit) return
    fetchRecords()
  }, [selectedUnit])

  async function fetchRecords() {
    if (!selectedUnit) return
    setLoading(true)
    try {
      const d = await api.getMaintenance(selectedUnit, { limit: '50' })
      setRecords(d.records || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedUnit) return
    setSubmitting(true)
    setMsg('')
    try {
      await api.addMaintenance({ unit: selectedUnit, type: fType, notes: fNotes, technician: fTech || undefined })
      setMsg('Record added.')
      setFNotes('')
      setShowForm(false)
      fetchRecords()
      setTimeout(() => setMsg(''), 3000)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={selectedUnit || ''}
          onChange={e => setSelectedUnit(e.target.value)}
          style={selStyle}
        >
          {!selectedUnit && <option value="">— select unit —</option>}
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <button className="btn btn-sm" onClick={fetchRecords}>
          <IconRefresh size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        {canAdd && !showForm && (
          <button className="btn btn-amber btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(true)}>
            <IconPlus size={13} /> Add record
          </button>
        )}
      </div>

      {!selectedUnit && <div className="notice">Select a unit above.</div>}

      {selectedUnit && showForm && (
        <div className="card">
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 12 }}>New maintenance record — {selectedUnit}</div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={lblStyle}>Type</label>
                <select value={fType} onChange={e => setFType(e.target.value)} style={inputStyle}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
                <label style={lblStyle}>Technician (optional)</label>
                <input type="text" value={fTech} onChange={e => setFTech(e.target.value)} placeholder="Name or badge" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={lblStyle}>Notes</label>
              <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={3}
                placeholder="Describe the work performed…"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-amber btn-sm" disabled={submitting}>
                {submitting ? <IconLoader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <IconPlus size={13} />}
                Save
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
          {msg && <div style={{ marginTop: 8, fontSize: 11.5, color: msg.startsWith('Error') ? '#E24B4A' : '#1D9E75' }}>{msg}</div>}
        </div>
      )}

      {selectedUnit && !showForm && msg && (
        <div style={{ fontSize: 11.5, color: '#1D9E75' }}>{msg}</div>
      )}

      {selectedUnit && (
        <div className="card" style={{ padding: 0 }}>
          {loading && <div className="notice" style={{ fontSize: 11 }}>Loading…</div>}
          {!loading && records.length === 0 && (
            <div className="notice" style={{ fontSize: 11 }}>No maintenance records for {selectedUnit}.</div>
          )}
          {!loading && records.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  {['Date', 'Type', 'Technician', 'Notes'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10.5, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id || i} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                    <td style={tdStyle}>{fmtDate(r.ts)}</td>
                    <td style={tdStyle}><span className="pill p-n">{TYPE_LABELS[r.type] || r.type}</span></td>
                    <td style={tdStyle}>{r.technician || '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', maxWidth: 280 }}>{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  )
}

const selStyle = { fontSize: 13, fontWeight: 500, border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, padding: '5px 10px', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer' }
const inputStyle = { fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', width: '100%' }
const lblStyle = { fontSize: 10.5, color: 'var(--color-text-tertiary)' }
const tdStyle  = { padding: '8px 12px', verticalAlign: 'top' }
