import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconWifiOff, IconChevronRight,
} from '@tabler/icons-react'
import { useUnits, useUnitLatest } from '../data/hooks.js'
import { unitView, byAttention, fmt, apuVersionLabel } from '../api/contract.js'

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

function StatusBadge({ view, size = 16 }) {
  const Icon = TONE_ICON[view.tone]
  return (
    <span className={`badge t-${view.tone}`}>
      <Icon size={size} stroke={2.2} aria-hidden="true" />
      {view.status}
    </span>
  )
}

function rpmText(v) {
  return v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-US')} rpm`
}

function UnitCard({ u, tele, view }) {
  return (
    <Link to={unitHref(u.unit)} className={`ucard c-${view.tone}`} aria-label={`Open ${u.unit}`}
      style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ucard-name">{u.unit}</span>
        {u.demo && <span className="badge badge-sm t-off">demo</span>}
        <span style={{ flex: 1 }} />
        <StatusBadge view={view} />
      </div>
      <div className="ucard-head" style={{ color: TONE_TEXT[view.tone] || 'var(--color-text-primary)' }}>
        {view.headline}
      </div>
      <div className="kv4">
        <div><div className="kv-lbl">Battery</div><div className="kv-val">{fmt.volts(tele?.batt_v)}</div></div>
        <div><div className="kv-lbl">Cabin</div><div className="kv-val">{fmt.tempF(tele?.cabin_temp_f)}</div></div>
        <div><div className="kv-lbl">Engine</div><div className="kv-val">{rpmText(tele?.rpm)}</div></div>
        <div><div className="kv-lbl">Fan</div><div className="kv-val">{fmt.pct(tele?.fan_speed)}</div></div>
      </div>
      <div className="ucard-foot">
        <span>{view.seen}</span>
        {tele?.apu_fw_version != null && <><span aria-hidden="true">·</span><span>APU fw {apuVersionLabel(tele.apu_fw_version)}</span></>}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>View unit</span>
        <IconChevronRight size={16} color="var(--accent)" aria-hidden="true" />
      </div>
    </Link>
  )
}

function AttentionPanel({ rows, settled, total }) {
  if (!settled) return <div className="skeleton" style={{ height: 64 }} />
  if (rows.length === 0) {
    return (
      <div className="panel">
        <div className="attn-row">
          <span className="badge badge-icon t-ok"><IconCircleCheck size={20} aria-hidden="true" /></span>
          <div className="attn-title">All {total} units healthy</div>
        </div>
      </div>
    )
  }
  return (
    <div className="panel">
      {rows.map(({ u, view }) => {
        const Icon = TONE_ICON[view.tone]
        return (
          <div key={u.unit} className="attn-row">
            <span className={`badge badge-icon t-${view.tone}`}><Icon size={20} aria-hidden="true" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="attn-title">{u.unit} · {view.stale ? 'Not reporting' : view.headline}</div>
              <div className="attn-sub">{view.seen}</div>
            </div>
            <Link className="btn" to={unitHref(u.unit)} style={{ textDecoration: 'none' }}>Open unit</Link>
          </div>
        )
      })}
    </div>
  )
}

export default function DashboardPage() {
  const { data: units, isLoading, error } = useUnits()
  const [latest, setLatest] = useState({}) // unit -> { tele, pending }
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
  const count = (tone) => rows.filter((r) => r.view?.tone === tone).length
  const attention = rows.filter((r) => r.view?.attention)

  return (
    <>
      {list.map((u) => <UnitProbe key={u.unit} unit={u.unit} onData={onData} />)}

      <section aria-labelledby="attn-h" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 id="attn-h" className="sec-title" style={{ fontSize: 17 }}>Needs attention</h2>
          {settled && attention.length > 0 && (
            <span className="sec-sub" style={{ fontSize: 14 }}>{attention.length} of {list.length} units</span>
          )}
        </div>
        <AttentionPanel rows={attention} settled={settled} total={list.length} />
      </section>

      <section aria-labelledby="units-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 id="units-h" className="sec-title" style={{ fontSize: 17 }}>Units</h2>
          {settled && (
            <>
              {count('ok') > 0 && <span className="badge badge-sm t-ok">{count('ok')} running normally</span>}
              {count('err') > 0 && <span className="badge badge-sm t-err">{count('err')} fault</span>}
              {count('warn') > 0 && <span className="badge badge-sm t-warn">{count('warn')} warning</span>}
              {count('off') > 0 && <span className="badge badge-sm t-off">{count('off')} offline</span>}
            </>
          )}
          <span style={{ flex: 1 }} />
          {list.length > 1 && <span className="sec-sub" style={{ fontSize: 14 }}>Sorted by: needs attention</span>}
        </div>

        {isLoading && (
          <div className="ugrid">
            {[1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 210, borderRadius: 12 }} />)}
          </div>
        )}

        {!isLoading && list.length === 0 && (
          <div className="notice">No units found. Fleet data appears once a device connects to IoT Core and sends telemetry.</div>
        )}

        {!isLoading && list.length > 0 && (
          <div className="ugrid">
            {rows.map(({ u, tele, view }) => (view
              ? <UnitCard key={u.unit} u={u} tele={tele} view={view} />
              : <div key={u.unit} className="skeleton" style={{ height: 210, borderRadius: 12 }} />))}
          </div>
        )}
      </section>
    </>
  )
}
