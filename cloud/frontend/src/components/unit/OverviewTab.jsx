import { useState } from 'react'
import {
  IconAlertTriangle, IconAlertCircle, IconCircleCheck, IconWifiOff,
  IconBattery2, IconTemperature, IconGauge, IconFlame,
} from '@tabler/icons-react'
import {
  fmt, apuVersionLabel, unitView, modeLabel, engineRunning, heaterStateLabel,
} from '../../api/contract.js'
import { useCommand, useShadow } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ApuControls from './ApuControls.jsx'

const TONE_ICON = { err: IconAlertTriangle, warn: IconAlertCircle, ok: IconCircleCheck, off: IconWifiOff }
const TONE_TEXT = { err: 'var(--err)', warn: 'var(--warn)' }

function rpmText(v) {
  return v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-US')} rpm`
}

// Banner copy: what is wrong (or what the unit is doing), then the context an
// operator needs to act on it, plus the tab that has the detail.
function bannerCopy(tele, view) {
  const running = engineRunning(tele)
  const engine = `engine ${running ? `running at ${rpmText(tele.rpm)}` : 'off'} · cabin ${fmt.tempF(tele.cabin_temp_f)}`
  const context = `Mode ${modeLabel(tele).toLowerCase()} · ${engine}`
  if (view.status === 'No data') return { title: 'No data yet', sub: 'This unit has not reported telemetry.', tab: null }
  if (view.stale) return { title: 'Offline: not reporting', sub: 'Values below are the last ones received.', tab: ['history', 'View history'] }
  if (view.tone === 'err') return { title: `Fault: ${view.headline}`, sub: context, tab: ['history', 'View fault history'] }
  if (view.tone === 'warn') return { title: `Warning: ${view.headline}`, sub: context, tab: ['telemetry', 'View telemetry'] }
  // Healthy: the title already names the mode.
  return { title: `${view.status}: ${modeLabel(tele)}`, sub: engine.charAt(0).toUpperCase() + engine.slice(1), tab: ['telemetry', 'View telemetry'] }
}

function Row({ label, children, sm, color }) {
  return (
    <div className="rd">
      <span className="rl">{label}</span>
      <span className={`rv${sm ? ' sm' : ''}`} style={color ? { color } : undefined}>{children}</span>
    </div>
  )
}

function Group({ id, title, Icon, badge, children }) {
  return (
    <section className="group" aria-labelledby={id}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 id={id} className="group-hd" style={{ margin: 0 }}>
          {Icon && <Icon size={18} aria-hidden="true" />}
          {title}
        </h3>
        {badge && <span style={{ marginLeft: 'auto' }}>{badge}</span>}
      </div>
      <div>{children}</div>
    </section>
  )
}

