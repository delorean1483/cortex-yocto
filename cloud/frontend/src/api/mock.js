// Dev-only mock API — lets the full UI render locally without a backend.
// Enabled by VITE_MOCK=on (see .env.local). Never used in production builds
// (VITE_MOCK is undefined there, so client.js selects the real api).

const REAL_UNIT = 'APU-000123'
const DEMO_UNITS = ['APU-DEMO-01', 'APU-DEMO-02', 'APU-DEMO-03']
const STALE_UNITS = new Set(['APU-DEMO-02'])

function baseSnapshot(unit, over = {}) {
  return {
    unit, ts: Date.now(),
    cabin_temp_f: 96.1, ext_temp_f: 71.4, batt_v: 12.64, rpm: 0,
    oil_ok: true, ignition: false,
    mode: 'battery', mode_n: 2,
    engine_status: 'off', engine_status_n: 0,
    control_status: 'idle', control_status_n: 0,
    error: 'none', error_n: 0,
    oil_change: 'ok', oil_change_n: 0,
    engine_hrs: 4, oil_hrs: 4, machine_hrs: 128,
    clmt_setpoint_f: 72, batt_setpoint_v: 12.8, fan_speed: 0, fan_auto: true,
    diag_active: false, diag_outputs: 0, apu_fw_version: 10240,
    heater_present: true, heater_state: 'off',
    heater_target_level: 3, heater_active_level: 0, heater_error: 0,
    heater_supply_v: 0, heater_fan_rpm: 0, heater_pump_hz: 0, heater_exchanger: 0,
    heater_state_seconds: 0, heater_age_ms: 800, heater_flags: 16,
    heater_safe_off: false, heater_comms_ok: false,
    heater_valid_frames: 0, heater_checksum_failures: 0, heater_transport_errors: 4213,
    ...over,
  }
}

const SNAPSHOTS = {
  [REAL_UNIT]: baseSnapshot(REAL_UNIT),
  'APU-DEMO-01': baseSnapshot('APU-DEMO-01', {
    demo: true, mode: 'engine', mode_n: 1, engine_status: 'running', engine_status_n: 1,
    control_status: 'climate', control_status_n: 3, rpm: 1850, ignition: true,
    batt_v: 13.9, fan_speed: 65, cabin_temp_f: 74.2, engine_hrs: 812,
    heater_present: true, heater_state: 'running', heater_active_level: 4,
    heater_fan_rpm: 2600, heater_exchanger: 168, heater_comms_ok: true, heater_flags: 1,
  }),
  'APU-DEMO-02': baseSnapshot('APU-DEMO-02', {
    demo: true, batt_v: 11.6, error: 'Low battery voltage', error_n: 4,
    control_status: 'battery', mode: 'battery', engine_hrs: 431,
  }),
  'APU-DEMO-03': baseSnapshot('APU-DEMO-03', {
    demo: true, oil_ok: false, error: 'Low oil pressure', error_n: 1,
    mode: 'engine', mode_n: 1, engine_status: 'fault', rpm: 0, engine_hrs: 1290,
  }),
}

function series(unit, n) {
  const snap = SNAPSHOTS[unit] || baseSnapshot(unit)
  const now = Date.now()
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const t = now - i * 60000
    const jitter = Math.sin(i / 3) * 0.15
    out.push({ ...snap, ts: t, batt_v: +(snap.batt_v + jitter).toFixed(2),
      cabin_temp_f: +(snap.cabin_temp_f + Math.sin(i / 5) * 1.5).toFixed(1) })
  }
  return out
}

function fakeJwt(email, role) {
  const payload = btoa(JSON.stringify({ email, role, sub: email }))
  return `mockheader.${payload}.mocksig`
}

const delay = (v) => new Promise((res) => setTimeout(() => res(v), 120))

// Per-unit heater ack counter — bumped when a heater command is applied, so the
// dashboard's pending→applied badge resolves in the local demo (mirrors the
// device shadow's reported.heater_desired_seq).
const HEATER_SEQ = {}

let USERS = [
  { email: 'admin@ecofleet.io', role: 'admin', fleet: '—', status: 'active' },
  { email: 'mgr@fleet1.com', role: 'fm', fleet: 'FLEET-001', status: 'active' },
  { email: 'tech@fleet1.com', role: 'maint', fleet: 'FLEET-001', status: 'active' },
  { email: 'driver@fleet1.com', role: 'eu', fleet: 'FLEET-001', status: 'active' },
]

