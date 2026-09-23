import { useState, useEffect } from 'react'
import { IconClockHour4, IconInfoCircle } from '@tabler/icons-react'
import { useUnits, useShadow, useUnitLatest, useSetConfig } from '../data/hooks.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useCan } from '../components/RoleGate.jsx'
import { unitView, apuVersionLabel } from '../api/contract.js'
import { INTERVAL_CHOICES, intervalStatus } from '../api/settings.js'
import UnitPicker from '../components/UnitPicker.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'

const STATUS_TEXT = {
  pending: 'Pending — waiting for the unit to confirm',
  unconfirmed: 'Not confirmed yet — the unit may be offline',
  confirmed: 'Confirmed by the unit',
}

function Row({ label, children }) {
  return (
    <div className="rd">
      <span className="rl">{label}</span>
      <span className="rv sm">{children}</span>
    </div>
  )
}

export default function SystemConfigPage() {
  const { selectedUnit, setSelectedUnit } = useAuth()
  const { data: units } = useUnits()
  const list = units || []
  const unit = selectedUnit || list[0]?.unit || null
  useEffect(() => { if (!selectedUnit && list[0]) setSelectedUnit(list[0].unit) }, [selectedUnit, list.length])

  const { data: shadow } = useShadow(unit)
  const { data: tele } = useUnitLatest(unit)
  const setConfig = useSetConfig()
  const canInterval = useCan('config').allowed
  const isDemo = (unit || '').startsWith('APU-DEMO-')

  const reported = shadow?.reported?.poll_interval_s
  const [choice, setChoice] = useState(null)
  const [request, setRequest] = useState(null) // { value, sentAt }
  const [confirmInterval, setConfirmInterval] = useState(false)
  const [msg, setMsg] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  useEffect(() => { setChoice(null); setRequest(null); setMsg(null) }, [unit])

  const status = intervalStatus({ reported, requested: request?.value ?? null, sentAt: request?.sentAt ?? null, now })
  const selectedChoice = choice ?? (INTERVAL_CHOICES.includes(Number(reported)) ? Number(reported) : null)
  const outside = reported != null && !INTERVAL_CHOICES.includes(Number(reported))

  const sendInterval = () => {
    const value = choice
    setConfirmInterval(false)
    setConfig.mutate({ unit, config: { poll_interval_s: value } }, {
      onSuccess: () => { setRequest({ value, sentAt: Date.now() }); setMsg(null) },
      onError: (e) => setMsg({ ok: false, text: `Couldn't change the interval: ${e.message}` }),
    })
  }

  return (
    <>
      <div className="toolbar">
        <UnitPicker units={list} value={unit} onChange={setSelectedUnit} />
      </div>

      {isDemo && <div className="notice">Demo units can't be configured.</div>}
      {msg && <div role="status" className={msg.ok ? 'msg-ok' : 'msg-err'}>{msg.text}</div>}

      {unit && (
        <div className="ov-layout">
          <div className="ov-groups" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <section className="group" aria-labelledby="int-h">
              <h2 id="int-h" className="group-hd" style={{ margin: 0 }}>
                <IconClockHour4 size={18} aria-hidden="true" /> Reporting interval
              </h2>
              <div style={{ fontSize: 22, fontWeight: 500 }}>
                {reported != null ? `Every ${reported} seconds` : 'Not reported yet'}
              </div>
              {outside && <div className="stat-cap">This interval was set outside this page.</div>}
              <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                How often the unit reads the APU and sends telemetry. Shorter intervals give fresher data but add database load.
              </p>

              {canInterval && !isDemo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div className="seg" role="radiogroup" aria-label="Reporting interval">
                    {INTERVAL_CHOICES.map((s) => (
                      <label key={s}>
                        <input type="radio" name="poll-interval" value={s}
                          checked={selectedChoice === s} onChange={() => setChoice(s)} />
                        {s} s
                      </label>
                    ))}
                  </div>
                  <button className="btn btn-primary" onClick={() => setConfirmInterval(true)}
                    disabled={choice == null || choice === Number(reported) || setConfig.isPending}>
                    Change interval
                  </button>
                </div>
              )}
              {status !== 'idle' && (
                <div role="status" className={status === 'unconfirmed' ? 'msg-err' : status === 'confirmed' ? 'msg-ok' : 'stat-cap'}>
                  {STATUS_TEXT[status]}
                </div>
              )}
            </section>

          </div>

          <div className="ov-side">
            <section className="group" aria-labelledby="info-h">
              <h2 id="info-h" className="group-hd" style={{ margin: 0 }}>
                <IconInfoCircle size={18} aria-hidden="true" /> Unit info
              </h2>
              <div>
                <Row label="System image">{shadow?.reported?.firmware_version || '—'}</Row>
                <Row label="APU firmware">{apuVersionLabel(tele?.apu_fw_version)}</Row>
                <Row label="Last report">{tele ? unitView(tele, now).seen : '—'}</Row>
                {shadow?.reported?.ota_status && shadow.reported.ota_status !== 'idle' && (
                  <Row label="Update status">{shadow.reported.ota_status}</Row>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmInterval}
        title={`Change reporting interval to ${choice} s?`}
        body={`${unit} will read the APU and send telemetry every ${choice} seconds.`}
        confirmLabel="Change interval"
        pending={setConfig.isPending}
        onConfirm={sendInterval}
        onCancel={() => setConfirmInterval(false)}
      />
    </>
  )
}
