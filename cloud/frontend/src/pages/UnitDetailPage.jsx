import { Suspense, useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useUnitLatest } from '../data/hooks.js'
import { unitView } from '../api/contract.js'
import StatusBadge from '../components/StatusBadge.jsx'
import OverviewTab from '../components/unit/OverviewTab.jsx'
import HeaterTab from '../components/unit/HeaterTab.jsx'
import ComponentTestTab from '../components/unit/ComponentTestTab.jsx'
import HistoryTab from '../components/unit/HistoryTab.jsx'
import RemoteControlTab from '../components/unit/RemoteControlTab.jsx'
import FirmwareTab from '../components/unit/FirmwareTab.jsx'
import { lazyPage } from '../components/lazyPage.js'

// recharts is the heaviest dependency; only fetch it when the Telemetry tab opens.
const TelemetryTab = lazyPage(() => import('../components/unit/TelemetryTab.jsx'))

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'heater', label: 'Heater' },
  { id: 'diag', label: 'Component Test' },
  { id: 'remote', label: 'Remote' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'history', label: 'History' },
]

export default function UnitDetailPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('tab')
  const tab = TABS.some((t) => t.id === wanted) ? wanted : 'overview'
  const setTab = (next) => {
    const p = new URLSearchParams(params)
    if (next === 'overview') p.delete('tab'); else p.set('tab', next)
    setParams(p, { replace: true })
  }
  const { data: tele } = useUnitLatest(id)
  const isDemo = (id || '').startsWith('APU-DEMO-')
  const [now, setNow] = useState(() => Date.now())
  // "Reported 6s ago" and the offline cut-over need a moving clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const view = tele ? unitView(tele, now) : null

  return (
    <>
      {/* Header */}
      <div className="unit-head">
        <span className="unit-id">{id}</span>
        {view && <StatusBadge view={view} />}
        {isDemo && <span className="badge badge-sm t-off">demo</span>}
        {view && (
          <span className="unit-seen">
            {tele.fleet_id ? `${tele.fleet_id} · ` : ''}{view.seen}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="tabbar" role="tablist" aria-label="Unit sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel */}
      {tab === 'overview' && <OverviewTab tele={tele} unit={id} isDemo={isDemo} onOpenTab={setTab} />}
      {tab === 'telemetry' && <Suspense fallback={null}><TelemetryTab unit={id} /></Suspense>}
      {tab === 'heater' && <HeaterTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'diag' && <ComponentTestTab tele={tele} />}
      {tab === 'remote' && <RemoteControlTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'firmware' && <FirmwareTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'history' && <HistoryTab unit={id} />}
    </>
  )
}
