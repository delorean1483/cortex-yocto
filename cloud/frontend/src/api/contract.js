// Pure view-model helpers over the telemetry contract (cloud/CONTRACT.md).

export function unitStatus(tele) {
  if (!tele) return 'off'
  if (Number(tele.error_n) !== 0) return 'err'
  if ((tele.batt_v != null && Number(tele.batt_v) < 12.0) || tele.oil_ok === false) return 'warn'
  return 'ok'
}

export function statusDotClass(status) {
  return { ok: 's-on', warn: 's-warn', err: 's-err', off: 's-off' }[status] || 's-off'
}

export function isStale(tele, maxAgeMs = 60000) {
  if (!tele || tele.ts == null) return true
  return (Date.now() - Number(tele.ts)) > maxAgeMs
}

export function heaterStateLabel(state) {
  if (!state) return 'Unknown'
  return String(state).charAt(0).toUpperCase() + String(state).slice(1)
}

const dash = (v) => v == null || Number.isNaN(Number(v))
export const fmt = {
  volts: (v) => dash(v) ? '—' : `${Number(v).toFixed(1)} V`,
  tempF: (v) => dash(v) ? '—' : `${Math.round(Number(v))}°F`,
  pct:   (v) => dash(v) ? '—' : `${Math.round(Number(v))}%`,
  int:   (v) => dash(v) ? '—' : `${Math.round(Number(v))}`,
  hours: (v) => dash(v) ? '—' : `${Math.round(Number(v))} h`,
  // uint16 firmware counters stick at 0xFFFF once saturated — show "65535+"
  // so a pegged counter doesn't read as an exact count.
  counter: (v) => dash(v) ? '—' : Number(v) >= 0xFFFF ? '65535+' : `${Math.round(Number(v))}`,
}

// The telemetry API returns newest-first; time-axis charts need oldest-first
// or the x-axis runs backwards. Copies — never mutates the query cache.
export function chronological(series) {
  return [...(series || [])].sort((a, b) => Number(a.ts) - Number(b.ts))
}

export const HEATER_FLAG_LABELS = [
  { key: 'fresh',       bit: 0x01, label: 'Fresh' },
  { key: 'cooldown',    bit: 0x02, label: 'Cooldown' },
  { key: 'safe_off',    bit: 0x04, label: 'Safe-off' },
  { key: 'comms_fault', bit: 0x08, label: 'Comms fault' },
  { key: 'xport_fault', bit: 0x10, label: 'Transport fault' },
]
export function heaterFlags(flags) {
  const f = Number(flags) || 0
  return HEATER_FLAG_LABELS.map((x) => ({ key: x.key, label: x.label, on: (f & x.bit) !== 0 }))
}

// Component-test output names by index (mirrors firmware diag_outputs bits;
// best-effort labels — correct against firmware if they differ).
export const DIAG_OUTPUTS = [
  'Run/Ignition', 'Glow Plug', 'Starter', 'Fuel Pump',
  'Evap Fan', 'Compressor', 'Condenser Fan',
]
export function diagOutputs(mask) {
  const m = Number(mask) || 0
  return DIAG_OUTPUTS.map((name, idx) => ({ idx, name, on: (m & (1 << idx)) !== 0 }))
}

export function connLabel(tele) {
  if (!tele || tele.ts == null) return { text: 'no data', cls: 'p-n' }
  return isStale(tele) ? { text: 'stale', cls: 'p-a' } : { text: 'live', cls: 'p-g' }
}

// Device-shadow heater ack helpers. The agent bumps heater_desired_seq each
// time it accepts a heater desired, and nulls desired.heater once applied.
export function heaterCmdSeq(shadow) {
  return Number(shadow?.reported?.heater_desired_seq) || 0
}
export function heaterDesiredPending(shadow) {
  return !!(shadow?.desired && shadow.desired.heater)
}

// ── APU (STM32) firmware OTA view-model helpers ──────────────────────────────
// The STM32 reg 2 (apu_fw_version) and the bundled version are encoded
// major*10000 + minor*100 + patch (e.g. 10101 -> "1.1.1"). apu_bundled_fw_version
// may instead arrive as an already-human semver string from the image manifest,
// so accept both. Returns an em dash for missing/zero/unparseable values.
export function apuVersionLabel(v) {
  if (v == null) return '—'
  if (typeof v === 'string') {
    return /^\d+\.\d+\.\d+$/.test(v.trim()) ? v.trim() : '—'
  }
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const major = Math.floor(n / 10000)
  const minor = Math.floor(n / 100) % 100
  const patch = n % 100
  return `${major}.${minor}.${patch}`
}