function HeaterToggle({ tele, unit, isDemo, offline }) {
  const command = useCommand()
  const { allowed, reason } = useCan('heater')
  const [confirm, setConfirm] = useState(false)
  const on = tele.heater_state !== 'off'
  // Same offline rule as the APU starts: never queue an ignition.
  const disabled = !allowed || isDemo || (!on && offline)
  const title = !allowed ? reason : isDemo ? 'Demo units cannot be controlled.' : undefined

  return (
    <>
      <button className="btn btn-lg" disabled={disabled} title={title} onClick={() => setConfirm(true)}>
        {on ? 'Turn heater off' : 'Turn heater on'}
      </button>
      <ConfirmDialog
        open={confirm}
        title={on ? 'Turn heater OFF' : 'Turn heater ON'}
        body={`${on ? 'Stop' : 'Start'} the diesel heater on ${unit}?`}
        confirmLabel="Send"
        pending={command.isPending}
        onConfirm={() => command.mutate({ unit, body: { heater: { on: on ? 0 : 1 } } }, { onSettled: () => setConfirm(false) })}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}

export default function OverviewTab({ tele, unit, isDemo, onOpenTab }) {
  const { data: shadow } = useShadow(unit)
  if (!tele) return <div className="notice">Waiting for telemetry…</div>

  const view = unitView(tele)
  const copy = bannerCopy(tele, view)
  const Icon = TONE_ICON[view.tone]
  const lowBatt = tele.batt_v != null && Number(tele.batt_v) < 12
  const heater = tele.heater_present

  return (
    <>
      <section aria-label="Unit status" className={`banner b-${view.tone}`}>
        <span className={`badge badge-icon t-${view.tone}`} style={{ width: 52, height: 52 }}>
          <Icon size={28} aria-hidden="true" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="banner-title" style={{ margin: 0, color: TONE_TEXT[view.tone] || 'var(--color-text-primary)' }}>{copy.title}</h2>
          <div className="banner-sub">{copy.sub}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>{view.seen}</span>
          {copy.tab && onOpenTab && (
            <button className="btn btn-sm" onClick={() => onOpenTab(copy.tab[0])}>{copy.tab[1]}</button>
          )}
        </div>
      </section>

      <div className="ov-layout">
        <div className="ov-groups">
          <Group id="g-power" title="Power" Icon={IconBattery2}>
            <Row label="Battery" color={lowBatt ? 'var(--warn)' : undefined}>{fmt.volts(tele.batt_v)}</Row>
            <Row label="Ignition">{tele.ignition ? 'On' : 'Off'}</Row>
            <Row label="Mode">{modeLabel(tele)}</Row>
          </Group>
          <Group id="g-climate" title="Climate" Icon={IconTemperature}>
            <Row label="Cabin">{fmt.tempF(tele.cabin_temp_f)}</Row>
            <Row label="Setpoint">{fmt.tempF(tele.clmt_setpoint_f)}</Row>
            <Row label="Outside">{fmt.tempF(tele.ext_temp_f)}</Row>
            <Row label="Fan">{fmt.pct(tele.fan_speed)}{tele.fan_auto ? ' · auto' : ''}</Row>
          </Group>
          <Group id="g-engine" title="Engine" Icon={IconGauge}>
            <Row label="Speed">{rpmText(tele.rpm)}</Row>
            <Row label="Oil pressure" color={tele.oil_ok === false ? 'var(--err)' : 'var(--ok)'}>
              {tele.oil_ok == null ? '—' : tele.oil_ok ? 'OK' : 'Low'}
            </Row>
            <Row label="Engine hours">{fmt.hours(tele.engine_hrs)}</Row>
          </Group>
          {heater && (
            <Group id="g-heater" title="Diesel heater" Icon={IconFlame}
              badge={tele.heater_comms_ok ? null : <span className="badge badge-sm t-warn">No comms</span>}>
              <Row label="State">{heaterStateLabel(tele.heater_state)}</Row>
              <Row label="Level">{tele.heater_target_level == null ? '—' : `${tele.heater_target_level} of 10`}</Row>
              {Number(tele.heater_error) !== 0 && <Row label="Error code" color="var(--err)">{tele.heater_error}</Row>}
            </Group>
          )}
        </div>

        <div className="ov-side">
          <section className="group" aria-labelledby="g-actions">
            <h3 id="g-actions" className="group-hd" style={{ margin: 0 }}>Quick actions</h3>
            <ApuControls tele={tele} unit={unit} isDemo={isDemo} offline={view.stale} stacked
              extra={heater ? <HeaterToggle tele={tele} unit={unit} isDemo={isDemo} offline={view.stale} /> : null} />
          </section>
          <Group id="g-info" title="Unit info">
            <Row label="Machine hours" sm>{fmt.hours(tele.machine_hrs)}</Row>
            <Row label="Oil hours" sm>{fmt.hours(tele.oil_hrs)}</Row>
            <Row label="APU firmware" sm>{apuVersionLabel(tele.apu_fw_version)}</Row>
            <Row label="System image" sm>{shadow?.reported?.firmware_version || '—'}</Row>
          </Group>
        </div>
      </div>
    </>
  )
}
