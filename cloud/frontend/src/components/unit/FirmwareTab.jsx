import { useState } from 'react'
import { useCommand } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'

// Latest available release (in production this would come from the OTA channel /
// shadow). Displayed against the unit's current apu_fw_version.
const LATEST_FW = '1.2.41'

function fwLabel(v) {
  // apu_fw_version is encoded (e.g. 10240) — show raw + a friendly hint.
  return v != null ? `v${v}` : '—'
}

export default function FirmwareTab({ tele, unit, isDemo }) {
  const command = useCommand()
  const { allowed, reason } = useCan('ota')
  const [confirm, setConfirm] = useState(null)
  const [sent, setSent] = useState(false)

  const disabled = !allowed || isDemo
  const disabledReason = isDemo ? 'Demo units cannot be controlled.' : reason

  const run = () => command.mutate(
    { unit, body: { firmware_target: LATEST_FW } },
    { onSuccess: () => setSent(true), onSettled: () => setConfirm(null) },
  )

  return (
    <>
      <div className="card">
        <div className="sec-hd">
          <span className="sec-title">Firmware</span>
          <span className="pill p-a">Update available</span>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12.5, marginBottom: 14 }}>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Current</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{fwLabel(tele?.apu_fw_version)}</span></div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Available</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand-blue)', fontWeight: 600 }}>{LATEST_FW}</span></div>
        </div>
        <div title={disabled ? disabledReason : undefined}>
          <button className="btn btn-primary" disabled={disabled}
            onClick={() => setConfirm(true)}>
            Push OTA update
          </button>
        </div>
        {disabled && <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{disabledReason}</div>}
        {sent && (
          <div className="notice" style={{ marginTop: 12, fontSize: 11.5 }}>
            OTA queued. The unit will download <span style={{ fontFamily: 'var(--font-mono)' }}>{LATEST_FW}</span>,
            apply it via swupdate, and reboot. It will drop offline briefly during the update.
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title="Push firmware update"
        body={`Push firmware ${LATEST_FW} to ${unit}? The unit will download the bundle and reboot.`}
        confirmLabel="Push update"
        pending={command.isPending}
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}