// apu_flash_state: idle | flashing | verifying | done | failed. Returns a label
// plus flags the FirmwareTab uses to drive the pending→applied UI.
export function apuFlashStateLabel(state) {
  const map = {
    idle:      { text: 'Idle',        busy: false, failed: false },
    flashing:  { text: 'Flashing…',   busy: true,  failed: false },
    verifying: { text: 'Verifying…',  busy: true,  failed: false },
    done:      { text: 'Done',        busy: false, failed: false },
    failed:    { text: 'Failed',      busy: false, failed: true  },
  }
  return map[state] || map.idle
}

// Linux-image OTA status from the shadow (reported.ota_status), written by the
// unit's OTA worker: "idle" | "downloading <v>" | "installing <v>" |
// "success <v>" | "failed: <reason>". Returns a pill view-model; `show` is false
// for idle/empty (nothing worth displaying), failures are flagged red (p-a),
// in-progress/success green (p-g).
export function otaStatusView(s) {
  const raw = String(s || '').trim()
  if (!raw || raw === 'idle') return { show: false, label: '', cls: 'p-n' }
  return { show: true, label: raw, cls: raw.startsWith('failed') ? 'p-a' : 'p-g' }
}

// ── Status-first view model (Dashboard cards, Unit Overview banner) ──────────

