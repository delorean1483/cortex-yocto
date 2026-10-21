import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconWifiOff, IconChevronRight,
} from '@tabler/icons-react'
import StatusBadge from '../components/StatusBadge.jsx'
import SearchInput from '../components/SearchInput.jsx'
import { useUnits, useUnitLatest } from '../data/hooks.js'
import { unitView, byAttention, fmt, apuVersionLabel, toneCounts, filterRows, ageText } from '../api/contract.js'

const TONE_ICON = { err: IconAlertTriangle, warn: IconAlertCircle, ok: IconCircleCheck, off: IconWifiOff }
const TONE_TEXT = { err: 'var(--err)', warn: 'var(--warn)' }

function unitHref(unit) {
  return '/units/' + encodeURIComponent(unit)
}

// Fetches one unit's latest telemetry and hands it up, so the page can sort
// cards and build the attention list across the whole fleet.
function UnitProbe({ unit, onData }) {
  const { data, isLoading } = useUnitLatest(unit)
  useEffect(() => { onData(unit, data, isLoading) }, [unit, data, isLoading, onData])
  return null
}

// Number at full size, unit small, so "1,920 rpm" never wraps in a card column.
// Validate the raw value; `format` runs after ("1,850" is not a Number).
function Val({ v, format, unit }) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return <>{format(Number(v))}{unit && <span className="kv-unit">{unit}</span>}</>
}
const oneDecimal = (n) => n.toFixed(1)
const thousands = (n) => Math.round(n).toLocaleString('en-US')

function UnitCard({ u, tele, view }) {
  return (
    <Link to={unitHref(u.unit)} className={`ucard c-${view.tone}`} aria-label={`Open ${u.unit}`}
      style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ucard-name">{u.unit}</span>
        {u.demo && <span className="badge badge-sm t-off">demo</span>}
        {u.fleet_id && <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>{u.fleet_id}</span>}
        <span style={{ flex: 1 }} />
        <StatusBadge view={view} />
      </div>
      <div className="ucard-head" style={{ color: TONE_TEXT[view.tone] || 'var(--color-text-primary)' }}>
        {view.headline}
      </div>
      <div className="kv4">
        <div><div className="kv-lbl">Battery</div><div className="kv-val"><Val v={tele?.batt_v} format={oneDecimal} unit=" V" /></div></div>
        <div><div className="kv-lbl">Cabin</div><div className="kv-val">{fmt.tempF(tele?.cabin_temp_f)}</div></div>
        <div><div className="kv-lbl">Engine</div><div className="kv-val"><Val v={tele?.rpm} format={thousands} unit=" rpm" /></div></div>
        <div><div className="kv-lbl">Fan</div><div className="kv-val">{fmt.pct(tele?.fan_speed)}</div></div>
      </div>
      <div className="ucard-foot">
        <span>{view.seen}</span>
        {tele?.apu_fw_version != null && <><span aria-hidden="true">·</span><span>APU fw {apuVersionLabel(tele.apu_fw_version)}</span></>}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>View unit</span>
        <IconChevronRight size={16} color="var(--accent-text)" aria-hidden="true" />
      </div>
    </Link>
  )
}

const TILES = [
  { tone: 'err', label: 'Fault' },
  { tone: 'warn', label: 'Warning' },
  { tone: 'off', label: 'Offline' },
  { tone: 'ok', label: 'Healthy' },
]

function CountTile({ tone, label, count, active, onClick }) {
  const Icon = TONE_ICON[tone]
  const hot = count != null && count > 0 && tone !== 'ok'
  return (
    <button type="button" aria-pressed={active} onClick={onClick} data-tone={tone}
      className={hot ? 'tile hot' : 'tile'}>
      <Icon size={20} color={`var(--${tone})`} aria-hidden="true" />
      <span className="tile-label">{label}</span>
      <span className="tile-count">{count == null ? '—' : count}</span>
    </button>
  )
}

function Section({ id, title, rows }) {
  return (
    <section aria-labelledby={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 id={id} className="sec-title" style={{ fontSize: 17, fontWeight: 600 }}>{title}</h2>
        <span className="sec-sub" style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>{rows.length} {rows.length === 1 ? 'unit' : 'units'}</span>
      </div>
      <div className="ugrid">
        {rows.map(({ u, tele, view }) => <UnitCard key={u.unit} u={u} tele={tele} view={view} />)}
      </div>
    </section>
  )
}

// Cards | Table choice is a per-viewer convenience; storage can be blocked.
const VIEW_KEY = 'eco_dash_view'
function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards' } catch { return 'cards' }
}
function saveView(v) {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ }
}