export const mockApi = {
  login: (email) => delay({ token: fakeJwt(email || 'demo@ecofleet.io', 'admin'),
    refresh_token: 'mock-rt', expires_in: 3600 }),

  listUnits: () => delay({ units: [
    { unit: REAL_UNIT, demo: false },
    ...DEMO_UNITS.map((u) => ({ unit: u, demo: true })),
  ] }),

  // Fresh ts on every poll (a load-time ts goes stale after 60s and every
  // unit would read Offline); STALE_UNITS keep an old one to demo that state.
  getLatest: (unit) => {
    const snap = SNAPSHOTS[unit] || baseSnapshot(unit)
    const ts = STALE_UNITS.has(unit) ? Date.now() - (2 * 60 + 14) * 60000 : Date.now()
    return delay({ unit, latest: { ...snap, ts } })
  },

  getTelemetry: (unit, params = {}) => {
    const n = Math.min(parseInt(params.limit || '60', 10), 240)
    return delay({ unit, count: n, telemetry: series(unit, n) })
  },

  getFaults: (unit) => delay({ unit, count: 2, faults: [
    { ts: Date.now() - 4 * 60000, fault: '0x0004', error: 'Low battery voltage', state: 'active' },
    { ts: Date.now() - 3 * 3600000, fault: '0x0000', error: 'none', state: 'cleared' },
  ] }),

  getShadow: (unit) => delay({ unit, shadow_exists: true, version: 12,
    reported: { report_mode: 'normal', poll_interval_s: 10, online: true, stale_seconds: 4,
      apu_fw_version: SNAPSHOTS[unit]?.apu_fw_version ?? 10240,
      firmware_version: '1.2.39',  // one behind the channel latest (1.2.40) -> demo shows "update available"
      heater_desired_seq: HEATER_SEQ[unit] || 0 },
    desired: {}, delta: {}, last_updated: Date.now() }),

  setConfig: (unit, config) => delay({ unit, shadow_version: 13, desired: config,
    message: 'Config queued (mock).' }),

  sendCommand: (unit, body) => {
    // Reflect heater/APU/OTA commands into the snapshot so the demo updates live.
    const snap = SNAPSHOTS[unit]
    if (snap && body.heater) {
      HEATER_SEQ[unit] = (HEATER_SEQ[unit] || 0) + 1
      if (body.heater.on !== undefined) {
        snap.heater_state = body.heater.on ? 'running' : 'off'
        snap.heater_active_level = body.heater.on ? (snap.heater_target_level || 3) : 0
        snap.heater_comms_ok = true
        snap.heater_flags = body.heater.on ? 1 : 16
      }
      if (body.heater.level !== undefined) {
        snap.heater_target_level = body.heater.level
        if (snap.heater_state === 'running') snap.heater_active_level = body.heater.level
      }
    }
    if (snap && body.apu_command) {
      // apu_command is the target op-state: 'climate' | 'battery' | 'stop'.
      const running = body.apu_command !== 'stop'
      snap.mode = running ? body.apu_command : 'off'
      snap.engine_status = running ? 'running' : 'off'
      snap.control_status = running ? body.apu_command : 'idle'
      snap.rpm = running ? 1850 : 0
      snap.ignition = running
    }
    if (snap && body.firmware_target) snap.apu_fw_version = 10241
    return delay({ unit, shadow_version: 13, desired: body, message: 'Command queued (mock).' })
  },

  getReleases: () => delay({ releases: ['1.2.40', '1.2.39', '1.2.38'], latest: '1.2.40' }),

  getReports: () => delay({
    totals: { runtime_hrs: 64200, fuel_saved_usd: 18400, mtbf_hrs: 812, fault_events: 14 },
    operators: [
      { operator: 'operator@fleet1.com', fleet: 'FLEET-001', starts: 142, stops: 138, fw_updates: 3 },
      { operator: 'dispatch@fleet2.com', fleet: 'FLEET-002', starts: 89, stops: 91, fw_updates: 1 },
    ],
  }),

  listUsers: () => delay({ users: USERS }),
  createUser: (u) => { USERS = [...USERS, { status: 'invited', fleet: '—', ...u }]; return delay({ ok: true }) },
  updateUser: (email, patch) => { USERS = USERS.map((x) => x.email === email ? { ...x, ...patch } : x); return delay({ ok: true }) },
  deleteUser: (email) => { USERS = USERS.filter((x) => x.email !== email); return delay({ ok: true }) },

  getMaintenance: (unit) => delay({ unit, records: [
    { unit, date: '2026-05-24', type: 'oil_change', tech: 'R. Holt', status: 'done' },
    { unit, date: '2026-05-10', type: 'inspection', tech: 'L. Chen', status: 'done' },
  ] }),
  addMaintenance: (rec) => delay({ ok: true, record: rec }),
}
