import { useState, useEffect } from 'react'
import { useCommand, useReleases } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'

export default function FirmwareTab({ tele, unit, isDemo }) {
  const command = useCommand()
  const { data: rel, isLoading, error } = useReleases()
  const { allowed, reason } = useCan('ota')
  const [confirm, setConfirm] = useState(false)
  const [sent, setSent] = useState(false)
  const [target, setTarget] = useState('')

  const releases = rel?.releases || []
  const latest = rel?.latest || null

  // Default the target to the latest available release once loaded.
  useEffect(() => { if (latest && !target) setTarget(latest) }, [latest, target])

  const disabled = !allowed || isDemo || !target
  const disabledReason = isDemo ? 'Demo units cannot be controlled.'
    : !allowed ? reason
    : !target ? 'No release selected.' : ''

  const run = () => command.mutate(
    { unit, body: { firmware_target: target } },
    { onSuccess: () => setSent(true), onSettled: () => setConfirm(false) },
  )

  return (
    <>
      <div className="card">
        <div className="sec-hd">
          <span className="sec-title">Firmware / OTA</span>
          {latest && <span className="pill p-n">latest: {latest}</span>}
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12.5, marginBottom: 14 }}>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>APU firmware</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{tele?.apu_fw_version != null ? `v${tele.apu_fw_version}` : '—'}</span></div>
        </div>

        {isLoading && <div className="notice" style={{ fontSize: 11.5 }}>Loading available releases…</div>}
        {error && <div className="notice" style={{ fontSize: 11.5, color: '#E24B4A' }}>Couldn't load releases: {error.message}</div>}
        {!isLoading && !error && releases.length === 0 && (
          <div className="notice" style={{ fontSize: 11.5 }}>No OTA releases available in the channel.</div>
        )}

        {releases.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
               title={disabled ? disabledReason : undefined}>
            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>Push version</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!allowed || isDemo}
              style={{ fontSize: 12, padding: '4px 8px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)' }}>
              {releases.map((v) => <option key={v} value={v}>{v}{v === latest ? ' (latest)' : ''}</option>)}
            </select>
            <button className="btn btn-primary" disabled={disabled} onClick={() => setConfirm(true)}>
              Push OTA update
            </button>
          </div>
        )}

        {disabled && disabledReason && releases.length > 0 &&
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{disabledReason}</div>}

        {sent && (
          <div className="notice" style={{ marginTop: 12, fontSize: 11.5 }}>
            OTA queued: the unit will download <span style={{ fontFamily: 'var(--font-mono)' }}>{target}</span>,
            apply it via swupdate, and reboot. It drops offline briefly during the update.
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          Versions are the real bundles published to the OTA channel (S3). Only these can be pushed.
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Push firmware update"
        body={`Push firmware ${target} to ${unit}? The unit will download the bundle and reboot.`}
        confirmLabel="Push update"
        pending={command.isPending}
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}