function ViewToggle({ value, onChange }) {
  return (
    <div role="group" aria-label="View" className="vseg">
      {[['cards', 'Cards'], ['table', 'Table']].map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

// Dense one-row-per-unit view: every unit once, in byAttention order. The unit
// name is the keyboard-reachable link; the whole row is a mouse shortcut to it.
function UnitTable({ rows, now }) {
  const navigate = useNavigate()
  const withFleet = rows.some((r) => r.u.fleet_id)
  // Leave clicks the link already handled (incl. Cmd/Ctrl-click to a new tab)
  // and drag-selections alone; a plain click elsewhere opens the unit.
  const openRow = (e, unit) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (e.target.closest?.('a, button')) return
    if (String(window.getSelection?.() ?? '') !== '') return
    navigate(unitHref(unit))
  }
  return (
    <>
      <div className="panel panel-x">
        <table className="dtbl utbl" aria-label="Units">
          <thead>
            <tr>
              <th className="w-112">Status</th>
              <th>Unit</th>
              {withFleet && <th>Fleet</th>}
              <th className="grow">Status detail</th>
              <th className="num">Battery</th>
              <th className="num">Cabin</th>
              <th className="num">RPM</th>
              <th className="num">Fan</th>
              <th>Last report</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ u, tele, view }) => {
              const err = view?.tone === 'err'
              const detail = !view ? 'Loading…' : (view.tone === 'off' && tele ? 'Not reporting' : view.headline)
              // Last-known readings of a unit that stopped reporting are history, not current state.
              const num = view?.stale && tele ? 'num utbl-stale' : 'num'
              return (
                <tr key={u.unit} className={err ? 'row-err' : undefined} onClick={(e) => openRow(e, u.unit)}>
                  <td>{view ? <StatusBadge view={view} size={14} small /> : '—'}</td>
                  <td>
                    <Link to={unitHref(u.unit)} className="utbl-unit">{u.unit}</Link>
                    {u.demo && <span className="badge badge-sm t-off utbl-demo">demo</span>}
                  </td>
                  {withFleet && <td className="utbl-sub">{u.fleet_id || '—'}</td>}
                  <td className={err ? 'grow utbl-err' : 'grow'}>{detail}</td>
                  <td className={num}><Val v={tele?.batt_v} format={(n) => `${oneDecimal(n)} V`} /></td>
                  <td className={num}>{fmt.tempF(tele?.cabin_temp_f)}</td>
                  <td className={num}><Val v={tele?.rpm} format={thousands} /></td>
                  <td className={num}>{fmt.pct(tele?.fan_speed)}</td>
                  <td className="utbl-sub">{tele?.ts != null ? ageText(now - Number(tele.ts)) : '—'}</td>
                  <td aria-hidden="true"><IconChevronRight size={16} color="var(--color-text-tertiary)" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="utbl-cap">
        {rows.length} {rows.length === 1 ? 'unit' : 'units'} · sorted by needs attention · click a row to open the unit
      </div>
    </>
  )
}

export default function DashboardPage() {
  const { data: units, isLoading, error } = useUnits()
  const [latest, setLatest] = useState({}) // unit -> { tele, pending }
  const [tone, setTone] = useState(null)
  const [q, setQ] = useState('')
  const [view, setView] = useState(loadView)
  const pickView = (v) => { setView(v); saveView(v) }
  const [now, setNow] = useState(() => Date.now())

  // "Reported 6s ago" and the offline cut-over need a moving clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  const onData = useCallback((unit, tele, pending) => {
    setLatest((s) => (s[unit] && s[unit].tele === tele && s[unit].pending === pending
      ? s : { ...s, [unit]: { tele, pending } }))
  }, [])

  if (error) return <div className="notice" style={{ color: 'var(--err)' }}>⚠ {error.message}</div>

  const list = units || []
  // Unit telemetry resolves card by card; hold summary claims until all have.
  const settled = !isLoading && list.every((u) => latest[u.unit] && !latest[u.unit].pending)
  const rows = list
    .map((u) => {
      const entry = latest[u.unit]
      const view = entry && !entry.pending ? unitView(entry.tele, now) : undefined
      return { u, tele: entry?.tele, view }
    })
    .sort(byAttention)
  const counts = toneCounts(rows)
  const shown = filterRows(rows, { tone, q })
  const needs = shown.filter((r) => r.view?.attention)
  const normal = shown.filter((r) => r.view && !r.view.attention)
  const pending = shown.filter((r) => !r.view)
  const clearFilter = () => { setTone(null); setQ('') }

  return (
    <>
      {list.map((u) => <UnitProbe key={u.unit} unit={u.unit} onData={onData} />)}

      {(isLoading || list.length > 0) && (
        <>
          <div className="tiles">
            {TILES.map((t) => (
              <CountTile key={t.tone} tone={t.tone} label={t.label} count={settled ? counts[t.tone] : null}
                active={tone === t.tone} onClick={() => setTone(tone === t.tone ? null : t.tone)} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Filter by unit or fleet" width={300} />
            <span style={{ flex: 1 }} />
            <ViewToggle value={view} onChange={pickView} />
          </div>
        </>
      )}

      {isLoading && (
        <div className="ugrid">
          {[1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 210, borderRadius: 12 }} />)}
        </div>
      )}

      {!isLoading && list.length === 0 && (
        <div className="notice">No units found. Fleet data appears once a device connects to IoT Core and sends telemetry.</div>
      )}

      {!isLoading && list.length > 0 && shown.length === 0 && (
        <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>No units match this filter</span>
          <button type="button" className="btn" onClick={clearFilter}>Clear filter</button>
        </div>
      )}

      {view === 'table' && shown.length > 0 && <UnitTable rows={shown} now={now} />}
      {view === 'cards' && needs.length > 0 && <Section id="attn-h" title="Needs attention" rows={needs} />}
      {view === 'cards' && normal.length > 0 && <Section id="ok-h" title="Running normally" rows={normal} />}
      {view === 'cards' && pending.length > 0 && (
        <div className="ugrid">
          {pending.map(({ u }) => <div key={u.unit} className="skeleton" style={{ height: 210, borderRadius: 12 }} />)}
        </div>
      )}
    </>
  )
}
