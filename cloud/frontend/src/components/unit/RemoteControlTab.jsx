import { isStale, modeLabel } from '../../api/contract.js'
import ApuControls from './ApuControls.jsx'

export default function RemoteControlTab({ tele, unit, isDemo }) {
  return (
    <>
      <div className="card">
        <div className="sec-hd"><span className="sec-title">APU control</span></div>
        {tele && (
          <div style={{ fontSize: 14, marginBottom: 12 }}>
            <span style={{ color: 'var(--color-text-tertiary)' }}>Mode</span> {modeLabel(tele)}
            {' · '}<span style={{ color: 'var(--color-text-tertiary)' }}>Engine</span> {tele.engine_status}
            {' · '}<span style={{ color: 'var(--color-text-tertiary)' }}>RPM</span> {tele.rpm}
          </div>
        )}
        <ApuControls tele={tele} unit={unit} isDemo={isDemo} offline={!!tele && isStale(tele)} />
      </div>

      <div className="notice">
        Temperature and battery-voltage setpoints are set on the in-cab panel for now.
      </div>
    </>
  )
}
