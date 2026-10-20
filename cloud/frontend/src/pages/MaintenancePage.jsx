import { useState, useEffect } from 'react'
import { IconPlus, IconTool, IconLoader2 } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import UnitPicker from '../components/UnitPicker.jsx'
import EmptyState from '../components/EmptyState.jsx'
import FilterChips from '../components/FilterChips.jsx'
import { useUnitLatest } from '../data/hooks.js'

const TYPE_LABELS = {
  oil_change:  'Oil change',
  filter:      'Filter',
  inspection:  'Inspection',
  repair:      'Repair',
  firmware:    'Firmware update',
  other:       'Other',
}

const TYPE_CHIPS = [
  { value: 'all', label: 'All types' },
  { value: 'oil_change', label: 'Oil change' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'repair', label: 'Repair' },
  { value: 'firmware', label: 'Firmware' },
]

function hrs(v) {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toLocaleString('en-US')} h` : '—'
}

function dateParts(r) {
  // Real records carry ts; older/mock rows may only have a date string.
  const d = new Date(r.ts ?? r.date)
  if (Number.isNaN(d.getTime())) return { day: r.date || '—', time: '' }
  return {
    day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: r.ts != null ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '',
  }
}

export default function MaintenancePage() {
  const { selectedUnit, setSelectedUnit, role } = useAuth()
  const [units, setUnits]     = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg]         = useState(null) // { ok, text }
  const [typeFilter, setTypeFilter] = useState('all')
  const { data: latest } = useUnitLatest(selectedUnit)

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
      // list items are { unit, demo } objects — select the unit id string.
      if (!selectedUnit && list.length > 0) setSelectedUnit(list[0].unit)
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
    setMsg(null)
    try {
      await api.addMaintenance({ unit: selectedUnit, type: fType, notes: fNotes, technician: fTech || undefined })
      setMsg({ ok: true, text: 'Record added.' })
      setFNotes('')
      setShowForm(false)
      fetchRecords()
      setTimeout(() => setMsg(null), 3000)
    } catch (err) {
      setMsg({ ok: false, text: `Couldn't save the record: ${err.message}` })
    } finally {
      setSubmitting(false)
    }
  }

  const shown = typeFilter === 'all' ? records : records.filter(r => r.type === typeFilter)
  const showEmpty = !!selectedUnit && !loading && records.length === 0

  const addButton = canAdd && !showForm && (
    <button className="btn btn-primary" onClick={() => setShowForm(true)}>
      <IconPlus size={16} aria-hidden="true" /> Add record
    </button>
  )

  return (
    <>
      <div className="toolbar">
        <UnitPicker units={units} value={selectedUnit} onChange={setSelectedUnit} />
        <FilterChips label="Type" options={TYPE_CHIPS} value={typeFilter} onChange={setTypeFilter} />
        <span style={{ flex: 1 }} />
        {/* The empty state carries its own Add button; don't show two. */}
        {!showEmpty && addButton}
      </div>

      {!selectedUnit && <div className="notice">Select a unit above.</div>}

      {selectedUnit && showForm && (
        <section className="group" aria-labelledby="new-rec-h">
          <h2 id="new-rec-h" className="group-hd" style={{ margin: 0 }}>New maintenance record · {selectedUnit}</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div className="field" style={{ minWidth: 200 }}>
                <label htmlFor="rec-type">Type</label>
                <select id="rec-type" className="control" value={fType} onChange={e => setFType(e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="rec-tech">Technician (optional)</label>
                <input id="rec-tech" type="text" className="control" value={fTech}
                  onChange={e => setFTech(e.target.value)} placeholder="Name or badge number" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rec-notes">Notes</label>
              <textarea id="rec-notes" className="control" value={fNotes} onChange={e => setFNotes(e.target.value)}
                rows={3} placeholder="Describe the work performed" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <IconLoader2 size={16} className="spin" aria-hidden="true" /> : <IconPlus size={16} aria-hidden="true" />}
                Save record
              </button>
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {msg && <div role="status" className={msg.ok ? 'msg-ok' : 'msg-err'}>{msg.text}</div>}

      {selectedUnit && loading && records.length === 0 && (
        <div className="skeleton" style={{ height: 72, borderRadius: 12 }} />
      )}

      {showEmpty && (
        <EmptyState icon={IconTool} title={`No maintenance logged for ${selectedUnit} yet`} action={showForm ? null : addButton}>
          {canAdd ? 'Log oil changes, inspections and repairs here to keep the unit’s service history.' : 'Service history appears here once a technician logs work.'}
        </EmptyState>
      )}

      {selectedUnit && (
        <section aria-labelledby="svc-counters-h">
          <div className="sec-hd">
            <h2 id="svc-counters-h" className="sec-title svc-title">Service counters</h2>
            <span className="sec-sub svc-sub">{selectedUnit} · from latest telemetry</span>
          </div>
          <div className="svc-grid">
            <div className="scard svc-card">
              <div className="scard-lbl">Oil hours</div>
              <div className="scard-val">{hrs(latest?.oil_hrs)}</div>
              <div className="scard-sub">since last oil change</div>
            </div>
            <div className="scard svc-card">
              <div className="scard-lbl">Engine hours</div>
              <div className="scard-val">{hrs(latest?.engine_hrs)}</div>
              <div className="scard-sub">engine counter</div>
            </div>
            <div className="scard svc-card">
              <div className="scard-lbl">Machine hours</div>
              <div className="scard-val">{hrs(latest?.machine_hrs)}</div>
              <div className="scard-sub">unit powered</div>
            </div>
          </div>
        </section>
      )}

      {selectedUnit && records.length > 0 && (
        <section aria-labelledby="svc-history-h">
          <div className="sec-hd">
            <h2 id="svc-history-h" className="sec-title svc-title">Service history</h2>
            <span className="sec-sub svc-sub">{shown.length} {shown.length === 1 ? 'record' : 'records'}</span>
          </div>
          <div className="panel" style={{ overflowX: 'auto' }}>
            <table className="dtbl roomy" aria-labelledby="svc-history-h">
              <thead>
                <tr>
                  <th className="w-150">Date</th>
                  <th className="w-150">Type</th>
                  <th className="w-180">Technician</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id || i}>
                    <td className="strong nowrap">{dateParts(r).day}</td>
                    <td><span className="badge badge-sm t-off">{TYPE_LABELS[r.type] || r.type}</span></td>
                    <td>{r.technician || r.tech || '—'}</td>
                    <td>{r.notes || <span className="subline">No notes</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
