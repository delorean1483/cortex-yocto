'use strict';

// Pure low-battery rule: one telemetry reading in, the unit's new alert state
// and the email to send (if any) out. No I/O; battery-check.js stores the
// state per unit.
//
// A condition counts only once every reading for HOLD_MS has met it, so an
// engine crank or a single glitch reading never sends email. Durations use
// arrival time (nowMs): unit clocks can be wrong after a cold boot. Rows the
// agent replays from its offline buffer (ts well behind arrival) are skipped,
// so a truck that reconnects doesn't email about hours-old levels.

const LOW_V     = 12.0;
const STEP_V    = 1.0;
const HOLD_MS   = 10 * 60 * 1000;
const DAILY_MS  = 24 * 60 * 60 * 1000;
const REPLAY_MS = 5 * 60 * 1000;

const INITIAL_STATE = Object.freeze({
  alerting: false, lastV: null, lastSentMs: null, runKind: null, runSinceMs: null,
});
const KEYS = Object.keys(INITIAL_STATE);
const sameState = (a, b) => KEYS.every((k) => a[k] === b[k]);

// The condition a reading meets: 'low' (first alert), 'lower' (a further volt
// below the last level emailed), 'high' (recovery), or null.
function conditionOf(s, v) {
  if (!s.alerting) return v < LOW_V ? 'low' : null;
  if (v <= s.lastV - STEP_V) return 'lower';
  return v >= LOW_V ? 'high' : null;
}

function stepBattery(state, { v, tsMs }, nowMs) {
  const s = { ...INITIAL_STATE, ...(state || {}) };
  // Never coerce: Number(null) is 0, which would read as a dead battery.
  if (typeof v !== 'number' || !Number.isFinite(v) || tsMs < nowMs - REPLAY_MS) {
    return { state: s, changed: false, email: null };
  }

  if (s.alerting && v < LOW_V && nowMs - s.lastSentMs >= DAILY_MS) {
    return { state: { ...s, lastV: v, lastSentMs: nowMs }, changed: true, email: { kind: 'daily', v } };
  }

  const kind = conditionOf(s, v);
  let next = s;
  let email = null;
  if (kind !== s.runKind) {
    next = { ...s, runKind: kind, runSinceMs: kind ? nowMs : null };
  } else if (kind && nowMs - s.runSinceMs >= HOLD_MS) {
    if (kind === 'high') {
      next = { ...INITIAL_STATE };
      email = { kind: 'recovered', v };
    } else {
      next = { ...s, alerting: true, lastV: v, lastSentMs: nowMs, runKind: null, runSinceMs: null };
      email = { kind, v };
    }
  }
  return { state: next, changed: !sameState(s, next), email };
}

const SUBJECTS = {
  low: 'Low battery',
  lower: 'Battery still falling',
  daily: 'Battery still low',
  recovered: 'Battery recovered',
};

// "Oct 25, 2026, 1:42 AM CDT". Newer ICU puts U+202F before AM/PM; use a space.
function centralTime(ms) {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).replace(/ /g, ' ');
}

function batteryEmail(kind, unit, v, nowMs, dashboardUrl) {
  const volts = `${v.toFixed(2)} V`;
  return {
    subject: `[EcoFleet] ${SUBJECTS[kind]} — ${unit}: ${volts}`,
    text: [
      `Unit     : ${unit}`,
      `Battery  : ${volts}`,
      `Time     : ${centralTime(nowMs)}`,
      '',
      `${dashboardUrl}/units/${encodeURIComponent(unit)}`,
    ].join('\n'),
  };
}

module.exports = {
  stepBattery, batteryEmail, INITIAL_STATE, LOW_V, STEP_V, HOLD_MS, DAILY_MS, REPLAY_MS,
};