// Elapsed milliseconds -> "14s ago" / "4 min ago" / "2 h 14 min ago" / "2 d ago".
export function ageText(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—'
  const s = Math.max(0, Math.floor(Number(ms) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min ago` : `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

const MODE_LABELS = { climate: 'Climate', battery: 'Battery charge', off: 'Off', idle: 'Off' }

// What the APU is doing, in operator words. control_status carries the active
// climate/battery program; mode is the fallback (it can read 'engine').
export function modeLabel(tele) {
  if (!tele) return '—'
  const c = String(tele.control_status || '').toLowerCase()
  if (c === 'climate' || c === 'battery') return MODE_LABELS[c]
  const m = String(tele.mode || '').toLowerCase()
  if (!m) return '—'
  return MODE_LABELS[m] || m.charAt(0).toUpperCase() + m.slice(1)
}

export function engineRunning(tele) {
  return !!tele && (tele.engine_status === 'running' || Number(tele.rpm) > 0)
}

// One unit's headline status. Staleness outranks everything else: once a unit
// stops reporting its fault/battery values are history, not current state.
// tone: err | warn | ok | off. attention: belongs in "Needs attention".
export function unitView(tele, now = Date.now()) {
  if (!tele || tele.ts == null) {
    return { tone: 'off', status: 'No data', headline: 'Waiting for first report', seen: '—', stale: true, attention: false }
  }
  const age = now - Number(tele.ts)
  if (age > 60000) {
    return { tone: 'off', status: 'Offline', headline: 'Not reporting · last known values',
      seen: `Last report ${ageText(age)}`, stale: true, attention: true }
  }
  const seen = `Reported ${ageText(age)}`
  if (Number(tele.error_n) !== 0) {
    return { tone: 'err', status: 'Fault', headline: tele.error || 'Fault reported', seen, stale: false, attention: true }
  }
  if (tele.batt_v != null && Number(tele.batt_v) < 12.0) {
    return { tone: 'warn', status: 'Warning', headline: `Low battery · ${fmt.volts(tele.batt_v)}`, seen, stale: false, attention: true }
  }
  if (tele.oil_ok === false) {
    return { tone: 'warn', status: 'Warning', headline: 'Low oil pressure', seen, stale: false, attention: true }
  }
  const running = engineRunning(tele)
  const mode = modeLabel(tele)
  // Nothing selected and engine off reads as one idea: the APU is off.
  const headline = !running && mode === 'Off' ? 'APU off' : `${mode} · engine ${running ? 'running' : 'off'}`
  return { tone: 'ok', status: running ? 'Running' : 'Standby', headline, seen, stale: false, attention: false }
}

const TONE_RANK = { err: 0, warn: 1, off: 2, ok: 3 }

// Array.sort comparator over { view } rows: faults first, then warnings,
// offline, healthy; rows without a view yet go last. Array.sort is stable, so
// the fleet's own order holds within a tone.
export function byAttention(a, b) {
  const ra = a.view ? TONE_RANK[a.view.tone] ?? 4 : 5
  const rb = b.view ? TONE_RANK[b.view.tone] ?? 4 : 5
  return ra - rb
}

// ── Faults (Alerts page) ─────────────────────────────────────────────────────
// Controller fault bits. Several can be set at once; any critical bit makes the
// event critical.
const FAULT_BITS = [
  { mask: 0x0001, name: 'DC under-voltage',  critical: false },
  { mask: 0x0002, name: 'DC under-voltage',  critical: false },
  { mask: 0x0004, name: 'DC over-voltage',   critical: false },
  { mask: 0x0008, name: 'Over-current',      critical: true },
  { mask: 0x0010, name: 'Coolant over-temp', critical: true },
  { mask: 0x0020, name: 'Low oil pressure',  critical: true },
  { mask: 0x0040, name: 'Comm timeout',      critical: false },
  { mask: 0x0080, name: 'Sensor fault',      critical: false },
]

function faultCode(fault) {
  if (fault == null || fault === '') return 0
  const n = typeof fault === 'string' ? parseInt(fault, 16) : Number(fault)
  return Number.isFinite(n) ? n : 0
}

function hexCode(code) {
  return `0x${code.toString(16).padStart(4, '0').toUpperCase()}`
}

// Display info for one fault event: a name (the device's description when it
// sent one), the hex code, and severity.
export function faultInfo(f) {
  const code = faultCode(f?.fault)
  const bits = FAULT_BITS.filter((b) => code & b.mask)
  const critical = bits.some((b) => b.critical)
  const told = [f?.description, f?.error].find((t) => t && t !== 'none')
  const name = told || [...new Set(bits.map((b) => b.name))].join(', ') || `Fault ${hexCode(code)}`
  return { name, code: hexCode(code), tone: critical ? 'err' : 'warn', severity: critical ? 'Critical' : 'Warning' }
}

// Faults still in effect: walking newest -> oldest, an all-clear (code 0) ends
// the walk; a clear for one code resolves that code only. Repeats of a code
// collapse to the newest event. Returns newest first.
export function activeFaults(events) {
  const sorted = [...(events || [])].sort((a, b) => Number(b.ts) - Number(a.ts))
  const cleared = new Set()
  const out = new Map()
  for (const e of sorted) {
    const code = faultCode(e.fault)
    if (e.state === 'cleared' || code === 0) {
      if (code === 0) break
      cleared.add(code)
      continue
    }
    if (!cleared.has(code) && !out.has(code)) out.set(code, e)
  }
  return [...out.values()]
}

// ── Reports ──────────────────────────────────────────────────────────────────
const APU_SAVINGS_CAPTION = 'Estimate: $2.40 per APU runtime hour'
const count = (v) => Math.round(Number(v)).toLocaleString('en-US')

// Stat cards for the Reports page. zeroRuntime flags a period where no real
// unit's engine-hours counter moved, so the page can say so instead of showing
// a wall of zeros.
export function reportView(totals) {
  const has = (v) => v != null && Number.isFinite(Number(v))
  const t = totals || {}
  const noFaults = has(t.fault_events) && Number(t.fault_events) === 0
  return {
    zeroRuntime: has(t.runtime_hrs) && Number(t.runtime_hrs) === 0,
    cards: [
      { key: 'runtime', label: 'APU runtime', value: has(t.runtime_hrs) ? count(t.runtime_hrs) : '—', unit: has(t.runtime_hrs) ? 'h' : '',
        caption: 'From engine-hours counters, real units only' },
      { key: 'savings', label: 'Estimated fuel savings', value: has(t.fuel_saved_usd) ? `$${count(t.fuel_saved_usd)}` : '—', unit: '',
        caption: APU_SAVINGS_CAPTION, tone: 'ok' },
      { key: 'mtbf', label: 'Mean time between faults',
        value: noFaults ? 'No faults' : has(t.mtbf_hrs) ? count(t.mtbf_hrs) : '—', unit: !noFaults && has(t.mtbf_hrs) ? 'h' : '',
        caption: 'APU runtime per fault event' },
      { key: 'faults', label: 'Fault events', value: has(t.fault_events) ? count(t.fault_events) : '—', unit: '',
        caption: 'Fault onsets in this period' },
    ],
  }
}
