import { useState, useEffect } from 'react'
import { useCommand, useReleases, useShadow } from '../../data/hooks.js'
import { useCan } from '../../components/RoleGate.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { apuVersionLabel, apuFlashStateLabel, otaStatusView } from '../../api/contract.js'
import { APU_OTA_ENABLED } from '../../config/flags.js'

export default function FirmwareTab({ tele, unit, isDemo }) {
  const command = useCommand()
  const { data: rel, isLoading, error } = useReleases()
  const { allowed, reason } = useCan('ota')
  const [confirm, setConfirm] = useState(false)
  const [sent, setSent] = useState(false)
  const [target, setTarget] = useState('')

  const releases = rel?.releases || []
  const latest = rel?.latest || null

  // Live OTA state the unit reports in its shadow (downloading/installing/failed),
  // so the operator sees real progress instead of just the optimistic "queued".
  const { data: shadow } = useShadow(unit)
  const ota = otaStatusView(shadow?.reported?.ota_status)

  // The cortex/Linux image version the unit is actually running (device reports
  // it in the shadow), so the operator can see current-vs-latest at a glance
  // rather than only the channel's latest.
  const cortexCurrent = shadow?.reported?.firmware_version || null
  const upToDate = cortexCurrent && latest && cortexCurrent === latest

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

  // ── APU (STM32) controller firmware, flashed over RS-485 ──────────────────
  const { allowed: apuAllowed, reason: apuReason } = useCan('apu_ota')
  const [apuConfirm, setApuConfirm] = useState(false)
  const [apuSent, setApuSent] = useState(false)

  const apuCurrent = apuVersionLabel(tele?.apu_fw_version)
  const apuBundled = apuVersionLabel(tele?.apu_bundled_fw_version)
  const flash = apuFlashStateLabel(tele?.apu_flash_state)

  // Mirror the device-side safety gate: the APU must be OFF/idle to flash.
  // engine_status/control_status enums: 2 = starting, 3 = running.
  const engineRunning = [2, 3].includes(Number(tele?.control_status_n)) ||
                        [2, 3].includes(Number(tele?.engine_status_n))
  const apuDisabled = !apuAllowed || isDemo || engineRunning || flash.busy || apuBundled === '—'
  const apuDisabledReason = isDemo ? 'Demo units cannot be controlled.'
    : !apuAllowed ? apuReason
    : engineRunning ? 'The APU must be OFF to flash — stop it first.'
    : flash.busy ? 'A flash is already in progress.'
    : apuBundled === '—' ? 'No bundled APU firmware reported yet.'
    : ''

  // Flash the version bundled in the running image. Behind APU_OTA_ENABLED and
  // dead at runtime until the backend accepts `apu_firmware_target` (scope
  // Phase 2) and the agent acts on it (Phase 1); Phase 2 finalises the payload.
  const runApu = () => command.mutate(
    { unit, body: { apu_firmware_target: apuBundled } },
    { onSuccess: () => setApuSent(true), onSettled: () => setApuConfirm(false) },
  )

  return (
    <>
      <div className="card">
        <div className="sec-hd">
          <span className="sec-title">Firmware / OTA</span>
          {ota.show && <span className={`pill ${ota.cls}`} title="Live OTA status reported by the unit">{ota.label}</span>}
          {cortexCurrent && latest ? (
            <span className={`pill ${upToDate ? 'p-g' : 'p-n'}`}
                  title={`Running ${cortexCurrent}; latest published is ${latest}`}>
              {upToDate ? 'up to date' : 'update available'}
            </span>
          ) : latest ? (
            <span className="pill p-n">latest: {latest}</span>
          ) : null}
        </div>

        {/* Current (what the unit runs) vs Latest (newest in the channel), so an
            out-of-date unit is obvious without opening the push dropdown. */}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12.5, marginBottom: 14 }}>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Current</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{cortexCurrent || '—'}</span></div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Latest</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{latest || '—'}</span></div>
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

      {/* ── APU controller firmware (STM32, flashed over RS-485 into A/B slots) ── */}
      <div className="card">
        <div className="sec-hd">
          <span className="sec-title">APU controller firmware</span>
          <span className={`pill ${flash.failed ? 'p-a' : flash.busy ? 'p-g' : 'p-n'}`}>{flash.text}</span>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12.5, marginBottom: 14 }}>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Current</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{apuCurrent}</span></div>
          <div><span style={{ color: 'var(--color-text-tertiary)' }}>Bundled</span>{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{apuBundled}</span></div>
        </div>

        {APU_OTA_ENABLED ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
                 title={apuDisabled ? apuDisabledReason : undefined}>
              <button className="btn btn-primary" disabled={apuDisabled} onClick={() => setApuConfirm(true)}>
                Flash APU firmware
              </button>
            </div>
            {apuDisabled && apuDisabledReason &&
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{apuDisabledReason}</div>}
            {apuSent && (
              <div className="notice" style={{ marginTop: 12, fontSize: 11.5 }}>
                APU flash queued: the agent will stream <span style={{ fontFamily: 'var(--font-mono)' }}>{apuBundled}</span>{' '}
                over RS-485 into the STM32's inactive slot and verify it. The APU is briefly unavailable while it reflashes.
              </div>
            )}
          </>
        ) : (
          <div className="notice" style={{ fontSize: 11.5 }}>
            Remote APU-firmware flashing will be enabled after bench validation of
            the STM32 A/B flash path. This panel is read-only for now.
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          The APU controller (STM32) is flashed over RS-485 into its own A/B
          bootloader slots — separate from the Linux image OTA above. It must be
          OFF to flash, and a bad flash auto-reverts to the previous slot.
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

      <ConfirmDialog
        open={apuConfirm}
        title="Flash APU controller firmware"
        body={`Flash APU firmware ${apuBundled} to ${unit}? The APU controller MUST be OFF — it will be briefly unavailable while the microcontroller reflashes over RS-485. A failed flash auto-reverts to the current slot.`}
        confirmLabel="Flash APU firmware"
        pending={command.isPending}
        onConfirm={runApu}
        onCancel={() => setApuConfirm(false)}
      />
    </>
  )
}
