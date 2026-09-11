import { useParams, useNavigate } from 'react-router-dom'
import { IconArrowLeft } from '@tabler/icons-react'
import { useUnitLatest } from '../data/hooks.js'
import { fmt } from '../api/contract.js'

// Placeholder — the full tabbed unit-detail screen (sensor suite, heater,
// component test, telemetry charts, remote control, OTA, history) is built in Plan 3.
export default function UnitDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: tele } = useUnitLatest(id)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-sm" onClick={() => navigate('/')}>
          <IconArrowLeft size={13} /> Fleet
        </button>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{id}</span>
      </div>

      {tele && (
        <div className="tgrid">
          <div className="tcell"><div className="tlbl">Battery</div><div className="tval">{fmt.volts(tele.batt_v)}</div></div>
          <div className="tcell"><div className="tlbl">Cabin</div><div className="tval">{fmt.tempF(tele.cabin_temp_f)}</div></div>
          <div className="tcell"><div className="tlbl">RPM</div><div className="tval">{fmt.int(tele.rpm)}</div></div>
          <div className="tcell"><div className="tlbl">Mode</div><div className="tval" style={{ fontSize: 12 }}>{tele.mode}</div></div>
          <div className="tcell"><div className="tlbl">Heater</div><div className="tval" style={{ fontSize: 12 }}>{tele.heater_state}</div></div>
        </div>
      )}

      <div className="notice">
        Full unit detail — sensor suite, VEVOR heater, component test, telemetry charts,
        remote control, and OTA — is built in Plan 3.
      </div>
    </>
  )
}
