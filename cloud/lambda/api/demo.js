'use strict';

// Synthetic demo peers so fleet screens are populated without a real fleet.
// Deterministic per (unit, hour) so repeated calls agree. Never written to
// InfluxDB; never controllable (see handleCommand). Toggle via DEMO_UNITS env.

const DEMO_UNITS = ['APU-DEMO-01', 'APU-DEMO-02', 'APU-DEMO-03'];

function demoEnabled() {
  return (process.env.DEMO_UNITS || 'off').toLowerCase() === 'on';
}
function listDemoUnits() { return demoEnabled() ? [...DEMO_UNITS] : []; }
function isDemoUnit(unit) { return DEMO_UNITS.includes(unit); }

// Tiny deterministic PRNG (mulberry32-ish) seeded from unit+bucket.
function seed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function snapshot(unit, tsMs) {
  const bucket = Math.floor(tsMs / 3600000); // per-hour determinism
  const r = seed(`${unit}:${bucket}`);
  const running = r() > 0.4;
  return {
    ts: tsMs,
    unit,
    demo: true,
    cabin_temp_f: Math.round((68 + r() * 20) * 10) / 10,
    ext_temp_f: Math.round((50 + r() * 40) * 10) / 10,
    batt_v: Math.round((12.2 + r() * 1.6) * 100) / 100,
    rpm: running ? 1800 + Math.round(r() * 200) : 0,
    oil_ok: r() > 0.1,
    ignition: running,
    mode: running ? 'engine' : 'battery', mode_n: running ? 1 : 2,
    engine_status: running ? 'running' : 'off', engine_status_n: running ? 1 : 0,
    control_status: running ? 'climate' : 'idle', control_status_n: running ? 3 : 0,
    error: 'none', error_n: 0,
    oil_change: 'ok', oil_change_n: 0,
    engine_hrs: 100 + bucket % 900, oil_hrs: bucket % 250, machine_hrs: 500 + bucket % 4000,
    clmt_setpoint_f: 72, batt_setpoint_v: 12.8,
    fan_speed: running ? 40 + Math.round(r() * 50) : 0, fan_auto: true,
    diag_active: false, diag_outputs: 0, apu_fw_version: 10240,
    heater_present: true, heater_state: 'off',
    heater_target_level: 3, heater_active_level: 0, heater_error: 0,
    heater_supply_v: 0, heater_fan_rpm: 0, heater_pump_hz: 0, heater_exchanger: 0,
    heater_state_seconds: 0, heater_age_ms: 0, heater_flags: 16,
    heater_safe_off: false, heater_comms_ok: false,
    heater_valid_frames: 0, heater_checksum_failures: 0, heater_transport_errors: 0,
  };
}

function demoLatest(unit) {
  // Use the current hour's deterministic snapshot, but stamp it "now" so the
  // dashboard shows demo peers as live rather than stale.
  const s = snapshot(unit, Date.now() - (Date.now() % 3600000));
  s.ts = Date.now();
  return s;
}
function demoSeries(unit, n) {
  const now = Date.now() - (Date.now() % 3600000);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(snapshot(unit, now - i * 3600000));
  return out;
}

module.exports = { demoEnabled, listDemoUnits, isDemoUnit, demoLatest, demoSeries, DEMO_UNITS };
