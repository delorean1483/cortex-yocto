import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { IconArrowLeft } from '@tabler/icons-react'
import { useUnitLatest } from '../data/hooks.js'
import { connLabel } from '../api/contract.js'
import OverviewTab from '../components/unit/OverviewTab.jsx'
import HeaterTab from '../components/unit/HeaterTab.jsx'
import ComponentTestTab from '../components/unit/ComponentTestTab.jsx'
import TelemetryTab from '../components/unit/TelemetryTab.jsx'
import HistoryTab from '../components/unit/HistoryTab.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'heater', label: 'Heater' },
  { id: 'diag', label: 'Component Test' },
  { id: 'history', label: 'History' },
]

export default function UnitDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const { data: tele } = useUnitLatest(id)
  const conn = connLabel(tele)
  const isDemo = (id || '').startsWith('APU-DEMO-')

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => navigate('/')}>
          <IconArrowLeft size={13} /> Fleet
        </button>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{id}</span>
        <span className={`pill ${conn.cls}`}>{conn.text}</span>
        {tele && (
          <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
            {tele.mode} · {tele.control_status}
          </span>
        )}
        {tele && Number(tele.error_n) !== 0 && (
          <span className="pill p-r" style={{ marginLeft: 'auto' }}>{tele.error}</span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '0.5px solid var(--color-border-tertiary)', flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '8px 13px', fontSize: 12.5, fontWeight: active ? 600 : 400,
              border: 'none', background: 'none', cursor: 'pointer',
              color: active ? 'var(--accent)' : 'var(--color-text-secondary)',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}>{t.label}</button>
          )
        })}
      </div>

      {/* Panel */}
      {tab === 'overview' && <OverviewTab tele={tele} />}
      {tab === 'telemetry' && <TelemetryTab unit={id} />}
      {tab === 'heater' && <HeaterTab tele={tele} unit={id} isDemo={isDemo} />}
      {tab === 'diag' && <ComponentTestTab tele={tele} />}
      {tab === 'history' && <HistoryTab unit={id} />}
    </>
  )
}
