'use strict';

const { centralTime, ALERT_FAILED } = require('./alert-mail');

// APU fault events: what gobi-agent publishes on ecofleet/<serial>/faults
// (cloud/CONTRACT.md §2) -> one InfluxDB record per change, and an email when a
// fault starts or clears. No AWS calls here; faults.js passes them in as `io`.
//
// The agent publishes { unit, ts, error, error_n, status } whenever the APU's
// error code changes, including the change back to 0. error_n is the firmware's
// control_error_t (g0b1-firmware App/services/control.h): one code at a time,
// not a bitmask.

// Standby: the firmware stops the APU while the truck's own engine is running.
// That is the normal interlock every time a driver starts the truck, so it is
// recorded but never emailed, and it counts as "no fault".
const STANDBY = 7;

const FAULT_NAMES = {
  0: 'No fault',
  1: 'Low oil pressure',
  2: 'High engine temperature',
  3: 'Low battery',
  4: 'A/C low pressure',
  5: 'A/C high pressure',
  6: 'Engine failed to start',
  7: 'Standby (truck engine on)',
  8: 'Engine stalled',
  9: 'No engine RPM',
  10: 'High A/C pressure',
};

// control_status_t labels, as the panel shows them (gobi-ui StatusLabels.qml).
const STATUS_LABELS = {
  off: 'Off', warming_up: 'Warming up', starting: 'Starting', running: 'Running',
  defrost: 'Defrost', charging: 'Charging', cooling: 'Cooling', chillin: 'At target',
};

const isFault = (code) => code !== 0 && code !== STANDBY;

function faultName(code) {
  return FAULT_NAMES[code] || `Unknown fault (code ${code})`;
}

// Agent message -> { unit, tsMs, code, error, status }, or null if unusable.
function parseFault(msg, nowMs) {
  if (!msg || typeof msg.unit !== 'string' || !msg.unit) return null;
  const code = msg.error_n;
  if (!Number.isInteger(code) || code < 0) return null;
  const ts = Number(msg.ts);
  return {
    unit: msg.unit,
    tsMs: Number.isFinite(ts) && ts > 0 ? ts : nowMs,
    code,
    error: typeof msg.error === 'string' ? msg.error : '',
    status: typeof msg.status === 'string' && msg.status ? msg.status : 'unknown',
  };
}

// Fields of the `faults` record. `fault`, `description` and `state`
// (active | cleared | standby) are what the API returns to the Alerts page and
// History tab; `active` is what Reports counts as a fault onset.
function faultFields(ev) {
  return {
    fault: `0x${ev.code.toString(16).toUpperCase().padStart(4, '0')}`,
    error: ev.error,
    error_n: ev.code,
    description: faultName(ev.code),
    state: isFault(ev.code) ? 'active' : ev.code === STANDBY ? 'standby' : 'cleared',
    status: ev.status,
    active: isFault(ev.code),
  };
}

// 'fault' | 'cleared' | null. `prev` is the unit's newest record at or before
// this event ({ code, tsMs }), or null if there is none.
function alertKind(prev, ev) {
  if (prev && prev.tsMs === ev.tsMs && prev.code === ev.code) return null;  // redelivery
  if (isFault(ev.code)) return prev && prev.code === ev.code ? null : 'fault';
  return prev && isFault(prev.code) ? 'cleared' : null;
}

function faultEmail(kind, ev, prev, dashboardUrl) {
  const tail = [
    `APU      : ${STATUS_LABELS[ev.status] || ev.status}`,
    `Time     : ${centralTime(ev.tsMs)}`,
    '',
    `${dashboardUrl}/units/${encodeURIComponent(ev.unit)}`,
  ];
  if (kind === 'cleared') {
    const was = faultName(prev.code);
    return {
      subject: `[EcoFleet] Recovered — ${ev.unit}: ${was} cleared`,
      text: [`Unit     : ${ev.unit}`, `Cleared  : ${was}`, `Now      : ${faultName(ev.code)}`, ...tail].join('\n'),
    };
  }
  return {
    subject: `[EcoFleet] Fault — ${ev.unit}: ${faultName(ev.code)}`,
    text: [`Unit     : ${ev.unit}`, `Fault    : ${faultName(ev.code)}`, ...tail].join('\n'),
  };
}

// io = { lastFault(unit, tsMs) -> { code, tsMs } | null,
//        writeFault(unit, tsMs, fields), sendAlert({ subject, text }) }
// The lookup runs before the write, so it never sees this event's own record.
// Lookup and write failures throw (the Lambda fails and is retried, before any
// email went out); an email failure is logged and returned.
async function handleFault(msg, io, dashboardUrl, nowMs) {
  const ev = parseFault(msg, nowMs);
  if (!ev) {
    console.error('Dropping malformed fault event — need unit and integer error_n:', JSON.stringify(msg));
    return { dropped: true };
  }
  const prev = await io.lastFault(ev.unit, ev.tsMs);
  await io.writeFault(ev.unit, ev.tsMs, faultFields(ev));

  const kind = alertKind(prev, ev);
  console.log(`Fault event: unit=${ev.unit} code=${ev.code} (${faultName(ev.code)}) `
    + `prev=${prev ? prev.code : 'none'} email=${kind || 'no'}`);
  if (!kind) return { email: null };
  try {
    await io.sendAlert(faultEmail(kind, ev, prev, dashboardUrl));
    return { email: kind };
  } catch (err) {
    console.error(`${ALERT_FAILED}: fault email for ${ev.unit}: ${err.message}`);  // record already written
    return { email: kind, error: err.message };
  }
}

module.exports = { parseFault, faultFields, alertKind, faultEmail, handleFault, STANDBY };
