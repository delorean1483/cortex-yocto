import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { IconArrowLeft } from '@tabler/icons-react'
import { useUnitLatest } from '../data/hooks.js'
import OverviewTab from '../components/unit/OverviewTab.jsx'
import HeaterTab from '../components/unit/HeaterTab.jsx'
import ComponentTestTab from '../components/unit/ComponentTestTab.jsx'
import TelemetryTab from '../components/unit/TelemetryTab.jsx'
import HistoryTab from '../components/unit/HistoryTab.jsx'
import RemoteControlTab from '../components/unit/RemoteControlTab.jsx'
import FirmwareTab from '../components/unit/FirmwareTab.jsx'

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
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const { data: tele } = useUnitLatest(id)
  const isDemo = (id || '').startsWith('APU-DEMO-')

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => navigate('/')}>
          <IconArrowLeft size={16} /> Fleet
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{id}</h1>
        {isDemo && <span className="badge badge-sm t-off">demo</span>}
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
      {tab === 'telemetry' && <TelemetryTab unit={id} />}
      {tab === 'heater' && <HeaterTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'diag' && <ComponentTestTab tele={tele} />}
      {tab === 'remote' && <RemoteControlTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'firmware' && <FirmwareTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'history' && <HistoryTab unit={id} />}
    </>
  )
}
